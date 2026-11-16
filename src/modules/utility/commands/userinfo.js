'use strict';

const { SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');

/** Mentions are capped so the roles field stays well under Discord's limits. */
const MAX_ROLES_SHOWN = 20;

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('user')
    .setDescription(en('utility:commands.info.options.user.description'))
    .addUserOption((o) => o.setName('user').setDescription(en('utility:commands.info.options.user.options.user'))),

  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const user = interaction.options.getUser('user') ?? interaction.user;
    // The member is cached in most cases; fetch only when it is not, to avoid
    // an API call on every lookup.
    const member = interaction.guild.members.cache.get(user.id)
      ?? await interaction.guild.members.fetch(user.id).catch(() => null);

    const fields = [
      { name: t(interaction, 'utility:userinfo.id'), value: user.id, inline: true },
      { name: t(interaction, 'utility:userinfo.type'), value: user.bot ? t(interaction, 'utility:userinfo.bot') : t(interaction, 'utility:userinfo.human'), inline: true },
      { name: t(interaction, 'utility:userinfo.created'), value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true }
    ];
    if (member) {
      const roles = member.roles.cache.filter((r) => r.id !== interaction.guildId).sort((a, b) => b.position - a.position);
      const shown = [...roles.values()].slice(0, MAX_ROLES_SHOWN).map((r) => r.toString());
      const more = roles.size > MAX_ROLES_SHOWN ? ` +${roles.size - MAX_ROLES_SHOWN}` : '';
      fields.push(
        { name: t(interaction, 'utility:userinfo.joined'), value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : '-', inline: true },
        { name: t(interaction, 'utility:userinfo.topRole'), value: roles.first()?.toString() ?? t(interaction, 'utility:userinfo.none'), inline: true },
        { name: t(interaction, 'utility:userinfo.roles', { count: roles.size }), value: shown.length ? `${shown.join(' ')}${more}` : t(interaction, 'utility:userinfo.none'), inline: false }
      );
    } else {
      fields.push({ name: t(interaction, 'utility:userinfo.notMember'), value: '-', inline: false });
    }

    const embed = embeds.info(t(interaction, 'utility:userinfo.title', { name: user.displayName }), null, { fields });
    embed.setThumbnail(user.displayAvatarURL({ size: 256 }));
    await interaction.reply({ embeds: [embed] });
  }
};
