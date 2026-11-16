'use strict';

const { safe, guard, getPlayer } = require('./runtime');
const { MusicError } = require('./source');
const { PREFIX, nowPlayingPayload } = require('./ui');
const { cycleLoop } = require('./logic');

/**
 * Buttons of the "now playing" messages (mus:pause, mus:skip, mus:stop,
 * mus:loop, mus:refresh). Same rules as the commands: the clicker must be in
 * the bot's channel, and skip/stop/loop need DJ rights (own track for skip).
 * They stay valid after a restart because they only carry the action name.
 */
const controls = {
  prefix: PREFIX,
  execute: safe(async (interaction, ctx) => {
    const action = interaction.customId.slice(PREFIX.length);
    const t = (k, v) => ctx.t(interaction, k, v);
    if (action === 'refresh') {
      const player = getPlayer(interaction.guildId);
      if (!player?.queue.current) return interaction.update({ embeds: [ctx.embeds.info(t('music:nowplaying.title'), t('music:errors.nothingPlaying'))], components: [] });
      return interaction.update(nowPlayingPayload(player, interaction));
    }
    const current = getPlayer(interaction.guildId)?.queue.current;
    const rules = { pause: {}, skip: { dj: true, ownTrack: current }, stop: { dj: true }, loop: { dj: true } }[action];
    if (!rules) throw new MusicError('unexpected');
    const { player } = guard(interaction, ctx, { playing: true, ...rules });

    if (action === 'pause') {
      if (player.paused) player.resume();
      else { player.pause(); player.autoPaused = false; }
    } else if (action === 'skip') {
      player.skip();
    } else if (action === 'loop') {
      player.queue.loop = cycleLoop(player.queue.loop);
    } else if (action === 'stop') {
      player.stop();
      return interaction.update({ embeds: [ctx.embeds.success(t('music:stop.done'), t('music:stop.by', { user: `<@${interaction.user.id}>` }))], components: [] });
    }
    if (!player.queue.current) return interaction.update({ embeds: [ctx.embeds.info(t('music:nowplaying.title'), t('music:skip.queueEnded'))], components: [] });
    return interaction.update(nowPlayingPayload(player, interaction));
  })
};

module.exports = { controls };
