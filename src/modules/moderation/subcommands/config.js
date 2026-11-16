'use strict';

const { PermissionFlagsBits } = require('discord.js');
const config = require('../lib/config');
const { thresholdLines } = require('./warnconfig');
const { respond, fail } = require('../lib/format');
const duration = require('../../../core/duration');

module.exports = {
  name: 'config',
  perm: PermissionFlagsBits.ManageGuild,
  group: true,
  /** Adds this subcommand group to /mod. */
  build: (g) => g
    .setName('config')
    .setDescription('Moderation settings')
    .addSubcommand((s) => s.setName('show').setDescription('Show the moderation settings'))
    .addSubcommand((s) => s.setName('dm').setDescription('DM members when they are sanctioned')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Send the DM').setRequired(true))
      .addBooleanOption((o) => o.setName('show_moderator').setDescription('Name the moderator in the DM')))
    .addSubcommand((s) => s.setName('appeal').setDescription('Text added to sanction DMs (how to appeal)')
      .addStringOption((o) => o.setName('text').setDescription('Leave empty to remove').setMaxLength(500)))
    .addSubcommand((s) => s.setName('reason').setDescription('Require a reason for every sanction')
      .addBooleanOption((o) => o.setName('required').setDescription('Reason required').setRequired(true)))
    .addSubcommand((s) => s.setName('warnexpiry').setDescription('Warnings stop counting after this time')
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 30d, or "off"').setRequired(true).setMaxLength(20))),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const gs = ctx.store.guild(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    const title = t(interaction, 'moderation:modconfig.title');
    const yes = (v) => t(interaction, v ? 'moderation:modconfig.on' : 'moderation:modconfig.off');

    if (sub === 'dm') {
      config.set(gs, 'dm', interaction.options.getBoolean('enabled', true));
      const show = interaction.options.getBoolean('show_moderator');
      if (show !== null) config.set(gs, 'dmShowModerator', show);
    } else if (sub === 'appeal') {
      config.set(gs, 'appeal', interaction.options.getString('text')?.trim() || '');
    } else if (sub === 'reason') {
      config.set(gs, 'requireReason', interaction.options.getBoolean('required', true));
    } else if (sub === 'warnexpiry') {
      const raw = interaction.options.getString('duration', true).trim().toLowerCase();
      const ms = ['0', 'off', 'none'].includes(raw) ? 0 : duration.parse(raw);
      if (ms === null) return fail(ctx, interaction, 'moderation:errors.badDuration');
      config.set(gs, 'warnExpiry', ms);
    }

    const expiry = config.get(gs, 'warnExpiry');
    const fields = [
      { name: t(interaction, 'moderation:modconfig.dm'), value: yes(config.get(gs, 'dm')), inline: true },
      { name: t(interaction, 'moderation:modconfig.showModerator'), value: yes(config.get(gs, 'dmShowModerator')), inline: true },
      { name: t(interaction, 'moderation:modconfig.requireReason'), value: yes(config.get(gs, 'requireReason')), inline: true },
      { name: t(interaction, 'moderation:modconfig.warnExpiry'), value: expiry ? duration.format(expiry, interaction) : t(interaction, 'moderation:modconfig.never'), inline: true },
      { name: t(interaction, 'moderation:modconfig.appeal'), value: config.get(gs, 'appeal') || t(interaction, 'moderation:modconfig.none') },
      { name: t(interaction, 'moderation:modconfig.thresholds'), value: thresholdLines(ctx, interaction, config.get(gs, 'warnThresholds')).join('\n') || t(interaction, 'moderation:warnconfig.empty') }
    ];
    const embed = sub === 'show' ? embeds.info(title, undefined, { fields }) : embeds.success(title, t(interaction, 'moderation:modconfig.saved'), { fields });
    return respond(interaction, embed);
  }
};
