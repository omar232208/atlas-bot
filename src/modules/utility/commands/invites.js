'use strict';

const { MessageFlags, SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');
const permissions = require('../../../core/permissions');

const TOP_COUNT = 10;

/**
 * Sums the uses of the server's current invite links per inviter. Uses of links
 * that were deleted or expired are not counted: Discord does not keep them.
 * @param {Iterable<import('discord.js').Invite>} invites
 * @returns {Map<string, number>} inviter id -> uses
 */
function countByInviter(invites) {
  const counts = new Map();
  for (const invite of invites) {
    if (!invite.inviter || !invite.uses) continue;
    counts.set(invite.inviter.id, (counts.get(invite.inviter.id) ?? 0) + invite.uses);
  }
  return counts;
}

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('invites')
    .setDescription(en('utility:commands.info.options.invites.description'))
    .addUserOption((o) => o.setName('user').setDescription(en('utility:commands.info.options.invites.options.user'))),

  /** Leaderboard of who brought the most members, from the server's invite links. */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const guild = interaction.guild;
    if (!permissions.botCan(guild, 'ManageGuild')) {
      return interaction.reply({ embeds: [embeds.error(t(interaction, 'utility:errors.missingBotPerm', { perm: t(interaction, 'utility:errors.permManageGuild') }))], flags: MessageFlags.Ephemeral });
    }
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) {
      return interaction.reply({ embeds: [embeds.error(t(interaction, 'utility:errors.inviteFetch'))], flags: MessageFlags.Ephemeral });
    }
    const counts = countByInviter(invites.values());
    const target = interaction.options.getUser('user');
    const ranking = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_COUNT);
    const lines = ranking.map(([id, count], index) => t(interaction, 'utility:invites.entry', { rank: index + 1, user: `<@${id}>`, count }));
    const description = [];
    if (target) description.push(t(interaction, 'utility:invites.yours', { user: target.toString(), count: counts.get(target.id) ?? 0 }));
    description.push(lines.length ? lines.join('\n') : t(interaction, 'utility:invites.empty'));
    await interaction.reply({ embeds: [embeds.info(t(interaction, 'utility:invites.title'), description.join('\n\n'))] });
  }
};
