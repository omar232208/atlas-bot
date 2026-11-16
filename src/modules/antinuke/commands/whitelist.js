'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const NS = 'antinuke';
const KEY = 'whitelist';
const MAX = 100;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Trusted users exempt from antinuke and automod')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('add').setDescription('Trust a user or bot')
      .addUserOption((o) => o.setName('user').setDescription('User or bot (an ID works too)').setRequired(true)))
    .addSubcommand((s) => s.setName('remove').setDescription('Stop trusting a user')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('Show trusted users')),
  /**
   * The whitelist is the key of the whole protection, so only the server owner
   * (or an OWNER_IDS user) can change it; administrators can read it.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const t = (k, v) => ctx.t(interaction, `${NS}:${k}`, v);
    const flags = MessageFlags.Ephemeral;
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const gs = ctx.store.guild(guild.id);
    const list = gs.get(KEY, []);

    if (sub === 'list') {
      const lines = list.map((id) => `- <@${id}> (${id})`);
      const owner = t('whitelist.ownerLine', { user: `<@${guild.ownerId}>` });
      return interaction.reply({ embeds: [ctx.embeds.info(t('whitelist.title'), [owner, ...(lines.length ? lines : [t('whitelist.empty')])].join('\n'), { footer: t('whitelist.footer', { count: list.length, max: MAX }) })], flags });
    }
    if (!ctx.permissions.isOwner(guild, interaction.user.id)) {
      return interaction.reply({ embeds: [ctx.embeds.error(t('errors.ownerOnly'), t('errors.ownerOnlyHelp'))], flags });
    }
    const user = interaction.options.getUser('user', true);
    if (sub === 'add') {
      if (ctx.permissions.isOwner(guild, user.id)) return interaction.reply({ embeds: [ctx.embeds.info(t('whitelist.isOwner'))], flags });
      if (list.includes(user.id)) return interaction.reply({ embeds: [ctx.embeds.info(t('whitelist.already', { user: `<@${user.id}>` }))], flags });
      if (list.length >= MAX) return interaction.reply({ embeds: [ctx.embeds.error(t('whitelist.full', { max: MAX }))], flags });
      gs.set(KEY, [...list, user.id]);
      return interaction.reply({ embeds: [ctx.embeds.success(t('whitelist.added', { user: user.tag }), t('whitelist.addedHelp'))], flags });
    }
    if (!list.includes(user.id)) return interaction.reply({ embeds: [ctx.embeds.info(t('whitelist.notIn', { user: `<@${user.id}>` }))], flags });
    gs.set(KEY, list.filter((id) => id !== user.id));
    return interaction.reply({ embeds: [ctx.embeds.success(t('whitelist.removed', { user: user.tag }))], flags });
  }
};
