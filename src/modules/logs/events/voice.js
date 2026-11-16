'use strict';

const { Events } = require('discord.js');
const { isIgnoredChannel } = require('../lib/config');
const { userLabel } = require('../lib/format');

/**
 * Picks the kind of voice change worth logging, or null.
 * Exported for tests: it is pure and only looks at ids / flags.
 * @param {{channelId: string|null, serverMute?: boolean, serverDeaf?: boolean, streaming?: boolean}} before
 * @param {{channelId: string|null, serverMute?: boolean, serverDeaf?: boolean, streaming?: boolean}} after
 * @returns {'join'|'leave'|'move'|'mute'|'unmute'|'deaf'|'undeaf'|null}
 */
function voiceChange(before, after) {
  if (!before.channelId && after.channelId) return 'join';
  if (before.channelId && !after.channelId) return 'leave';
  if (before.channelId !== after.channelId) return 'move';
  if (!before.serverMute && after.serverMute) return 'mute';
  if (before.serverMute && !after.serverMute) return 'unmute';
  if (!before.serverDeaf && after.serverDeaf) return 'deaf';
  if (before.serverDeaf && !after.serverDeaf) return 'undeaf';
  return null;
}

module.exports = [
  {
    event: Events.VoiceStateUpdate,
    async execute(ctx, oldState, newState) {
      const kind = voiceChange(oldState, newState);
      if (!kind) return;
      const g = newState.guild;
      const get = ctx.store.guild(g.id).get;
      if (isIgnoredChannel(get, newState.channelId) || isIgnoredChannel(get, oldState.channelId)) return;
      const member = newState.member || oldState.member;
      if (!member) return;
      const { t } = ctx;
      const vars = { user: userLabel(member.user), from: `<#${oldState.channelId}>`, to: `<#${newState.channelId}>`, channel: `<#${newState.channelId || oldState.channelId}>` };
      await ctx.modlog.send(g, 'voice', ctx.embeds.base({
        title: t(g, `logs:events.voice.${kind}`),
        description: t(g, `logs:events.voice.${kind}Desc`, vars)
      }));
    }
  }
];
module.exports.voiceChange = voiceChange;
