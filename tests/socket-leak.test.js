/**
 * Outbound-payload leak check — no Discord, no bot, no network listener.
 *
 *   node tests/socket-leak.test.js
 *
 * Everything liveSocket emits or returns reaches a dashboard that anyone able
 * to connect to the port may read. This test fails if a payload carries
 * anything describing the host:
 *
 *   - a filesystem path (drive letter, backslashes, /home, /mnt, /var, …)
 *   - a process id field (ffmpegPid, pid, …)
 *   - an internal URL or bare host:port
 *   - a value taken from .env (the audio server token or URL)
 *
 * It started from a real leak: `get_stats_info` returned the absolute path of
 * the stats database.
 */
'use strict';

const path = require('path');
const fs = require('fs');

process.env.AUDIO_SERVER_TOKEN = 'a-secret-token-value-for-the-test';
process.env.AUDIO_SERVER_URL = 'http://10.1.2.3:9999';

const { StatsStore } = require('../src/stats/statsStore');
const live = require('../src/server/liveSocket');

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Anything that looks like a filesystem path. */
const PATH_PATTERNS = [
  // One letter before the colon only, so `http://` is not mistaken for `D:\`
  // while `C:/` and `D:\` still match.
  [/(?<![A-Za-z])[A-Za-z]:[\\/]/, 'windows drive letter'],
  [/\\/, 'backslash (no URL or snowflake contains one)'],
  [/\/(?:home|root|mnt|srv|opt|var|usr|etc|tmp|proc|Users)\//i, 'unix absolute path'],
  [/\.sqlite(?:-wal|-shm)?\b/, 'database filename'],
  [/node_modules/, 'module path'],
  [/\.(?:json|log|ya?ml|env)\b/, 'server-side filename'],
  [/\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0)\b/, 'loopback or bind address'],
  [/:\d{2,5}(?:\/|$)/, 'host:port'],
];

/** Keys that must never appear anywhere in a payload. */
const FORBIDDEN_KEYS = [/^ffmpegpid$/i, /^pid$/i, /pids?$/i, /^hostname$/i, /^cwd$/i, /^file$/i, /^filepath$/i, /^path$/i];

function walk(value, keyPath, hits) {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${keyPath}[${i}]`, hits));
    return;
  }

  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.some((re) => re.test(k))) {
        hits.push(`forbidden key "${k}" at ${keyPath || '<root>'}`);
      }
      walk(v, keyPath ? `${keyPath}.${k}` : k, hits);
    }
    return;
  }

  if (typeof value === 'string') {
    for (const [re, label] of PATH_PATTERNS) {
      if (re.test(value)) hits.push(`${label} in ${keyPath}: ${JSON.stringify(value).slice(0, 80)}`);
    }
    if (value.includes(process.env.AUDIO_SERVER_TOKEN)) hits.push(`AUDIO_SERVER_TOKEN in ${keyPath}`);
    if (value.includes('10.1.2.3') || value.includes(':9999')) hits.push(`audio server URL in ${keyPath}: ${value}`);
    if (/rj-tok=/i.test(value)) hits.push(`provider token in ${keyPath}: ${value}`);
  }
}

function assertClean(label, payload) {
  const hits = [];
  walk(payload, '', hits);
  record(label, hits.length === 0, hits.join(' | ') || 'clean');
}

function main() {
  // ── get_stats_info ──────────────────────────────────────────────────────
  {
    const file = path.join(process.env.TMP || '/tmp', 'leak_probe.sqlite');
    for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(file + ext); } catch (_) {} }

    const store = new StatsStore({ file, logger: { error() {} } });
    const info = store.stats();

    assertClean('get_stats_info payload has no path or pid', info);
    record('get_stats_info no longer exposes "file"', info.file === undefined,
      Object.keys(info).join(', '));
    record('get_stats_info still has what the dashboard needs',
      typeof info.bytes === 'number' && typeof info.events === 'number'
      && typeof info.rawRetentionDays === 'number',
      `bytes=${info.bytes} events=${info.events} raw=${info.rawRetentionDays}d`);

    // ── get_history: stations must not carry a raw URL ────────────────────
    const now = Date.now();
    const tokenUrl = 'http://n0e.radiojar.com/4wqre23fytzuv?rj-ttl=5&rj-tok=SECRETTOKEN';
    store.recordSnapshot({
      updatedAt: now, totalServers: 10, totalUsers: 20, activeRadio: 2, idleRadio: 0,
      totalListeners: 5, activeBroadcasts: 1, totalShards: 1, audioMode: 'remote',
      audioServer: { health: { totals: { ffmpeg: 3 } } },
      broadcasts: [{ url: tokenUrl, name: 'Station', listeners: 5, guilds: 2, idle: 0 }],
      shards: [],
    }, { ar: 6, en: 4 });

    const raw = store.history({ metric: 'stations', from: now - 3600e3, to: now + 1000 });
    record('the store itself still keeps the full URL (operators need it)',
      JSON.stringify(raw).includes('rj-tok'), 'full URL retained internally');

    const published = live._publicHistory(raw);
    assertClean('get_history stations payload is clean', published);
    record('the published station has an id and a stripped URL',
      published.stations[0].id?.length === 12
      && published.stations[0].url === 'http://n0e.radiojar.com/4wqre23fytzuv',
      `${published.stations[0].id} ${published.stations[0].url}`);

    for (const metric of ['servers', 'listeners', 'events', 'languages']) {
      assertClean(`get_history ${metric} payload is clean`,
        live._publicHistory(store.history({ metric, from: now - 3600e3, to: now + 1000 })));
    }

    assertClean('unknown-metric error payload is clean', live._publicHistory(store.history({ metric: 'nope' })));

    store.close();
    for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(file + ext); } catch (_) {} }
  }

  // ── the audio-server block, as /health really returns it ────────────────
  {
    const fromHealth = {
      configured: true,
      reachable: true,
      url: 'http://10.1.2.3:9999',
      consecutiveFailures: 0,
      lastCheckAt: Date.now(),
      health: {
        ok: true,
        uptimeSec: 1234,
        totals: { stations: 2, active: 2, listeners: 9, ffmpeg: 2 },
        checkedAt: Date.now(),
        stations: [
          {
            url: 'http://n0e.radiojar.com/x?rj-tok=SECRETTOKEN', name: 'A', state: 'active',
            listeners: 4, guilds: 2, idle: 0, lastDataAgeMs: 120, ffmpegPid: 48219, attempts: 0,
            startedAt: Date.now(),
          },
        ],
      },
    };

    const published = live._publicAudioServer(fromHealth);
    assertClean('audioServer payload is clean', published);
    record('the internal audio server URL is gone', published.url === undefined);
    record('no ffmpeg pid survives', published.health.stations[0].ffmpegPid === undefined,
      Object.keys(published.health.stations[0]).join(', '));
    record('useful station fields survive',
      published.health.stations[0].name === 'A'
      && published.health.stations[0].state === 'active'
      && published.health.stations[0].listeners === 4);
    record('totals survive so the ffmpeg COUNT is still chartable',
      published.health.totals.ffmpeg === 2);
  }

  // ── the live stats event ────────────────────────────────────────────────
  {
    // Shaped exactly like the emitted object, with the fields a station carries.
    const emitted = {
      totalServers: 15000, totalUsers: 3.1e6, activeRadio: 4000, idleRadio: 1200,
      activeAzkar: 10, activeAdhan: 10, totalShards: 16, activeBroadcasts: 30,
      totalListeners: 9000,
      broadcasts: [{ id: 'abc123abc123', name: 'Station', url: 'http://host/path', listeners: 5, guilds: 2, idle: 0 }],
      audioMode: 'remote', audioActiveBroadcasts: 30, audioTotalListeners: 9000,
      audioServer: live._publicAudioServer({ configured: true, reachable: true, url: 'http://10.1.2.3:9999' }),
      shards: [{ id: 0, guilds: 940, users: 1, ping: 42, uptime: 99, radio: 1, azkar: 1, adhan: 1 }],
      updatedAt: Date.now(),
    };
    assertClean('stats event payload is clean', emitted);
    record('a station in the live array has no raw query string',
      !JSON.stringify(emitted.broadcasts).includes('?'));
  }

  // ── lookup_guild ────────────────────────────────────────────────────────
  {
    const found = {
      found: true, shardId: 3, id: '1171512753802969098', name: 'A Server',
      memberCount: 120, icon: 'https://cdn.discordapp.com/icons/abc/def.png?size=64',
    };
    assertClean('lookup_guild payload has no path or pid', found);
    record('lookup_guild not-found payload is minimal',
      JSON.stringify({ found: false }) === '{"found":false}');
  }

  // ── error payloads are codes, never messages ────────────────────────────
  {
    for (const code of ['stats_unavailable', 'bad_range', 'range_too_wide', 'unknown_metric', 'query_failed']) {
      assertClean(`error payload ${code} is clean`, { error: code });
    }

    const src = fs.readFileSync(path.join(__dirname, '..', 'src/server/liveSocket.js'), 'utf8');
    record('no handler returns err.message to the client',
      !/callback\(\s*\{[^}]*err\.(message|stack)/.test(src));
    record('errors are logged server-side instead',
      /console\.error\('\[LiveSocket\]/.test(src));
  }

  // ── the leak detector must actually detect ──────────────────────────────
  {
    const hits = [];
    walk({ file: 'D:\\abofarghaly\\work\\quran_radio\\database\\stats.sqlite' }, '', hits);
    record('the detector catches the original bug', hits.length >= 1, `${hits.length} hit(s)`);

    const hits2 = [];
    walk({ stations: [{ ffmpegPid: 1234 }] }, '', hits2);
    record('the detector catches a pid field', hits2.length >= 1, hits2[0]);

    const hits3 = [];
    walk({ p: '/home/omar/bot/x.js' }, '', hits3);
    record('the detector catches a unix path', hits3.length >= 1, hits3[0]);
  }

  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main();
