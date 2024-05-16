const { prefix, owners } = require('@root/config.json');
const { Collection, PermissionsBitField } = require("discord.js");
const delay = new Collection();
const fs = require("fs");
const ms = require("ms");
const lang = require("@root/lang/en.json");
const { CommandHandler } = require('@src/handlers');


module.exports = {
  name: "messageCreate",
  /**
   * @param {import("@root/src/base/baseClient")} client 
   * @param {import("discord.js").Message} message 
   * @returns {Promise<void>}
   */
  async execute(client, message) {
    try {
      if (message.author.bot || !message.guild) return;

      CommandHandler.handlePrefixCommand(client, message, lang);

    } catch (error) {
      console.error(error);

      message.reply('there was an error trying to execute that command!');
    }
  }
}

