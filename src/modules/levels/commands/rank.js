'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { getProgress, rankOf } = require('../lib/ledger');
const { progressBar } = require('../lib/xp');
const { isEnabled } = require('../lib/settings');
const { send, fail } = require('../lib/reply');

/** /rank: level, XP, progress bar and server rank of a member. */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Show your level and rank')
    .addUserOption((o) => o.setName('user').setDescription('Member to look up').setRequired(false)),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const target = interaction.options.getUser('user') ?? interaction.user;
    if (target.bot) return fail(ctx, interaction, 'levels:errors.botTarget');
    const title = ctx.t(interaction, 'levels:rank.title', { user: target.username });
    if (!isEnabled(ctx.store, guildId)) {
      return send(interaction, ctx.embeds.info(title, ctx.t(interaction, 'levels:rank.disabled')));
    }
    const p = getProgress(ctx.store, guildId, target.id);
    if (!p.xp) return send(interaction, ctx.embeds.info(title, ctx.t(interaction, 'levels:rank.none')));

    const fields = [
      { name: ctx.t(interaction, 'levels:rank.level'), value: String(p.level), inline: true },
      { name: ctx.t(interaction, 'levels:rank.rank'), value: `#${rankOf(ctx.store, guildId, target.id)}`, inline: true },
      { name: ctx.t(interaction, 'levels:rank.xp'), value: String(p.xp), inline: true }
    ];
    const description = [
      `\`${progressBar(p.current / p.required)}\``,
      ctx.t(interaction, 'levels:rank.progress', { current: p.current, required: p.required })
    ].join('\n');
    return send(interaction, ctx.embeds.info(title, description, { fields }));
  }
};
