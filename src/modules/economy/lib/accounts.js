'use strict';

/**
 * Account records live at "economy.users.<userId>" in the guild store.
 * Every balance change goes through updateAccount, which runs synchronously
 * inside store.update: Node runs one JS callback at a time, so two commands
 * can never interleave a read and a write on the same balance.
 */

/**
 * Fills missing fields so older or partial records are always complete.
 * @param {object} [raw]
 */
function normalize(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    wallet: Number.isSafeInteger(r.wallet) ? r.wallet : 0,
    bank: Number.isSafeInteger(r.bank) ? r.bank : 0,
    daily: { last: r.daily?.last || 0, streak: r.daily?.streak || 0 },
    weekly: r.weekly || 0,
    work: r.work || 0,
    rob: r.rob || 0,
    inventory: r.inventory && typeof r.inventory === 'object' ? { ...r.inventory } : {}
  };
}

/**
 * @param {object} s Store.
 * @param {string} guildId
 * @param {string} userId
 */
function getAccount(s, guildId, userId) {
  return normalize(s.guild(guildId).get(`economy.users.${userId}`));
}

/**
 * Runs `fn(account)` on the stored record and saves it. The return value of
 * `fn` is passed back to the caller.
 * @template T
 * @param {object} s
 * @param {string} guildId
 * @param {string} userId
 * @param {(acc: object) => T} fn
 * @returns {T}
 */
function updateAccount(s, guildId, userId, fn) {
  let result;
  s.guild(guildId).update(`economy.users.${userId}`, (raw) => {
    const acc = normalize(raw);
    result = fn(acc);
    return acc;
  });
  return result;
}

/**
 * Shop items at "economy.shop.<id>". Returns them as an array sorted by price.
 * @param {object} s
 * @param {string} guildId
 */
function listItems(s, guildId) {
  const shop = s.guild(guildId).get('economy.shop', {});
  return Object.values(shop).sort((a, b) => a.price - b.price);
}

module.exports = { normalize, getAccount, updateAccount, listItems };
