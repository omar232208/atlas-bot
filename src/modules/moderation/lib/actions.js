'use strict';

const config = require('./config');
const cases = require('./cases');
const { MAX_TIMEOUT_MS, matchThreshold } = require('./thresholds');
const { caseEmbed, ts } = require('./format');
const duration = require('../../../core/duration');

const JOB_UNBAN = 'moderation:unban';
const JOB_TIMEOUT = 'moderation:timeout';
const PENDING_TIMEOUTS = 'moderation.pendingTimeouts';
// Sanctions the target is told about by DM. Unban/untimeout are not sent:
// an unbanned user usually shares no server with the bot any more.
const DM_TYPES = new Set(['warn', 'timeout', 'kick', 'softban', 'ban']);

const auditReason = (moderator, reason, fallback) => `${moderator.tag || moderator.username}: ${reason || fallback}`.slice(0, 512);

/**
 * Cancels the scheduled jobs of a type for one user of one guild.
 * @param {object} ctx
 * @param {string} type
 * @param {string} guildId
 * @param {string} userId
 * @returns {number} Cancelled jobs.
 */
function cancelJobs(ctx, type, guildId, userId) {
  const jobs = ctx.scheduler.list(type, (p) => p?.guildId === guildId && p?.userId === userId);
  for (const job of jobs) ctx.scheduler.cancel(job.id);
  return jobs.length;
}

/**
 * Sends the localized "you have been sanctioned" DM. Done *before* the sanction
 * because after a kick or ban the bot may no longer share a server with the user.
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function sendDm(ctx, { guild, user, moderator, type, reason, durationMs }) {
  const { t, embeds } = ctx;
  const gs = ctx.store.guild(guild.id);
  const fields = [{ name: t(guild, 'moderation:case.reason'), value: reason || t(guild, 'moderation:case.noReason') }];
  if (durationMs) fields.push({ name: t(guild, 'moderation:case.duration'), value: duration.format(durationMs, guild), inline: true });
  if (config.get(gs, 'dmShowModerator')) fields.push({ name: t(guild, 'moderation:case.moderator'), value: moderator.tag || moderator.username, inline: true });
  const appeal = config.get(gs, 'appeal');
  if (appeal) fields.push({ name: t(guild, 'moderation:dm.appeal'), value: String(appeal).slice(0, 1000) });
  const embed = embeds.warn(t(guild, `moderation:dm.title.${type}`, { server: guild.name }), undefined, { fields, timestamp: true });
  try {
    return await user.send({ embeds: [embed] });
  } catch {
    // Closed DMs are common and never block the sanction.
    return null;
  }
}

/**
 * Executes the Discord side of a sanction.
 */
async function perform(ctx, { guild, user, member, moderator, type, reason, durationMs, deleteSeconds }) {
  const audit = auditReason(moderator, reason, ctx.t(guild, 'moderation:case.noReason'));
  switch (type) {
    case 'warn':
      return;
    case 'timeout': {
      if (!member) throw Object.assign(new Error('member required'), { code: 'NOT_MEMBER' });
      cancelJobs(ctx, JOB_TIMEOUT, guild.id, user.id);
      await member.timeout(Math.min(durationMs, MAX_TIMEOUT_MS), audit);
      // Discord caps timeouts at 28 days: longer ones are re-applied by the scheduler.
      if (durationMs > MAX_TIMEOUT_MS) ctx.scheduler.schedule(JOB_TIMEOUT, Date.now() + MAX_TIMEOUT_MS, { guildId: guild.id, userId: user.id, until: Date.now() + durationMs });
      return;
    }
    case 'untimeout':
      if (!member) throw Object.assign(new Error('member required'), { code: 'NOT_MEMBER' });
      cancelJobs(ctx, JOB_TIMEOUT, guild.id, user.id);
      ctx.store.guild(guild.id).delete(`${PENDING_TIMEOUTS}.${user.id}`);
      await member.timeout(null, audit);
      return;
    case 'kick':
      if (!member) throw Object.assign(new Error('member required'), { code: 'NOT_MEMBER' });
      await member.kick(audit);
      return;
    case 'softban':
      // Ban + immediate unban = kick that also deletes recent messages.
      await guild.bans.create(user.id, { deleteMessageSeconds: deleteSeconds || 86400, reason: audit });
      await guild.bans.remove(user.id, audit);
      return;
    case 'ban':
      cancelJobs(ctx, JOB_UNBAN, guild.id, user.id);
      await guild.bans.create(user.id, { deleteMessageSeconds: deleteSeconds || 0, reason: audit });
      return;
    case 'unban':
      cancelJobs(ctx, JOB_UNBAN, guild.id, user.id);
      await guild.bans.remove(user.id, audit);
      return;
    default:
      throw new Error(`unknown sanction ${type}`);
  }
}

/**
 * Applies a sanction end to end: DM, Discord action, numbered case, moderation
 * log, temp-ban scheduling and warn thresholds. Used by commands and automod.
 * Throws the Discord error when the action itself fails (nothing is recorded).
 * @param {object} ctx
 * @param {{guild: import('discord.js').Guild, user: import('discord.js').User, member?: import('discord.js').GuildMember|null, moderator: import('discord.js').User, type: 'warn'|'timeout'|'untimeout'|'kick'|'softban'|'ban'|'unban', reason?: string, durationMs?: number, deleteSeconds?: number, silent?: boolean, auto?: boolean}} opts
 * @returns {Promise<{case: object, dmSent: boolean, followUp: object|null}>}
 */
async function sanction(ctx, opts) {
  const { guild, user, moderator, type, reason, durationMs, silent, auto } = opts;
  const gs = ctx.store.guild(guild.id);
  const dm = DM_TYPES.has(type) && !silent && !user.bot && config.get(gs, 'dm') ? await sendDm(ctx, opts) : null;
  try {
    await perform(ctx, opts);
  } catch (err) {
    // The sanction did not happen: withdraw the DM announcing it.
    if (dm) dm.delete().catch(() => {});
    throw err;
  }
  const caseType = type === 'ban' && durationMs ? 'tempban' : type;
  const withDuration = ['timeout', 'tempban'].includes(caseType) && durationMs;
  const entry = cases.createCase(gs, {
    type: caseType,
    userId: user.id,
    userTag: user.tag || user.username,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag || moderator.username,
    reason,
    duration: withDuration ? durationMs : undefined,
    expiresAt: withDuration ? Date.now() + durationMs : undefined,
    auto
  });
  if (caseType === 'tempban') ctx.scheduler.schedule(JOB_UNBAN, entry.expiresAt, { guildId: guild.id, userId: user.id, caseId: entry.id });
  await ctx.modlog.send(guild, 'moderation', caseEmbed(ctx, guild, entry));
  const followUp = type === 'warn' ? await applyThreshold(ctx, guild, user, opts.member) : null;
  return { case: entry, dmSent: !!dm, followUp };
}

/**
 * Applies the automatic sanction configured for the user's new warn count.
 * Failures are logged, never thrown: the warning itself is already recorded.
 * @returns {Promise<object|null>} The automatic case, if one was created.
 */
async function applyThreshold(ctx, guild, user, member) {
  const gs = ctx.store.guild(guild.id);
  const count = cases.activeWarns(gs, user.id, config.get(gs, 'warnExpiry')).length;
  const step = matchThreshold(count, config.get(gs, 'warnThresholds'));
  if (!step) return null;
  const target = member || (await guild.members.fetch(user.id).catch(() => null));
  if (!target && !['ban', 'softban'].includes(step.action)) return null;
  if (target && !ctx.permissions.canModerate(guild.members.me, target)) {
    ctx.logger.warn(`warn threshold skipped in ${guild.id}: ${user.id} is above the bot`);
    return null;
  }
  try {
    const result = await sanction(ctx, {
      guild, user, member: target, moderator: ctx.client.user, type: step.action, auto: true,
      durationMs: step.action === 'timeout' ? step.duration || 3600000 : step.duration,
      reason: ctx.t(guild, 'moderation:auto.threshold', { count })
    });
    return result.case;
  } catch (err) {
    ctx.logger.warn(`warn threshold sanction failed in ${guild.id}:`, err.message);
    return null;
  }
}

/**
 * Registers scheduler handlers (temp bans, long timeouts). Called from init().
 * @param {object} ctx
 */
function registerJobs(ctx) {
  ctx.scheduler.on(JOB_UNBAN, async ({ guildId, userId, caseId }) => {
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) return;
    const user = await ctx.client.users.fetch(userId).catch(() => ({ id: userId, tag: userId }));
    const reason = ctx.t(guild, 'moderation:auto.tempbanExpired', { id: caseId });
    try {
      await sanction(ctx, { guild, user, moderator: ctx.client.user, type: 'unban', reason, auto: true });
    } catch (err) {
      // 10026 = already unbanned by hand: nothing left to do.
      if (err.code !== 10026) ctx.logger.warn(`temp ban expiry failed in ${guildId}:`, err.message);
    }
  });
  ctx.scheduler.on(JOB_TIMEOUT, async ({ guildId, userId, until }) => {
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild || until <= Date.now()) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      // Left the server: re-applied by the guildMemberAdd event if they come back.
      ctx.store.guild(guildId).set(`${PENDING_TIMEOUTS}.${userId}`, until);
      return;
    }
    await reapplyTimeout(ctx, member, until);
  });
}

/**
 * Re-applies a long timeout (in 28-day steps) until `until`.
 * @param {object} ctx
 * @param {import('discord.js').GuildMember} member
 * @param {number} until
 */
async function reapplyTimeout(ctx, member, until) {
  const left = until - Date.now();
  if (left <= 0) return;
  try {
    await member.timeout(Math.min(left, MAX_TIMEOUT_MS), ctx.t(member.guild, 'moderation:auto.timeoutContinued', { until: ts(until, 'f') }).slice(0, 512));
    if (left > MAX_TIMEOUT_MS) ctx.scheduler.schedule(JOB_TIMEOUT, Date.now() + MAX_TIMEOUT_MS, { guildId: member.guild.id, userId: member.id, until });
  } catch (err) {
    ctx.logger.warn(`could not extend timeout in ${member.guild.id}:`, err.message);
  }
}

module.exports = { sanction, applyThreshold, registerJobs, reapplyTimeout, cancelJobs, JOB_UNBAN, JOB_TIMEOUT, PENDING_TIMEOUTS, DM_TYPES };
