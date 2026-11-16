'use strict';

const { Events, ChannelType } = require('discord.js');
const { SETTINGS, KICK_JOB, KICK_MAX_MS } = require('./lib/config');
const { MIN_LENGTH, MAX_LENGTH } = require('./lib/captcha');
const flow = require('./lib/flow');

const field = (path, type, label, extra = {}) => ({ path, type, label: `verification:dashboard.fields.${label}`, help: `verification:dashboard.help.${label}`, default: SETTINGS[path], ...extra });

/** Web dashboard schema; every path is a key of SETTINGS (verification.messageId is internal). */
const dashboard = {
  sections: [
    {
      id: 'verification',
      title: 'verification:dashboard.main.title',
      description: 'verification:dashboard.main.description',
      fields: [
        field('verification.enabled', 'boolean', 'enabled'),
        field('verification.roleId', 'role', 'role'),
        field('verification.unverifiedRoleId', 'role', 'unverifiedRole'),
        field('verification.channelId', 'channel', 'channel', { channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement] }),
        field('verification.kickAfter', 'duration', 'kickAfter', { min: 0, max: KICK_MAX_MS }),
        field('verification.codeLength', 'number', 'codeLength', { min: MIN_LENGTH, max: MAX_LENGTH }),
        field('verification.maxAttempts', 'number', 'maxAttempts', { min: 1, max: 10 }),
        field('verification.panelMessage', 'text', 'panelMessage', { maxLength: 1500 })
      ]
    }
  ],
  actions: [
    {
      id: 'panel',
      label: 'verification:dashboard.actions.panel',
      /** Posts the panel again (needed after changing the channel or the text). */
      async run(ctx, guild) {
        if (!ctx.store.guild(guild.id).get('verification.enabled', SETTINGS['verification.enabled'])) return 'verification:errors.notEnabled';
        const res = await flow.postPanel(ctx, guild).catch(() => ({ ok: false }));
        return res.ok ? 'verification:dashboard.results.posted' : 'verification:errors.panelFailed';
      }
    }
  ]
};

module.exports = {
  name: 'verification',
  commands: [require('./commands/verification')],
  events: [
    { event: Events.GuildMemberAdd, execute: (ctx, member) => flow.onJoin(ctx, member) },
    { event: Events.GuildMemberRemove, execute: (ctx, member) => flow.onLeave(ctx, member) }
  ],
  components: [{ prefix: flow.PREFIX, execute: (interaction, ctx) => flow.handleComponent(interaction, ctx) }],
  dashboard,
  /**
   * Registers the persistent kick job handler (jobs survive restarts).
   * @param {import('discord.js').Client} client
   * @param {object} ctx
   */
  init(client, ctx) {
    ctx.scheduler.on(KICK_JOB, (payload) => flow.runKick(client, ctx, payload));
  }
};
