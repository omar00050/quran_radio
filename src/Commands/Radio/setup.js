const ControlAzkar = require('@root/src/utils/functions/ControlAzkar');
const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, ChannelSelectMenuBuilder, ChannelType, ApplicationCommandOptionType } = require('discord.js');

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
    options: [
      {
        name: "radio",
        description: "to setup radio channel",
        type: ApplicationCommandOptionType.Subcommand
      },
      {
        name: "azkar",
        description: "to setup azkar channel",
        type: ApplicationCommandOptionType.Subcommand
      }
    ],
  },

  async msgExecute(client, message, args, lang) {
    try {

    } catch (err) {
      console.log(err)
    }

  },

  async interactionExecute(client, interaction, lang) {
    try {
      const db = await client.db.table("channels");

      const Subcommand = interaction.options.getSubcommand()
      let config = client.config

      switch (Subcommand) {
        case "radio": {

          let data = await db.get(`${interaction.guildId}_radioChannel`) || null

          let embed = new EmbedBuilder()
            .setColor("White")
            .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: config.DevXorLink })
            .setThumbnail(client.user.avatarURL({ size: 2048 }))
            .setTitle("قائمه تسطيب القناه الصوتية ")
            .setDescription("يمكنك  تحديد القناه الصوتية   ")
            // Todo: make a quick setup for radio
            // .setDescription("يمكنك  تحديد القناه الصوتية او التسطيب التلقائي")
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
          if (data?.ch) Menu_setChannel.setDefaultChannels([data?.ch])
          let rowMenu = new ActionRowBuilder().addComponents(Menu_setChannel)
          let rowQuick = new ActionRowBuilder().addComponents(btn_setup)

          interaction.reply({ embeds: [embed], components: [rowMenu], ephemeral: true })
          break;
        }

        case "azkar": {

          let data = await db.get(`${interaction.guildId}_azkarChannel`) || null
          let channel = interaction.guild.channels.cache.get(data?.channelId) || null

          let embed = new EmbedBuilder()
            .setColor("White")
            .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: config.DevXorLink })
            .setThumbnail(client.user.avatarURL({ size: 2048 }))
            .setTitle("قائمه تسطيب قناه الأذكار ")
            .setDescription("يمكنك  تحديد قاناه الاذكار")
            .setFooter({ text: config.Copyright.text, iconURL: config.Copyright.logo })

          let Menu_setChannel = new ChannelSelectMenuBuilder()
            .setCustomId("set_AzkarChannel")
            .setPlaceholder("Setup Azkar Channel")
            .setChannelTypes(ChannelType.GuildText)
          
          let rowMenu = new ActionRowBuilder().addComponents(Menu_setChannel);

          if (channel?.id) return interaction.reply({
            ...ControlAzkar(client, data),
            ephemeral: true
          })

          interaction.reply({ embeds: [embed], components: [rowMenu], ephemeral: true });
          break;
        }
      }

    } catch (err) {
      console.log(err.message);
    }

  },
};
