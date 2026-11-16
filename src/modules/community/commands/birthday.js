'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { paginate, chunk } = require('../../../core/paginate');
const { setting, COLLECTIONS } = require('../lib/config');
const { NS, en, fail, ok, respond, ensureBotPerms, requireMember, memberCan } = require('../lib/util');
const B = require('../lib/birthdays');

const userPath = (userId) => [...COLLECTIONS.birthdays.split('.'), userId];

/** "14/03" or "14/03/1998", day first as in most of the five languages. */
const formatDate = (e) => `${String(e.day).padStart(2, '0')}/${String(e.month).padStart(2, '0')}${e.year ? `/${e.year}` : ''}`;

async function set(interaction, ctx) {
  const target = interaction.options.getUser('user');
  // Setting someone else's birthday is a staff action (fixing mistakes, imports).
  if (target && target.id !== interaction.user.id && !(await requireMember(interaction, ctx, PermissionFlagsBits.ManageGuild))) return null;
  const user = target || interaction.user;
  if (user.bot) return fail(interaction, ctx, 'birthdays.noBots');
  const day = interaction.options.getInteger('day', true);
  const month = interaction.options.getInteger('month', true);
  const year = interaction.options.getInteger('year');
  if (!B.isValidDate(day, month, year)) return fail(interaction, ctx, 'birthdays.invalidDate');
  const entry = { day, month, year: year || null };
  ctx.store.guild(interaction.guildId).set(userPath(user.id), entry);
  const local = B.localNow(setting(ctx.store.guild(interaction.guildId), 'community.birthdays.utcOffset'));
  return ok(interaction, ctx, 'birthdays.saved', 'birthdays.savedDesc', { user: `<@${user.id}>`, date: formatDate(entry), days: B.daysUntil(entry, local) });
}

async function remove(interaction, ctx) {
  const target = interaction.options.getUser('user');
  if (target && target.id !== interaction.user.id && !(await requireMember(interaction, ctx, PermissionFlagsBits.ManageGuild))) return null;
  const user = target || interaction.user;
  if (!ctx.store.guild(interaction.guildId).delete(userPath(user.id))) return fail(interaction, ctx, 'birthdays.none', { user: `<@${user.id}>` });
  return ok(interaction, ctx, 'birthdays.removed', null, { user: `<@${user.id}>` });
}

async function list(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const local = B.localNow(setting(g, 'community.birthdays.utcOffset'));
  const all = B.upcoming(g.get(COLLECTIONS.birthdays, {}), local);
  if (!all.length) return fail(interaction, ctx, 'birthdays.listEmpty');
  const lines = all.map(({ userId, entry, days }) => {
    const age = B.upcomingAge(entry, local);
    const when = days === 0 ? ctx.t(interaction, `${NS}:birthdays.today`) : ctx.t(interaction, `${NS}:birthdays.inDays`, { days });
    return ctx.t(interaction, `${NS}:birthdays.listLine`, { user: `<@${userId}>`, date: formatDate({ ...entry, year: null }), when, age: age ? ctx.t(interaction, `${NS}:birthdays.ageSuffix`, { age }) : '' });
  });
  const pages = chunk(lines, 15).map((d) => ctx.embeds.info(ctx.t(interaction, `${NS}:birthdays.listTitle`, { count: all.length }), d));
  return paginate(interaction, pages);
}

async function config(interaction, ctx) {
  if (!(await requireMember(interaction, ctx, PermissionFlagsBits.ManageGuild))) return null;
  const g = ctx.store.guild(interaction.guildId);
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');
  if (channel && !(await ensureBotPerms(interaction, ctx, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel))) return null;
  if (role) {
    if (!(await ensureBotPerms(interaction, ctx, [PermissionFlagsBits.ManageRoles]))) return null;
    if (!role.editable || role.managed) return fail(interaction, ctx, 'errors.roleTooHigh', { role: `<@&${role.id}>` });
  }
  const enabled = interaction.options.getBoolean('enabled');
  if (channel) g.set('community.birthdays.channelId', channel.id);
  if (role) g.set('community.birthdays.roleId', role.id);
  if (interaction.options.getBoolean('clear-role')) g.set('community.birthdays.roleId', null);
  const hour = interaction.options.getInteger('hour');
  if (hour !== null) g.set('community.birthdays.hour', hour);
  const offset = interaction.options.getNumber('utc-offset');
  if (offset !== null) g.set('community.birthdays.utcOffset', offset);
  const message = interaction.options.getString('message');
  if (message !== null) g.set('community.birthdays.message', message === '-' ? '' : message);
  // Turning the feature on implicitly when a channel is chosen matches what admins expect.
  if (enabled !== null) g.set('community.birthdays.enabled', enabled);
  else if (channel) g.set('community.birthdays.enabled', true);

  const t = (k, v) => ctx.t(interaction, `${NS}:${k}`, v);
  const cid = setting(g, 'community.birthdays.channelId');
  const rid = setting(g, 'community.birthdays.roleId');
  const embed = ctx.embeds.success(t('birthdays.configTitle'), t('birthdays.configHelp'), {
    fields: [
      { name: t('common.state'), value: t(`common.${setting(g, 'community.birthdays.enabled') ? 'on' : 'off'}`), inline: true },
      { name: t('birthdays.channel'), value: cid ? `<#${cid}>` : t('common.none'), inline: true },
      { name: t('birthdays.role'), value: rid ? `<@&${rid}>` : t('common.none'), inline: true },
      { name: t('birthdays.hour'), value: `${setting(g, 'community.birthdays.hour')}:00`, inline: true },
      { name: t('birthdays.offset'), value: `UTC${setting(g, 'community.birthdays.utcOffset') >= 0 ? '+' : ''}${setting(g, 'community.birthdays.utcOffset')}`, inline: true },
      { name: t('birthdays.message'), value: setting(g, 'community.birthdays.message') || t('birthdays.defaultMessage') }
    ]
  });
  return respond(interaction, embed, { ephemeral: true });
}

async function view(interaction, ctx) {
  const user = interaction.options.getUser('user') || interaction.user;
  const g = ctx.store.guild(interaction.guildId);
  const entry = g.get(userPath(user.id), null);
  if (!entry) return fail(interaction, ctx, 'birthdays.none', { user: `<@${user.id}>` });
  const local = B.localNow(setting(g, 'community.birthdays.utcOffset'));
  const days = B.daysUntil(entry, local);
  // The year stays private unless the member looks at their own entry or is staff.
  const showYear = user.id === interaction.user.id || memberCan(interaction, PermissionFlagsBits.ManageGuild);
  return respond(interaction, ctx.embeds.info(ctx.t(interaction, `${NS}:birthdays.viewTitle`), ctx.t(interaction, `${NS}:birthdays.viewDesc`, {
    user: `<@${user.id}>`, date: formatDate(showYear ? entry : { ...entry, year: null }), days
  })), { ephemeral: true });
}

const HANDLERS = { set, remove, list, config, view };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription(en('commands.birthday.description'))
    .addSubcommand((sc) => sc.setName('set').setDescription(en('commands.birthday.options.set.description'))
      .addIntegerOption((o) => o.setName('day').setDescription(en('commands.birthday.options.set.options.day')).setRequired(true).setMinValue(1).setMaxValue(31))
      .addIntegerOption((o) => o.setName('month').setDescription(en('commands.birthday.options.set.options.month')).setRequired(true).setMinValue(1).setMaxValue(12))
      .addIntegerOption((o) => o.setName('year').setDescription(en('commands.birthday.options.set.options.year')).setMinValue(1900).setMaxValue(2100))
      .addUserOption((o) => o.setName('user').setDescription(en('commands.birthday.options.set.options.user'))))
    .addSubcommand((sc) => sc.setName('remove').setDescription(en('commands.birthday.options.remove.description'))
      .addUserOption((o) => o.setName('user').setDescription(en('commands.birthday.options.remove.options.user'))))
    .addSubcommand((sc) => sc.setName('view').setDescription(en('commands.birthday.options.view.description'))
      .addUserOption((o) => o.setName('user').setDescription(en('commands.birthday.options.view.options.user'))))
    .addSubcommand((sc) => sc.setName('list').setDescription(en('commands.birthday.options.list.description')))
    .addSubcommand((sc) => sc.setName('config').setDescription(en('commands.birthday.options.config.description'))
      .addBooleanOption((o) => o.setName('enabled').setDescription(en('commands.birthday.options.config.options.enabled')))
      .addChannelOption((o) => o.setName('channel').setDescription(en('commands.birthday.options.config.options.channel')).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addRoleOption((o) => o.setName('role').setDescription(en('commands.birthday.options.config.options.role')))
      .addBooleanOption((o) => o.setName('clear-role').setDescription(en('commands.birthday.options.config.options.clear-role')))
      .addIntegerOption((o) => o.setName('hour').setDescription(en('commands.birthday.options.config.options.hour')).setMinValue(0).setMaxValue(23))
      .addNumberOption((o) => o.setName('utc-offset').setDescription(en('commands.birthday.options.config.options.utc-offset')).setMinValue(-12).setMaxValue(14))
      .addStringOption((o) => o.setName('message').setDescription(en('commands.birthday.options.config.options.message')).setMaxLength(500))),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  execute(interaction, ctx) {
    return HANDLERS[interaction.options.getSubcommand()](interaction, ctx);
  }
};
