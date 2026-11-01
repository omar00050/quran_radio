'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { t } = require('./i18n');

const { say } = require('./messages');
/** Permissions the bot genuinely needs to play audio in a voice channel. */
const REQUIRED_VOICE_PERMISSIONS = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['Connect', PermissionFlagsBits.Connect],
  ['Speak', PermissionFlagsBits.Speak],
];

/**
 * Pre-flight checks for every radio action.
 *
 * These run BEFORE any attempt to join, so the user is told exactly what is
 * wrong instead of watching the interaction time out. Each failure returns a
 * ready-to-send translated message rather than a code the caller has to map.
 *
 * @returns {Promise<{ok: true, channel: import('discord.js').VoiceBasedChannel}
 *                  | {ok: false, message: string}>}
 */
async function checkRadioReady(client, guild, data, lang) {
  // 1. Configured at all?
  if (!data || !data.channelId) {
    return { ok: false, message: say(lang, 'radio.errors.not_configured') };
  }

  // 2. Does the channel still exist? Deleting it is the most common breakage,
  //    and the stored id outlives the channel.
  const channel = guild.channels.cache.get(data.channelId)
    || await guild.channels.fetch(data.channelId).catch(() => null);

  if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
    return { ok: false, message: say(lang, 'radio.errors.channel_missing') };
  }

  // 3. Permissions, naming exactly which ones are missing.
  const missing = missingVoicePermissions(guild, channel);
  if (missing.length) {
    return {
      ok: false,
      message: say(lang, 'radio.errors.missing_permissions', {
        channel: `<#${channel.id}>`,
        permissions: missing.map((name) => t(lang, `permissions.${name}`)).join(', '),
      }),
    };
  }

  // 4. Full? userLimit 0 means unlimited. Members already includes the bot if
  //    it is connected, so a bot that is already inside is never "full".
  if (channel.userLimit > 0
    && channel.members.size >= channel.userLimit
    && !channel.members.has(client.user.id)) {
    return { ok: false, message: say(lang, 'radio.errors.channel_full', { channel: `<#${channel.id}>` }) };
  }

  return { ok: true, channel };
}

/**
 * @returns {string[]} names of the required voice permissions the bot lacks
 */
function missingVoicePermissions(guild, channel) {
  const me = guild.members.me;
  if (!me) return [];
  const perms = channel.permissionsFor(me);
  if (!perms) return REQUIRED_VOICE_PERMISSIONS.map(([name]) => name);
  return REQUIRED_VOICE_PERMISSIONS.filter(([, bit]) => !perms.has(bit)).map(([name]) => name);
}

/**
 * Checks a text channel the bot must be able to post in (adhkar, prayer).
 * @returns {string[]} names of missing permissions
 */
function missingTextPermissions(guild, channel) {
  const needed = [
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['SendMessages', PermissionFlagsBits.SendMessages],
    ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
    ['AttachFiles', PermissionFlagsBits.AttachFiles],
  ];
  const me = guild.members.me;
  if (!me) return [];
  const perms = channel.permissionsFor(me);
  if (!perms) return needed.map(([name]) => name);
  return needed.filter(([, bit]) => !perms.has(bit)).map(([name]) => name);
}

/**
 * Is the station the guild is about to play actually serving?
 *
 * An unreachable audio server, a rejected token and a dead station are three
 * different problems with three different fixes, so each is reported
 * separately.
 *
 * In remote mode this performs a LIVE probe of the audio server rather than
 * reading a cached flag. The cached flag was the bug: it lived in the shard,
 * nothing in a shard refreshed it, and its initial value in remote mode was
 * `false`, so the ON button was blocked permanently. Anything inconclusive
 * (a timeout) is allowed through — never block on uncertainty.
 *
 * @returns {Promise<{ok: true} | {ok: false, message: string}>}
 */
async function checkStationHealth(client, url, lang) {
  const audio = client.audio;
  if (!audio || !url) return { ok: true };

  const shardId = client.shard?.ids?.[0] ?? 0;

  if (audio.mode === 'remote') {
    const probe = await probeAudioServer(client);

    // One line per check so a misbehaving deployment is visible in pm2 logs.
    client.logger?.debug?.(
      `[radioGuards] mode=remote shard=${shardId} reachability=${probe.source}`
      + ` value=${probe.reachable === null ? 'unknown' : probe.reachable}`
      + (probe.status ? ` http=${probe.status}` : '')
      + (probe.error ? ` error=${probe.error}` : ''),
    );

    // Only a measured failure blocks. `null` (unknown, e.g. the probe timed
    // out) must never block: refusing on uncertainty is exactly the bug this
    // replaced, where an unmeasured default of `false` made ON impossible.
    if (probe.reachable === false) {
      const key = probe.kind === 'auth'
        ? 'radio.errors.audio_server_auth'
        : 'radio.errors.audio_server_unreachable';
      return { ok: false, message: say(lang, key) };
    }
  } else {
    client.logger?.debug?.(
      `[radioGuards] mode=${audio.mode} shard=${shardId} reachability=n/a value=skipped`,
    );
  }

  if (audio.getState?.(url) === 'failed') {
    return { ok: false, message: say(lang, 'radio.errors.station_failed') };
  }

  return { ok: true };
}

/** Short-lived memo so a burst of button presses does not hammer /health. */
let _probeCache = { at: 0, result: null };
const PROBE_TTL_MS = 3000;
const PROBE_TIMEOUT_MS = 1200;

/**
 * Asks the audio server, right now, whether it is answering.
 *
 * Deliberately a live request rather than a cached flag: the cached value lived
 * in the shard and nothing in a shard ever refreshed it (the `/health` poll runs
 * in the manager process), so it could only ever be its initial value.
 *
 * @returns {Promise<{reachable: boolean|null, source: string, kind?: string, status?: number, error?: string}>}
 *          `reachable: null` means "could not determine" — callers must not
 *          treat that as a failure.
 */
async function probeAudioServer(client) {
  const now = Date.now();
  if (_probeCache.result && now - _probeCache.at < PROBE_TTL_MS) {
    return { ..._probeCache.result, source: `${_probeCache.result.source}(memo)` };
  }

  const base = process.env.AUDIO_SERVER_URL || 'http://127.0.0.1:3040';
  const token = process.env.AUDIO_SERVER_TOKEN || 'change_me';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  let result;
  try {
    // The audio server requires the bearer token on every route, /health
    // included — without this header the probe would always see 401.
    const res = await fetch(`${base.replace(/\/+$/, '')}/health`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      // The server is up; the token is wrong. Saying "unreachable" here would
      // send the operator looking in the wrong place.
      result = { reachable: false, kind: 'auth', source: 'probe', status: res.status };
    } else if (res.ok) {
      result = { reachable: true, source: 'probe', status: res.status };
    } else {
      // 5xx and anything else: the server answered, so it is reachable. Let
      // the playback attempt decide.
      result = { reachable: true, source: 'probe', status: res.status };
    }
  } catch (err) {
    const aborted = err.name === 'AbortError';
    result = aborted
      // Slow, not absent. Inconclusive, so do not block.
      ? { reachable: null, source: 'probe-timeout', error: 'timeout' }
      // A real connection error: refused, DNS failure, socket reset.
      : { reachable: false, kind: 'connection', source: 'probe', error: err.code || err.message };
  } finally {
    clearTimeout(timer);
  }

  _probeCache = { at: now, result };

  // Keep getStats() honest so /status and the dashboard see the same thing.
  try {
    client.audio?.setAudioServerStatus?.({
      reachable: result.reachable,
      url: base,
      lastCheckAt: now,
      consecutiveFailures: result.reachable === false
        ? (client.audio.getStats?.().audioServer?.consecutiveFailures ?? 0) + 1
        : 0,
    });
  } catch (_) { /* stats are never worth failing a button over */ }

  return result;
}

/** Test seam: drops the memo so a test can control each probe. */
function _resetProbeCache() {
  _probeCache = { at: 0, result: null };
}

/**
 * The caller must be in the same voice channel as the bot before they can
 * change what everyone else is listening to.
 *
 * @returns {{ok: true} | {ok: false, message: string}}
 */
function checkCallerInVoice(interaction, lang) {
  const botChannel = interaction.guild.members.me?.voice?.channel;
  if (!botChannel) return { ok: false, message: say(lang, 'radio.errors.not_in_voice') };

  if (interaction.member?.voice?.channelId !== botChannel.id) {
    return { ok: false, message: say(lang, 'radio.errors.wrong_voice', { channel: `<#${botChannel.id}>` }) };
  }
  return { ok: true };
}

/** Ephemeral failure reply that works whether or not the interaction is acknowledged. */
async function failEphemeral(interaction, message) {
  const payload = { content: message, ephemeral: true };
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (_) { /* interaction expired — nothing useful left to do */ }
  return false;
}

module.exports = {
  checkRadioReady,
  checkStationHealth,
  probeAudioServer,
  _resetProbeCache,
  checkCallerInVoice,
  missingVoicePermissions,
  missingTextPermissions,
  failEphemeral,
  REQUIRED_VOICE_PERMISSIONS,
};
