const BEV = require("@utils/types/baseEvents");
const { reportGuild } = require("@utils/functions/statsReporter");

/**
 * Records a guild removal for the statistics history.
 *
 * Separate from guildDelete.js for the same reason as the join counterpart:
 * that file is gitignored here.
 *
 * @type {BEV.BaseEvent<"guildDelete">}
 */
module.exports = {
  name: "guildDelete",
  async execute(client, guild) {
    try {
      // An outage can deliver guildDelete for a guild that is merely
      // unavailable rather than actually removed.
      if (guild?.available === false) return;

      reportGuild(client, {
        kind: "guild_leave",
        guildId: guild.id,
        guildName: guild.name ?? null,
        memberCount: guild.memberCount ?? null,
        addedBy: null,
      });
    } catch (err) {
      client.logger?.debug?.(`[stats] guild_leave not recorded for ${guild?.id}: ${err.message}`);
    }
  },
};
