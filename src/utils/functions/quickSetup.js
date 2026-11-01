'use strict';

const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const RadioChannels = require('@utils/helpers/RadioChannels');
const { t } = require('./i18n');
const { say } = require('./messages');
const joinAndPlayQuran = require('./joinAndPlayQuran');
const SendAzkar = require('./sendAzkar');
const SendAdhan = require('./sendPrayer');
const { checkRadioReady, checkStationHealth } = require('./radioGuards');
const { safeGet, safeSet } = require('./dbSafe');

/**
 * One-shot server setup: creates a category with the four channels the bot
 * needs, then saves the radio, adhkar and prayer rows exactly as the individual
 * `/setup` flows would.
 */

const CATEGORY_NAME = '⌜Quran⌟';

// EM SPACE + box-drawing corner written as escapes: the literal characters
// did not survive an earlier encoding round-trip.
const TREE_BRANCH = '\u2003\u2514';

/** The channels quick setup creates, in creation order. */
const PLAN = [
  { key: 'category', name: CATEGORY_NAME, type: ChannelType.GuildCategory, labelKey: 'quick.category' },
  { key: 'control', name: '⚙️│لوحة-التحكم', type: ChannelType.GuildText, labelKey: 'quick.control_channel' },
  { key: 'azkar', name: '📿│الأذكار', type: ChannelType.GuildText, labelKey: 'quick.azkar_channel' },
  { key: 'prayer', name: '🕑│مواقيت-الصلاة', type: ChannelType.GuildText, labelKey: 'quick.prayer_channel' },
  { key: 'voice', name: '📻│إذاعة القران الكريم', type: ChannelType.GuildVoice, labelKey: 'quick.voice_channel' },
];

/**
 * Every permission quick setup needs, derived from what the code actually does:
 *  - ManageChannels  create the category and the four channels
 *  - ViewChannel     see the channels it just made
 *  - SendMessages    post the control panel, adhkar and prayer messages
 *  - EmbedLinks      the control panel and the setup panels
 *  - AttachFiles     adhkar and prayer times are rendered images
 *  - Connect, Speak  play the radio in the voice channel
 */
const REQUIRED_PERMISSIONS = [
  ['ManageChannels', PermissionFlagsBits.ManageChannels],
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['SendMessages', PermissionFlagsBits.SendMessages],
  ['EmbedLinks', PermissionFlagsBits.EmbedLinks],
  ['AttachFiles', PermissionFlagsBits.AttachFiles],
  ['Connect', PermissionFlagsBits.Connect],
  ['Speak', PermissionFlagsBits.Speak],
];

/** Prayer defaults: Cairo, Egypt (src/utils/helpers/prayer.json). */
const CAIRO = {
  country: 'Egypt',
  method: 5,
  format: '12h',
  city: 'Cairo',
  city_ar: 'القاهرة',
  timezone: 'Africa/Cairo',
  latitude: 30.0444,
  longitude: 31.2357,
};

/** @returns {Array<{name: string, has: boolean}>} guild-level permission audit */
function auditPermissions(guild) {
  const me = guild.members.me;
  const perms = me?.permissions;
  return REQUIRED_PERMISSIONS.map(([name, bit]) => ({
    name,
    has: Boolean(perms?.has(bit)),
  }));
}

/**
 * Which known security / anti-nuke bots are in this guild.
 *
 * One `guild.members.fetch(id)` per id: fetching a single member by id works
 * without the privileged GuildMembers intent, unlike listing the member list.
 *
 * @returns {Promise<Array<{id: string, tag: string}>>}
 */
async function findSecurityBots(client, guild) {
  const ids = Array.isArray(client.config?.securityBots) ? client.config.securityBots : [];
  const found = [];

  for (const id of ids) {
    const member = await guild.members.fetch(String(id)).catch(() => null);
    if (member) found.push({ id: member.id, tag: member.user?.tag ?? member.id });
  }
  return found;
}

/** What is already configured, so the preview can offer Replace instead. */
async function inspectExisting(client, guildId) {
  const channels = await client.db.table('channels');
  const [radio, azkar, prayer] = await Promise.all([
    safeGet(channels, `${guildId}_radioChannel`),
    safeGet(channels, `${guildId}_azkarChannel`),
    safeGet(channels, `${guildId}_prayerChannel`),
  ]);
  const existing = [];
  if (radio) existing.push('radio');
  if (azkar) existing.push('azkar');
  if (prayer) existing.push('prayer');
  return existing;
}

/**
 * Builds the Components v2 preview. Creates nothing.
 *
 * @returns {Promise<import("discord.js").InteractionReplyOptions>}
 */
async function buildPreview(client, interaction, lang) {
  const guild = interaction.guild;
  const permissions = auditPermissions(guild);
  const missing = permissions.filter((p) => !p.has);
  const securityBots = await findSecurityBots(client, guild);
  const existing = await inspectExisting(client, guild.id);

  const container = new ContainerBuilder().setAccentColor(missing.length ? 0xfaa61a : 0x57f287);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${t(lang, 'quick.title')}\n${t(lang, 'quick.intro')}`),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  // ── What will be created ────────────────────────────────────────────────
  const tree = PLAN.map((item) => (item.key === 'category'
    ? `**${item.name}**  _(${t(lang, item.labelKey)})_`
    : `${TREE_BRANCH} \`${item.name}\`  _(${t(lang, item.labelKey)})_`));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**${t(lang, 'quick.will_create')}**\n${tree.join('\n')}\n\n${t(lang, 'quick.prayer_default')}`,
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );

  // ── Permission tip ──────────────────────────────────────────────────────
  const permLines = permissions.map(
    (p) => `${p.has ? '✅' : '✖'} ${t(lang, `permissions.${p.name}`)}`,
  );
  const tipLines = [
    `**${t(lang, 'quick.tip_title')}**`,
    permLines.join('\n'),
    '',
    missing.length ? t(lang, 'quick.tip_missing_some') : t(lang, 'quick.tip_all_good'),
  ];

  if (securityBots.length) {
    tipLines.push('', t(lang, 'quick.security_warning', {
      bots: securityBots.map((b) => `<@${b.id}>`).join(', '),
    }));
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(tipLines.join('\n')));

  // ── Already configured? ─────────────────────────────────────────────────
  if (existing.length) {
    const names = existing.map((k) => t(lang, `quick.${k === 'radio' ? 'voice_channel' : `${k}_channel`}`));
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**${t(lang, 'quick.existing_title')}**\n${t(lang, 'quick.existing_intro')}\n`
        + `${names.map((n) => `• ${n}`).join('\n')}\n\n${t(lang, 'quick.existing_replace')}`,
      ));
  }

  // ── Buttons. The invoking user id is embedded so the handler can refuse
  //    anyone else, and the lookup in interactionCreate still resolves the
  //    component by its `quicksetup` prefix.
  const uid = interaction.user.id;
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`quicksetup_confirm_${uid}`)
        .setLabel(existing.length ? t(lang, 'quick.btn_replace') : t(lang, 'quick.btn_confirm'))
        .setStyle(existing.length ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`quicksetup_cancel_${uid}`)
        .setLabel(t(lang, 'quick.btn_cancel'))
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [container],
  };
}

/**
 * Creates the channels and saves the settings.
 *
 * Channels are created one at a time with a pause between them: quick setup
 * makes five channels in a row, which anti-nuke bots read as an attack, and a
 * burst also risks Discord's channel-creation rate limit.
 *
 * Nothing is written to the database until every channel exists, so a failure
 * halfway leaves no half-saved configuration — only the channels that were
 * already made, which are reported back.
 *
 * @returns {Promise<{ok: boolean, created: Array<{key: string, id: string, name: string}>,
 *                    missing: string[], reason?: string, channels?: object}>}
 */
async function runQuickSetup(client, interaction, lang, { delayMs = 1200 } = {}) {
  const guild = interaction.guild;
  const created = [];
  const made = {};

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const item of PLAN) {
    try {
      const channel = await guild.channels.create({
        name: item.name,
        type: item.type,
        parent: item.key === 'category' ? undefined : made.category?.id,
        reason: `Quran quick setup by ${interaction.user.tag ?? interaction.user.id}`,
      });

      made[item.key] = channel;
      created.push({ key: item.key, id: channel.id, name: channel.name });
    } catch (err) {
      return {
        ok: false,
        created,
        missing: PLAN.slice(created.length).map((p) => t(lang, p.labelKey)),
        reason: err.message,
      };
    }

    // Pause between creations, but not after the last one.
    if (item !== PLAN[PLAN.length - 1]) await wait(delayMs);
  }

  // ── All channels exist: now persist, matching the individual setup flows ──
  try {
    const channels = await client.db.table('channels');
    const gid = guild.id;

    await channels.set(`${gid}_radioChannel`, {
      channelId: made.voice.id,
      guildId: gid,
      url: RadioChannels[0].value,
      enabled: false,
      ch: made.control.id,
      msgId: null,
      offBy: null,
      offAt: null,
    });

    await channels.set(`${gid}_azkarChannel`, {
      channelId: made.azkar.id,
      guildId: gid,
      enabled: false,
      msgTimeSend: '1h',
      // Must not be empty: sendAzkar picks a random id out of this list, and an
      // empty list makes `idCat` undefined so an enabled schedule silently
      // posts nothing. 'azkar' is the morning/evening pool (sendAzkar widens it
      // to include 'any'), matching what the category menu offers.
      category: ['azkar'],
      roles: [],
      lastSned: 0,
    });

    await channels.set(`${gid}_prayerChannel`, {
      channelId: made.prayer.id,
      guildId: gid,
      enabled: false,
      roles: [],
      ...CAIRO,
    });

    // Everything is saved: now actually turn the three services on, the same
    // way doing it by hand would. Each is independent — one failing must not
    // stop the others.
    const services = await startServices(client, interaction, lang, made);

    return { ok: true, created, missing: [], channels: made, services };
  } catch (err) {
    return {
      ok: false,
      created,
      missing: [],
      reason: `settings could not be saved: ${err.message}`,
    };
  }
}

/**
 * Turns the radio, adhkar and prayer schedules on, exactly as the manual
 * controls do, and reports each one separately.
 *
 * `enabled` is only written as true once that service has actually started, so
 * a stored "on" never claims something that is not running. On a failure the
 * flag is reverted and any timer that was armed is cleared, so a half-started
 * service cannot keep rescheduling in the background.
 *
 * @returns {Promise<Array<{key: 'radio'|'azkar'|'prayer', ok: boolean, reason?: string}>>}
 */
async function startServices(client, interaction, lang, made) {
  const guild = interaction.guild;
  const gid = guild.id;
  const channels = await client.db.table('channels');
  const results = [];

  // ── Radio ───────────────────────────────────────────────────────────────
  try {
    const row = await channels.get(`${gid}_radioChannel`);

    // Same pre-flight the ON button uses, so the reason is specific.
    const ready = await checkRadioReady(client, guild, row, lang);
    if (!ready.ok) throw new Error(ready.message);

    const health = await checkStationHealth(client, row.url, lang);
    if (!health.ok) throw new Error(health.message);

    const conn = await joinAndPlayQuran(client, row.channelId, guild, row.url);
    if (conn === null) throw new Error(say(lang, 'radio.errors.channel_missing'));
    if (conn === 'cantConnect') throw new Error(say(lang, 'radio.errors.cant_connect'));

    client.Radio.set(gid, conn);
    await channels.set(`${gid}_radioChannel..enabled`, true);
    results.push({ key: 'radio', ok: true });
  } catch (err) {
    await safeSet(channels, `${gid}_radioChannel..enabled`, false);
    results.push({ key: 'radio', ok: false, reason: err.message });
    client.logger?.warn?.(`[quicksetup] radio did not start in ${gid}: ${err.message}`);
  }

  // ── Adhkar ──────────────────────────────────────────────────────────────
  try {
    // sendAzkar reads `enabled` to decide whether to post, so it has to be set
    // before the call, and reverted if the call does not take.
    await channels.set(`${gid}_azkarChannel..enabled`, true);
    const row = await channels.get(`${gid}_azkarChannel`);

    const started = await SendAzkar(client, guild, row);
    if (!started) throw new Error(say(lang, 'setup.errors.channel_not_found'));

    results.push({ key: 'azkar', ok: true });
  } catch (err) {
    await safeSet(channels, `${gid}_azkarChannel..enabled`, false);
    const timer = client.Azkar?.get(gid);
    if (timer) { clearTimeout(timer); client.Azkar.delete(gid); }
    results.push({ key: 'azkar', ok: false, reason: err.message });
    client.logger?.warn?.(`[quicksetup] adhkar did not start in ${gid}: ${err.message}`);
  }

  // ── Prayer ──────────────────────────────────────────────────────────────
  try {
    // SendAdhan refuses outright unless `enabled` is already true.
    await channels.set(`${gid}_prayerChannel..enabled`, true);
    const row = await channels.get(`${gid}_prayerChannel`);

    const started = await SendAdhan(client, guild, row);
    if (!started) throw new Error(say(lang, 'setup.errors.channel_not_found'));

    results.push({ key: 'prayer', ok: true });
  } catch (err) {
    await safeSet(channels, `${gid}_prayerChannel..enabled`, false);
    const timer = client.Adhan?.get(gid);
    if (timer) { clearTimeout(timer); client.Adhan.delete(gid); }
    results.push({ key: 'prayer', ok: false, reason: err.message });
    client.logger?.warn?.(`[quicksetup] prayer did not start in ${gid}: ${err.message}`);
  }

  return results;
}

/** Result screen, Components v2. */
function buildResult(client, lang, result) {
  const anyServiceFailed = (result.services ?? []).some((svc) => !svc.ok);
  const container = new ContainerBuilder().setAccentColor(
    !result.ok ? 0xed4245 : (anyServiceFailed ? 0xfaa61a : 0x57f287),
  );

  if (result.ok) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${t(lang, 'quick.done_title')}\n${t(lang, 'quick.done_body', { count: result.created.length })}`,
    ));

    // Per-service outcome. A service that did not start is named with its
    // reason; the ones that did keep running regardless.
    const services = result.services ?? [];
    if (services.length) {
      const lines = services.map((svc) => {
        const name = t(lang, `quick.svc_${svc.key}`);
        return svc.ok
          ? `✅ ${name} — ${t(lang, 'quick.svc_started')}`
          : `✖ ${name} — ${t(lang, 'quick.svc_failed')}\n\u2003${svc.reason ?? ''}`;
      });
      container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          `**${t(lang, 'quick.services_title')}**\n${lines.join('\n')}`,
        ));
    }
  } else {
    const lines = [
      `## ${t(lang, 'quick.failed_title')}`,
      t(lang, 'quick.failed_reason', { reason: result.reason ?? 'unknown' }),
      '',
      t(lang, 'quick.failed_created', {
        created: result.created.length
          ? result.created.map((c) => `\`${c.name}\``).join(', ')
          : t(lang, 'quick.none'),
      }),
      t(lang, 'quick.failed_not_created', {
        missing: result.missing.length ? result.missing.join(', ') : t(lang, 'quick.none'),
      }),
      '',
      t(lang, 'quick.failed_nothing_saved'),
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }

  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
}

module.exports = {
  buildPreview,
  runQuickSetup,
  startServices,
  buildResult,
  auditPermissions,
  findSecurityBots,
  inspectExisting,
  REQUIRED_PERMISSIONS,
  PLAN,
  CATEGORY_NAME,
  CAIRO,
};
