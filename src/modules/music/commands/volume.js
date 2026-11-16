'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe, guard, getPlayer, respond } = require('../lib/runtime');
const { MusicError } = require('../lib/source');

/**
 * /volume [level]: shows or sets the volume (0-150 %). ffmpeg applies it, so
 * the current track restarts at the same position.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Show or change the volume')
    .addIntegerOption((o) => o.setName('level').setDescription('Volume in percent (0-150)').setMinValue(0).setMaxValue(150)),
  cooldown: 3,
  execute: safe(async (interaction, ctx) => {
    const level = interaction.options.getInteger('level');
    const t = (k, v) => ctx.t(interaction, k, v);
    if (level === null) {
      const player = getPlayer(interaction.guildId);
      if (!player) throw new MusicError('notConnected');
      return respond(interaction, { embeds: [ctx.embeds.info(t('music:volume.title'), t('music:volume.current', { volume: player.volume }))] });
    }
    const { player } = guard(interaction, ctx, { dj: true });
    if (!player) throw new MusicError('notConnected');
    await interaction.deferReply();
    await player.setVolume(level);
    return respond(interaction, { embeds: [ctx.embeds.success(t('music:volume.title'), t('music:volume.set', { volume: player.volume }))] });
  })
};
