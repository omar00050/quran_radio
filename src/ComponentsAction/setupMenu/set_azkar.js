const ControlAzkar = require("@root/src/utils/functions/ControlAzkar");
const { t } = require("@utils/functions/i18n");
const { say } = require("@utils/functions/messages");
const { missingTextPermissions } = require("@utils/functions/radioGuards");
const { ChannelType } = require("discord.js");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "set_AzkarChannel",
  enabled: true,
  /**
   * @param {import("discord.js").ChannelSelectMenuInteraction} interaction 
   */
  async action(client, interaction, parts, lang) {
    try {

      const db = await client.db.table("channels");
      const channel = interaction.channels.first();

      // All validation happens BEFORE deferUpdate. The old code called
      // deferUpdate() first and then interaction.reply() on these guard paths,
      // which throws because the interaction is already acknowledged — the
      // error was swallowed by the catch and the user got no feedback at all.
      if (!channel) {
        return interaction.reply({ content: say(lang, "setup.errors.channel_not_found"), ephemeral: true });
      }

      if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        return interaction.reply({
          content: say(lang, "setup.errors.not_text_channel", { channel: `<#${channel.id}>` }),
          ephemeral: true,
        });
      }

      // Without these the service silently never posts anything.
      const missing = missingTextPermissions(interaction.guild, channel);
      if (missing.length) {
        return interaction.reply({
          content: say(lang, "setup.errors.missing_permissions", {
            channel: `<#${channel.id}>`,
            permissions: missing.map((name) => t(lang, `permissions.${name}`)).join(", "),
          }),
          ephemeral: true,
        });
      }

      const data = await db.get(`${interaction.guildId}_azkarChannel`)

      if (data?.channelId === channel.id) {
        return interaction.reply({
          content: say(lang, "setup.errors.already_set", { channel: `<#${channel.id}>` }),
          ephemeral: true,
        });
      }

      await interaction.deferUpdate()

      await db.set(`${interaction.guildId}_azkarChannel`, {
        channelId: channel.id,
        guildId: interaction.guildId,
        enabled: data?.enabled || false,
        msgTimeSend: data?.msgTimeSend || "10m",
        category: data?.category || [],
        roles: data?.roles || [],
        lastSned: data?.lastSned || 0
      })

      const data2 = await db.get(`${interaction.guildId}_azkarChannel`)

      interaction.editReply({
        ...ControlAzkar(client, data2, lang),
        content: say(lang, "setup.success.azkar_channel_set", { channel: `<#${channel.id}>` }),
      })


    } catch (err) {
      client.logger?.error?.("set_AzkarChannel", err);
      if (!interaction.replied && !interaction.deferred) {
        interaction.reply({ content: say(lang, "common.unexpected"), ephemeral: true }).catch(() => { });
      }
    }
  },
};