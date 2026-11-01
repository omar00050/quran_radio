const { switchStation, currentIndex } = require("@utils/functions/switchStation");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "random_channel",
  enabled: true,
  /**
   * @param {import("discord.js").ButtonInteraction} interaction
   */
  async action(client, interaction, parts, lang) {
    return switchStation(client, interaction, lang, (data, stations) => {
      if (stations.length <= 1) return stations[0]?.value;
      // Never pick the station that is already playing — a "random" button
      // that changes nothing looks broken.
      const current = currentIndex(data);
      let pick = Math.floor(Math.random() * (stations.length - 1));
      if (current !== -1 && pick >= current) pick += 1;
      return stations[pick]?.value;
    });
  },
};
