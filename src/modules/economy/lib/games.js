'use strict';

/**
 * Pure game rules for slots and coinflip.
 * Slots: each reel picks a symbol with a weight; a triple pays its multiplier,
 * a pair returns the stake. With these numbers the expected return is about 91 %
 * (tests check it by enumerating all 21^3 reel combinations).
 */

const SLOT_SYMBOLS = Object.freeze([
  { symbol: '7', weight: 1, triple: 100 },
  { symbol: '★', weight: 2, triple: 40 },
  { symbol: '♦', weight: 3, triple: 20 },
  { symbol: '♣', weight: 4, triple: 12 },
  { symbol: '♥', weight: 5, triple: 8 },
  { symbol: '♠', weight: 6, triple: 6 }
]);
const PAIR_MULTIPLIER = 1;
const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

/**
 * Picks one slot symbol according to the weights.
 * @param {() => number} rng
 * @returns {number} Index into SLOT_SYMBOLS.
 */
function pickReel(rng) {
  let r = Math.floor(rng() * TOTAL_WEIGHT);
  for (let i = 0; i < SLOT_SYMBOLS.length; i++) {
    r -= SLOT_SYMBOLS[i].weight;
    if (r < 0) return i;
  }
  return SLOT_SYMBOLS.length - 1;
}

/**
 * Spins three reels.
 * @param {() => number} rng
 * @returns {number[]} Three indexes into SLOT_SYMBOLS.
 */
function spinSlots(rng) {
  return [pickReel(rng), pickReel(rng), pickReel(rng)];
}

/**
 * Multiplier for a spin: triple > pair > nothing.
 * @param {number[]} reels Indexes from spinSlots.
 * @returns {{multiplier: number, kind: 'triple'|'pair'|'none'}}
 */
function slotsResult(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) return { multiplier: SLOT_SYMBOLS[a].triple, kind: 'triple' };
  if (a === b || b === c || a === c) return { multiplier: PAIR_MULTIPLIER, kind: 'pair' };
  return { multiplier: 0, kind: 'none' };
}

/**
 * Flips a coin and compares it with the player's pick.
 * @param {() => number} rng
 * @param {'heads'|'tails'} pick
 * @returns {{result: 'heads'|'tails', won: boolean}}
 */
function coinflip(rng, pick) {
  const result = rng() < 0.5 ? 'heads' : 'tails';
  return { result, won: result === pick };
}

module.exports = { SLOT_SYMBOLS, PAIR_MULTIPLIER, TOTAL_WEIGHT, spinSlots, slotsResult, coinflip };
