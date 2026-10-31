'use strict';

const axios = require('axios');
const { spawn } = require('child_process');

/**
 * UpstreamProvider (embedded, §3 of the contract): one axios HTTP connection
 * piped into one ffmpeg per station. ffmpeg outputs OGG/Opus on stdout so
 * `StreamType.OggOpus` demuxes it in pure JS with no native Opus encoder.
 *
 * Carries no retry logic itself (§3 rule: "Do not retry. Reject and let the
 * hub schedule.") and never emits 'end' on success-but-silent — the hub's
 * stall watchdog is what notices a quiet-but-still-open connection.
 */
class EmbeddedProvider {
  constructor(opts = {}) {
    this.kind = 'embedded';
    this.bitrate = opts.bitrate || '128k';
    this.logger = opts.logger || console;
    this.ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg';
  }

  async open(url) {
    let response;
    try {
      response = await axios.get(url, { responseType: 'stream', timeout: 15_000 });
    } catch (err) {
      throw new Error(`HTTP error for ${url}: ${err.message}`);
    }

    const ffmpeg = spawn(this.ffmpegBin, [
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', this.bitrate,
      '-ar', '48000',
      '-ac', '2',
      '-f', 'ogg',
      '-loglevel', 'error',
      'pipe:1',
    ]);

    response.data.pipe(ffmpeg.stdin);
    ffmpeg.stdin.on('error', () => {}); // ignore broken pipe when we tear down first
    ffmpeg.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) this._log('error', `[ffmpeg ${ffmpeg.pid}] ${msg}`);
    });

    let destroyed = false;
    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      try { response.data.unpipe(ffmpeg.stdin); } catch (_) {}
      try { response.data.destroy(); } catch (_) {}
      try { ffmpeg.stdin.destroy(); } catch (_) {}
      try { ffmpeg.kill('SIGKILL'); } catch (_) {}
    };

    // Fold every failure mode (source HTTP error/close, ffmpeg exit, ffmpeg
    // error) into a single 'end' on stdout — BroadcastHub's drop handling
    // only needs to listen once, to one stream, for the "connection is gone"
    // signal; a silent-but-open connection is caught separately by the
    // hub's lastDataAt watchdog, not by anything here.
    const stdout = ffmpeg.stdout;
    const forwardEnd = () => { try { stdout.emit('end'); } catch (_) {} };
    response.data.once('error', forwardEnd);
    response.data.once('close', forwardEnd);
    ffmpeg.once('close', forwardEnd);
    ffmpeg.once('error', forwardEnd);

    return { stream: stdout, destroy, pid: ffmpeg.pid };
  }

  _log(level, msg) {
    const fn = this.logger && this.logger[level];
    if (typeof fn === 'function') fn.call(this.logger, msg);
    else console.log(msg);
  }
}

module.exports = EmbeddedProvider;
