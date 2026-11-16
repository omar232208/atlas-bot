'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { setting, MAX_AUTOROLES } = require('../lib/config');
const { roleProblem } = require('../lib/send');

const TYPES = ['humans', 'bots'];
const typeOption = (o, required) => o.setName('type').setDescription('Members concerned').setRequired(required)
  .addChoices({ name: 'humans', value: 'humans' }, { name: 'bots', value: 'bots' });

const data = new SlashCommandBuilder()
  .setName('autorole')
  .setDescription('Roles given automatically on join')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('add').setDescription('Add an autorole')
    .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
    .addStringOption((o) => typeOption(o, false)))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove an autorole')
    .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
    .addStringOption((o) => typeOption(o, false)))
  .addSubcommand((s) => s.setName('list').setDescription('List autoroles'));

const reply = (interaction, embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

module.exports = {
  data,
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const g = ctx.store.guild(interaction.guildId);
    const sub = interaction.options.getSubcommand();
    const typeLabel = (type) => t(interaction, `welcome:autorole.types.${type}`);

    if (sub === 'list') {
      const fields = TYPES.map((type) => {
        const ids = setting(g, `autorole.${type}`);
        const lines = ids.map((id) => {
          const role = interaction.guild.roles.cache.get(id);
          if (!role) return t(interaction, 'welcome:autorole.deletedRole', { id });
          const problem = roleProblem(interaction.guild, role);
          return problem ? `<@&${id}> — ${t(interaction, `welcome:autorole.problems.${problem}`)}` : `<@&${id}>`;
        });
        return { name: typeLabel(type), value: lines.join('\n') || t(interaction, 'welcome:common.none') };
      });
      return reply(interaction, embeds.info(t(interaction, 'welcome:autorole.listTitle'), t(interaction, 'welcome:autorole.listDesc'), { fields }));
    }

    const role = interaction.options.getRole('role', true);
    const type = interaction.options.getString('type');

    if (sub === 'add') {
      const target = type || 'humans';
      const problem = roleProblem(interaction.guild, role);
      if (problem) return reply(interaction, embeds.error(t(interaction, 'welcome:errors.title'), t(interaction, `welcome:autorole.problems.${problem}`)));
      // A role that grants moderation powers on join would hand them to raiders.
      if (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageGuild) || role.permissions.has(PermissionFlagsBits.BanMembers)) {
        return reply(interaction, embeds.error(t(interaction, 'welcome:errors.title'), t(interaction, 'welcome:autorole.dangerous', { role: `<@&${role.id}>` })));
      }
      const ids = setting(g, `autorole.${target}`);
      if (ids.includes(role.id)) return reply(interaction, embeds.warn(t(interaction, 'welcome:autorole.title'), t(interaction, 'welcome:autorole.already', { role: `<@&${role.id}>`, type: typeLabel(target) })));
      if (ids.length >= MAX_AUTOROLES) return reply(interaction, embeds.error(t(interaction, 'welcome:errors.title'), t(interaction, 'welcome:autorole.limit', { max: MAX_AUTOROLES })));
      g.set(`autorole.${target}`, [...ids, role.id]);
      return reply(interaction, embeds.success(t(interaction, 'welcome:autorole.title'), t(interaction, 'welcome:autorole.added', { role: `<@&${role.id}>`, type: typeLabel(target) })));
    }

    const targets = type ? [type] : TYPES;
    let removed = false;
    for (const tp of targets) {
      const ids = setting(g, `autorole.${tp}`);
      if (ids.includes(role.id)) { g.set(`autorole.${tp}`, ids.filter((id) => id !== role.id)); removed = true; }
    }
    if (!removed) return reply(interaction, embeds.warn(t(interaction, 'welcome:autorole.title'), t(interaction, 'welcome:autorole.notFound', { role: `<@&${role.id}>` })));
    return reply(interaction, embeds.success(t(interaction, 'welcome:autorole.title'), t(interaction, 'welcome:autorole.removed', { role: `<@&${role.id}>` })));
  }
};
