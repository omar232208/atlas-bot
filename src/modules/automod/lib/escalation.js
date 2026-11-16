'use strict';

/** Automod actions, from the mildest to the harshest. */
const ACTIONS = ['delete', 'warn', 'timeout', 'kick', 'ban'];
const SEVERITY = Object.fromEntries(ACTIONS.map((a, i) => [a, i]));
const STEP_ACTIONS = ['warn', 'timeout', 'kick', 'ban'];

/**
 * Strike timestamps still inside the window.
 * @param {number[]} list
 * @param {number} windowMs 0 = strikes never expire.
 * @param {number} [now]
 */
function activeStrikes(list, windowMs, now = Date.now()) {
  return (Array.isArray(list) ? list : []).filter((at) => Number.isFinite(at) && (!windowMs || now - at < windowMs));
}

/**
 * Adds a strike and drops expired ones.
 * @param {number[]} list
 * @param {number} windowMs
 * @param {number} [now]
 * @returns {number[]}
 */
function addStrike(list, windowMs, now = Date.now()) {
  // Capped so a long-running spammer cannot grow the stored list forever.
  return [...activeStrikes(list, windowMs, now), now].slice(-100);
}

/**
 * Cleans the escalation steps: valid ones, one per strike count, sorted.
 * @param {Array<{strikes: number, action: string, duration?: number}>} steps
 */
function normalizeSteps(steps) {
  const map = new Map();
  for (const s of Array.isArray(steps) ? steps : []) {
    const strikes = Number(s?.strikes);
    if (!Number.isInteger(strikes) || strikes < 1 || !STEP_ACTIONS.includes(s.action)) continue;
    const step = { strikes, action: s.action };
    if (Number(s.duration) > 0 && (s.action === 'timeout' || s.action === 'ban')) step.duration = Number(s.duration);
    map.set(strikes, step);
  }
  return [...map.values()].sort((a, b) => a.strikes - b.strikes);
}

/**
 * The step reached with `count` strikes: the highest one at or below the
 * count, so a repeat offender past the last step keeps getting it.
 * @param {number} count
 * @param {Array} steps
 * @returns {{strikes: number, action: string, duration?: number}|null}
 */
function stepFor(count, steps) {
  let found = null;
  for (const s of normalizeSteps(steps)) if (s.strikes <= count) found = s;
  return found;
}

/**
 * The harsher of the filter's own action and the escalation step.
 * Equal actions keep the longer duration.
 * @param {{action: string, duration?: number}} base
 * @param {{action: string, duration?: number}|null} step
 * @returns {{action: string, duration?: number, escalated: boolean}}
 */
function pickAction(base, step) {
  if (!step || SEVERITY[step.action] < SEVERITY[base.action]) return { ...base, escalated: false };
  if (SEVERITY[step.action] > SEVERITY[base.action]) return { action: step.action, duration: step.duration, escalated: true };
  const longer = (step.duration || 0) > (base.duration || 0);
  return { action: base.action, duration: longer ? step.duration : base.duration, escalated: longer };
}

module.exports = { ACTIONS, STEP_ACTIONS, SEVERITY, activeStrikes, addStrike, normalizeSteps, stepFor, pickAction };
