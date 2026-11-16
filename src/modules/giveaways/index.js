'use strict';

/**
 * Giveaways: a button-entry giveaway posted in a channel, with optional role
 * and account-age requirements. The end time is a persistent scheduler job,
 * so a giveaway still ends on time after a restart.
 */
const { DEFAULTS, LIMITS } = require('./lib/logic');
const { endGiveaway } = require('./lib/finish');
const { enterComponent } = require('./components/enter');

/** Scheduler job type that ends a giveaway. */
const END_JOB = 'giveaways:end';

module.exports = {
  name: 'giveaways',
  commands: [require('./commands/giveaway')],
  events: [],
  components: [enterComponent],
  /**
   * Registers the end job handler; runs before the scheduler starts.
   * @param {import('discord.js').Client} client
   * @param {object} ctx
   */
  init(client, ctx) {
    ctx.scheduler.on(END_JOB, (payload) => endGiveaway(ctx, client, payload.guildId, payload.giveawayId)
      .catch((err) => ctx.logger.error('giveaway end failed:', err)));
  },
  /** Dashboard schema; paths are read by getConfig() in lib/logic.js. */
  dashboard: {
    sections: [
      {
        id: 'general',
        title: 'giveaways:dashboard.general.title',
        description: 'giveaways:dashboard.general.description',
        fields: [
          { path: 'giveaways.config.maxDays', type: 'number', label: 'giveaways:dashboard.general.maxDays.label', help: 'giveaways:dashboard.general.maxDays.help', default: DEFAULTS.maxDays, min: LIMITS.maxDays[0], max: LIMITS.maxDays[1] },
          { path: 'giveaways.config.dmWinners', type: 'boolean', label: 'giveaways:dashboard.general.dmWinners.label', help: 'giveaways:dashboard.general.dmWinners.help', default: DEFAULTS.dmWinners }
        ]
      }
    ]
  }
};
