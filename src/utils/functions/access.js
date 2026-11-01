'use strict';

const { t } = require('./i18n');

const { say } = require('./messages');
/**
 * Who may use the owner / mod manager.
 *
 * Owners live in `config.json` only and are never editable at runtime. Mods
 * live in the `mods` table so they can be added and removed without a deploy.
 *
 * Every check here is re-run server-side on every manager action. Hiding a
 * button is presentation, not authorisation: a component customId can be
 * replayed by anyone who can see the message id, so the handler must never
 * trust that a button was only rendered for the right person.
 */

const ID_PATTERN = /^\d{17,20}$/;

/** @returns {boolean} */
function isOwner(client, userId) {
  const owners = client.config?.owners;
  return Array.isArray(owners) && owners.includes(String(userId));
}

/** @returns {Promise<boolean>} */
async function isMod(client, userId) {
  try {
    const mods = await client.db.table('mods');
    const row = await mods.get(String(userId));
    return Boolean(row);
  } catch (_) {
    return false;
  }
}

/**
 * Owners implicitly have every mod power, so this is the check for anything
 * the mod manager exposes.
 * @returns {Promise<boolean>}
 */
async function isModOrOwner(client, userId) {
  if (isOwner(client, userId)) return true;
  return isMod(client, userId);
}

/**
 * Gate for an interaction. Replies ephemerally and returns false when the
 * caller is not allowed, so a handler can `if (!await requireOwner(...)) return;`.
 *
 * @param {'owner'|'mod'} level
 * @returns {Promise<boolean>}
 */
async function requireAccess(client, interaction, lang, level) {
  const allowed = level === 'owner'
    ? isOwner(client, interaction.user.id)
    : await isModOrOwner(client, interaction.user.id);

  if (allowed) return true;

  client.logger?.warn?.(
    `[access] denied ${level} action to ${interaction.user.id} (${interaction.user.tag ?? 'unknown'}) `
    + `customId=${interaction.customId ?? 'n/a'}`,
  );

  const payload = { content: say(lang, 'manager.denied'), ephemeral: true };
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (_) { /* interaction gone */ }

  return false;
}

/** Discord snowflakes are 17-20 digits. Rejects anything else before use. */
function isValidId(value) {
  return ID_PATTERN.test(String(value ?? '').trim());
}

/** The `mods` table row shape: { userId, addedBy, addedAt }. */
async function addMod(client, userId, addedBy) {
  const mods = await client.db.table('mods');
  const id = String(userId);
  if (await mods.get(id)) return false;
  await mods.set(id, { userId: id, addedBy: String(addedBy), addedAt: Date.now() });
  return true;
}

async function removeMod(client, userId) {
  const mods = await client.db.table('mods');
  const id = String(userId);
  if (!(await mods.get(id))) return false;
  await mods.delete(id);
  return true;
}

/** @returns {Promise<Array<{userId: string, addedBy: string, addedAt: number}>>} */
async function listMods(client) {
  try {
    const mods = await client.db.table('mods');
    // values() hands back the rows directly; all() is keyed by id, so fall
    // back through it for drivers where values() is unavailable.
    let rows = await mods.values();
    if (!Array.isArray(rows)) rows = Object.values((await mods.all()) ?? {});
    return rows
      .filter((r) => r && r.userId)
      .sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
  } catch (_) {
    return [];
  }
}

module.exports = {
  isOwner,
  isMod,
  isModOrOwner,
  requireAccess,
  isValidId,
  addMod,
  removeMod,
  listMods,
};
