'use strict';

/**
 * Economy: wallet and bank, daily/weekly/work income, transfers, robbery, a
 * shop that can grant roles, and three games (coinflip, slots, blackjack).
 * Balances live in the guild store under economy.users.<id>.
 */
const { DEFAULTS, LIMITS } = require('./lib/config');
const flow = require('./lib/blackjack-flow');
const { blackjackComponent } = require('./components/blackjack');

const { groupCommand } = require('./lib/group');

// Discord allows 100 top-level commands per bot. Economy uses 7: the everyday
// commands stay top level, and related ones are grouped under /bank, /gamble and /eco.
const bank = require('./commands/bank');
const gamble = groupCommand({
  name: 'gamble',
  description: 'Gambling games',
  leaves: [require('./commands/coinflip'), require('./commands/slots'), require('./commands/blackjack')]
});
const eco = groupCommand({
  name: 'eco',
  description: 'Economy: rewards, robbery, inventory and settings',
  leaves: [
    require('./commands/daily'),
    require('./commands/weekly'),
    require('./commands/rob'),
    require('./commands/inventory'),
    require('./commands/richest'),
    require('./commands/config')
  ]
});
const bankGroup = groupCommand({ name: 'bank', description: 'Deposit and withdraw coins', leaves: [bank.deposit, bank.withdraw] });

/**
 * Dashboard schema: each path is the exact store path the code reads through
 * getConfig(), defaults and limits come from the same constants.
 */
const ECONOMY_FIELDS = [
  { path: 'economy.config.currency', type: 'string', label: 'economy:dashboard.general.currency.label', help: 'economy:dashboard.general.currency.help', default: DEFAULTS.currency, maxLength: 24 },
  { path: 'economy.config.symbol', type: 'string', label: 'economy:dashboard.general.symbol.label', help: 'economy:dashboard.general.symbol.help', default: DEFAULTS.symbol, maxLength: 8 },
  { path: 'economy.config.daily', type: 'number', label: 'economy:dashboard.general.daily.label', help: 'economy:dashboard.general.daily.help', default: DEFAULTS.daily, min: LIMITS.daily[0], max: LIMITS.daily[1] },
  { path: 'economy.config.weekly', type: 'number', label: 'economy:dashboard.general.weekly.label', help: 'economy:dashboard.general.weekly.help', default: DEFAULTS.weekly, min: LIMITS.weekly[0], max: LIMITS.weekly[1] },
  { path: 'economy.config.workMin', type: 'number', label: 'economy:dashboard.general.workMin.label', help: 'economy:dashboard.general.workMin.help', default: DEFAULTS.workMin, min: LIMITS.workMin[0], max: LIMITS.workMin[1] },
  { path: 'economy.config.workMax', type: 'number', label: 'economy:dashboard.general.workMax.label', help: 'economy:dashboard.general.workMax.help', default: DEFAULTS.workMax, min: LIMITS.workMax[0], max: LIMITS.workMax[1] },
  { path: 'economy.config.robFailPercent', type: 'number', label: 'economy:dashboard.general.robFailPercent.label', help: 'economy:dashboard.general.robFailPercent.help', default: DEFAULTS.robFailPercent, min: LIMITS.robFailPercent[0], max: LIMITS.robFailPercent[1] }
];

module.exports = {
  name: 'economy',
  commands: [
    require('./commands/balance'),
    require('./commands/work'),
    require('./commands/pay'),
    bankGroup,
    require('./commands/shop'),
    gamble,
    eco
  ],
  events: [],
  components: [blackjackComponent],
  /**
   * Registers the blackjack idle-timeout job. Runs once at startup, before the
   * scheduler is started, so stored jobs find their handler.
   * @param {import('discord.js').Client} client
   * @param {object} ctx
   */
  init(client, ctx) {
    ctx.scheduler.on(flow.TIMEOUT_JOB, (payload) => flow.timeout(payload, client, ctx));
  },
  dashboard: {
    sections: [
      {
        id: 'general',
        title: 'economy:dashboard.general.title',
        description: 'economy:dashboard.general.description',
        fields: ECONOMY_FIELDS
      }
    ]
  }
};
