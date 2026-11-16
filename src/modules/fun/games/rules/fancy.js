'use strict';

/**
 * Text and compatibility helpers behind /ship, /reverse and /emojify. Pure
 * functions so they can be tested without Discord.
 */

/**
 * 32-bit FNV-1a hash of a string. Chosen because it is tiny, deterministic and
 * spreads similar inputs well, which keeps /ship results stable across restarts.
 * @param {string} text
 * @returns {number} Unsigned 32-bit integer.
 */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Compatibility score from 0 to 100. The two IDs are sorted first so that
 * "A and B" and "B and A" always give the same result.
 * @param {string} idA
 * @param {string} idB
 * @returns {number}
 */
function shipScore(idA, idB) {
  const [low, high] = [String(idA), String(idB)].sort();
  return fnv1a(`${low}:${high}`) % 101;
}

/**
 * Index of the verdict text for a score (0 = worst, 4 = best).
 * @param {number} score 0..100
 * @returns {number}
 */
function verdictIndex(score) {
  if (score < 20) return 0;
  if (score < 40) return 1;
  if (score < 60) return 2;
  if (score < 85) return 3;
  return 4;
}

/**
 * Couple name built from the first half of the first name and the second half
 * of the second one, so "Alice" and "Bob" give "Alice"-"ob" style blends.
 * @param {string} first
 * @param {string} second
 * @returns {string}
 */
function blendNames(first, second) {
  const a = [...first];
  const b = [...second];
  return a.slice(0, Math.ceil(a.length / 2)).join('') + b.slice(Math.floor(b.length / 2)).join('');
}

/**
 * Reverses a text by user-perceived characters, so accents and emoji survive.
 * @param {string} text
 * @returns {string}
 */
function reverseText(text) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return [...segmenter.segment(text)].map((s) => s.segment).reverse().join('');
}

const KEYCAP = (digit) => `${digit}️⃣`;

/**
 * Converts letters to regional-indicator symbols (Discord shows them as letter
 * squares), digits to keycaps, and keeps everything else. Accents are removed
 * first so "é" becomes the E square.
 * @param {string} text
 * @returns {string}
 */
function emojify(text) {
  let out = '';
  for (const char of text) {
    const base = char.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    if (/^[A-Z]$/.test(base)) out += String.fromCodePoint(0x1f1e6 + base.charCodeAt(0) - 65);
    else if (/^[0-9]$/.test(char)) out += KEYCAP(char);
    else if (char === ' ') out += '   ';
    else out += char;
  }
  return out;
}

module.exports = { fnv1a, shipScore, verdictIndex, blendNames, reverseText, emojify };
