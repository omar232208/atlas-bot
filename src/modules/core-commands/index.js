'use strict';

const help = require('./commands/help');
const ping = require('./commands/ping');
const botinfo = require('./commands/botinfo');
const config = require('./commands/config');
const setup = require('./commands/setup');
const settings = require('./lib/settings');
const i18n = require('../../core/i18n');

const NS = 'core-commands';

/**
 * Web dashboard schema for the core settings. "language" is the exact path
 * core/i18n reads, so a change there is effective immediately.
 */
const dashboard = {
  sections: [
    {
      id: 'general',
      title: `${NS}:dashboard.general.title`,
      description: `${NS}:dashboard.general.description`,
      fields: [
        {
          path: 'language',
          type: 'select',
          label: `${NS}:dashboard.general.language`,
          help: `${NS}:dashboard.general.languageHelp`,
          default: i18n.defaultLanguage(),
          options: settings.LANGUAGES.map((l) => ({ value: l, label: `${NS}:languages.${l}` }))
        }
      ]
    }
  ],
  actions: [
    {
      id: 'reset',
      ownerOnly: true,
      label: `${NS}:dashboard.actions.reset`,
      danger: true,
      /** Same effect as /config reset. */
      run: async (ctx, guild, actorUserId) => {
        ctx.store.guild(guild.id).reset();
        ctx.logger.child(NS).info(`Settings of guild ${guild.id} reset from the dashboard by ${actorUserId}`);
        return `${NS}:dashboard.actions.resetDone`;
      }
    }
  ]
};

/** Core commands: /help, /ping, /botinfo, /config and the /setup wizard. */
module.exports = {
  name: NS,
  commands: [help, ping, botinfo, config, setup],
  events: [],
  components: [help.component, setup.component],
  dashboard
};
