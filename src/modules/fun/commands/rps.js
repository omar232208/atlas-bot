'use strict';

const crypto = require('node:crypto');
const { ButtonStyle, MessageFlags, SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');
const { CHOICES, resolve } = require('../games/rules/rps');
const { button, rows, disableAll } = require('../games/ui');
const tracker = require('../games/tracker');
const { sendChallenge, challengeProblem } = require('../games/challenge');
const { readSetting } = require('../settings');

/** Buttons for the three moves, custom id "fun:rps:<choice>". */
const moveButtons = (t, interaction) => CHOICES.map((choice) => button({
  id: `fun:rps:${choice}`,
  label: t(interaction, `fun:rps.choices.${choice}`),
  style: ButtonStyle.Primary
}));

/** Move key from a button custom id such as "fun:rps:paper". */
const moveOf = (customId) => customId.split(':')[2];

/**
 * Plays one round against the bot. The bot's move is drawn with crypto.randomInt
 * when the player clicks, so it cannot be predicted from the message.
 */
async function playAgainstBot(interaction, ctx) {
  const { t, embeds } = ctx;
  const buttons = moveButtons(t, interaction);
  const timeoutMs = readSetting(interaction.guildId, 'fun.games.timeoutMinutes') * 60000;
  const message = await tracker.sendGame(interaction, {
    embeds: [embeds.info(t(interaction, 'fun:rps.botTitle'), t(interaction, 'fun:rps.pick'))],
    components: rows(buttons)
  });
  const player = interaction.user;

  tracker.track(message, {
    handle: async (click) => {
      if (click.user.id !== player.id) {
        return tracker.reply(click, embeds.error(t(click, 'fun:errors.notPlayer')));
      }
      tracker.untrack(message.id);
      const mine = moveOf(click.customId);
      const botMove = CHOICES[crypto.randomInt(CHOICES.length)];
      const outcome = resolve(mine, botMove);
      const verdict = outcome === 'draw' ? t(click, 'fun:rps.draw') : outcome === 'a' ? t(click, 'fun:rps.youWin') : t(click, 'fun:rps.botWins');
      const summary = [
        `${player.toString()}: **${t(click, `fun:rps.choices.${mine}`)}**`,
        t(click, 'fun:rps.botChoice', { choice: t(click, `fun:rps.choices.${botMove}`) }),
        '',
        `**${verdict}**`
      ].join('\n');
      return click.update({ embeds: [outcome === 'draw' ? embeds.warn(t(click, 'fun:rps.botTitle'), summary) : embeds.success(t(click, 'fun:rps.botTitle'), summary)], components: disableAll(buttons) });
    },
    expire: () => ({
      embeds: [embeds.warn(t(interaction, 'fun:rps.botTitle'), t(interaction, 'fun:rps.timeout'))],
      components: disableAll(buttons)
    })
  }, timeoutMs);
}

/**
 * Plays a round between two members. Each player picks in secret: the bot
 * only reveals the result once both moves are in, so nobody can copy the other.
 */
function startMemberRound(players, ctx, timeoutMs) {
  const { t, embeds } = ctx;
  const choices = new Map();
  const buttons = (interaction) => moveButtons(t, interaction);

  const waitingView = (interaction) => {
    const lines = players.map((p) => (choices.has(p.id)
      ? t(interaction, 'fun:rps.chosen', { player: p.toString() })
      : null)).filter(Boolean);
    const pending = players.filter((p) => !choices.has(p.id)).map((p) => p.toString()).join(', ');
    return {
      embeds: [embeds.info(t(interaction, 'fun:rps.title'), [
        t(interaction, 'fun:rps.pick'),
        ...lines,
        t(interaction, 'fun:rps.waiting', { players: pending })
      ].join('\n'))],
      components: rows(buttons(interaction))
    };
  };

  return (click) => {
    // Called from the challenge: the message is the challenge message, now turned into the game.
    const message = click.message;
    // One entry for the whole round; each move re-tracks it so the timer restarts.
    const entry = {
      handle: async (move) => {
        if (!players.some((p) => p.id === move.user.id)) {
          return tracker.reply(move, embeds.error(t(move, 'fun:errors.notPlayer')));
        }
        if (choices.has(move.user.id)) {
          return tracker.reply(move, embeds.error(t(move, 'fun:errors.alreadyPlayed')));
        }
        choices.set(move.user.id, moveOf(move.customId));
        if (choices.size === players.length) {
          tracker.untrack(message.id);
          const [a, b] = players;
          const outcome = resolve(choices.get(a.id), choices.get(b.id));
          const winner = outcome === 'a' ? a : outcome === 'b' ? b : null;
          const reveal = [
            t(move, 'fun:rps.reveal', {
              a: `${a.toString()} ${t(move, `fun:rps.choices.${choices.get(a.id)}`)}`,
              b: `${b.toString()} ${t(move, `fun:rps.choices.${choices.get(b.id)}`)}`
            }),
            '',
            `**${winner ? t(move, 'fun:rps.win', { winner: winner.toString() }) : t(move, 'fun:rps.draw')}**`
          ].join('\n');
          return move.update({ embeds: [embeds.success(t(move, 'fun:rps.title'), reveal)], components: disableAll(buttons(move)) });
        }
        tracker.track(message, entry, timeoutMs);
        await move.update(waitingView(move));
        return tracker.reply(move, embeds.info(t(move, 'fun:rps.recorded')));
      },
      expire: () => ({
        embeds: [embeds.warn(t(message, 'fun:rps.title'), t(message, 'fun:rps.timeout'))],
        components: disableAll(buttons({ guildId: message.guildId }))
      })
    };
    tracker.track(message, entry, timeoutMs);
    return click.update(waitingView(click));
  };
}

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('rps')
    .setDescription(en('fun:commands.game.options.rps.description'))
    .addUserOption((o) => o.setName('opponent').setDescription(en('fun:commands.game.options.rps.options.opponent'))),

  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const opponent = interaction.options.getUser('opponent');
    if (!opponent) return playAgainstBot(interaction, ctx);

    const problem = challengeProblem(interaction.user, opponent);
    if (problem) {
      return interaction.reply({ embeds: [embeds.error(t(interaction, `fun:errors.${problem}`))], flags: MessageFlags.Ephemeral });
    }
    const timeoutMs = readSetting(interaction.guildId, 'fun.games.timeoutMinutes') * 60000;
    return sendChallenge(interaction, ctx, {
      opponent,
      gameKey: 'rps',
      onAccept: startMemberRound([interaction.user, opponent], ctx, timeoutMs)
    });
  }
};
