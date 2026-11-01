'use strict';

const { EmbedBuilder, WebhookClient } = require('discord.js');
const { safeGet } = require('./dbSafe');

/**
 * Wipes one guild's saved configuration, stopping its live work first.
 *
 * Order matters: runtime is torn down on the shard that owns the guild BEFORE
 * any row is deleted. The other way round, a timer firing in the gap would read
 * a half-deleted configuration and could re-create state we are removing.
 *
 * The bot deliberately stays in the guild — the server can run `/setup` again.
 */

/**
 * Which shard owns a guild, using Discord's standard snowflake formula. Same
 * calculation `ready.js` uses to decide which guilds a shard restores.
 */
function shardIdFor(guildId, totalShards) {
  if (!totalShards || totalShards < 1) return 0;
  return Number(BigInt(guildId) >> 22n) % totalShards;
}

/**
 * Looks up a guild across every shard without needing it on this one.
 * @returns {Promise<{id: string, name: string, memberCount: number, shardId: number}|null>}
 */
async function findGuild(client, guildId) {
  const id = String(guildId);

  if (!client.shard) {
    const guild = client.guilds.cache.get(id);
    return guild ? { id, name: guild.name, memberCount: guild.memberCount, shardId: 0 } : null;
  }

  const results = await client.shard.broadcastEval(
    (c, { gid }) => {
      const g = c.guilds.cache.get(gid);
      if (!g) return null;
      return { id: g.id, name: g.name, memberCount: g.memberCount, shardId: c.shard?.ids?.[0] ?? 0 };
    },
    { context: { gid: id } },
  ).catch(() => []);

  return results.find((r) => r) ?? null;
}

/**
 * What saved data exists for this guild, so the confirmation screen can list
 * exactly what is about to go and we can refuse a pointless reset.
 *
 * @returns {Promise<{radio: boolean, azkar: boolean, prayer: boolean, lang: boolean, prefix: boolean, any: boolean}>}
 */
async function inspectGuildData(client, guildId) {
  const id = String(guildId);
  const channels = await client.db.table('channels');

  const [radio, azkar, prayer, lang, prefix] = await Promise.all([
    safeGet(channels, `${id}_radioChannel`),
    safeGet(channels, `${id}_azkarChannel`),
    safeGet(channels, `${id}_prayerChannel`),
    safeGet(client.db, `${id}_lang`),
    safeGet(client.db, `${id}_prefix`),
  ]);

  const found = {
    radio: Boolean(radio),
    azkar: Boolean(azkar),
    prayer: Boolean(prayer),
    lang: Boolean(lang),
    prefix: Boolean(prefix),
  };
  found.any = Object.values(found).some(Boolean);
  return found;
}

/**
 * Performs the reset.
 *
 * @param {import("@base/baseClient")} client
 * @param {string} guildId
 * @param {{id: string, tag?: string}} actor who requested it
 * @param {{name?: string, shardId?: number}} [guildInfo] from findGuild, if already known
 * @returns {Promise<{ok: boolean, deleted: string[], stopped: string[], errors: string[], guildName: string}>}
 */
async function resetGuildData(client, guildId, actor, guildInfo = {}) {
  const id = String(guildId);
  const deleted = [];
  const errors = [];
  let stopped = [];

  const totalShards = client.shard?.count ?? 1;
  const owningShard = guildInfo.shardId ?? shardIdFor(id, totalShards);
  const guildName = guildInfo.name || id;

  // ── 1. Stop the live work, on the shard that owns the guild ──────────────
  try {
    if (client.shard) {
      const results = await client.shard.broadcastEval(
        (c, { gid }) => (typeof c.resetGuildRuntime === 'function'
          ? c.resetGuildRuntime(gid)
          : { stopped: [], errors: ['resetGuildRuntime not attached'] }),
        { context: { gid: id }, shard: owningShard },
      );
      const payload = Array.isArray(results) ? results[0] : results;
      stopped = payload?.stopped ?? [];
      if (payload?.errors?.length) errors.push(...payload.errors);
    } else if (typeof client.resetGuildRuntime === 'function') {
      const payload = client.resetGuildRuntime(id);
      stopped = payload?.stopped ?? [];
      if (payload?.errors?.length) errors.push(...payload.errors);
    }
  } catch (err) {
    // A shard that is restarting cannot be evaluated. The rows still need to
    // go; whatever was running there dies with the process anyway.
    errors.push(`runtime teardown: ${err.message}`);
  }

  // ── 2. Delete the rows ───────────────────────────────────────────────────
  const channels = await client.db.table('channels');

  const drop = async (label, fn) => {
    try {
      if (await fn()) deleted.push(label);
    } catch (err) {
      errors.push(`${label}: ${err.message}`);
    }
  };

  await drop('radio', async () => {
    if (!(await channels.get(`${id}_radioChannel`))) return false;
    await channels.delete(`${id}_radioChannel`);
    return true;
  });
  await drop('azkar', async () => {
    if (!(await channels.get(`${id}_azkarChannel`))) return false;
    await channels.delete(`${id}_azkarChannel`);
    return true;
  });
  await drop('prayer', async () => {
    if (!(await channels.get(`${id}_prayerChannel`))) return false;
    await channels.delete(`${id}_prayerChannel`);
    return true;
  });
  await drop('lang', async () => {
    if (!(await client.db.get(`${id}_lang`))) return false;
    await client.db.delete(`${id}_lang`);
    return true;
  });
  await drop('prefix', async () => {
    if (!(await client.db.get(`${id}_prefix`))) return false;
    await client.db.delete(`${id}_prefix`);
    return true;
  });

  // NOTE on the prayer calendar: the `prayerCache` table is keyed by
  // `${latitude}_${longitude}_${method}_${year}_${month}` — a location shared
  // by every guild in the same city, not this guild's own data. Deleting it
  // would evict a cache other servers are still using and force them into a
  // needless Aladhan refetch, so it is left alone. The guild-scoped part (the
  // per-prayer "already sent" markers) is cleared by resetGuildRuntime.

  // ── 3. Audit ─────────────────────────────────────────────────────────────
  const record = {
    guildId: id,
    guildName,
    byId: String(actor?.id ?? 'unknown'),
    byTag: actor?.tag ?? null,
    at: Date.now(),
    deleted,
    stopped,
    errors,
    shardId: owningShard,
  };

  try {
    const resets = await client.db.table('resets');
    await resets.set(`${id}_${record.at}`, record);
  } catch (err) {
    client.logger?.error?.('[reset] could not write the audit row', err);
  }

  await sendResetWebhook(client, record).catch(() => {});

  client.logger?.warn?.(
    `[reset] ${guildName} (${id}) by ${record.byTag ?? record.byId} — `
    + `deleted: ${deleted.join(', ') || 'nothing'} | stopped: ${stopped.join(', ') || 'nothing'}`
    + (errors.length ? ` | errors: ${errors.join('; ')}` : ''),
  );

  return { ok: errors.length === 0, deleted, stopped, errors, guildName };
}

/** Mirrors the audit row to WARN_LOGS so a reset is visible without DB access. */
async function sendResetWebhook(client, record) {
  const url = process.env.WARN_LOGS;
  if (!url) return;

  const embed = new EmbedBuilder()
    .setTitle('Server data reset')
    .setColor('DarkGold')
    .setTimestamp(record.at)
    .addFields([
      { name: 'Server', value: `${record.guildName}`, inline: true },
      { name: 'Server ID', value: `\`${record.guildId}\``, inline: true },
      { name: 'Shard', value: `\`${record.shardId}\``, inline: true },
      { name: 'By', value: `<@${record.byId}> (\`${record.byId}\`)`, inline: false },
      { name: 'Deleted', value: record.deleted.length ? record.deleted.join(', ') : 'nothing', inline: false },
      { name: 'Stopped at runtime', value: record.stopped.length ? record.stopped.join(', ') : 'nothing', inline: false },
    ]);

  if (record.errors.length) {
    embed.addFields([{ name: 'Errors', value: record.errors.join('\n').slice(0, 1024) }]);
  }

  const hook = new WebhookClient({ url });
  await hook.send({ username: 'Reset Log', embeds: [embed] });
}

module.exports = { resetGuildData, findGuild, inspectGuildData, shardIdFor };
