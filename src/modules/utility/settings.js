'use strict';

const store = require('../../core/store');

/**
 * Per-guild settings of the utility module. The dashboard schema in index.js is
 * built from this table, and every read goes through readSetting(), so the
 * defaults and bounds are defined exactly once.
 */
const SETTINGS = {
  // Snipe keeps deleted messages in memory, so it is off until a server opts in.
  'utility.snipe.enabled': { default: false },
  'utility.remind.maxDays': { default: 365, min: 1, max: 3650 }
};

/**
 * Reads a setting of a guild, falling back to the default when the stored
 * value has the wrong type or is out of bounds.
 * @param {string} guildId
 * @param {keyof typeof SETTINGS} path
 * @returns {boolean|number}
 */
function readSetting(guildId, path) {
  const spec = SETTINGS[path];
  if (!spec) throw new Error(`utility: unknown setting ${path}`);
  const value = store.guild(guildId).get(path, spec.default);
  if (typeof spec.default === 'boolean') return typeof value === 'boolean' ? value : spec.default;
  return typeof value === 'number' && value >= spec.min && value <= spec.max ? value : spec.default;
}

module.exports = { SETTINGS, readSetting };
