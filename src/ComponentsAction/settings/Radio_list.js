const controlData = require("@utils/functions/ControlData");
const RadioChannels = require("@utils/functions/RadioChannels");
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
      await interaction.deferUpdate()
      let data = await client.db.table("channels").get(`${interaction.guildId}_radioChannel`)

      let isConn = client.Radio.get(`${interaction.guildId}`)
      if (isConn) {
        let conn = await joinAndPlayQuran(client, data.channelId, interaction.guild, interaction.values[0], true)
        if (conn == null) return interaction.followUp({ content: "❌ | لم يتم العثور علي القناه الصوتيه" })
        if (conn == "cantConnect") return interaction.followUp({ content: ":warning: | لا يمكن للبوت الدخول للقناه الصوتيه" })
        // client.Radio.set(`${interaction.guildId}`, conn)

      }


      await client.db.table("channels").set(`${interaction.guildId}_radioChannel..url`, interaction.values[0])

      // interaction.followUp({ content: "✅ | تم تشغيل الراديو", ephemeral: true })
      let data2 = await client.db.table("channels").get(`${interaction.guildId}_radioChannel`)

      interaction.editReply(controlData(client, data2))


    } catch (err) {
      console.log(err)
    }
  },
};