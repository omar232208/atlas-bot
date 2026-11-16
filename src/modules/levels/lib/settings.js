'use strict';

const store = require('../../../core/store');

/**
 * Levels settings: "levels.enabled" (off by default, so nobody is tracked
 * without an admin turning it on) and "levels.config" for the rest. Read
 * through these helpers so partial objects from the dashboard still work.
 */
const DEFAULTS = Object.freeze({ cooldown: 60, xpMin: 15, xpMax: 25, announce: true, announceChannel: null });
const LIMITS = Object.freeze({
  cooldown: [10, 3600],
  xpMin: [1, 500],
  xpMax: [1, 500]
});

/** @param {object} [s] Store. */
function isEnabled(s = store, guildId) {
  return s.guild(guildId).get('levels.enabled', false) === true;
}

/**
 * @param {object} [s] Store.
 * @param {string} guildId
 * @returns {typeof DEFAULTS}
 */
function getConfig(s = store, guildId) {
  const stored = s.guild(guildId).get('levels.config', {});
  const cfg = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (stored[key] !== undefined && stored[key] !== null) cfg[key] = stored[key];
  }
  return cfg;
}

module.exports = { DEFAULTS, LIMITS, isEnabled, getConfig };
