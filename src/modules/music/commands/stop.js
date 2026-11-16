'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe, guard, respond } = require('../lib/runtime');

/** /stop: stops playback and empties the queue (the bot stays until idle). */
module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stop the music and clear the queue'),
  execute: safe(async (interaction, ctx) => {
    const { player } = guard(interaction, ctx, { playing: true, dj: true });
    const removed = player.queue.size;
    player.stop();
    return respond(interaction, { embeds: [ctx.embeds.success(ctx.t(interaction, 'music:stop.done'), ctx.t(interaction, 'music:stop.details', { count: removed }))] });
  })
};
