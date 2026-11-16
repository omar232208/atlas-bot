'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { NS, respond, fail, apiFail, checkRole, checkBotPerms } = require('../lib/util');
const menus = require('../lib/menus');

const menuOption = (o) => o.setName('menu').setDescription('menu').setRequired(true).setAutocomplete(true);
const MODES = ['toggle', 'unique', 'add', 'remove'];

const data = new SlashCommandBuilder()
  .setName('rolemenu')
  .setDescription('Role menus')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('create').setDescription('create')
    .addStringOption((o) => o.setName('name').setDescription('name').setRequired(true).setMaxLength(50))
    .addStringOption((o) => o.setName('type').setDescription('type').setRequired(true).addChoices({ name: 'buttons', value: 'buttons' }, { name: 'select', value: 'select' }))
    .addStringOption((o) => o.setName('mode').setDescription('mode').addChoices(...MODES.map((m) => ({ name: m, value: m }))))
    .addStringOption((o) => o.setName('title').setDescription('title').setMaxLength(256))
    .addStringOption((o) => o.setName('description').setDescription('description').setMaxLength(1500))
    .addRoleOption((o) => o.setName('required_role').setDescription('required_role'))
    .addIntegerOption((o) => o.setName('max').setDescription('max').setMinValue(1).setMaxValue(25)))
  .addSubcommand((s) => s.setName('add').setDescription('add')
    .addStringOption(menuOption)
    .addRoleOption((o) => o.setName('role').setDescription('role').setRequired(true))
    .addStringOption((o) => o.setName('label').setDescription('label').setMaxLength(80))
    .addStringOption((o) => o.setName('emoji').setDescription('emoji').setMaxLength(64))
    .addStringOption((o) => o.setName('description').setDescription('description').setMaxLength(100))
    .addStringOption((o) => o.setName('style').setDescription('style').addChoices(...Object.keys(menus.STYLES).map((v) => ({ name: v, value: v })))))
  .addSubcommand((s) => s.setName('remove').setDescription('remove')
    .addStringOption(menuOption)
    .addRoleOption((o) => o.setName('role').setDescription('role').setRequired(true)))
  .addSubcommand((s) => s.setName('edit').setDescription('edit')
    .addStringOption(menuOption)
    .addStringOption((o) => o.setName('title').setDescription('title').setMaxLength(256))
    .addStringOption((o) => o.setName('description').setDescription('description').setMaxLength(1500))
    .addStringOption((o) => o.setName('mode').setDescription('mode').addChoices(...MODES.map((m) => ({ name: m, value: m }))))
    .addRoleOption((o) => o.setName('required_role').setDescription('required_role'))
    .addBooleanOption((o) => o.setName('clear_required').setDescription('clear_required'))
    .addIntegerOption((o) => o.setName('max').setDescription('max').setMinValue(1).setMaxValue(25)))
  .addSubcommand((s) => s.setName('post').setDescription('post')
    .addStringOption(menuOption)
    .addChannelOption((o) => o.setName('channel').setDescription('channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('list').setDescription('list'))
  .addSubcommand((s) => s.setName('delete').setDescription('delete').addStringOption(menuOption));

const tr = (ctx, i, k, v) => ctx.t(i, `${NS}:${k}`, v);

/** Saves, refreshes posted copies and confirms. */
async function saveAndRefresh(interaction, ctx, menu, key, vars) {
  menus.save(ctx.store, interaction.guildId, menu);
  const updated = await menus.refreshPosts(ctx, interaction.guild, menu);
  const extra = menu.posts.length ? `\n${tr(ctx, interaction, 'rolemenu.refreshed', { count: updated })}` : '';
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'rolemenu.title'), `${tr(ctx, interaction, key, vars)}${extra}`));
}

module.exports = {
  data,
  cooldown: 2,
  /**
   * Routes /rolemenu subcommands.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const gid = interaction.guildId;
    if (sub === 'list') {
      const list = Object.values(menus.all(ctx.store, gid));
      if (!list.length) return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'rolemenu.listTitle'), tr(ctx, interaction, 'rolemenu.empty')));
      const lines = list.map((m) => tr(ctx, interaction, 'rolemenu.listLine', {
        name: m.name, type: tr(ctx, interaction, `rolemenu.types.${m.type}`), mode: tr(ctx, interaction, `rolemenu.modes.${m.mode}`), count: m.items.length, posts: m.posts.length
      }));
      return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'rolemenu.listTitle'), lines.join('\n')));
    }
    if (sub === 'create') {
      const result = menus.createMenu(ctx.store, gid, {
        name: interaction.options.getString('name').trim(),
        type: interaction.options.getString('type'),
        mode: interaction.options.getString('mode') || 'toggle',
        title: interaction.options.getString('title'),
        description: interaction.options.getString('description'),
        requiredRoleId: interaction.options.getRole('required_role')?.id,
        maxValues: interaction.options.getInteger('max')
      });
      if (typeof result === 'string') return fail(interaction, ctx, result, { max: menus.MAX_MENUS });
      return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'rolemenu.title'), tr(ctx, interaction, 'rolemenu.created', { name: result.name })));
    }

    const menu = menus.findMenu(ctx.store, gid, interaction.options.getString('menu'));
    if (!menu) return fail(interaction, ctx, 'errors.menuUnknown');

    if (sub === 'add') {
      const role = interaction.options.getRole('role');
      const problem = checkRole(role, interaction.member, ctx, true);
      if (problem) return fail(interaction, ctx, problem, { role: `<@&${role.id}>` });
      if (menu.items.length >= menus.MAX_ITEMS) return fail(interaction, ctx, 'errors.tooManyItems', { max: menus.MAX_ITEMS });
      if (menu.items.some((i) => i.roleId === role.id)) return fail(interaction, ctx, 'errors.itemExists', { role: `<@&${role.id}>` });
      const rawEmoji = interaction.options.getString('emoji');
      const emoji = menus.parseEmoji(rawEmoji);
      if (rawEmoji && !emoji) return fail(interaction, ctx, 'errors.badEmoji');
      menu.items.push({
        roleId: role.id,
        label: interaction.options.getString('label') || role.name,
        emoji: emoji || null,
        description: interaction.options.getString('description') || null,
        style: interaction.options.getString('style') || 'secondary'
      });
      return saveAndRefresh(interaction, ctx, menu, 'rolemenu.itemAdded', { role: `<@&${role.id}>`, name: menu.name });
    }
    if (sub === 'remove') {
      const role = interaction.options.getRole('role');
      if (!menu.items.some((i) => i.roleId === role.id)) return fail(interaction, ctx, 'errors.itemUnknown', { role: `<@&${role.id}>` });
      menu.items = menu.items.filter((i) => i.roleId !== role.id);
      return saveAndRefresh(interaction, ctx, menu, 'rolemenu.itemRemoved', { role: `<@&${role.id}>`, name: menu.name });
    }
    if (sub === 'edit') {
      const fields = { title: interaction.options.getString('title'), description: interaction.options.getString('description'), mode: interaction.options.getString('mode'), maxValues: interaction.options.getInteger('max') };
      let changed = 0;
      for (const [key, value] of Object.entries(fields)) if (value !== null) { menu[key] = value === '-' ? null : value; changed++; }
      const required = interaction.options.getRole('required_role');
      if (required) { menu.requiredRoleId = required.id; changed++; }
      if (interaction.options.getBoolean('clear_required')) { menu.requiredRoleId = null; changed++; }
      if (!changed) return fail(interaction, ctx, 'errors.nothingChanged');
      return saveAndRefresh(interaction, ctx, menu, 'rolemenu.edited', { name: menu.name });
    }
    if (sub === 'delete') {
      ctx.store.guild(gid).delete(`roles.menus.${menu.id}`);
      // Posted copies would show dead buttons: remove them too.
      for (const post of menu.posts) {
        const channel = interaction.guild.channels.cache.get(post.channelId);
        await channel?.messages?.delete(post.messageId).catch(() => {});
      }
      return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'rolemenu.title'), tr(ctx, interaction, 'rolemenu.deleted', { name: menu.name })));
    }
    // sub === 'post'
    if (!menu.items.length) return fail(interaction, ctx, 'errors.emptyMenu');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (await checkBotPerms(interaction, ctx, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel)) return null;
    if (await checkBotPerms(interaction, ctx, [PermissionFlagsBits.ManageRoles])) return null;
    try {
      const message = await channel.send(menus.buildMessage(ctx, interaction.guild, menu));
      menu.posts = [...menu.posts, { channelId: channel.id, messageId: message.id }].slice(-menus.MAX_POSTS);
      menus.save(ctx.store, gid, menu);
    } catch (err) {
      return apiFail(interaction, ctx, err);
    }
    return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'rolemenu.title'), tr(ctx, interaction, 'rolemenu.posted', { name: menu.name, channel: `<#${channel.id}>` })));
  },
  /** Suggests menu names. */
  async autocomplete(interaction, ctx) {
    const typed = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = Object.values(menus.all(ctx.store, interaction.guildId))
      .filter((m) => m.name.toLowerCase().includes(typed)).slice(0, 25).map((m) => ({ name: m.name, value: m.id }));
    await interaction.respond(choices).catch(() => {});
  }
};
