const axios  = require('axios');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');

/**
 * One HTTP connection + one FFmpeg per radio URL.
 * FFmpeg outputs OGG/Opus so Discord.js can consume it with StreamType.OggOpus
 * without needing any native Opus encoder library.
 *
 * OGG Opus header pages are captured and replayed for every guild that joins
 * mid-stream, so they can always decode the stream correctly.
 */
class AudioBroadcaster {
  constructor() {
    /** @type {Map<string, BroadcastEntry>} */
    this.broadcasts = new Map();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async getOrCreate(url) {
    const existing = this.broadcasts.get(url);
    if (existing?.active) return existing;
    return this._start(url);
  }

  /**
   * Returns a PassThrough stream that receives OGG/Opus data from the broadcast.
   * The OGG header is written first so the guild can always decode the stream.
   */
  createGuildStream(url) {
    const entry = this.broadcasts.get(url);
    if (!entry?.active) return null;

    const stream = new PassThrough({ highWaterMark: 0 });

    // Replay captured OGG header pages so the new guild can sync immediately
    if (entry.oggHeader) stream.write(entry.oggHeader);

    entry.listeners.add(stream);

    const cleanup = () => entry.listeners.delete(stream);
    stream.once('close', cleanup);
    stream.once('error', cleanup);

    return stream;
  }

  releaseGuildStream(url, stream) {
    if (!stream) return;
    const entry = this.broadcasts.get(url);
    if (entry) entry.listeners.delete(stream);
    if (!stream.destroyed) { try { stream.destroy(); } catch (_) {} }
  }

  cleanup(url) {
    const entry = this.broadcasts.get(url);
    if (!entry) return;
    entry.listeners.forEach(s => { try { s.destroy(); } catch (_) {} });
    entry.listeners.clear();
    this._destroyEntry(entry);
    this.broadcasts.delete(url);
  }

  getStats() {
    const result = { activeBroadcasts: 0, connectionCounts: [] };
    for (const [url, entry] of this.broadcasts) {
      if (entry.active) {
        result.activeBroadcasts++;
        result.connectionCounts.push({ url, count: entry.listeners.size });
      }
    }
    return result;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  async _start(url) {
    const old = this.broadcasts.get(url);
    const survivors = old ? new Set(old.listeners) : new Set();
    if (old) this._destroyEntry(old);

    let response;
    try {
      response = await axios.get(url, { responseType: 'stream', timeout: 15_000 });
    } catch (err) {
      console.error(`[Broadcaster] HTTP error for ${url}:`, err.message);
      throw err;
    }

    const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';

    // Output OGG/Opus — no Opus encoder library needed on the Node side.
    // StreamType.OggOpus in @discordjs/voice demuxes OGG in pure JS.
    const ffmpeg = spawn(ffmpegBin, [
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', '128k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'ogg',
      '-loglevel', 'error',
      'pipe:1',
    ]);

    /** @type {BroadcastEntry} */
    const entry = {
      active:      true,
      ffmpeg,
      source:      response.data,
      listeners:   survivors,
      oggHeader:   null,   // captured OGG header pages (OpusHead + OpusTags)
      _headerBuf:  Buffer.alloc(0),
      _headerDone: false,
    };

    this.broadcasts.set(url, entry);
    response.data.pipe(ffmpeg.stdin);

    ffmpeg.stdout.on('data', (chunk) => {
      // ── Phase 1: capture OGG header (first 2 pages: OpusHead + OpusTags) ──
      if (!entry._headerDone) {
        entry._headerBuf = Buffer.concat([entry._headerBuf, chunk]);
        const headerEnd = this._findOggHeaderEnd(entry._headerBuf);
        if (headerEnd !== -1) {
          entry.oggHeader   = entry._headerBuf.slice(0, headerEnd);
          entry._headerDone = true;
          // Replay full header + remainder for survivors that were already listening
          for (const s of entry.listeners) {
            if (!s.destroyed) s.write(entry._headerBuf);
          }
          delete entry._headerBuf; // free memory
        }
        // Don't push to listeners until header is captured
        return;
      }

      // ── Phase 2: distribute live OGG data — drop slow consumers ──────────
      for (const stream of entry.listeners) {
        if (stream.destroyed) { entry.listeners.delete(stream); continue; }
        if (stream.writableLength > 65_536) continue; // drop — live radio, skip > 64KB lag
        stream.write(chunk);
      }
    });

    const onDrop = () => {
      if (!entry.active) return;
      console.log(`[Broadcaster] Stream dropped for ${url} — reconnecting in 3s...`);
      this._destroyEntry(entry);
      setTimeout(() => this._start(url).catch(err => {
        console.error(`[Broadcaster] Reconnect failed:`, err.message);
        setTimeout(() => this._start(url).catch(() => {}), 5_000);
      }), 3_000);
    };

    ffmpeg.on('close', onDrop);
    response.data.on('error', onDrop);
    ffmpeg.stdin.on('error', () => {}); // ignore stdin broken pipe
    ffmpeg.stderr.on('data', d => {
      const msg = d.toString().trim();
      if (msg) console.error(`[FFmpeg] ${msg}`);
    });

    console.log(`[Broadcaster] Started broadcast for: ${url} (${entry.listeners.size} guilds restored)`);
    return entry;
  }

  /**
   * Finds the byte offset where the 3rd OGG page begins (= end of header).
   * OGG Opus always has exactly 2 header pages: OpusHead and OpusTags.
   * Returns -1 if not enough data yet.
   */
  _findOggHeaderEnd(buf) {
    const magic = Buffer.from('OggS');
    let count = 0;
    let pos = 0;
    while (pos < buf.length) {
      const idx = buf.indexOf(magic, pos);
      if (idx === -1) return -1;
      count++;
      if (count === 3) return idx; // 3rd page = first audio page
      pos = idx + 4;
    }
    return -1;
  }

  _destroyEntry(entry) {
    entry.active = false;
    try { entry.source?.destroy(); }  catch (_) {}
    try { entry.ffmpeg?.kill('SIGKILL'); } catch (_) {}
  }
}

module.exports = AudioBroadcaster;
