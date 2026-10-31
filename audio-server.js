// Standalone audio server — one ffmpeg per station PER HOST instead of per
// shard. Run with `node audio-server.js`. Never run with the production bot
// token; this process has nothing to do with Discord.
require('module-alias/register');

// Load .env from the repo root explicitly, NOT relative to process.cwd().
// dotenv's default resolves against the cwd, and pm2 does not set one unless
// told to — so starting the server from anywhere else silently loaded zero
// variables ("injecting env (0) from .env"), leaving AUDIO_SERVER_TOKEN unset
// and AUDIO_BITRATE at its default while the bot used the real values. Every
// request from the bot would then 401. ecosystem.config.js also pins `cwd`,
// but this makes the script correct on its own.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// index.js does this for the bot; the audio server has to do it for itself or
// EmbeddedProvider falls back to bare 'ffmpeg' on PATH, which is precisely
// what depending on ffmpeg-static is meant to avoid. An explicit FFMPEG_PATH
// in the environment still wins (e.g. a distro build pinned in a container).
if (!process.env.FFMPEG_PATH) {
  try {
    process.env.FFMPEG_PATH = require('ffmpeg-static');
  } catch (_) {
    // Not installed — EmbeddedProvider will try 'ffmpeg' from PATH and the
    // station will land in 'failed' with a clear spawn error if it isn't there.
  }
}

let logger;
try {
  // Needs module-alias registered first, like index.js does.
  logger = require('@helpers/logger');
} catch (_) {
  logger = console;
}

const { createServer } = require('./src/audio-server/server');

const { close } = createServer({ logger });

function shutdown(signal) {
  const msg = `[audio-server] received ${signal}, shutting down`;
  if (typeof logger.info === 'function') logger.info(msg); else console.log(msg);

  close()
    .then(() => process.exit(0))
    .catch((err) => {
      if (typeof logger.error === 'function') logger.error(err);
      else console.error(err);
      process.exit(1);
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
