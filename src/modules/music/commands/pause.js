'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe, guard, respond } = require('../lib/runtime');
const { MusicError } = require('../lib/source');

/** /pause: pauses the current track (anyone in the channel may pause). */
module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause the music'),
  execute: safe(async (interaction, ctx) => {
    const { player } = guard(interaction, ctx, { playing: true });
    if (player.paused) throw new MusicError('alreadyPaused');
    player.pause();
    player.autoPaused = false;
    return respond(interaction, { embeds: [ctx.embeds.success(ctx.t(interaction, 'music:pause.done'), ctx.t(interaction, 'music:pause.hint'))] });
  })
};
