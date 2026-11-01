'use strict';

const { safeGet, safeSet } = require('./dbSafe');

const DEFAULT_LANG = 'en';
const SUPPORTED = ['ar', 'en'];

/**
 * Translation lookup with `{placeholder}` interpolation.
 *
 * `lang` is the already-required language object that interactionCreate resolves
 * per guild and passes down to handlers. It may legitimately be undefined — a
 * handler reached from a path that does not supply it, or a key that does not
 * exist in that language yet — so this never throws and never returns
 * `undefined`: it falls back to English, then to the key itself, so a missing
 * string shows up as a visible key instead of "undefined" in a user's face.
 *
 * @param {object|undefined} lang  language object (lang/ar.json, lang/en.json)
 * @param {string} key             dotted path, e.g. "radio.errors.channel_full"
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
function t(lang, key, vars = {}) {
  let value = resolve(lang, key);

  if (typeof value !== 'string') {
    // Fall back to English so a key missing from one translation still reads.
    try {
      value = resolve(require(`@root/lang/${DEFAULT_LANG}.json`), key);
    } catch (_) { /* alias not registered (e.g. a unit test) */ }
  }

  if (typeof value !== 'string') return key;

  return value.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match);
}

function resolve(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  return key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), obj);
}

/**
 * The guild's language code.
 *
 * There is deliberately NO automatic detection: a guild that has not chosen a
 * language gets English, full stop. Neither `guild.preferredLocale` nor
 * `interaction.locale` is consulted anywhere, because a server's Discord
 * locale says nothing reliable about which language its members want the bot
 * to speak, and silently guessing made the setting feel broken. The language
 * changes only when somebody with Manage Server picks one.
 *
 * @returns {'ar'|'en'}
 */
async function resolveLangCode(client, guildId) {
  const stored = await safeGet(client.db, `${guildId}_lang`);
  if (stored && SUPPORTED.includes(String(stored))) return String(stored);
  return DEFAULT_LANG;
}

function loadLang(code) {
  try {
    return require(`@root/lang/${SUPPORTED.includes(code) ? code : DEFAULT_LANG}.json`);
  } catch (_) {
    return require(`@root/lang/${DEFAULT_LANG}.json`);
  }
}

/**
 * The guild's language object. Used by every path that sends something —
 * interactions, startup restore, voice state changes — so one guild reads one
 * language everywhere.
 *
 * @returns {Promise<object>}
 */
async function getGuildLang(client, guildId) {
  return loadLang(await resolveLangCode(client, guildId));
}

/** Has the guild made an explicit choice, as opposed to getting the default? */
async function hasStoredLang(client, guildId) {
  const stored = await safeGet(client.db, `${guildId}_lang`);
  return Boolean(stored && SUPPORTED.includes(String(stored)));
}

/**
 * Saves a guild's language and records where the choice came from.
 *
 * Both sources are a deliberate human action: `prompt` is the one-time
 * first-use tip, `command` is `/lang`. Nothing sets a language automatically.
 *
 * @param {'prompt'|'command'} source
 * @returns {Promise<boolean>} whether the write went through
 */
async function setGuildLang(client, guildId, code, source, actorId = null) {
  const lang = SUPPORTED.includes(code) ? code : DEFAULT_LANG;
  const written = await safeSet(client.db, `${guildId}_lang`, lang);

  if (written) {
    // A saved choice means the first-use prompt must never appear again.
    await safeSet(client.db, `${guildId}_langPrompt`, true);

    try {
      // Lazily required: the reporter is a thin IPC shim, but keeping the
      // require here avoids a cycle through the stats modules at load time.
      require('./statsReporter').reportLanguage(client, {
        guildId: String(guildId),
        lang,
        source,
        actorId: actorId ? String(actorId) : null,
      });
    } catch (_) { /* stats must never affect the language change */ }
  }

  return written;
}

module.exports = {
  t,
  getGuildLang,
  resolveLangCode,
  hasStoredLang,
  setGuildLang,
  loadLang,
  DEFAULT_LANG,
  SUPPORTED,
};
