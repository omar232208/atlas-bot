'use strict';

const { SETTINGS, readConfig } = require('./logic');
const { END_JOB, getRaid, startRaid, endRaid } = require('./raid');
const { getLockdown, endLockdown } = require('./lockdown');

const NS = 'antiraid';

const field = (key, type, extra = {}) => {
  const def = SETTINGS[key];
  const out = { path: def.path, type, label: `${NS}:dashboard.fields.${key}.label`, help: `${NS}:dashboard.fields.${key}.help`, default: def.default, ...extra };
  if (def.min !== undefined) out.min = def.min;
  if (def.max !== undefined) out.max = def.max;
  if (def.options) out.options = def.options.map((value) => ({ value, label: `${NS}:actions.${value}` }));
  return out;
};

/**
 * Web dashboard schema. Paths and defaults come from SETTINGS, the same table
 * readConfig() uses, so a dashboard change applies to the next join at once.
 */
const dashboard = {
  sections: [
    {
      id: 'detection',
      title: `${NS}:dashboard.detection.title`,
      description: `${NS}:dashboard.detection.description`,
      fields: [
        field('enabled', 'boolean'), field('joinThreshold', 'number'), field('joinWindowSec', 'number'),
        field('raidAction', 'select'), field('timeoutMinutes', 'number'), field('raidDurationMin', 'number'),
        field('punishBurst', 'boolean'), field('autoLockdown', 'boolean'), field('dmNotice', 'boolean')
      ]
    },
    {
      id: 'filters',
      title: `${NS}:dashboard.filters.title`,
      description: `${NS}:dashboard.filters.description`,
      fields: [field('minAccountAgeMs', 'duration'), field('noAvatar', 'boolean'), field('filterAction', 'select')]
    },
    {
      id: 'bots',
      title: `${NS}:dashboard.bots.title`,
      description: `${NS}:dashboard.bots.description`,
      fields: [field('antiBot', 'boolean'), field('allowVerifiedBots', 'boolean'), field('botAdderAction', 'select')]
    }
  ],
  actions: [
    {
      id: 'raidOn',
      label: `${NS}:dashboard.actions.raidOn`,
      danger: true,
      async run(ctx, guild, actorUserId) {
        if (getRaid(ctx.store, guild.id)) return `${NS}:raid.alreadyActive`;
        await startRaid(ctx, guild, { by: actorUserId, auto: false, durationMs: readConfig(ctx.store.guild(guild.id)).raidDurationMin * 60000 });
        return `${NS}:dashboard.results.raidOn`;
      }
    },
    {
      id: 'raidOff',
      label: `${NS}:dashboard.actions.raidOff`,
      async run(ctx, guild, actorUserId) {
        return (await endRaid(ctx, guild, actorUserId)) ? `${NS}:dashboard.results.raidOff` : `${NS}:raid.notActive`;
      }
    },
    {
      id: 'lockdownEnd',
      label: `${NS}:dashboard.actions.lockdownEnd`,
      async run(ctx, guild) {
        if (!getLockdown(ctx.store, guild.id)) return `${NS}:lockdown.notActive`;
        const res = await endLockdown(guild, ctx.store, ctx.t(guild, `${NS}:lockdown.auditDashboard`));
        return res.failed ? `${NS}:dashboard.results.lockdownPartial` : `${NS}:dashboard.results.lockdownEnd`;
      }
    }
  ]
};

module.exports = {
  name: NS,
  commands: [require('./commands/antiraid'), require('./commands/raidmode'), require('./commands/lockdown')],
  events: [require('./events/memberAdd')],
  components: [],
  dashboard,
  /**
   * Registers the raid-mode expiry job. Jobs are persistent, so a raid mode
   * started before a restart still ends on time.
   */
  init(client, ctx) {
    ctx.scheduler.on(END_JOB, async ({ guildId }) => {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        ctx.store.guild(guildId).delete('antiraid.raid');
        return;
      }
      await endRaid(ctx, guild, null);
    });
  }
};
