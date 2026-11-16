'use strict';

const { DANGEROUS, hasDangerous, readConfig } = require('./logic');

const STATE = 'antinuke.panic';
const END_JOB = 'antinuke:panicEnd';

/**
 * Sends a protection log (the logs module routes this category to its
 * protection channel, or to the moderation one when none is set).
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').EmbedBuilder} embed
 */
async function report(ctx, guild, embed) {
  await ctx.modlog.send(guild, 'antinuke', embed, { _keepEmbeds: true });
}

/**
 * Active panic state or null (an expired one counts as inactive).
 * @param {object} store
 * @param {string} guildId
 */
function getPanic(store, guildId) {
  const s = store.guild(guildId).get(STATE, null);
  return s?.active && (!s.until || s.until > Date.now()) ? s : null;
}

/**
 * Turns panic mode on: every limit drops to 0 and, if configured, dangerous
 * permissions are removed from every role the bot can edit (saved, then put
 * back when panic ends). Only the owner keeps full power during a panic.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {{by: string|null, auto: boolean, minutes?: number, reason?: string}} opts
 * @returns {Promise<{started: boolean, stripped: number, failed: number}>}
 */
async function startPanic(ctx, guild, opts) {
  if (getPanic(ctx.store, guild.id)) return { started: false, stripped: 0, failed: 0 };
  const gs = ctx.store.guild(guild.id);
  const cfg = readConfig(gs);
  const minutes = opts.minutes || cfg.panicMinutes;
  const until = Date.now() + minutes * 60000;
  gs.set(STATE, { active: true, since: Date.now(), until, by: opts.by, auto: opts.auto, roles: {}, jobId: null });
  gs.set(`${STATE}.jobId`, ctx.scheduler.schedule(END_JOB, until, { guildId: guild.id }));

  let stripped = 0;
  let failed = 0;
  if (cfg.panicStripRoles) {
    const reason = ctx.t(guild, 'antinuke:panic.auditStart');
    const roles = [...guild.roles.cache.values()].filter((r) => !r.managed && r.editable && hasDangerous(r.permissions.bitfield));
    const saved = {};
    for (const r of roles) saved[r.id] = r.permissions.bitfield.toString();
    // Saved before editing so a crash in the middle still lets panic end restore everything.
    gs.set(`${STATE}.roles`, saved);
    for (const r of roles) {
      const ok = await r.setPermissions(r.permissions.bitfield & ~DANGEROUS, reason).then(() => true).catch(() => false);
      if (ok) stripped++; else failed++;
    }
  }
  await report(ctx, guild, ctx.embeds.warn(ctx.t(guild, 'antinuke:panic.startTitle'),
    opts.auto ? ctx.t(guild, 'antinuke:panic.auto', { reason: opts.reason || '-' }) : ctx.t(guild, 'antinuke:panic.manual', { user: `<@${opts.by}>` }), {
      fields: [
        { name: ctx.t(guild, 'antinuke:panic.ends'), value: `<t:${Math.floor(until / 1000)}:R>`, inline: true },
        { name: ctx.t(guild, 'antinuke:panic.rolesField'), value: ctx.t(guild, 'antinuke:panic.rolesValue', { stripped, failed }), inline: true }
      ],
      timestamp: true
    }));
  return { started: true, stripped, failed };
}

/**
 * Turns panic mode off and gives roles their saved permissions back.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {string|null} by
 * @returns {Promise<{ended: boolean, restored: number, failed: number}>}
 */
async function endPanic(ctx, guild, by) {
  const gs = ctx.store.guild(guild.id);
  const state = gs.get(STATE, null);
  if (!state?.active) return { ended: false, restored: 0, failed: 0 };
  if (state.jobId) ctx.scheduler.cancel(state.jobId);
  const reason = ctx.t(guild, 'antinuke:panic.auditEnd');
  let restored = 0;
  let failed = 0;
  for (const [id, bits] of Object.entries(state.roles || {})) {
    const r = guild.roles.cache.get(id);
    if (!r) continue;
    const ok = await r.setPermissions(BigInt(bits), reason).then(() => true).catch(() => false);
    if (ok) restored++; else failed++;
  }
  gs.delete(STATE);
  await report(ctx, guild, ctx.embeds.success(ctx.t(guild, 'antinuke:panic.endTitle'),
    by ? ctx.t(guild, 'antinuke:panic.endedBy', { user: `<@${by}>` }) : ctx.t(guild, 'antinuke:panic.expired'), {
      fields: [{ name: ctx.t(guild, 'antinuke:panic.rolesField'), value: ctx.t(guild, 'antinuke:panic.restoredValue', { restored, failed }) }],
      timestamp: true
    }));
  return { ended: true, restored, failed };
}

module.exports = { STATE, END_JOB, report, getPanic, startPanic, endPanic };
