'use strict';

const UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
const ORDER = ['w', 'd', 'h', 'm', 's'];

/**
 * Parses "10m", "2h30m", "1w 2d", "45s" into milliseconds. A bare number is minutes.
 * @param {string} input
 * @returns {number|null} null when the text is not a valid positive duration.
 */
function parse(input) {
  if (input === undefined || input === null) return null;
  const text = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text) > 0 ? Number(text) * UNITS.m : null;
  if (!/^(\d+[smhdw])+$/.test(text)) return null;
  let total = 0;
  for (const [, n, unit] of text.matchAll(/(\d+)([smhdw])/g)) total += Number(n) * UNITS[unit];
  return total > 0 ? total : null;
}

/**
 * Formats milliseconds as localized text, e.g. "2 heures 30 minutes".
 * Uses keys common:time.<unit>.one / .other.
 * @param {number} ms
 * @param {*} [target] Language target accepted by t() (language code, interaction, guild).
 * @param {{maxParts?: number}} [opts] Number of units kept (default 2).
 * @returns {string}
 */
function format(ms, target, opts = {}) {
  const { t } = require('./i18n');
  const maxParts = opts.maxParts ?? 2;
  let rest = Math.max(0, Math.round(ms / 1000) * 1000);
  const parts = [];
  for (const unit of ORDER) {
    const n = Math.floor(rest / UNITS[unit]);
    if (n > 0 && parts.length < maxParts) {
      parts.push(t(target, `common:time.${unit}.${n === 1 ? 'one' : 'other'}`, { count: n }));
      rest -= n * UNITS[unit];
    }
  }
  return parts.length ? parts.join(' ') : t(target, 'common:time.s.other', { count: 0 });
}

module.exports = { parse, format, UNITS };
