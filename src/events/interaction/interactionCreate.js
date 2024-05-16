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
      if (interaction.isChatInputCommand()) CommandHandler.handleSlashCommand(client, interaction, lang)
      if (interaction.isAutocomplete()) CommandHandler.handleAutoComplete(client, interaction, lang);

      // Check if interaction is a button, select menu or modal submit
      if (
        interaction.isButton()
        || interaction.isModalSubmit()
        || interaction.isAnySelectMenu()
      ) {
        if (interaction?.customId?.startsWith('collect')) return;

        let customId = interaction?.customId;

        const parts = customId?.split('_');

        /**
         * @type {import("@base/baseComponent")}
         */
        // Check if interaction is a button
        const component = client.ComponentsAction.get(`${parts[0]}_${parts[1]}`) || client.ComponentsAction.get(`${parts[0]}_${parts[1]}_${parts[2]}`) || client.ComponentsAction.get(parts[0]) || client.ComponentsAction.get(customId);
        if (!component) return;


        await component.action(client, interaction, parts, lang);
      };
    } catch (error) {
      console.error(error);
      await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
    };
  },
};