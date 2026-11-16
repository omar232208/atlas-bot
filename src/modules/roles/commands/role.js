'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, MessageFlags } = require('discord.js');
const duration = require('../../../core/duration');
const { confirm } = require('../../../core/confirm');
const { NS, getConfig, respond, fail, apiFail, checkRole, checkBotPerms } = require('../lib/util');
const temp = require('../lib/temp');

// Temp roles longer than a year are almost always a typo ("1000d").
const MAX_TEMP_MS = 366 * 86400000;
const PROGRESS_EVERY_MS = 3000;
const running = new Set();

const data = new SlashCommandBuilder()
  .setName('role')
  .setDescription('Roles')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('add').setDescription('add')
    .addUserOption((o) => o.setName('member').setDescription('member').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('role').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('duration').setMaxLength(20))
    .addStringOption((o) => o.setName('reason').setDescription('reason').setMaxLength(400)))
  .addSubcommand((s) => s.setName('remove').setDescription('remove')
    .addUserOption((o) => o.setName('member').setDescription('member').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('role').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('reason').setMaxLength(400)))
  .addSubcommand((s) => s.setName('all').setDescription('all')
    .addRoleOption((o) => o.setName('role').setDescription('role').setRequired(true))
    .addStringOption((o) => o.setName('action').setDescription('action').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }))
    .addStringOption((o) => o.setName('target').setDescription('target').addChoices({ name: 'all', value: 'all' }, { name: 'humans', value: 'humans' }, { name: 'bots', value: 'bots' })))
  .addSubcommand((s) => s.setName('info').setDescription('info').addRoleOption((o) => o.setName('role').setDescription('role').setRequired(true)))
  .addSubcommand((s) => s.setName('temp').setDescription('temp').addUserOption((o) => o.setName('member').setDescription('member')));

const tr = (ctx, i, k, v) => ctx.t(i, `${NS}:${k}`, v);

/**
 * Selects the members a mass action applies to. Pure (tested).
 * @param {Array<{id: string, user: {bot: boolean}, roles: {cache: {has: Function}}}>} members
 * @param {string} roleId
 * @param {'add'|'remove'} action
 * @param {'all'|'humans'|'bots'} target
 */
function massTargets(members, roleId, action, target) {
  return members.filter((m) => {
    if (target === 'humans' && m.user.bot) return false;
    if (target === 'bots' && !m.user.bot) return false;
    const has = m.roles.cache.has(roleId);
    return action === 'add' ? !has : has;
  });
}

async function single(interaction, ctx, action) {
  const role = interaction.options.getRole('role');
  const member = interaction.options.getMember('member');
  if (!member) return fail(interaction, ctx, 'errors.notMember');
  if (await checkBotPerms(interaction, ctx, [PermissionFlagsBits.ManageRoles])) return null;
  const problem = checkRole(role, interaction.member, ctx);
  if (problem) return fail(interaction, ctx, problem, { role: `<@&${role.id}>` });
  const reason = interaction.options.getString('reason') || tr(ctx, interaction.guild, 'role.auditReason', { user: interaction.user.tag });

  let ms = null;
  if (action === 'add') {
    const raw = interaction.options.getString('duration');
    if (raw) {
      ms = duration.parse(raw);
      if (!ms || ms < 60000 || ms > MAX_TEMP_MS) return fail(interaction, ctx, 'errors.badDuration');
    }
    if (member.roles.cache.has(role.id) && !ms) return fail(interaction, ctx, 'errors.alreadyHas', { user: `<@${member.id}>`, role: `<@&${role.id}>` });
  } else if (!member.roles.cache.has(role.id)) {
    return fail(interaction, ctx, 'errors.doesNotHave', { user: `<@${member.id}>`, role: `<@&${role.id}>` });
  }

  try {
    if (action === 'add') await member.roles.add(role, reason);
    else await member.roles.remove(role, reason);
  } catch (err) {
    return apiFail(interaction, ctx, err);
  }
  const vars = { user: `<@${member.id}>`, role: `<@&${role.id}>` };
  let text;
  if (action === 'add' && ms) {
    const runAt = Date.now() + ms;
    temp.schedule(ctx.scheduler, interaction.guildId, member.id, role.id, runAt, interaction.user.id);
    text = tr(ctx, interaction, 'role.addedTemp', { ...vars, duration: duration.format(ms, interaction), when: `<t:${Math.floor(runAt / 1000)}:R>` });
  } else {
    // A manual change overrides any pending expiry of the same role.
    temp.cancel(ctx.scheduler, interaction.guildId, member.id, role.id);
    text = tr(ctx, interaction, action === 'add' ? 'role.added' : 'role.removed', vars);
  }
  if (getConfig(ctx.store, interaction.guildId).logChanges) {
    await ctx.modlog.send(interaction.guild, 'members', ctx.embeds.info(tr(ctx, interaction.guild, 'log.roleTitle'), `${text}\n${tr(ctx, interaction.guild, 'log.by', { user: `<@${interaction.user.id}>` })}`));
  }
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'role.title'), text));
}

async function mass(interaction, ctx) {
  const role = interaction.options.getRole('role');
  const action = interaction.options.getString('action');
  const target = interaction.options.getString('target') || 'all';
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return fail(interaction, ctx, 'errors.manageGuild');
  if (await checkBotPerms(interaction, ctx, [PermissionFlagsBits.ManageRoles])) return null;
  const problem = checkRole(role, interaction.member, ctx);
  if (problem) return fail(interaction, ctx, problem, { role: `<@&${role.id}>` });
  if (running.has(interaction.guildId)) return fail(interaction, ctx, 'errors.massRunning');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let members;
  try {
    members = await interaction.guild.members.fetch();
  } catch (err) {
    return apiFail(interaction, ctx, err);
  }
  const list = massTargets([...members.values()], role.id, action, target);
  if (!list.length) return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'mass.title'), tr(ctx, interaction, 'mass.nobody')));
  const ok = await confirm(interaction, {
    title: tr(ctx, interaction, 'mass.confirmTitle'),
    description: tr(ctx, interaction, `mass.confirm.${action}`, { count: list.length, role: `<@&${role.id}>` })
  });
  if (!ok) return null;

  running.add(interaction.guildId);
  let done = 0;
  let failed = 0;
  let last = 0;
  const reason = tr(ctx, interaction.guild, 'mass.auditReason', { user: interaction.user.tag });
  try {
    for (const member of list) {
      try {
        if (action === 'add') await member.roles.add(role, reason);
        else await member.roles.remove(role, reason);
        done++;
      } catch {
        failed++;
      }
      // discord.js queues requests on rate limits; we only throttle the progress edits.
      if (Date.now() - last > PROGRESS_EVERY_MS) {
        last = Date.now();
        await respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'mass.title'), tr(ctx, interaction, 'mass.progress', { done: done + failed, total: list.length, bar: bar((done + failed) / list.length) })));
      }
    }
  } finally {
    running.delete(interaction.guildId);
  }
  const summary = tr(ctx, interaction, 'mass.done', { done, failed, role: `<@&${role.id}>` });
  if (getConfig(ctx.store, interaction.guildId).logChanges) {
    await ctx.modlog.send(interaction.guild, 'members', ctx.embeds.info(tr(ctx, interaction.guild, 'log.massTitle'), `${summary}\n${tr(ctx, interaction.guild, 'log.by', { user: `<@${interaction.user.id}>` })}`));
  }
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'mass.title'), summary));
}

/**
 * Text progress bar, e.g. "[######----] 60%".
 * @param {number} ratio 0..1
 */
function bar(ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(r * 20);
  return `\`[${'#'.repeat(filled)}${'-'.repeat(20 - filled)}]\` ${Math.round(r * 100)}%`;
}

async function info(interaction, ctx) {
  const role = interaction.options.getRole('role');
  const yes = tr(ctx, interaction, 'info.yes');
  const no = tr(ctx, interaction, 'info.no');
  const perms = new PermissionsBitField(role.permissions).toArray();
  const color = role.hexColor && role.color ? role.hexColor : tr(ctx, interaction, 'info.none');
  return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'info.title', { name: role.name }), undefined, {
    fields: [
      { name: tr(ctx, interaction, 'info.id'), value: role.id, inline: true },
      { name: tr(ctx, interaction, 'info.color'), value: color, inline: true },
      { name: tr(ctx, interaction, 'info.position'), value: String(role.position), inline: true },
      { name: tr(ctx, interaction, 'info.members'), value: String(role.members?.size ?? 0), inline: true },
      { name: tr(ctx, interaction, 'info.hoist'), value: role.hoist ? yes : no, inline: true },
      { name: tr(ctx, interaction, 'info.mentionable'), value: role.mentionable ? yes : no, inline: true },
      { name: tr(ctx, interaction, 'info.managed'), value: role.managed ? yes : no, inline: true },
      { name: tr(ctx, interaction, 'info.created'), value: `<t:${Math.floor(role.createdTimestamp / 1000)}:D>`, inline: true },
      { name: tr(ctx, interaction, 'info.temps'), value: String(temp.pending(ctx.scheduler, interaction.guildId, { roleId: role.id }).length), inline: true },
      { name: tr(ctx, interaction, 'info.permissions'), value: perms.includes('Administrator') ? 'Administrator' : (perms.join(', ') || tr(ctx, interaction, 'info.none')) }
    ]
  }));
}

async function listTemp(interaction, ctx) {
  const user = interaction.options.getUser('member');
  const jobs = temp.pending(ctx.scheduler, interaction.guildId, { userId: user?.id }).sort((a, b) => a.runAt - b.runAt);
  if (!jobs.length) return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'temp.listTitle'), tr(ctx, interaction, 'temp.empty')));
  const lines = jobs.slice(0, 40).map((j) => tr(ctx, interaction, 'temp.line', { user: `<@${j.payload.userId}>`, role: `<@&${j.payload.roleId}>`, when: `<t:${Math.floor(j.runAt / 1000)}:R>` }));
  if (jobs.length > 40) lines.push(tr(ctx, interaction, 'temp.more', { count: jobs.length - 40 }));
  return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'temp.listTitle'), lines.join('\n')));
}

module.exports = {
  data,
  cooldown: 2,
  /**
   * Routes /role subcommands.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    switch (interaction.options.getSubcommand()) {
      case 'add': return single(interaction, ctx, 'add');
      case 'remove': return single(interaction, ctx, 'remove');
      case 'all': return mass(interaction, ctx);
      case 'info': return info(interaction, ctx);
      case 'temp': return listTemp(interaction, ctx);
      default: return null;
    }
  },
  massTargets,
  bar,
  MAX_TEMP_MS
};
