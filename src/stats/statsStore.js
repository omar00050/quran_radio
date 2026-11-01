'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Historical statistics store.
 *
 * ## Why SQLite, and why not the main database
 *
 * Production runs `shard.js`, which forks `index.js`, and `index.js` configures
 * good.db with `database_type: "JSON"`. That JSON driver rewrites the entire
 * file on every write and holds the whole dataset in memory, so appending a
 * time series to it would grow the bot's live configuration file without bound
 * and make every unrelated read slower. Stats therefore never touch it.
 *
 * SQLite was chosen over MongoDB because:
 *   - `better-sqlite3` is already installed (good.db depends on it), so no new
 *     dependency and no server to run;
 *   - `mongodb_uri` is not configured in this deployment, so Mongo is not
 *     actually available;
 *   - the access pattern is one writer and a few readers doing range
 *     aggregation, which is what SQL is for — `GROUP BY` on a time bucket is a
 *     single query here and would be manual work in a key-value store;
 *   - WAL mode lets the dashboard read while the writer is inserting.
 *
 * ## Single writer
 *
 * Only the process that runs liveSocket (the sharding manager) opens this
 * store. Shards send events over the sharding IPC instead — see
 * `src/utils/functions/statsReporter.js`. An unsharded `npm start` is itself
 * the only process, so it writes directly and the invariant still holds.
 */

const DEFAULTS = {
  rawRetentionDays: 90,
  hourlyRetentionDays: 365,
  cleanupIntervalMs: 6 * 60 * 60 * 1000, // every 6 hours
};

/** Event kinds accepted by `record()`. Anything else is ignored. */
const EVENT_KINDS = new Set([
  'guild_join',
  'guild_leave',
  'radio_on',
  'radio_off',
  'station_switch',
  'radio_error',
  'language_set',
]);

let singleton = null;

class StatsStore {
  constructor(options = {}) {
    const Database = require('better-sqlite3');

    this.rawRetentionDays = Number(process.env.STATS_RAW_RETENTION_DAYS || DEFAULTS.rawRetentionDays);
    this.hourlyRetentionDays = Number(process.env.STATS_HOURLY_RETENTION_DAYS || DEFAULTS.hourlyRetentionDays);
    this.logger = options.logger || console;

    const file = options.file
      || process.env.STATS_DB_PATH
      || path.join(__dirname, '..', '..', 'database', 'stats.sqlite');

    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

    this.file = file;
    this.db = new Database(file);
    // WAL: readers (the dashboard query path) never block the writer.
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.#migrate();
    this.#prepare();
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        at           INTEGER NOT NULL,
        kind         TEXT    NOT NULL,
        guild_id     TEXT,
        guild_name   TEXT,
        member_count INTEGER,
        actor_id     TEXT,
        station      TEXT,
        reason       TEXT,
        detail       TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_at   ON events (at);
      CREATE INDEX IF NOT EXISTS idx_events_kind ON events (kind, at);

      CREATE TABLE IF NOT EXISTS snapshots (
        at                INTEGER PRIMARY KEY,
        total_servers     INTEGER,
        total_users       INTEGER,
        active_radio      INTEGER,
        idle_radio        INTEGER,
        active_azkar      INTEGER,
        active_adhan      INTEGER,
        total_listeners   INTEGER,
        active_broadcasts INTEGER,
        total_shards      INTEGER,
        audio_ffmpeg      INTEGER,
        audio_mode        TEXT,
        detail            TEXT
      );

      CREATE TABLE IF NOT EXISTS station_samples (
        at        INTEGER NOT NULL,
        url       TEXT    NOT NULL,
        name      TEXT,
        listeners INTEGER,
        guilds    INTEGER,
        idle      INTEGER,
        PRIMARY KEY (at, url)
      );
      CREATE INDEX IF NOT EXISTS idx_station_at ON station_samples (at);

      CREATE TABLE IF NOT EXISTS lang_samples (
        at     INTEGER NOT NULL,
        lang   TEXT    NOT NULL,
        guilds INTEGER,
        PRIMARY KEY (at, lang)
      );

      CREATE TABLE IF NOT EXISTS hourly (
        bucket INTEGER NOT NULL,
        metric TEXT    NOT NULL,
        avg    REAL,
        min    REAL,
        max    REAL,
        last   REAL,
        PRIMARY KEY (bucket, metric)
      );
      CREATE INDEX IF NOT EXISTS idx_hourly_metric ON hourly (metric, bucket);

      CREATE TABLE IF NOT EXISTS hourly_events (
        bucket INTEGER NOT NULL,
        kind   TEXT    NOT NULL,
        count  INTEGER,
        PRIMARY KEY (bucket, kind)
      );

      CREATE TABLE IF NOT EXISTS hourly_stations (
        bucket    INTEGER NOT NULL,
        url       TEXT    NOT NULL,
        name      TEXT,
        listeners REAL,
        guilds    REAL,
        PRIMARY KEY (bucket, url)
      );
    `);
  }

  #prepare() {
    this.stmt = {
      insertEvent: this.db.prepare(`
        INSERT INTO events (at, kind, guild_id, guild_name, member_count, actor_id, station, reason, detail)
        VALUES (@at, @kind, @guildId, @guildName, @memberCount, @actorId, @station, @reason, @detail)
      `),
      insertSnapshot: this.db.prepare(`
        INSERT OR REPLACE INTO snapshots
          (at, total_servers, total_users, active_radio, idle_radio, active_azkar, active_adhan,
           total_listeners, active_broadcasts, total_shards, audio_ffmpeg, audio_mode, detail)
        VALUES (@at, @totalServers, @totalUsers, @activeRadio, @idleRadio, @activeAzkar, @activeAdhan,
                @totalListeners, @activeBroadcasts, @totalShards, @audioFfmpeg, @audioMode, @detail)
      `),
      insertStation: this.db.prepare(`
        INSERT OR REPLACE INTO station_samples (at, url, name, listeners, guilds, idle)
        VALUES (@at, @url, @name, @listeners, @guilds, @idle)
      `),
      insertLang: this.db.prepare(`
        INSERT OR REPLACE INTO lang_samples (at, lang, guilds) VALUES (@at, @lang, @guilds)
      `),
    };
  }

  // ── Writing ──────────────────────────────────────────────────────────────

  /**
   * Records one event. Accepts the payload shape the reporter sends over IPC.
   * Unknown kinds are dropped rather than stored, so a typo in a caller cannot
   * silently pollute the series.
   */
  record(event) {
    try {
      if (!event || !EVENT_KINDS.has(event.kind)) return false;

      this.stmt.insertEvent.run({
        at: event.at ?? Date.now(),
        kind: event.kind,
        guildId: event.guildId ?? null,
        guildName: event.guildName ?? null,
        memberCount: Number.isFinite(event.memberCount) ? event.memberCount : null,
        actorId: event.actorId ?? null,
        station: event.station ?? null,
        reason: event.reason ?? null,
        detail: event.detail ? JSON.stringify(event.detail) : null,
      });
      return true;
    } catch (err) {
      this.logger?.error?.(`[stats] could not record ${event?.kind}: ${err.message}`);
      return false;
    }
  }

  /**
   * Records a 5-minute snapshot built from what liveSocket already collects.
   * `langCounts` is `{ ar: n, en: n }`.
   */
  recordSnapshot(stats, langCounts = {}) {
    try {
      const at = stats.updatedAt ?? Date.now();
      // liveSocket nests the audio server's counters under `health.totals`.
      // The first two lookups below never matched that shape, so this metric
      // was silently always null before.
      const audioFfmpeg = stats.audioServer?.health?.totals?.ffmpeg
        ?? stats.audioServer?.totals?.ffmpeg
        ?? stats.audioServer?.ffmpeg
        ?? null;

      const insert = this.db.transaction(() => {
        this.stmt.insertSnapshot.run({
          at,
          totalServers: stats.totalServers ?? null,
          totalUsers: stats.totalUsers ?? null,
          activeRadio: stats.activeRadio ?? null,
          idleRadio: stats.idleRadio ?? null,
          activeAzkar: stats.activeAzkar ?? null,
          activeAdhan: stats.activeAdhan ?? null,
          totalListeners: stats.totalListeners ?? null,
          activeBroadcasts: stats.activeBroadcasts ?? null,
          totalShards: stats.totalShards ?? null,
          audioFfmpeg: Number.isFinite(audioFfmpeg) ? audioFfmpeg : null,
          audioMode: stats.audioMode ?? null,
          // Per-shard totals kept as JSON: useful for the dashboard, not worth
          // its own table since nothing aggregates across shards over time.
          detail: JSON.stringify({ shards: stats.shards ?? [] }),
        });

        for (const b of stats.broadcasts ?? []) {
          this.stmt.insertStation.run({
            at,
            url: b.url,
            name: b.name ?? null,
            listeners: b.listeners ?? 0,
            guilds: b.guilds ?? 0,
            idle: b.idle ?? 0,
          });
        }

        for (const [lang, guilds] of Object.entries(langCounts)) {
          this.stmt.insertLang.run({ at, lang, guilds: Number(guilds) || 0 });
        }
      });

      insert();
      return true;
    } catch (err) {
      this.logger?.error?.(`[stats] could not record snapshot: ${err.message}`);
      return false;
    }
  }

  // ── Rollups and retention ────────────────────────────────────────────────

  /**
   * Folds raw rows into hourly buckets, then drops raw data past the retention
   * window and hourly data past its own. Rollups are recomputed for the buckets
   * still covered by raw data, so a bucket is never left half-filled.
   */
  rollupAndPrune(now = Date.now()) {
    const HOUR = 3600_000;
    const rawCutoff = now - this.rawRetentionDays * 86_400_000;
    const hourlyCutoff = now - this.hourlyRetentionDays * 86_400_000;

    const metrics = [
      ['total_servers', 'totalServers'],
      ['total_users', 'totalUsers'],
      ['active_radio', 'activeRadio'],
      ['idle_radio', 'idleRadio'],
      ['total_listeners', 'totalListeners'],
      ['active_broadcasts', 'activeBroadcasts'],
      ['audio_ffmpeg', 'audioFfmpeg'],
    ];

    try {
      const run = this.db.transaction(() => {
        for (const [column, metric] of metrics) {
          this.db.prepare(`
            INSERT OR REPLACE INTO hourly (bucket, metric, avg, min, max, last)
            SELECT (at / ${HOUR}) * ${HOUR} AS bucket,
                   ?                        AS metric,
                   AVG(${column}), MIN(${column}), MAX(${column}),
                   (SELECT ${column} FROM snapshots s2
                     WHERE (s2.at / ${HOUR}) * ${HOUR} = (s1.at / ${HOUR}) * ${HOUR}
                     ORDER BY s2.at DESC LIMIT 1)
              FROM snapshots s1
             WHERE ${column} IS NOT NULL
             GROUP BY bucket
          `).run(metric);
        }

        this.db.prepare(`
          INSERT OR REPLACE INTO hourly_events (bucket, kind, count)
          SELECT (at / ${HOUR}) * ${HOUR} AS bucket, kind, COUNT(*)
            FROM events GROUP BY bucket, kind
        `).run();

        this.db.prepare(`
          INSERT OR REPLACE INTO hourly_stations (bucket, url, name, listeners, guilds)
          SELECT (at / ${HOUR}) * ${HOUR} AS bucket, url, MAX(name), AVG(listeners), AVG(guilds)
            FROM station_samples GROUP BY bucket, url
        `).run();

        // Raw data past the window goes; the hourly rollups above preserve it.
        this.db.prepare('DELETE FROM events WHERE at < ?').run(rawCutoff);
        this.db.prepare('DELETE FROM snapshots WHERE at < ?').run(rawCutoff);
        this.db.prepare('DELETE FROM station_samples WHERE at < ?').run(rawCutoff);
        this.db.prepare('DELETE FROM lang_samples WHERE at < ?').run(rawCutoff);

        this.db.prepare('DELETE FROM hourly WHERE bucket < ?').run(hourlyCutoff);
        this.db.prepare('DELETE FROM hourly_events WHERE bucket < ?').run(hourlyCutoff);
        this.db.prepare('DELETE FROM hourly_stations WHERE bucket < ?').run(hourlyCutoff);
      });

      run();
      return true;
    } catch (err) {
      this.logger?.error?.(`[stats] rollup/prune failed: ${err.message}`);
      return false;
    }
  }

  /** Starts the periodic rollup + prune. Returns the timer so it can be cleared. */
  startMaintenance() {
    this.rollupAndPrune();
    this.maintenanceTimer = setInterval(
      () => this.rollupAndPrune(),
      Number(process.env.STATS_CLEANUP_INTERVAL_MS || DEFAULTS.cleanupIntervalMs),
    );
    if (this.maintenanceTimer.unref) this.maintenanceTimer.unref();
    return this.maintenanceTimer;
  }

  // ── Reading ──────────────────────────────────────────────────────────────

  /**
   * Picks a bucket size that keeps a series readable: roughly 60-200 points for
   * any range, so an hour returns minutes and a year returns days.
   * @returns {{ms: number, label: string}}
   */
  static chooseBucket(fromMs, toMs) {
    const span = Math.max(1, toMs - fromMs);
    const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
    if (span <= 6 * HOUR) return { ms: 5 * MIN, label: '5m' };
    if (span <= 2 * DAY) return { ms: HOUR, label: '1h' };
    if (span <= 14 * DAY) return { ms: 6 * HOUR, label: '6h' };
    if (span <= 90 * DAY) return { ms: DAY, label: '1d' };
    return { ms: 7 * DAY, label: '7d' };
  }

  /**
   * Aggregated history for the dashboard.
   *
   * Only totals and per-station numbers are ever returned — no guild ids, no
   * user ids, nothing per-person. The dashboard is a public-facing page.
   *
   * @param {{metric: string, from: number, to: number, bucket?: number}} query
   */
  history({ metric, from, to, bucket } = {}) {
    const toMs = Number(to) || Date.now();
    const fromMs = Number(from) || (toMs - 86_400_000);
    const chosen = bucket ? { ms: Number(bucket), label: `${bucket}ms` } : StatsStore.chooseBucket(fromMs, toMs);
    const b = Math.max(60_000, chosen.ms);

    const SNAPSHOT_METRICS = {
      servers: 'total_servers',
      users: 'total_users',
      radio: 'active_radio',
      idle_radio: 'idle_radio',
      listeners: 'total_listeners',
      broadcasts: 'active_broadcasts',
      ffmpeg: 'audio_ffmpeg',
    };

    try {
      if (SNAPSHOT_METRICS[metric]) {
        const column = SNAPSHOT_METRICS[metric];
        const rows = this.db.prepare(`
          SELECT (at / ?) * ? AS t,
                 AVG(${column}) AS avg, MIN(${column}) AS min, MAX(${column}) AS max
            FROM snapshots
           WHERE at BETWEEN ? AND ? AND ${column} IS NOT NULL
           GROUP BY t ORDER BY t
        `).all(b, b, fromMs, toMs);

        return {
          metric, from: fromMs, to: toMs, bucket: b, bucketLabel: chosen.label,
          points: rows.map((r) => ({
            t: r.t,
            value: r.avg === null ? null : Math.round(r.avg * 100) / 100,
            min: r.min,
            max: r.max,
          })),
        };
      }

      if (metric === 'events') {
        const rows = this.db.prepare(`
          SELECT (at / ?) * ? AS t, kind, COUNT(*) AS count
            FROM events WHERE at BETWEEN ? AND ?
           GROUP BY t, kind ORDER BY t
        `).all(b, b, fromMs, toMs);

        const byBucket = new Map();
        for (const r of rows) {
          if (!byBucket.has(r.t)) byBucket.set(r.t, { t: r.t, counts: {} });
          byBucket.get(r.t).counts[r.kind] = r.count;
        }
        return {
          metric, from: fromMs, to: toMs, bucket: b, bucketLabel: chosen.label,
          points: [...byBucket.values()],
        };
      }

      if (metric === 'stations') {
        const rows = this.db.prepare(`
          SELECT url, MAX(name) AS name,
                 AVG(listeners) AS listeners, MAX(listeners) AS peak, AVG(guilds) AS guilds
            FROM station_samples WHERE at BETWEEN ? AND ?
           GROUP BY url ORDER BY listeners DESC
        `).all(fromMs, toMs);

        return {
          metric, from: fromMs, to: toMs,
          stations: rows.map((r) => ({
            url: r.url,
            name: r.name,
            avgListeners: Math.round((r.listeners ?? 0) * 100) / 100,
            peakListeners: r.peak ?? 0,
            avgGuilds: Math.round((r.guilds ?? 0) * 100) / 100,
          })),
        };
      }

      if (metric === 'languages') {
        const rows = this.db.prepare(`
          SELECT (at / ?) * ? AS t, lang, AVG(guilds) AS guilds
            FROM lang_samples WHERE at BETWEEN ? AND ?
           GROUP BY t, lang ORDER BY t
        `).all(b, b, fromMs, toMs);

        const byBucket = new Map();
        for (const r of rows) {
          if (!byBucket.has(r.t)) byBucket.set(r.t, { t: r.t, langs: {} });
          byBucket.get(r.t).langs[r.lang] = Math.round(r.guilds);
        }
        return {
          metric, from: fromMs, to: toMs, bucket: b, bucketLabel: chosen.label,
          points: [...byBucket.values()],
        };
      }

      return { error: 'unknown_metric', metric, available: [...Object.keys(SNAPSHOT_METRICS), 'events', 'stations', 'languages'] };
    } catch (err) {
      this.logger?.error?.(`[stats] history query failed: ${err.message}`);
      return { error: 'query_failed', metric };
    }
  }

  /**
   * Row counts, size and retention — the payload `get_stats_info` returns to
   * the dashboard.
   *
   * Deliberately does NOT include the database path. This object crosses the
   * socket to a public dashboard, and an absolute path leaks the deployment
   * layout (drive, user, directory names) to anyone who can connect. The path
   * stays reachable in-process as `store.file` for server-side logging.
   */
  stats() {
    const count = (table) => this.db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
    let bytes = null;
    try { bytes = this.file === ':memory:' ? 0 : fs.statSync(this.file).size; } catch (_) {}
    return {
      bytes,
      events: count('events'),
      snapshots: count('snapshots'),
      stationSamples: count('station_samples'),
      langSamples: count('lang_samples'),
      hourly: count('hourly'),
      rawRetentionDays: this.rawRetentionDays,
      hourlyRetentionDays: this.hourlyRetentionDays,
    };
  }

  close() {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    try { this.db.close(); } catch (_) {}
  }
}

/**
 * Opens (or returns) the process-wide store. Only the manager process — the one
 * running liveSocket — should ever call this.
 */
function openStatsStore(options = {}) {
  if (!singleton) singleton = new StatsStore(options);
  return singleton;
}

module.exports = { StatsStore, openStatsStore, EVENT_KINDS };
