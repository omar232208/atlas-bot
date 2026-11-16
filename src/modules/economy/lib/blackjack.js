'use strict';

/**
 * Pure blackjack rules. Games are plain objects and every action returns a
 * new game, so the state can be stored as JSON between button clicks.
 * Rules: a fresh single 52-card deck shuffled for every game, blackjack pays 3:2, dealer
 * stands on all 17s, double down on any first two cards (one card, then stand).
 */

const SUITS = Object.freeze(['♠', '♥', '♦', '♣']);
const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);

/** @returns {{rank: string, suit: string}[]} The 52 cards in a fixed order. */
function buildDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

/**
 * Fisher-Yates shuffle on a copy.
 * @param {object[]} deck
 * @param {() => number} rng
 */
function shuffle(deck, rng) {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Best total of a hand: aces count 11 unless that busts the hand.
 * @param {{rank: string}[]} cards
 * @returns {{total: number, soft: boolean}}
 */
function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const { rank } of cards) {
    if (rank === 'A') { aces++; total += 1; }
    else if (rank === 'K' || rank === 'Q' || rank === 'J') total += 10;
    else total += Number(rank);
  }
  let soft = false;
  if (aces > 0 && total + 10 <= 21) { total += 10; soft = true; }
  return { total, soft };
}

/** Two-card 21. @param {object[]} cards */
function isNatural(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

/**
 * Starts a game: shuffles, deals two cards each. A natural on either side ends
 * the game immediately.
 * @param {{rng: () => number}} p
 * @returns {object} Game in status 'player' or 'over'.
 */
function newGame({ rng }) {
  const deck = shuffle(buildDeck(), rng);
  const player = [deck.shift(), deck.shift()];
  const dealer = [deck.shift(), deck.shift()];
  const game = { deck, player, dealer, doubled: false, status: 'player' };
  return isNatural(player) || isNatural(dealer) ? { ...game, status: 'over' } : game;
}

/** Dealer draws until 17 or more (stands on soft 17 too). */
function dealerPlay(game) {
  const deck = game.deck.slice();
  const dealer = game.dealer.slice();
  while (handValue(dealer).total < 17 && deck.length) dealer.push(deck.shift());
  return { ...game, deck, dealer, status: 'over' };
}

/**
 * Player draws one card. Reaching 21 or busting ends the player's turn; a
 * non-busted hand then lets the dealer play.
 * @returns {object}
 */
function hit(game) {
  if (game.status !== 'player') throw new Error('blackjack: no player turn');
  const deck = game.deck.slice();
  const player = [...game.player, deck.shift()];
  const next = { ...game, deck, player };
  const { total } = handValue(player);
  if (total > 21) return { ...next, status: 'over' };
  if (total === 21) return dealerPlay(next);
  return next;
}

/** Player stands; the dealer plays out the hand. */
function stand(game) {
  if (game.status !== 'player') throw new Error('blackjack: no player turn');
  return dealerPlay(game);
}

/**
 * Doubles the stake, draws exactly one card, then the dealer plays.
 * Allowed only with two cards and no earlier action.
 * @returns {object}
 */
function doubleDown(game) {
  if (game.status !== 'player' || game.player.length !== 2) throw new Error('blackjack: cannot double');
  const deck = game.deck.slice();
  const player = [...game.player, deck.shift()];
  const next = { ...game, deck, player, doubled: true };
  return handValue(player).total > 21 ? { ...next, status: 'over' } : dealerPlay(next);
}

/**
 * Settles a finished game. `stake` is the total the player put in (bet, doubled
 * when doubled). `payout` is what goes back to the wallet, stake included.
 * @param {object} game Must be in status 'over'.
 * @param {number} bet
 * @returns {{outcome: 'blackjack'|'win'|'push'|'lose'|'bust', payout: number, net: number}}
 */
function settle(game, bet) {
  if (game.status !== 'over') throw new Error('blackjack: game not finished');
  const stake = game.doubled ? bet * 2 : bet;
  const p = handValue(game.player).total;
  const d = handValue(game.dealer).total;
  const playerNatural = isNatural(game.player);
  const dealerNatural = isNatural(game.dealer);

  if (playerNatural && dealerNatural) return { outcome: 'push', payout: stake, net: 0 };
  if (playerNatural) {
    const winnings = Math.floor(stake * 1.5);
    return { outcome: 'blackjack', payout: stake + winnings, net: winnings };
  }
  if (dealerNatural) return { outcome: 'lose', payout: 0, net: -stake };
  if (p > 21) return { outcome: 'bust', payout: 0, net: -stake };
  if (d > 21 || p > d) return { outcome: 'win', payout: stake * 2, net: stake };
  if (p === d) return { outcome: 'push', payout: stake, net: 0 };
  return { outcome: 'lose', payout: 0, net: -stake };
}

/** Whether the player can still double (two cards, turn still open). */
function canDouble(game) {
  return game.status === 'player' && game.player.length === 2;
}

module.exports = { SUITS, RANKS, buildDeck, shuffle, handValue, isNatural, newGame, hit, stand, doubleDown, settle, canDouble };
