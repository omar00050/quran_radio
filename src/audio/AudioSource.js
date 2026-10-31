'use strict';

const EventEmitter = require('events');
const BroadcastHub = require('./BroadcastHub');

const FORWARDED_EVENTS = [
  'broadcast:start',
  'broadcast:stall',
  'broadcast:reconnect',
  'broadcast:failed',
  'broadcast:recovered',
  'broadcast:stop',
];

/**
 * Public surface handed to the rest of the codebase as `client.audio`
 * (and consumed directly by `audio-server.js`). Never module scope — each
 * instance owns its own BroadcastHub/provider so `/refresh` can't orphan
 * ffmpeg children by re-requiring this file.
 */
class AudioSource extends EventEmitter {
  /**
   * @param {'embedded'|'remote'} mode
   * @param {object} provider  UpstreamProvider (§3 of the contract)
   * @param {object} [opts]
   */
  constructor(mode, provider, opts = {}) {
    super();
    this._mode = mode;
    this.logger = opts.logger || console;

    this.hub = new BroadcastHub(provider, {
      idleMs: opts.idleMs,
      stallMs: opts.stallMs,
      maxAttempts: opts.maxAttempts,
      failedRetryMs: opts.failedRetryMs,
      retryFloorMs: opts.retryFloorMs,
      retryCapMs: opts.retryCapMs,
      logger: this.logger,
    });

    for (const evt of FORWARDED_EVENTS) {
      this.hub.on(evt, (detail) => this._emit(evt, detail));
    }

    // Populated by the remote-mode provider/bot wiring (Teammate B) via
    // setAudioServerStatus(); stays null/false here in embedded mode.
    this._audioServerStatus = {
      configured: mode === 'remote',
      reachable: mode === 'remote' ? false : null,
      url: opts.serverUrl || null,
      consecutiveFailures: 0,
      lastCheckAt: null,
    };
  }

  get mode() {
    return this._mode;
  }

  async getOrCreate(url) {
    return this.hub.getOrCreate(url);
  }

  createGuildStream(url) {
    return this.hub.createGuildStream(url);
  }

  releaseGuildStream(url, stream) {
    return this.hub.releaseGuildStream(url, stream);
  }

  cleanup(url) {
    return this.hub.cleanup(url);
  }

  /** Current lifecycle state for `url` ('starting'|'active'|'stalled'|'failed'|'stopped'|null). */
  getState(url) {
    return this.hub.getState(url);
  }

  /** §5 of the contract — fixed shape, consumed by liveSocket.js / status_bot.js. */
  getStats() {
    const hubStats = this.hub.getStats();
    return {
      mode: this._mode,
      activeBroadcasts: hubStats.activeBroadcasts,
      totalListeners: hubStats.totalListeners,
      broadcasts: hubStats.broadcasts.map(({ url, state, listeners, lastDataAgeMs, ffmpegPid, attempts }) => ({
        url, state, listeners, lastDataAgeMs, ffmpegPid, attempts,
      })),
      audioServer: { ...this._audioServerStatus },
      connectionCounts: hubStats.connectionCounts,
    };
  }

  /** Lets remote-mode wiring (Teammate B) report audio-server reachability. */
  setAudioServerStatus(partial) {
    Object.assign(this._audioServerStatus, partial);
  }

  async destroy() {
    await this.hub.destroy();
  }

  _emit(event, detail) {
    try { this.emit(event, detail); } catch (_) { /* emit-only, never throw */ }
  }
}

module.exports = AudioSource;
