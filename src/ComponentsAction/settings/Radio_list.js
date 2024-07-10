const controlData = require("@utils/functions/ControlData");
const joinAndPlayQuran = require("@utils/functions/joinAndPlayQuran");
const { ButtonStyle, ButtonBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ModalSubmitInteraction, ChannelType, EmbedBuilder } = require("discord.js");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "Radio_list",
  enabled: true,
  /**
   * @param {ModalSubmitInteraction} interaction 
   */
  async action(client, interaction, parts, lang) {
    try {
      if (!interaction.guild.members.me?.voice?.channel) return interaction.reply({
        content: "**يجب تشغيل البوت في روم صوتي**",
        ephemeral: true
      })
      if (interaction.guild.members.me?.voice?.channel.id !== interaction?.member?.voice?.channel?.id) return interaction.reply({
        content: `لا يمكنك التحكم بالراديو و انت لست داخل القناه الصوتية \`${interaction.guild.members.me?.voice?.channel.name}\` ادخل اولا و يمكنك التحكم`,
        ephemeral: true
      });
      await interaction.deferUpdate()
      let data = await client.db.table("channels").get(`${interaction.guildId}_radioChannel`)
      let link = interaction.values[0]
      let isConn = client.Radio.get(`${interaction.guildId}`)
      if (isConn) {
        let conn = await joinAndPlayQuran(client, data.channelId, interaction.guild, link, true)
        console.log(`change Radio Channel Link: ${link} - Server : [${interaction.guild.name}]`.yellow);
        if (conn == null) return interaction.followUp({ content: "❌ | لم يتم العثور علي القناه الصوتيه" })
        if (conn == "cantConnect") return interaction.followUp({ content: ":warning: | لا يمكن للبوت الدخول للقناه الصوتيه" })
        // client.Radio.set(`${interaction.guildId}`, conn)

      }


      await client.db.table("channels").set(`${interaction.guildId}_radioChannel..url`, link)

      // interaction.followUp({ content: "✅ | تم تشغيل الراديو", ephemeral: true })
      let data2 = await client.db.table("channels").get(`${interaction.guildId}_radioChannel`)

      interaction.editReply(controlData(client, data2))


    } catch (err) {
      console.log(err)
    }
  },
};