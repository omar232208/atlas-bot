'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { safe, guard, respond, getPlayer } = require('../lib/runtime');
const { MusicError } = require('../lib/source');
const { trackTitle } = require('../lib/ui');

/**
 * /skip [to]: next track, or jump to a queue position. The requester of the
 * current track may skip it without DJ rights.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current track')
    .addIntegerOption((o) => o.setName('to').setDescription('Jump to this queue position').setMinValue(1)),
  execute: safe(async (interaction, ctx) => {
    const to = interaction.options.getInteger('to');
    const current = getPlayer(interaction.guildId)?.queue.current;
    const { player } = guard(interaction, ctx, { playing: true, dj: true, ownTrack: to ? null : current });
    if (to && to > player.queue.size) throw new MusicError('badPosition', { max: player.queue.size });
    const skipped = player.queue.current;
    const next = player.skip(to || undefined);
    const t = (k, v) => ctx.t(interaction, k, v);
    const description = next
      ? t('music:skip.next', { skipped: trackTitle(skipped), next: trackTitle(next) })
      : t('music:skip.end', { skipped: trackTitle(skipped) });
    return respond(interaction, { embeds: [ctx.embeds.success(t('music:skip.done'), description)] });
  })
};
