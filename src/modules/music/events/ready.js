'use strict';

const crypto = require('node:crypto');
const { Events } = require('discord.js');
const { obtainPlayer } = require('../lib/runtime');
const { getConfig } = require('../lib/config');

/**
 * Restores 24/7 sessions after a restart: rejoins the saved channel and resumes
 * the radio that was playing. Guilds are handled one after another to avoid a
 * burst of voice connections and ffmpeg processes at startup.
 */
module.exports = {
  event: Events.ClientReady,
  once: true,
  async execute(ctx, client) {
    for (const guild of client.guilds.cache.values()) {
      const store = ctx.store.guild(guild.id);
      const session = store.get('music.session');
      if (!session) continue;
      if (!getConfig(ctx.store, guild.id).stay247) { store.delete('music.session'); continue; }
      const channel = guild.channels.cache.get(session.channelId);
      if (!channel?.isVoiceBased?.() || !channel.joinable) { store.delete('music.session'); continue; }
      try {
        const player = obtainPlayer(guild, ctx);
        player.lastTextChannelId = session.textChannelId;
        await player.connect(channel);
        if (session.track?.url) {
          player.queue.add({ ...session.track, id: crypto.randomUUID(), requesterId: client.user.id, textChannelId: session.textChannelId, addedAt: Date.now() });
          player.queue.next({ skip: true });
          await player.start();
        }
        const humans = channel.members.filter((m) => !m.user.bot).size;
        player.updateListeners(humans);
        ctx.logger.info(`[music] 24/7 session restored in ${guild.id}`);
      } catch (err) {
        ctx.logger.warn(`[music] could not restore the 24/7 session of ${guild.id}:`, err.message || err.code);
      }
    }
  }
};
