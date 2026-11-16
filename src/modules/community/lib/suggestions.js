'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const embeds = require('../../../core/embeds');
const { NS, clip } = require('./util');

/** Statuses a staff member can set, and the colour that makes each one readable at a glance. */
const STATUS = Object.freeze({
  pending: 0x3b6fd4,
  considered: 0xd4a23b,
  accepted: 0x3ba55d,
  denied: 0xd4483b,
  implemented: 0x7a5fd4
});
const LOCKED = new Set(['accepted', 'denied', 'implemented']);
const PREFIX = 'cmsug:';

/**
 * Applies a vote. Clicking the same side again removes the vote; clicking the
 * other side moves it. Returns new arrays (the stored item is never mutated).
 * @param {{up: string[], down: string[]}} item
 * @param {string} userId
 * @param {'up'|'down'} side
 * @returns {{up: string[], down: string[], action: 'added'|'removed'|'switched'}}
 */
function applyVote(item, userId, side) {
  const other = side === 'up' ? 'down' : 'up';
  const sets = { up: new Set(item.up || []), down: new Set(item.down || []) };
  let action = 'added';
  if (sets[side].has(userId)) {
    sets[side].delete(userId);
    action = 'removed';
  } else {
    if (sets[other].delete(userId)) action = 'switched';
    sets[side].add(userId);
  }
  return { up: [...sets.up], down: [...sets.down], action };
}

/**
 * Text bar showing the share of positive votes, e.g. "▰▰▰▰▱▱▱▱▱▱ 40%".
 * @param {number} up
 * @param {number} down
 * @param {number} [size]
 */
function voteBar(up, down, size = 10) {
  const total = up + down;
  const ratio = total ? up / total : 0;
  const filled = Math.round(ratio * size);
  return `${'▰'.repeat(filled)}${'▱'.repeat(size - filled)} ${Math.round(ratio * 100)}%`;
}

/** Whether votes are closed for this status. */
const isLocked = (status) => LOCKED.has(status);

/**
 * Builds the public suggestion embed.
 * @param {Function} t Translator.
 * @param {*} lang Language target.
 * @param {object} item Stored suggestion.
 * @param {{anonymous: boolean, authorTag?: string, avatar?: string}} view
 */
function buildEmbed(t, lang, item, view) {
  const up = item.up?.length || 0;
  const down = item.down?.length || 0;
  const fields = [
    { name: t(lang, `${NS}:suggestions.embed.status`), value: t(lang, `${NS}:suggestions.status.${item.status}`), inline: true },
    { name: t(lang, `${NS}:suggestions.embed.votes`), value: t(lang, `${NS}:suggestions.embed.voteLine`, { up, down, bar: voteBar(up, down) }), inline: true }
  ];
  if (item.reason || item.staffId) {
    fields.push({
      name: t(lang, `${NS}:suggestions.embed.response`),
      value: clip(t(lang, `${NS}:suggestions.embed.responseLine`, { staff: item.staffId ? `<@${item.staffId}>` : '-', reason: item.reason || t(lang, `${NS}:suggestions.noReason`) }), 1024)
    });
  }
  const embed = embeds.base({
    title: t(lang, `${NS}:suggestions.embed.title`, { number: item.number }),
    description: clip(item.content, 4000),
    fields,
    footer: view.anonymous ? t(lang, `${NS}:suggestions.embed.anonymous`) : t(lang, `${NS}:suggestions.embed.by`, { user: view.authorTag || item.authorId })
  });
  embed.setColor(STATUS[item.status] ?? STATUS.pending).setTimestamp(item.createdAt || Date.now());
  if (!view.anonymous && view.avatar) embed.setThumbnail(view.avatar);
  return embed;
}

/**
 * Vote buttons with live counts; disabled once the suggestion is decided.
 * @param {Function} t
 * @param {*} lang
 * @param {object} item
 */
function buildButtons(t, lang, item) {
  const locked = isLocked(item.status);
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}up:${item.number}`).setStyle(ButtonStyle.Success).setDisabled(locked)
      .setLabel(t(lang, `${NS}:suggestions.buttons.up`, { count: item.up?.length || 0 })),
    new ButtonBuilder().setCustomId(`${PREFIX}down:${item.number}`).setStyle(ButtonStyle.Danger).setDisabled(locked)
      .setLabel(t(lang, `${NS}:suggestions.buttons.down`, { count: item.down?.length || 0 }))
  )];
}

/**
 * Parses a vote button id "cmsug:up:12".
 * @param {string} customId
 * @returns {{side: 'up'|'down', number: number}|null}
 */
function parseVoteId(customId) {
  const m = /^cmsug:(up|down):(\d+)$/.exec(customId || '');
  return m ? { side: m[1], number: Number(m[2]) } : null;
}

module.exports = { STATUS, PREFIX, applyVote, voteBar, isLocked, buildEmbed, buildButtons, parseVoteId };
