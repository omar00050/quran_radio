'use strict';

/**
 * Shard-side stats reporting.
 *
 * Only the manager process writes the stats store — sixteen shards writing one
 * SQLite file would contend on every insert. Shards therefore *send* their
 * events over the sharding IPC and the manager performs the write
 * (see shard.js and src/stats/statsStore.js).
 *
 * When the bot runs unsharded (`npm start`, no ShardingManager) there is no
 * manager to send to, so that single process writes directly: still exactly one
 * writer.
 *
 * Every function here is fire-and-forget and must never throw into a caller.
 * Recording a statistic is never worth failing a user's command over.
 */

const IPC_KEY = '__quranStats';

/** Direct-write store for the unsharded case; resolved lazily, once. */
let localStore;
let localStoreTried = false;

function getLocalStore() {
  if (localStoreTried) return localStore;
  localStoreTried = true;
  try {
    localStore = require('@root/src/stats/statsStore').openStatsStore();
  } catch (_) {
    localStore = null;
  }
  return localStore;
}

/**
 * @param {import("@base/baseClient")} client
 * @param {{kind: string, [k: string]: any}} event
 */
function send(client, event) {
  const payload = { ...event, at: event.at ?? Date.now() };

  try {
    if (client?.shard) {
      // Fire-and-forget across the IPC channel. A send can reject while a
      // shard is respawning; losing one statistic is acceptable.
      const result = client.shard.send({ [IPC_KEY]: payload });
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return;
    }

    const store = getLocalStore();
    if (store) store.record(payload);
  } catch (_) { /* never surface a stats failure */ }
}

/** A guild added or removed the bot. */
function reportGuild(client, { kind, guildId, guildName, memberCount, addedBy }) {
  send(client, {
    kind, // 'guild_join' | 'guild_leave'
    guildId: String(guildId),
    guildName: guildName ?? null,
    memberCount: Number.isFinite(memberCount) ? memberCount : null,
    actorId: addedBy ? String(addedBy) : null,
  });
}

/**
 * A playback event.
 * @param {'radio_on'|'radio_off'|'station_switch'|'radio_error'} kind
 */
function reportPlayback(client, { kind, guildId, station, actorId, reason }) {
  send(client, {
    kind,
    guildId: String(guildId),
    station: station ?? null,
    actorId: actorId ? String(actorId) : null,
    reason: reason ?? null,
  });
}

/** A guild's language was set. */
function reportLanguage(client, { guildId, lang, source, actorId }) {
  send(client, {
    kind: 'language_set',
    guildId: String(guildId),
    detail: { lang, source },
    actorId: actorId ? String(actorId) : null,
  });
}

module.exports = {
  reportGuild,
  reportPlayback,
  reportLanguage,
  send,
  IPC_KEY,
};
