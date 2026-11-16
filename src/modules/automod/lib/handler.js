'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { getConfig, STRIKES } = require('./config');
const { detect, findInvites } = require('./filters');
const { createTracker } = require('./spam');
const { addStrike, stepFor, pickAction } = require('./escalation');
const duration = require('../../../core/duration');

const tracker = createTracker();
// After a sanction the same user is only cleaned up for a few seconds, so a
// burst of 10 spam messages gives one timeout instead of ten.
const COOLDOWN_MS = 5000;
const cooldowns = new Map();
const inviteCache = new Map();
const INVITE_TTL = 10 * 60000;
const NOTICE_MS = 6000;
const RATE_FILTERS = new Set(['spam', 'duplicates', 'attachments']);

/**
 * Lazily loads the moderation module's sanction service: cases, DMs and warn
 * thresholds then work the same for automod and for moderators. Returns null
 * when that module is not installed.
 */
function moderation() {
  try {
    return require('../../moderation/lib/actions');
  } catch {
    return null;
  }
}

/**
 * Invite codes that point to this server (allowed when "allowOwn" is on).
 * Cached because fetching invites is rate limited.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<string[]>}
 */
async function ownInvites(guild) {
  const hit = inviteCache.get(guild.id);
  if (hit && Date.now() - hit.at < INVITE_TTL) return hit.codes;
  const codes = guild.vanityURLCode ? [guild.vanityURLCode.toLowerCase()] : [];
  if (guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (invites) for (const code of invites.keys()) codes.push(code.toLowerCase());
  }
  inviteCache.set(guild.id, { at: Date.now(), codes });
  return codes;
}

/**
 * Channel IDs that exemptions apply to: the channel, its category, and for a
 * thread its parent channel and that channel's category.
 * @param {import('discord.js').GuildTextBasedChannel} channel
 */
function channelScope(channel) {
  const ids = [channel.id, channel.parentId];
  if (channel.isThread?.() && channel.parent) ids.push(channel.parent.parentId);
  return ids.filter(Boolean);
}

/**
 * True when the author is exempt from automod as a whole.
 * @param {object} ctx
 * @param {import('discord.js').Message} message
 * @param {ReturnType<typeof getConfig>} cfg
 */
function isExempt(ctx, message, cfg) {
  const { member, guild } = message;
  if (ctx.permissions.isWhitelisted(guild, message.author.id)) return true;
  if (cfg.ignoreStaff && member?.permissions.any([PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageGuild])) return true;
  if (member && cfg.exemptRoles.some((r) => member.roles.cache.has(r))) return true;
  return channelScope(message.channel).some((id) => cfg.exemptChannels.includes(id));
}

/**
 * Entry point for created and edited messages.
 * @param {object} ctx
 * @param {import('discord.js').Message} message
 * @param {{edited?: boolean}} [opts] Edits skip rate filters: they are not new messages.
 */
async function handleMessage(ctx, message, opts = {}) {
  if (!message.guild || !message.author || message.author.bot || message.webhookId || message.system) return;
  const gs = ctx.store.guild(message.guild.id);
  const cfg = getConfig(gs);
  if (!cfg.enabled || isExempt(ctx, message, cfg)) return;
  const content = message.content || '';
  const key = `${message.guild.id}:${message.author.id}`;
  const stats = opts.edited ? null : tracker.record(key, { messageId: message.id, channelId: message.channel.id, content, attachments: message.attachments.size + message.stickers.size }, {
    spamSeconds: cfg.filters.spam.seconds,
    duplicateSeconds: cfg.filters.duplicates.seconds,
    attachmentSeconds: cfg.filters.attachments.seconds
  });
  // Resolved mentions only count real pings; the replied-to user is excluded.
  const replied = message.mentions.repliedUser;
  const userPings = message.mentions.users.filter((u) => u.id !== message.author.id && !(replied && u.id === replied.id && !content.includes(u.id))).size;
  const input = {
    content,
    mentions: userPings + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0),
    ownInvites: cfg.filters.invites.enabled && cfg.filters.invites.allowOwn && findInvites(content).length ? await ownInvites(message.guild) : []
  };
  const scope = channelScope(message.channel);
  const violation = detect(input, cfg, stats).find(({ filter }) => {
    const f = cfg.filters[filter];
    return !scope.some((id) => f.exemptChannels.includes(id)) && !f.exemptRoles.some((r) => message.member?.roles.cache.has(r));
  });
  if (violation) await punish(ctx, message, violation, cfg, key);
}

/**
 * Deletes the offending message(s), adds a strike, applies the filter action
 * or the escalation step, notifies the channel and logs the violation.
 */
async function punish(ctx, message, violation, cfg, key) {
  const { guild, channel, author } = message;
  const { t } = ctx;
  const f = cfg.filters[violation.filter];
  await deleteOffending(ctx, message, violation, f, key);

  const until = cooldowns.get(key) || 0;
  if (Date.now() < until) return;
  cooldowns.set(key, Date.now() + COOLDOWN_MS);
  if (cooldowns.size > 2000) for (const [k, v] of cooldowns) if (v < Date.now()) cooldowns.delete(k);
  if (RATE_FILTERS.has(violation.filter)) tracker.reset(key);

  const gs = ctx.store.guild(guild.id);
  const strikes = gs.update(`${STRIKES}.${author.id}`, (list) => addStrike(list, cfg.strikeWindow), []).length;
  const step = stepFor(strikes, cfg.escalation);
  const decided = pickAction({ action: f.action, duration: f.duration }, step);
  const reason = `${t(guild, `automod:reasons.${violation.filter}`, violation.detail)} · ${t(guild, 'automod:log.strikesShort', { count: strikes })}`.slice(0, 450);
  const applied = await applyAction(ctx, message, decided, reason);

  if (cfg.notify && channel.isSendable?.()) {
    const text = t(guild, `automod:notice.${applied}`, { user: `<@${author.id}>`, reason: t(guild, `automod:reasons.${violation.filter}`, violation.detail) });
    const notice = await channel.send({ content: `<@${author.id}>`, embeds: [ctx.embeds.warn(t(guild, 'automod:notice.title'), text)], allowedMentions: { users: [author.id] }, _keepEmbeds: true }).catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), NOTICE_MS).unref?.();
  }

  const fields = [
    { name: t(guild, 'automod:log.user'), value: `<@${author.id}> (${author.tag} · ${author.id})`, inline: true },
    { name: t(guild, 'automod:log.channel'), value: `<#${channel.id}>`, inline: true },
    { name: t(guild, 'automod:log.filter'), value: t(guild, `automod:filters.${violation.filter}.name`), inline: true },
    { name: t(guild, 'automod:log.action'), value: t(guild, `automod:actions.${applied}`) + (decided.duration && ['timeout', 'ban'].includes(applied) ? ` (${duration.format(decided.duration, guild)})` : ''), inline: true },
    { name: t(guild, 'automod:log.strikes'), value: `${strikes}${decided.escalated ? ` · ${t(guild, 'automod:log.escalated')}` : ''}`, inline: true },
    { name: t(guild, 'automod:log.reason'), value: t(guild, `automod:reasons.${violation.filter}`, violation.detail) }
  ];
  if (message.content) fields.push({ name: t(guild, 'automod:log.content'), value: `\`\`\`\n${message.content.replace(/```/g, "'''").slice(0, 900)}\n\`\`\`` });
  await ctx.modlog.send(guild, 'moderation', ctx.embeds.base({ title: t(guild, 'automod:log.title'), fields, timestamp: true }), { _keepEmbeds: true });
}

/** Deletes the message, or the user's whole recent burst for rate filters. */
async function deleteOffending(ctx, message, violation, f, key) {
  if (!ctx.permissions.botCan(message.guild, PermissionFlagsBits.ManageMessages, message.channel)) {
    ctx.logger.warn(`automod cannot delete in ${message.guild.id}/${message.channel.id}: missing Manage Messages`);
    return;
  }
  if (!RATE_FILTERS.has(violation.filter)) {
    await message.delete().catch(() => {});
    return;
  }
  const seconds = f.seconds || 30;
  for (const [channelId, ids] of tracker.recentIds(key, seconds)) {
    const target = message.guild.channels.cache.get(channelId);
    if (!target?.bulkDelete) continue;
    if (ids.length === 1) await target.messages.delete(ids[0]).catch(() => {});
    else await target.bulkDelete(ids, true).catch(() => {});
  }
}

/**
 * Applies the decided action. Falls back to "delete" (already done) when the
 * bot cannot act on the member, so automod never throws on hierarchy issues.
 * @returns {Promise<string>} The action really applied.
 */
async function applyAction(ctx, message, decided, reason) {
  const { guild, member, author } = message;
  if (decided.action === 'delete') return 'delete';
  const flag = { warn: null, timeout: PermissionFlagsBits.ModerateMembers, kick: PermissionFlagsBits.KickMembers, ban: PermissionFlagsBits.BanMembers }[decided.action];
  if (flag && !ctx.permissions.botCan(guild, flag)) {
    ctx.logger.warn(`automod ${decided.action} skipped in ${guild.id}: missing permission`);
    return 'delete';
  }
  if (member && decided.action !== 'warn' && !ctx.permissions.canModerate(guild.members.me, member)) return 'delete';
  const durationMs = decided.action === 'timeout' ? decided.duration || 600000 : decided.action === 'ban' ? decided.duration || undefined : undefined;
  const mod = moderation();
  try {
    if (mod) {
      await mod.sanction(ctx, { guild, user: author, member, moderator: ctx.client.user, type: decided.action, reason, durationMs, deleteSeconds: decided.action === 'ban' ? 3600 : 0, auto: true });
    } else if (decided.action === 'timeout') await member.timeout(durationMs, reason);
    else if (decided.action === 'kick') await member.kick(reason);
    else if (decided.action === 'ban') await guild.bans.create(author.id, { reason, deleteMessageSeconds: 3600 });
    return decided.action;
  } catch (err) {
    ctx.logger.warn(`automod ${decided.action} failed in ${guild.id}:`, err.message);
    return 'delete';
  }
}

module.exports = { handleMessage, isExempt, channelScope, ownInvites, tracker };
