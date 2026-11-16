'use strict';

const { ChannelType } = require('discord.js');
const { CATEGORIES, PATHS, DEFAULTS, channelIdFor, createSender } = require('./lib/config');
const invites = require('./lib/invites');
const inviteEvents = require('./events/invites');

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

/**
 * Settings shown by the web dashboard; paths are the ones lib/config.js reads.
 */
const dashboard = {
  sections: [
    {
      id: 'channels',
      title: 'logs:dashboard.channels.title',
      description: 'logs:dashboard.channels.description',
      fields: CATEGORIES.map((c) => ({ path: PATHS.channel(c), type: 'channel', label: `logs:categories.${c}`, help: `logs:dashboard.help.${c}`, default: null, channelTypes: TEXT_TYPES }))
    },
    {
      id: 'filters',
      title: 'logs:dashboard.filters.title',
      fields: [
        { path: PATHS.ignored, type: 'channels', label: 'logs:dashboard.filters.ignored', help: 'logs:dashboard.filters.ignoredHelp', default: DEFAULTS.ignored },
        { path: PATHS.ignoreBots, type: 'boolean', label: 'logs:dashboard.filters.ignoreBots', help: 'logs:dashboard.filters.ignoreBotsHelp', default: DEFAULTS.ignoreBots }
      ]
    }
  ],
  actions: [
    {
      id: 'test',
      label: 'logs:dashboard.actions.test',
      /** Sends one test entry to each distinct configured channel. */
      async run(ctx, guild) {
        const get = ctx.store.guild(guild.id).get;
        const seen = new Set();
        let sent = 0;
        for (const c of CATEGORIES) {
          const id = channelIdFor(get, c);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const embed = ctx.embeds.info(ctx.t(guild, 'logs:test.title'), ctx.t(guild, 'logs:test.description', { category: ctx.t(guild, `logs:categories.${c}`) }));
          if (await ctx.modlog.send(guild, c, embed)) sent++;
        }
        if (!seen.size) return 'logs:test.none';
        return sent === seen.size ? 'logs:test.ok' : 'logs:test.partial';
      }
    }
  ]
};

module.exports = {
  name: 'logs',
  commands: [require('./commands/logs')],
  events: [
    ...require('./events/messages'),
    ...require('./events/members'),
    ...require('./events/moderation'),
    ...require('./events/server'),
    ...require('./events/voice'),
    ...inviteEvents
  ],
  components: [],
  dashboard,
  /** Public helpers for other modules (utility /invites reads the leaderboard). */
  invites: { getInviteStats: invites.getInviteStats },
  /**
   * Installs the real ctx.modlog implementation. If the client is already
   * ready (init after login) the invite cache is filled right away, since the
   * ClientReady event will not fire again.
   * @param {import('discord.js').Client} client
   * @param {object} ctx
   */
  init(client, ctx) {
    ctx.modlog.setImplementation(createSender({ store: ctx.store, logger: ctx.logger.child ? ctx.logger.child('logs') : ctx.logger }));
    if (client.isReady?.()) inviteEvents.cacheAll(client).catch(() => {});
  }
};
