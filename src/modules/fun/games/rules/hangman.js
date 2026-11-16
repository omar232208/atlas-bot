'use strict';

/**
 * Hangman rules without Discord code. Letters are compared without accents
 * (É matches E) so a player never has to type or click a special character.
 */

const MAX_WRONG = 6;

/**
 * Upper-cases a letter and strips its accent: "é" -> "E". Non-letters return ''.
 * @param {string} char
 * @returns {string} 'A'..'Z' or ''.
 */
function baseLetter(char) {
  const base = String(char).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return /^[A-Z]$/.test(base) ? base : '';
}

/**
 * The distinct A-Z letters a word needs to be guessed.
 * @param {string} word
 * @returns {string[]}
 */
function lettersOf(word) {
  const set = new Set();
  for (const char of word) {
    const letter = baseLetter(char);
    if (letter) set.add(letter);
  }
  return [...set];
}

/**
 * @param {string} word
 * @returns {{word: string, guessed: string[], wrong: string[]}}
 */
function createState(word) {
  if (typeof word !== 'string' || !lettersOf(word).length) throw new Error('hangman: word needs at least one letter');
  return { word, guessed: [], wrong: [] };
}

/**
 * Applies a guess. The input state is not mutated.
 * @param {{word: string, guessed: string[], wrong: string[]}} state
 * @param {string} input Any character; only A-Z after accent removal counts.
 * @returns {{state: object, outcome: 'hit'|'miss'|'repeat'|'invalid'}}
 */
function guess(state, input) {
  const letter = baseLetter(input);
  if (!letter) return { state, outcome: 'invalid' };
  if (state.guessed.includes(letter) || state.wrong.includes(letter)) return { state, outcome: 'repeat' };
  if (lettersOf(state.word).includes(letter)) {
    return { state: { ...state, guessed: [...state.guessed, letter] }, outcome: 'hit' };
  }
  return { state: { ...state, wrong: [...state.wrong, letter] }, outcome: 'miss' };
}

/**
 * The word with unguessed letters as "_". Spaces, hyphens and apostrophes are
 * always shown, so the player sees the shape of the word.
 * @param {{word: string, guessed: string[]}} state
 * @returns {string}
 */
function masked(state) {
  return [...state.word].map((char) => {
    const letter = baseLetter(char);
    if (!letter) return char;
    return state.guessed.includes(letter) ? char : '_';
  }).join('');
}

/**
 * @param {{word: string, guessed: string[], wrong: string[]}} state
 * @returns {'won'|'lost'|'playing'}
 */
function status(state) {
  if (state.wrong.length >= MAX_WRONG) return 'lost';
  const needed = lettersOf(state.word);
  return needed.every((letter) => state.guessed.includes(letter)) ? 'won' : 'playing';
}

module.exports = { MAX_WRONG, baseLetter, lettersOf, createState, guess, masked, status };
