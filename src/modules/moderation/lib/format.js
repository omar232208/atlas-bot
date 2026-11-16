'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const duration = require('../../../core/duration');

const ts = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;

/**
 * Name of a permission flag in the guild language (falls back to the flag name).
 * @param {Function} t
 * @param {*} lang
 * @param {string} flag e.g. "BanMembers"
 */
function permName(t, lang, flag) {
  const key = `moderation:perms.${flag}`;
  const text = t(lang, key);
  return text === key ? flag : text;
}

/**
 * Embed describing a case, used in replies and in the moderation log.
 * @param {object} ctx
 * @param {*} lang Language target (guild or interaction).
 * @param {object} c Case.
 */
function caseEmbed(ctx, lang, c) {
  const { t, embeds } = ctx;
  const fields = [
    { name: t(lang, 'moderation:case.user'), value: `<@${c.userId}> (${c.userTag} · ${c.userId})`, inline: true },
    { name: t(lang, 'moderation:case.moderator'), value: `<@${c.moderatorId}>${c.auto ? ` · ${t(lang, 'moderation:case.automatic')}` : ''}`, inline: true },
    { name: t(lang, 'moderation:case.reason'), value: c.reason || t(lang, 'moderation:case.noReason') }
  ];
  if (c.duration) fields.push({ name: t(lang, 'moderation:case.duration'), value: duration.format(c.duration, lang), inline: true });
  if (c.expiresAt) fields.push({ name: t(lang, 'moderation:case.expires'), value: `${ts(c.expiresAt, 'f')} (${ts(c.expiresAt)})`, inline: true });
  if (c.type === 'warn') fields.push({ name: t(lang, 'moderation:case.status'), value: t(lang, c.active === false ? 'moderation:case.removed' : 'moderation:case.active'), inline: true });
  if (c.editedAt) fields.push({ name: t(lang, 'moderation:case.edited'), value: `${ts(c.editedAt)} · <@${c.editedBy}>`, inline: true });
  return embeds.base({
    title: t(lang, 'moderation:case.title', { id: c.id, type: t(lang, `moderation:types.${c.type}`) }),
    fields,
    footer: `${t(lang, 'moderation:case.created')} ${new Date(c.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`
  });
}

/**
 * One line summarising a case for lists (/history, /warnings).
 * @param {Function} t
 * @param {*} lang
 * @param {object} c
 */
function caseLine(t, lang, c) {
  const reason = (c.reason || t(lang, 'moderation:case.noReason')).slice(0, 80);
  const struck = c.type === 'warn' && c.active === false;
  const text = `**#${c.id}** ${t(lang, `moderation:types.${c.type}`)} · ${ts(c.createdAt)} · ${reason}`;
  return struck ? `~~${text}~~` : text;
}

/**
 * Replies (or edits the deferred reply) with an embed.
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {import('discord.js').EmbedBuilder} embed
 * @param {boolean} [ephemeral]
 */
async function respond(interaction, embed, ephemeral = false) {
  const payload = { embeds: [embed], components: [] };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply({ ...payload, flags: ephemeral ? MessageFlags.Ephemeral : undefined });
}

/**
 * Replies with an error embed (ephemeral when possible).
 * @param {object} ctx
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {string} key moderation:errors.* key
 * @param {object} [vars]
 */
function fail(ctx, interaction, key, vars) {
  return respond(interaction, ctx.embeds.error(ctx.t(interaction, 'moderation:errors.title'), ctx.t(interaction, key, vars)), true).catch(() => {});
}

/**
 * Turns a Discord API error into a clear localized reply. Permission errors
 * name the permission the bot needs, which is what admins usually miss.
 * @param {object} ctx
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {Error & {code?: number}} err
 * @param {string} [flag] Permission flag name needed by the failed call.
 */
function explainError(ctx, interaction, err, flag) {
  if (err?.code === 50013 || err?.code === 50001) {
    return fail(ctx, interaction, 'moderation:errors.botMissing', { perm: permName(ctx.t, interaction, flag || 'Administrator') });
  }
  if (err?.code === 10007 || err?.code === 10013) return fail(ctx, interaction, 'moderation:errors.unknownUser');
  if (err?.code === 10026) return fail(ctx, interaction, 'moderation:errors.notBanned');
  ctx.logger.error('moderation command failed:', err);
  return fail(ctx, interaction, 'moderation:errors.unexpected', { message: String(err?.message || err).slice(0, 200) });
}

/**
 * Checks everything that would make a sanction on `member` fail or be abusive.
 * @param {object} ctx
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {import('discord.js').GuildMember|null} member Target (null when not in the guild).
 * @param {string|null} flag Permission the bot needs, e.g. "BanMembers" (null: none).
 * @returns {{key: string, vars?: object}|null} Error to show, or null when allowed.
 */
function checkTarget(ctx, interaction, member, flag) {
  const { guild } = interaction;
  if (flag && !ctx.permissions.botCan(guild, PermissionFlagsBits[flag])) return { key: 'moderation:errors.botMissing', vars: { perm: permName(ctx.t, interaction, flag) } };
  if (!member) return null;
  if (member.id === interaction.user.id) return { key: 'moderation:errors.self' };
  if (member.id === ctx.client.user.id) return { key: 'moderation:errors.selfBot' };
  if (member.id === guild.ownerId) return { key: 'moderation:errors.owner' };
  if (!ctx.permissions.canModerate(interaction.member, member)) return { key: 'moderation:errors.hierarchyUser' };
  if (!ctx.permissions.canModerate(guild.members.me, member)) return { key: 'moderation:errors.hierarchyBot' };
  return null;
}

/**
 * Fetches a member of the guild, or null when the user is not on the server.
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 */
async function fetchMember(guild, userId) {
  return guild.members.cache.get(userId) || guild.members.fetch(userId).catch(() => null);
}

module.exports = { caseEmbed, caseLine, respond, fail, explainError, checkTarget, fetchMember, permName, ts };
