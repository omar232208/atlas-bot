'use strict';

const { MessageFlags } = require('discord.js');
const logger = require('../../../core/logger').child('fun');

/**
 * Live game messages, keyed by message id. Every button of the module uses the
 * custom id prefix "fun:", and the component routes it here: the message the
 * button sits on tells us which game it belongs to.
 *
 * State lives in memory on purpose: games are short-lived, and after a restart
 * their old buttons answer "expired" instead of pretending the game still runs.
 */
const games = new Map();

/**
 * Registers (or refreshes) a game on a message. Each call resets the inactivity
 * timer, so a game only expires after `timeMs` without a move.
 * @param {import('discord.js').Message} message
 * @param {{handle: Function, expire: Function}} entry
 *   handle(interaction, ctx) answers one click; expire() returns the payload
 *   that disables the message once the game times out.
 * @param {number} timeMs
 */
function track(message, entry, timeMs) {
  const id = message.id;
  const old = games.get(id);
  if (old) clearTimeout(old.timer);
  const timer = setTimeout(() => finishByTimeout(id), timeMs);
  // A pending timer must not keep the process alive on its own.
  if (typeof timer.unref === 'function') timer.unref();
  games.set(id, { ...entry, message, timer });
}

/**
 * Removes a game without touching its message (the caller updates it).
 * @param {string} id
 * @returns {boolean} True when a game was removed.
 */
function untrack(id) {
  const entry = games.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  games.delete(id);
  return true;
}

/** Ends a game because nobody moved in time, and disables its buttons. */
async function finishByTimeout(id) {
  const entry = games.get(id);
  if (!entry) return;
  games.delete(id);
  try {
    await entry.message.edit(entry.expire());
  } catch (err) {
    // The message may have been deleted by a moderator; nothing else to do.
    logger.debug(`could not close expired game ${id}:`, err.message);
  }
}

/**
 * Routes a button click to the game that owns its message.
 * @param {import('discord.js').MessageComponentInteraction} interaction
 * @param {object} ctx
 */
async function dispatch(interaction, ctx) {
  const entry = games.get(interaction.message?.id);
  if (!entry) {
    return reply(interaction, ctx.embeds.error(ctx.t(interaction, 'fun:errors.expired')));
  }
  try {
    await entry.handle(interaction, ctx);
  } catch (err) {
    logger.error('game click failed:', err);
    await reply(interaction, ctx.embeds.error(ctx.t(interaction, 'fun:errors.generic'))).catch(() => {});
  }
}

/**
 * Answers privately, whatever state the interaction is in.
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').EmbedBuilder} embed
 */
function reply(interaction, embed) {
  const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
  return interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
}

/**
 * Sends a game message and returns it, so the game can be tracked on it.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} payload
 * @returns {Promise<import('discord.js').Message>}
 */
async function sendGame(interaction, payload) {
  const response = await interaction.reply({ ...payload, withResponse: true });
  return response.resource.message;
}

/** @returns {number} Number of games currently running (used by tests and diagnostics). */
const size = () => games.size;

module.exports = { track, untrack, dispatch, reply, sendGame, size, games };
