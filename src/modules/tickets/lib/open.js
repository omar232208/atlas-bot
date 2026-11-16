'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ChannelType, PermissionFlagsBits, MessageFlags
} = require('discord.js');
const { NS, getConfig, formatChannelName, countOpen, respond, fail, apiFail, checkBotPerms } = require('./util');

/** Permissions given to everyone who belongs in a ticket (owner, added users, staff). */
const MEMBER_ALLOW = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks
];

/**
 * Lists the configured categories of a guild.
 * @returns {Array<{id: string, name: string, description?: string, emoji?: string, parentId?: string, staffRoleId?: string}>}
 */
function getCategories(store, guildId) {
  return store.guild(guildId).get('tickets.categories', []);
}

/**
 * Builds the panel message: one button when there is no category, a select menu otherwise.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @param {{title?: string, description?: string}} [text]
 */
function buildPanel(ctx, guild, text = {}) {
  const tr = (k, v) => ctx.t(guild, `${NS}:${k}`, v);
  const categories = getCategories(ctx.store, guild.id);
  const embed = ctx.embeds.base({
    title: text.title || tr('panel.defaultTitle'),
    description: text.description || tr('panel.defaultDescription'),
    footer: guild.name
  });
  let row;
  if (!categories.length) {
    row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tkt:open').setStyle(ButtonStyle.Primary).setLabel(tr('panel.button'))
    );
  } else {
    const menu = new StringSelectMenuBuilder().setCustomId('tkt:cat').setPlaceholder(tr('panel.select')).setMinValues(1).setMaxValues(1)
      .addOptions(categories.slice(0, 25).map((c) => {
        const opt = { label: c.name.slice(0, 100), value: c.id };
        if (c.description) opt.description = c.description.slice(0, 100);
        if (c.emoji) opt.emoji = c.emoji;
        return opt;
      }));
    row = new ActionRowBuilder().addComponents(menu);
  }
  return { embeds: [embed], components: [row] };
}

/**
 * Shows the "why are you opening a ticket?" modal.
 * @param {import('discord.js').MessageComponentInteraction} interaction
 * @param {object} ctx
 * @param {string} categoryId "none" when the panel has no categories.
 */
function showReasonModal(interaction, ctx, categoryId) {
  const modal = new ModalBuilder().setCustomId(`tkt:modal:${categoryId}`).setTitle(ctx.t(interaction, `${NS}:modal.title`).slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('reason').setLabel(ctx.t(interaction, `${NS}:modal.label`).slice(0, 45))
        .setPlaceholder(ctx.t(interaction, `${NS}:modal.placeholder`).slice(0, 100))
        .setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(3).setMaxLength(1000)
    ));
  return interaction.showModal(modal);
}

/**
 * Entry point from the panel: asks for a reason when configured, otherwise opens directly.
 */
async function startOpen(interaction, ctx, categoryId) {
  const config = getConfig(ctx.store, interaction.guildId);
  if (config.askReason) return showReasonModal(interaction, ctx, categoryId);
  return openTicket(interaction, ctx, categoryId, null);
}

/**
 * Creates the private ticket channel for the interaction user.
 * @param {import('discord.js').Interaction} interaction
 * @param {object} ctx
 * @param {string} categoryId Category id or "none".
 * @param {string|null} reason
 */
async function openTicket(interaction, ctx, categoryId, reason) {
  const { guild, user } = interaction;
  const gstore = ctx.store.guild(guild.id);
  const config = getConfig(ctx.store, guild.id);
  const category = getCategories(ctx.store, guild.id).find((c) => c.id === categoryId) || null;
  if (categoryId !== 'none' && !category) return fail(interaction, ctx, 'errors.categoryGone');

  const open = gstore.get('tickets.list', {});
  // Drop records whose channel vanished while the bot was offline, so they do not block the user.
  for (const channelId of Object.keys(open)) if (!guild.channels.cache.has(channelId)) gstore.delete(`tickets.list.${channelId}`);
  const current = Object.entries(gstore.get('tickets.list', {})).filter(([, tk]) => tk.ownerId === user.id && tk.status === 'open');
  if (countOpen(gstore.get('tickets.list', {}), user.id) >= config.maxOpen) {
    return fail(interaction, ctx, 'errors.tooMany', { max: config.maxOpen, channels: current.map(([id]) => `<#${id}>`).join(', ') });
  }
  if (await checkBotPerms(interaction, ctx, [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return null;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const number = gstore.update('tickets.counter', (n) => (n || 0) + 1, 0);
  const staffRoles = [...new Set([...(config.staffRoleIds || []), ...(category?.staffRoleId ? [category.staffRoleId] : [])])]
    .filter((id) => guild.roles.cache.has(id));
  const parentId = [category?.parentId, config.parentId].find((id) => id && guild.channels.cache.get(id)?.type === ChannelType.GuildCategory) || null;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: guild.members.me.id, allow: [...MEMBER_ALLOW, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
    { id: user.id, allow: MEMBER_ALLOW },
    ...staffRoles.map((id) => ({ id, allow: [...MEMBER_ALLOW, PermissionFlagsBits.ManageMessages] }))
  ];

  let channel;
  try {
    channel = await guild.channels.create({
      name: formatChannelName(config.nameFormat, { number, user: user.username, category: category?.name }),
      type: ChannelType.GuildText,
      parent: parentId,
      permissionOverwrites: overwrites,
      topic: ctx.t(guild, `${NS}:channel.topic`, { user: user.tag, id: user.id, number }).slice(0, 1024),
      reason: ctx.t(guild, `${NS}:channel.auditReason`, { user: user.tag })
    });
  } catch (err) {
    return apiFail(interaction, ctx, err);
  }

  const record = { number, ownerId: user.id, categoryId: category?.id || null, claimedBy: null, createdAt: Date.now(), status: 'open', reason: reason || null, members: [] };
  gstore.set(`tickets.list.${channel.id}`, record);
  gstore.update('tickets.stats.opened', (n) => (n || 0) + 1, 0);

  const tr = (k, v) => ctx.t(guild, `${NS}:${k}`, v);
  const fields = [{ name: tr('welcome.owner'), value: `<@${user.id}>`, inline: true }];
  if (category) fields.push({ name: tr('welcome.category'), value: category.name, inline: true });
  if (reason) fields.push({ name: tr('welcome.reason'), value: reason });
  const embed = ctx.embeds.base({
    title: tr('welcome.title', { number }),
    description: config.welcomeMessage ? config.welcomeMessage.replace(/\{user\}/g, `<@${user.id}>`) : tr('welcome.description'),
    fields,
    timestamp: true
  });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tkt:close').setStyle(ButtonStyle.Danger).setLabel(tr('buttons.close')),
    new ButtonBuilder().setCustomId('tkt:claim').setStyle(ButtonStyle.Secondary).setLabel(tr('buttons.claim'))
  );
  try {
    // Mentions go in the content because embeds never notify anyone.
    await channel.send({
      content: [`<@${user.id}>`, ...staffRoles.map((id) => `<@&${id}>`)].join(' '),
      embeds: [embed],
      components: [row],
      allowedMentions: { users: [user.id], roles: staffRoles }
    });
  } catch (err) {
    ctx.logger.warn('tickets: welcome message failed:', err.message);
  }

  await ctx.modlog.send(guild, 'tickets', ctx.embeds.info(tr('log.openedTitle'), tr('log.opened', { user: `<@${user.id}>`, channel: `<#${channel.id}>`, number })));
  return respond(interaction, ctx.embeds.success(tr('open.title'), tr('open.done', { channel: `<#${channel.id}>` })));
}

module.exports = { buildPanel, startOpen, openTicket, showReasonModal, getCategories, MEMBER_ALLOW };
