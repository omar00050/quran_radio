const { switchStation, currentIndex } = require("@utils/functions/switchStation");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "next_channel",
  enabled: true,
  /**
   * @param {import("discord.js").ButtonInteraction} interaction
   */
  async action(client, interaction, parts, lang) {
    return switchStation(client, interaction, lang, (data, stations) => {
      // Wraps around at the end of the list; an unknown current station
      // (index -1) starts from the first one.
      const next = (currentIndex(data) + 1) % stations.length;
      return stations[next]?.value;
    });
  },
};
