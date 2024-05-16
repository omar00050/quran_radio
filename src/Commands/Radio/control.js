const controlData = require('@utils/functions/ControlData');
const RadioChannels = require('@utils/functions/RadioChannels');
const joinAndPlayQuran = require('@utils/functions/joinAndPlayQuran');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');

/**
 * @type {import("@utils/types/baseCommand")}
 */
module.exports = {
  name: "control",
  description: "control radio panel",
  category: "ADMIN",
  botPermissions: ["ManageChannels"],
  userPermissions: ["ManageChannels"],
  cooldown: 1000,
  command: {
    enabled: true,
    minArgsCount: 1,
  },
  slashCommand: {
    enabled: true,
  },

  async msgExecute(client, message, args, lang) {
    try {
      let data = await client.db.table("channels").get(`${interaction.guildId}_radioChannel`)


      if (controlData(client, data)?.content) return message.reply(controlData(client, data))

      message.channel.send(controlData(client, data))

    } catch (err) {
      console.log(err)
    }
  },

  async interactionExecute(client, interaction, lang) {
    try {

      let data = await client.db.table("channels").get(`${interaction.guildId}_radioChannel`)

      if (controlData(client, data)?.content) return interaction.reply(controlData(client, data))

      interaction.reply({ content: "**تم ارسال لوحه التحكم**", ephemeral: true })

      let msg = await interaction.channel.send(controlData(client, data))
      await client.db.table("channels").set(`${interaction.guildId}_radioChannel..ch`, interaction.channelId)
      await client.db.table("channels").set(`${interaction.guildId}_radioChannel..msgId`, msg.id)


    } catch (err) {
      console.log(err);
    }
  },
};
