'use strict';

const { PermissionFlagsBits } = require('discord.js');
const config = require('../lib/config');
const { THRESHOLD_ACTIONS, normalizeThresholds, upsertThreshold, removeThreshold } = require('../lib/thresholds');
const { respond, fail } = require('../lib/format');
const duration = require('../../../core/duration');

const MAX_THRESHOLDS = 10;

/**
 * Lines describing the thresholds, e.g. "3 warnings → Timeout (1 hour)".
 * @param {object} ctx
 * @param {*} lang
 * @param {Array} list
 */
function thresholdLines(ctx, lang, list) {
  return normalizeThresholds(list).map((x) => ctx.t(lang, 'moderation:warnconfig.line', {
    count: x.warns,
    type: ctx.t(lang, `moderation:types.${x.action}`),
    duration: x.duration ? ` (${duration.format(x.duration, lang)})` : ''
  }));
}

module.exports = {
  thresholdLines,
  name: 'warnconfig',
  perm: PermissionFlagsBits.ManageGuild,
  group: true,
  /** Adds this subcommand group to /mod. */
  build: (g) => g
    .setName('warnconfig')
    .setDescription('Automatic sanctions when a member reaches a number of warnings')
    .addSubcommand((s) => s.setName('add').setDescription('Add or replace a threshold')
      .addIntegerOption((o) => o.setName('warns').setDescription('Number of active warnings').setRequired(true).setMinValue(1).setMaxValue(50))
      .addStringOption((o) => o.setName('action').setDescription('Sanction').setRequired(true).addChoices(...THRESHOLD_ACTIONS.map((v) => ({ name: v, value: v }))))
      .addStringOption((o) => o.setName('duration').setDescription('Duration for timeout or temporary ban, e.g. 1h').setMaxLength(20)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a threshold')
      .addIntegerOption((o) => o.setName('warns').setDescription('Number of warnings').setRequired(true).setMinValue(1).setMaxValue(50)))
    .addSubcommand((s) => s.setName('list').setDescription('Show the thresholds')),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const gs = ctx.store.guild(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    const list = config.get(gs, 'warnThresholds');
    const title = t(interaction, 'moderation:warnconfig.title');

    if (sub === 'add') {
      const warns = interaction.options.getInteger('warns', true);
      const action = interaction.options.getString('action', true);
      const raw = interaction.options.getString('duration');
      const ms = raw ? duration.parse(raw) : undefined;
      if (ms === null) return fail(ctx, interaction, 'moderation:errors.badDuration');
      if (action === 'timeout' && ms && ms > 28 * 86400000) return fail(ctx, interaction, 'moderation:errors.badTimeout');
      const current = normalizeThresholds(list);
      if (current.length >= MAX_THRESHOLDS && !current.some((x) => x.warns === warns)) return fail(ctx, interaction, 'moderation:errors.tooManyThresholds', { max: MAX_THRESHOLDS });
      const next = upsertThreshold(list, { warns, action, duration: action === 'timeout' ? ms || 3600000 : ms });
      config.set(gs, 'warnThresholds', next);
      return respond(interaction, embeds.success(title, thresholdLines(ctx, interaction, next).join('\n')));
    }
    if (sub === 'remove') {
      const warns = interaction.options.getInteger('warns', true);
      if (!normalizeThresholds(list).some((x) => x.warns === warns)) return fail(ctx, interaction, 'moderation:errors.noThreshold', { count: warns });
      const next = removeThreshold(list, warns);
      config.set(gs, 'warnThresholds', next);
      return respond(interaction, embeds.success(title, thresholdLines(ctx, interaction, next).join('\n') || t(interaction, 'moderation:warnconfig.empty')));
    }
    return respond(interaction, embeds.info(title, thresholdLines(ctx, interaction, list).join('\n') || t(interaction, 'moderation:warnconfig.empty')));
  }
};
