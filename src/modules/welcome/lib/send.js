'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { setting, SETTINGS } = require('./config');
const { render, memberVars, mentionsUser } = require('./template');

const PREFIX = { welcome: 'welcome', goodbye: 'goodbye' };

/**
 * Builds the message for a welcome / goodbye / DM template. An empty stored
 * template uses the localized default, so a fresh setup works out of the box.
 * @param {object} ctx
 * @param {import('discord.js').GuildMember} member
 * @param {'welcome'|'goodbye'|'dm'} kind
 * @param {{count?: number}} [opts]
 */
function buildPayload(ctx, member, kind, opts = {}) {
  const g = ctx.store.guild(member.guild.id);
  const stored = kind === 'dm' ? setting(g, 'welcome.dmMessage') : setting(g, `${PREFIX[kind]}.message`);
  const template = stored || ctx.t(member.guild, `welcome:defaults.${kind}`);
  const text = render(template, memberVars(member, opts.count));
  const useEmbed = kind === 'dm' ? true : setting(g, `${PREFIX[kind]}.embed`);
  if (!useEmbed) return { content: text.slice(0, 2000), allowedMentions: { users: [member.id] } };
  const embed = ctx.embeds.base({ description: text }).setThumbnail(member.user.displayAvatarURL());
  if (kind === 'dm') embed.setFooter({ text: member.guild.name });
  // Mentions inside an embed never ping, so the mention goes in the content
  // (restricted to the member) when the template asks for {user}.
  const ping = kind === 'welcome' && mentionsUser(template);
  return { content: ping ? `<@${member.id}>` : undefined, embeds: [embed], allowedMentions: { users: ping ? [member.id] : [] } };
}

/**
 * Checks that the bot can post in a channel; returns the missing flag names.
 * @param {import('discord.js').GuildChannel} channel
 * @param {boolean} embed
 */
function missingIn(channel, embed) {
  const me = channel.guild.members.me;
  const perms = me && channel.permissionsFor(me);
  const needed = { ViewChannel: PermissionFlagsBits.ViewChannel, SendMessages: PermissionFlagsBits.SendMessages };
  if (embed) needed.EmbedLinks = PermissionFlagsBits.EmbedLinks;
  return Object.entries(needed).filter(([, bit]) => !perms?.has(bit)).map(([name]) => name);
}

/**
 * Sends the welcome or goodbye message to its channel.
 * @param {object} ctx
 * @param {import('discord.js').GuildMember} member
 * @param {'welcome'|'goodbye'} kind
 * @param {{force?: boolean}} [opts] force: send even when disabled (used by /welcome test).
 * @returns {Promise<{ok: true, channelId: string}|{ok: false, reason: 'disabled'|'noChannel'|'missing', perms?: string[], channelId?: string}>}
 */
async function sendToChannel(ctx, member, kind, opts = {}) {
  const g = ctx.store.guild(member.guild.id);
  if (!opts.force && !setting(g, `${PREFIX[kind]}.enabled`)) return { ok: false, reason: 'disabled' };
  const channelId = setting(g, `${PREFIX[kind]}.channelId`);
  const channel = channelId && member.guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased()) return { ok: false, reason: 'noChannel' };
  const perms = missingIn(channel, setting(g, `${PREFIX[kind]}.embed`));
  if (perms.length) return { ok: false, reason: 'missing', perms, channelId };
  await channel.send(buildPayload(ctx, member, kind));
  return { ok: true, channelId };
}

/**
 * Sends the welcome DM. Members often block DMs from servers, so failure is expected and quiet.
 * @param {object} ctx
 * @param {import('discord.js').GuildMember} member
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<boolean>}
 */
async function sendDm(ctx, member, opts = {}) {
  const g = ctx.store.guild(member.guild.id);
  if (!opts.force && !setting(g, 'welcome.dmEnabled')) return false;
  return member.send(buildPayload(ctx, member, 'dm')).then(() => true, () => false);
}

/**
 * Why the bot cannot give a role, or null when it can.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 * @returns {null|'managed'|'everyone'|'hierarchy'|'noPermission'}
 */
function roleProblem(guild, role) {
  if (role.id === guild.id) return 'everyone';
  if (role.managed) return 'managed';
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return 'noPermission';
  if (role.position >= me.roles.highest.position) return 'hierarchy';
  return null;
}

/**
 * Gives the configured autoroles to a member (humans or bots list). Roles that
 * were deleted or became impossible to give are skipped instead of failing the
 * whole call.
 * @param {object} ctx
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<{added: string[], skipped: string[]}>}
 */
async function applyAutoroles(ctx, member) {
  const g = ctx.store.guild(member.guild.id);
  const ids = setting(g, member.user.bot ? 'autorole.bots' : 'autorole.humans') || SETTINGS['autorole.humans'];
  const added = [];
  const skipped = [];
  for (const id of ids) {
    const role = member.guild.roles.cache.get(id);
    if (!role || roleProblem(member.guild, role) || member.roles.cache.has(id)) skipped.push(id);
    else added.push(id);
  }
  if (added.length) await member.roles.add(added, ctx.t(member.guild, 'welcome:autorole.reason'));
  return { added, skipped };
}

module.exports = { buildPayload, sendToChannel, sendDm, applyAutoroles, roleProblem, missingIn };
