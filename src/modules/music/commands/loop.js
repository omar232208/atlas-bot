'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe, guard, respond } = require('../lib/runtime');
const { LOOP_MODES } = require('../lib/logic');

/** /loop off|track|queue */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Repeat the track or the queue')
    .addStringOption((o) => o.setName('mode').setDescription('Loop mode').setRequired(true)
      .addChoices(...LOOP_MODES.map((m) => ({ name: m, value: m })))),
  execute: safe(async (interaction, ctx) => {
    const { player } = guard(interaction, ctx, { playing: true, dj: true });
    const mode = interaction.options.getString('mode', true);
    player.queue.loop = LOOP_MODES.includes(mode) ? mode : 'off';
    const t = (k, v) => ctx.t(interaction, k, v);
    return respond(interaction, { embeds: [ctx.embeds.success(t('music:loop.done'), t(`music:loop.${player.queue.loop}`))] });
  })
};
