const { recursiveReadDirSync } = require("@utils/class/utils");
const { ApplicationCommandOptionType, Events } = require("discord.js");

/**
 * @type {import("@utils/types/baseCommand")}
 */
module.exports = {
  name: "refrish",
  description: "To setup logs guild Events",
  category: "OWNER",
  botPermissions: ["ManageChannels", "ViewAuditLog"],
  userPermissions: ["ManageChannels", "ViewAuditLog"],
  cooldown: 1000,
  command: {
    enabled: true,
    aliases: ["re"],
    usage: "",
    subcommands: [{
      trigger: "all",
      description: "to load add commands"
    }],
    minArgsCount: 1,
  },
  slashCommand: {
    enabled: true,
    options: [
      {
        name: "commands",
        description: "the target member",
        type: ApplicationCommandOptionType.SubcommandGroup,
        options: [
          {
            name: "all",
            description: "refish commands",
            type: ApplicationCommandOptionType.Subcommand,
          }
        ]
      }
    ],
  },

  async msgExecute(client, message, args, lang) {

    const subCommand = args[0] || "all";

    switch (subCommand) {
      case "all": {

        recursiveReadDirSync("src/utils").forEach(filePath => {
          delete require.cache[require.resolve(filePath)];
        })
        let utils_count = recursiveReadDirSync("src/utils").length
        client.logger.success("done loaded utils :" + utils_count)
        client.loadComponents("src/ComponentsAction")
        client.loadCommands("src/cmd")

        const components = client.ComponentsAction.map(({ execute, ...data }) => data);
        const commands = client.commands.map(({ execute, ...data }) => data);

        let msgData = `\`\`\`DONE Load All Commands : ${commands.length}\nDONE Load All Components : ${components.length}\nDONE Load All Utils : ${utils_count}\`\`\``
        await message.reply({ content: msgData })
      }

        break;
    }

  },


  async interactionExecute(client, interaction, lang) {

    const subCommand = interaction.options.getSubcommand();

    switch (subCommand) {
      case "all": {

        recursiveReadDirSync("src/utils").forEach(filePath => {
          delete require.cache[require.resolve(filePath)];
        })
        let utils_count = recursiveReadDirSync("src/utils").length
        client.logger.success("done loaded utils :" + utils_count)
        client.loadComponents("src/ComponentsAction")
        client.loadCommands("src/cmd")

        const components = client.ComponentsAction.map(({ execute, ...data }) => data);
        const commands = client.commands.map(({ execute, ...data }) => data);

        let msgData = `\`\`\`DONE Load All Commands : ${commands.length}\nDONE Load All Components : ${components.length}\nDONE Load All Utils : ${utils_count}\`\`\``
        await interaction.reply({ content: msgData })
      }

        break;
    }



  },
};
