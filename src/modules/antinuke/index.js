'use strict';

const { GatewayIntentBits } = require('discord.js');
const { SETTINGS, ACTIONS } = require('./logic');
const { END_JOB, startPanic, endPanic } = require('./panic');

const NS = 'antinuke';

const field = (key, type, extra = {}) => {
  const def = SETTINGS[key];
  const out = { path: def.path, type, label: `${NS}:dashboard.fields.${key}.label`, help: `${NS}:dashboard.fields.${key}.help`, default: def.default, ...extra };
  if (def.min !== undefined) out.min = def.min;
  if (def.max !== undefined) out.max = def.max;
  if (def.options) out.options = def.options.map((value) => ({ value, label: `${NS}:punishments.${value}` }));
  return out;
};

const limitField = (action, kind) => {
  const def = SETTINGS[`${action}${kind}`];
  return {
    path: def.path, type: 'number', default: def.default, min: def.min, max: def.max,
    label: `${NS}:dashboard.limitFields.${action}.${kind.toLowerCase()}`,
    help: `${NS}:dashboard.limits.description`
  };
};

/**
 * Web dashboard schema. Paths and defaults come from SETTINGS, the table
 * readConfig() reads, so a dashboard change applies to the next audit entry.
 * `ownerOnly` marks sections that /antinuke restricts to the server owner:
 * a dashboard should apply the same rule, otherwise a compromised admin could
 * whitelist themselves.
 */
const dashboard = {
  sections: [
    {
      id: 'general',
      ownerOnly: true,
      title: `${NS}:dashboard.general.title`,
      description: `${NS}:dashboard.general.description`,
      fields: [
        field('enabled', 'boolean'), field('punishment', 'select'), field('quarantineRoleId', 'role'),
        field('timeoutMinutes', 'number'), field('restore', 'boolean'),
        { path: 'whitelist', type: 'list', label: `${NS}:dashboard.fields.whitelist.label`, help: `${NS}:dashboard.fields.whitelist.help`, default: [], maxLength: 100 }
      ]
    },
    {
      id: 'panic',
      ownerOnly: true,
      title: `${NS}:dashboard.panic.title`,
      description: `${NS}:dashboard.panic.description`,
      fields: [field('autoPanic', 'boolean'), field('panicMinutes', 'number'), field('panicStripRoles', 'boolean')]
    },
    {
      id: 'limits',
      ownerOnly: true,
      title: `${NS}:dashboard.limits.title`,
      description: `${NS}:dashboard.limits.description`,
      fields: ACTIONS.flatMap((a) => [limitField(a, 'Limit'), limitField(a, 'Window')])
    }
  ],
  actions: [
    {
      id: 'panicOn',
      ownerOnly: true,
      label: `${NS}:dashboard.actions.panicOn`,
      danger: true,
      async run(ctx, guild, actorUserId) {
        const res = await startPanic(ctx, guild, { by: actorUserId, auto: false });
        return res.started ? `${NS}:dashboard.results.panicOn` : `${NS}:panic.alreadyActive`;
      }
    },
    {
      id: 'panicOff',
      ownerOnly: true,
      label: `${NS}:dashboard.actions.panicOff`,
      async run(ctx, guild, actorUserId) {
        const res = await endPanic(ctx, guild, actorUserId);
        return res.ended ? `${NS}:dashboard.results.panicOff` : `${NS}:panic.notActive`;
      }
    }
  ]
};

module.exports = {
  name: NS,
  commands: [require('./commands/antinuke'), require('./commands/whitelist'), require('./commands/panic')],
  events: [require('./events/auditEntry'), require('./events/webhookSpam'), ...require('./events/snapshots')],
  components: [],
  dashboard,
  /** Registers the panic expiry job (persistent, so it survives restarts) and checks intents. */
  init(client, ctx) {
    ctx.scheduler.on(END_JOB, async ({ guildId }) => {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        ctx.store.guild(guildId).delete('antinuke.panic');
        return;
      }
      await endPanic(ctx, guild, null);
    });
    // Audit log events only arrive with the Guild Moderation intent.
    if (client.options?.intents?.has && !client.options.intents.has(GatewayIntentBits.GuildModeration)) {
      ctx.logger.warn('antinuke: the GuildModeration intent is not enabled, audit log events will not be received');
    }
  }
};
