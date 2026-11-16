'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LANGUAGES = ['ar', 'en'];
const FALLBACK = 'en';

// Discord locale codes used for *_localizations. English is sent for both
// en-US and en-GB so every English client sees the same text.
const DISCORD_LOCALES = {
  ar: ['ar'],
  en: ['en-US', 'en-GB']
};

/**
 * Normalises any language-ish value ("fr", "pt-BR", "en-US") to one of LANGUAGES.
 * @param {string} value
 * @returns {string|null}
 */
function normalize(value) {
  if (!value) return null;
  const short = String(value).toLowerCase().slice(0, 2);
  return LANGUAGES.includes(short) ? short : null;
}

/**
 * Creates a translator over a locales folder.
 * @param {{dir?: string, store?: object, defaultLanguage?: string}} [options]
 */
function createI18n(options = {}) {
  const dir = options.dir || path.join(__dirname, '..', '..', 'locales');
  const data = {};

  /** (Re)reads every locales/<lang>/<namespace>.json file. */
  const load = () => {
    for (const lang of LANGUAGES) {
      data[lang] = {};
      const langDir = path.join(dir, lang);
      if (!fs.existsSync(langDir)) continue;
      for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
        data[lang][file.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8'));
      }
    }
  };
  load();

  const defaultLanguage = () => normalize(options.defaultLanguage || process.env.DEFAULT_LANGUAGE) || 'en';
  const getStore = () => options.store || require('./store');

  /**
   * Finds the language for a target: a language code, a guild, an interaction,
   * a member/message/channel (anything with .guild or .guildId), or null.
   * @param {*} target
   * @returns {string}
   */
  const resolveLang = (target) => {
    if (typeof target === 'string') return normalize(target) || defaultLanguage();
    const guildId = target?.guildId ?? target?.guild?.id ?? (target?.members && target?.id) ?? null;
    if (guildId) {
      const saved = normalize(getStore().guild(guildId).get('language'));
      if (saved) return saved;
    }
    return defaultLanguage();
  };

  const lookup = (lang, key) => {
    const idx = key.indexOf(':');
    if (idx < 1) return undefined;
    const ns = data[lang]?.[key.slice(0, idx)];
    let cur = ns;
    for (const part of key.slice(idx + 1).split('.')) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = cur[part];
    }
    return cur;
  };

  const interpolate = (str, vars) => str.replace(/\{(\w+)\}/g, (m, name) => (vars && vars[name] !== undefined ? String(vars[name]) : m));

  /**
   * Translates "namespace:path.to.key". Falls back to English, then to the key itself.
   * @param {*} target See resolveLang.
   * @param {string} key
   * @param {object} [vars] Values for {placeholders}.
   * @returns {string}
   */
  const t = (target, key, vars) => {
    const lang = resolveLang(target);
    let value = lookup(lang, key);
    if (typeof value !== 'string') value = lookup(FALLBACK, key);
    if (typeof value !== 'string') return key;
    return interpolate(value, vars);
  };

  /**
   * True when the key exists (as a string) in the given language.
   * @param {string} lang
   * @param {string} key
   */
  const has = (lang, key) => typeof lookup(lang, key) === 'string';

  /**
   * Raw value (string or object) at a key, without fallback. Useful to list keys.
   * @param {string} lang
   * @param {string} key
   */
  const raw = (lang, key) => lookup(lang, key);

  /**
   * Builds a Discord *_localizations object for a key (missing languages are skipped).
   * @param {string} key
   * @returns {Record<string, string>}
   */
  const localizations = (key) => {
    const out = {};
    for (const lang of LANGUAGES) {
      const value = lookup(lang, key);
      if (typeof value !== 'string') continue;
      for (const code of DISCORD_LOCALES[lang]) out[code] = value;
    }
    return out;
  };

  return { t, has, raw, localizations, resolveLang, normalize, load, data, LANGUAGES, DISCORD_LOCALES, defaultLanguage };
}

module.exports = createI18n();
module.exports.createI18n = createI18n;
module.exports.LANGUAGES = LANGUAGES;
