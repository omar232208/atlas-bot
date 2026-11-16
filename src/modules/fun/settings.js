'use strict';

const store = require('../../core/store');

/**
 * Per-guild settings of the fun module. This table is the single source of
 * truth for the defaults and bounds: the dashboard schema in index.js is built
 * from it, and every read goes through readSetting(), so a dashboard change is
 * effective immediately.
 */
const SETTINGS = {
  'fun.games.timeoutMinutes': { default: 3, min: 1, max: 30 },
  'fun.trivia.questionSeconds': { default: 20, min: 10, max: 60 }
};

/**
 * Reads a setting of a guild, falling back to the default when the stored
 * value is missing or out of bounds (for example written by hand in the JSON).
 * @param {string} guildId
 * @param {keyof typeof SETTINGS} path Store path inside the guild file.
 * @returns {number}
 */
function readSetting(guildId, path) {
  const spec = SETTINGS[path];
  if (!spec) throw new Error(`fun: unknown setting ${path}`);
  const value = store.guild(guildId).get(path, spec.default);
  return typeof value === 'number' && value >= spec.min && value <= spec.max ? value : spec.default;
}

module.exports = { SETTINGS, readSetting };
