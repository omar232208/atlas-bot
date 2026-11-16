'use strict';

const { serialize } = require('./snapshot');
const backups = require('./store');

const JOB = 'backup:tick';
const TICK_MS = 3600000;
const MIN_INTERVAL = 6 * 3600000;
const MAX_INTERVAL = 30 * 86400000;

/**
 * Whether an automatic backup is due. Pure (tested).
 * @param {number} interval 0 = disabled.
 * @param {number} last Time of the previous automatic backup (0 if none).
 * @param {number} now
 */
function isDue(interval, last, now) {
  if (!interval || interval < MIN_INTERVAL) return false;
  return now - (last || 0) >= interval;
}

/**
 * Makes sure exactly one hourly tick job is pending. A single tick for every
 * guild (instead of one job per guild) means a change of interval, from a
 * command or the dashboard, applies within the hour without re-scheduling.
 * @param {object} scheduler
 */
function ensureTick(scheduler) {
  const jobs = scheduler.list(JOB);
  for (const extra of jobs.slice(1)) scheduler.cancel(extra.id);
  if (!jobs.length) scheduler.schedule(JOB, Date.now() + TICK_MS, null);
}

/**
 * Scheduler handler: backs up every guild whose interval elapsed, then re-arms.
 * @param {import('discord.js').Client} client
 * @param {object} ctx
 */
function tickHandler(client, ctx) {
  return async () => {
    try {
      const now = Date.now();
      for (const guild of client.guilds.cache.values()) {
        const gstore = ctx.store.guild(guild.id);
        const { autoInterval } = backups.getConfig(ctx.store, guild.id);
        if (!isDue(autoInterval, gstore.get('backup.lastAuto', 0), now)) continue;
        try {
          await guild.roles.fetch();
          await guild.channels.fetch();
          backups.save(ctx.store, { guildId: guild.id, guildName: guild.name, authorId: guild.ownerId, auto: true, name: ctx.t(guild, `${backups.NS}:auto.name`), data: serialize(guild) });
          gstore.set('backup.lastAuto', now);
        } catch (err) {
          ctx.logger.warn(`backup: automatic backup of ${guild.id} failed:`, err.message);
        }
      }
    } finally {
      ensureTick(ctx.scheduler);
    }
  };
}

module.exports = { JOB, TICK_MS, MIN_INTERVAL, MAX_INTERVAL, isDue, ensureTick, tickHandler };
