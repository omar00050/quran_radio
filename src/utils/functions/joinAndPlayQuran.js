const fetch = require('node-fetch');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ControlData = require('./ControlData');
const VoiceUtils = require('../class/voice');

/**
 * Joins a voice channel and plays the Quran audio.
 * @param {import("@base/baseClient")} client - The Discord client instance.
 * @param {string} channelId - The ID of the voice channel to join.
 * @param {import("discord.js").Guild} guild - The guild object.
 * @param {string} [url=process.env.RadioAudioUrl] - The URL of the Quran audio.
 * @param {boolean} [isRunning=false] - Indicates if the Quran audio is already running.
 * @returns {Promise<import("@discordjs/voice").VoiceConnection & {player : import("@discordjs/voice").AudioPlayer}>} - The voice connection and audio player.
 */
module.exports = async function joinAndPlayQuran(client, channelId, guild, url = process.env.RadioAudioUrl, isRunig = false) {

  const guildId = guild.id;
  client.radioUrlCache.set(guildId, url)
  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel) return null;
  if (isRunig) {

    if (!VoiceUtils.isVoiceChannelEmpty(channel)) {


      client.Radio.get(guildId).player.stop(true);
      const response = await fetch(url)
      const stream = response.body;

      const resource = createAudioResource(stream);

      client.Radio.get(guildId).player.play(resource);
    }

    return "isRunig"
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });

  if (!connection) return "cantConnect";

  const player = createAudioPlayer();
  if (!VoiceUtils.isVoiceChannelEmpty(channel)) {

    const response = await fetch(url)

    const stream = response.body;

    const resource = createAudioResource(stream);
    player.play(resource);
  } else console.log(`Join Voice Channel in Server: [${guild.name}] Channel: [${channel.name}] ` + `is Empty `.red);

  connection.subscribe(player);
  connection.on("stateChange", async (state) => {
    // this if condition disconnected bots 
    if (state.subscription.connection.state.status == "disconnected") {

      let guildId = state.subscription.connection.joinConfig.guildId
      let guildd = client.guilds.cache.get(guildId)
      if (guildd.members.me.voice?.channelId !== null) return

      await client.db.table("channels").set(`${guildId}_radioChannel..enabled`, false)
      let data = await client.db.table("channels").get(`${guildId}_radioChannel`)
      let msg = await guildd.channels.cache.get(data.ch).messages.fetch(data.msgId).catch(err => null)

      if (msg) msg?.edit(ControlData(client, data))
      client.Radio.get(guildId).player.stop(true);
      // state.subscription.player.stop(true);
      client.Radio?.delete(guildId)
      console.log(`Bot disconnected from server ${guildd.name}`);

    }
  })
  player.on(AudioPlayerStatus.Playing, () => console.log(`Playing Quran in Server: `.green + `[${guild.name}] `.blue + `Channel: [${channel.name}] `.yellow + `${new Date()}`));

  player.on('error', async (error) => {
    let radioUrl = client.radioUrlCache.get(guildId)
    setTimeout(async function () {
      await joinAndPlayQuran(client, channelId, guild, radioUrl, true)
      console.error(`${error.message} Server : ${guild.name} and rest Radio in :${channel.name} - url: ${radioUrl}`.red);
    }, 7000);
  })
  connection.player = player
  return connection

}