'use strict';

const crypto = require('node:crypto');
const logger = require('./logger').child('scheduler');

// setTimeout only accepts delays up to ~24.8 days; longer jobs are re-armed in steps.
const MAX_DELAY = 2 ** 31 - 1;
const RETRY_MS = 60000;
const KEY = 'scheduler.jobs';

/**
 * Persistent job scheduler. Jobs live in the global store under "scheduler.jobs",
 * so a restart re-arms them (overdue jobs fire right away).
 * @param {{store?: object, now?: () => number}} [opts]
 */
function createScheduler(opts = {}) {
  const getStore = () => (opts.store || require('./store')).global();
  const now = opts.now || (() => Date.now());
  const handlers = new Map();
  const timers = new Map();
  let started = false;

  const jobs = () => getStore().get(KEY, {});

  const arm = (job) => {
    clearTimeout(timers.get(job.id));
    const delay = Math.min(Math.max(0, job.runAt - now()), MAX_DELAY);
    const timer = setTimeout(() => {
      timers.delete(job.id);
      if (job.runAt > now()) return arm(job);
      run(job.id);
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    timers.set(job.id, timer);
  };

  const run = async (id) => {
    const job = jobs()[id];
    if (!job) return;
    const handler = handlers.get(job.type);
    if (!handler) {
      // The module owning this job type may not be loaded yet: try again later.
      logger.warn(`No handler for job type "${job.type}", retrying in 60 s`);
      job.runAt = now() + RETRY_MS;
      getStore().set(`${KEY}.${id}`, job);
      return arm(job);
    }
    // Removed before running so a crashing handler cannot loop forever.
    getStore().delete(`${KEY}.${id}`);
    try {
      await handler(job.payload, job);
    } catch (err) {
      logger.error(`Job ${job.type} (${id}) failed:`, err);
    }
  };

  return {
    /**
     * Registers the function that runs jobs of `type`.
     * @param {string} type Namespaced name, e.g. "moderation:unban".
     * @param {(payload: any, job: {id: string, type: string, runAt: number, payload: any}) => any} fn
     */
    on(type, fn) { handlers.set(type, fn); },
    /**
     * Schedules a job. The payload must be JSON-serialisable (IDs, not Discord objects).
     * @param {string} type
     * @param {number} runAtMs Unix time in ms.
     * @param {*} [payload]
     * @returns {string} Job id.
     */
    schedule(type, runAtMs, payload = null) {
      const job = { id: crypto.randomUUID(), type, runAt: Number(runAtMs), payload };
      getStore().set(`${KEY}.${job.id}`, job);
      if (started) arm(job);
      return job.id;
    },
    /**
     * Cancels a job. Returns true if it existed.
     * @param {string} id
     */
    cancel(id) {
      clearTimeout(timers.get(id));
      timers.delete(id);
      return getStore().delete(`${KEY}.${id}`);
    },
    /**
     * Lists pending jobs, optionally of one type and matching a payload filter.
     * @param {string} [type]
     * @param {(payload: any) => boolean} [filter]
     */
    list(type, filter) {
      return Object.values(jobs()).filter((j) => (!type || j.type === type) && (!filter || filter(j.payload)));
    },
    /** Arms every stored job. Called once by bot.js when the client is ready. */
    start() {
      started = true;
      for (const job of Object.values(jobs())) arm(job);
    },
    /** Clears all timers (jobs stay stored). */
    stop() {
      started = false;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    }
  };
}

module.exports = createScheduler();
module.exports.createScheduler = createScheduler;
