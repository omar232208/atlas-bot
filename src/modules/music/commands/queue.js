'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { paginate } = require('../../../core/paginate');
const { safe, guard, getPlayer, respond, isDJ } = require('../lib/runtime');
const { MusicError } = require('../lib/source');
const { queuePages, trackTitle } = require('../lib/ui');

const ok = (interaction, ctx, key, vars) => respond(interaction, { embeds: [ctx.embeds.success(ctx.t(interaction, `music:queue.${key}.done`), ctx.t(interaction, `music:queue.${key}.details`, vars))] });

const handlers = {
  /** Paginated list, readable from anywhere in the server. */
  async view(interaction) {
    const player = getPlayer(interaction.guildId);
    if (!player?.queue.current && !player?.queue.size) throw new MusicError('nothingPlaying');
    const pages = queuePages(player, interaction);
    if (pages.length === 1) return respond(interaction, { embeds: pages });
    return paginate(interaction, pages);
  },

  /** DJ, or the member who added the track. */
  async remove(interaction, ctx) {
    const { player, cfg, member } = guard(interaction, ctx, { playing: true });
    const position = interaction.options.getInteger('position', true);
    const target = player.queue.tracks[position - 1];
    if (!target) throw new MusicError('badPosition', { max: player.queue.size });
    if (target.requesterId !== member.id && !isDJ(member, cfg)) throw new MusicError('djOnly', { role: `<@&${cfg.djRole}>` });
    const removed = player.queue.remove(position);
    return ok(interaction, ctx, 'remove', { title: trackTitle(removed), position });
  },

  async move(interaction, ctx) {
    const { player } = guard(interaction, ctx, { playing: true, dj: true });
    const from = interaction.options.getInteger('from', true);
    const to = interaction.options.getInteger('to', true);
    const moved = player.queue.move(from, to);
    if (!moved) throw new MusicError('badPosition', { max: player.queue.size });
    return ok(interaction, ctx, 'move', { title: trackTitle(moved), from, to });
  },

  /** Empties the upcoming tracks; the current one keeps playing. */
  async clear(interaction, ctx) {
    const { player } = guard(interaction, ctx, { playing: true, dj: true });
    if (!player.queue.size) throw new MusicError('queueEmpty');
    return ok(interaction, ctx, 'clear', { count: player.queue.clear() });
  },

  async shuffle(interaction, ctx) {
    const { player } = guard(interaction, ctx, { playing: true, dj: true });
    if (player.queue.size < 2) throw new MusicError('queueTooShort');
    return ok(interaction, ctx, 'shuffle', { count: player.queue.shuffle() });
  }
};

/** /queue view|remove|move|clear|shuffle */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show or edit the music queue')
    .addSubcommand((s) => s.setName('view').setDescription('Show the queue'))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a track')
      .addIntegerOption((o) => o.setName('position').setDescription('Position in the queue').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('move').setDescription('Move a track')
      .addIntegerOption((o) => o.setName('from').setDescription('Current position').setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName('to').setDescription('New position').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('clear').setDescription('Clear the upcoming tracks'))
    .addSubcommand((s) => s.setName('shuffle').setDescription('Shuffle the queue')),
  execute: safe(async (interaction, ctx) => handlers[interaction.options.getSubcommand()](interaction, ctx))
};
