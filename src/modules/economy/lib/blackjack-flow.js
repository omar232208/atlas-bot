'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const bj = require('./blackjack');
const { updateAccount, getAccount } = require('./accounts');
const { getConfig, formatMoney } = require('./config');

/**
 * Blackjack flow on top of the pure rules: stores the active game, settles
 * it, and keeps the table alive across restarts through the scheduler.
 * A player who walks away gets an automatic stand after IDLE_MS, so the bet
 * is always resolved and never stuck.
 */
const IDLE_MS = 2 * 60 * 1000;
const TIMEOUT_JOB = 'economy:blackjack-timeout';
const gameKey = (userId) => `economy.blackjack.${userId}`;

const card = (c) => `${c.rank}${c.suit}`;
const hand = (cards) => cards.map(card).join(' ');

/**
 * Builds the table embed and the action buttons.
 * @returns {{embeds: any[], components: any[]}}
 */
function render(ctx, target, game, cfg, { wallet, finished = null }) {
  const { t, embeds } = ctx;
  const hideHole = game.status === 'player';
  const dealerCards = hideHole ? `${card(game.dealer[0])} ??` : hand(game.dealer);
  const dealerValue = hideHole ? '?' : bj.handValue(game.dealer).total;
  const playerValue = bj.handValue(game.player).total;
  const fields = [
    { name: t(target, 'economy:blackjack.dealer'), value: `${dealerCards}\n= ${dealerValue}`, inline: true },
    { name: t(target, 'economy:blackjack.you'), value: `${hand(game.player)}\n= ${playerValue}`, inline: true },
    { name: t(target, 'economy:blackjack.bet'), value: formatMoney(game.doubled ? game.bet * 2 : game.bet, cfg, target), inline: false }
  ];
  if (finished) {
    const title = t(target, `economy:blackjack.outcome.${finished.outcome}.title`);
    const text = t(target, `economy:blackjack.outcome.${finished.outcome}.text`, { amount: formatMoney(Math.abs(finished.net), cfg, target) });
    const embed = finished.outcome === 'win' || finished.outcome === 'blackjack'
      ? embeds.success(title, text, { fields })
      : finished.outcome === 'push' ? embeds.info(title, text, { fields }) : embeds.error(title, text, { fields });
    return { embeds: [embed], components: [] };
  }
  const prefix = `eco:bj:${game.id}:`;
  const canDouble = bj.canDouble(game) && wallet >= game.bet && !game.doubled;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}hit`).setStyle(ButtonStyle.Primary).setLabel(t(target, 'economy:blackjack.buttons.hit')),
    new ButtonBuilder().setCustomId(`${prefix}stand`).setStyle(ButtonStyle.Secondary).setLabel(t(target, 'economy:blackjack.buttons.stand')),
    new ButtonBuilder().setCustomId(`${prefix}double`).setStyle(ButtonStyle.Secondary).setLabel(t(target, 'economy:blackjack.buttons.double')).setDisabled(!canDouble)
  );
  return { embeds: [embeds.info(t(target, 'economy:blackjack.title'), t(target, 'economy:blackjack.turn'), { fields })], components: [row] };
}

/** Credits the payout and removes the table. Returns the settlement. */
function finish(ctx, guildId, game) {
  const result = bj.settle(game, game.bet);
  updateAccount(ctx.store, guildId, game.userId, (acc) => { acc.wallet += result.payout; });
  ctx.store.guild(guildId).delete(gameKey(game.userId));
  if (game.timeoutJobId) ctx.scheduler.cancel(game.timeoutJobId);
  return result;
}

/** Stores the game and (re)arms the idle timeout. */
function save(ctx, guildId, game) {
  if (game.timeoutJobId) ctx.scheduler.cancel(game.timeoutJobId);
  const timeoutJobId = ctx.scheduler.schedule(TIMEOUT_JOB, Date.now() + IDLE_MS, {
    guildId, userId: game.userId, gameId: game.id, channelId: game.channelId, messageId: game.messageId
  });
  const next = { ...game, timeoutJobId };
  ctx.store.guild(guildId).set(gameKey(game.userId), next);
  return next;
}

/**
 * Places a bet and deals. Returns {error: key} or {reply: {embeds, components}, game}.
 * Called by /blackjack before the reply exists, so messageId is filled in later.
 */
function startGame(ctx, interaction, bet) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const cfg = getConfig(ctx.store, guildId);
  if (ctx.store.guild(guildId).get(gameKey(userId))) return { error: 'economy:errors.alreadyPlaying' };
  const taken = updateAccount(ctx.store, guildId, userId, (acc) => {
    if (acc.wallet < bet) return false;
    acc.wallet -= bet;
    return true;
  });
  if (!taken) return { error: 'economy:errors.notEnough' };

  const dealt = bj.newGame({ rng: Math.random });
  const game = { ...dealt, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, userId, bet, channelId: interaction.channelId, messageId: null, timeoutJobId: null };
  if (game.status === 'over') {
    const settled = finish(ctx, guildId, game);
    return { reply: render(ctx, interaction, game, cfg, { wallet: 0, finished: settled }) };
  }
  const wallet = getAccount(ctx.store, guildId, userId).wallet;
  return { game, cfg, reply: render(ctx, interaction, game, cfg, { wallet }) };
}

/** Attaches the message id to a stored game and arms the timeout. */
function attach(ctx, guildId, game, messageId) {
  return save(ctx, guildId, { ...game, messageId });
}

/**
 * Applies a button action. Returns the new message payload for interaction.update.
 * @returns {{payload?: object, error?: string}}
 */
function act(ctx, interaction, gameId, action) {
  const guildId = interaction.guildId;
  const userId = interaction.user.id;
  const cfg = getConfig(ctx.store, guildId);
  const game = ctx.store.guild(guildId).get(gameKey(userId));
  if (!game || game.id !== gameId) return { error: 'economy:errors.gameExpired' };

  let next = game;
  if (action === 'double') {
    if (!bj.canDouble(game)) return { error: 'economy:errors.gameExpired' };
    const paid = updateAccount(ctx.store, guildId, userId, (acc) => {
      if (acc.wallet < game.bet) return false;
      acc.wallet -= game.bet;
      return true;
    });
    if (!paid) return { error: 'economy:errors.notEnough' };
    next = bj.doubleDown(game);
  } else if (action === 'hit') next = bj.hit(game);
  else if (action === 'stand') next = bj.stand(game);
  else return { error: 'economy:errors.gameExpired' };

  if (next.status === 'over') {
    const settled = finish(ctx, guildId, next);
    return { payload: render(ctx, interaction, next, cfg, { wallet: 0, finished: settled }) };
  }
  const saved = save(ctx, guildId, next);
  const wallet = getAccount(ctx.store, guildId, userId).wallet;
  return { payload: render(ctx, interaction, saved, cfg, { wallet }) };
}

/**
 * Scheduler handler: the player went idle, so the dealer plays out the hand
 * and the table is edited to show the result.
 * @param {object} payload Stored by save().
 * @param {import('discord.js').Client} client
 * @param {object} ctx
 */
async function timeout(payload, client, ctx) {
  const game = ctx.store.guild(payload.guildId).get(gameKey(payload.userId));
  if (!game || game.id !== payload.gameId) return;
  const cfg = getConfig(ctx.store, payload.guildId);
  const done = bj.stand(game);
  const settled = finish(ctx, payload.guildId, done);
  const body = render(ctx, { guildId: payload.guildId }, done, cfg, { wallet: 0, finished: settled });
  try {
    const channel = await client.channels.fetch(payload.channelId);
    const message = await channel.messages.fetch(payload.messageId);
    await message.edit(body);
  } catch (err) {
    ctx.logger.warn('blackjack timeout: could not edit the table', err.message);
  }
}

module.exports = { render, startGame, attach, act, timeout, gameKey, TIMEOUT_JOB, IDLE_MS, card, hand };
