'use strict';

/** Every store path this module reads, with its default (the dashboard uses the same). */
const SETTINGS = {
  'welcome.enabled': false,
  'welcome.channelId': null,
  'welcome.message': '',
  'welcome.embed': true,
  'welcome.dmEnabled': false,
  'welcome.dmMessage': '',
  'goodbye.enabled': false,
  'goodbye.channelId': null,
  'goodbye.message': '',
  'goodbye.embed': true,
  'autorole.humans': [],
  'autorole.bots': []
};

/** Maximum autoroles per member type, to keep one join to a single API call. */
const MAX_AUTOROLES = 10;

/**
 * Reads a setting with its default.
 * @param {object} g Guild store handle.
 * @param {keyof SETTINGS} path
 */
function setting(g, path) {
  if (!Object.prototype.hasOwnProperty.call(SETTINGS, path)) throw new Error(`welcome: unknown setting ${path}`);
  return g.get(path, SETTINGS[path]);
}

module.exports = { SETTINGS, MAX_AUTOROLES, setting };
