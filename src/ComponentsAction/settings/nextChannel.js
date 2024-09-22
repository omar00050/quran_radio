const RadioChannels = require("@root/src/utils/helpers/RadioChannels");
const controlData = require("@utils/functions/ControlData");
const joinAndPlayQuran = require("@utils/functions/joinAndPlayQuran");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "next_channel",
  enabled: true,
  /**
   * @param {import("discord.js").ButtonInteraction} interaction 
   */
  async action(client, interaction, parts, lang) {
    try {

      if (!interaction.guild.members.me?.voice?.channel) return interaction.reply({
        content: "**يجب تشغيل البوت في روم صوتي**",
        ephemeral: true
      });
      if (interaction.guild.members.me?.voice?.channel.id !== interaction?.member?.voice?.channel?.id) return interaction.reply({
        content: `لا يمكنك التحكم بالراديو و انت لست داخل القناه الصوتية \`${interaction.guild.members.me?.voice?.channel.name}\` ادخل اولا و يمكنك التحكم`,
        ephemeral: true
      });

      const db = await client.db.table("channels");

      await interaction.deferUpdate();

      let data = await db.get(`${interaction.guildId}_radioChannel`);
      let Indexlink = RadioChannels.findIndex(r => r.value == data?.url) + 1;
      let link = RadioChannels[Indexlink]?.value || RadioChannels[0]?.value;
      let isConn = client.Radio.get(`${interaction.guildId}`);
      if (isConn) {
        let conn = await joinAndPlayQuran(client, data.channelId, interaction.guild, link, true);
        console.log(`change Radio Channel Link: ${link} - Server : [${interaction.guild.name}]`.yellow);
        if (conn == null) return interaction.followUp({ content: "❌ | لم يتم العثور علي القناه الصوتيه" });
        if (conn == "cantConnect") return interaction.followUp({ content: ":warning: | لا يمكن للبوت الدخول للقناه الصوتيه" });
        // client.Radio.set(`${interaction.guildId}`, conn)

      }

      await db.set(`${interaction.guildId}_radioChannel..url`, link);

      // interaction.followUp({ content: "✅ | تم تشغيل الراديو", ephemeral: true })
      let data2 = await db.get(`${interaction.guildId}_radioChannel`);

      interaction.editReply(controlData(client, data2));


    } catch (err) {
      console.log(err)
    }
  },
};