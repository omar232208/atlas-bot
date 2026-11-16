'use strict';

const store = require('../../../core/store');
const i18n = require('../../../core/i18n');

/**
 * Per-guild economy settings live at store path "economy.config". Defaults
 * are applied on read so a partial object (written by /economy config or by
 * the web dashboard) always yields a complete configuration.
 */
const DEFAULTS = Object.freeze({
  currency: null,      // null = the localized default name "coins"
  symbol: '$',
  daily: 500,
  weekly: 2500,
  workMin: 50,
  workMax: 200,
  robFailPercent: 50
});

/** Bounds shared by the slash command and the dashboard schema. */
const LIMITS = Object.freeze({
  daily: [1, 1000000],
  weekly: [1, 1000000],
  workMin: [1, 1000000],
  workMax: [1, 1000000],
  robFailPercent: [0, 90]
});

/**
 * Reads the merged configuration of a guild.
 * @param {object} [s] Store (defaults to the shared store).
 * @param {string} guildId
 * @returns {typeof DEFAULTS}
 */
function getConfig(s = store, guildId) {
  const stored = s.guild(guildId).get('economy.config', {});
  const cfg = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (stored[key] !== undefined && stored[key] !== null) cfg[key] = stored[key];
  }
  return cfg;
}

/**
 * Formats an amount with the currency symbol, e.g. "1 250 $".
 * @param {number} amount
 * @param {typeof DEFAULTS} cfg
 * @param {*} target Language target for number formatting.
 */
function formatMoney(amount, cfg, target) {
  const lang = i18n.resolveLang(target);
  const locale = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', pt: 'pt-BR' }[lang] || 'en-US';
  return `${Number(amount).toLocaleString(locale)} ${cfg.symbol}`;
}

/**
 * Currency name shown in texts: the configured one or the localized default.
 * @param {typeof DEFAULTS} cfg
 * @param {*} target
 */
function currencyName(cfg, target) {
  return cfg.currency || i18n.t(target, 'economy:defaults.currency');
}

module.exports = { DEFAULTS, LIMITS, getConfig, formatMoney, currencyName };
