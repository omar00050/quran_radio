const { MessageFlags } = require("discord.js");
const { runQuickSetup, buildResult } = require("@utils/functions/quickSetup");
const updateControlPanel = require("@utils/functions/updateControlPanel");
const { t } = require("@utils/functions/i18n");

const { say } = require("@utils/functions/messages");
/**
 * Confirm / Cancel for `/setup quick`.
 *
 * Reached by the customIds `quicksetup_confirm_<userId>` and
 * `quicksetup_cancel_<userId>`. interactionCreate's lookup tries
 * `parts[0]_parts[1]` and `parts[0]_parts[1]_parts[2]` first, neither of which
 * exists, then falls through to `parts[0]` — this component.
 *
 * @type {import("@utils/types/baseComponent")}
 */
module.exports = {
  name: "quicksetup",
  enabled: true,
  /**
   * @param {import("discord.js").ButtonInteraction} interaction
   * @param {string[]} parts  ["quicksetup", action, invokerId]
   */
  async action(client, interaction, parts, lang) {
    const action = parts[1];
    const invokerId = parts[2];

    // Only the person who ran the command may act on their own preview. The id
    // is carried in the customId, so this is checked on every press rather than
    // assumed from who the message was rendered for.
    if (invokerId && interaction.user.id !== invokerId) {
      return interaction.reply({
        content: say(lang, "quick.not_your_button"),
        flags: MessageFlags.Ephemeral,
      }).catch(() => { });
    }

    try {
      if (action === "cancel") {
        return interaction.update({
          flags: MessageFlags.IsComponentsV2,
          components: [],
          content: say(lang, "quick.cancelled"),
        }).catch(async () => {
          // A v2 message cannot drop to plain content; replace the body instead.
          await interaction.reply({
            content: say(lang, "quick.cancelled"),
            flags: MessageFlags.Ephemeral,
          }).catch(() => { });
        });
      }

      if (action !== "confirm") return;

      // Re-check the permission that gated the command itself: the preview may
      // have been sitting open while the user's permissions changed.
      if (!interaction.memberPermissions?.has("ManageGuild")) {
        return interaction.reply({
          content: say(lang, "quick.need_manage_guild"),
          flags: MessageFlags.Ephemeral,
        }).catch(() => { });
      }

      // Creating five channels with pauses takes several seconds, well past the
      // 3-second interaction window, so acknowledge first.
      await interaction.deferUpdate();

      // Quick setup deliberately does NOT pick a language. The guild keeps
      // English until somebody with Manage Server chooses one through /lang or
      // the first-use prompt, which is the only thing that ever sets it.

      const result = await runQuickSetup(client, interaction, lang);

      // Post the control panel through updateControlPanel so it follows the
      // same lazy-migration rules as every other panel. The row was just
      // written with msgId: null, so this posts a fresh v2 panel and records
      // its id.
      if (result.ok) {
        const channels = await client.db.table("channels");
        const data = await channels.get(`${interaction.guildId}_radioChannel`);
        await updateControlPanel(client, interaction.guild, data, lang, { migrate: true })
          .catch((err) => client.logger?.error?.("[quicksetup] panel post failed", err));
      }

      await interaction.editReply(buildResult(client, lang, result));

      client.logger?.log?.(
        `[quicksetup] ${result.ok ? "completed" : "failed"} in ${interaction.guild.name} `
        + `(${interaction.guildId}) by ${interaction.user.id}`
        + (result.ok ? "" : ` — ${result.reason}`),
      );
    } catch (err) {
      client.logger?.error?.("quicksetup", err);
      const payload = { content: say(lang, "common.unexpected"), flags: MessageFlags.Ephemeral };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch (_) { /* interaction gone */ }
    }
  },
};
