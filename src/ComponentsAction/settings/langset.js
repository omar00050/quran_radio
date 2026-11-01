const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const { t, setGuildLang, resolveLangCode, loadLang, SUPPORTED } = require("@utils/functions/i18n");
const { say } = require("@utils/functions/messages");
const updateControlPanel = require("@utils/functions/updateControlPanel");
const { safeGet } = require("@utils/functions/dbSafe");

/**
 * Language chooser, shared by `/lang` and the first-use prompt.
 *
 * customIds are `langset_<code>_<source>`, e.g. `langset_ar_prompt`. The source
 * only distinguishes where the choice came from for the statistics; it grants
 * nothing.
 *
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "langset",
  enabled: true,
  /**
   * @param {import("discord.js").ButtonInteraction} interaction
   * @param {string[]} parts ["langset", code, source]
   */
  async action(client, interaction, parts, lang) {
    const code = parts[1];
    const source = parts[2] === "prompt" ? "prompt" : "command";

    try {
      if (!SUPPORTED.includes(code)) return;

      // Re-checked here, not just when the buttons were rendered: anyone who
      // can see the message could otherwise replay this customId.
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({
          content: say(lang, "lang.no_permission"),
          flags: MessageFlags.Ephemeral,
        });
      }

      const current = await resolveLangCode(client, interaction.guildId);
      const newLang = loadLang(code);

      if (current === code && await safeGet(client.db, `${interaction.guildId}_lang`)) {
        return interaction.reply({
          content: say(newLang, "lang.already", { name: t(newLang, `lang.name_${code}`) }),
          flags: MessageFlags.Ephemeral,
        });
      }

      await setGuildLang(client, interaction.guildId, code, source, interaction.user.id);

      // Confirm in the language just chosen — clearer feedback than answering
      // in the language being replaced.
      await interaction.reply({
        content: say(newLang, "lang.changed", { name: t(newLang, `lang.name_${code}`) }),
        flags: MessageFlags.Ephemeral,
      });

      // The control panel is long-lived, so it has to be re-rendered in the new
      // language. migrate:true because this is a deliberate user action, so
      // converting an old embed panel now is appropriate.
      const channels = await client.db.table("channels");
      const data = await safeGet(channels, `${interaction.guildId}_radioChannel`);
      if (data?.ch) {
        await updateControlPanel(client, interaction.guild, data, newLang, { migrate: true })
          .catch((err) => client.logger?.debug?.(`[langset] panel refresh failed: ${err.message}`));
      }

      client.logger?.log?.(
        `[lang] ${interaction.guildId} -> ${code} (${source}) by ${interaction.user.id}`,
      );
    } catch (err) {
      client.logger?.error?.("langset", err);
    }
  },
};
