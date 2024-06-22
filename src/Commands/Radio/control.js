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
    enabled: false,
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
    await interaction.deferReply({ ephemeral: true })
    try {

      let data = await client.db.table("channels").get(`${interaction.guildId}_radioChannel`)

      if (controlData(client, data)?.content) return interaction.editReply(controlData(client, data))

      let msg = await interaction.channel.send(controlData(client, data))
      if (!msg) return interaction.editReply({ content: ":warning: | ليس لدي صلاحيه لارسال الرساله داخل القناه " })
      await client.db.table("channels").set(`${interaction.guildId}_radioChannel..ch`, interaction.channelId)
      await client.db.table("channels").set(`${interaction.guildId}_radioChannel..msgId`, msg.id)
      interaction.editReply({ content: "**تم ارسال لوحه التحكم**", ephemeral: true })


    } catch (err) {
      interaction.editReply({ content: "**:warning: | ليس لدي صلاحيه لارسال الرساله داخل القناه **" })

      console.log(err.message + `Server: ${interaction.guild.name} cant send message`);
    }
  },
};
