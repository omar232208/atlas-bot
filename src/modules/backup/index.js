'use strict';

const { serialize } = require('./lib/snapshot');
const auto = require('./lib/auto');
const backups = require('./lib/store');

const { NS, DEFAULTS } = backups;
const k = (key) => `${NS}:dashboard.${key}`;

module.exports = {
  name: 'backup',
  commands: [require('./commands/backup')],
  events: [],
  components: [],
  /**
   * Registers the automatic backup tick with the persistent scheduler.
   * @param {import('discord.js').Client} client
   * @param {object} ctx
   */
  init(client, ctx) {
    ctx.scheduler.on(auto.JOB, auto.tickHandler(client, ctx));
    auto.ensureTick(ctx.scheduler);
  },
  dashboard: {
    sections: [{
      id: 'general',
      title: k('general.title'),
      description: k('general.description'),
      fields: [
        { path: 'backup.config.maxBackups', type: 'number', label: k('fields.maxBackups'), help: k('help.maxBackups'), default: DEFAULTS.maxBackups, min: 1, max: 25 },
        { path: 'backup.config.autoInterval', type: 'duration', label: k('fields.autoInterval'), help: k('help.autoInterval'), default: DEFAULTS.autoInterval, min: 0, max: auto.MAX_INTERVAL },
        { path: 'backup.config.autoKeep', type: 'number', label: k('fields.autoKeep'), default: DEFAULTS.autoKeep, min: 1, max: 10 }
      ]
    }],
    actions: [{
      id: 'createNow',
      ownerOnly: true,
      label: k('actions.createNow'),
      /** Same as /backup create; restricted to owners like the command. */
      async run(ctx, guild, actorUserId) {
        if (!ctx.permissions.isOwner(guild, actorUserId)) return k('actions.ownerOnly');
        await guild.roles.fetch().catch(() => null);
        await guild.channels.fetch().catch(() => null);
        backups.save(ctx.store, { guildId: guild.id, guildName: guild.name, authorId: actorUserId, data: serialize(guild) });
        return k('actions.createNowDone');
      }
    }]
  }
};
