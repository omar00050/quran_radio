const controlData = require("@utils/functions/ControlData");
const joinAndPlayQuran = require("@utils/functions/joinAndPlayQuran");
const { ButtonStyle, ButtonBuilder, ChannelType, EmbedBuilder, ButtonInteraction } = require("discord.js");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "status_bot",
  enabled: true,
  /**
   * @param {ButtonInteraction} interaction 
   */
  async action(client, interaction, parts, lang) {
    try {

      let UserCount = client.guilds.cache.reduce((a, b) => a + b.memberCount, 0)

      let embed = new EmbedBuilder()
        .setTitle("**Bot Status** | **معلومات البوت**")
        .setColor("White")
        .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL(), url: client.config.DevXorLink })
        .setFooter({ text: client.config.Copyright.text, iconURL: client.config.Copyright.logo })
        // .setThumbnail(client.user.displayAvatarURL({ size: 4096 }))
        .setImage("https://i.pinimg.com/originals/6c/76/32/6c76328c235c489736330d743515500c.jpg")
        .addFields([
          {
            name: "Bot Name | اسم البوت",
            value: `**${client.user.username}**`,
            inline: true
          },
          {
            name: "Bot ID",
            value: `\`${client.user.id}\``,
            inline: true
          },
          {
            name: "Server Count | عدد السيرفرات",
            value: `\`${client.guilds.cache.size}\``,
            // inline: true
          },
          {
            name: "Channel Listening Count | عدد قنوات الاستماع",
            value: `\`${client.Radio.size}\``,
            // inline: true
          },
          {
            name: "Channel Azkar Count | عدد قنوات الاذكار",
            value: `\`${client.Azkar.size}\``,
            // inline: true
          },
          {
            name: "Channel Count | عدد القنوات",
            value: `\`${client.channels.cache.size}\``,
            // inline: true
          },
          {
            name: "User Count | عدد المستخدمين",
            value: `\`${UserCount}\``,
            // inline: true
          },
          {
            name: "Ping | سرعة استجابة البوت",
            value: `\`${client.ws.ping}ms\` 🏓`,
            inline: true
          },
          {
            name: "Version | الاصدار",
            value: `\`${require('../../../package.json').version}\``,
            inline: true
          },
          {
            name: "Developer | المطور",
            value: `**${require('../../../package.json').author.name}**`,
            inline: false
          },
          {
            name: "Developer github | حساب المطور",
            value: `**${require('../../../package.json').author.url}**`,
            inline: false
          },
        ])
      client.logger.log(`${client.user.username} Status Command has been used! | by user [${interaction.user.username}] | global name [${interaction.user.globalName}] |  in server ${interaction.guild.name} with ID [${interaction.guild.id}] `);
      interaction.reply({ embeds: [embed], ephemeral: true })

    } catch (err) {
      console.log(err)
    }
  },
};