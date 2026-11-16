'use strict';

const { SETTINGS } = require('./settings');
const poll = require('./poll');
const remind = require('./commands/remind');
const logger = require('../../core/logger').child('utility');

/**
 * Scheduler handler for reminders. Posts in the channel where the reminder was
 * asked; if that channel is gone, the reminder is sent in direct messages so it
 * is not silently lost.
 * @param {import('discord.js').Client} client
 * @param {object} ctx
 * @param {{guildId: string, channelId: string, userId: string, text: string}} payload
 */
async function deliverReminder(client, ctx, payload) {
  const { t, embeds } = ctx;
  const lang = { guildId: payload.guildId };
  const embed = embeds.info(t(lang, 'utility:remind.reminderTitle'), payload.text);
  const content = t(lang, 'utility:remind.ping', { user: `<@${payload.userId}>` });
  const channel = await client.channels.fetch(payload.channelId).catch(() => null);
  if (channel?.isTextBased?.()) {
    await channel.send({ content, embeds: [embed], allowedMentions: { users: [payload.userId] } }).catch((err) => logger.warn('reminder not posted:', err.message));
    return;
  }
  const user = await client.users.fetch(payload.userId).catch(() => null);
  await user?.send({ content, embeds: [embed] }).catch((err) => logger.warn('reminder not sent:', err.message));
}

module.exports = {
  name: 'utility',
  commands: [
    require('./commands/info'),
    require('./commands/poll'),
    remind,
    require('./commands/say'),
    require('./commands/embed'),
    require('./commands/snipe')
  ],
  events: [require('./events/messageDelete')],
  // Poll buttons only: "utl:poll:<pollId>:<option>". The poll itself is in the store.
  components: [{ prefix: 'utl:poll:', execute: (interaction, ctx) => poll.vote(interaction, ctx) }],
  /** Starts the scheduled jobs that need the Discord client (poll end, reminders). */
  init(client, ctx) {
    ctx.scheduler.on(poll.JOB_END, (payload) => poll.endPoll(ctx, client, payload));
    ctx.scheduler.on(remind.JOB_REMIND, (payload) => deliverReminder(client, ctx, payload));
  },
  dashboard: {
    sections: [
      {
        id: 'snipe',
        title: 'utility:dashboard.snipe.title',
        description: 'utility:dashboard.snipe.description',
        fields: [
          { path: 'utility.snipe.enabled', type: 'boolean', label: 'utility:dashboard.snipe.enabled.label', help: 'utility:dashboard.snipe.enabled.help', default: SETTINGS['utility.snipe.enabled'].default }
        ]
      },
      {
        id: 'remind',
        title: 'utility:dashboard.remind.title',
        description: 'utility:dashboard.remind.description',
        fields: [
          {
            path: 'utility.remind.maxDays',
            type: 'number',
            label: 'utility:dashboard.remind.maxDays.label',
            help: 'utility:dashboard.remind.maxDays.help',
            default: SETTINGS['utility.remind.maxDays'].default,
            min: SETTINGS['utility.remind.maxDays'].min,
            max: SETTINGS['utility.remind.maxDays'].max
          }
        ]
      }
    ]
  }
};
