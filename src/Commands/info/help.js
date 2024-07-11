const { EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require("discord.js");



/**
 * 
 * @param {import("discord.js").ChatInputCommandInteraction | import("discord.js").Message } interaction 
 * @returns {import("discord.js").MessageReplyOptions}
 */
function help(interaction) {
  let em = new EmbedBuilder()
    .setAuthor({ name: interaction.client.user.username, iconURL: interaction.client.user.displayAvatarURL() })
    .setColor("White")
    .setTimestamp()
    .setThumbnail(interaction.client.user.displayAvatarURL())
    .setTitle("Help Commands | قائمة الاوامر ")
    .addFields([
      { name: "/help", value: "Shows this message || اوامر المساعدة", inline: true },
      { name: "/ping", value: "Shows bot ping || البنج", inline: true },
      { name: "/setup", value: "setup radio channel || تسطيب القناه الصوتية", inline: true },
      { name: "/control", value: "control radio channel || التحكم بالراديو", inline: true }
    ])
    .setFooter({
      text: interaction.author ? `Requested by ${interaction.author.globalName}` : `Requested by ${interaction.member.user.globalName}`,
      iconURL: interaction.author ? interaction.author.displayAvatarURL() : interaction.member.user.displayAvatarURL()
    })

  let btninvite = new ButtonBuilder()
    .setURL("https://discord.com/oauth2/authorize?client_id=1110669204295790703")
    .setStyle("Link")
    .setLabel("Invite Me")
  let btnsupport = new ButtonBuilder()
    .setURL("https://discord.gg/devxor")
    .setStyle("Link")
    .setLabel("Support Server")

  let row = new ActionRowBuilder().addComponents(btninvite, btnsupport)

  return { embeds: [em], components: [row] }
}


/**
 * @type {import("@utils/types/baseCommand")}
 */
module.exports = {
  name: "help",
  description: "Help commands",
  category: "UTILITY",
  botPermissions: ["SendMessages"],
  userPermissions: ["SendMessages"],
  cooldown: 1000,
  command: {
    enabled: true,
    minArgsCount: 0,
  },
  slashCommand: {
    enabled: true,
  },

  async msgExecute(client, message, args, lang) {
    try {

      message.reply(help(message))

    } catch (err) {
      console.log(err)
    }

  },

  async interactionExecute(client, interaction, lang) {
    try {

      interaction.reply(help(interaction));

    } catch (err) {
      console.log(err);
      interaction.reply({
        content: "An error occurred while executing the command",
        ephemeral: true,
      });
    }

  },
};
