'use strict';

const crypto = require('node:crypto');

// No 0/O, 1/I/L: these are the characters people mistype when copying a code.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 5 * 60000;
const LOCK_MS = 5 * 60000;
const MIN_LENGTH = 4;
const MAX_LENGTH = 8;

/**
 * Generates a random code from ALPHABET.
 * @param {number} length Clamped to MIN_LENGTH..MAX_LENGTH.
 * @param {(max: number) => number} [randomInt] Injected in tests.
 * @returns {string}
 */
function generateCode(length, randomInt = crypto.randomInt) {
  const n = Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(Number(length) || 6)));
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/**
 * Normalises what the member typed: case, spaces and the look-alike characters
 * that are not in the alphabet (O→0 is not mapped since 0 is excluded too).
 * @param {string} input
 */
function normalize(input) {
  return String(input || '').toUpperCase().replace(/[\s\-_.]/g, '');
}

/** "K7PX" → "K 7 P X": shown in the modal so it cannot be pasted back as is. */
const spaced = (code) => code.split('').join(' ');

/**
 * In-memory challenge book. Codes are short-lived and only meaningful for a few
 * minutes, so they are deliberately not persisted.
 * @param {{now?: () => number, ttlMs?: number, lockMs?: number}} [opts]
 */
function createChallenges(opts = {}) {
  const now = opts.now || Date.now;
  const ttl = opts.ttlMs ?? CODE_TTL_MS;
  const lockMs = opts.lockMs ?? LOCK_MS;
  const codes = new Map();
  const fails = new Map();

  const prune = () => {
    if (codes.size + fails.size < 2000) return;
    for (const [k, v] of codes) if (v.expires <= now()) codes.delete(k);
    for (const [k, v] of fails) if (v.until && v.until <= now()) fails.delete(k);
  };

  return {
    /**
     * Remaining lock time in ms for a key (0 when not locked).
     * @param {string} key
     */
    lockedFor(key) {
      const f = fails.get(key);
      return f?.until && f.until > now() ? f.until - now() : 0;
    },
    /**
     * Creates (or replaces) the code for a key.
     * @param {string} key `${guildId}:${userId}`
     * @param {number} length
     * @param {(max: number) => number} [randomInt]
     * @returns {string}
     */
    issue(key, length, randomInt) {
      prune();
      const code = generateCode(length, randomInt);
      codes.set(key, { code, expires: now() + ttl });
      return code;
    },
    /**
     * Checks an answer. A wrong answer invalidates the code so every attempt
     * needs a fresh one; maxAttempts wrong answers lock the key for a while.
     * @param {string} key
     * @param {string} input
     * @param {number} maxAttempts
     * @returns {{result: 'ok'|'wrong'|'expired'|'locked', left?: number, lockedMs?: number}}
     */
    check(key, input, maxAttempts) {
      const locked = this.lockedFor(key);
      if (locked) return { result: 'locked', lockedMs: locked };
      const entry = codes.get(key);
      codes.delete(key);
      if (!entry || entry.expires <= now()) return { result: 'expired' };
      if (normalize(input) === entry.code) {
        fails.delete(key);
        return { result: 'ok' };
      }
      const f = fails.get(key) || { count: 0, until: 0 };
      f.count += 1;
      const max = Math.max(1, Number(maxAttempts) || 3);
      if (f.count >= max) {
        f.count = 0;
        f.until = now() + lockMs;
        fails.set(key, f);
        return { result: 'locked', lockedMs: lockMs };
      }
      fails.set(key, f);
      return { result: 'wrong', left: max - f.count };
    },
    /** Forgets everything about a key (member verified or left). */
    clear(key) { codes.delete(key); fails.delete(key); }
  };
}

module.exports = { ALPHABET, MIN_LENGTH, MAX_LENGTH, CODE_TTL_MS, generateCode, normalize, spaced, createChallenges };
