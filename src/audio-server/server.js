'use strict';

const http = require('http');
const { URL } = require('url');

const { createAudioSource } = require('../audio/index.js');
const RadioChannels = require('../utils/helpers/RadioChannels.js');
const { buildAllowlist, isAllowed } = require('./allowlist');
const { checkAuth } = require('./auth');
const { buildHealthPayload } = require('./health');

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Standalone audio-server HTTP surface (contract §4). Binds 127.0.0.1 only.
 * Every request — /health included — requires the bearer token.
 */
function createServer(opts = {}) {
  const logger = opts.logger || console;
  const port = Number(process.env.AUDIO_SERVER_PORT) || 3040;
  const token = process.env.AUDIO_SERVER_TOKEN;
  const idleMs = Number(process.env.AUDIO_STATION_IDLE_MS) || 600_000;
  const bitrate = process.env.AUDIO_BITRATE || '128k';

  if (!token || token === 'change_me') {
    const msg = '[audio-server] AUDIO_SERVER_TOKEN is unset or still "change_me" — ' +
      'set a real secret before exposing this port beyond localhost.';
    if (typeof logger.warn === 'function') logger.warn(msg); else console.warn(msg);
  }

  const allowlist = buildAllowlist(RadioChannels, process.env.RadioAudioUrl);

  const audioSource = createAudioSource({
    mode: 'embedded',
    bitrate,
    idleMs,
    logger,
  });

  const startedAt = Date.now();

  const httpServer = http.createServer(async (req, res) => {
    let parsed;
    try {
      parsed = new URL(req.url, `http://127.0.0.1:${port}`);
    } catch (_) {
      sendJson(res, 400, { error: 'bad_request' });
      return;
    }

    if (!checkAuth(req, token)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/health') {
      sendJson(res, 200, buildHealthPayload(audioSource, allowlist, startedAt));
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/stations') {
      sendJson(res, 200, allowlist.entries.map((e) => ({ url: e.url, name: e.name })));
      return;
    }

    if (req.method === 'GET' && parsed.pathname === '/stream') {
      const url = parsed.searchParams.get('url');
      if (!isAllowed(allowlist, url)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
      }

      // Don't storm an already-dead station on every incoming request —
      // let the hub's periodic failedRetryMs timer own recovery for it.
      if (audioSource.getState(url) === 'failed') {
        sendJson(res, 503, { error: 'failed' });
        return;
      }

      try {
        await audioSource.getOrCreate(url);
      } catch (err) {
        sendJson(res, 503, { error: 'unavailable' });
        return;
      }

      if (audioSource.getState(url) === 'failed') {
        sendJson(res, 503, { error: 'failed' });
        return;
      }

      const stream = audioSource.createGuildStream(url);
      if (!stream) {
        sendJson(res, 503, { error: 'not_ready' });
        return;
      }

      res.writeHead(200, { 'content-type': 'audio/ogg', 'transfer-encoding': 'chunked' });

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        audioSource.releaseGuildStream(url, stream);
      };

      req.on('close', release);
      res.on('close', release);
      stream.on('error', () => { try { res.end(); } catch (_) {} release(); });
      stream.on('end', release);
      stream.pipe(res);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  });

  httpServer.listen(port, '127.0.0.1', () => {
    const msg = `[audio-server] listening on 127.0.0.1:${port} (bitrate=${bitrate}, idleMs=${idleMs})`;
    if (typeof logger.info === 'function') logger.info(msg); else console.log(msg);
  });

  async function close() {
    await new Promise((resolve) => httpServer.close(resolve));
    await audioSource.destroy();
  }

  return { server: httpServer, audioSource, close };
}

module.exports = { createServer };
