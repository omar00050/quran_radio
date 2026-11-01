/**
 * Language resolution and message style — no Discord, no bot.
 *
 *   node tests/i18n.test.js
 *
 * Two things are pinned here:
 *
 * 1. There is NO automatic language detection. A guild that has not chosen a
 *    language gets English, whatever its Discord locale says. Guessing from
 *    `guild.preferredLocale` / `interaction.locale` was removed deliberately,
 *    and this test fails if it comes back.
 *
 * 2. Every user-facing message carries its emoji prefix, the same one in both
 *    languages, and UI labels carry none. See CLAUDE.md "Message style".
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { GoodDB, JSONDriver } = require('good.db');

const i18n = require('../src/utils/functions/i18n');
const { say, decorate, EMOJI, TYPE_BY_KEY } = require('../src/utils/functions/messages');
const en = require('../lang/en.json');
const ar = require('../lang/ar.json');

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? flat(v, p + k + '.') : [p + k]);

const dbFile = path.join(process.env.TMP || '/tmp', 'i18n_test.json');
function makeClient(preferredLocale) {
  try { fs.unlinkSync(dbFile); } catch (_) {}
  const db = new GoodDB(new JSONDriver({ path: dbFile }), { nested: '..', nestedIsEnabled: true });
  return {
    db,
    guilds: { cache: new Map([['G1', { id: 'G1', preferredLocale }]]) },
    logger: { debug() {}, warn() {}, error() {}, log() {} },
  };
}

async function main() {
  // ── 1. no automatic detection ───────────────────────────────────────────
  record("DEFAULT_LANG is 'en'", i18n.DEFAULT_LANG === 'en', i18n.DEFAULT_LANG);

  for (const locale of ['ar-SA', 'ar', 'AR-EG', 'en-US', 'tr-TR', undefined]) {
    const code = await i18n.resolveLangCode(makeClient(locale), 'G1');
    record(`locale ${String(locale)} with nothing saved -> en`, code === 'en', code);
  }

  record('the locale helpers are gone from the module surface',
    i18n.localeToLang === undefined && i18n.defaultLangFor === undefined,
    Object.keys(i18n).join(', '));

  // The source files must not consult a locale anywhere.
  const sources = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) sources.push(full);
    }
  })(path.join(__dirname, '..', 'src'));

  const offenders = sources.filter((f) => {
    const src = fs.readFileSync(f, 'utf8')
      // strip comments: the i18n docblock explains why detection was removed
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return /preferredLocale|interaction\.locale|localeToLang/.test(src);
  }).map((f) => path.relative(path.join(__dirname, '..'), f));
  record('no source file reads a Discord locale', offenders.length === 0, offenders.join(', '));

  // ── 2. an explicit choice is honoured and recorded ──────────────────────
  {
    const c = makeClient('en-US');
    record('nothing saved initially', !(await i18n.hasStoredLang(c, 'G1')));
    await i18n.setGuildLang(c, 'G1', 'ar', 'command', 'U1');
    record('an explicit choice wins', await i18n.resolveLangCode(c, 'G1') === 'ar');
    record('the choice marks the first-use prompt answered', Boolean(await c.db.get('G1_langPrompt')));
    await i18n.setGuildLang(c, 'G1', 'zz', 'command');
    record('an unsupported code falls back to en', await i18n.resolveLangCode(c, 'G1') === 'en');
  }

  // ── 3. message style ───────────────────────────────────────────────────
  {
    const keys = Object.keys(TYPE_BY_KEY);
    const emojis = Object.values(EMOJI);

    const undecorated = keys.filter((k) => !emojis.some((e) => say(en, k, {}).startsWith(`${e} |`)));
    record(`every message key is decorated (${keys.length})`, undecorated.length === 0, undecorated.join(', '));

    const mismatched = keys.filter((k) => say(en, k, {}).split(' |')[0] !== say(ar, k, {}).split(' |')[0]);
    record('the same key gets the same emoji in both languages', mismatched.length === 0, mismatched.join(', '));

    const unknownKeys = keys.filter((k) => !flat(en).includes(k) || !flat(ar).includes(k));
    record('every mapped key exists in both lang files', unknownKeys.length === 0, unknownKeys.join(', '));

    const unusedTypes = Object.keys(EMOJI).filter((tp) => !Object.values(TYPE_BY_KEY).includes(tp));
    record('every emoji type is actually used', unusedTypes.length === 0, unusedTypes.join(', '));

    // UI text must stay clean.
    for (const uiKey of ['radio.panel.btn_on', 'radio.panel.select_quran', 'lang.title', 'lang.btn_ar', 'manager.owner_title']) {
      record(`UI key ${uiKey} is not decorated`,
        !emojis.some((e) => say(en, uiKey, {}).startsWith(`${e} |`)), say(en, uiKey, {}));
    }

    // No emoji baked into the translations themselves.
    const bakedIn = [];
    for (const [label, file] of [['en', en], ['ar', ar]]) {
      for (const k of flat(file)) {
        const v = k.split('.').reduce((o, p) => o[p], file);
        if (typeof v === 'string' && new RegExp(`^(${emojis.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*\\|`).test(v)) {
          bakedIn.push(`${label}:${k}`);
        }
      }
    }
    record('no emoji prefix is hard-coded in a lang file', bakedIn.length === 0, bakedIn.join(', '));

    record('decorate is idempotent',
      decorate('error', decorate('error', 'boom')) === '❌ | boom',
      decorate('error', decorate('error', 'boom')));

    record('an unmapped key passes through untouched', say(en, 'lang.name_en', {}) === 'English');
  }

  // ── 4. lang file parity ────────────────────────────────────────────────
  {
    const A = flat(ar), E = flat(en);
    record('both lang files have the same keys',
      A.length === E.length && E.every((k) => A.includes(k)),
      `ar=${A.length} en=${E.length}`);
  }

  try { fs.unlinkSync(dbFile); } catch (_) {}
  const failed = results.filter((r) => !r.passed).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
