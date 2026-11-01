'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { t, resolveLangCode, hasStoredLang } = require('./i18n');
const { safeGet, safeSet } = require('./dbSafe');

/**
 * One-time "this server is using X" tip.
 *
 * Shown the first time anything is used in a guild that has never chosen a
 * language. The command itself always runs first and in the default language;
 * this is a separate ephemeral follow-up to that one user.
 *
 * Three rules it must obey:
 *   1. never delay the command — it is sent after the handler has finished;
 *   2. never break the command — every failure is swallowed;
 *   3. show once per guild — a flag is written before sending, so a burst of
 *      simultaneous interactions cannot each send one.
 */

const FLAG_SUFFIX = '_langPrompt';

/** @returns {Promise<boolean>} whether the prompt still needs showing */
async function shouldPrompt(client, guildId) {
  // A saved language means the question is already answered.
  if (await hasStoredLang(client, guildId)) return false;
  return !(await safeGet(client.db, `${guildId}${FLAG_SUFFIX}`));
}

/**
 * Sends the tip. Safe to call unconditionally — it checks the flag itself and
 * resolves to false when there is nothing to do.
 *
 * @param {import("@base/baseClient")} client
 * @param {import("discord.js").Interaction} interaction
 * @returns {Promise<boolean>} whether a prompt was sent
 */
async function maybeSendLangPrompt(client, interaction) {
  try {
    const guildId = interaction.guildId;
    if (!guildId) return false;
    if (!interaction.isRepliable?.()) return false;
    if (!(await shouldPrompt(client, guildId))) return false;

    // Claim the slot *before* sending. Two interactions arriving together would
    // otherwise both pass the check and both send a tip.
    await safeSet(client.db, `${guildId}${FLAG_SUFFIX}`, Date.now());

    const code = await resolveLangCode(client, guildId);
    const lang = require('./i18n').loadLang(code);
    const canChange = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

    const payload = {
      content: `${t(lang, 'lang.prompt_tip', { name: t(lang, `lang.name_${code}`) })}`
        + (canChange ? '' : `\n-# ${t(lang, 'lang.no_permission')}`),
      flags: MessageFlags.Ephemeral,
    };

    // Buttons only for someone who could actually act on them. Anyone else is
    // told who can, rather than being shown a control that would refuse them.
    if (canChange) {
      payload.components = [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('langset_ar_prompt')
            .setLabel(t(lang, 'lang.btn_ar'))
            .setStyle(code === 'ar' ? ButtonStyle.Success : ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('langset_en_prompt')
            .setLabel(t(lang, 'lang.btn_en'))
            .setStyle(code === 'en' ? ButtonStyle.Success : ButtonStyle.Secondary),
        ),
      ];
    }

    // followUp needs the interaction already acknowledged. If the handler never
    // replied there is nothing to follow up on, so fall back to a fresh reply.
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);

    return true;
  } catch (_) {
    // A tip is never worth an error surfacing to the user. The flag has
    // already been written, so this will not retry on every interaction.
    return false;
  }
}

module.exports = { maybeSendLangPrompt, shouldPrompt, FLAG_SUFFIX };
