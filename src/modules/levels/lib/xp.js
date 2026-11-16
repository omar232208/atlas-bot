'use strict';

/**
 * Level curve, same as MEE6: going from level l to l+1 costs 5l^2 + 50l + 100 XP.
 * Level 1 therefore needs 100 XP, level 2 needs 255 XP in total, and so on.
 * Pure functions, unit-tested against the closed-form sums.
 */

/** XP needed to go from `level` to `level + 1`. */
function xpForLevel(level) {
  return 5 * level * level + 50 * level + 100;
}

/**
 * Total XP needed to reach `level` from zero (closed form of the sum of xpForLevel).
 * @param {number} level
 */
function totalXpForLevel(level) {
  if (level <= 0) return 0;
  const n = level;
  return (5 * (n - 1) * n * (2 * n - 1)) / 6 + 25 * (n - 1) * n + 100 * n;
}

/**
 * Level reached with `xp` total XP.
 * @param {number} xp
 */
function levelFromXp(xp) {
  let level = 0;
  while (totalXpForLevel(level + 1) <= xp) level++;
  return level;
}

/**
 * Progress inside the current level.
 * @param {number} xp
 * @returns {{level: number, current: number, required: number}}
 */
function progress(xp) {
  const level = levelFromXp(xp);
  return { level, current: xp - totalXpForLevel(level), required: xpForLevel(level) };
}

/**
 * Text progress bar with filled and empty blocks.
 * @param {number} ratio 0..1
 * @param {number} [width]
 */
function progressBar(ratio, width = 14) {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

module.exports = { xpForLevel, totalXpForLevel, levelFromXp, progress, progressBar };
