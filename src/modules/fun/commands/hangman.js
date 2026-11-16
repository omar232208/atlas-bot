'use strict';

const crypto = require('node:crypto');
const { ButtonStyle, SlashCommandSubcommandBuilder } = require('discord.js');
const en = require('../en');
const hangman = require('../games/rules/hangman');
const { button, rows, disableAll } = require('../games/ui');
const tracker = require('../games/tracker');
const { loadBank, gameLanguage } = require('../games/banks');
const { readSetting } = require('../settings');

/**
 * Letters are split in two pages so that 26 letter buttons plus two controls
 * fit in Discord's limit of five rows of five buttons. The first page holds the
 * twenty letters that are most often needed.
 */
const PAGES = ['ABCDEFGHIJKLMNOPQRST', 'UVWXYZ'];

/** ASCII gallows: one more body part per mistake. */
function gallows(wrong) {
  const head = wrong >= 1 ? 'O' : ' ';
  const torso = wrong >= 2 ? '|' : ' ';
  const leftArm = wrong >= 3 ? '/' : ' ';
  const rightArm = wrong >= 4 ? '\\' : ' ';
  const leftLeg = wrong >= 5 ? '/' : ' ';
  const rightLeg = wrong >= 6 ? '\\' : ' ';
  return [
    '  +---+',
    '  |   |',
    `  |   ${head}`,
    `  |  ${leftArm}${torso}${rightArm}`,
    `  |  ${leftLeg} ${rightLeg}`,
    '  |',
    '=========='
  ].join('\n');
}

/** Letter buttons of one page. Green is a hit, red a miss, used letters are disabled. */
function letterButtons(state, page, closed) {
  const used = new Set([...state.guessed, ...state.wrong]);
  return [...PAGES[page]].map((letter) => {
    let style = ButtonStyle.Secondary;
    if (state.guessed.includes(letter)) style = ButtonStyle.Success;
    else if (state.wrong.includes(letter)) style = ButtonStyle.Danger;
    return button({ id: `fun:hm:${letter}`, label: letter, style, disabled: closed || used.has(letter) });
  });
}

/**
 * Full message for the current state. Built fresh each time so the disabled
 * state of every button always matches the game.
 */
function view(ctx, state, lang, page, closed = false, outcome = null) {
  const { t, embeds } = ctx;
  const letters = letterButtons(state, page, closed);
  const controls = [
    button({ id: 'fun:hm:page', label: t(lang, 'fun:ui.page', { page: page + 1, total: PAGES.length }), style: ButtonStyle.Secondary, disabled: closed }),
    button({ id: 'fun:hm:give', label: t(lang, 'fun:ui.giveUp'), style: ButtonStyle.Danger, disabled: closed })
  ];
  const guessedLetters = [...state.guessed, ...state.wrong].sort().join(' ') || '-';
  const word = [...hangman.masked(state)].join(' ');
  const body = [
    '```',
    gallows(state.wrong.length),
    '```',
    `**${t(lang, 'fun:hangman.word')}:** \`${word}\``
  ].join('\n');
  let embed;
  if (outcome === 'won') {
    embed = embeds.success(t(lang, 'fun:hangman.title'), `${body}\n\n${t(lang, 'fun:hangman.won', { word: state.word })}`);
  } else if (outcome === 'lost') {
    embed = embeds.warn(t(lang, 'fun:hangman.title'), `${body}\n\n${t(lang, 'fun:hangman.lost', { word: state.word })}`);
  } else if (outcome === 'gaveUp') {
    embed = embeds.warn(t(lang, 'fun:hangman.title'), `${body}\n\n${t(lang, 'fun:hangman.gaveUp', { word: state.word })}`);
  } else if (outcome === 'timeout') {
    embed = embeds.warn(t(lang, 'fun:hangman.title'), `${body}\n\n${t(lang, 'fun:hangman.timeout')}`);
  } else {
    embed = embeds.info(t(lang, 'fun:hangman.title'), `${body}\n\n${t(lang, 'fun:hangman.hint')}`);
  }
  embed.addFields(
    { name: t(lang, 'fun:hangman.wrong', { wrong: state.wrong.length, max: hangman.MAX_WRONG }), value: t(lang, 'fun:hangman.guessed', { letters: guessedLetters }), inline: false }
  );
  const all = [...letters, ...controls];
  return { embeds: [embed], components: closed ? disableAll(all) : rows(all) };
}

/**
 * Starts a single-player game. The word comes from the server language's list.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} ctx
 */
async function run(interaction, ctx) {
  const lang = gameLanguage(interaction);
  const words = loadBank('words', lang);
  const word = words[crypto.randomInt(words.length)];
  let state = hangman.createState(word);
  let page = 0;
  const timeoutMs = readSetting(interaction.guildId, 'fun.games.timeoutMinutes') * 60000;

  const response = await interaction.reply({ ...view(ctx, state, interaction, page), withResponse: true });
  const message = response.resource.message;

  const entry = {
    handle: async (click) => {
      const action = click.customId.split(':')[2];
      if (action === 'give') {
        tracker.untrack(message.id);
        return click.update(view(ctx, state, click, page, true, 'gaveUp'));
      }
      if (action === 'page') {
        page = 1 - page;
        tracker.track(message, entry, timeoutMs);
        return click.update(view(ctx, state, click, page));
      }
      const result = hangman.guess(state, action);
      // A repeated or invalid letter changes nothing; the buttons already show it.
      state = result.state;
      tracker.track(message, entry, timeoutMs);
      const status = hangman.status(state);
      if (status === 'playing') return click.update(view(ctx, state, click, page));
      tracker.untrack(message.id);
      return click.update(view(ctx, state, click, page, true, status));
    },
    expire: () => view(ctx, state, { guildId: interaction.guildId }, page, true, 'timeout')
  };
  tracker.track(message, entry, timeoutMs);
  return message;
}

module.exports = {
  data: new SlashCommandSubcommandBuilder()
    .setName('hangman')
    .setDescription(en('fun:commands.game.options.hangman.description')),

  async execute(interaction, ctx) {
    return run(interaction, ctx);
  }
};
