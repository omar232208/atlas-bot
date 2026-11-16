'use strict';

const crypto = require('node:crypto');
const { ButtonStyle, MessageFlags } = require('discord.js');
const logger = require('../../core/logger').child('utility');
const { button, rows, disableAll } = require('./ui');

/**
 * Polls are kept in the guild store (not in memory) so buttons keep counting
 * after a restart and the end time survives it: the end is a scheduler job.
 * Store path: utility.polls.<pollId>
 */
const STORE_ROOT = 'utility.polls';
const JOB_END = 'utility:poll-end';
const MAX_OPTIONS = 5;
const MAX_OPTION_LENGTH = 80;
const MAX_POLL_MS = 7 * 86400000;
const DEFAULT_POLL_MS = 86400000;

/** Votes per option, total and the leading option(s). */
function tally(poll) {
  const counts = poll.options.map(() => 0);
  for (const choice of Object.values(poll.votes)) counts[choice] += 1;
  const total = counts.reduce((sum, n) => sum + n, 0);
  const top = Math.max(0, ...counts);
  const leaders = counts.map((n, i) => (n === top && top > 0 ? i : -1)).filter((i) => i >= 0);
  return { counts, total, leaders };
}

/** Text bar of ten cells, filled by share of the total. */
const bar = (count, total) => {
  const filled = total ? Math.round((count / total) * 10) : 0;
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};

/**
 * Message of a poll: question as title, one line per option with its bar, and
 * the buttons carrying the live count. When the poll is closed the buttons are
 * disabled and the result is shown instead of the end time.
 * @param {object} ctx
 * @param {object} lang Translation target.
 * @param {string} pollId
 * @param {object} poll
 * @param {boolean} [closed]
 */
function pollView(ctx, lang, pollId, poll, closed = false) {
  const { t, embeds } = ctx;
  const { counts, total, leaders } = tally(poll);
  const lines = poll.options.map((option, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    return `**${i + 1}. ${option}**\n\`${bar(counts[i], total)}\` ${counts[i]} (${pct} %)`;
  });
  const footer = [];
  if (closed) {
    let result;
    if (!total) result = t(lang, 'utility:poll.noVotes');
    else if (leaders.length > 1) result = t(lang, 'utility:poll.tie');
    else result = t(lang, 'utility:poll.winner', { option: poll.options[leaders[0]] });
    footer.push(`**${t(lang, 'utility:poll.results')}:** ${result}`);
  } else {
    footer.push(t(lang, 'utility:poll.ends', { unix: Math.floor(poll.endsAt / 1000) }));
  }
  footer.push(t(lang, 'utility:poll.totalVotes', { total }));
  const embed = closed
    ? embeds.warn(poll.question, [lines.join('\n\n'), ...footer].join('\n\n'))
    : embeds.info(poll.question, [lines.join('\n\n'), ...footer].join('\n\n'));
  const buttons = poll.options.map((option, i) => button({
    id: `utl:poll:${pollId}:${i}`,
    label: `${option.slice(0, 60)} (${counts[i]})`,
    style: ButtonStyle.Primary,
    disabled: closed
  }));
  return { embeds: [embed], components: closed ? disableAll(buttons) : rows(buttons) };
}

/**
 * Creates a poll: stores it, sends it and schedules its end.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} ctx
 * @param {{question: string, options: string[], ms: number}} input
 */
async function createPoll(interaction, ctx, { question, options, ms }) {
  const pollId = crypto.randomBytes(6).toString('hex');
  const endsAt = Date.now() + ms;
  const draft = { question, options, votes: {}, endsAt, closed: false, channelId: interaction.channelId, messageId: null };
  const response = await interaction.reply({ ...pollView(ctx, interaction, pollId, draft), withResponse: true });
  draft.messageId = response.resource.message.id;
  ctx.store.guild(interaction.guildId).set(`${STORE_ROOT}.${pollId}`, draft);
  ctx.scheduler.schedule(JOB_END, endsAt, { guildId: interaction.guildId, pollId });
  return pollId;
}

/**
 * Records (or changes) a vote and refreshes the counts on the message.
 * @param {import('discord.js').ButtonInteraction} click
 * @param {object} ctx
 */
async function vote(click, ctx) {
  const [, , pollId, index] = click.customId.split(':');
  const store = ctx.store.guild(click.guildId);
  const poll = store.get(`${STORE_ROOT}.${pollId}`);
  if (!poll || poll.closed || Date.now() >= poll.endsAt) {
    return click.reply({ embeds: [ctx.embeds.error(ctx.t(click, 'utility:errors.pollClosed'))], flags: MessageFlags.Ephemeral });
  }
  store.set(`${STORE_ROOT}.${pollId}.votes.${click.user.id}`, Number(index));
  const fresh = store.get(`${STORE_ROOT}.${pollId}`);
  await click.update(pollView(ctx, click, pollId, fresh));
  return click.followUp({
    embeds: [ctx.embeds.success(ctx.t(click, 'utility:poll.recorded'), ctx.t(click, 'utility:poll.yourChoice', { option: fresh.options[Number(index)] }))],
    flags: MessageFlags.Ephemeral
  });
}

/**
 * Closes a poll: sets it closed, edits its message to the result and removes
 * the record. Runs from the scheduler and is safe to call more than once.
 * @param {object} ctx
 * @param {import('discord.js').Client} client
 * @param {{guildId: string, pollId: string}} payload
 */
async function endPoll(ctx, client, { guildId, pollId }) {
  const store = ctx.store.guild(guildId);
  const poll = store.get(`${STORE_ROOT}.${pollId}`);
  if (!poll || poll.closed) return;
  store.set(`${STORE_ROOT}.${pollId}.closed`, true);
  try {
    const channel = await client.channels.fetch(poll.channelId);
    const message = await channel.messages.fetch(poll.messageId);
    const closed = { ...poll, closed: true };
    await message.edit(pollView(ctx, { guildId }, pollId, closed, true));
  } catch (err) {
    // The message or channel may have been deleted: the poll is closed regardless.
    logger.warn(`could not update poll ${pollId}:`, err.message);
  }
  store.delete(`${STORE_ROOT}.${pollId}`);
}

module.exports = { tally, pollView, createPoll, vote, endPoll, JOB_END, MAX_OPTIONS, MAX_OPTION_LENGTH, MAX_POLL_MS, DEFAULT_POLL_MS };
