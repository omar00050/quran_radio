const { respondWithPanel } = require("@utils/functions/updateControlPanel");
const joinAndPlayQuran = require("@utils/functions/joinAndPlayQuran");
const { stopWaiting } = require("@utils/functions/joinAndPlayQuran");
const { t } = require("@utils/functions/i18n");
const { say } = require("@utils/functions/messages");
const { reportPlayback } = require("@utils/functions/statsReporter");
const {
  checkRadioReady,
  checkStationHealth,
  failEphemeral,
} = require("@utils/functions/radioGuards");

/**
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "onRadio_off_radio",
  enabled: true,
  /**
   * Turns the radio on or off.
   *
   * Success is silent: acknowledge with deferUpdate and refresh the panel, with
   * no confirmation message. Every failure answers ephemerally with a
   * translated reason, and the checks that can be made up front are made
   * BEFORE joining, so the user is told exactly what is wrong instead of
   * waiting for the interaction to time out.
   *
   * @param {import("discord.js").ButtonInteraction} interaction
   */
  async action(client, interaction, parts, lang) {
    const guildId = interaction.guildId;

    try {
      const db = await client.db.table("channels");
      const data = await db.get(`${guildId}_radioChannel`);

      if (!data) return failEphemeral(interaction, say(lang, "radio.errors.not_configured"));

      // ── Turning OFF ──────────────────────────────────────────────────────
      // Handled first and without pre-flight checks: stopping must keep
      // working even if the channel was deleted or permissions were revoked,
      // or a guild could be stuck with a connection it cannot turn off.
      if (data.enabled) {
        await interaction.deferUpdate();

        stopWaiting(client, guildId);

        const conn = client.Radio.get(`${guildId}`);
        if (conn) {
          try {
            conn.player?.stop(true);
            if (conn.guildStream && !conn.guildStream.destroyed) conn.guildStream.destroy();
            conn.destroy();
          } catch (_) { /* already torn down */ }
        }
        client.Radio.delete(`${guildId}`);

        if (data.channelId) {
          client.rest.put(`/channels/${data.channelId}/voice-status`, { body: { status: "" } }).catch(() => { });
        }

        // Who turned it off, and when. Unix seconds so the panel can render it
        // as a Discord relative timestamp.
        await db.set(`${guildId}_radioChannel..enabled`, false);
        await db.set(`${guildId}_radioChannel..offBy`, interaction.user.id);
        await db.set(`${guildId}_radioChannel..offAt`, Math.floor(Date.now() / 1000));

        reportPlayback(client, {
          kind: 'radio_off', guildId, station: data.url, actorId: interaction.user.id,
        });

        const fresh = await db.get(`${guildId}_radioChannel`);
        return respondWithPanel(client, interaction, fresh, lang);
      }

      // ── Turning ON ───────────────────────────────────────────────────────
      const ready = await checkRadioReady(client, interaction.guild, data, lang);
      if (!ready.ok) {
        reportPlayback(client, { kind: 'radio_error', guildId, station: data.url, actorId: interaction.user.id, reason: ready.message });
        return failEphemeral(interaction, ready.message);
      }

      const health = await checkStationHealth(client, data.url, lang);
      if (!health.ok) {
        reportPlayback(client, { kind: 'radio_error', guildId, station: data.url, actorId: interaction.user.id, reason: health.message });
        return failEphemeral(interaction, health.message);
      }

      await interaction.deferUpdate();

      // The row says off but a live connection exists: an earlier ON got part
      // way through. Tear the leftover down so joinAndPlayQuran starts clean
      // instead of attaching a second player to the same connection.
      const stale = client.Radio.get(`${guildId}`);
      if (stale) {
        client.logger?.warn?.(`[radio] clearing a stale connection in ${guildId} before turning on`);
        stopWaiting(client, guildId);
        try {
          stale.player?.stop(true);
          if (stale.guildStream && !stale.guildStream.destroyed) stale.guildStream.destroy();
          stale.destroy();
        } catch (_) { /* already gone */ }
        client.Radio.delete(`${guildId}`);
      }

      const conn = await joinAndPlayQuran(client, data.channelId, interaction.guild, data.url);

      if (conn === null) return failEphemeral(interaction, say(lang, "radio.errors.channel_missing"));
      if (conn === "cantConnect") return failEphemeral(interaction, say(lang, "radio.errors.cant_connect"));

      client.Radio.set(`${guildId}`, conn);

      // Clear the off-record so a stale "turned off by" line cannot reappear.
      // If any of these writes fail, undo the runtime change too rather than
      // leaving a playing connection behind a row that says off.
      try {
        await db.set(`${guildId}_radioChannel..enabled`, true);
        await db.set(`${guildId}_radioChannel..offBy`, null);
        await db.set(`${guildId}_radioChannel..offAt`, null);
      } catch (writeErr) {
        client.logger?.error?.(`[radio] ON succeeded but the row could not be saved in ${guildId}`, writeErr);
        stopWaiting(client, guildId);
        try { conn.player?.stop(true); conn.destroy(); } catch (_) { /* ignore */ }
        client.Radio.delete(`${guildId}`);
        return failEphemeral(interaction, say(lang, "common.unexpected"));
      }

      reportPlayback(client, {
        kind: 'radio_on', guildId, station: data.url, actorId: interaction.user.id,
      });

      const fresh = await db.get(`${guildId}_radioChannel`);
      return respondWithPanel(client, interaction, fresh, lang);
    } catch (err) {
      // Generic message for the user; the detail stays in the logs.
      client.logger?.error?.("onRadio_off_radio", err);
      return failEphemeral(interaction, say(lang, "common.unexpected"));
    }
  },
};
