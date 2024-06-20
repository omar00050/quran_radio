const { CommandHandler } = require("@src/handlers");
const BEV = require("@utils/types/baseEvents");

/** @type {BEV.BaseEvent<"interactionCreate">} */
module.exports = {
  name: "interactionCreate",
  async execute(client, interaction) {
    try {
      // Check if interaction has guild
      if (!interaction.guild?.id) return interaction.reply({
        content: "Command can only be executed in a discord server",
        ephemeral: true
      });

      let lang_type = await client.db.get(`${interaction.guild.id}_lang`) || "en";
      let lang = require(`@root/lang/${lang_type}.json`);

      // Check if interaction is a command
      if (interaction.isChatInputCommand()) CommandHandler.handleSlashCommand(client, interaction)
      if (interaction.isAutocomplete()) CommandHandler.handleAutoComplete(client, interaction);

      // Check if interaction is a button, select menu or modal submit
      if (
        interaction.isButton()
        || interaction.isModalSubmit()
        || interaction.isAnySelectMenu()
      ) {
        if (interaction?.customId?.startsWith('collect')) return;

        if (client.UserHold.get(interaction.user.id)) return interaction.reply({ content: 'You are hold this button please waiting and try again.', ephemeral: true })

        let customId = interaction?.customId;

        const parts = customId?.split('_');

        // Check if interaction is a button
        const component = client.ComponentsAction.get(`${parts[0]}_${parts[1]}`) || client.ComponentsAction.get(`${parts[0]}_${parts[1]}_${parts[2]}`) || client.ComponentsAction.get(parts[0]) || client.ComponentsAction.get(customId);

        if (!component) return;


        await component.action(client, interaction, parts);
      };
    } catch (error) {
      console.error(error);

      interaction.isRepliable ? await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true }) : interaction.editReply({ content: 'There was an error while executing this command!' })
    };
  },
};