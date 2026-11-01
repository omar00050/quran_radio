const buildControlPanel = require('@utils/functions/ControlData');
const { t } = require('@utils/functions/i18n');
const { say } = require("@utils/functions/messages");
const joinAndPlayQuran = require('@utils/functions/joinAndPlayQuran');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');

/**
 * @type {import("@utils/types/baseCommand")}
 */
module.exports = {
  name: "control",
  description: "control radio panel",
  category: "ADMIN",
  botPermissions: ["ManageChannels", "SendMessages", "ViewChannel"],
  userPermissions: ["ManageChannels"],
  cooldown: 1000,
  command: {
    enabled: false,
    minArgsCount: 1,
  },
  slashCommand: {
    enabled: true,
  },

  async msgExecute(client, message, args, lang) {
    try {
      const db = await client.db.table("channels");

      // NOTE: previously referenced `interaction.guildId` here, which does not
      // exist on the prefix path and threw a ReferenceError. Unreachable while
      // `command.enabled` is false, but wrong either way.
      const data = await db.get(`${message.guildId}_radioChannel`);

      const panel = buildControlPanel(client, data, lang);
      if (panel.content && !panel.components) return message.reply(panel);

      message.channel.send(panel);

    } catch (err) {
      client.logger?.error?.("control.msgExecute", err);
    }
  },

  async interactionExecute(client, interaction, lang) {
    await interaction.deferReply({ ephemeral: true })
    try {
      const db = await client.db.table("channels");

      const data = await db.get(`${interaction.guildId}_radioChannel`)

      // Built once: the old code called the builder up to three times per run.
      const panel = buildControlPanel(client, data, lang)

      // Not set up yet — the builder returns plain text instead of a panel.
      if (panel.content && !panel.components) return interaction.editReply({ content: panel.content })

      // Remove the previous panel so the guild is never left with two, which
      // also clears any surviving embed-based panel from before Components v2.
      if (data?.ch && data?.msgId) {
        const oldChannel = interaction.guild.channels.cache.get(data.ch)
        const oldMsg = oldChannel ? await oldChannel.messages.fetch(data.msgId).catch(() => null) : null
        if (oldMsg) await oldMsg.delete().catch(() => { })
      }

      const msg = await interaction.channel.send(panel)
      if (!msg) return interaction.editReply({ content: say(lang, "radio.errors.cannot_post_panel") })

      await db.set(`${interaction.guildId}_radioChannel..ch`, interaction.channelId)
      await db.set(`${interaction.guildId}_radioChannel..msgId`, msg.id)
      interaction.editReply({ content: say(lang, "radio.panel.panel_sent") })


    } catch (err) {
      interaction.editReply({ content: say(lang, "radio.errors.cannot_post_panel") }).catch(() => { })
      client.logger?.error?.(`control: cannot post panel in ${interaction.guild?.id}`, err);
    }
  },
};
