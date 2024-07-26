const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, ChannelSelectMenuBuilder, ChannelType } = require('discord.js');

/**
 * @type {import("@utils/types/baseCommand")}
 */
module.exports = {
  name: "setup",
  description: "setup radio channel",
  category: "ADMIN",
  botPermissions: [""],
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

    } catch (err) {
      console.log(err)
    }

  },

  async interactionExecute(client, interaction, lang) {
    try {

      let config = client.config

      let embed = new EmbedBuilder()
        .setColor("White")
        .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: config.DevXorLink })
        .setThumbnail(client.user.avatarURL({ size: 2048 }))
        .setTitle("قائمه تسطيب القناه الصوتية ")
        .setDescription("يمكنك  تحديد القناه الصوتية او التسطيب التلقائي")
        .setFooter({ text: config.Copyright.text, iconURL: config.Copyright.logo })

      //todo : add new quick setup for radio 
      let btn_setup = new ButtonBuilder()
        .setCustomId("setup_Radio")
        .setLabel("Quick Setup")
        .setStyle(ButtonStyle.Primary)

      let Menu_setChannel = new ChannelSelectMenuBuilder()
        .setCustomId("set_RadioChannel")
        .setPlaceholder("Setup Radio Channel")
        .setChannelTypes(ChannelType.GuildVoice)
      let row = new ActionRowBuilder()
        .addComponents(Menu_setChannel)

      interaction.reply({ embeds: [embed], components: [row], ephemeral: true })
    } catch (err) {
      console.log(err.message);
    }

  },
};
