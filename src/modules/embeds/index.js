'use strict';

const NS = 'embeds';

const str = (key, def = null, extra = {}) => ({ path: `embeds.${key}`, type: 'string', label: `${NS}:dashboard.fields.${key}`, help: `${NS}:dashboard.fields.${key}Help`, default: def, ...extra });
const bool = (key, def) => ({ path: `embeds.${key}`, type: 'boolean', label: `${NS}:dashboard.fields.${key}`, help: `${NS}:dashboard.fields.${key}Help`, default: def });

const PATHS = [
  'accentColor', 'colorInfo', 'colorSuccess', 'colorError', 'colorWarn', 'colorLog',
  'footerText', 'footerIcon', 'authorName', 'authorIcon', 'authorUrl',
  'showBranding', 'showTimestamp'
];

const dashboard = {
  sections: [
    {
      id: 'appearance',
      title: `${NS}:dashboard.appearance.title`,
      description: `${NS}:dashboard.appearance.description`,
      fields: [
        str('accentColor'),
        str('colorInfo'), str('colorSuccess'), str('colorError'), str('colorWarn'), str('colorLog'),
        str('footerText'), str('footerIcon'),
        str('authorName'), str('authorIcon'), str('authorUrl'),
        bool('showBranding', true), bool('showTimestamp', true)
      ]
    }
  ],
  actions: [
    {
      id: 'reset',
      danger: true,
      label: `${NS}:dashboard.actions.reset`,
      run: async (ctx, guild) => {
        const store = ctx.store.guild(guild.id);
        for (const p of PATHS) store.delete(`embeds.${p}`);
        return `${NS}:dashboard.actions.resetDone`;
      }
    }
  ]
};

module.exports = {
  name: NS,
  commands: [],
  events: [],
  components: [],
  dashboard
};
