'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { createCooldowns } = require('../../../core/cooldown');
const { setting, COLLECTIONS } = require('./config');
const { NS, clip } = require('./util');

const TAG = '[AFK] ';
const MAX_PINGS = 10;
const NOTICE_COOLDOWN = 60000;
const notices = createCooldowns();

const afkPath = (userId) => [...COLLECTIONS.afk.split('.'), userId];

/**
 * Adds the AFK tag to a nickname, keeping Discord's 32-character limit.
 * @param {string} name
 */
const tagName = (name) => (String(name).startsWith(TAG) ? String(name) : `${TAG}${name}`.slice(0, 32));

/**
 * Removes the AFK tag from a nickname.
 * @param {string} name
 */
const untagName = (name) => (String(name).startsWith(TAG) ? String(name).slice(TAG.length) : String(name));

/**
 * IDs of AFK users addressed by a message (mentions and reply target), without the author.
 * @param {string[]} mentionedIds
 * @param {Record<string, object>} afkUsers
 * @param {string} authorId
 */
function addressedAfk(mentionedIds, afkUsers, authorId) {
  return [...new Set(mentionedIds)].filter((id) => id !== authorId && afkUsers?.[id]);
}

/**
 * Sets a member AFK and, when allowed, prefixes their nickname.
 * @param {object} ctx
 * @param {import('discord.js').GuildMember} member
 * @param {string|null} reason
 * @returns {Promise<boolean>} whether the nickname was changed.
 */
async function setAfk(ctx, member, reason) {
  const g = ctx.store.guild(member.guild.id);
  let nick = false;
  // The owner and members above the bot cannot be renamed: AFK still works without the tag.
  if (setting(g, 'community.afk.nickname') && member.manageable && ctx.permissions.botCan(member.guild, PermissionFlagsBits.ManageNicknames)) {
    nick = await member.setNickname(tagName(member.displayName), 'AFK').then(() => true).catch(() => false);
  }
  g.set(afkPath(member.id), { reason: reason || null, since: Date.now(), nick, pings: [] });
  return nick;
}

/**
 * Clears AFK, restoring the nickname if we changed it.
 * @param {object} ctx
 * @param {import('discord.js').GuildMember} member
 * @returns {object|null} the previous AFK entry.
 */
async function clearAfk(ctx, member) {
  const g = ctx.store.guild(member.guild.id);
  const entry = g.get(afkPath(member.id), null);
  if (!entry) return null;
  g.delete(afkPath(member.id));
  if (entry.nick && member.manageable && member.nickname?.startsWith(TAG)) {
    const restored = untagName(member.nickname);
    await member.setNickname(restored === member.user.username ? null : restored, 'AFK').catch(() => {});
  }
  return entry;
}

/**
 * Message hook: welcomes back an AFK author and tells others who they pinged is away.
 * @param {object} ctx
 * @param {import('discord.js').Message} message
 */
async function onMessage(ctx, message) {
  const g = ctx.store.guild(message.guildId);
  if (!setting(g, 'community.afk.enabled')) return;
  const afkUsers = g.get(COLLECTIONS.afk, {});
  if (!Object.keys(afkUsers).length) return;
  const canSend = ctx.permissions.botCan(message.guild, PermissionFlagsBits.SendMessages, message.channel);

  if (afkUsers[message.author.id] && message.member) {
    const entry = await clearAfk(ctx, message.member);
    if (entry && canSend) {
      const pings = (entry.pings || []).map((p) => ctx.t(message.guild, `${NS}:afk.pingLine`, { user: `<@${p.by}>`, url: p.url, time: `<t:${Math.floor(p.at / 1000)}:R>` }));
      const desc = ctx.t(message.guild, `${NS}:afk.backDesc`, { since: `<t:${Math.floor(entry.since / 1000)}:R>`, count: entry.pings?.length || 0 });
      const embed = ctx.embeds.info(ctx.t(message.guild, `${NS}:afk.backTitle`, { user: message.member.displayName }), pings.length ? `${desc}\n\n${pings.join('\n')}` : desc);
      const sent = await message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
      // The welcome back is only useful for a moment; do not clutter the channel.
      if (sent) setTimeout(() => sent.delete().catch(() => {}), 15000).unref?.();
    }
  }

  const mentioned = [...message.mentions.users.keys()];
  if (message.mentions.repliedUser) mentioned.push(message.mentions.repliedUser.id);
  const targets = addressedAfk(mentioned, afkUsers, message.author.id);
  if (!targets.length) return;
  const lines = [];
  for (const id of targets) {
    const entry = afkUsers[id];
    // Pings are remembered so the member can catch up when back.
    const pings = [...(entry.pings || []), { by: message.author.id, url: message.url, at: Date.now() }].slice(-MAX_PINGS);
    g.set(afkPath(id), { ...entry, pings });
    if (notices.hit(`${message.channelId}:${id}`, NOTICE_COOLDOWN) > 0) continue;
    lines.push(ctx.t(message.guild, `${NS}:afk.${entry.reason ? 'isAfkReason' : 'isAfk'}`, {
      user: `<@${id}>`, since: `<t:${Math.floor(entry.since / 1000)}:R>`, reason: clip(entry.reason || '', 200)
    }));
  }
  if (lines.length && canSend) {
    await message.reply({ embeds: [ctx.embeds.info(ctx.t(message.guild, `${NS}:afk.noticeTitle`), lines.join('\n'))], allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  }
}

module.exports = { TAG, tagName, untagName, addressedAfk, setAfk, clearAfk, onMessage, afkPath };
