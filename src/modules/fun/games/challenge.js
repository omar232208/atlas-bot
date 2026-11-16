'use strict';

const { ButtonStyle } = require('discord.js');
const { button, rows, disableAll } = require('./ui');
const tracker = require('./tracker');
const { readSetting } = require('../settings');

/**
 * Validates a two-player challenge before anything is sent.
 * @returns {string|null} The localized-key suffix of the problem, or null when valid.
 */
function challengeProblem(challenger, opponent) {
  if (!opponent) return 'missingOpponent';
  if (opponent.bot) return 'opponentBot';
  if (opponent.id === challenger.id) return 'opponentSelf';
  return null;
}

/**
 * Sends a challenge with Accept / Decline buttons. Only the opponent can click.
 * When accepted, `onAccept(interaction)` runs on the challenge message and must
 * answer with interaction.update(...) and track the game itself.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} ctx
 * @param {{opponent: import('discord.js').User, gameKey: string, onAccept: Function}} opts
 *   gameKey is a fun:games.* key naming the game.
 */
async function sendChallenge(interaction, ctx, { opponent, gameKey, onAccept }) {
  const { t, embeds } = ctx;
  const challenger = interaction.user;
  const game = t(interaction, `fun:games.${gameKey}`);
  const buttons = [
    button({ id: 'fun:ch:accept', label: t(interaction, 'fun:ui.accept'), style: ButtonStyle.Success }),
    button({ id: 'fun:ch:decline', label: t(interaction, 'fun:ui.decline'), style: ButtonStyle.Danger })
  ];
  const message = await tracker.sendGame(interaction, {
    embeds: [embeds.info(
      t(interaction, 'fun:challenge.title'),
      t(interaction, 'fun:challenge.description', { challenger: challenger.toString(), opponent: opponent.toString(), game })
    )],
    components: rows(buttons)
  });
  const closed = (embed) => ({ embeds: [embed], components: disableAll(buttons) });

  tracker.track(message, {
    handle: async (click) => {
      if (click.user.id !== opponent.id) {
        return tracker.reply(click, embeds.error(t(click, 'fun:errors.notOpponent')));
      }
      if (click.customId === 'fun:ch:decline') {
        tracker.untrack(message.id);
        return click.update(closed(embeds.warn(t(click, 'fun:challenge.title'), t(click, 'fun:errors.declined', { opponent: opponent.toString() }))));
      }
      tracker.untrack(message.id);
      return onAccept(click);
    },
    expire: () => closed(embeds.warn(t(interaction, 'fun:challenge.title'), t(interaction, 'fun:errors.challengeExpired')))
  }, readSetting(interaction.guildId, 'fun.games.timeoutMinutes') * 60000);
  return message;
}

module.exports = { sendChallenge, challengeProblem };
