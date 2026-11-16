'use strict';

const config = require('./config');
const cases = require('./cases');
const { sanction } = require('./actions');
const { respond, fail, explainError, checkTarget, fetchMember } = require('./format');
const duration = require('../../../core/duration');

/**
 * Shared flow of the sanction commands (/ban, /kick, /timeout, /warn, ...):
 * validation, hierarchy checks, sanction, then a localized summary reply.
 * @param {object} ctx
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{type: string, flag: string, user: import('discord.js').User, reason?: string|null, durationMs?: number, deleteSeconds?: number, silent?: boolean, needsMember?: boolean}} opts
 */
async function runSanction(ctx, interaction, opts) {
  const { guild } = interaction;
  const gs = ctx.store.guild(guild.id);
  if (!opts.reason && config.get(gs, 'requireReason')) return fail(ctx, interaction, 'moderation:errors.reasonRequired');
  const member = await fetchMember(guild, opts.user.id);
  if (opts.needsMember && !member) return fail(ctx, interaction, 'moderation:errors.notMember');
  const problem = checkTarget(ctx, interaction, member, opts.flag);
  if (problem) return fail(ctx, interaction, problem.key, problem.vars);
  if (opts.type === 'untimeout' && !member.isCommunicationDisabled()) return fail(ctx, interaction, 'moderation:errors.notTimedOut');

  await interaction.deferReply();
  let result;
  try {
    result = await sanction(ctx, { ...opts, guild, member, moderator: interaction.user });
  } catch (err) {
    if (err.code === 'NOT_MEMBER') return fail(ctx, interaction, 'moderation:errors.notMember');
    return explainError(ctx, interaction, err, opts.flag);
  }
  return respond(interaction, summaryEmbed(ctx, interaction, result, opts));
}

/**
 * Success embed for a sanction: case number, reason, duration, DM status and
 * the automatic follow-up sanction when a warn threshold was reached.
 */
function summaryEmbed(ctx, interaction, result, opts) {
  const { t, embeds } = ctx;
  const c = result.case;
  const fields = [{ name: t(interaction, 'moderation:case.reason'), value: c.reason || t(interaction, 'moderation:case.noReason') }];
  if (c.duration) fields.push({ name: t(interaction, 'moderation:case.duration'), value: duration.format(c.duration, interaction), inline: true });
  if (['warn', 'timeout', 'kick', 'softban', 'ban'].includes(opts.type) && !opts.user.bot) {
    const dmOn = config.get(ctx.store.guild(interaction.guild.id), 'dm');
    const dmKey = opts.silent ? 'moderation:done.dmSilent' : !dmOn ? 'moderation:done.dmDisabled' : result.dmSent ? 'moderation:done.dmSent' : 'moderation:done.dmFailed';
    fields.push({ name: t(interaction, 'moderation:done.dm'), value: t(interaction, dmKey), inline: true });
  }
  if (opts.type === 'warn') {
    const gs = ctx.store.guild(interaction.guild.id);
    const count = cases.activeWarns(gs, c.userId, config.get(gs, 'warnExpiry')).length;
    fields.push({ name: t(interaction, 'moderation:done.warnCount'), value: String(count), inline: true });
  }
  if (result.followUp) {
    fields.push({ name: t(interaction, 'moderation:done.followUp'), value: t(interaction, 'moderation:done.followUpText', { type: t(interaction, `moderation:types.${result.followUp.type}`), id: result.followUp.id }) });
  }
  return embeds.success(t(interaction, `moderation:done.${c.type}`, { user: c.userTag }), t(interaction, 'moderation:done.case', { id: c.id }), { fields });
}

/**
 * Reads an optional duration option. Returns undefined when absent, null when invalid.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} name
 */
function readDuration(interaction, name = 'duration') {
  const raw = interaction.options.getString(name);
  if (!raw) return undefined;
  return duration.parse(raw);
}

module.exports = { runSanction, readDuration };
