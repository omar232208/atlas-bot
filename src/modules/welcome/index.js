'use strict';

const { ChannelType } = require('discord.js');
const { SETTINGS } = require('./lib/config');
const { MAX_LENGTH } = require('./lib/template');
const { createGreetingCommand } = require('./commands/greeting');
const { sendToChannel, sendDm } = require('./lib/send');

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const field = (path, type, label, extra = {}) => ({ path, type, label: `welcome:dashboard.fields.${label}`, default: SETTINGS[path], ...extra });

/** Web dashboard schema; every path is a key of SETTINGS (the paths the code reads). */
const dashboard = {
  sections: [
    {
      id: 'welcome',
      title: 'welcome:dashboard.welcome.title',
      description: 'welcome:dashboard.welcome.description',
      fields: [
        field('welcome.enabled', 'boolean', 'enabled'),
        field('welcome.channelId', 'channel', 'channel', { channelTypes: TEXT_TYPES }),
        field('welcome.message', 'text', 'message', { help: 'welcome:dashboard.fields.messageHelp', maxLength: MAX_LENGTH }),
        field('welcome.embed', 'boolean', 'embed'),
        field('welcome.dmEnabled', 'boolean', 'dmEnabled'),
        field('welcome.dmMessage', 'text', 'dmMessage', { help: 'welcome:dashboard.fields.messageHelp', maxLength: MAX_LENGTH })
      ]
    },
    {
      id: 'goodbye',
      title: 'welcome:dashboard.goodbye.title',
      fields: [
        field('goodbye.enabled', 'boolean', 'enabled'),
        field('goodbye.channelId', 'channel', 'channel', { channelTypes: TEXT_TYPES }),
        field('goodbye.message', 'text', 'message', { help: 'welcome:dashboard.fields.messageHelp', maxLength: MAX_LENGTH }),
        field('goodbye.embed', 'boolean', 'embed')
      ]
    },
    {
      id: 'autorole',
      title: 'welcome:dashboard.autorole.title',
      description: 'welcome:dashboard.autorole.description',
      fields: [
        field('autorole.humans', 'roles', 'humans'),
        field('autorole.bots', 'roles', 'bots')
      ]
    }
  ],
  actions: [
    {
      id: 'test',
      label: 'welcome:dashboard.actions.test',
      /** Sends the welcome message (and DM if enabled) for the dashboard user. */
      async run(ctx, guild, actorUserId) {
        const member = await guild.members.fetch(actorUserId).catch(() => null);
        if (!member) return 'welcome:dashboard.results.notMember';
        const result = await sendToChannel(ctx, member, 'welcome', { force: true }).catch(() => ({ ok: false, reason: 'error' }));
        if (!result.ok) return result.reason === 'noChannel' ? 'welcome:dashboard.results.noChannel' : 'welcome:dashboard.results.failed';
        if (ctx.store.guild(guild.id).get('welcome.dmEnabled', SETTINGS['welcome.dmEnabled'])) await sendDm(ctx, member, { force: true });
        return 'welcome:dashboard.results.sent';
      }
    }
  ]
};

module.exports = {
  name: 'welcome',
  commands: [createGreetingCommand('welcome'), createGreetingCommand('goodbye'), require('./commands/autorole')],
  events: [...require('./events/members')],
  components: [],
  dashboard
};
