'use strict';

const { DATA } = require('./config');

/** Case types, in the order they are shown in /history filters. */
const CASE_TYPES = ['warn', 'unwarn', 'clearwarns', 'timeout', 'untimeout', 'kick', 'softban', 'ban', 'tempban', 'unban'];

/**
 * Creates a numbered case. Numbers only grow (a deleted case keeps its number
 * free) so a case number quoted in a log message never points to another case.
 * @param {{get: Function, set: Function, update: Function}} gs Guild store handle.
 * @param {{type: string, userId: string, userTag?: string, moderatorId: string, moderatorTag?: string, reason?: string, duration?: number, expiresAt?: number, auto?: boolean, extra?: object}} data
 * @param {number} [now]
 * @returns {object} The stored case.
 */
function createCase(gs, data, now = Date.now()) {
  if (!CASE_TYPES.includes(data.type)) throw new Error(`unknown case type ${data.type}`);
  const id = gs.update(DATA.nextCase, (n) => (Number(n) || 0) + 1, 0);
  const entry = {
    id,
    type: data.type,
    userId: data.userId,
    userTag: data.userTag || data.userId,
    moderatorId: data.moderatorId,
    moderatorTag: data.moderatorTag || data.moderatorId,
    reason: data.reason || null,
    createdAt: now
  };
  if (data.duration) entry.duration = data.duration;
  if (data.expiresAt) entry.expiresAt = data.expiresAt;
  if (data.auto) entry.auto = true;
  if (data.type === 'warn') entry.active = true;
  if (data.extra) Object.assign(entry, data.extra);
  gs.set(`${DATA.cases}.${id}`, entry);
  return entry;
}

/**
 * @param {{get: Function}} gs
 * @param {number|string} id
 * @returns {object|null}
 */
function getCase(gs, id) {
  return gs.get(`${DATA.cases}.${Number(id)}`, null);
}

/**
 * Merges a patch into a case (copy then set: store values must not be mutated).
 * @param {{get: Function, set: Function}} gs
 * @param {number|string} id
 * @param {object} patch
 * @returns {object|null} The updated case, or null if it does not exist.
 */
function updateCase(gs, id, patch) {
  const current = getCase(gs, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  gs.set(`${DATA.cases}.${current.id}`, next);
  return next;
}

/**
 * @param {{get: Function, delete: Function}} gs
 * @param {number|string} id
 * @returns {object|null} The removed case.
 */
function deleteCase(gs, id) {
  const current = getCase(gs, id);
  if (!current) return null;
  gs.delete(`${DATA.cases}.${current.id}`);
  return current;
}

/**
 * Lists cases, newest first.
 * @param {{get: Function}} gs
 * @param {{userId?: string, type?: string}} [filter]
 * @returns {object[]}
 */
function listCases(gs, filter = {}) {
  return Object.values(gs.get(DATA.cases, {}))
    .filter((c) => (!filter.userId || c.userId === filter.userId) && (!filter.type || c.type === filter.type))
    .sort((a, b) => b.id - a.id);
}

/**
 * Warnings that still count: active, and younger than the expiry if one is set.
 * @param {{get: Function}} gs
 * @param {string} userId
 * @param {number} [expiryMs] 0 = never expire.
 * @param {number} [now]
 */
function activeWarns(gs, userId, expiryMs = 0, now = Date.now()) {
  return listCases(gs, { userId, type: 'warn' }).filter((c) => c.active !== false && (!expiryMs || now - c.createdAt < expiryMs));
}

/**
 * Marks every active warning of a user as removed.
 * @param {{get: Function, set: Function}} gs
 * @param {string} userId
 * @returns {number} How many warnings were cleared.
 */
function clearWarns(gs, userId) {
  const list = listCases(gs, { userId, type: 'warn' }).filter((c) => c.active !== false);
  for (const c of list) updateCase(gs, c.id, { active: false });
  return list.length;
}

/**
 * Counts cases by type for a user (used by /history's summary line).
 * @param {object[]} cases
 * @returns {Record<string, number>}
 */
function countByType(cases) {
  const out = {};
  for (const c of cases) out[c.type] = (out[c.type] || 0) + 1;
  return out;
}

module.exports = { CASE_TYPES, createCase, getCase, updateCase, deleteCase, listCases, activeWarns, clearWarns, countByType };
