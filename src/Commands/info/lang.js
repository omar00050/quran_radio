const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { t, resolveLangCode, hasStoredLang } = require('@utils/functions/i18n');

/**
 * Shows and changes the bot language for the server.
 *
 * Anyone may look at it. Only Manage Server may change it, and that is
 * re-checked when the button is pressed — not only here — because a component
 * customId can be used by anyone who can see the message.
 *
 * @type {import("@utils/types/baseCommand")}
 */
module.exports = {
  name: "lang",
  description: "Show or change the language the bot uses in this server",
  category: "UTILITY",
  botPermissions: ["SendMessages", "EmbedLinks"],
  userPermissions: [],
  cooldown: 3000,
  command: { enabled: false, minArgsCount: 0 },
  slashCommand: { enabled: true, options: [] },

  async msgExecute() { /* prefix form disabled */ },

  async interactionExecute(client, interaction, lang) {
    try {
      const code = await resolveLangCode(client, interaction.guildId);
      const stored = await hasStoredLang(client, interaction.guildId);

      const embed = new EmbedBuilder()
        .setColor("White")
        .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: client.config.DevXorLink })
        .setTitle(t(lang, "lang.title"))
        .setDescription(
          `${t(lang, "lang.current", { name: t(lang, `lang.name_${code}`) })}\n\n${t(lang, "lang.choose")}`
          + (stored ? "" : `\n\n-# ${t(lang, "lang.default_note")}`),
        )
        .setFooter({ text: client.config.Copyright.text, iconURL: client.config.Copyright.logo });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("langset_ar_cmd")
          .setLabel(t(lang, "lang.btn_ar"))
          .setStyle(code === "ar" ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("langset_en_cmd")
          .setLabel(t(lang, "lang.btn_en"))
          .setStyle(code === "en" ? ButtonStyle.Success : ButtonStyle.Secondary),
      );

      return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    } catch (err) {
      client.logger?.error?.("lang", err);
    }
  },
};
