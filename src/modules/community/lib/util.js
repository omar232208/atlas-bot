'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const i18n = require('../../../core/i18n');

const NS = 'community';

/**
 * English text of a locale key, used for builder defaults. The registry then
 * replaces it with the localized versions, so the locale file stays the only source.
 * @param {string} key Key inside the community namespace, e.g. "commands.afk.description".
 */
const en = (key) => i18n.t('en', `${NS}:${key}`).slice(0, 100);

/**
 * Sends (or edits, when already answered) an interaction reply with embeds.
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {import('discord.js').EmbedBuilder|import('discord.js').EmbedBuilder[]} embed
 * @param {{ephemeral?: boolean, components?: any[]}} [opts]
 */
async function respond(interaction, embed, opts = {}) {
  const payload = { embeds: Array.isArray(embed) ? embed : [embed], components: opts.components || [], allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) {
    if (interaction.deferred && !interaction.replied) return interaction.editReply(payload);
    return interaction.followUp({ ...payload, flags: opts.ephemeral ? MessageFlags.Ephemeral : undefined });
  }
  return interaction.reply({ ...payload, flags: opts.ephemeral ? MessageFlags.Ephemeral : undefined });
}

/**
 * Replies with a localized error embed (ephemeral).
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {object} ctx
 * @param {string} key Key inside the community namespace.
 * @param {object} [vars]
 */
function fail(interaction, ctx, key, vars) {
  return respond(interaction, ctx.embeds.error(ctx.t(interaction, `${NS}:errors.title`), ctx.t(interaction, `${NS}:${key}`, vars)), { ephemeral: true });
}

/**
 * Replies with a localized success embed.
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {object} ctx
 * @param {string} titleKey
 * @param {string} [descKey]
 * @param {object} [vars]
 * @param {{ephemeral?: boolean}} [opts]
 */
function ok(interaction, ctx, titleKey, descKey, vars, opts = { ephemeral: true }) {
  return respond(interaction, ctx.embeds.success(ctx.t(interaction, `${NS}:${titleKey}`, vars), descKey ? ctx.t(interaction, `${NS}:${descKey}`, vars) : undefined), opts);
}

/**
 * Checks the bot permissions before an action and explains what is missing.
 * @returns {Promise<boolean>} true when everything is granted.
 */
async function ensureBotPerms(interaction, ctx, perms, channel) {
  const missing = ctx.permissions.botMissing(interaction.guild, perms, channel);
  if (!missing.length) return true;
  await fail(interaction, ctx, 'errors.botMissing', { perms: missing.map((p) => `\`${p}\``).join(', '), channel: channel ? `<#${channel.id}>` : '-' });
  return false;
}

/**
 * True when the member has the Discord permission (Administrator included).
 * @param {import('discord.js').BaseInteraction} interaction
 * @param {bigint} perm
 */
const memberCan = (interaction, perm) => !!interaction.memberPermissions?.has(perm);

/**
 * Staff check used by subcommands open to everyone except their config part.
 * Replies with an error and returns false when the member lacks the permission.
 */
async function requireMember(interaction, ctx, perm = PermissionFlagsBits.ManageGuild) {
  if (memberCan(interaction, perm)) return true;
  const name = Object.keys(PermissionFlagsBits).find((k) => PermissionFlagsBits[k] === perm) || 'ManageGuild';
  await fail(interaction, ctx, 'errors.memberMissing', { perms: `\`${name}\`` });
  return false;
}

/**
 * Turns a Discord API error into a localized reply. Permission and access errors
 * are expected (server admins change roles) so they are explained, not logged as bugs.
 */
async function apiError(interaction, ctx, err) {
  if (err?.code === 50013 || err?.code === 50001) return fail(interaction, ctx, 'errors.apiPermission').catch(() => {});
  if (err?.code === 10003 || err?.code === 10008) return fail(interaction, ctx, 'errors.notFound').catch(() => {});
  ctx.logger.error('[community]', err);
  return fail(interaction, ctx, 'errors.unexpected').catch(() => {});
}

/**
 * Replaces {placeholders} in user-written templates. Unknown ones are kept.
 * @param {string} text
 * @param {Record<string, string|number>} vars
 */
const fill = (text, vars) => String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));

/**
 * Cuts a string to `max` characters with an ellipsis.
 * @param {string} text
 * @param {number} max
 */
const clip = (text, max) => {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
};

const chains = new Map();
/**
 * Runs async tasks one after another per key. Reaction and voice events arrive
 * in bursts; serialising per message/channel prevents duplicate posts or channels.
 * @param {string} key
 * @param {() => Promise<any>} fn
 */
function serial(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tail = next.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return next;
}

/**
 * Template variables common to tags, auto-responses and announcements.
 * @param {import('discord.js').GuildMember|import('discord.js').User} who
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Channel} [channel]
 */
function memberVars(who, guild, channel) {
  const user = who?.user || who;
  return {
    user: user ? `<@${user.id}>` : '',
    username: user?.username || '',
    displayname: who?.displayName || user?.globalName || user?.username || '',
    server: guild?.name || '',
    membercount: guild?.memberCount ?? 0,
    channel: channel ? `<#${channel.id}>` : ''
  };
}

module.exports = { NS, en, respond, fail, ok, ensureBotPerms, memberCan, requireMember, apiError, fill, clip, serial, memberVars };
