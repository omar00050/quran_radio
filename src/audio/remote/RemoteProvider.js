const axios = require('axios');

/**
 * RemoteProvider — UpstreamProvider implementation (contract §3) that pulls
 * OGG/Opus bytes from the standalone audio server over HTTP instead of
 * spawning ffmpeg locally. One HTTP connection per station per shard; the
 * BroadcastHub above this dedups by url, so this file never opens more than
 * one upstream per url and never opens one per guild.
 *
 * Never require ffmpeg-static or spawn a child process here — that is the
 * whole point of remote mode.
 */
class RemoteProvider {
  /**
   * @param {object} opts
   * @param {string} opts.serverUrl   e.g. http://127.0.0.1:3040
   * @param {string} [opts.token]     bearer token
   * @param {object} [opts.logger]    pino logger; falls back to console
   */
  constructor(opts = {}) {
    this.kind = 'remote';
    this.serverUrl = String(opts.serverUrl || 'http://127.0.0.1:3040').replace(/\/+$/, '');
    this.token = opts.token;
    this.logger = opts.logger || console;
  }

  /**
   * Opens a single HTTP streaming connection to the audio server for `url`.
   * Resolves once the response is committed (headers received, 2xx).
   * Never retries — the hub owns retry/backoff (contract §3).
   * @param {string} url
   * @returns {Promise<{stream: import('stream').Readable, destroy: () => void, pid: null}>}
   */
  async open(url) {
    const controller = new AbortController();
    let settled = false;

    let response;
    try {
      response = await axios.get(`${this.serverUrl}/stream`, {
        params: { url },
        responseType: 'stream',
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined,
        signal: controller.signal,
        validateStatus: () => true,
      });
    } catch (err) {
      // Network-level failure (connection refused, DNS, timeout, abort, etc).
      const reason = err?.code || err?.message || 'unknown error';
      throw new Error(`[RemoteProvider] failed to reach audio server at ${this.serverUrl} for ${url}: ${reason}`);
    }

    if (response.status === 401) {
      controller.abort();
      throw new Error(`[RemoteProvider] audio server rejected request for ${url}: 401 bad/missing token (config error — will not self-heal via retry)`);
    }
    if (response.status === 403) {
      controller.abort();
      throw new Error(`[RemoteProvider] audio server rejected request for ${url}: 403 url not allowlisted (config error — will not self-heal via retry)`);
    }
    if (response.status < 200 || response.status >= 300) {
      controller.abort();
      throw new Error(`[RemoteProvider] audio server returned HTTP ${response.status} for ${url}`);
    }

    const stream = response.data;

    const destroy = () => {
      if (settled) return;
      settled = true;
      try { controller.abort(); } catch (_) { /* ignore */ }
      try { stream?.destroy?.(); } catch (_) { /* ignore */ }
    };

    // Surface stream-level errors without throwing into the hub (contract §2.4).
    stream.on('error', (err) => {
      this.logger?.warn?.(`[RemoteProvider] upstream stream error for ${url}: ${err?.message || err}`);
    });

    return { stream, destroy, pid: null };
  }

  /**
   * No persistent resources owned at the provider level beyond per-open
   * handles (which the hub destroys via the returned `destroy`), so this is
   * a no-op kept for interface symmetry with EmbeddedProvider.
   */
  async destroy() {
    // Intentionally empty — see class doc comment.
  }
}

module.exports = RemoteProvider;
