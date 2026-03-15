const AudioBroadcaster = require('./AudioBroadcaster');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ControlData = require('./ControlData');
const VoiceUtils = require('../class/voice');

// إنشاء instance واحد للمذيع
const broadcaster = new AudioBroadcaster();


/**
 * Joins a voice channel and plays the Quran audio.
 * @param {import("@base/baseClient")} client - The Discord client instance.
 * @param {string} channelId - The ID of the voice channel to join.
 * @param {import("discord.js").Guild} guild - The guild object.
 * @param {string} [url=process.env.RadioAudioUrl] - The URL of the Quran audio.
 * @param {boolean} [isRunning=false] - Indicates if the Quran audio is already running.
 * @returns {Promise<import("@discordjs/voice").VoiceConnection & {player : import("@discordjs/voice").AudioPlayer}>} - The voice connection and audio player.
 */
module.exports = async function joinAndPlayQuran(client, channelId, guild, url = process.env.RadioAudioUrl, isRunning = false) {


  return new Promise(async (resolve, reject) => {
    const guildId = guild.id;
    client.radioUrlCache.set(guildId, url);
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    const db = await client.db.table("channels");

    if (!channel) return resolve(null);

    // دالة مساعدة للتشغيل
    const playBroadcastAudio = async (guildId, url, player = null) => {
      try {
        // التأكد من وجود البث الرئيسي أولاً
        await broadcaster.getBroadcastForURL(url);

        // إنشاء الـ resource للجيلد
        const resource = broadcaster.createAudioResourceForGuild(url);
        if (resource) {
          if (!player) client.Radio.get(guildId).player.play(resource);
          else player.play(resource);
          console.log(`Playing broadcast audio for guild: ${guild.name}`);
          return true;
        }
      } catch (error) {
        console.error(`Error in playBroadcastAudio for ${guild.name}:`, error);
      }
      return false;
    };

    if (isRunning) {
      let clientChannel = guild.members.me.voice.channel;
      if (!VoiceUtils.isVoiceChannelEmpty(clientChannel)) {
        const success = await playBroadcastAudio(guildId, url);
        if (!success) {
          console.log(`Failed to play broadcast for ${guild.name}, will retry...`);
        }
      }
      return resolve("isRunning");
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guildId,
      adapterCreator: channel.guild.voiceAdapterCreator,
    });

    connection.on('error', err => {
      console.log(`Voice Connection Error in ${guild.name}: ${err}`.red);
      broadcaster.releaseGuildConnection(url);
      return resolve("cantConnect");
    });

    if (!connection) {
      broadcaster.releaseGuildConnection(url);
      return resolve("cantConnect");
    }

    const player = createAudioPlayer();

    if (!VoiceUtils.isVoiceChannelEmpty(channel)) {
      const success = await playBroadcastAudio(guildId, url, player);
      if (!success) {
        console.log(`Failed to start broadcast for ${guild.name}`);
      }
    } else {
      console.log(`Join Voice Channel in Server: [${guild.name}] Channel: [${channel.name}] is Empty `.red);
    }

    connection.subscribe(player);

    connection.on("stateChange", async (oldState, newState) => {
      if (newState.status === "disconnected") {
        let guildId = newState.subscription?.connection?.joinConfig?.guildId;
        if (!guildId) return;

        let guildd = client.guilds.cache.get(guildId);
        if (guildd?.members.me.voice?.channelId !== null) return;

        await db.set(`${guildId}_radioChannel..enabled`, false);
        let data = await db.get(`${guildId}_radioChannel`);
        let msg = await guildd.channels.cache.get(data.ch)?.messages.fetch(data.msgId).catch(err => null) || null;

        if (msg) msg?.edit(ControlData(client, data));

        client.Radio.get(guildId)?.player?.stop(true);
        client.Radio?.delete(guildId);

        // تحرير اتصال الجيلد من البث
        broadcaster.releaseGuildConnection(url);

        console.log(`Bot disconnected from server ${guildd.name}`);
      }
    });

    player.on(AudioPlayerStatus.Playing, () => {
      console.log(`✅ Playing Quran in Server: [${guild.name}] Channel: [${channel.name}] - ${new Date()}`);
      // عرض إحصائيات البث
      const stats = broadcaster.getStats();
      console.log(`📊 Broadcast Stats: ${JSON.stringify(stats)}`);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      console.log(`🔄 Player became idle in ${guild.name}`);
    });

    player.on('error', async (error) => {
      let radioUrl = client.radioUrlCache.get(guildId);
      console.error(`🔴 Player error in ${guild.name}: ${error.message}`.red);

      // تحرير الاتصال الحالي
      broadcaster.releaseGuildConnection(url);

      setTimeout(async function () {
        try {
          console.log(`🔄 Retrying connection for ${guild.name}...`);
          await joinAndPlayQuran(client, channelId, guild, radioUrl, true);
        } catch (retryError) {
          console.error(`❌ Failed to restart radio in ${guild.name}:`, retryError);
        }
      }, 7000);
    });

    connection.player = player;

    // تخزين معلومات البث في الـ connection للوصول لها لاحقاً
    connection.broadcastUrl = url;
    connection.guildId = guildId;

    return resolve(connection);
  });
};

// دالة مساعدة لعرض إحصائيات البث
function getBroadcastStats() {
  return broadcaster.getStats();
}

// دالة لتنظيف البث يدوياً إذا لزم الأمر
function cleanupBroadcast(url) {
  broadcaster.cleanupBroadcast(url);
}

// تصدير الدوال المساعدة
module.exports.getBroadcastStats = getBroadcastStats;
module.exports.cleanupBroadcast = cleanupBroadcast;
