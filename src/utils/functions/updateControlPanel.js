'use strict';

const { MessageFlags } = require('discord.js');
const buildControlPanel = require('./ControlData');
const { getGuildLang } = require('./i18n');
const { safeSet } = require('./dbSafe');

/**
 * Is this message already a Components v2 message?
 *
 * The v2 flag changes the shape of a message, and a non-v2 message cannot be
 * edited into a v2 one — the request is rejected. Checking the flag locally on
 * the already-fetched message costs nothing and avoids spending a doomed API
 * request per guild just to learn that.
 *
 * @param {import("discord.js").Message|null} message
 */
function isV2(message) {
  try {
    return Boolean(message?.flags?.has?.(MessageFlags.IsComponentsV2));
  } catch (_) {
    return false;
  }
}

/**
 * Re-renders a guild's stored control panel message.
 *
 * Migration from the old embed-based panel to Components v2 is **lazy**: a
 * panel that is not v2 yet is left alone by background callers and converted
 * the first time somebody actually interacts with it (see `respondWithPanel`)
 * or runs `/control`. Mass-migrating every guild at startup would mean a
 * delete + repost for each one, which is a large burst of requests for panels
 * nobody may look at today.
 *
 * @param {import("@base/baseClient")} client
 * @param {import("discord.js").Guild} guild
 * @param {*} data  the guild's `_radioChannel` row
 * @param {object} [lang] resolved language; loaded per guild when omitted
 * @param {{migrate?: boolean}} [options]
 *        `migrate: false` (the default for background refreshes) leaves a
 *        non-v2 panel untouched. `migrate: true` converts it by replacing it.
 * @returns {Promise<'edited'|'replaced'|'skipped'|false>}
 */
async function updateControlPanel(client, guild, data, lang, options = {}) {
  const migrate = options.migrate === true;

  if (!guild || !data?.ch) return false;

  const db = await client.db.table('channels');
  const resolvedLang = lang || await getGuildLang(client, guild.id);
  const payload = buildControlPanel(client, data, resolvedLang);

  // No panel to render (guild not set up) — nothing to do here.
  if (!payload.components) return false;

  const channel = guild.channels.cache.get(data.ch)
    || await guild.channels.fetch(data.ch).catch(() => null);

  if (!channel) {
    await safeSet(db, `${guild.id}_radioChannel..ch`, null);
    await safeSet(db, `${guild.id}_radioChannel..msgId`, null);
    return false;
  }

  const message = data.msgId
    ? await channel.messages.fetch(data.msgId).catch(() => null)
    : null;

  if (message) {
    // Already v2: a plain edit is valid and is the cheapest path.
    if (isV2(message)) {
      try {
        await message.edit(payload);
        return 'edited';
      } catch (err) {
        client.logger?.debug?.(`[controlPanel] v2 edit failed in ${guild.id}: ${err.message}`);
        if (!migrate) return 'skipped';
        await message.delete().catch(() => {});
      }
    } else if (!migrate) {
      // Old-format panel and this is a background refresh. Leave it: its
      // buttons and menus still route to the same handlers, and the first
      // interaction with it will convert it.
      return 'skipped';
    } else {
      // Old-format panel and we were asked to migrate. Go straight to
      // delete + repost without attempting an edit that cannot succeed.
      await message.delete().catch(() => {});
    }
  }

  // Either there was no message at all, or we are replacing an old one.
  try {
    const sent = await channel.send(payload);
    await db.set(`${guild.id}_radioChannel..msgId`, sent.id);
    return 'replaced';
  } catch (err) {
    client.logger?.error?.(`[controlPanel] could not post a panel in ${guild.id}`, err);
    await safeSet(db, `${guild.id}_radioChannel..msgId`, null);
    return false;
  }
}

/**
 * Refreshes the panel a component interaction came from, migrating it if it is
 * still the old embed format.
 *
 * This is the lazy migration trigger. An old panel cannot take a v2 edit, so
 * `interaction.editReply` with the v2 payload would be rejected and the user
 * would see their click do nothing. Instead the old message is deleted and a
 * new v2 panel is posted in the same channel, and `msgId` is updated so later
 * refreshes find it.
 *
 * The caller must already have acknowledged the interaction (deferUpdate).
 *
 * @param {import("@base/baseClient")} client
 * @param {import("discord.js").MessageComponentInteraction} interaction
 * @param {*} data  the guild's `_radioChannel` row, freshly read
 * @param {object} [lang]
 * @returns {Promise<'edited'|'replaced'|false>}
 */
async function respondWithPanel(client, interaction, data, lang) {
  const payload = buildControlPanel(client, data, lang);

  // Not set up (shouldn't happen on this path) — nothing to render.
  if (!payload.components) return false;

  // The common case once migration has happened: edit in place.
  if (isV2(interaction.message)) {
    try {
      await interaction.editReply(payload);
      return 'edited';
    } catch (err) {
      client.logger?.debug?.(`[controlPanel] editReply failed in ${interaction.guildId}: ${err.message}`);
      return false;
    }
  }

  // Old-format panel: convert it now.
  try {
    const db = await client.db.table('channels');
    const channel = interaction.channel;

    await interaction.message.delete().catch(() => {});

    const sent = await channel.send(payload);
    await db.set(`${interaction.guildId}_radioChannel..msgId`, sent.id);
    // Keep `ch` pointing at wherever the panel actually lives now.
    if (data?.ch !== channel.id) {
      await safeSet(db, `${interaction.guildId}_radioChannel..ch`, channel.id);
    }

    client.logger?.log?.(`[controlPanel] migrated ${interaction.guildId} to Components v2 on interaction`);
    return 'replaced';
  } catch (err) {
    client.logger?.error?.(`[controlPanel] migration failed in ${interaction.guildId}`, err);
    return false;
  }
}

module.exports = updateControlPanel;
module.exports.respondWithPanel = respondWithPanel;
module.exports.isV2 = isV2;
