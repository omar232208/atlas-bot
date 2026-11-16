'use strict';

const crypto = require('node:crypto');
const { guard, ensureConnected, respond } = require('./runtime');
const { MusicError } = require('./source');
const { nowPlayingPayload, trackTitle, durationLabel } = require('./ui');

/**
 * Builds a queue entry. Only plain data (IDs, URLs) is kept so a track can be
 * persisted for 24/7 sessions.
 * @param {object} base { title, url, urls?, live?, durationMs?, contentLength?, kind, radioId? }
 * @param {import('discord.js').Interaction} interaction
 */
function makeTrack(base, interaction) {
  return {
    id: crypto.randomUUID(),
    title: base.title,
    url: base.url,
    urls: base.urls?.length ? base.urls : [base.url],
    live: !!base.live,
    durationMs: base.durationMs || null,
    contentLength: base.contentLength || null,
    kind: base.kind || 'url',
    radioId: base.radioId || null,
    requesterId: interaction.user.id,
    textChannelId: interaction.channelId,
    addedAt: Date.now()
  };
}

/**
 * Shared end of /play and /radio: checks the caller, resolves the tracks
 * (the resolver may hit the network, so the reply is deferred first), joins,
 * enqueues within the queue limit and starts playback when idle.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} ctx
 * @param {() => Promise<object[]>} resolve Returns base track objects.
 * @param {{front?: boolean}} [opts]
 */
async function enqueueAndPlay(interaction, ctx, resolve, opts = {}) {
  const { cfg } = guard(interaction, ctx);
  await interaction.deferReply();
  const bases = await resolve();
  if (!bases.length) throw new MusicError('emptyPlaylist');
  const player = await ensureConnected(interaction, ctx);

  const space = cfg.maxQueue - player.queue.size;
  if (space <= 0) throw new MusicError('queueFull', { max: cfg.maxQueue });
  const tracks = bases.slice(0, space).map((b) => makeTrack(b, interaction));
  const dropped = bases.length - tracks.length;
  const t = (key, vars) => ctx.t(interaction, key, vars);

  if (!player.queue.current) {
    player.queue.add(tracks, { front: true });
    player.queue.next({ skip: true });
    await player.start({ awaited: true });
    const payload = nowPlayingPayload(player, interaction, { compact: true });
    if (tracks.length > 1) payload.embeds[0].setFooter({ text: t('music:play.addedMany', { count: tracks.length - 1 }) });
    if (dropped > 0) payload.embeds.push(ctx.embeds.warn(t('music:play.truncatedTitle'), t('music:play.truncated', { count: dropped, max: cfg.maxQueue })));
    return respond(interaction, payload);
  }

  const position = player.queue.add(tracks, { front: opts.front });
  const first = tracks[0];
  const embed = tracks.length === 1
    ? ctx.embeds.success(t('music:play.addedTitle'), t('music:play.added', { title: trackTitle(first), position, duration: durationLabel(interaction, first) }))
    : ctx.embeds.success(t('music:play.addedTitle'), t('music:play.addedPlaylist', { count: tracks.length, position }));
  const reply = { embeds: [embed] };
  if (dropped > 0) reply.embeds.push(ctx.embeds.warn(t('music:play.truncatedTitle'), t('music:play.truncated', { count: dropped, max: cfg.maxQueue })));
  return respond(interaction, reply);
}

module.exports = { makeTrack, enqueueAndPlay };
