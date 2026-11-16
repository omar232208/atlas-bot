'use strict';

/**
 * Levels: XP for messages (with a cooldown), the MEE6 level curve, /rank and
 * /leaderboard, and role rewards per level. Off until an admin enables it.
 */
const { ChannelType } = require('discord.js');
const { DEFAULTS, LIMITS } = require('./lib/settings');

module.exports = {
  name: 'levels',
  commands: [require('./commands/rank'), require('./commands/leaderboard'), require('./commands/levels')],
  events: [require('./events/messageCreate')],
  components: [],
  /** Dashboard schema; each path is read through lib/settings.js. */
  dashboard: {
    sections: [
      {
        id: 'general',
        title: 'levels:dashboard.general.title',
        description: 'levels:dashboard.general.description',
        fields: [
          { path: 'levels.enabled', type: 'boolean', label: 'levels:dashboard.general.enabled.label', help: 'levels:dashboard.general.enabled.help', default: false },
          { path: 'levels.config.cooldown', type: 'number', label: 'levels:dashboard.general.cooldown.label', help: 'levels:dashboard.general.cooldown.help', default: DEFAULTS.cooldown, min: LIMITS.cooldown[0], max: LIMITS.cooldown[1] },
          { path: 'levels.config.xpMin', type: 'number', label: 'levels:dashboard.general.xpMin.label', help: 'levels:dashboard.general.xpMin.help', default: DEFAULTS.xpMin, min: LIMITS.xpMin[0], max: LIMITS.xpMin[1] },
          { path: 'levels.config.xpMax', type: 'number', label: 'levels:dashboard.general.xpMax.label', help: 'levels:dashboard.general.xpMax.help', default: DEFAULTS.xpMax, min: LIMITS.xpMax[0], max: LIMITS.xpMax[1] },
          { path: 'levels.config.announce', type: 'boolean', label: 'levels:dashboard.general.announce.label', help: 'levels:dashboard.general.announce.help', default: DEFAULTS.announce },
          { path: 'levels.config.announceChannel', type: 'channel', label: 'levels:dashboard.general.announceChannel.label', help: 'levels:dashboard.general.announceChannel.help', default: DEFAULTS.announceChannel, channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement] }
        ]
      }
    ]
  }
};
