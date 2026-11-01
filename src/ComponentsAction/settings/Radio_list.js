const { switchStation } = require("@utils/functions/switchStation");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "Radio_list",
  enabled: true,
  /**
   * Station picked from one of the two select menus.
   * @param {import("discord.js").StringSelectMenuInteraction} interaction
   */
  async action(client, interaction, parts, lang) {
    return switchStation(client, interaction, lang, () => interaction.values?.[0]);
  },
};
