const RadioChannels = require("@utils/helpers/RadioChannels");
const { t } = require("@utils/functions/i18n");
const { say } = require("@utils/functions/messages");
const { missingVoicePermissions } = require("@utils/functions/radioGuards");
const { stopWaiting } = require("@utils/functions/joinAndPlayQuran");
const { ChannelType } = require("discord.js");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "set_RadioChannel",
  enabled: true,
  /**
   * Stores the voice channel the radio should play in.
   *
   * Validation happens BEFORE anything is written, so a channel the bot cannot
   * actually use is never saved — that used to leave the radio silently
   * non-functional with no indication why.
   *
   * @param {import("discord.js").ChannelSelectMenuInteraction} interaction
   */
  async action(client, interaction, parts, lang) {
    try {
      const db = await client.db.table("channels");
      const channel = interaction.channels.first();

      if (!channel) {
        return interaction.reply({ content: say(lang, "setup.errors.channel_not_found"), ephemeral: true });
      }

      if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
        return interaction.reply({
          content: say(lang, "setup.errors.not_voice_channel", { channel: `<#${channel.id}>` }),
          ephemeral: true,
        });
      }

      // Permission check before saving: without Connect/Speak the radio can
      // never play, and the old code stored the channel anyway.
      const missing = missingVoicePermissions(interaction.guild, channel);
      if (missing.length) {
        return interaction.reply({
          content: say(lang, "setup.errors.missing_permissions", {
            channel: `<#${channel.id}>`,
            permissions: missing.map((name) => t(lang, `permissions.${name}`)).join(", "),
          }),
          ephemeral: true,
        });
      }

      const data = await db.get(`${interaction.guildId}_radioChannel`);

      if (data?.channelId === channel.id) {
        return interaction.reply({
          content: say(lang, "setup.errors.already_set", { channel: `<#${channel.id}>` }),
          ephemeral: true,
        });
      }

      // Moving the channel while the radio is live left the old connection
      // playing in the old channel, with the database pointing elsewhere.
      // Stop it so the stored state and reality agree again.
      let wasPlaying = false;
      const conn = client.Radio.get(`${interaction.guildId}`);
      if (conn) {
        wasPlaying = true;
        stopWaiting(client, interaction.guildId);
        try {
          conn.player?.stop(true);
          if (conn.guildStream && !conn.guildStream.destroyed) conn.guildStream.destroy();
          conn.destroy();
        } catch (_) { /* already torn down */ }
        client.Radio.delete(`${interaction.guildId}`);
        if (data?.channelId) {
          client.rest.put(`/channels/${data.channelId}/voice-status`, { body: { status: "" } }).catch(() => { });
        }
      }

      await db.set(`${interaction.guildId}_radioChannel`, {
        channelId: channel.id,
        guildId: interaction.guildId,
        url: data?.url || RadioChannels[0].value,
        enabled: false,
        ch: data?.ch || null,
        msgId: data?.msgId || null,
        offBy: data?.offBy ?? null,
        offAt: data?.offAt ?? null,
      });

      const lines = [say(lang, "setup.success.radio_channel_set", { channel: `<#${channel.id}>` })];
      if (wasPlaying) lines.push(say(lang, "setup.errors.radio_moved"));

      return interaction.reply({ content: lines.join("\n"), ephemeral: true });
    } catch (err) {
      client.logger?.error?.("set_RadioChannel", err);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({ content: say(lang, "common.unexpected"), ephemeral: true }).catch(() => { });
      }
    }
  },
};
