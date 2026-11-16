'use strict';

/**
 * Trivia helpers without Discord code. In the data files the correct answer is
 * always the FIRST entry of `answers`; this module shuffles the options so the
 * correct button is not always in the same place.
 */

/**
 * Fisher-Yates shuffle that returns a new array.
 * @template T
 * @param {T[]} items
 * @param {() => number} [rnd] Returns a float in [0, 1). Injected for tests.
 * @returns {T[]}
 */
function shuffle(items, rnd = Math.random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Checks a bank of questions. Used by the tests and to skip broken entries.
 * @param {Array<{q: string, answers: string[]}>} bank
 * @returns {string[]} Problems found, empty when the bank is valid.
 */
function validateBank(bank) {
  const problems = [];
  if (!Array.isArray(bank)) return ['bank is not an array'];
  bank.forEach((entry, index) => {
    if (typeof entry?.q !== 'string' || !entry.q.trim()) problems.push(`#${index}: missing question`);
    if (!Array.isArray(entry?.answers) || entry.answers.length !== 4) {
      problems.push(`#${index}: needs exactly 4 answers`);
      return;
    }
    if (entry.answers.some((a) => typeof a !== 'string' || !a.trim())) problems.push(`#${index}: empty answer`);
    if (new Set(entry.answers.map((a) => a.trim().toLowerCase())).size !== 4) problems.push(`#${index}: duplicate answers`);
  });
  return problems;
}

/**
 * Picks `count` different questions at random (or all of them if the bank is smaller).
 * @param {Array<object>} bank
 * @param {number} count
 * @param {() => number} [rnd]
 */
function pickQuestions(bank, count, rnd = Math.random) {
  return shuffle(bank, rnd).slice(0, Math.max(0, Math.min(count, bank.length)));
}

/**
 * Turns a bank entry into a question with shuffled options.
 * @param {{q: string, answers: string[]}} entry
 * @param {() => number} [rnd]
 * @returns {{prompt: string, options: string[], correctIndex: number}}
 */
function buildQuestion(entry, rnd = Math.random) {
  const order = shuffle(entry.answers.map((text, index) => ({ text, index })), rnd);
  return {
    prompt: entry.q,
    options: order.map((o) => o.text),
    correctIndex: order.findIndex((o) => o.index === 0)
  };
}

module.exports = { shuffle, validateBank, pickQuestions, buildQuestion };
