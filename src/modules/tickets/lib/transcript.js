'use strict';

const { AttachmentBuilder } = require('discord.js');

// Hard cap so a huge ticket cannot exhaust the 315 MB RAM budget.
const MAX_MESSAGES = 5000;

/**
 * Converts a discord.js Message into the plain shape used by formatTranscript.
 * @param {import('discord.js').Message} m
 */
function toPlain(m) {
  return {
    createdTimestamp: m.createdTimestamp,
    author: { tag: m.author?.tag || m.author?.username || '?', id: m.author?.id || '?', bot: !!m.author?.bot },
    content: m.content || '',
    attachments: [...(m.attachments?.values?.() || [])].map((a) => a.url),
    embeds: (m.embeds || []).map((e) => [e.title, e.description].filter(Boolean).join(' - '))
  };
}

/**
 * Fetches every message of a channel, oldest first, by paging backwards.
 * @param {import('discord.js').TextChannel} channel
 * @returns {Promise<ReturnType<typeof toPlain>[]>}
 */
async function fetchAll(channel) {
  const out = [];
  let before;
  while (out.length < MAX_MESSAGES) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    for (const m of batch.values()) out.push(toPlain(m));
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return out.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

const pad = (n) => String(n).padStart(2, '0');
/** UTC so transcripts read the same for every staff member. */
const stamp = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
};

/**
 * Builds the plain-text transcript. Pure function (tested without Discord).
 * @param {{labels: Record<string, string>, guildName: string, channelName: string, ticket: object, messages: object[], closedAt?: number}} input
 *   labels: already translated header words (title, server, channel, opened, closed, owner, category, claimed, reason, messages, attachment, embed, none).
 * @returns {string}
 */
function formatTranscript({ labels, guildName, channelName, ticket, messages, closedAt }) {
  const line = '='.repeat(60);
  const head = [
    line,
    `${labels.title} #${ticket.number}`,
    `${labels.server}: ${guildName}`,
    `${labels.channel}: #${channelName}`,
    `${labels.owner}: ${ticket.ownerTag || ticket.ownerId} (${ticket.ownerId})`,
    `${labels.category}: ${ticket.categoryName || labels.none}`,
    `${labels.claimed}: ${ticket.claimedTag || labels.none}`,
    `${labels.reason}: ${ticket.reason || labels.none}`,
    `${labels.opened}: ${stamp(ticket.createdAt)}`,
    `${labels.closed}: ${closedAt ? stamp(closedAt) : labels.none}`,
    `${labels.messages}: ${messages.length}`,
    line,
    ''
  ];
  const body = messages.map((m) => {
    const parts = [`[${stamp(m.createdTimestamp)}] ${m.author.tag}${m.author.bot ? ' [BOT]' : ''}: ${m.content}`.trimEnd()];
    for (const url of m.attachments || []) parts.push(`    ${labels.attachment}: ${url}`);
    for (const e of m.embeds || []) if (e) parts.push(`    ${labels.embed}: ${e}`);
    return parts.join('\n');
  });
  return `${head.join('\n')}${body.join('\n')}\n`;
}

/**
 * Fetches a ticket channel and returns a factory of .txt attachments. A factory
 * is returned because one transcript is sent to several places (log, DM, staff)
 * and each send needs its own attachment object.
 * @param {(key: string) => string} tr Translator bound to the guild language and the tickets namespace.
 * @param {import('discord.js').TextChannel} channel
 * @param {object} ticket Stored ticket record (+ ownerTag, claimedTag, categoryName).
 * @param {number} [closedAt]
 * @returns {Promise<() => AttachmentBuilder>}
 */
async function buildAttachment(tr, channel, ticket, closedAt) {
  const keys = ['title', 'server', 'channel', 'opened', 'closed', 'owner', 'category', 'claimed', 'reason', 'messages', 'attachment', 'embed', 'none'];
  const labels = Object.fromEntries(keys.map((k) => [k, tr(`transcript.${k}`)]));
  const messages = await fetchAll(channel);
  const text = formatTranscript({ labels, guildName: channel.guild.name, channelName: channel.name, ticket, messages, closedAt });
  const buffer = Buffer.from(text, 'utf8');
  return () => new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
}

module.exports = { formatTranscript, buildAttachment, fetchAll, toPlain, MAX_MESSAGES };
