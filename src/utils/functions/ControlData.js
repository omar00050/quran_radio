const {
  MessageFlags,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ThumbnailBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const RadioChannels = require("../helpers/RadioChannels");
const { t } = require("./i18n");

const { say } = require('./messages');
/** Discord allows at most 25 options per select menu. */
const MAX_SELECT_OPTIONS = 25;

/**
 * Renders mentions as clickable without notifying anyone. `parse: []` disables
 * every implicit mention category (users, roles, @everyone) and no explicit
 * `users`/`roles` allowlist is given, so nothing in the panel can ping.
 */
const NO_PINGS = { parse: [] };
const STATION_EMOJI = "1259470700801036401";

/**
 * Builds the radio control panel using Components v2
 * (`MessageFlags.IsComponentsV2`, supported since discord.js 14.21).
 *
 * All customIds are unchanged, so the existing prefix routing in
 * interactionCreate keeps working: `onRadio_off_radio`, `Radio_list_quran`,
 * `Radio_list_any`, `next_channel`, `back_channel`, `random_channel`.
 *
 * A v2 message may not carry `content` or `embeds`. Both are returned as
 * explicitly empty so that editing a panel created by the old embed-based
 * version clears them in the same call.
 *
 * @param {import("@base/baseClient")} client
 * @param {*} data   the guild's `_radioChannel` row
 * @param {object} [lang] language object from interactionCreate
 * @returns {import("discord.js").MessageEditOptions}
 */
module.exports = function buildControlPanel(client, data, lang) {
  if (!data) {
    // Not set up yet — plain ephemeral text, no panel to render.
    return {
      content: say(lang, "radio.panel.not_configured"),
      ephemeral: true,
      allowedMentions: NO_PINGS,
    };
  }

  const station = RadioChannels.find((r) => r.value === data.url) || null;
  const state = resolvePlaybackState(client, data);

  // ── Header: title, station, category, with the station artwork alongside ──
  const headerLines = [
    `## ${t(lang, "radio.panel.title")}`,
    `**${t(lang, "radio.panel.station")}:** ${station ? station.name : t(lang, "radio.panel.no_station")}`,
  ];
  if (station) {
    headerLines.push(`**${t(lang, "radio.panel.group")}:** ${t(lang, `radio.groups.${station.group}`)}`);
  }

  const header = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(headerLines.join("\n")),
  );

  // A thumbnail accessory needs a real URL; stations without artwork fall back
  // to a button accessory so the Section stays valid either way.
  if (station?.img) {
    header.setThumbnailAccessory(new ThumbnailBuilder().setURL(station.img));
  } else {
    header.setButtonAccessory(
      new ButtonBuilder()
        .setCustomId("soon_btn_panel")
        .setLabel(t(lang, "radio.panel.title"))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
  }

  // ── Status block ─────────────────────────────────────────────────────────
  const statusLines = [
    `**${t(lang, "radio.panel.state")}:** ${state.emoji} ${t(lang, state.labelKey)}`,
    `**${t(lang, "radio.panel.channel")}:** ${data.channelId ? `<#${data.channelId}>` : t(lang, "radio.panel.channel_unknown")}`,
  ];

  // "Last turned off by" is shown ONLY while the radio is off, and only who
  // turned it off — never who turned it on.
  if (!data.enabled && data.offBy && data.offAt) {
    statusLines.push(
      t(lang, "radio.panel.turned_off_by", {
        user: `<@${data.offBy}>`,
        time: `<t:${data.offAt}:R>`,
      }),
    );
  }

  const container = new ContainerBuilder()
    .setAccentColor(state.color)
    .addSectionComponents(header)
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(statusLines.join("\n")))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  // ── Station menus: one for Quran, one for everything else ────────────────
  // The split exists because Discord caps a menu at 25 options; each list is
  // also sliced so a growing station list degrades instead of erroring.
  const quranOptions = toOptions(RadioChannels.filter((ch) => ch.group === "quran"), data.url);
  const otherOptions = toOptions(RadioChannels.filter((ch) => ch.group !== "quran"), data.url);

  if (quranOptions.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("Radio_list_quran")
          .setPlaceholder(t(lang, "radio.panel.select_quran"))
          .addOptions(quranOptions),
      ),
    );
  }

  if (otherOptions.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("Radio_list_any")
          .setPlaceholder(t(lang, "radio.panel.select_other"))
          .addOptions(otherOptions),
      ),
    );
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  const onOff = new ButtonBuilder()
    .setCustomId("onRadio_off_radio")
    .setLabel(data.enabled ? t(lang, "radio.panel.btn_off") : t(lang, "radio.panel.btn_on"))
    .setStyle(data.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    .setEmoji(data.enabled ? "1031533069238292520" : "1024996154410291230");

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      onOff,
      new ButtonBuilder()
        .setCustomId("random_channel")
        .setLabel(t(lang, "radio.panel.btn_random"))
        .setEmoji("1025002020043771934")
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("back_channel")
        .setLabel(t(lang, "radio.panel.btn_prev"))
        .setEmoji("1025001498557558784")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("next_channel")
        .setLabel(t(lang, "radio.panel.btn_next"))
        .setEmoji("1025001307557343252")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    // Cleared so an edit over an old embed-based panel drops the old content.
    content: "",
    embeds: [],
    // The "turned off by" line is a real <@id> mention so it stays clickable,
    // but the panel is re-rendered on every toggle and restart — notifying
    // that person each time would be spam. Suppressing it here means every
    // send and edit of the panel inherits it, including updateControlPanel,
    // respondWithPanel and /control.
    allowedMentions: NO_PINGS,
  };
};

/**
 * Playback state taken from the live audio source rather than the stored flag,
 * so "reconnecting" is visible instead of the panel claiming it is playing.
 */
function resolvePlaybackState(client, data) {
  if (!data.enabled) {
    return { labelKey: "radio.panel.state_off", emoji: "⏹️", color: 0x4f545c };
  }

  const audioState = client.audio?.getState?.(data.url) ?? null;

  if (audioState === "failed" || audioState === "stalled") {
    return { labelKey: "radio.panel.state_reconnecting", emoji: "🔄", color: 0xfaa61a };
  }
  if (audioState === "starting" || !client.Radio?.has?.(data.guildId)) {
    return { labelKey: "radio.panel.state_starting", emoji: "⏳", color: 0xfaa61a };
  }
  return { labelKey: "radio.panel.state_playing", emoji: "▶️", color: 0x57f287 };
}

/** @returns {Array<{label: string, value: string, emoji: string, default: boolean}>} */
function toOptions(stations, currentUrl) {
  return stations.slice(0, MAX_SELECT_OPTIONS).map((ch) => ({
    label: ch.name.trim().slice(0, 100),
    value: ch.value,
    emoji: STATION_EMOJI,
    default: ch.value === currentUrl,
  }));
}

module.exports.resolvePlaybackState = resolvePlaybackState;
