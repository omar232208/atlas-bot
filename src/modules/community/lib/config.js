'use strict';

/**
 * Every scalar per-guild setting of the community module, with its default.
 * Code reads them through setting() with the literal path so the web dashboard
 * (which writes the same paths) takes effect immediately, and so a test can
 * check that each dashboard field is really used.
 * Collections (suggestion items, tags, hubs...) live next to these keys but are
 * managed by commands, not by the dashboard.
 */
const SETTINGS = Object.freeze({
  'community.suggestions.channelId': null,
  'community.suggestions.anonymous': false,
  'community.suggestions.threads': false,
  'community.suggestions.dmUpdates': true,
  'community.suggestions.cooldown': 60,
  'community.starboard.enabled': false,
  'community.starboard.channelId': null,
  'community.starboard.threshold': 3,
  'community.starboard.emoji': '⭐',
  'community.starboard.selfStar': false,
  'community.starboard.ignoredChannels': [],
  'community.birthdays.enabled': false,
  'community.birthdays.channelId': null,
  'community.birthdays.roleId': null,
  'community.birthdays.hour': 9,
  'community.birthdays.utcOffset': 0,
  'community.birthdays.message': '',
  'community.afk.enabled': true,
  'community.afk.nickname': true,
  'community.tags.managerRoleId': null,
  'community.sticky.delay': 5,
  'community.tempvoice.defaultLimit': 0,
  'community.tempvoice.nameTemplate': '',
  'community.autoresponder.enabled': true,
  'community.autoresponder.cooldown': 10
});

/**
 * Reads a setting of a guild with its declared default.
 * @param {{get: Function}} guildStore store.guild(id)
 * @param {keyof typeof SETTINGS} path
 * @returns {*}
 */
function setting(guildStore, path) {
  if (!Object.prototype.hasOwnProperty.call(SETTINGS, path)) throw new Error(`community: unknown setting ${path}`);
  const value = guildStore.get(path, SETTINGS[path]);
  return value === undefined || value === null ? SETTINGS[path] : value;
}

/**
 * Store paths of the collections, kept in one place so cleanup code and commands agree.
 */
const COLLECTIONS = Object.freeze({
  suggestions: 'community.suggestions.items',
  suggestionCounter: 'community.suggestions.counter',
  starboardPosts: 'community.starboard.posts',
  birthdays: 'community.birthdays.users',
  birthdayState: 'community.birthdays.state',
  stats: 'community.stats.channels',
  sticky: 'community.sticky.channels',
  afk: 'community.afk.users',
  tags: 'community.tags.items',
  hubs: 'community.tempvoice.hubs',
  tempChannels: 'community.tempvoice.channels',
  responders: 'community.autoresponder.rules',
  responderCounter: 'community.autoresponder.counter'
});

module.exports = { SETTINGS, COLLECTIONS, setting };
