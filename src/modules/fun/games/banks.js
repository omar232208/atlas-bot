'use strict';

const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../../../core/i18n');
const { LANGUAGES } = require('../../../core/i18n');

const DATA = path.join(__dirname, '..', 'data');
const cache = new Map();

/**
 * Loads a per-language data file (trivia or words). Missing languages fall back
 * to English, the same rule as the locale files, so a server never gets an empty
 * game because of a missing translation.
 * @param {'trivia'|'words'} kind
 * @param {string} lang One of i18n LANGUAGES.
 * @returns {Array<any>}
 */
function loadBank(kind, lang) {
  const key = `${kind}:${lang}`;
  if (cache.has(key)) return cache.get(key);
  const file = (code) => path.join(DATA, kind === 'trivia' ? 'trivia' : 'words', `${code}.json`);
  const code = LANGUAGES.includes(lang) && fs.existsSync(file(lang)) ? lang : 'en';
  const bank = JSON.parse(fs.readFileSync(file(code), 'utf8'));
  cache.set(key, bank);
  return bank;
}

/**
 * Language used for a game: the server language (set with /config language),
 * resolved by the core translator.
 * @param {*} target Interaction or guild-like object.
 * @returns {string}
 */
function gameLanguage(target) {
  return i18n.resolveLang(target);
}

module.exports = { loadBank, gameLanguage };
