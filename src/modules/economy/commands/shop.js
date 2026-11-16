'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { updateAccount, listItems } = require('../lib/accounts');
const { getConfig, formatMoney } = require('../lib/config');
const permissions = require('../../../core/permissions');
const { send, fail } = require('../lib/reply');

/** Maximum items in one shop: Discord autocomplete and embed fields stop at 25. */
const MAX_ITEMS = 25;
const MAX_PRICE = 1000000000;
const SHOP_KEY = 'economy.shop';

/**
 * Turns a name into a stable id: lowercase, accents removed, non-alphanumeric
 * characters joined by dashes. The id is the key stored under economy.shop.
 * @param {string} name
 * @returns {string} Empty when nothing usable is left.
 */
function slugify(name) {
  return String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

/** Shop management needs Manage Server, or bot-owner rights. */
function canManageShop(interaction) {
  return permissions.isOwner(interaction.guild, interaction.user.id)
    || !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

/**
 * Checks that the bot can hand out a role: it needs Manage Roles and the role
 * must sit below the bot's highest role. Returns an error key or null.
 */
function roleProblem(guild, role) {
  if (role.managed || role.id === guild.id) return 'economy:shop.roleUnusable';
  if (!permissions.botCan(guild, PermissionFlagsBits.ManageRoles)) return 'economy:shop.botNeedsRoles';
  const me = guild.members.me;
  if (role.position >= me.roles.highest.position) return 'economy:shop.roleTooHigh';
  return null;
}

/** Autocomplete: shop items matching what the user typed, as "name (price)". */
async function autocomplete(interaction, ctx) {
  const typed = String(interaction.options.getFocused() || '').toLowerCase();
  const cfg = getConfig(ctx.store, interaction.guildId);
  const choices = listItems(ctx.store, interaction.guildId)
    .filter((item) => item.name.toLowerCase().includes(typed) || item.id.includes(typed))
    .slice(0, MAX_ITEMS)
    .map((item) => ({ name: `${item.name} (${formatMoney(item.price, cfg, interaction)})`.slice(0, 100), value: item.id }));
  return interaction.respond(choices);
}

/** /shop list | buy | add | remove. Add and remove are for members with Manage Server. */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Browse and buy items')
    .addSubcommand((s) => s.setName('list').setDescription('List the shop items'))
    .addSubcommand((s) => s.setName('buy').setDescription('Buy an item')
      .addStringOption((o) => o.setName('item').setDescription('Item to buy').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('add').setDescription('Add an item to the shop (Manage Server)')
      .addStringOption((o) => o.setName('name').setDescription('Item name').setRequired(true).setMaxLength(40))
      .addIntegerOption((o) => o.setName('price').setDescription('Price').setRequired(true).setMinValue(1).setMaxValue(MAX_PRICE))
      .addStringOption((o) => o.setName('description').setDescription('Short description').setRequired(false).setMaxLength(100))
      .addRoleOption((o) => o.setName('role').setDescription('Role given when bought').setRequired(false)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove an item from the shop (Manage Server)')
      .addStringOption((o) => o.setName('item').setDescription('Item to remove').setRequired(true).setAutocomplete(true))),
  autocomplete,
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const cfg = getConfig(ctx.store, guildId);

    if (sub === 'list') {
      const items = listItems(ctx.store, guildId);
      if (!items.length) return send(interaction, ctx.embeds.info(ctx.t(interaction, 'economy:shop.title'), ctx.t(interaction, 'economy:shop.empty')));
      const fields = items.map((item) => ({
        name: `${item.name} · ${formatMoney(item.price, cfg, interaction)}`,
        value: [item.description || '-', item.roleId ? ctx.t(interaction, 'economy:shop.givesRole', { role: `<@&${item.roleId}>` }) : null].filter(Boolean).join('\n')
      }));
      return send(interaction, ctx.embeds.info(ctx.t(interaction, 'economy:shop.title'), undefined, { fields }));
    }

    if (sub === 'add' || sub === 'remove') {
      if (!canManageShop(interaction)) return fail(ctx, interaction, 'economy:errors.adminOnly');
    }

    if (sub === 'add') {
      const name = interaction.options.getString('name', true).trim();
      const id = slugify(name);
      if (!id) return fail(ctx, interaction, 'economy:shop.badName');
      if (ctx.store.guild(guildId).get(`${SHOP_KEY}.${id}`)) return fail(ctx, interaction, 'economy:shop.exists', { name });
      if (listItems(ctx.store, guildId).length >= MAX_ITEMS) return fail(ctx, interaction, 'economy:shop.full', { max: MAX_ITEMS });
      const role = interaction.options.getRole('role');
      if (role) {
        const problem = roleProblem(interaction.guild, role);
        if (problem) return fail(ctx, interaction, problem, { role: role.toString() });
      }
      const item = {
        id,
        name,
        price: interaction.options.getInteger('price', true),
        description: interaction.options.getString('description') || null,
        roleId: role?.id ?? null
      };
      ctx.store.guild(guildId).set(`${SHOP_KEY}.${id}`, item);
      return send(interaction, ctx.embeds.success(ctx.t(interaction, 'economy:shop.added'), ctx.t(interaction, 'economy:shop.addedText', { name })));
    }

    if (sub === 'remove') {
      const id = interaction.options.getString('item', true);
      const item = ctx.store.guild(guildId).get(`${SHOP_KEY}.${id}`);
      if (!item) return fail(ctx, interaction, 'economy:shop.notFound');
      ctx.store.guild(guildId).delete(`${SHOP_KEY}.${id}`);
      return send(interaction, ctx.embeds.success(ctx.t(interaction, 'economy:shop.removed'), ctx.t(interaction, 'economy:shop.removedText', { name: item.name })));
    }

    return buy(interaction, ctx, cfg);
  }
};

/**
 * Buys an item: charges the wallet, records it in the inventory and gives the
 * role if the item has one. If the role cannot be given, the money and the item
 * are refunded, so a failed purchase never costs anything.
 */
async function buy(interaction, ctx, cfg) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const id = interaction.options.getString('item', true);
  const item = ctx.store.guild(guildId).get(`${SHOP_KEY}.${id}`);
  if (!item) return fail(ctx, interaction, 'economy:shop.notFound');

  let member = null;
  if (item.roleId) {
    const role = interaction.guild.roles.cache.get(item.roleId);
    if (!role) return fail(ctx, interaction, 'economy:shop.roleMissing');
    const problem = roleProblem(interaction.guild, role);
    if (problem) return fail(ctx, interaction, problem, { role: role.toString() });
    member = interaction.member?.roles?.add ? interaction.member : await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) return fail(ctx, interaction, 'economy:shop.roleFailed');
    if (member.roles.cache.has(item.roleId)) return fail(ctx, interaction, 'economy:shop.alreadyOwned', { name: item.name });
  }

  const charged = updateAccount(ctx.store, guildId, userId, (acc) => {
    if (acc.wallet < item.price) return false;
    acc.wallet -= item.price;
    acc.inventory[id] = (acc.inventory[id] || 0) + 1;
    return true;
  });
  if (!charged) return fail(ctx, interaction, 'economy:errors.notEnough');

  if (member) {
    try {
      await member.roles.add(item.roleId, 'Bought in the shop');
    } catch (err) {
      ctx.logger.warn(`shop: could not give role ${item.roleId} in ${guildId}:`, err.message);
      updateAccount(ctx.store, guildId, userId, (acc) => {
        acc.wallet += item.price;
        acc.inventory[id] -= 1;
        if (acc.inventory[id] <= 0) delete acc.inventory[id];
      });
      return fail(ctx, interaction, 'economy:shop.roleFailed');
    }
  }
  return send(interaction, ctx.embeds.success(
    ctx.t(interaction, 'economy:shop.bought'),
    ctx.t(interaction, 'economy:shop.boughtText', { name: item.name, amount: formatMoney(item.price, cfg, interaction) })
  ));
}

module.exports.slugify = slugify;
module.exports.roleProblem = roleProblem;
