'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { stripPlan, hasDangerous } = require('./logic');

const QUARANTINE = 'antinuke.quarantined';

/**
 * Removes every role the bot can remove (and adds the quarantine role when
 * asked). The removed roles are saved so /antinuke release can give them back.
 * @returns {Promise<'stripped'|'partial'|'failed'>}
 */
async function strip(ctx, member, quarantineId, reason) {
  const guild = member.guild;
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) return 'failed';
  const roles = [...member.roles.cache.values()];
  const qRole = quarantineId ? guild.roles.cache.get(quarantineId) : null;
  const plan = stripPlan(roles, guild.members.me.roles.highest.position, guild.id, qRole?.editable ? qRole.id : null);
  try {
    await member.roles.set(plan.keep, reason);
  } catch {
    return 'failed';
  }
  const gs = ctx.store.guild(guild.id);
  const prev = gs.get(`${QUARANTINE}.${member.id}.roles`, []);
  gs.set(`${QUARANTINE}.${member.id}`, { roles: [...new Set([...prev, ...plan.removed])], at: Date.now() });
  // Roles above the bot that still grant dangerous permissions mean the threat is not neutralised.
  const leftover = plan.keep.map((id) => guild.roles.cache.get(id)).filter(Boolean);
  return leftover.some((r) => r.id !== qRole?.id && hasDangerous(r.permissions.bitfield)) ? 'partial' : 'stripped';
}

/**
 * Punishes an executor with the configured sanction. When it is impossible
 * (hierarchy, missing permission, timeout on an admin), roles are stripped
 * instead so the attacker loses their power anyway.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {{punishment: string, quarantineRoleId: string|null, timeoutMinutes: number}} cfg
 * @param {string} reason
 * @returns {Promise<string>} Result key under antinuke:punish.results.
 */
async function punish(ctx, guild, userId, cfg, reason) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    if (cfg.punishment !== 'ban') return 'gone';
    return guild.members.ban(userId, { reason }).then(() => 'ban').catch(() => 'failed');
  }
  try {
    switch (cfg.punishment) {
      case 'ban':
        if (member.bannable) { await guild.members.ban(userId, { reason }); return 'ban'; }
        break;
      case 'kick':
        if (member.kickable) { await member.kick(reason); return 'kick'; }
        break;
      case 'timeout':
        // An administrator ignores timeouts, so their roles go too.
        if (member.moderatable && !member.permissions.has(PermissionFlagsBits.Administrator)) {
          await member.timeout(cfg.timeoutMinutes * 60000, reason);
          await strip(ctx, member, null, reason);
          return 'timeout';
        }
        break;
      case 'quarantine': {
        const res = await strip(ctx, member, cfg.quarantineRoleId, reason);
        return res === 'stripped' ? (cfg.quarantineRoleId ? 'quarantine' : 'strip') : res;
      }
      default: {
        const res = await strip(ctx, member, null, reason);
        return res === 'stripped' ? 'strip' : res;
      }
    }
  } catch (err) {
    ctx.logger.warn(`antinuke: ${cfg.punishment} of ${userId} failed:`, err.message);
  }
  const fallback = await strip(ctx, member, cfg.quarantineRoleId, reason);
  return fallback === 'stripped' ? 'fallbackStrip' : fallback;
}

/**
 * Gives back the roles removed by a quarantine / strip and removes the quarantine role.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {string|null} quarantineId
 * @param {string} reason
 * @returns {Promise<{status: 'none'|'gone'|'done', restored: number, failed: number}>}
 */
async function release(ctx, guild, userId, quarantineId, reason) {
  const gs = ctx.store.guild(guild.id);
  const saved = gs.get(`${QUARANTINE}.${userId}`, null);
  if (!saved) return { status: 'none', restored: 0, failed: 0 };
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { status: 'gone', restored: 0, failed: 0 };
  const roles = saved.roles.filter((id) => guild.roles.cache.get(id)?.editable);
  let restored = 0;
  let failed = saved.roles.length - roles.length;
  try {
    if (quarantineId && member.roles.cache.has(quarantineId)) await member.roles.remove(quarantineId, reason);
    if (member.isCommunicationDisabled()) await member.timeout(null, reason);
    if (roles.length) await member.roles.add(roles, reason);
    restored = roles.length;
  } catch {
    failed += roles.length;
  }
  gs.delete(`${QUARANTINE}.${userId}`);
  return { status: 'done', restored, failed };
}

/**
 * Users currently holding saved roles (quarantined or stripped).
 * @param {object} store
 * @param {string} guildId
 * @returns {Array<{userId: string, roles: string[], at: number}>}
 */
function listQuarantined(store, guildId) {
  return Object.entries(store.guild(guildId).get(QUARANTINE, {})).map(([userId, v]) => ({ userId, ...v }));
}

module.exports = { punish, release, strip, listQuarantined, QUARANTINE };
