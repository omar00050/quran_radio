const controlData = require("@utils/functions/ControlData");
const RadioChannels = require("@root/src/utils/helpers/RadioChannels");
const joinAndPlayQuran = require("@utils/functions/joinAndPlayQuran");
const { stopWaiting } = require("@utils/functions/joinAndPlayQuran");
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
      const db = await client.db.table("channels");

      let data = await db.get(`${interaction.guildId}_radioChannel`);

      let findRadio = RadioChannels.find(r => r.value == data?.url);
      if (!findRadio) {
        findRadio = RadioChannels[0]
        // return interaction.followUp({
        //   content: ":warning: | Please change radio Channel to play | **من فضلك قم بتغير القناه بسبب عدم العثور عليها **",
        //   ephemeral: true
        // });
      }
      if (!data.enabled) {
        let conn = await joinAndPlayQuran(client, data.channelId, interaction.guild, data.url);
        if (conn == null) return interaction.followUp({ content: "❌ | لم يتم العثور علي القناه الصوتيه" });
        if (conn == "cantConnect") return interaction.followUp({ content: ":warning: | لا يمكن للبوت الدخول للقناه الصوتيه" });

        client.Radio.set(`${interaction.guildId}`, conn);
        await db.set(`${interaction.guildId}_radioChannel..enabled`, true);

        // interaction.followUp({ content: "✅ | تم تشغيل الراديو", ephemeral: true })

      } else {
        // Release any pending recovery wait first. Destroying the connection
        // and deleting the client.Radio entry below leaves the disconnected
        // handler unable to find it, so this is the only place that can clear
        // the station's `wanted` mark — without it the station stays exempt
        // from the idle sweep and retries forever for nobody.
        stopWaiting(client, interaction.guildId);

        let conn = client.Radio.get(`${interaction.guildId}`);
        if (!conn) {
          client.Radio.delete(`${interaction.guildId}`);
          await db.set(`${interaction.guildId}_radioChannel..enabled`, false);
          let data2 = await db.get(`${interaction.guildId}_radioChannel`);
          return interaction.editReply(controlData(client, data2));
        }
        conn.player.stop(true);
        if (conn.guildStream && !conn.guildStream.destroyed) conn.guildStream.destroy();
        conn.destroy();
        // interaction.followUp({ content: "✅ | تم ايقاف الراديو", ephemeral: true })
        client.rest.put(`/channels/${data.channelId}/voice-status`, { body: { status: "" } }).catch(() => { });

        await db.set(`${interaction.guildId}_radioChannel..enabled`, false);
        client.Radio.delete(`${interaction.guildId}`);
      }

      let data2 = await db.get(`${interaction.guildId}_radioChannel`);

      interaction.editReply(controlData(client, data2));


    } catch (err) {
      console.log(err);
    }
  },
};