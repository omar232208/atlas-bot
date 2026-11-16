'use strict';

const { Events } = require('discord.js');
const { getPlayer } = require('../lib/runtime');

/**
 * Tracks listeners of the bot's voice channel: alone → pause and leave after
 * 2 minutes (unless 24/7), someone back → resume.
 */
module.exports = {
  event: Events.VoiceStateUpdate,
  execute(ctx, oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const player = guild && getPlayer(guild.id);
    if (!player || player.destroyed) return;
    const channelId = player.channelId;
    if (!channelId) return;
    const meId = guild.members.me?.id;
    const concerned = newState.id === meId || oldState.channelId === channelId || newState.channelId === channelId;
    if (!concerned) return;
    const channel = guild.channels.cache.get(channelId);
    const humans = channel?.members?.filter((m) => !m.user.bot).size ?? 0;
    player.updateListeners(humans);
  }
};
