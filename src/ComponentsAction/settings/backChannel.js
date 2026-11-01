const { switchStation, currentIndex } = require("@utils/functions/switchStation");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "back_channel",
  enabled: true,
  /**
   * @param {import("discord.js").ButtonInteraction} interaction
   */
  async action(client, interaction, parts, lang) {
    return switchStation(client, interaction, lang, (data, stations) => {
      const index = currentIndex(data);
      // Wraps to the end of the list when already at the first station, and
      // when the current station is unknown.
      const prev = index <= 0 ? stations.length - 1 : index - 1;
      return stations[prev]?.value;
    });
  },
};
