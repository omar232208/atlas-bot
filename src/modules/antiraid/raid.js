'use strict';

const { AuditLogEvent, PermissionFlagsBits, UserFlags } = require('discord.js');
const { fetchExecutor } = require('../../core/audit');
const { readConfig } = require('./logic');
const { getLockdown, startLockdown, endLockdown } = require('./lockdown');

const STATE = 'antiraid.raid';
const END_JOB = 'antiraid:end';
const NS = 'antiraid';

/**
 * Sends a protection log (the logs module routes this category to its
 * protection channel, or to the moderation one when none is set).
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').EmbedBuilder} embed
 */
async function report(ctx, guild, embed) {
  await ctx.modlog.send(guild, 'antiraid', embed, { _keepEmbeds: true });
}

/**
 * Active raid state, or null. An expired state (job lost while offline) counts as inactive.
 * @param {object} store
 * @param {string} guildId
 */
function getRaid(store, guildId) {
  const s = store.guild(guildId).get(STATE, null);
  if (!s?.active) return null;
  if (s.until && s.until <= Date.now()) return null;
  return s;
}

/**
 * Localized names of Discord permission flags, for "missing permission" messages.
 * @param {*} lang
 * @param {Function} t
 * @param {string[]} flags
 */
function permNames(lang, t, flags) {
  return flags.map((f) => t(lang, `${NS}:perms.${f}`)).join(', ');
}

/**
 * Turns raid mode on. Returns false if it was already on.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {{by: string|null, auto: boolean, durationMs: number, joins?: number}} opts
 */
async function startRaid(ctx, guild, opts) {
  if (getRaid(ctx.store, guild.id)) return false;
  const gs = ctx.store.guild(guild.id);
  const cfg = readConfig(gs);
  const until = Date.now() + opts.durationMs;
  // State is written synchronously before any await so concurrent joins see raid mode at once.
  gs.set(STATE, { active: true, since: Date.now(), until, by: opts.by, auto: opts.auto, punished: 0, lockdownByRaid: false, jobId: null });
  gs.set(`${STATE}.jobId`, ctx.scheduler.schedule(END_JOB, until, { guildId: guild.id }));

  let lockText = ctx.t(guild, `${NS}:raid.noLockdown`);
  if (cfg.autoLockdown && !getLockdown(ctx.store, guild.id)) {
    const res = await startLockdown(guild, ctx.store, { by: ctx.client.user?.id, reason: ctx.t(guild, `${NS}:raid.auditReason`), auto: true });
    gs.set(`${STATE}.lockdownByRaid`, true);
    lockText = ctx.t(guild, `${NS}:lockdown.summary`, { locked: res.locked, failed: res.failed });
  }
  const description = opts.auto
    ? ctx.t(guild, `${NS}:raid.detected`, { count: opts.joins, seconds: cfg.joinWindowSec })
    : ctx.t(guild, `${NS}:raid.manual`, { user: `<@${opts.by}>` });
  await report(ctx, guild, ctx.embeds.warn(ctx.t(guild, `${NS}:raid.startTitle`), description, {
    fields: [
      { name: ctx.t(guild, `${NS}:status.raidAction`), value: ctx.t(guild, `${NS}:actions.${cfg.raidAction}`), inline: true },
      { name: ctx.t(guild, `${NS}:raid.ends`), value: `<t:${Math.floor(until / 1000)}:R>`, inline: true },
      { name: ctx.t(guild, `${NS}:lockdown.title`), value: lockText }
    ],
    timestamp: true
  }));
  return true;
}

/**
 * Turns raid mode off, ends the lockdown it started and logs a summary.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {string|null} by User who ended it, null when it expired.
 * @returns {Promise<boolean>} false when raid mode was not on.
 */
async function endRaid(ctx, guild, by) {
  const gs = ctx.store.guild(guild.id);
  const state = gs.get(STATE, null);
  if (!state?.active) return false;
  if (state.jobId) ctx.scheduler.cancel(state.jobId);
  gs.delete(STATE);
  // Only undo a lockdown the raid created; a manual one stays until a human ends it.
  const lock = getLockdown(ctx.store, guild.id);
  if (state.lockdownByRaid && lock?.auto) await endLockdown(guild, ctx.store, ctx.t(guild, `${NS}:raid.auditReason`));
  const ended = by ? ctx.t(guild, `${NS}:raid.endedBy`, { user: `<@${by}>` }) : ctx.t(guild, `${NS}:raid.expired`);
  await report(ctx, guild, ctx.embeds.success(ctx.t(guild, `${NS}:raid.endTitle`), ended, {
    fields: [
      { name: ctx.t(guild, `${NS}:raid.punished`), value: String(state.punished || 0), inline: true },
      { name: ctx.t(guild, `${NS}:raid.since`), value: `<t:${Math.floor(state.since / 1000)}:R>`, inline: true }
    ],
    timestamp: true
  }));
  return true;
}

/**
 * Applies kick / ban / timeout to a joining member. Sends a short localized DM
 * first (kicked users cannot be messaged afterwards).
 * @param {object} ctx
 * @param {import('discord.js').GuildMember} member
 * @param {'kick'|'ban'|'timeout'} action
 * @param {string} reasonKey Key under antiraid:reasons.
 * @param {ReturnType<typeof readConfig>} cfg
 * @returns {Promise<boolean>}
 */
async function punishJoiner(ctx, member, action, reasonKey, cfg) {
  const guild = member.guild;
  const reason = ctx.t(guild, `${NS}:reasons.${reasonKey}`);
  const able = action === 'ban' ? member.bannable : action === 'kick' ? member.kickable : member.moderatable;
  if (!able) {
    ctx.logger.warn(`antiraid: cannot ${action} ${member.id} in ${guild.id} (permissions or hierarchy)`);
    return false;
  }
  if (cfg.dmNotice && action !== 'timeout') {
    const dm = ctx.embeds.warn(ctx.t(guild, `${NS}:dm.title`, { server: guild.name }), ctx.t(guild, `${NS}:dm.${action}`, { reason }));
    await member.send({ embeds: [dm], _keepEmbeds: true }).catch(() => {});
  }
  try {
    if (action === 'ban') await guild.members.ban(member.id, { reason, deleteMessageSeconds: 3600 });
    else if (action === 'kick') await member.kick(reason);
    else await member.timeout(cfg.timeoutMinutes * 60000, reason);
    return true;
  } catch (err) {
    ctx.logger.warn(`antiraid: ${action} of ${member.id} failed:`, err.message);
    return false;
  }
}

/**
 * Role ids to keep when stripping a member: managed roles (boosts, integrations)
 * and roles at or above the bot cannot be removed by the bot anyway.
 * @param {Array<{id: string, managed: boolean, position: number}>} roles
 * @param {number} botTop Position of the bot's highest role.
 * @param {string} everyoneId
 * @returns {string[]}
 */
function rolesToKeep(roles, botTop, everyoneId) {
  return roles.filter((r) => r.id !== everyoneId && (r.managed || r.position >= botTop)).map((r) => r.id);
}

/**
 * Anti-bot: kicks a bot added by someone who is not trusted and handles the adder.
 * @param {object} ctx
 * @param {import('discord.js').GuildMember} member The bot that joined.
 * @param {ReturnType<typeof readConfig>} cfg
 */
async function handleBotJoin(ctx, member, cfg) {
  const guild = member.guild;
  if (ctx.permissions.isWhitelisted(guild, member.id)) return;
  if (cfg.allowVerifiedBots) {
    const flags = member.user.flags ?? await member.user.fetchFlags().catch(() => null);
    if (flags?.has(UserFlags.VerifiedBot)) return;
  }
  const found = await fetchExecutor(guild, AuditLogEvent.BotAdd, member.id);
  const adder = found?.executor ?? null;
  if (adder && ctx.permissions.isWhitelisted(guild, adder.id)) return;

  const reason = ctx.t(guild, `${NS}:reasons.bot`);
  const kicked = member.kickable ? await member.kick(reason).then(() => true).catch(() => false) : false;
  let adderResult = ctx.t(guild, `${NS}:bot.adderUnknown`);
  if (adder) {
    adderResult = ctx.t(guild, `${NS}:bot.adderNone`);
    const adderMember = cfg.botAdderAction === 'none' ? null : await guild.members.fetch(adder.id).catch(() => null);
    if (adderMember) adderResult = await punishAdder(ctx, adderMember, cfg.botAdderAction, reason);
  }
  await report(ctx, guild, ctx.embeds.warn(ctx.t(guild, `${NS}:bot.title`), ctx.t(guild, `${NS}:bot.description`, { bot: `${member.user.tag} (${member.id})`, adder: adder ? `<@${adder.id}>` : '?' }), {
    fields: [
      { name: ctx.t(guild, `${NS}:bot.botField`), value: ctx.t(guild, kicked ? `${NS}:bot.kicked` : `${NS}:bot.kickFailed`), inline: true },
      { name: ctx.t(guild, `${NS}:bot.adderField`), value: adderResult, inline: true }
    ],
    timestamp: true
  }));
}

async function punishAdder(ctx, member, action, reason) {
  const guild = member.guild;
  const failed = ctx.t(guild, `${NS}:bot.adderFailed`);
  try {
    if (action === 'ban') {
      if (!member.bannable) return failed;
      await guild.members.ban(member.id, { reason });
    } else if (action === 'kick') {
      if (!member.kickable) return failed;
      await member.kick(reason);
    } else {
      if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) return failed;
      const roles = [...member.roles.cache.values()];
      await member.roles.set(rolesToKeep(roles, guild.members.me.roles.highest.position, guild.id), reason);
    }
    return ctx.t(guild, `${NS}:actions.${action}`);
  } catch {
    return failed;
  }
}

module.exports = { STATE, END_JOB, report, getRaid, permNames, startRaid, endRaid, punishJoiner, rolesToKeep, handleBotJoin };
