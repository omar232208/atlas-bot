'use strict';

const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { NS, getConfig, respond, fail } = require('./util');

const MAX_ITEMS = 25; // 5 rows of 5 buttons, or 25 select options
const MAX_MENUS = 25;
const MAX_POSTS = 10;
const STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

const all = (store, guildId) => store.guild(guildId).get('roles.menus', {});
const save = (store, guildId, menu) => store.guild(guildId).set(`roles.menus.${menu.id}`, menu);

/**
 * Finds a menu by id or (case-insensitive) name.
 * @returns {object|null}
 */
function findMenu(store, guildId, idOrName) {
  const menus = all(store, guildId);
  if (!idOrName) return null;
  if (menus[idOrName]) return menus[idOrName];
  const lower = String(idOrName).toLowerCase();
  return Object.values(menus).find((m) => m.name.toLowerCase() === lower) || null;
}

/**
 * Creates and stores a new menu.
 * @param {{name: string, type: 'buttons'|'select', mode: string, title?: string, description?: string, requiredRoleId?: string, maxValues?: number}} input
 * @returns {object|string} The menu, or an error locale key.
 */
function createMenu(store, guildId, input) {
  const menus = all(store, guildId);
  if (Object.keys(menus).length >= MAX_MENUS) return 'errors.tooManyMenus';
  if (findMenu(store, guildId, input.name)) return 'errors.menuExists';
  const menu = {
    id: crypto.randomBytes(4).toString('hex'),
    name: input.name,
    type: input.type,
    mode: input.mode,
    title: input.title || null,
    description: input.description || null,
    requiredRoleId: input.requiredRoleId || null,
    maxValues: input.maxValues || null,
    items: [],
    posts: []
  };
  save(store, guildId, menu);
  return menu;
}

/**
 * Computes which roles to add and remove after a click. Pure function.
 * Buttons send the clicked role; selects send the picked roles. Toggle flips
 * each picked role, unique keeps at most one role of the menu, add/remove only
 * go one way (verification-style and "drop" menus).
 * @param {{type: string, mode: string, items: Array<{roleId: string}>}} menu
 * @param {Set<string>|string[]} current Role ids the member has.
 * @param {string|string[]} input Clicked role id (buttons) or selected ids (select).
 * @returns {{add: string[], remove: string[]}}
 */
function computeChanges(menu, current, input) {
  const has = new Set(current);
  const menuRoles = menu.items.map((i) => i.roleId);
  const add = [];
  const remove = [];
  if (menu.type === 'buttons') {
    const roleId = String(input);
    if (!menuRoles.includes(roleId)) return { add, remove };
    const owned = has.has(roleId);
    if (menu.mode === 'add') { if (!owned) add.push(roleId); }
    else if (menu.mode === 'remove') { if (owned) remove.push(roleId); }
    else if (owned) remove.push(roleId);
    else {
      add.push(roleId);
      if (menu.mode === 'unique') remove.push(...menuRoles.filter((id) => id !== roleId && has.has(id)));
    }
    return { add, remove };
  }
  const selected = [...new Set((Array.isArray(input) ? input : [input]).filter((id) => menuRoles.includes(id)))];
  if (menu.mode === 'remove') return { add, remove: selected.filter((id) => has.has(id)) };
  if (menu.mode === 'add') return { add: selected.filter((id) => !has.has(id)), remove };
  if (menu.mode === 'unique') {
    const pick = selected[0];
    if (!pick) return { add, remove };
    return has.has(pick) ? { add, remove: [pick] } : { add: [pick], remove: menuRoles.filter((id) => id !== pick && has.has(id)) };
  }
  // Toggle: a select cannot show what each member already has, so every picked role flips.
  for (const id of selected) (has.has(id) ? remove : add).push(id);
  return { add, remove };
}

/**
 * Parses a unicode or custom emoji; undefined when not an emoji.
 * @param {string} [text]
 */
function parseEmoji(text) {
  if (!text) return undefined;
  const custom = text.match(/^<(a?):(\w{2,32}):(\d{17,20})>$/);
  if (custom) return { name: custom[2], id: custom[3], animated: custom[1] === 'a' };
  return /^\p{Extended_Pictographic}/u.test(text) ? text : undefined;
}

/**
 * Builds the public message of a menu.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {object} menu
 */
function buildMessage(ctx, guild, menu) {
  const tr = (k, v) => ctx.t(guild, `${NS}:${k}`, v);
  const lines = menu.items.map((i) => `${i.emoji ? `${typeof i.emoji === 'string' ? i.emoji : `<${i.emoji.animated ? 'a' : ''}:${i.emoji.name}:${i.emoji.id}>`} ` : ''}<@&${i.roleId}>${i.description ? ` - ${i.description}` : ''}`);
  const hint = tr(`menu.hint.${menu.mode}`);
  const embed = ctx.embeds.base({
    title: menu.title || menu.name,
    description: [menu.description, lines.join('\n'), hint].filter(Boolean).join('\n\n'),
    footer: menu.requiredRoleId ? tr('menu.requires', { role: guild.roles.cache.get(menu.requiredRoleId)?.name || '?' }) : undefined
  });
  const rows = [];
  if (menu.type === 'buttons') {
    for (let i = 0; i < menu.items.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(menu.items.slice(i, i + 5).map((item) => {
        const b = new ButtonBuilder().setCustomId(`rmenu:b:${menu.id}:${item.roleId}`).setStyle(STYLES[item.style] || ButtonStyle.Secondary)
          .setLabel((item.label || guild.roles.cache.get(item.roleId)?.name || '?').slice(0, 80));
        if (item.emoji) b.setEmoji(item.emoji);
        return b;
      })));
    }
  } else if (menu.items.length) {
    const max = menu.mode === 'unique' ? 1 : Math.min(menu.maxValues || menu.items.length, menu.items.length);
    const select = new StringSelectMenuBuilder().setCustomId(`rmenu:s:${menu.id}`).setPlaceholder(tr('menu.placeholder'))
      .setMinValues(1).setMaxValues(max)
      .addOptions(menu.items.map((item) => {
        const opt = { label: (item.label || guild.roles.cache.get(item.roleId)?.name || '?').slice(0, 100), value: item.roleId };
        if (item.description) opt.description = item.description.slice(0, 100);
        if (item.emoji) opt.emoji = item.emoji;
        return opt;
      }));
    rows.push(new ActionRowBuilder().addComponents(select));
  }
  return { embeds: [embed], components: rows };
}

/**
 * Edits every posted copy of a menu after a change; forgets copies that were deleted.
 * @returns {Promise<number>} Number of messages updated.
 */
async function refreshPosts(ctx, guild, menu) {
  let updated = 0;
  const kept = [];
  for (const post of menu.posts) {
    const channel = guild.channels.cache.get(post.channelId);
    const message = channel?.isTextBased() ? await channel.messages.fetch(post.messageId).catch(() => null) : null;
    if (!message) continue;
    kept.push(post);
    if (await message.edit(buildMessage(ctx, guild, menu)).then(() => true).catch(() => false)) updated++;
  }
  if (kept.length !== menu.posts.length) {
    menu.posts = kept;
    save(ctx.store, guild.id, menu);
  }
  return updated;
}

/**
 * Handles a click on a menu button or select ("rmenu:b:<menu>:<role>" / "rmenu:s:<menu>").
 * @param {import('discord.js').ButtonInteraction|import('discord.js').StringSelectMenuInteraction} interaction
 * @param {object} ctx
 */
async function handleClick(interaction, ctx) {
  if (!interaction.inGuild()) return null;
  const [, kind, menuId, roleId] = interaction.customId.split(':');
  const menu = all(ctx.store, interaction.guildId)[menuId];
  if (!menu) return fail(interaction, ctx, 'errors.menuGone');
  const member = interaction.member;
  if (menu.requiredRoleId && !member.roles.cache.has(menu.requiredRoleId)) {
    return fail(interaction, ctx, 'errors.requiredRole', { role: `<@&${menu.requiredRoleId}>` });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { add, remove } = computeChanges(menu, [...member.roles.cache.keys()], kind === 'b' ? roleId : interaction.values);
  const me = interaction.guild.members.me;
  // Roles deleted or moved above the bot since the menu was made are skipped, not fatal.
  const usable = (id) => {
    const role = interaction.guild.roles.cache.get(id);
    return role && !role.managed && role.position < me.roles.highest.position;
  };
  const skipped = [...add, ...remove].filter((id) => !usable(id));
  const toAdd = add.filter(usable);
  const toRemove = remove.filter(usable);
  try {
    if (toRemove.length) await member.roles.remove(toRemove, ctx.t(interaction.guild, `${NS}:menu.auditReason`, { menu: menu.name }));
    if (toAdd.length) await member.roles.add(toAdd, ctx.t(interaction.guild, `${NS}:menu.auditReason`, { menu: menu.name }));
  } catch (err) {
    if (err?.code === 50013) return fail(interaction, ctx, 'errors.discordPermission');
    throw err;
  }
  // Re-rendering the message clears the picked options, so the same role can be picked again to flip it back.
  if (kind === 's') interaction.message?.edit(buildMessage(ctx, interaction.guild, menu)).catch(() => {});
  const tr = (k, v) => ctx.t(interaction, `${NS}:${k}`, v);
  const lines = [];
  if (toAdd.length) lines.push(tr('menu.added', { roles: toAdd.map((id) => `<@&${id}>`).join(', ') }));
  if (toRemove.length) lines.push(tr('menu.removed', { roles: toRemove.map((id) => `<@&${id}>`).join(', ') }));
  if (skipped.length) lines.push(tr('menu.skipped', { roles: skipped.map((id) => `<@&${id}>`).join(', ') }));
  if (!lines.length) lines.push(tr('menu.nothing'));
  if ((toAdd.length || toRemove.length) && getConfig(ctx.store, interaction.guildId).logChanges) {
    await ctx.modlog.send(interaction.guild, 'members', ctx.embeds.info(ctx.t(interaction.guild, `${NS}:log.menuTitle`),
      ctx.t(interaction.guild, `${NS}:log.menu`, { user: `<@${member.id}>`, menu: menu.name, added: toAdd.map((id) => `<@&${id}>`).join(', ') || '-', removed: toRemove.map((id) => `<@&${id}>`).join(', ') || '-' })));
  }
  return respond(interaction, ctx.embeds.success(tr('menu.updatedTitle'), lines.join('\n')));
}

module.exports = { MAX_ITEMS, MAX_MENUS, MAX_POSTS, STYLES, all, save, findMenu, createMenu, computeChanges, parseEmoji, buildMessage, refreshPosts, handleClick };
