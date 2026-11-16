'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { paginate, chunk } = require('../../../core/paginate');
const cases = require('../lib/cases');
const { caseLine } = require('../lib/format');

module.exports = {
  name: 'history',
  perm: PermissionFlagsBits.ModerateMembers,
  group: false,
  /** Adds this subcommand to /mod. */
  build: (s) => s
    .setName('history')
    .setDescription('Show every case of a user')
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
    .addStringOption((o) => o.setName('type').setDescription('Only this type of case')
      .addChoices(...cases.CASE_TYPES.map((v) => ({ name: v, value: v })))),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const user = interaction.options.getUser('user', true);
    const type = interaction.options.getString('type') || undefined;
    const list = cases.listCases(ctx.store.guild(interaction.guild.id), { userId: user.id, type });
    const title = t(interaction, 'moderation:history.title', { user: user.tag || user.username, count: list.length });
    if (!list.length) return interaction.reply({ embeds: [embeds.info(title, t(interaction, 'moderation:history.none'))] });
    const counts = cases.countByType(list);
    const footer = Object.entries(counts).map(([k, n]) => `${t(interaction, `moderation:types.${k}`)}: ${n}`).join(' · ');
    const pages = chunk(list.map((c) => caseLine(t, interaction, c)), 10).map((text) => embeds.info(title, text, { footer }));
    return paginate(interaction, pages);
  }
};
