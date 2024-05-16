
const { StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, Client, Message } = require("discord.js");
const { promisify } = require("util");
const { glob } = require("glob");

class CommandHandler {
  /**
   * The constructor function initializes properties for a client instance and command categories with a
   * specified prefix.
   * @param {import("@root/src/base/baseClient")} client - The `client` parameter typically refers to the Discord.js client instance that
   * represents your bot. This instance allows your bot to interact with the Discord API, send messages,
   * listen for events, and more.
   * @param {string}  prefix - The `prefix` parameter typically represents the character or characters that precede
   * a command in a chatbot or Discord bot. For example, if the prefix is set to `!`, then commands would
   * be triggered by messages starting with `!`.
   */
  constructor(client, prefix) {
    this.prefix = prefix;
    this.client = client; // Set your client instance here
    this.commandCategories = [];
  }


  addComponentGrop(...groups) {
    groups.forEach(({ name, emoji = "📜", files }) => {
      this.commandCategories.push({ name, emoji, files });
    });
  }
  /**
   * 
   * @param {Message} message 
   */
  createHelpMenu(message) {
    let menu = new StringSelectMenuBuilder();
    menu.setCustomId(`help_${message.author.id}`);
    menu.setPlaceholder("Choose a category");

    this.commandCategories.forEach(category => {
      menu.addOptions([{
        label: category.name,
        description: `To view the ${category.name} Commands`,
        emoji: category.emoji,
        value: category.name.toLowerCase()
      }]);
    });

    let row = new ActionRowBuilder().addComponents(menu);

    let embed = new EmbedBuilder()
    embed.setDescription(`**I am a developer`)
    embed.setImage("https://cdn.discordapp.com/attachments/1034202662079569981/1107332187650535504/dev_copy.gif")
    embed.setColor(message.guild.members.me.displayHexColor)
    embed.setTimestamp();

    message.reply({ embeds: [embed], components: [row] }).then(msg => {
      let filter = b => b.user.id === message.author.id && b.customId === `help_${message.author.id}`;

      let collector = msg.createMessageComponentCollector({ filter: filter, time: 60000 });

      collector.on("collect", async (b) => {
        const selectedCategoryName = b.values[0];
        const selectedCategory = this.commandCategories.find(category => category.name.toLowerCase() === selectedCategoryName);

        if (selectedCategory.files) {

          const rowEmbed = [];
          let remainingFiles = selectedCategory.files.slice();

          while (remainingFiles.length > 0) {
            let embed = new EmbedBuilder()

            embed.setColor(message.guild.members.me.displayHexColor)
            embed.setTimestamp();
            if (rowEmbed.length === 0) embed.setAuthor({
              name: `${selectedCategory.name} Commands:`,
              iconURL: this.client.user.displayAvatarURL({ dynamic: true })
            });

            const filesToAdd = remainingFiles.splice(0, 25); // Take the first 25 or less files

            filesToAdd.forEach(value => {
              const file = require(value);

              embed.addFields({
                name: `${this.prefix}${file.name}`,
                value: file?.description || " ",
                inline: true
              });
            });

            rowEmbed.push(embed);
          }

          b.update({ embeds: [...rowEmbed], components: [row] }).catch(err => { console.log(err); });
        }


      });

      collector.on('end', collected => {
        msg.edit({ components: [] }).catch(err => { console.log(err); });
        console.log(`Collected ${collected.size} items`);
      });

    });
  }
}

module.exports = CommandHandler;
