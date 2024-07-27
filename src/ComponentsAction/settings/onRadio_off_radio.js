const controlData = require("@utils/functions/ControlData");
const RadioChannels = require("@utils/functions/RadioChannels");
const joinAndPlayQuran = require("@utils/functions/joinAndPlayQuran");
const { ButtonStyle, ButtonBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ModalSubmitInteraction, ChannelType, EmbedBuilder } = require("discord.js");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "onRadio_off_radio",
  enabled: true,
  /**
   * @param {ModalSubmitInteraction} interaction 
   */
  async action(client, interaction, parts, lang) {
    try {
      await interaction.deferUpdate()
      await client.wait(200)
      const config = client.config


      let data = await client.db.table("channels").get(`${interaction.guildId}_radioChannel`)

      let findRadio = RadioChannels.find(r => r.value == data.url)


      if (!data.enabled) {
        let conn = await joinAndPlayQuran(client, data.channelId, interaction.guild, data.url)
        if (conn == null) return interaction.followUp({ content: "❌ | لم يتم العثور علي القناه الصوتيه" })
        if (conn == "cantConnect") return interaction.followUp({ content: ":warning: | لا يمكن للبوت الدخول للقناه الصوتيه" })

        client.Radio.set(`${interaction.guildId}`, conn)
        await client.db.table("channels").set(`${interaction.guildId}_radioChannel..enabled`, true)

        // interaction.followUp({ content: "✅ | تم تشغيل الراديو", ephemeral: true })

      } else {
        let conn = client.Radio.get(`${interaction.guildId}`)
         conn.player.stop(true)
         conn.destroy()
        // interaction.followUp({ content: "✅ | تم ايقاف الراديو", ephemeral: true })
        await client.db.table("channels").set(`${interaction.guildId}_radioChannel..enabled`, false)
        client.Radio.delete(`${interaction.guildId}`)
      }

      let data2 = await client.db.table("channels").get(`${interaction.guildId}_radioChannel`)

      interaction.editReply(controlData(client, data2))


    } catch (err) {
      console.log(err)
    }
  },
};