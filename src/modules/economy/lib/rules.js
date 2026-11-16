'use strict';

/**
 * Pure economy rules: no Discord, no storage. Every random draw takes an
 * injectable `rng` returning a number in [0, 1), so tests can script outcomes.
 */

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;

const COOLDOWNS = Object.freeze({ work: HOUR, rob: 4 * HOUR, weekly: 7 * DAY });
const DAILY_COOLDOWN = DAY;
// Missing a day for more than this resets the streak to 1.
const STREAK_WINDOW = 2 * DAY;
// Each extra day of streak adds 10 %, up to 6 steps (+60 %).
const MAX_STREAK_STEPS = 6;
const STREAK_STEP_PERCENT = 10;

// Robbing needs a minimum wallet so new members cannot be robbed out of nothing.
const ROB_MIN_WALLET = 200;
const ROB_STEAL_MIN_PERCENT = 10;
const ROB_STEAL_MAX_PERCENT = 40;
// A failed robbery costs the robber this share of their wallet.
const ROB_FINE_PERCENT = 10;

/**
 * Uniform integer in [min, max] inclusive.
 * @param {() => number} rng
 * @param {number} min
 * @param {number} max
 */
function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Parses a typed amount. Accepts digits (spaces and underscores ignored) or
 * "all", which means the whole available balance.
 * @param {string} input
 * @param {number} available Balance the amount is taken from.
 * @returns {number|null} A positive safe integer, 0 for "all" on an empty balance, or null if invalid.
 */
function parseAmount(input, available) {
  const text = String(input ?? '').trim().toLowerCase().replace(/[\s_]/g, '');
  if (text === 'all') return Math.max(0, Math.floor(available));
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Milliseconds still to wait before a cooldown that started at `last` is over.
 * @param {number} last Unix ms of the last use (0 if never).
 * @param {number} cooldownMs
 * @param {number} now
 */
function cooldownLeft(last, cooldownMs, now) {
  return Math.max(0, (last || 0) + cooldownMs - now);
}

/**
 * Daily claim status and the streak it would produce.
 * @param {{last?: number, streak?: number}} prev
 * @param {number} now
 * @returns {{ready: true, streak: number} | {ready: false, wait: number}}
 */
function dailyStatus(prev, now) {
  const last = prev?.last || 0;
  const wait = cooldownLeft(last, DAILY_COOLDOWN, now);
  if (wait > 0) return { ready: false, wait };
  const continues = last > 0 && now - last < STREAK_WINDOW;
  return { ready: true, streak: continues ? (prev.streak || 1) + 1 : 1 };
}

/**
 * Daily reward for a given streak length (1 = first day).
 * @param {number} base
 * @param {number} streak
 */
function dailyReward(base, streak) {
  const steps = Math.min(Math.max(streak - 1, 0), MAX_STREAK_STEPS);
  return base + Math.floor((base * steps * STREAK_STEP_PERCENT) / 100);
}

/**
 * Random work pay between min and max inclusive.
 * @param {number} min
 * @param {number} max
 * @param {() => number} rng
 */
function workReward(min, max, rng) {
  return randInt(rng, Math.min(min, max), Math.max(min, max));
}

/**
 * Resolves a robbery attempt.
 * On success the robber takes a share of the target's wallet; on failure the
 * robber pays a fine (kept by nobody: it leaves the economy).
 * @param {{robberWallet: number, targetWallet: number, failPercent: number, rng: () => number}} p
 * @returns {{success: boolean, amount: number}}
 */
function robOutcome({ robberWallet, targetWallet, failPercent, rng }) {
  if (rng() * 100 < failPercent) {
    const fine = Math.min(robberWallet, Math.floor((robberWallet * ROB_FINE_PERCENT) / 100));
    return { success: false, amount: fine };
  }
  const share = randInt(rng, ROB_STEAL_MIN_PERCENT, ROB_STEAL_MAX_PERCENT);
  const amount = Math.min(targetWallet, Math.max(1, Math.floor((targetWallet * share) / 100)));
  return { success: true, amount };
}

module.exports = {
  SECOND, HOUR, DAY, COOLDOWNS, DAILY_COOLDOWN, STREAK_WINDOW,
  ROB_MIN_WALLET, ROB_FINE_PERCENT,
  randInt, parseAmount, cooldownLeft, dailyStatus, dailyReward, workReward, robOutcome
};
