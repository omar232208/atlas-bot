'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe, guard, respond } = require('../lib/runtime');
const { MusicError } = require('../lib/source');
const { parseTime, formatTime } = require('../lib/logic');

/** /seek <position>: "1:30", "90", "2m10s", or relative "+30" / "-10". */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Go to a position in the track')
    .addStringOption((o) => o.setName('position').setDescription('e.g. 1:30, 90, +30, -10').setRequired(true).setMaxLength(20)),
  cooldown: 3,
  execute: safe(async (interaction, ctx) => {
    const { player } = guard(interaction, ctx, { playing: true, dj: true });
    const track = player.queue.current;
    if (track.live) throw new MusicError('seekLive');
    const parsed = parseTime(interaction.options.getString('position', true));
    if (!parsed) throw new MusicError('badTime');
    let target = parsed.relative ? player.position + parsed.ms : parsed.ms;
    target = Math.max(0, target);
    if (track.durationMs && target >= track.durationMs) throw new MusicError('seekBeyond', { duration: formatTime(track.durationMs) });
    await interaction.deferReply();
    await player.seek(target);
    return respond(interaction, { embeds: [ctx.embeds.success(ctx.t(interaction, 'music:seek.done'), ctx.t(interaction, 'music:seek.details', { position: formatTime(target) }))] });
  })
};
