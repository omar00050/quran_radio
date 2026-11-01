const { AuditLogEvent } = require("discord.js");
const BEV = require("@utils/types/baseEvents");
const { reportGuild } = require("@utils/functions/statsReporter");

/**
 * Records a guild join for the statistics history.
 *
 * Deliberately a separate file from guildCreate.js: that one is gitignored in
 * this repository, so anything written there would not be version controlled.
 * EventsLoader registers handlers per file, so two files can both listen to
 * guildCreate.
 *
 * @type {BEV.BaseEvent<"guildCreate">}
 */
module.exports = {
  name: "guildCreate",
  async execute(client, guild) {
    try {
      reportGuild(client, {
        kind: "guild_join",
        guildId: guild.id,
        guildName: guild.name,
        memberCount: guild.memberCount,
        addedBy: await whoAddedTheBot(client, guild),
      });
    } catch (err) {
      client.logger?.debug?.(`[stats] guild_join not recorded for ${guild?.id}: ${err.message}`);
    }
  },
};

/**
 * Who invited the bot, from the audit log's BotAdd entry.
 *
 * Needs View Audit Log, which most servers do not grant. That is expected, so
 * a missing permission simply yields null — it must never stop the join from
 * being recorded.
 *
 * @returns {Promise<string|null>} the inviter's user id
 */
async function whoAddedTheBot(client, guild) {
  try {
    if (!guild.members.me?.permissions?.has("ViewAuditLog")) return null;

    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
    const entry = logs.entries.find((e) => e.target?.id === client.user.id);
    return entry?.executor?.id ?? null;
  } catch (_) {
    return null;
  }
}
