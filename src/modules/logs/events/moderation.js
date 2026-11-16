'use strict';

const { Events, AuditLogEvent } = require('discord.js');
const { fetchExecutor } = require('../../../core/audit');
const { isEnabled } = require('../lib/config');
const { userLabel } = require('../lib/format');

/**
 * Logs a ban or unban done outside the bot (Discord client, another bot).
 * Actions made through this bot are skipped: the moderation module already logs
 * them as numbered cases, so logging twice would only add noise.
 */
async function logBan(ctx, ban, unban) {
  const g = ban.guild;
  if (!isEnabled(ctx.store, g.id, 'moderation')) return;
  const { t } = ctx;
  const found = await fetchExecutor(g, unban ? AuditLogEvent.MemberBanRemove : AuditLogEvent.MemberBanAdd, ban.user.id, { retries: 2, delayMs: 700 });
  if (found?.executor.id === g.client.user.id) return;
  const fields = [{ name: t(g, 'logs:events.moderation.target'), value: userLabel(ban.user) }];
  if (found) fields.push({ name: t(g, 'logs:events.moderation.by'), value: userLabel(found.executor) });
  const reason = found?.entry.reason || ban.reason;
  if (!unban) fields.push({ name: t(g, 'logs:events.moderation.reason'), value: reason || t(g, 'logs:events.noReason') });
  const embed = ctx.embeds.base({ title: t(g, unban ? 'logs:events.moderation.unban' : 'logs:events.moderation.ban'), fields });
  if (ban.user.displayAvatarURL) embed.setThumbnail(ban.user.displayAvatarURL());
  await ctx.modlog.send(g, 'moderation', embed);
}

module.exports = [
  { event: Events.GuildBanAdd, execute: (ctx, ban) => logBan(ctx, ban, false) },
  { event: Events.GuildBanRemove, execute: (ctx, ban) => logBan(ctx, ban, true) }
];
