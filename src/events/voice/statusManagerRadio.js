const VoiceUtils = require("@utils/class/voice");
const joinAndPlayQuran = require("@utils/functions/joinAndPlayQuran");
const BEV = require("@utils/types/baseEvents");

/** @type {BEV.BaseEvent<"voiceStateUpdate">} */
module.exports = {
  name: "voiceStateUpdate",
  async execute(client, oldState, newState) {

    const guild = newState?.guild
    if (!client.Radio.get(newState.guild.id)) return;

    const radioUrl = client.radioUrlCache.get(guild.id)
    const player = client.Radio.get(newState.guild.id).player;
    if (!player) return;
    const voiceChannel = guild.members.me?.voice?.channel;
    if (!voiceChannel) return;

    if (VoiceUtils.isVoiceChannelEmpty(newState, true) || VoiceUtils.isVoiceChannelEmpty(oldState, true)) {
      if (player.state.status == "idle") return
      player.stop(true);
      console.log(`Stop radio on empty voice channel`.red + ` in server [${voiceChannel.guild.name}]`.blue + ` Channel [${voiceChannel.name}] `.yellow + `Member : ${newState.member.user.username} `.blue + `Name: [${newState.member.user.globalName}]}]`);
    } else {
      if (player.state.status == "playing") return
      console.log(`Run radio voice channel not empty `.green + ` in server [${voiceChannel.guild.name}]`.blue + ` Channel [${voiceChannel.name}] `.yellow + `Member : ${newState.member.user.username} `.blue + `Name: [${oldState.member.user.globalName}]}]`);
      await joinAndPlayQuran(client, voiceChannel.id, guild, radioUrl, true)
    }

  }
}