'use strict';

/**
 * One "recovery waiter" per guild, keyed by guild id on the client.
 *
 * A waiter exists while a guild is holding its voice connection open with no
 * audio, waiting for a station to come back. It owns two pieces of state that
 * must be released together:
 *
 *   - the `wanted` mark on the hub (which keeps the station exempt from the
 *     idle sweep so its retries keep running), and
 *   - the broadcast:* listeners subscribed on client.audio.
 *
 * This registry exists because the previous version stored the detach callback
 * on the VoiceConnection object, and a VoiceConnection is not a stable
 * identity:
 *
 *   - `joinVoiceChannel` returns the EXISTING connection for a guild, so a
 *     second fresh join reset the property and orphaned the live wait — the
 *     `wanted` mark and the listeners could then never be released, which made
 *     the station permanently exempt from the idle sweep.
 *   - the OFF button destroys the connection and deletes the client.Radio
 *     entry, after which the disconnected handler could no longer find the
 *     connection to detach from.
 *   - guildDelete (bot kicked or removed) never touched it at all.
 *
 * Keying by guild id means every teardown path can call `stopWaiting(client,
 * guildId)` without needing a connection object to still be reachable.
 */

/** @returns {Map<string, {url: string, detach: () => void}>} */
function registry(client) {
  if (!client._audioWaiters) client._audioWaiters = new Map();
  return client._audioWaiters;
}

/**
 * Register the guild's waiter, replacing (and releasing) any previous one.
 * @param {() => void} detach releases the wanted mark and the listeners
 */
function startWaiting(client, guildId, url, detach) {
  stopWaiting(client, guildId);
  registry(client).set(guildId, { url, detach });
}

/**
 * Release the guild's waiter if it has one. Idempotent: calling it twice, or
 * on a guild that was never waiting, is a no-op — so it is safe to call from
 * every teardown path without coordinating between them.
 * @returns {boolean} whether a waiter was actually released
 */
function stopWaiting(client, guildId) {
  const reg = registry(client);
  const waiter = reg.get(guildId);
  if (!waiter) return false;

  // Delete BEFORE detaching: a detach implementation must never be able to
  // re-enter this function and double-release the wanted count.
  reg.delete(guildId);
  try { waiter.detach(); } catch (_) { /* never throw out of teardown */ }
  return true;
}

/** The station a guild is currently waiting on, or null. */
function waitingUrl(client, guildId) {
  const waiter = registry(client).get(guildId);
  return waiter ? waiter.url : null;
}

/** Total guilds currently waiting — for stats and tests. */
function waiterCount(client) {
  return registry(client).size;
}

module.exports = { startWaiting, stopWaiting, waitingUrl, waiterCount };
