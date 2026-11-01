require("dotenv").config();

const { createServer } = require('http');
const { Server }       = require('socket.io');
const fs               = require('fs');
const path             = require('path');
const crypto           = require('crypto');

const STATUS_FILE   = path.join(__dirname, './../../database/liveStatus.json');
const RadioChannels = require('../utils/helpers/RadioChannels');

let _io          = null;
let _latestStats = null;
let _audioHealthLogState = null;
/** Internal only: the audio server URL is never emitted. */
let _audioServerUrl = null;

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
  // `url` is intentionally absent from the returned object: it is internal.
  // It is carried between cycles in the module-local _audioServerUrl instead.
  _audioServerUrl = shardStatus?.url ?? _audioServerUrl ?? null;
  return {
    configured:      shardStatus?.configured ?? previous?.configured ?? true,
    reachable:       previous?.reachable ?? shardStatus?.reachable ?? null,
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

  const url = (_audioServerUrl || process.env.AUDIO_SERVER_URL || 'http://127.0.0.1:3040')
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

    _audioServerUrl = url;
    return {
      ...base,
      configured: true,
      reachable: true,
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
    _audioServerUrl = url;
    return {
      ...base,
      configured: true,
      reachable: false,
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
const SNAPSHOT_INTERVAL_MS = Number(process.env.STATS_SNAPSHOT_INTERVAL_MS) || 5 * 60 * 1000;

/**
 * ── Outbound sanitisation ──────────────────────────────────────────────────
 *
 * Everything below crosses the socket to a dashboard that anyone who can reach
 * the port may connect to. Nothing describing the host — paths, ports, internal
 * URLs, process ids, raw error text — is allowed through. Shaping it in one
 * place means a new field has to be added here deliberately before it can
 * escape.
 */

/** Stable, non-reversible handle for a station, for use as a UI key. */
function _stationId(url) {
  return crypto.createHash('sha1').update(String(url ?? '')).digest('hex').slice(0, 12);
}

/**
 * Station URLs are third-party endpoints, not internal, but at least one
 * carries a provider token in its query string (`?rj-tok=…`). The query is
 * stripped so no credential of any kind is published.
 */
function _publicStationUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.origin}${u.pathname}`;
  } catch (_) {
    return null;
  }
}

/** One station entry as the dashboard may see it. */
function _publicStation(station) {
  if (!station) return null;
  return {
    id:            _stationId(station.url),
    name:          station.name ?? _stationName(station.url),
    url:           _publicStationUrl(station.url),
    state:         station.state ?? null,
    listeners:     station.listeners ?? 0,
    guilds:        station.guilds ?? 0,
    idle:          station.idle ?? 0,
    lastDataAgeMs: station.lastDataAgeMs ?? null,
    attempts:      station.attempts ?? null,
    // ffmpegPid is deliberately dropped: a process id on the host is of no use
    // to a dashboard and is exactly the kind of internal detail that should
    // not be published.
  };
}

/** The audio-server block, with its internal URL removed. */
function _publicAudioServer(status) {
  if (!status) return null;
  const { url, health, ...rest } = status;
  return {
    ...rest,
    ...(health ? {
      health: {
        ok:        health.ok,
        uptimeSec: health.uptimeSec ?? null,
        totals:    health.totals ?? null,
        checkedAt: health.checkedAt ?? null,
        stations:  (health.stations ?? []).map(_publicStation).filter(Boolean),
      },
    } : {}),
  };
}

/** History results: strip raw station URLs, add a stable id. */
function _publicHistory(result) {
  if (!result || typeof result !== 'object') return result;
  if (!Array.isArray(result.stations)) return result;
  return {
    ...result,
    stations: result.stations.map((st) => ({
      id:            _stationId(st.url),
      name:          st.name ?? null,
      url:           _publicStationUrl(st.url),
      avgListeners:  st.avgListeners,
      peakListeners: st.peakListeners,
      avgGuilds:     st.avgGuilds,
    })),
  };
}

/** Stats store, injected by shard.js. Null when running without one. */
let _stats = null;

/**
 * Guilds per language, counted on one shard.
 *
 * Every shard shares the same database, so asking one is enough — and asking
 * only one avoids sixteen identical reads of the whole key space.
 */
async function _languageCounts(manager) {
  try {
    const [counts] = await manager.broadcastEval(async (c) => {
      const rows = await c.db.endsWith('_lang');
      const out = {};
      for (const value of Object.values(rows ?? {})) {
        const code = String(value ?? '').trim();
        if (code) out[code] = (out[code] ?? 0) + 1;
      }
      return out;
    }, { shard: 0 });
    return counts ?? {};
  } catch (_) {
    return {};
  }
}

function startLiveSocket(manager, port = Number(process.env.SOCKET_PORT) || 3030, statsStore = null) {
  _stats = statsStore;
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

    // Aggregated history for the statistics page. Totals and per-station
    // numbers only — never anything per guild or per user.
    socket.on('get_history', async (request, callback) => {
      if (typeof callback !== 'function') return;
      if (!_stats) return callback({ error: 'stats_unavailable' });

      try {
        const now = Date.now();
        const to = Number(request?.to) || now;
        const from = Number(request?.from) || (to - 24 * 60 * 60 * 1000);
        const metric = String(request?.metric ?? 'servers');

        if (!(to > from)) return callback({ error: 'bad_range' });
        // A year is the most that is retained, so refuse anything wider than
        // that rather than scanning the whole table for nothing.
        if (to - from > 400 * 24 * 60 * 60 * 1000) return callback({ error: 'range_too_wide' });

        callback(_publicHistory(_stats.history({ metric, from, to, bucket: request?.bucket })));
      } catch (err) {
        console.error('[LiveSocket] get_history error:', err.message);
        callback({ error: 'query_failed' });
      }
    });

    socket.on('get_stats_info', (callback) => {
      if (typeof callback !== 'function') return;
      if (!_stats) return callback({ error: 'stats_unavailable' });
      try {
        // stats() no longer carries the database path; see statsStore.stats().
        callback(_stats.stats());
      } catch (err) {
        console.error('[LiveSocket] get_stats_info error:', err.message);
        callback({ error: 'query_failed' });
      }
    });

    socket.on('disconnect', () => {
      console.log('[LiveSocket] Dashboard client disconnected');
    });
  });

  http.listen(port, () => {
    console.log(`[LiveSocket] Socket.io running on port ${port}`);
  });

  // Snapshot history on its own slower cadence. The 10s collect below drives
  // the live dashboard; persisting at that rate would be 8,640 rows a day for
  // no extra insight.
  if (_stats) {
    setTimeout(() => _snapshot(manager).catch(() => {}), 30_000);
    const snapTimer = setInterval(() => _snapshot(manager).catch((err) => {
      console.error('[LiveSocket] snapshot error:', err.message);
    }), SNAPSHOT_INTERVAL_MS);
    if (snapTimer.unref) snapTimer.unref();
  }

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
      // `id` is a stable handle for the UI; `url` is query-stripped so a
      // provider token in a station's query string is never published.
      id: _stationId(url),
      name: _stationName(url),
      url: _publicStationUrl(url),
      listeners, guilds, idle,
    }))
    .filter(b => b.guilds > 0)
    .sort((a, b) => b.listeners - a.listeners);

  const audioMode = results[0]?.audioMode ?? null;
  const shardAudioServer = results.find(r => r.audioServer)?.audioServer ?? null;
  const audioServer = audioMode === 'remote' || shardAudioServer?.configured === true
    ? await _collectAudioServerStatus(shardAudioServer)
    : shardAudioServer;

  // Strip the internal URL and every ffmpeg pid before this leaves the host.
  const publicAudioServer = _publicAudioServer(audioServer);

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
    audioServer: publicAudioServer,
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

/**
 * Persists one point of history, reusing exactly what _collect already gathers
 * so a snapshot can never disagree with the live dashboard.
 */
async function _snapshot(manager) {
  if (!_stats) return;
  if (!_latestStats || !_latestStats.updatedAt) await _collect(manager);
  if (!_latestStats) return;

  const langCounts = await _languageCounts(manager);
  _stats.recordSnapshot(_latestStats, langCounts);
}

function getLatestStats() { return _latestStats; }

module.exports = {
  startLiveSocket,
  getLatestStats,
  // Exported for tests/socket-leak.test.js, which asserts that no outbound
  // payload carries a host path, a process id or an internal URL.
  _publicStation,
  _publicAudioServer,
  _publicHistory,
  _stationId,
  _publicStationUrl,
};
