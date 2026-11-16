'use strict';

const { Events } = require('discord.js');
const { NS, DEFAULTS, respond } = require('./lib/util');
const menus = require('./lib/menus');
const temp = require('./lib/temp');

const k = (key) => `${NS}:dashboard.${key}`;

module.exports = {
  name: 'roles',
  commands: [require('./commands/rolemenu'), require('./commands/role')],
  components: [{
    prefix: 'rmenu:',
    /** Role menu buttons and selects, routed by custom id so they survive restarts. */
    async execute(interaction, ctx) {
      try {
        await menus.handleClick(interaction, ctx);
      } catch (err) {
        ctx.logger.error('roles menu failed:', err);
        await respond(interaction, ctx.embeds.error(ctx.t(interaction, `${NS}:errors.title`), ctx.t(interaction, `${NS}:errors.unexpected`)));
      }
    }
  }],
  events: [{
    event: Events.GuildRoleDelete,
    /** Removes a deleted role from every menu and drops its pending expiries. */
    async execute(ctx, role) {
      const gstore = ctx.store.guild(role.guild.id);
      for (const menu of Object.values(gstore.get('roles.menus', {}))) {
        if (!menu.items.some((i) => i.roleId === role.id)) continue;
        menu.items = menu.items.filter((i) => i.roleId !== role.id);
        menus.save(ctx.store, role.guild.id, menu);
        await menus.refreshPosts(ctx, role.guild, menu);
      }
      for (const job of temp.pending(ctx.scheduler, role.guild.id, { roleId: role.id })) ctx.scheduler.cancel(job.id);
    }
  }],
  /**
   * Registers the temporary role expiry handler with the persistent scheduler.
   * @param {import('discord.js').Client} client
   * @param {object} ctx
   */
  init(client, ctx) {
    ctx.scheduler.on(temp.JOB, temp.expiryHandler(client, ctx));
  },
  dashboard: {
    sections: [{
      id: 'general',
      title: k('general.title'),
      description: k('general.description'),
      fields: [
        { path: 'roles.config.tempRoleDm', type: 'boolean', label: k('fields.tempRoleDm'), help: k('help.tempRoleDm'), default: DEFAULTS.tempRoleDm },
        { path: 'roles.config.logChanges', type: 'boolean', label: k('fields.logChanges'), help: k('help.logChanges'), default: DEFAULTS.logChanges }
      ]
    }],
    actions: [{
      id: 'refreshMenus',
      label: k('actions.refreshMenus'),
      /** Re-renders every posted role menu (after renaming roles, for instance). */
      async run(ctx, guild) {
        for (const menu of Object.values(menus.all(ctx.store, guild.id))) await menus.refreshPosts(ctx, guild, menu);
        return k('actions.refreshMenusDone');
      }
    }]
  }
};
