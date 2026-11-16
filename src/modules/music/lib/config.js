'use strict';

const { clampVolume } = require('./logic');

/**
 * Per-guild music settings, stored under "music.*" in store.guild(id). The
 * dashboard schema (index.js) uses exactly these paths and defaults.
 */
const DEFAULTS = Object.freeze({
  djRole: null,
  maxQueue: 200,
  stay247: false,
  announce: true,
  announceChannel: null,
  defaultVolume: 100,
  allowFiles: true
});

const LIMITS = Object.freeze({ maxQueue: { min: 1, max: 1000 }, defaultVolume: { min: 0, max: 150 } });

/**
 * Reads the music settings of a guild with defaults and sane bounds applied,
 * so a hand-edited data file can never break playback.
 * @param {{guild: (id: string) => {get: Function}}} store
 * @param {string} guildId
 * @returns {typeof DEFAULTS}
 */
function getConfig(store, guildId) {
  const g = store.guild(guildId);
  const maxQueue = Math.round(Number(g.get('music.maxQueue', DEFAULTS.maxQueue)));
  return {
    djRole: g.get('music.djRole', DEFAULTS.djRole) || null,
    maxQueue: Number.isFinite(maxQueue) ? Math.min(LIMITS.maxQueue.max, Math.max(LIMITS.maxQueue.min, maxQueue)) : DEFAULTS.maxQueue,
    stay247: g.get('music.stay247', DEFAULTS.stay247) === true,
    announce: g.get('music.announce', DEFAULTS.announce) !== false,
    announceChannel: g.get('music.announceChannel', DEFAULTS.announceChannel) || null,
    defaultVolume: clampVolume(g.get('music.defaultVolume', DEFAULTS.defaultVolume)),
    allowFiles: g.get('music.allowFiles', DEFAULTS.allowFiles) !== false
  };
}

module.exports = { DEFAULTS, LIMITS, getConfig };
