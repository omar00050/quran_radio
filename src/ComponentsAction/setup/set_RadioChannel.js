const { ButtonStyle, ButtonBuilder, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "set_RadioChannel",
  enabled: true,
  async action(client, interaction, parts, lang) {
    try {

      let modal = new ModalBuilder()
        .setCustomId("Modal_set_RadioChannel")
        .setTitle("Set Radio Channel")

      let textInput = new TextInputBuilder()
        .setCustomId("RadioChannel")
        .setLabel("Channel ID")
        .setPlaceholder("Put Channel ID ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
      let text = new ActionRowBuilder().addComponents(textInput)

      modal.addComponents(text)

      return interaction.showModal(modal)
    } catch (err) {
      console.log(err)
    }
  },
};