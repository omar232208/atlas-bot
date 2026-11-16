'use strict';

/** Sanctions a warn threshold can trigger. */
const THRESHOLD_ACTIONS = ['timeout', 'kick', 'softban', 'ban'];

// Discord refuses timeouts longer than 28 days; a minute of margin avoids
// rejections caused by clock skew between the bot and Discord.
const MAX_TIMEOUT_MS = 28 * 86400000 - 60000;

/**
 * Cleans a stored threshold list: valid entries only, one per warn count, sorted.
 * @param {Array<{warns: number, action: string, duration?: number}>} list
 */
function normalizeThresholds(list) {
  const byCount = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const warns = Number(item?.warns);
    if (!Number.isInteger(warns) || warns < 1 || !THRESHOLD_ACTIONS.includes(item.action)) continue;
    const entry = { warns, action: item.action };
    if (Number(item.duration) > 0 && (item.action === 'timeout' || item.action === 'ban')) entry.duration = Number(item.duration);
    byCount.set(warns, entry);
  }
  return [...byCount.values()].sort((a, b) => a.warns - b.warns);
}

/**
 * Adds or replaces the threshold for a warn count.
 * @param {Array} list
 * @param {{warns: number, action: string, duration?: number}} entry
 */
function upsertThreshold(list, entry) {
  return normalizeThresholds([...normalizeThresholds(list).filter((x) => x.warns !== entry.warns), entry]);
}

/**
 * Removes the threshold for a warn count.
 * @param {Array} list
 * @param {number} warns
 */
function removeThreshold(list, warns) {
  return normalizeThresholds(list).filter((x) => x.warns !== warns);
}

/**
 * The threshold reached by exactly `count` active warnings. Exact match on
 * purpose: a 4th warning must not re-apply the sanction set for 3.
 * @param {number} count
 * @param {Array} list
 * @returns {{warns: number, action: string, duration?: number}|null}
 */
function matchThreshold(count, list) {
  return normalizeThresholds(list).find((x) => x.warns === count) || null;
}

module.exports = { THRESHOLD_ACTIONS, MAX_TIMEOUT_MS, normalizeThresholds, upsertThreshold, removeThreshold, matchThreshold };
