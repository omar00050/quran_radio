require("dotenv").config();

const { createServer } = require('http');
const { Server }       = require('socket.io');
const fs               = require('fs');
const path             = require('path');

const STATUS_FILE   = path.join(__dirname, './../../database/liveStatus.json');
const RadioChannels = require('../utils/helpers/RadioChannels');

let _io          = null;
let _latestStats = null;
let _audioHealthLogState = null;

const AUDIO_HEALTH_TIMEOUT_MS = 3_000;

// ── Restore last persisted stats so the dashboard gets data immediately ──
try {
  if (!fs.existsSync(STATUS_FILE)) fs.writeFileSync(STATUS_FILE, JSON.stringify({}));
  _latestStats = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
} catch (_) {}

/** Resolve a stream URL to a human-readable station name. */
function _stationName(url) {
  return RadioChannels.find(r => r.value === url)?.name ?? url;
}

/**
 * Builds the manager-owned status block. Reachability, last response and
 * failure count survive across collect cycles via the last emitted stats,
 * so a transient health failure does not erase them.
 */
function _baseAudioStatus(shardStatus) {
  const previous = _latestStats?.audioServer ?? null;
  return {
    configured:      shardStatus?.configured ?? previous?.configured ?? true,
    reachable:       previous?.reachable ?? shardStatus?.reachable ?? null,
    url:             shardStatus?.url ?? previous?.url ?? null,
    consecutiveFailures: previous?.consecutiveFailures ?? shardStatus?.consecutiveFailures ?? 0,
    lastCheckAt:     previous?.lastCheckAt ?? shardStatus?.lastCheckAt ?? null,
    ...(previous?.health ? { health: previous.health } : {}),
  };
}

/**
 * Polls the standalone audio server's /health once per collect cycle. The
 * shards only know the static `_audioServerStatus` stub (nothing calls
 * setAudioServerStatus), so the manager is the one place that can report
 * real reachability and per-station health to the dashboard.
 */
async function _collectAudioServerStatus(shardStatus) {
  const base = _baseAudioStatus(shardStatus);
  if (typeof fetch !== 'function') return base;

  const url = (base.url || process.env.AUDIO_SERVER_URL || 'http://127.0.0.1:3040')
    .replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUDIO_HEALTH_TIMEOUT_MS);

  try {
    const headers = { accept: 'application/json' };
    if (process.env.AUDIO_SERVER_TOKEN) {
      headers.authorization = `Bearer ${process.env.AUDIO_SERVER_TOKEN}`;
    }

    const res = await fetch(`${url}/health`, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const health = await res.json();
    const checkedAt = Date.now();

    if (_audioHealthLogState !== true) {
      console.log(`[LiveSocket] Audio server health reachable at ${url}`);
      _audioHealthLogState = true;
    }

    return {
      ...base,
      configured: true,
      reachable: true,
      url,
      consecutiveFailures: 0,
      lastCheckAt: checkedAt,
      health: {
        ok:               health?.ok !== false,
        uptimeSec:        typeof health?.uptimeSec === 'number' ? health.uptimeSec : null,
        stations:         Array.isArray(health?.stations) ? health.stations : [],
        totals:           health?.totals ?? null,
        checkedAt,
      },
    };
  } catch (err) {
    const failures = (base.consecutiveFailures ?? 0) + 1;
    if (_audioHealthLogState !== false) {
      console.warn(`[LiveSocket] Audio server health check failed (${url}): ${err.message}`);
      _audioHealthLogState = false;
    }
    return {
      ...base,
      configured: true,
      reachable: false,
      url,
      consecutiveFailures: failures,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start the Socket.io live-status server.
 * @param {import('discord.js').ShardingManager} manager
 * @param {number} [port]
 */
function startLiveSocket(manager, port = Number(process.env.SOCKET_PORT) || 3030) {
  const http = createServer();

  _io = new Server(http, {
    cors: {
      origin: process.env.DASHBOARD_ORIGIN || '*',
      methods: ['GET', 'HEAD'],
    },
  });

  _io.on('connection', (socket) => {
    console.log('[LiveSocket] Dashboard client connected');
    if (_latestStats) socket.emit('stats', _latestStats);

    // ── Guild lookup ─────────────────────────────────────────────────────
    // Dashboard emits: socket.emit('lookup_guild', guildId, callback)
    socket.on('lookup_guild', async (guildId, callback) => {
      if (typeof callback !== 'function') return;
      if (!guildId || typeof guildId !== 'string') return callback({ found: false });

      try {
        const results = await manager.broadcastEval(
          (c, { id }) => {
            const guild = c.guilds.cache.get(id);
            if (!guild) return null;
            return {
              found:       true,
              shardId:     c.shard?.ids[0] ?? 0,
              id:          guild.id,
              name:        guild.name,
              memberCount: guild.memberCount,
              icon:        guild.iconURL({ size: 64 }) ?? null,
            };
          },
          { context: { id: guildId } }
        );

        const found = results.find(r => r !== null) ?? { found: false };
        callback(found);
      } catch (err) {
        console.error('[LiveSocket] lookup_guild error:', err.message);
        callback({ found: false });
      }
    });

    socket.on('request_refresh', () => {
      _collect(manager).catch(() => {});
    });

    socket.on('disconnect', () => {
      console.log('[LiveSocket] Dashboard client disconnected');
    });
  });

  http.listen(port, () => {
    console.log(`[LiveSocket] Socket.io running on port ${port}`);
  });

  setTimeout(() => _collect(manager).catch(() => {}), 8_000);
  setInterval(() => _collect(manager).catch((err) => {
    console.error('[LiveSocket] Collect error:', err.message);
  }), 10_000);

  return _io;
}

async function _collect(manager) {
  if (!manager.shards.size) return;

  const results = await manager.broadcastEval((c) => {
    // Count real human listeners per guild and per station URL.
    // guild.members.me.voice.channel.members gives the actual people in the
    // voice channel — 1 entry per person, not per guild stream.
    let shardListeners = 0;
    let idleRadio      = 0;
    const listenersByUrl = {};
    const guildsByUrl    = {};
    const idleByUrl      = {};

    for (const [guildId] of (c.Radio ?? new Map())) {
      const guild        = c.guilds.cache.get(guildId);
      const voiceChannel = guild?.members?.me?.voice?.channel;
      const url          = c.radioUrlCache?.get(guildId);
      if (!url) continue;

      guildsByUrl[url] = (guildsByUrl[url] ?? 0) + 1;

      if (!voiceChannel) continue;
      const humans = voiceChannel.members.filter(m => !m.user.bot).size;

      if (humans === 0) {
        idleRadio++;
        idleByUrl[url] = (idleByUrl[url] ?? 0) + 1;
      } else {
        shardListeners      += humans;
        listenersByUrl[url]  = (listenersByUrl[url] ?? 0) + humans;
      }
    }

    // Audio source stats — guarded with ?? null like the rest of this eval,
    // since client.audio may not exist on an older/partially-booted shard.
    const audioStats = c.audio?.getStats?.() ?? null;

    return {
      guilds:          c.guilds.cache.size,
      users:           c.guilds.cache.reduce((a, b) => a + b.memberCount, 0),
      radio:           c.Radio?.size   ?? 0,
      azkar:           c.Azkar?.size   ?? 0,
      adhan:           c.Adhan?.size   ?? 0,
      ping:            Math.round(c.ws.ping),
      uptime:          Math.round(process.uptime()),
      shardListeners,
      idleRadio,
      listenersByUrl,
      guildsByUrl,
      idleByUrl,
      audioMode:            audioStats?.mode ?? null,
      audioActiveBroadcasts: audioStats?.activeBroadcasts ?? 0,
      audioTotalListeners:   audioStats?.totalListeners ?? 0,
      audioServer:           audioStats?.audioServer ?? null,
    };
  });

  // ── Aggregate listener + guild counts by URL across all shards ───────
  const urlMap = new Map();
  for (const r of results) {
    for (const [url, count] of Object.entries(r.listenersByUrl ?? {})) {
      const e = urlMap.get(url) ?? { listeners: 0, guilds: 0, idle: 0 };
      e.listeners += count;
      urlMap.set(url, e);
    }
    for (const [url, count] of Object.entries(r.guildsByUrl ?? {})) {
      const e = urlMap.get(url) ?? { listeners: 0, guilds: 0, idle: 0 };
      e.guilds += count;
      urlMap.set(url, e);
    }
    for (const [url, count] of Object.entries(r.idleByUrl ?? {})) {
      const e = urlMap.get(url) ?? { listeners: 0, guilds: 0, idle: 0 };
      e.idle += count;
      urlMap.set(url, e);
    }
  }
  const broadcasts = [...urlMap.entries()]
    .map(([url, { listeners, guilds, idle }]) => ({
      url, name: _stationName(url), listeners, guilds, idle,
    }))
    .filter(b => b.guilds > 0)
    .sort((a, b) => b.listeners - a.listeners);

  const audioMode = results[0]?.audioMode ?? null;
  const shardAudioServer = results.find(r => r.audioServer)?.audioServer ?? null;
  const audioServer = audioMode === 'remote' || shardAudioServer?.configured === true
    ? await _collectAudioServerStatus(shardAudioServer)
    : shardAudioServer;

  const stats = {
    totalServers:     results.reduce((a, b) => a + b.guilds,  0),
    totalUsers:       results.reduce((a, b) => a + b.users,   0),
    activeRadio:      results.reduce((a, b) => a + b.radio,       0),
    idleRadio:        results.reduce((a, b) => a + b.idleRadio,   0),
    activeAzkar:      results.reduce((a, b) => a + b.azkar,   0),
    activeAdhan:      results.reduce((a, b) => a + b.adhan,   0),
    totalShards:      results.length,
    // Real listener stats (people in voice channels, not stream count)
    activeBroadcasts: broadcasts.length,
    totalListeners:   results.reduce((a, b) => a + (b.shardListeners ?? 0), 0),
    broadcasts,
    // Audio source aggregate — mode is process-wide (set once from env), so
    // any shard's value represents all of them. audioServer is refreshed by
    // the manager's /health poll in _collectAudioServerStatus().
    audioMode,
    audioActiveBroadcasts: results.reduce((a, b) => a + (b.audioActiveBroadcasts ?? 0), 0),
    audioTotalListeners:   results.reduce((a, b) => a + (b.audioTotalListeners ?? 0), 0),
    audioServer,
    shards: results.map((r, i) => ({
      id:     i,
      guilds: r.guilds,
      users:  r.users,
      ping:   r.ping,
      uptime: r.uptime,
      radio:  r.radio,
      azkar:  r.azkar,
      adhan:  r.adhan,
    })),
    updatedAt: Date.now(),
  };

  _latestStats = stats;
  fs.writeFileSync(STATUS_FILE, JSON.stringify(stats, null, 2));
  if (_io) _io.emit('stats', stats);
}

function getLatestStats() { return _latestStats; }

module.exports = { startLiveSocket, getLatestStats };
