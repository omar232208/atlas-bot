'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const NS = 'tickets';

/** Defaults of every setting stored under "tickets.config" (shared with the dashboard schema). */
const DEFAULTS = Object.freeze({
  staffRoleIds: [],
  logChannelId: null,
  parentId: null,
  maxOpen: 1,
  ratings: false,
  dmTranscript: true,
  askReason: false,
  ownerCanClose: true,
  nameFormat: 'ticket-{number}',
  welcomeMessage: ''
});

/**
 * Reads the ticket configuration of a guild merged with defaults.
 * @param {object} store
 * @param {string} guildId
 * @returns {typeof DEFAULTS}
 */
function getConfig(store, guildId) {
  return { ...DEFAULTS, ...store.guild(guildId).get('tickets.config', {}) };
}

/**
 * Builds a valid Discord channel name from the configured format.
 * Discord lowercases text channel names and forbids spaces, so the result is
 * normalised here to keep the stored name equal to the real one.
 * @param {string} format e.g. "ticket-{number}" or "{category}-{user}"
 * @param {{number: number, user: string, category?: string}} vars
 * @returns {string}
 */
function formatChannelName(format, vars) {
  const filled = String(format || DEFAULTS.nameFormat)
    .replace(/\{number\}/g, String(vars.number).padStart(4, '0'))
    .replace(/\{user\}/g, vars.user || 'user')
    .replace(/\{category\}/g, vars.category || 'ticket');
  const clean = filled
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
  return clean || `ticket-${vars.number}`;
}

/**
 * Counts the tickets a user currently has open.
 * @param {Record<string, {ownerId: string, status: string}>} tickets
 * @param {string} userId
 */
function countOpen(tickets, userId) {
  return Object.values(tickets || {}).filter((tk) => tk.ownerId === userId && tk.status === 'open').length;
}

/**
 * Staff = Manage Channels permission, or one of the global or category staff roles.
 * @param {import('discord.js').GuildMember} member
 * @param {typeof DEFAULTS} config
 * @param {{staffRoleId?: string}|null} [category]
 */
function isStaff(member, config, category) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.ManageChannels)) return true;
  const roles = [...(config.staffRoleIds || []), ...(category?.staffRoleId ? [category.staffRoleId] : [])];
  return roles.some((id) => member.roles?.cache?.has(id));
}

/**
 * Replies (or edits the deferred reply) with an embed, ephemeral by default.
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').EmbedBuilder} embed
 * @param {object} [extra]
 */
async function respond(interaction, embed, extra = {}) {
  const payload = { embeds: [embed], components: [], ...extra };
  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch {
    return null;
  }
}

/**
 * Sends a localized error embed.
 * @param {import('discord.js').Interaction} interaction
 * @param {object} ctx
 * @param {string} key Key inside the tickets namespace.
 * @param {object} [vars]
 */
function fail(interaction, ctx, key, vars) {
  return respond(interaction, ctx.embeds.error(ctx.t(interaction, `${NS}:errors.title`), ctx.t(interaction, `${NS}:${key}`, vars)));
}

/**
 * Turns a Discord API error into a clear message: missing permission / access
 * are the usual causes when a server owner moved the bot role down.
 * @param {import('discord.js').Interaction} interaction
 * @param {object} ctx
 * @param {Error & {code?: number}} err
 */
function apiFail(interaction, ctx, err) {
  if (err?.code === 50013 || err?.code === 50001) return fail(interaction, ctx, 'errors.discordPermission');
  ctx.logger.error('tickets:', err);
  return fail(interaction, ctx, 'errors.unexpected');
}

/**
 * Answers with the list of permissions the bot lacks, or returns false when none are missing.
 * @returns {Promise<boolean>} true when something is missing (and the user was told).
 */
async function checkBotPerms(interaction, ctx, perms, channel) {
  const missing = ctx.permissions.botMissing(interaction.guild, perms, channel);
  if (!missing.length) return false;
  await fail(interaction, ctx, 'errors.botMissing', { perms: missing.join(', ') });
  return true;
}

module.exports = { NS, DEFAULTS, getConfig, formatChannelName, countOpen, isStaff, respond, fail, apiFail, checkBotPerms };
