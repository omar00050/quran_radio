const fetch = require('node-fetch');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const ControlData = require('./ControlData');
let radioUrlCache = new Map();

/**
 * 
 * @param {import("@base/baseClient")} client 
 * @param {import("discord.js").Channel} channel 
 * @param {import("discord.js").Guild} guild 
 * @returns 
 */
module.exports = async function joinAndPlayQuran(client, channelId, guild, url = process.env.RadioAudioUrl, isRunig = false) {

  const guildId = guild.id;
  radioUrlCache.set(guildId, url)
  const channel = await guild.channels.fetch(channelId);

  if (!channel) return null;
  if (isRunig) {

    client.Radio.get(guildId).player.stop(true);
    const response = await fetch(url)
    const stream = response.body;

    const resource = createAudioResource(stream);

    client.Radio.get(guildId).player.play(resource);
    return "isRunig"
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });

  if (!connection) return "cantConnect";

  const player = createAudioPlayer();
  const response = await fetch(url)

  const stream = response.body;

  const resource = createAudioResource(stream);
  player.play(resource);

  connection.subscribe(player);
  connection.on("stateChange", async (state) => {
    // this if condition disconnected bots 
    if (state.subscription.connection.state.status == "disconnected") {

      let guildId = state.subscription.connection.joinConfig.guildId
      let guildd = client.guilds.cache.get(guildId)
      if (guildd.members.me.voice?.channelId !== null) return

      await client.db.table("channels").set(`${guildId}_radioChannel..enabled`, false)
      let data = await client.db.table("channels").get(`${guildId}_radioChannel`)
      let msg = await guildd.channels.cache.get(data.ch).messages.fetch(data.msgId)

      if (msg) msg?.edit(ControlData(client, data))
      state.subscription.player.stop(true);
      client.Radio?.delete(guildId)
      console.log(`Bot disconnected from server ${guildd.name}`);

    }
  })
  player.on(AudioPlayerStatus.Playing, () => console.log(`Playing Quran in Server: [${guild.name}] Channel: [${channel.name}] ${new Date()}`));
  player.on('error', async (error) => {
    let radioUrl = radioUrlCache.get(guildId)
    setTimeout(async function () {
      await joinAndPlayQuran(client, channelId, guild, radioUrl, true)
    }, 1000);
    console.error(error);
  })
  connection.player = player
  return connection

}