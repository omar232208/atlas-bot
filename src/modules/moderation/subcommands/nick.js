'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { respond, fail, explainError, checkTarget, fetchMember } = require('../lib/format');

module.exports = {
  name: 'nick',
  perm: PermissionFlagsBits.ManageNicknames,
  group: false,
  /** Adds this subcommand to /mod. */
  build: (s) => s
    .setName('nick')
    .setDescription('Change or reset the nickname of a member')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('nickname').setDescription('New nickname (empty to reset)').setMaxLength(32)),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const user = interaction.options.getUser('user', true);
    const member = await fetchMember(interaction.guild, user.id);
    if (!member) return fail(ctx, interaction, 'moderation:errors.notMember');
    const problem = checkTarget(ctx, interaction, member, 'ManageNicknames');
    if (problem) return fail(ctx, interaction, problem.key, problem.vars);
    const nickname = interaction.options.getString('nickname')?.trim() || null;
    const before = member.nickname;
    try {
      await member.setNickname(nickname, `${interaction.user.tag}: /nick`);
    } catch (err) {
      return explainError(ctx, interaction, err, 'ManageNicknames');
    }
    const text = nickname ? t(interaction, 'moderation:nick.set', { user: `<@${user.id}>`, nick: nickname }) : t(interaction, 'moderation:nick.reset', { user: `<@${user.id}>` });
    const footer = before ? t(interaction, 'moderation:nick.before', { nick: before }) : undefined;
    return respond(interaction, embeds.success(t(interaction, 'moderation:nick.title'), text, { footer }));
  }
};
