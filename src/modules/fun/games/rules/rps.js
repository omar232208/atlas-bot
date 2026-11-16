'use strict';

/** Rock-paper-scissors rules without Discord code. */

const CHOICES = ['rock', 'paper', 'scissors'];

/** Each choice beats the one it maps to. */
const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/**
 * Decides one round.
 * @param {string} a 'rock' | 'paper' | 'scissors'
 * @param {string} b
 * @returns {'a'|'b'|'draw'} Which side wins, or 'draw'.
 * @throws {Error} when a choice is unknown.
 */
function resolve(a, b) {
  if (!CHOICES.includes(a) || !CHOICES.includes(b)) throw new Error(`unknown choice: ${a} / ${b}`);
  if (a === b) return 'draw';
  return BEATS[a] === b ? 'a' : 'b';
}

module.exports = { CHOICES, BEATS, resolve };
