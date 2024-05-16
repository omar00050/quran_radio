/**
 * @type {import("@utils/types/baseCommand")}
 */
module.exports = {
  name: "ping",
  description: "Test the bots response time",
  category: "UTILITY",
  botPermissions: ["SendMessages"],
  userPermissions: ["SendMessages"],
  cooldown: 1000,
  command: {
    enabled: true,
    minArgsCount: 1,
  },
  slashCommand: {
    enabled: true,
  },

  async msgExecute(client, message, args, lang) {
    try {
      lang
      message.reply({ content: `:ping_pong: **Pong ${client.ws.ping} ms**` })

    } catch (err) {
      console.log(err)
    }

  },

  async interactionExecute(client, interaction, lang) {
    try {

      interaction.reply({ content: `:ping_pong: **Pong ${client.ws.ping} ms**`, ephemeral: true });

    } catch (err) {
      console.log(err);
      interaction.reply({
        content: "An error occurred while executing the command",
        ephemeral: true,
      });
    }

  },
};
