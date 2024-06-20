const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');

/**
 * @type {import("@utils/types/baseCommand")}
 */
module.exports = {
  name: "setup",
  description: "setup radio channel",
  category: "ADMIN",
  botPermissions: ["ManageChannels","ManageGuild"],
  userPermissions: ["ManageChannels",'ManageGuild'],
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

    } catch (err) {
      console.log(err)
    }

  },

  async interactionExecute(client, interaction, lang) {
    try {

      let config = client.db.config_get

      let embed = new EmbedBuilder()
        .setColor("White")
        .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: config.DevXorLink })
        .setTitle("قائمه تسطيب القناه الصوتية ")
        .setDescription("يمكنك  تحديد القناه الصوتية او التسطيب التلقائي")
        .setFooter({ text: config.Copyright.text, iconURL: config.Copyright.logo })

      //todo : add new quick setup for radio 
      let btn_setup = new ButtonBuilder()
        .setCustomId("setup_Radio")
        .setLabel("Quick Setup")
        .setStyle(ButtonStyle.Primary)

      let btn_setChannel = new ButtonBuilder()
        .setCustomId("set_RadioChannel")
        .setLabel("Setup set Channel")
        .setStyle(ButtonStyle.Primary)
      let row = new ActionRowBuilder()
        .addComponents(btn_setChannel)

      interaction.reply({ embeds: [embed], components: [row], ephemeral: true })
    } catch (err) {
      console.log(err.message);
    }

  },
};
