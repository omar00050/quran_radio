const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const updateControlPanel = require('./updateControlPanel');
const VoiceUtils = require('../class/voice');
const RadioChannels = require("@root/src/utils/helpers/RadioChannels");
const { startWaiting, stopWaiting, waitingUrl } = require("@root/src/audio/waiters");
const { reportPlayback } = require("./statsReporter");

/**
 * Joins a voice channel and plays the Quran audio.
 *
 * The audio source (ffmpeg-in-process or remote HTTP pull) lives on
 * `client.audio` — constructed once per client in baseClient.js, never at
 * module scope here. Module-scope state is exactly what made `/refresh`
 * orphan ffmpeg children: purging `require.cache` for src/utils re-executed
 * this file and built a second broadcaster while the first kept running
 * unreachably. `client.audio` survives a `/refresh` purge untouched.
 *
 * Retries are the station's responsibility (client.audio / BroadcastHub),
 * never the guild's — see docs/audio-source-contract.md §2 "Error
 * behaviour". When a station is down we keep the voice connection alive and
 * wait for `broadcast:recovered`/`broadcast:failed` instead of looping on a
 * per-guild timer.
 *
 * @returns {Promise<import("@discordjs/voice").VoiceConnection & {player: import("@discordjs/voice").AudioPlayer}>}
 */
module.exports = async function joinAndPlayQuran(client, channelId, guild, url = process.env.RadioAudioUrl, isRunning = false) {

  return new Promise(async (resolve, reject) => {
    const guildId = guild.id;
    client.radioUrlCache.set(guildId, url);

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    const db = await client.db.table("channels");

    if (!channel) return resolve(null);

    // Holds the connection created by the fresh-join path below. During a
    // fresh join the caller has not put it into client.Radio yet (ready.js and
    // onRadio_off_radio both set it only after this promise resolves), so the
    // recovery watcher has to be able to find it here or it would silently
    // skip attaching for exactly the guilds restoring against a dead station.
    let localConn = null;

    // ── Recovery watcher: subscribes (once per connection) to the station's
    // broadcast events instead of a per-guild setTimeout loop. Stored on the
    // connection so it can be detached on disconnect or when a fresh
    // playBroadcastAudio supersedes it.
    const _watchForRecovery = (forUrl) => {
      // Already waiting on this exact station — don't mark `wanted` twice.
      if (waitingUrl(client, guildId) === forUrl) return;

      const detach = () => {
        client.audio.unmarkWanted(forUrl);
        client.audio.off('broadcast:recovered', onRecovered);
        client.audio.off('broadcast:start', onRecovered);
        client.audio.off('broadcast:failed', onFailed);
      };

      const onRecovered = async (detail) => {
        if (detail?.url !== forUrl) return;
        detach();

        const liveConn = client.Radio.get(guildId) || localConn;
        if (!liveConn?.player) return;
        // Bail if the user switched stations while we were waiting.
        if ((client.radioUrlCache.get(guildId) ?? forUrl) !== forUrl) return;

        const voiceChannel = guild.members.me?.voice?.channel;
        if (!voiceChannel || VoiceUtils.isVoiceChannelEmpty(voiceChannel)) return;

        await playBroadcastAudio(liveConn.player);
      };

      // Nothing to do on broadcast:failed — the hub itself keeps retrying
      // the station on a slow periodic timer (failedRetryMs) and will emit
      // broadcast:recovered later. We just stay subscribed.
      const onFailed = (detail) => {
        if (detail?.url !== forUrl) return;
      };

      // Tell the hub this guild is waiting even though it holds no stream, so
      // an outage longer than idleMs can't let the idle sweep delete the
      // station and cancel the retries we're waiting on.
      client.audio.markWanted(forUrl);

      client.audio.on('broadcast:recovered', onRecovered);
      // broadcast:start matters for the case where the station was never up in
      // the first place: the hub emits 'recovered' only when coming back from
      // stalled/failed, so a station whose very first open failed announces
      // itself with 'start' once it finally serves data.
      client.audio.on('broadcast:start', onRecovered);
      client.audio.on('broadcast:failed', onFailed);

      // Keyed by guild, NOT stored on the VoiceConnection: joinVoiceChannel
      // reuses the same connection object, the OFF button destroys it, and
      // guildDelete never sees it — any of which previously orphaned the wait
      // and left the station permanently exempt from the idle sweep.
      startWaiting(client, guildId, forUrl, detach);
    };

    // ── Helper: start/restart playback using the shared audio source ─────────
    // Always reads the CURRENT url from the cache so stale closures can't
    // restart a station the user already switched away from.
    const playBroadcastAudio = async (player) => {
      // Use the live cache value — not the closed-over `url` — so that
      // every call (including ones from old event handlers) uses the station
      // the user actually selected.
      const currentUrl = client.radioUrlCache.get(guildId) ?? url;

      const conn = client.Radio.get(guildId);
      // A fresh attempt supersedes any pending recovery watcher for a
      // previous failure/url.
      stopWaiting(client, guildId);

      try {
        // Snapshot the old stream so we can release it AFTER the new one is playing.
        // Releasing before player.play() would briefly close the underlying stream,
        // causing a momentary Idle transition and an audible gap.
        const oldStream = conn?.guildStream ?? null;
        const oldUrl    = conn?.broadcastUrl ?? currentUrl;

        await client.audio.getOrCreate(currentUrl);
        const guildStream = client.audio.createGuildStream(currentUrl);
        if (!guildStream) {
          console.log(`[joinAndPlayQuran] Station not serving yet for ${guild.name} — waiting for recovery`);
          _watchForRecovery(currentUrl);
          return false;
        }

        const resource = createAudioResource(guildStream, { inputType: StreamType.OggOpus });

        // Update connection metadata before handing the resource to the player.
        const freshConn = client.Radio.get(guildId);
        if (freshConn) {
          freshConn.guildStream   = guildStream;
          freshConn.broadcastUrl  = currentUrl;
        }

        // Start new resource — @discordjs/voice will dispose the old resource's
        // stream internally, but we also release it explicitly to remove it from
        // the audio source's listener set and avoid a potential double-entry.
        player.play(resource);
        if (oldStream) client.audio.releaseGuildStream(oldUrl, oldStream);

        return true;
      } catch (err) {
        console.error(`[joinAndPlayQuran] playBroadcastAudio error in ${guild.name}:`, err);
        _watchForRecovery(currentUrl);
        return false;
      }
    };

    // ── isRunning: just restart playback without re-joining ──────────────────
    if (isRunning) {
      const clientChannel = guild.members.me?.voice?.channel;
      if (clientChannel && !VoiceUtils.isVoiceChannelEmpty(clientChannel)) {
        const conn = client.Radio.get(guildId);
        if (conn) await playBroadcastAudio(conn.player);
      }
      return resolve("isRunning");
    }

    // ── Fresh join ────────────────────────────────────────────────────────────
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

    if (!connection) return resolve("cantConnect");

    connection.on('error', err => {
      console.error(`[Voice] Connection error in ${guild.name}:`, err);
      _releaseStream(client, connection);
      resolve("cantConnect");
    });

    const player = createAudioPlayer();
    connection.subscribe(player);
    connection.player      = player;
    connection.broadcastUrl = url;
    connection.guildId     = guildId;
    connection.guildStream = null; // filled by playBroadcastAudio
    localConn = connection; // so onRecovered can find the player before client.Radio.set
    // A fresh join supersedes any wait this guild had from a previous attempt.
    stopWaiting(client, guildId);

    if (!VoiceUtils.isVoiceChannelEmpty(channel)) {
      await playBroadcastAudio(player);
    } else {
      console.log(`[joinAndPlayQuran] Channel is empty in ${guild.name} — waiting for members`.yellow);
    }

    // Voice-status banner
    const radioName = RadioChannels.find(r => r.value === url)?.name ?? 'Quran Radio';
    client.rest.put(`/channels/${channel.id}/voice-status`, {
      body: { status: `📻 Playing Quran | 🎧 ${radioName}` }
    }).catch(() => {});

    // ── State change: handle disconnects ─────────────────────────────────────
    connection.on("stateChange", async (oldState, newState) => {
      if (newState.status !== "disconnected") return;

      const gId = newState.subscription?.connection?.joinConfig?.guildId;
      if (!gId) return;

      const g = client.guilds.cache.get(gId);
      if (g?.members.me?.voice?.channelId !== null) return;

      await db.set(`${gId}_radioChannel..enabled`, false);
      const data = await db.get(`${gId}_radioChannel`);

      // Background refresh (no interaction), so same rule as startup: do not
      // migrate an old panel here. A disconnect storm would otherwise turn
      // into a burst of deletes and reposts.
      if (g) await updateControlPanel(client, g, data, undefined, { migrate: false }).catch(() => {});

      // Use the URL stored on the connection, not the closed-over `url`
      const goneConn = client.Radio.get(gId);
      stopWaiting(client, gId);
      _releaseStream(client, goneConn);
      goneConn?.player?.stop(true);
      client.Radio.delete(gId);

      console.log(`[joinAndPlayQuran] Disconnected from ${g?.name}`);
    });

    // ── Player events ─────────────────────────────────────────────────────────
    player.on(AudioPlayerStatus.Playing, () => {
      console.log(`[joinAndPlayQuran] Playing in ${guild.name} | ${channel.name}`);
    });

    // No per-guild reconnect timer: a single immediate attempt, then — if the
    // station isn't serving — wait for the station-level broadcast:recovered
    // event (see _watchForRecovery). Retries belong to the station, not the
    // guild (contract §2 / §C4): with hundreds of guilds on a dead station a
    // per-guild timer becomes dozens of connection attempts per second,
    // forever.
    player.on(AudioPlayerStatus.Idle, async () => {
      const conn = client.Radio.get(guildId);
      if (!conn) return;
      // Guard: skip if another call already started playback (e.g. station switch)
      if (conn.player.state.status !== AudioPlayerStatus.Idle) return;
      console.log(`[joinAndPlayQuran] Player idle in ${guild.name} — retrying once`);
      await playBroadcastAudio(conn.player);
    });

    player.on('error', async (error) => {
      const radioUrl = client.radioUrlCache.get(guildId) ?? url;
      console.error(`[joinAndPlayQuran] Player error in ${guild.name}: ${error.message}`);
      // No actor: this is the player failing on its own, not someone's action.
      reportPlayback(client, {
        kind: 'radio_error', guildId, station: radioUrl, reason: error.message,
      });
      const conn = client.Radio.get(guildId);
      _releaseStream(client, conn);
      console.log(`[joinAndPlayQuran] Keeping voice connection in ${guild.name}, waiting on station ${radioUrl}`);
      _watchForRecovery(radioUrl);
    });

    return resolve(connection);
  });
};

// Release a guild's PassThrough stream — reads the URL from the connection object
function _releaseStream(client, conn) {
  if (!conn?.guildStream) return;
  client.audio.releaseGuildStream(conn.broadcastUrl, conn.guildStream);
  conn.guildStream = null;
}

/**
 * Backwards-compatible stats accessor. Works both as a plain import
 * (`getBroadcastStats(client)`, used by status_bot.js) and as the method
 * ready.js assigns onto the client (`client.getBroadcasterStats()`, where
 * `this` is the client).
 */
function getBroadcastStats(client) {
  const c = client || this;
  if (!c?.audio) {
    return {
      mode: null,
      activeBroadcasts: 0,
      totalListeners: 0,
      broadcasts: [],
      audioServer: { configured: false, reachable: null, url: null, consecutiveFailures: 0, lastCheckAt: null },
      connectionCounts: [],
    };
  }
  return c.audio.getStats();
}

function cleanupBroadcast(client, url) {
  client?.audio?.cleanup(url);
}

module.exports.getBroadcastStats = getBroadcastStats;
// Re-exported so teardown paths that have no connection object in hand
// (the OFF button, guildDelete) can release a guild's recovery wait.
module.exports.stopWaiting = stopWaiting;
module.exports.cleanupBroadcast  = cleanupBroadcast;
