'use strict';

const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const permissions = require('../../../core/permissions');
const { LIMITS, isEnabled, getConfig } = require('../lib/settings');
const { send, fail } = require('../lib/reply');

const MAX_LEVEL = 1000;
const MAX_REWARDS = 50;
const rewardsKey = 'levels.rewards';

/** Integer option bounded by LIMITS (keys match the stored config). */
const intOption = (name, key, description) => (o) => o.setName(name).setDescription(description).setRequired(false)
  .setMinValue(LIMITS[key][0]).setMaxValue(LIMITS[key][1]);

/** Admin-only: Manage Server or bot owner. */
const isAdmin = (interaction) => permissions.isOwner(interaction.guild, interaction.user.id)
  || !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

/** Explains why the bot cannot hand out a role, or null when it can. */
function roleProblem(guild, role) {
  if (role.managed || role.id === guild.id) return 'levels:errors.roleUnusable';
  if (!permissions.botCan(guild, PermissionFlagsBits.ManageRoles)) return 'levels:errors.botNeedsRoles';
  if (role.position >= guild.members.me.roles.highest.position) return 'levels:errors.roleTooHigh';
  return null;
}

/** /levels enable|disable|config|reset|reward-add|reward-remove|reward-list (admin). */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('levels')
    .setDescription('Configure levels and XP rewards')
    .addSubcommand((s) => s.setName('enable').setDescription('Turn on XP for messages (Manage Server)'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off XP for messages (Manage Server)'))
    .addSubcommand((s) => s.setName('config').setDescription('Show or change the level settings (Manage Server)')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel for level-up messages').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addBooleanOption((o) => o.setName('announce').setDescription('Announce level-ups').setRequired(false))
      .addIntegerOption(intOption('cooldown', 'cooldown', 'Seconds between two XP gains'))
      .addIntegerOption(intOption('xp_min', 'xpMin', 'Minimum XP per message'))
      .addIntegerOption(intOption('xp_max', 'xpMax', 'Maximum XP per message')))
    .addSubcommand((s) => s.setName('reset').setDescription('Reset the XP of a member (Manage Server)')
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
    .addSubcommand((s) => s.setName('reward-add').setDescription('Give a role when a level is reached (Manage Server)')
      .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1).setMaxValue(MAX_LEVEL))
      .addRoleOption((o) => o.setName('role').setDescription('Role to give').setRequired(true)))
    .addSubcommand((s) => s.setName('reward-remove').setDescription('Remove the role reward of a level (Manage Server)')
      .addIntegerOption((o) => o.setName('level').setDescription('Level').setRequired(true).setMinValue(1).setMaxValue(MAX_LEVEL)))
    .addSubcommand((s) => s.setName('reward-list').setDescription('List the role rewards')),
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!isAdmin(interaction)) return fail(ctx, interaction, 'levels:errors.adminOnly');

    if (sub === 'enable' || sub === 'disable') {
      const on = sub === 'enable';
      ctx.store.guild(guildId).set('levels.enabled', on);
      return send(interaction, ctx.embeds.success(ctx.t(interaction, `levels:${sub}.title`), ctx.t(interaction, on ? 'levels:enable.done' : 'levels:disable.done')));
    }

    if (sub === 'config') return config(interaction, ctx);

    if (sub === 'reset') {
      const user = interaction.options.getUser('user', true);
      ctx.store.guild(guildId).delete(`levels.users.${user.id}`);
      return send(interaction, ctx.embeds.success(ctx.t(interaction, 'levels:reset.title'), ctx.t(interaction, 'levels:reset.done', { user: user.toString() })));
    }

    if (sub === 'reward-add') {
      const level = interaction.options.getInteger('level', true);
      const role = interaction.options.getRole('role', true);
      const problem = roleProblem(interaction.guild, role);
      if (problem) return fail(ctx, interaction, problem, { role: role.toString() });
      const rewards = ctx.store.guild(guildId).get(rewardsKey, {});
      if (!rewards[level] && Object.keys(rewards).length >= MAX_REWARDS) return fail(ctx, interaction, 'levels:errors.tooManyRewards', { max: MAX_REWARDS });
      ctx.store.guild(guildId).set(`${rewardsKey}.${level}`, role.id);
      return send(interaction, ctx.embeds.success(ctx.t(interaction, 'levels:reward.addedTitle'), ctx.t(interaction, 'levels:reward.added', { level, role: role.toString() })));
    }

    if (sub === 'reward-remove') {
      const level = interaction.options.getInteger('level', true);
      if (!ctx.store.guild(guildId).get(`${rewardsKey}.${level}`)) return fail(ctx, interaction, 'levels:errors.noReward', { level });
      ctx.store.guild(guildId).delete(`${rewardsKey}.${level}`);
      return send(interaction, ctx.embeds.success(ctx.t(interaction, 'levels:reward.removedTitle'), ctx.t(interaction, 'levels:reward.removed', { level })));
    }

    // reward-list
    const rewards = ctx.store.guild(guildId).get(rewardsKey, {});
    const levels = Object.keys(rewards).map(Number).sort((a, b) => a - b);
    const title = ctx.t(interaction, 'levels:reward.listTitle');
    if (!levels.length) return send(interaction, ctx.embeds.info(title, ctx.t(interaction, 'levels:reward.none')));
    const lines = levels.map((level) => ctx.t(interaction, 'levels:reward.line', { level, role: `<@&${rewards[level]}>` }));
    return send(interaction, ctx.embeds.info(title, lines.join('\n')));
  }
};

/** Shows the settings, or applies the options given. */
function config(interaction, ctx) {
  const guildId = interaction.guildId;
  const changes = {};
  const channel = interaction.options.getChannel('channel');
  if (channel) {
    const missing = permissions.botMissing(interaction.guild, [PermissionFlagsBits.SendMessages], channel);
    if (missing.length) return fail(ctx, interaction, 'levels:errors.botMissing', { perms: missing.join(', ') });
    changes.announceChannel = channel.id;
  }
  const announce = interaction.options.getBoolean('announce');
  if (announce !== null) changes.announce = announce;
  for (const [option, key] of [['cooldown', 'cooldown'], ['xp_min', 'xpMin'], ['xp_max', 'xpMax']]) {
    const value = interaction.options.getInteger(option);
    if (value !== null) changes[key] = value;
  }

  if (Object.keys(changes).length) {
    const merged = { ...getConfig(ctx.store, guildId), ...changes };
    if (merged.xpMin > merged.xpMax) return fail(ctx, interaction, 'levels:config.minAboveMax');
    for (const [key, value] of Object.entries(changes)) ctx.store.guild(guildId).set(`levels.config.${key}`, value);
  }

  const cfg = getConfig(ctx.store, guildId);
  const fields = [
    { name: ctx.t(interaction, 'levels:config.enabled'), value: ctx.t(interaction, isEnabled(ctx.store, guildId) ? 'levels:config.on' : 'levels:config.off'), inline: true },
    { name: ctx.t(interaction, 'levels:config.announce'), value: ctx.t(interaction, cfg.announce ? 'levels:config.on' : 'levels:config.off'), inline: true },
    { name: ctx.t(interaction, 'levels:config.channel'), value: cfg.announceChannel ? `<#${cfg.announceChannel}>` : ctx.t(interaction, 'levels:config.sameChannel'), inline: true },
    { name: ctx.t(interaction, 'levels:config.cooldown'), value: `${cfg.cooldown} s`, inline: true },
    { name: ctx.t(interaction, 'levels:config.xp'), value: `${cfg.xpMin} – ${cfg.xpMax}`, inline: true }
  ];
  const title = ctx.t(interaction, Object.keys(changes).length ? 'levels:config.saved' : 'levels:config.title');
  return send(interaction, ctx.embeds.info(title, undefined, { fields }));
}

