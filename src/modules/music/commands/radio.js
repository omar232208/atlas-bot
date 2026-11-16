'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe, respond } = require('../lib/runtime');
const { enqueueAndPlay } = require('../lib/enqueue');
const { MusicError } = require('../lib/source');
const { RADIOS, GENRES, findRadio, searchRadios } = require('../lib/radios');

/**
 * Autocomplete over the built-in stations (name, id or localized genre).
 * Shared with /play so typing a station name there works too.
 * @param {import('discord.js').AutocompleteInteraction} interaction
 * @param {object} ctx
 */
async function radioAutocomplete(interaction, ctx) {
  const focused = String(interaction.options.getFocused() || '');
  if (/^https?:/i.test(focused)) return interaction.respond([]).catch(() => {});
  const genre = (g) => ctx.t(interaction, `music:genres.${g}`);
  const choices = searchRadios(focused, genre).slice(0, 25).map((r) => ({ name: `${r.name} · ${genre(r.genre)}`.slice(0, 100), value: r.id }));
  return interaction.respond(choices).catch(() => {});
}

/** /radio: plays a built-in station, or lists them by genre without argument. */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Play a built-in web radio')
    .addStringOption((o) => o.setName('station').setDescription('Station name or genre').setAutocomplete(true).setMaxLength(100))
    .addBooleanOption((o) => o.setName('next').setDescription('Play right after the current track')),
  cooldown: 3,
  autocomplete: radioAutocomplete,
  radioAutocomplete,
  execute: safe(async (interaction, ctx) => {
    const query = interaction.options.getString('station');
    const t = (key, vars) => ctx.t(interaction, key, vars);
    if (!query) {
      const fields = GENRES.map((g) => ({
        name: t(`music:genres.${g}`),
        value: RADIOS.filter((r) => r.genre === g).map((r) => `[${r.name}](${r.homepage})`).join('\n'),
        inline: true
      }));
      return respond(interaction, { embeds: [ctx.embeds.base({ title: t('music:radio.listTitle'), description: t('music:radio.listHelp', { count: RADIOS.length }), fields })] });
    }
    const radio = findRadio(query) || searchRadios(query, (g) => t(`music:genres.${g}`))[0];
    if (!radio) throw new MusicError('radioNotFound', { query: query.slice(0, 100) });
    const front = interaction.options.getBoolean('next') === true;
    return enqueueAndPlay(interaction, ctx, async () => [{ title: radio.name, url: radio.url, live: true, kind: 'radio', radioId: radio.id }], { front });
  })
};
