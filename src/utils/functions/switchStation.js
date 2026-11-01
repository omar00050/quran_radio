'use strict';

const RadioChannels = require('@utils/helpers/RadioChannels');
const { respondWithPanel } = require('./updateControlPanel');
const joinAndPlayQuran = require('./joinAndPlayQuran');
const { t } = require('./i18n');
const { say } = require('./messages');
const { reportPlayback } = require('./statsReporter');
const {
  checkRadioReady,
  checkStationHealth,
  checkCallerInVoice,
  failEphemeral,
} = require('./radioGuards');

/**
 * Shared implementation behind the station controls (list, next, previous,
 * random). They differ only in how the next station is chosen, so the
 * permission checks, error reporting and panel refresh live here once.
 *
 * Success is silent — deferUpdate and refresh the panel. Failures reply
 * ephemerally with a translated reason.
 *
 * @param {import("@base/baseClient")} client
 * @param {import("discord.js").MessageComponentInteraction} interaction
 * @param {object} lang
 * @param {(data: object, stations: typeof RadioChannels) => string|undefined} pickUrl
 */
async function switchStation(client, interaction, lang, pickUrl) {
  const guildId = interaction.guildId;

  try {
    const db = await client.db.table('channels');
    const data = await db.get(`${guildId}_radioChannel`);

    if (!data) return failEphemeral(interaction, say(lang, 'radio.errors.not_configured'));

    // Only people in the channel may change what everyone there is hearing.
    const caller = checkCallerInVoice(interaction, lang);
    if (!caller.ok) return failEphemeral(interaction, caller.message);

    const ready = await checkRadioReady(client, interaction.guild, data, lang);
    if (!ready.ok) return failEphemeral(interaction, ready.message);

    const url = pickUrl(data, RadioChannels);

    // Validate against the known station list rather than trusting the value.
    // In embedded mode the bot fetches this URL directly, so an arbitrary
    // value from a crafted interaction would otherwise become an outbound
    // request. (The audio server has its own allowlist; this covers the bot.)
    const station = RadioChannels.find((r) => r.value === url);
    if (!station) return failEphemeral(interaction, say(lang, 'radio.errors.no_stations'));

    const health = await checkStationHealth(client, url, lang);
    if (!health.ok) return failEphemeral(interaction, health.message);

    await interaction.deferUpdate();

    // Only restart playback if the radio is actually running; otherwise this
    // just records the choice for the next time it is turned on.
    if (client.Radio.get(`${guildId}`)) {
      const result = await joinAndPlayQuran(client, data.channelId, interaction.guild, url, true);
      if (result === null) return failEphemeral(interaction, say(lang, 'radio.errors.channel_missing'));
      if (result === 'cantConnect') return failEphemeral(interaction, say(lang, 'radio.errors.cant_connect'));
    }

    await db.set(`${guildId}_radioChannel..url`, url);

    reportPlayback(client, {
      kind: 'station_switch', guildId, station: url, actorId: interaction.user.id,
    });

    const fresh = await db.get(`${guildId}_radioChannel`);
    return respondWithPanel(client, interaction, fresh, lang);
  } catch (err) {
    client.logger?.error?.('switchStation', err);
    reportPlayback(client, {
      kind: 'radio_error', guildId, actorId: interaction.user?.id, reason: err.message,
    });
    return failEphemeral(interaction, say(lang, 'common.unexpected'));
  }
}

/** Index of the guild's current station, or -1. */
function currentIndex(data) {
  return RadioChannels.findIndex((r) => r.value === data?.url);
}

module.exports = { switchStation, currentIndex };
