const { Collection } = require('discord.js');
const { parsePermissions } = require('@utils/class/utils');
const ms = require("ms")
const delay = new Collection();

module.exports = {
  /**
   * @param {import("@root/src/base/baseClient")} client 
   * @param {import("discord.js").Message} message 
   * @returns {Promise<void>}
   */
  handlePrefixCommand: async function (client, message) {

    /** @type {string} */
    const prefix = await client.db.get(`${message.guildId}_prefix`) || await client.config.prefix;



    if (!message.content.startsWith(prefix) || message.author.bot) return;

    /** @type {Array} */
    const args = message.content.slice(prefix.length).trim().split(/ +/);

    const commandName = args.shift().toLowerCase();

    /** @type {import("@utils/types/baseCommand")} */
    let cmd = client.commands.get(commandName) || client.commands.find(cmd => cmd.command.aliases && cmd.command.aliases.includes(commandName));
    if (!cmd) return;



    if (!message.channel.permissionsFor(message.guild.members.me).has("SendMessages")) return;

    // Owner commands
    if (
      cmd.category === "OWNER"
      && !client.config.owners.includes(message.author.id)
    ) {
      return message.reply("This command is only accessible to bot owners");
    }

    // check user permissions
    if (cmd.userPermissions && cmd.userPermissions?.length > 0) {
      if (!message.channel.permissionsFor(message.member).has(cmd.userPermissions)) {
        return message.reply(`You need ${parsePermissions(cmd.userPermissions)} for this command`);
      }
    }
    // check bot permissions
    if (cmd.botPermissions && cmd.botPermissions.length > 0) {
      if (!message.channel.permissionsFor(message.guild.members.me).has(cmd.botPermissions)) {
        return message.reply(`I need ${parsePermissions(cmd.botPermissions)} for this command`);
      }
    }


    const cmd_disabled = await client.db.get("disabledcommands") || null

    if (cmd_disabled?.disabledcommands.includes(cmd.name)) return;

    if (cmd.cooldown) {

      let com = `pre_${message.author.id}/${cmd.name}`

      if (delay.has(com)) {
        let lef = delay.get(com) - Date.now();
        return message.reply(`**⏰ - Please wait ${ms(delay.get(com) - Date.now(), { long: true })} to use this command.**`).then(msg => {
          setTimeout(() => msg?.delete(), 5000);
        })
      }

      delay.set(com, Date.now() + cmd.cooldown)

      setTimeout(() => {
        delay.delete(com)
      }, cmd.cooldown)
    }


    /**
     TODO: support soon 
        // minArgs count
        if (cmd.command.minArgsCount > args.length) {
          const usageEmbed = this.getCommandUsage(cmd, prefix, invoke);
          return message.reply({ embeds: [usageEmbed] });
        }
    */


    try {
      cmd.msgExecute(client, message, args)
    } catch (ex) {
      message.client.logger.error("messageRun", ex);
      message.reply("An error occurred while running this command");
    }
  },


  /**
   * @param {import("@root/src/base/baseClient")} client 
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  handleSlashCommand: async function (client, interaction) {


    const cmd = client.slashCommands.get(interaction.commandName);

    if (!cmd) return interaction.reply({ content: "An error has occurred", ephemeral: true }).catch(() => { });


    // Owner commands
    if (
      cmd.category === "OWNER" &&
      !client.config.owners.includes(interaction.user.id)) {
      return interaction.reply({
        content: `This command is only accessible to bot owners`,
        ephemeral: true,
      });
    }

    // user permissions
    if (interaction.member && cmd.userPermissions?.length > 0) {
      if (!interaction.member.permissions.has(cmd.userPermissions)) {
        return interaction.reply({
          content: `:rolling_eyes: You need ${parsePermissions(cmd.userPermissions)} for this command`,
          ephemeral: true,
        });
      }
    }

    // bot permissions
    if (cmd.botPermissions && cmd.botPermissions.length > 0) {
      if (!interaction.guild.members.me.permissions.has(cmd.botPermissions)) {
        return interaction.reply({
          content: `:rolling_eyes: I need ${parsePermissions(cmd.botPermissions)} for this command`,
          ephemeral: true,
        });
      }
    }


    if (cmd.cooldown) {
      let com = `${interaction.user.id}/${interaction.commandName}`
      if (delay.has(com)) {
        let lef = delay.get(com) - Date.now();
        return interaction.reply({ content: `**⏰ - Please wait ${ms(delay.get(com) - Date.now(), { long: true })} to use this command.**`, ephemeral: true })
      } else {
        delay.set(com, Date.now() + cmd.cooldown)
        setTimeout(() => {
          delay.delete(com)
        }, cmd.cooldown)
      }
    }

    try {

      await cmd.interactionExecute(client, interaction);
    } catch (error) {
      client.logger.error("interactionRun", error);
    }

  },

  /**
   * @param {import("@root/src/base/baseClient")} client 
   * @param {import("discord.js").AutocompleteInteraction} interaction
   */
  handleAutoComplete: async function (client, interaction) {

    const cmd = client.slashCommands.get(interaction.commandName);

    if (!cmd) return interaction.reply({ content: "An error has occurred", ephemeral: true }).catch(() => { });

    try {
      await cmd.autocompleteExecute(client, interaction);
    } catch (error) {
      client.logger.error("autoCompleteRun", error);
    }
  }
}


