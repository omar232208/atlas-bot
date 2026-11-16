'use strict';

const crypto = require('node:crypto');
const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { NS, getConfig, respond, fail, apiFail, checkBotPerms } = require('../lib/util');
const { buildPanel, getCategories } = require('../lib/open');
const manage = require('../lib/manage');

const MAX_CATEGORIES = 25; // a select menu holds at most 25 options

const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Tickets')
  .addSubcommand((s) => s.setName('panel').setDescription('panel')
    .addChannelOption((o) => o.setName('channel').setDescription('channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption((o) => o.setName('title').setDescription('title').setMaxLength(256))
    .addStringOption((o) => o.setName('description').setDescription('description').setMaxLength(2000)))
  .addSubcommand((s) => s.setName('close').setDescription('close')
    .addStringOption((o) => o.setName('reason').setDescription('reason').setMaxLength(500)))
  .addSubcommand((s) => s.setName('add').setDescription('add').addUserOption((o) => o.setName('user').setDescription('user').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('remove').addUserOption((o) => o.setName('user').setDescription('user').setRequired(true)))
  .addSubcommand((s) => s.setName('claim').setDescription('claim'))
  .addSubcommand((s) => s.setName('rename').setDescription('rename').addStringOption((o) => o.setName('name').setDescription('name').setRequired(true).setMaxLength(90)))
  .addSubcommand((s) => s.setName('transcript').setDescription('transcript'))
  .addSubcommandGroup((g) => g.setName('config').setDescription('config')
    .addSubcommand((s) => s.setName('show').setDescription('show'))
    .addSubcommand((s) => s.setName('staff').setDescription('staff')
      .addRoleOption((o) => o.setName('role').setDescription('role').setRequired(true))
      .addStringOption((o) => o.setName('action').setDescription('action').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' })))
    .addSubcommand((s) => s.setName('logs').setDescription('logs')
      .addChannelOption((o) => o.setName('channel').setDescription('channel').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('parent').setDescription('parent')
      .addChannelOption((o) => o.setName('category').setDescription('category').addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand((s) => s.setName('limit').setDescription('limit')
      .addIntegerOption((o) => o.setName('max').setDescription('max').setRequired(true).setMinValue(1).setMaxValue(10)))
    .addSubcommand((s) => s.setName('options').setDescription('options')
      .addBooleanOption((o) => o.setName('ratings').setDescription('ratings'))
      .addBooleanOption((o) => o.setName('dm_transcript').setDescription('dm_transcript'))
      .addBooleanOption((o) => o.setName('ask_reason').setDescription('ask_reason'))
      .addBooleanOption((o) => o.setName('owner_close').setDescription('owner_close'))
      .addStringOption((o) => o.setName('name_format').setDescription('name_format').setMaxLength(60))
      .addStringOption((o) => o.setName('welcome_message').setDescription('welcome_message').setMaxLength(1500))))
  .addSubcommandGroup((g) => g.setName('category').setDescription('category')
    .addSubcommand((s) => s.setName('add').setDescription('add')
      .addStringOption((o) => o.setName('name').setDescription('name').setRequired(true).setMaxLength(50))
      .addStringOption((o) => o.setName('description').setDescription('description').setMaxLength(100))
      .addStringOption((o) => o.setName('emoji').setDescription('emoji').setMaxLength(64))
      .addChannelOption((o) => o.setName('parent').setDescription('parent').addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption((o) => o.setName('staff_role').setDescription('staff_role')))
    .addSubcommand((s) => s.setName('remove').setDescription('remove')
      .addStringOption((o) => o.setName('name').setDescription('name').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('list')));

const tr = (ctx, i, key, vars) => ctx.t(i, `${NS}:${key}`, vars);
const isManager = (interaction) => interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

/**
 * Accepts a unicode emoji or a custom emoji "<:name:id>" for select menu options.
 * Returns undefined for anything else so a typo cannot break the panel.
 * @param {string} [text]
 */
function parseEmoji(text) {
  if (!text) return undefined;
  const custom = text.match(/^<a?:(\w{2,32}):(\d{17,20})>$/);
  if (custom) return { name: custom[1], id: custom[2], animated: text.startsWith('<a:') };
  return /^\p{Extended_Pictographic}/u.test(text) ? text : undefined;
}

async function panel(interaction, ctx) {
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  if (await checkBotPerms(interaction, ctx, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel)) return;
  if (await checkBotPerms(interaction, ctx, [PermissionFlagsBits.ManageChannels])) return;
  try {
    await channel.send(buildPanel(ctx, interaction.guild, { title: interaction.options.getString('title'), description: interaction.options.getString('description') }));
  } catch (err) {
    return apiFail(interaction, ctx, err);
  }
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'panel.postedTitle'), tr(ctx, interaction, 'panel.posted', { channel: `<#${channel.id}>` })));
}

async function config(interaction, ctx, sub) {
  const gstore = ctx.store.guild(interaction.guildId);
  const cfg = getConfig(ctx.store, interaction.guildId);
  const done = (key, vars) => respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'config.title'), tr(ctx, interaction, key, vars)));
  const none = tr(ctx, interaction, 'transcript.none');
  if (sub === 'show') {
    const stats = gstore.get('tickets.stats', {});
    const ratings = gstore.get('tickets.ratings', []);
    const avg = ratings.length ? (ratings.reduce((a, r) => a + r.stars, 0) / ratings.length).toFixed(2) : none;
    const open = Object.values(gstore.get('tickets.list', {})).filter((tk) => tk.status === 'open').length;
    const yes = tr(ctx, interaction, 'config.yes');
    const no = tr(ctx, interaction, 'config.no');
    return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'config.title'), undefined, {
      fields: [
        { name: tr(ctx, interaction, 'config.fields.staff'), value: cfg.staffRoleIds.map((id) => `<@&${id}>`).join(' ') || none },
        { name: tr(ctx, interaction, 'config.fields.logs'), value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : none, inline: true },
        { name: tr(ctx, interaction, 'config.fields.parent'), value: cfg.parentId ? `<#${cfg.parentId}>` : none, inline: true },
        { name: tr(ctx, interaction, 'config.fields.limit'), value: String(cfg.maxOpen), inline: true },
        { name: tr(ctx, interaction, 'config.fields.ratings'), value: cfg.ratings ? yes : no, inline: true },
        { name: tr(ctx, interaction, 'config.fields.dmTranscript'), value: cfg.dmTranscript ? yes : no, inline: true },
        { name: tr(ctx, interaction, 'config.fields.askReason'), value: cfg.askReason ? yes : no, inline: true },
        { name: tr(ctx, interaction, 'config.fields.ownerClose'), value: cfg.ownerCanClose ? yes : no, inline: true },
        { name: tr(ctx, interaction, 'config.fields.nameFormat'), value: `\`${cfg.nameFormat}\``, inline: true },
        { name: tr(ctx, interaction, 'config.fields.categories'), value: String(getCategories(ctx.store, interaction.guildId).length), inline: true },
        { name: tr(ctx, interaction, 'config.fields.stats'), value: tr(ctx, interaction, 'config.statsValue', { open, opened: stats.opened || 0, closed: stats.closed || 0, avg, count: ratings.length }) }
      ]
    }));
  }
  if (sub === 'staff') {
    const role = interaction.options.getRole('role');
    const add = interaction.options.getString('action') === 'add';
    if (role.id === interaction.guildId) return fail(interaction, ctx, 'errors.everyoneRole');
    gstore.set('tickets.config.staffRoleIds', add ? [...new Set([...cfg.staffRoleIds, role.id])] : cfg.staffRoleIds.filter((id) => id !== role.id));
    return done(add ? 'config.staffAdded' : 'config.staffRemoved', { role: `<@&${role.id}>` });
  }
  if (sub === 'logs') {
    const channel = interaction.options.getChannel('channel');
    if (channel && await checkBotPerms(interaction, ctx, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks], channel)) return;
    gstore.set('tickets.config.logChannelId', channel?.id || null);
    return done(channel ? 'config.logsSet' : 'config.logsCleared', { channel: channel ? `<#${channel.id}>` : '' });
  }
  if (sub === 'parent') {
    const category = interaction.options.getChannel('category');
    gstore.set('tickets.config.parentId', category?.id || null);
    return done(category ? 'config.parentSet' : 'config.parentCleared', { category: category?.name || '' });
  }
  if (sub === 'limit') {
    const max = interaction.options.getInteger('max');
    gstore.set('tickets.config.maxOpen', max);
    return done('config.limitSet', { max });
  }
  // sub === 'options': only the options the user typed are changed.
  const map = { ratings: 'ratings', dm_transcript: 'dmTranscript', ask_reason: 'askReason', owner_close: 'ownerCanClose' };
  let changed = 0;
  for (const [opt, key] of Object.entries(map)) {
    const value = interaction.options.getBoolean(opt);
    if (value !== null) { gstore.set(`tickets.config.${key}`, value); changed++; }
  }
  const format = interaction.options.getString('name_format');
  if (format !== null) { gstore.set('tickets.config.nameFormat', format); changed++; }
  const welcome = interaction.options.getString('welcome_message');
  if (welcome !== null) { gstore.set('tickets.config.welcomeMessage', welcome === '-' ? '' : welcome); changed++; }
  if (!changed) return fail(interaction, ctx, 'errors.nothingChanged');
  return done('config.optionsSaved', { count: changed });
}

async function category(interaction, ctx, sub) {
  const gstore = ctx.store.guild(interaction.guildId);
  const list = getCategories(ctx.store, interaction.guildId);
  if (sub === 'list') {
    if (!list.length) return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'category.listTitle'), tr(ctx, interaction, 'category.empty')));
    const lines = list.map((c) => {
      const extra = [c.parentId ? `<#${c.parentId}>` : null, c.staffRoleId ? `<@&${c.staffRoleId}>` : null].filter(Boolean).join(' ');
      return `**${c.name}**${c.description ? ` - ${c.description}` : ''}${extra ? `\n${extra}` : ''}`;
    });
    return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'category.listTitle'), lines.join('\n\n')));
  }
  const name = interaction.options.getString('name').trim();
  if (sub === 'add') {
    if (list.length >= MAX_CATEGORIES) return fail(interaction, ctx, 'errors.tooManyCategories', { max: MAX_CATEGORIES });
    if (list.some((c) => c.name.toLowerCase() === name.toLowerCase())) return fail(interaction, ctx, 'errors.categoryExists', { name });
    const rawEmoji = interaction.options.getString('emoji');
    const emoji = parseEmoji(rawEmoji);
    if (rawEmoji && !emoji) return fail(interaction, ctx, 'errors.badEmoji');
    const entry = {
      id: crypto.randomBytes(4).toString('hex'),
      name,
      description: interaction.options.getString('description') || null,
      emoji: emoji || null,
      parentId: interaction.options.getChannel('parent')?.id || null,
      staffRoleId: interaction.options.getRole('staff_role')?.id || null
    };
    gstore.set('tickets.categories', [...list, entry]);
    return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'category.title'), tr(ctx, interaction, 'category.added', { name })));
  }
  const target = list.find((c) => c.id === name || c.name.toLowerCase() === name.toLowerCase());
  if (!target) return fail(interaction, ctx, 'errors.categoryUnknown', { name });
  gstore.set('tickets.categories', list.filter((c) => c.id !== target.id));
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'category.title'), tr(ctx, interaction, 'category.removed', { name: target.name })));
}

module.exports = {
  data,
  cooldown: 3,
  /**
   * Routes /ticket subcommands.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    if ((group || sub === 'panel') && !isManager(interaction)) return fail(interaction, ctx, 'errors.manageGuild');
    if (group === 'config') return config(interaction, ctx, sub);
    if (group === 'category') return category(interaction, ctx, sub);
    switch (sub) {
      case 'panel': return panel(interaction, ctx);
      case 'close': return manage.closeTicket(interaction, ctx, interaction.options.getString('reason'));
      case 'add': return manage.setMember(interaction, ctx, 'add', interaction.options.getUser('user'));
      case 'remove': return manage.setMember(interaction, ctx, 'remove', interaction.options.getUser('user'));
      case 'claim': return manage.claimTicket(interaction, ctx);
      case 'rename': return manage.renameTicket(interaction, ctx, interaction.options.getString('name'));
      case 'transcript': return manage.sendTranscript(interaction, ctx);
      default: return null;
    }
  },
  /** Suggests existing category names for /ticket category remove. */
  async autocomplete(interaction, ctx) {
    const typed = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = getCategories(ctx.store, interaction.guildId)
      .filter((c) => c.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((c) => ({ name: c.name, value: c.id }));
    await interaction.respond(choices).catch(() => {});
  },
  parseEmoji
};
