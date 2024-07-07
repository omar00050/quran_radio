const { VoiceState } = require("discord.js");



module.exports = class VoiceUtils {

  /**
   * Checks if the voice channel is empty by filtering out bot users.
   *
   * @param {VoiceState | import("discord.js").VoiceChannel} voiceState - The voice state object containing information about the voice connection.
   * @param {boolean} [isMeChannel=false] - Whether the voice channel is the user's voice channel. if true is the bot's me channel. otherwise 
   * @return {boolean} Returns true if the voice channel is empty, false otherwise.
   */
  static isVoiceChannelEmpty(voiceState, isMeChannel = false) {
    const guild = voiceState.guild;
    const clientId = voiceState.client.user?.id;
    if (!guild || !clientId) return false;
    const voiceChannel = isMeChannel ? guild.members.me?.voice?.channel : voiceState;
    if (!voiceChannel) return false;
    const members = voiceChannel.members.filter((m) => !m.user.bot);
    return !members.size;
  }


}