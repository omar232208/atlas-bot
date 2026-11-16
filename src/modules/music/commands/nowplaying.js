'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe, getPlayer, respond } = require('../lib/runtime');
const { MusicError } = require('../lib/source');
const { nowPlayingPayload } = require('../lib/ui');

/** /nowplaying: current track with progress bar and control buttons. */
module.exports = {
  data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the current track'),
  execute: safe(async (interaction, ctx) => {
    const player = getPlayer(interaction.guildId);
    if (!player?.queue.current) throw new MusicError('nothingPlaying');
    return respond(interaction, nowPlayingPayload(player, interaction));
  })
};
