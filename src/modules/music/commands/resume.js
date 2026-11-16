'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe, guard, respond } = require('../lib/runtime');
const { MusicError } = require('../lib/source');

/** /resume: resumes a paused track. */
module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Resume the music'),
  execute: safe(async (interaction, ctx) => {
    const { player } = guard(interaction, ctx, { playing: true });
    if (!player.paused) throw new MusicError('notPaused');
    player.resume();
    return respond(interaction, { embeds: [ctx.embeds.success(ctx.t(interaction, 'music:resume.done'))] });
  })
};
