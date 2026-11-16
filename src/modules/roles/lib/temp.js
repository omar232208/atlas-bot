'use strict';

const { NS, getConfig } = require('./util');

const JOB = 'roles:expire';

/**
 * Pending temporary-role jobs of a guild (optionally of one member and role).
 * @param {object} scheduler
 * @param {string} guildId
 * @param {{userId?: string, roleId?: string}} [filter]
 */
function pending(scheduler, guildId, filter = {}) {
  return scheduler.list(JOB, (p) => p && p.guildId === guildId
    && (!filter.userId || p.userId === filter.userId)
    && (!filter.roleId || p.roleId === filter.roleId));
}

/**
 * Cancels the expiry of a role (used when the role is removed by hand or given again).
 * @returns {number} Number of jobs cancelled.
 */
function cancel(scheduler, guildId, userId, roleId) {
  const jobs = pending(scheduler, guildId, { userId, roleId });
  for (const job of jobs) scheduler.cancel(job.id);
  return jobs.length;
}

/**
 * Schedules the removal of a role. Replaces any previous expiry of the same role.
 * @returns {string} Job id.
 */
function schedule(scheduler, guildId, userId, roleId, runAt, moderatorId) {
  cancel(scheduler, guildId, userId, roleId);
  return scheduler.schedule(JOB, runAt, { guildId, userId, roleId, moderatorId, givenAt: Date.now() });
}

/**
 * Builds the scheduler handler that removes an expired temporary role.
 * The member may have left or the role may be gone: both are normal and silent.
 * @param {import('discord.js').Client} client
 * @param {object} ctx
 */
function expiryHandler(client, ctx) {
  return async (payload) => {
    const guild = client.guilds.cache.get(payload.guildId);
    if (!guild) return;
    const role = guild.roles.cache.get(payload.roleId);
    const member = await guild.members.fetch(payload.userId).catch(() => null);
    if (!role || !member || !member.roles.cache.has(role.id)) return;
    try {
      await member.roles.remove(role, ctx.t(guild, `${NS}:temp.auditReason`));
    } catch (err) {
      ctx.logger.warn(`roles: could not remove expired role ${role.id} in ${guild.id}:`, err.message);
      return;
    }
    const config = getConfig(ctx.store, guild.id);
    if (config.tempRoleDm) {
      await member.send({ embeds: [ctx.embeds.info(ctx.t(guild, `${NS}:temp.dmTitle`), ctx.t(guild, `${NS}:temp.dm`, { role: role.name, server: guild.name }))] }).catch(() => {});
    }
    if (config.logChanges) {
      await ctx.modlog.send(guild, 'members', ctx.embeds.info(ctx.t(guild, `${NS}:log.expiredTitle`), ctx.t(guild, `${NS}:log.expired`, { user: `<@${member.id}>`, role: `<@&${role.id}>` })));
    }
  };
}

module.exports = { JOB, pending, cancel, schedule, expiryHandler };
