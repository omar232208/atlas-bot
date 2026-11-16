'use strict';

const { ButtonStyle, SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');
const { pickQuestions, buildQuestion } = require('../games/rules/trivia');
const { button, rows } = require('../games/ui');
const tracker = require('../games/tracker');
const { loadBank, gameLanguage } = require('../games/banks');
const { readSetting } = require('../settings');

const DEFAULT_ROUNDS = 5;
const MAX_ROUNDS = 10;
/** Discord refuses button labels longer than 80 characters. */
const MAX_LABEL = 80;
/** Extra time before the inactivity timer fires, so the question timer always goes first. */
const GRACE_MS = 5000;

/**
 * Screen of one question. `feedback` (correct, wrong or time up) is shown above
 * the question. Answer buttons carry the question number, so a late click on an
 * earlier question is recognised and refused.
 */
function questionView(ctx, round, lang, feedback) {
  const { t, embeds } = ctx;
  const question = round.questions[round.index];
  const buttons = question.options.map((option, i) => button({
    id: `fun:tv:${round.index}:${i}`,
    label: option.slice(0, MAX_LABEL),
    style: ButtonStyle.Primary
  }));
  const body = [
    feedback,
    `**${question.prompt}**`,
    t(lang, 'fun:trivia.timeLeft', { seconds: round.seconds })
  ].filter(Boolean).join('\n\n');
  return {
    embeds: [embeds.info(t(lang, 'fun:trivia.question', { n: round.index + 1, total: round.questions.length }), body)],
    components: rows(buttons)
  };
}

/** Closing screen with the final score. No buttons remain. */
function finalView(ctx, round, lang) {
  const { t, embeds } = ctx;
  const total = round.questions.length;
  const perfect = round.score === total;
  const summary = [
    t(lang, 'fun:trivia.score', { score: round.score, total }),
    perfect ? t(lang, 'fun:trivia.perfect') : null
  ].filter(Boolean).join('\n');
  const title = t(lang, 'fun:trivia.finished');
  return { embeds: [perfect ? embeds.success(title, summary) : embeds.info(title, summary)], components: [] };
}

/**
 * Runs one round for one player. Every question has its own timer: when it
 * runs out, the question counts as missed and the next one appears by itself.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} ctx
 * @param {number} count
 */
async function run(interaction, ctx, count) {
  const { t, embeds } = ctx;
  const lang = gameLanguage(interaction);
  const bank = loadBank('trivia', lang);
  const questions = pickQuestions(bank, count).map((entry) => buildQuestion(entry));
  const round = {
    questions,
    index: 0,
    score: 0,
    qTimer: null,
    seconds: readSetting(interaction.guildId, 'fun.trivia.questionSeconds')
  };
  const player = interaction.user;

  const response = await interaction.reply({ ...questionView(ctx, round, interaction), withResponse: true });
  const message = response.resource.message;

  /**
   * Closes the current question and moves on. Returns the next payload, or the
   * final one when the round is over (the message is then untracked).
   * @param {string|null} feedback Text shown above the next question.
   * @param {object} lang Translation target for the payload.
   */
  const advance = (feedback, lang) => {
    clearTimeout(round.qTimer);
    round.index += 1;
    if (round.index >= questions.length) {
      tracker.untrack(message.id);
      return finalView(ctx, round, lang);
    }
    armQuestion();
    return questionView(ctx, round, lang, feedback);
  };

  /** Arms the timer of the current question and refreshes the inactivity timer. */
  const armQuestion = () => {
    tracker.track(message, entry, round.seconds * 1000 + GRACE_MS);
    round.qTimer = setTimeout(() => {
      // Read the missed question before advancing: advance() moves the index on.
      const missed = questions[round.index];
      const feedback = t(interaction, 'fun:trivia.timeout', { answer: missed.options[missed.correctIndex] });
      message.edit(advance(feedback, interaction)).catch(() => {});
    }, round.seconds * 1000);
    if (typeof round.qTimer.unref === 'function') round.qTimer.unref();
  };

  const entry = {
    handle: async (click) => {
      if (click.user.id !== player.id) {
        return tracker.reply(click, embeds.error(t(click, 'fun:errors.notPlayer')));
      }
      const qIndex = Number(click.customId.split(':')[2]);
      const choice = Number(click.customId.split(':')[3]);
      if (qIndex !== round.index) {
        return tracker.reply(click, embeds.error(t(click, 'fun:errors.alreadyPlayed')));
      }
      const question = questions[round.index];
      const correct = choice === question.correctIndex;
      if (correct) round.score += 1;
      const feedback = correct
        ? t(click, 'fun:trivia.correct')
        : t(click, 'fun:trivia.wrong', { answer: question.options[question.correctIndex] });
      return click.update(advance(feedback, click));
    },
    expire: () => {
      clearTimeout(round.qTimer);
      return finalView(ctx, round, { guildId: interaction.guildId });
    }
  };

  // Track before arming so the first question is covered by the inactivity timer too.
  armQuestion();
  return message;
}

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('trivia')
    .setDescription(en('fun:commands.game.options.trivia.description'))
    .addIntegerOption((o) => o.setName('count').setDescription(en('fun:commands.game.options.trivia.options.count')).setMinValue(1).setMaxValue(MAX_ROUNDS)),

  async execute(interaction, ctx) {
    const count = interaction.options.getInteger('count') ?? DEFAULT_ROUNDS;
    return run(interaction, ctx, count);
  }
};
