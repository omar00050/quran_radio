'use strict';

const EventEmitter = require('events');
const { PassThrough } = require('stream');
const { findOggHeaderEnd } = require('./OggPageParser');

const DEFAULTS = {
  idleMs: 600_000,       // keep a station's upstream warm this long with 0 listeners
  stallMs: 15_000,       // no data for this long => treat as dropped
  maxAttempts: 8,        // consecutive reconnect attempts before => 'failed'
  failedRetryMs: 60_000, // periodic retry cadence once 'failed'
  retryFloorMs: 3_000,
  retryCapMs: 60_000,
};

/**
 * Shared per-station fan-out: one upstream connection per URL, re-used by
 * every listener (guild) regardless of how many times getOrCreate/
 * createGuildStream are called. Owns the OGG header capture/replay, refcount
 * + idle sweep, stall watchdog and retry/backoff policy. The ONLY thing that
 * varies between embedded and remote mode is the `provider` passed in.
 */
class BroadcastHub extends EventEmitter {
  /**
   * @param {{kind:string, open:(url:string)=>Promise<{stream:import('stream').Readable,destroy:()=>void,pid:number|null}>, destroy?:()=>Promise<void>}} provider
   * @param {object} [opts]
   */
  constructor(provider, opts = {}) {
    super();
    this.provider = provider;
    this.idleMs = opts.idleMs ?? DEFAULTS.idleMs;
    this.stallMs = opts.stallMs ?? DEFAULTS.stallMs;
    this.maxAttempts = opts.maxAttempts ?? DEFAULTS.maxAttempts;
    this.failedRetryMs = opts.failedRetryMs ?? DEFAULTS.failedRetryMs;
    this.retryFloorMs = opts.retryFloorMs ?? DEFAULTS.retryFloorMs;
    this.retryCapMs = opts.retryCapMs ?? DEFAULTS.retryCapMs;
    this.logger = opts.logger || console;

    /** @type {Map<string, object>} */
    this.broadcasts = new Map();
    /** @type {Map<string, Promise<object>>} in-flight `_start` calls (I4 dedup) */
    this.inFlight = new Map();
  }

  // ─── Public API ────────────────────────────────────────────────────────

  async getOrCreate(url) {
    const entry = this.broadcasts.get(url);
    if (entry && entry.handle) return entry;

    const inflight = this.inFlight.get(url);
    if (inflight) return inflight;

    const startPromise = this._start(url).finally(() => this.inFlight.delete(url));
    this.inFlight.set(url, startPromise);
    return startPromise;
  }

  /**
   * New PassThrough with the cached OGG header written before it joins the
   * listener set. `null` if the broadcast isn't currently serving data.
   */
  createGuildStream(url) {
    const entry = this.broadcasts.get(url);
    if (!entry || entry.state === 'failed' || entry.state === 'stopped') return null;

    const stream = new PassThrough({ highWaterMark: 0 });

    // The header may not be captured yet — getOrCreate resolves as soon as the
    // upstream is open, which is before the first OGG pages have arrived. Join
    // the listener set anyway: the header-capture branch in _onData replays the
    // whole buffered prefix (header + first audio pages) to every listener, so
    // a pre-header joiner is served correctly. Returning null here instead
    // would mean the FIRST guild on every station never gets audio.
    if (entry.oggHeader) stream.write(entry.oggHeader);

    entry.listeners.add(stream);
    entry.refCount += 1;
    this._clearIdleTimer(entry);

    // Any path that ends this stream — releaseGuildStream, a direct
    // stream.destroy() by a caller, or an error — must decrement the refcount,
    // or the idle sweep never fires and the upstream stays warm forever.
    const onClose = () => this._detachStream(entry, stream);
    stream.once('close', onClose);
    stream.once('error', onClose);

    return stream;
  }

  /**
   * Single place where a listener leaves a broadcast. Idempotent via a flag on
   * the stream itself, so `releaseGuildStream` and the stream's own 'close'
   * event cannot double-decrement.
   */
  _detachStream(entry, stream) {
    if (stream.__hubReleased) return;
    stream.__hubReleased = true;

    entry.listeners.delete(stream);
    if (entry.refCount > 0) {
      entry.refCount -= 1;
      if (entry.refCount === 0) this._scheduleIdle(entry);
    }
  }

  /**
   * Safe to call twice, and safe regardless of whether the entry for `url`
   * still exists (M5) — idempotency is tracked on the stream itself, not on
   * map membership.
   */
  releaseGuildStream(url, stream) {
    if (!stream) return;

    const entry = this.broadcasts.get(url);
    if (entry) this._detachStream(entry, stream);
    else stream.__hubReleased = true; // entry already gone; don't let 'close' re-run

    if (!stream.destroyed) {
      try { stream.destroy(); } catch (_) {}
    }
  }

  /** Immediate teardown: end+destroy listeners, kill upstream, drop the entry. */
  cleanup(url) {
    const entry = this.broadcasts.get(url);
    if (!entry) return;

    entry.state = 'stopped';
    this._clearAllTimers(entry);

    for (const s of entry.listeners) {
      try { s.end(); } catch (_) {}
      try { s.destroy(); } catch (_) {}
    }
    entry.listeners.clear();

    if (entry.handle) {
      try { entry.handle.destroy(); } catch (_) {}
      entry.handle = null;
    }

    this.broadcasts.delete(url);
    this._emit('broadcast:stop', { url });
  }

  getState(url) {
    const entry = this.broadcasts.get(url);
    return entry ? entry.state : null;
  }

  /** Richer than the AudioSource-facing shape — includes startedAt for /health. */
  getStats() {
    const broadcasts = [];
    let activeBroadcasts = 0;
    let totalListeners = 0;

    for (const [url, entry] of this.broadcasts) {
      if (entry.state === 'active') activeBroadcasts++;
      totalListeners += entry.listeners.size;
      broadcasts.push({
        url,
        state: entry.state,
        listeners: entry.listeners.size,
        lastDataAgeMs: entry.lastDataAt ? Date.now() - entry.lastDataAt : null,
        ffmpegPid: entry.handle ? entry.handle.pid : null,
        attempts: entry.attempts,
        startedAt: entry.startedAt,
      });
    }

    const connectionCounts = broadcasts.map((b) => ({ url: b.url, count: b.listeners }));
    return { activeBroadcasts, totalListeners, broadcasts, connectionCounts };
  }

  async destroy() {
    for (const url of Array.from(this.broadcasts.keys())) this.cleanup(url);
    this.inFlight.clear();
    if (typeof this.provider.destroy === 'function') {
      await this.provider.destroy();
    }
  }

  // ─── Internal: start / reconnect ───────────────────────────────────────

  async _start(url) {
    let entry = this.broadcasts.get(url);
    if (!entry) {
      entry = this._createEntry(url);
      this.broadcasts.set(url, entry);
    } else {
      this._clearRetryTimer(entry);
      this._clearFailedRetryTimer(entry);
    }

    try {
      const handle = await this.provider.open(url);
      this._onOpened(entry, handle);
      return entry;
    } catch (err) {
      this._log('error', `[AudioHub] open failed for ${url}: ${err.message}`);
      // Keep the entry and start the retry policy even though refCount is
      // still 0 — on a first open nobody has attached yet (createGuildStream
      // runs only after getOrCreate resolves), but the guild that asked IS
      // waiting with its voice connection held. Dropping the entry here would
      // leave no retry timer and no event to resume from, so a station that is
      // down at join time would stay silent forever.
      // The idle timer is the bounded give-up: if no listener attaches within
      // idleMs, cleanup() stops the retries.
      this._scheduleRetry(entry);
      if (entry.refCount === 0) this._scheduleIdle(entry);
      throw err;
    }
  }

  /** Used by retry/failedRetry timers — never throws, feeds the backoff policy. */
  async _reconnect(entry) {
    if (entry.state === 'stopped' || !this.broadcasts.has(entry.url)) return;
    // Deliberately no `refCount === 0 -> cleanup` short-circuit: a guild
    // waiting for a station that was down at join time has refCount 0 until
    // the station actually serves. Giving up is the idle timer's job.
    try {
      const handle = await this.provider.open(entry.url);
      this._onOpened(entry, handle);
    } catch (err) {
      this._log('warn', `[AudioHub] reconnect failed for ${entry.url}: ${err.message}`);
      this._scheduleRetry(entry);
    }
  }

  _onOpened(entry, handle) {
    this._clearRetryTimer(entry);
    this._clearFailedRetryTimer(entry);

    // 'stalled' counts as recovering too, not just 'failed': the retry chain
    // sets 'stalled' for the first maxAttempts tries, and a guild waiting on
    // those needs the same resume signal it would get after a full failure.
    const wasRecovering = entry.state === 'failed' || entry.state === 'stalled';

    entry.handle = handle;
    entry.state = 'active';
    entry.attempts = 0;
    entry.startedAt = Date.now();
    entry.lastDataAt = Date.now();
    entry.headerDone = false;
    entry.headerBuf = Buffer.alloc(0);
    // entry.oggHeader deliberately NOT cleared here — existing listeners
    // already have it; new joiners wait for the fresh capture below.

    const onData = (chunk) => this._onData(entry, chunk);
    const onDrop = () => this._handleDrop(entry);

    handle.stream.on('data', onData);
    handle.stream.once('error', onDrop);
    handle.stream.once('end', onDrop);

    this._startWatchdog(entry);

    if (wasRecovering) this._emit('broadcast:recovered', { url: entry.url });
  }

  _onData(entry, chunk) {
    entry.lastDataAt = Date.now();

    if (!entry.headerDone) {
      entry.headerBuf = Buffer.concat([entry.headerBuf, chunk]);
      const headerEnd = findOggHeaderEnd(entry.headerBuf);
      if (headerEnd !== -1) {
        entry.oggHeader = entry.headerBuf.slice(0, headerEnd);
        entry.headerDone = true;
        const fullBuf = entry.headerBuf;
        entry.headerBuf = null;
        for (const s of entry.listeners) {
          if (!s.destroyed) s.write(fullBuf);
        }
        this._emit('broadcast:start', { url: entry.url });
      }
      return;
    }

    for (const stream of entry.listeners) {
      if (stream.destroyed) { entry.listeners.delete(stream); continue; }
      if (stream.writableLength > 65_536) continue; // live radio — drop, don't buffer
      stream.write(chunk);
    }
  }

  _handleDrop(entry) {
    if (!entry.handle) return; // already being handled
    this._clearWatchdogTimer(entry);

    const handle = entry.handle;
    entry.handle = null;
    try { handle.destroy(); } catch (_) {}

    if (entry.refCount === 0) {
      this.cleanup(entry.url);
      return;
    }

    this._scheduleRetry(entry);
  }

  _scheduleRetry(entry) {
    entry.attempts += 1;

    if (entry.attempts > this.maxAttempts) {
      entry.state = 'failed';
      // §I3/C1: end every listener so the downstream player goes Idle.
      for (const s of entry.listeners) {
        try { s.end(); } catch (_) {}
      }
      entry.listeners.clear();
      this._emit('broadcast:failed', { url: entry.url, attempts: entry.attempts });
      this._scheduleFailedRetry(entry);
      return;
    }

    entry.state = 'stalled';
    const delayMs = this._backoffDelay(entry.attempts);
    this._emit('broadcast:reconnect', { url: entry.url, attempt: entry.attempts, delayMs });
    entry.retryTimer = setTimeout(() => this._reconnect(entry), delayMs);
  }

  _scheduleFailedRetry(entry) {
    this._clearFailedRetryTimer(entry);
    entry.failedRetryTimer = setTimeout(() => this._reconnect(entry), this.failedRetryMs);
  }

  _backoffDelay(attempt) {
    const expCap = Math.min(this.retryCapMs, this.retryFloorMs * 2 ** (attempt - 1));
    const delay = this.retryFloorMs + Math.random() * (expCap - this.retryFloorMs);
    return Math.round(Math.min(this.retryCapMs, Math.max(this.retryFloorMs, delay)));
  }

  _startWatchdog(entry) {
    this._clearWatchdogTimer(entry);
    const interval = Math.max(1000, Math.min(this.stallMs, 5000));
    entry.watchdogTimer = setInterval(() => {
      if (entry.state !== 'active' && entry.state !== 'stalled') return;
      if (entry.lastDataAt && Date.now() - entry.lastDataAt > this.stallMs) {
        this._emit('broadcast:stall', { url: entry.url, lastDataAgeMs: Date.now() - entry.lastDataAt });
        this._handleDrop(entry);
      }
    }, interval);
  }

  _scheduleIdle(entry) {
    this._clearIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      if (entry.refCount === 0) this.cleanup(entry.url);
    }, this.idleMs);
  }

  // ─── Internal: bookkeeping ──────────────────────────────────────────────

  _createEntry(url) {
    return {
      url,
      state: 'starting',
      handle: null,
      listeners: new Set(),
      refCount: 0,
      oggHeader: null,
      headerBuf: Buffer.alloc(0),
      headerDone: false,
      lastDataAt: null,
      attempts: 0,
      startedAt: null,
      watchdogTimer: null,
      retryTimer: null,
      idleTimer: null,
      failedRetryTimer: null,
    };
  }

  _clearWatchdogTimer(entry) {
    if (entry.watchdogTimer) { clearInterval(entry.watchdogTimer); entry.watchdogTimer = null; }
  }
  _clearRetryTimer(entry) {
    if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = null; }
  }
  _clearFailedRetryTimer(entry) {
    if (entry.failedRetryTimer) { clearTimeout(entry.failedRetryTimer); entry.failedRetryTimer = null; }
  }
  _clearIdleTimer(entry) {
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
  }
  _clearAllTimers(entry) {
    this._clearWatchdogTimer(entry);
    this._clearRetryTimer(entry);
    this._clearFailedRetryTimer(entry);
    this._clearIdleTimer(entry);
  }

  _emit(event, detail) {
    try { this.emit(event, detail); } catch (_) { /* never throw into the hub */ }
  }

  _log(level, msg) {
    const fn = this.logger && this.logger[level];
    if (typeof fn === 'function') fn.call(this.logger, msg);
    else console.log(msg);
  }
}

module.exports = BroadcastHub;
