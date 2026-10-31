'use strict';

const AudioSource = require('./AudioSource');
const EmbeddedProvider = require('./providers/EmbeddedProvider');

/**
 * Factory — always construct a fresh AudioSource per caller (bot client,
 * audio-server), never cache one at module scope (that's what let `/refresh`
 * orphan ffmpeg children in the old code — see docs/audio-source-contract.md §2).
 *
 * @param {object} opts
 * @param {'embedded'|'remote'} [opts.mode]  default 'embedded'
 * @param {string}  [opts.serverUrl]         AUDIO_SERVER_URL      (remote only)
 * @param {string}  [opts.token]             AUDIO_SERVER_TOKEN    (remote only)
 * @param {string}  [opts.bitrate]           AUDIO_BITRATE, default '128k' (embedded only)
 * @param {number}  [opts.idleMs]            stop a station after this long with 0 listeners
 * @param {number}  [opts.stallMs]           no data for this long => treat as dropped
 * @param {number}  [opts.maxAttempts]       consecutive reconnect attempts before 'failed'
 * @param {number}  [opts.failedRetryMs]     periodic retry cadence once 'failed'
 * @param {object}  [opts.logger]            pino logger; falls back to console
 * @returns {AudioSource}
 */
function createAudioSource(opts = {}) {
  const mode = opts.mode === 'remote' ? 'remote' : 'embedded';

  let provider;
  if (mode === 'remote') {
    // Lazy-required so embedded mode (the default, and audio-server.js)
    // never depends on Teammate B's file existing.
    const RemoteProvider = require('./remote/RemoteProvider');
    provider = new RemoteProvider({
      serverUrl: opts.serverUrl,
      token: opts.token,
      logger: opts.logger,
    });
  } else {
    provider = new EmbeddedProvider({
      bitrate: opts.bitrate,
      logger: opts.logger,
    });
  }

  return new AudioSource(mode, provider, opts);
}

module.exports = { createAudioSource };
