'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { paginate, chunk } = require('../../../core/paginate');
const cases = require('../lib/cases');
const config = require('../lib/config');
const { normalizeThresholds } = require('../lib/thresholds');
const { caseLine } = require('../lib/format');
const duration = require('../../../core/duration');

module.exports = {
  name: 'warnings',
  perm: PermissionFlagsBits.ModerateMembers,
  group: false,
  /** Adds this subcommand to /mod. */
  build: (s) => s
    .setName('warnings')
    .setDescription('List the active warnings of a member')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const user = interaction.options.getUser('user', true);
    const gs = ctx.store.guild(interaction.guild.id);
    const expiry = config.get(gs, 'warnExpiry');
    const warns = cases.activeWarns(gs, user.id, expiry);
    const title = t(interaction, 'moderation:warnings.title', { user: user.tag || user.username, count: warns.length });
    // Tell moderators what the next warning will trigger, so sanctions are predictable.
    const next = normalizeThresholds(config.get(gs, 'warnThresholds')).find((x) => x.warns > warns.length);
    const footer = [
      expiry ? t(interaction, 'moderation:warnings.expiry', { duration: duration.format(expiry, interaction) }) : null,
      next ? t(interaction, 'moderation:warnings.next', { count: next.warns, type: t(interaction, `moderation:types.${next.action}`) }) : null
    ].filter(Boolean).join(' · ') || undefined;
    if (!warns.length) return interaction.reply({ embeds: [embeds.info(title, t(interaction, 'moderation:warnings.none'), { footer })] });
    const pages = chunk(warns.map((c) => caseLine(t, interaction, c)), 10).map((text) => embeds.info(title, text, { footer }));
    return paginate(interaction, pages);
  }
};
