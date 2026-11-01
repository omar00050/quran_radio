'use strict';

const { stopWaiting } = require('./joinAndPlayQuran');

/**
 * Stops everything a guild has running *in this process*, right now.
 *
 * Attached to the client as `client.resetGuildRuntime` (see ready.js) so it can
 * be reached from inside a `broadcastEval`. That matters: the function given to
 * broadcastEval is serialised and evaluated in the shard, where `require` is
 * not reliably in scope, so the eval body can only call things already hanging
 * off the client.
 *
 * Runs before the database rows are deleted. If the rows went first, a timer
 * firing in between would read a half-deleted configuration.
 *
 * @param {import("@base/baseClient")} client
 * @param {string} guildId
 * @returns {{stopped: string[], errors: string[]}} what was actually torn down
 */
function resetGuildRuntime(client, guildId) {
  const id = String(guildId);
  const stopped = [];
  const errors = [];

  const step = (label, fn) => {
    try {
      if (fn()) stopped.push(label);
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
    }
  };

  // ── Voice / radio ────────────────────────────────────────────────────────
  step('radio', () => {
    const conn = client.Radio?.get(id);
    if (!conn) return false;

    // Release the audio source's listener for this guild before destroying the
    // connection, so the broadcaster's refcount drops and its idle sweep can
    // reclaim the station if nobody else is on it.
    try {
      if (conn.guildStream && client.audio) {
        client.audio.releaseGuildStream(conn.broadcastUrl, conn.guildStream);
      }
    } catch (_) { /* already released */ }

    try { conn.player?.stop(true); } catch (_) { /* no player */ }
    try { conn.destroy(); } catch (_) { /* already destroyed */ }
    client.Radio.delete(id);
    return true;
  });

  // The recovery waiter is separate state: a guild waiting for a station that
  // is down holds a `wanted` mark on the hub, which keeps that station exempt
  // from the idle sweep. Leaving it behind would pin a station forever for a
  // guild that no longer has any configuration.
  step('audio waiter', () => {
    try {
      return stopWaiting(client, id);
    } catch (_) {
      // Fall back to the client-side registry if the module is unavailable.
      const waiters = client._audioWaiters;
      if (waiters?.has?.(id)) { waiters.delete(id); return true; }
      return false;
    }
  });

  // ── Timers ───────────────────────────────────────────────────────────────
  step('azkar timer', () => {
    const timer = client.Azkar?.get(id);
    if (!timer) return false;
    clearTimeout(timer);
    client.Azkar.delete(id);
    return true;
  });

  step('adhan timer', () => {
    const timer = client.Adhan?.get(id);
    if (!timer) return false;
    clearTimeout(timer);
    client.Adhan.delete(id);
    return true;
  });

  step('scheduled jobs', () => {
    const job = client.cache_job_time?.get(id);
    if (!job) return false;
    // node-schedule jobs expose cancel(); plain timeouts do not.
    if (typeof job.cancel === 'function') job.cancel();
    else clearTimeout(job);
    client.cache_job_time.delete(id);
    return true;
  });

  // ── Per-guild caches ─────────────────────────────────────────────────────
  step('station cache', () => {
    if (!client.radioUrlCache?.has?.(id)) return false;
    client.radioUrlCache.delete(id);
    return true;
  });

  step('adhan sent-markers', () => {
    // Keys are `${guildId}_${date}_${prayerName}` — guild-scoped, safe to drop.
    const sent = client.prayerLastSent;
    if (!sent?.keys) return false;
    let removed = 0;
    for (const key of Array.from(sent.keys())) {
      if (String(key).startsWith(`${id}_`)) { sent.delete(key); removed++; }
    }
    return removed > 0;
  });

  step('interaction hold', () => {
    if (!client.UserHold?.has?.(id)) return false;
    client.UserHold.delete(id);
    return true;
  });

  // NOTE: client.prayerCache is deliberately NOT touched. Its keys are
  // `${latitude}_${longitude}_${method}_${year}_${month}` — a location, not a
  // guild — and every guild in the same city shares one entry. Dropping it
  // here would evict a cache other guilds are still using and force a needless
  // Aladhan API refetch for them. The same applies to the `prayerCache` table.

  return { stopped, errors };
}

module.exports = resetGuildRuntime;
