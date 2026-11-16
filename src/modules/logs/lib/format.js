'use strict';

const { PermissionsBitField } = require('discord.js');

/**
 * Cuts text to `max` characters, adding an ellipsis when something was removed.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  const str = String(text ?? '');
  return str.length > max ? `${str.slice(0, Math.max(0, max - 1))}…` : str;
}

/**
 * Wraps user text in a code block, neutralising backticks that would close it early.
 * @param {string} text
 * @param {number} [max] Maximum length of the inner text.
 */
function block(text, max = 1000) {
  const clean = String(text ?? '').replace(/```/g, 'ʼʼʼ');
  return `\`\`\`\n${truncate(clean, max)}\n\`\`\``;
}

/**
 * "mention · name (id)" line for a user, robust to partial users.
 * @param {{id: string, tag?: string, username?: string}} user
 */
function userLabel(user) {
  if (!user) return '-';
  const name = user.tag || user.username || '?';
  return `<@${user.id}> · ${name} (\`${user.id}\`)`;
}

/**
 * Discord relative timestamp markup.
 * @param {number} ms
 * @param {'R'|'F'|'f'|'D'} [style]
 */
function stamp(ms, style = 'R') {
  return `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;
}

/**
 * Added / removed values between two lists.
 * @param {string[]} before
 * @param {string[]} after
 * @returns {{added: string[], removed: string[]}}
 */
function diffLists(before, after) {
  const a = new Set(before);
  const b = new Set(after);
  return { added: [...b].filter((x) => !a.has(x)), removed: [...a].filter((x) => !b.has(x)) };
}

/**
 * Permission flag names granted / revoked between two bitfields.
 * @param {bigint|string|number} before
 * @param {bigint|string|number} after
 */
function diffPermissions(before, after) {
  return diffLists(new PermissionsBitField(BigInt(before)).toArray(), new PermissionsBitField(BigInt(after)).toArray());
}

/**
 * Builds a plain-text transcript of messages (oldest first) for bulk deletions,
 * attached as a .txt file because an embed cannot hold hundreds of messages.
 * @param {Array<{createdTimestamp: number, author?: {tag?: string, username?: string, id: string}, content?: string, attachments?: Map<any, {url: string}>}>} messages
 * @returns {string}
 */
function transcript(messages) {
  return [...messages]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map((m) => {
      const who = m.author ? `${m.author.tag || m.author.username} (${m.author.id})` : '?';
      const files = m.attachments?.size ? ` [${[...m.attachments.values()].map((a) => a.url).join(' ')}]` : '';
      return `[${new Date(m.createdTimestamp).toISOString()}] ${who}: ${m.content || ''}${files}`;
    })
    .join('\n');
}

/**
 * Formats a role id list as mentions, trimmed to fit an embed field.
 * @param {string[]} ids
 * @param {number} [max]
 */
function roleList(ids, max = 1000) {
  if (!ids.length) return '-';
  return truncate(ids.map((id) => `<@&${id}>`).join(' '), max);
}

module.exports = { truncate, block, userLabel, stamp, diffLists, diffPermissions, transcript, roleList };
