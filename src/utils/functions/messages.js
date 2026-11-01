'use strict';

const { t } = require('./i18n');

/**
 * Message style: every reply the bot sends a user is prefixed with an emoji
 * that says at a glance what kind of message it is.
 *
 *     ❌ | I could not connect to the voice channel.
 *
 * The emoji lives HERE and nowhere else. Translators write plain sentences in
 * `lang/*.json`, and the prefix is applied at send time, so the same message
 * always carries the same emoji in both languages and nobody has to remember
 * to type it. See the "Message style" section of CLAUDE.md.
 *
 * Deliberately NOT decorated: the control panel's own structure (labels,
 * placeholders, field names) and the adhkar and prayer posts. Those are
 * content, not status messages.
 */

/** The complete mapping. Keep this list and CLAUDE.md in step. */
const EMOJI = {
  error: '❌',   // something failed
  denied: '⛔',  // not allowed: missing permission or access refused
  warn: '⚠️',    // needs attention, but nothing broke
  success: '✅', // a confirmation that something worked
  tip: '🔰',     // guidance: what to do next
  info: 'ℹ️',    // neutral information
  radio: '🕋',   // Quran and radio
  azkar: '☀️',   // adhkar
  prayer: '🕌',  // prayer times
};

/**
 * Message type per lang key. Explicit rather than inferred from the key path:
 * a wrong emoji on a refusal reads as a bug, so this is worth being able to
 * read and audit at a glance.
 *
 * A key absent from here is treated as UI text and never decorated.
 */
const TYPE_BY_KEY = {
  // ── shared ───────────────────────────────────────────────────────────────
  'common.guild_only': 'denied',
  'common.unexpected': 'error',
  'common.busy': 'warn',

  // ── radio ────────────────────────────────────────────────────────────────
  'radio.panel.not_configured': 'tip',
  'radio.panel.panel_sent': 'radio',
  'radio.errors.not_configured': 'tip',
  'radio.errors.channel_missing': 'tip',
  'radio.errors.channel_full': 'warn',
  'radio.errors.missing_permissions': 'denied',
  'radio.errors.not_in_voice': 'denied',
  'radio.errors.wrong_voice': 'denied',
  'radio.errors.audio_server_unreachable': 'warn',
  'radio.errors.audio_server_auth': 'error',
  'radio.errors.station_failed': 'warn',
  'radio.errors.cant_connect': 'error',
  'radio.errors.no_stations': 'error',
  'radio.errors.cannot_post_panel': 'denied',

  // ── setup ────────────────────────────────────────────────────────────────
  'setup.errors.channel_not_found': 'error',
  'setup.errors.not_voice_channel': 'warn',
  'setup.errors.not_text_channel': 'warn',
  'setup.errors.already_set': 'info',
  'setup.errors.missing_permissions': 'denied',
  'setup.errors.radio_moved': 'info',
  'setup.success.radio_channel_set': 'radio',
  'setup.success.azkar_channel_set': 'azkar',
  'setup.success.prayer_channel_set': 'prayer',

  // ── quick setup (replies only; the preview itself is UI) ──────────────────
  'quick.need_manage_guild': 'denied',
  'quick.not_your_button': 'denied',
  'quick.cancelled': 'info',

  // ── owner / mod manager (replies only; the pages are UI) ─────────────────
  'manager.denied': 'denied',
  'manager.invalid_id': 'error',
  'manager.mod_added': 'success',
  'manager.mod_already': 'info',
  'manager.mod_removed': 'success',
  'manager.mod_not_found': 'warn',
  'manager.mod_is_owner': 'denied',
  'manager.reset_not_found': 'error',
  'manager.reset_nothing': 'info',
  'manager.reset_done': 'success',
  'manager.reset_failed': 'error',

  // ── language ─────────────────────────────────────────────────────────────
  'lang.changed': 'success',
  'lang.already': 'info',
  'lang.no_permission': 'denied',
  'lang.prompt_tip': 'tip',
};

/** @returns {string|null} the message type for a key, or null if it is UI text */
function typeOf(key) {
  return TYPE_BY_KEY[key] ?? null;
}

/**
 * Applies the prefix. Separated from `say` so a caller holding an
 * already-built string (a composed error, a reason from elsewhere) can still
 * get the house style.
 *
 * @param {keyof EMOJI} type
 * @param {string} text
 */
function decorate(type, text) {
  const emoji = EMOJI[type];
  if (!emoji || !text) return text;
  // Idempotent: never stack a second prefix onto a decorated string.
  if (Object.values(EMOJI).some((e) => String(text).startsWith(`${e} |`))) return text;
  return `${emoji} | ${text}`;
}

/**
 * Translate and decorate in one step — the function user-facing replies should
 * use instead of `t()`.
 *
 * Keys that carry no type fall through undecorated, so using this for a label
 * by mistake is harmless.
 *
 * @param {object|undefined} lang
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @param {keyof EMOJI} [typeOverride] force a type, e.g. a domain emoji
 * @returns {string}
 */
function say(lang, key, vars = {}, typeOverride = null) {
  const text = t(lang, key, vars);
  const type = typeOverride ?? typeOf(key);
  return type ? decorate(type, text) : text;
}

module.exports = { say, decorate, typeOf, EMOJI, TYPE_BY_KEY };
