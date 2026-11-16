'use strict';

const { ChannelType } = require('discord.js');
const { ACTIONS, normalizeSteps } = require('./escalation');

const ROOT = 'automod';
const MIN = 60000;

/**
 * Every filter with its default action and tunable parameters. A parameter
 * is { default, min, max, unit? }; the commands, getConfig() and the dashboard
 * schema are all generated from this table so they cannot drift apart.
 */
const FILTERS = {
  badwords: { enabled: false, action: 'delete', duration: 10 * MIN, params: {} },
  invites: { enabled: true, action: 'delete', duration: 10 * MIN, params: { allowOwn: { default: true, type: 'boolean' } } },
  links: { enabled: false, action: 'delete', duration: 10 * MIN, params: {} },
  mentions: { enabled: true, action: 'timeout', duration: 10 * MIN, params: { limit: { default: 5, min: 2, max: 50 } } },
  spam: { enabled: true, action: 'timeout', duration: 5 * MIN, params: { limit: { default: 6, min: 3, max: 30 }, seconds: { default: 5, min: 2, max: 60 } } },
  duplicates: { enabled: true, action: 'delete', duration: 5 * MIN, params: { limit: { default: 4, min: 2, max: 20 }, seconds: { default: 30, min: 5, max: 120 } } },
  attachments: { enabled: false, action: 'delete', duration: 5 * MIN, params: { limit: { default: 6, min: 2, max: 50 }, seconds: { default: 15, min: 5, max: 120 } } },
  zalgo: { enabled: false, action: 'delete', duration: 5 * MIN, params: { limit: { default: 4, min: 2, max: 30 } } },
  caps: { enabled: false, action: 'delete', duration: 5 * MIN, params: { percent: { default: 70, min: 30, max: 100 }, minLength: { default: 12, min: 4, max: 200 } } },
  emojis: { enabled: false, action: 'delete', duration: 5 * MIN, params: { limit: { default: 12, min: 3, max: 100 } } },
  newlines: { enabled: false, action: 'delete', duration: 5 * MIN, params: { limit: { default: 20, min: 5, max: 200 } } }
};

/** Domains allowed by default: Discord's own media hosts and GIF pickers. */
const DEFAULT_ALLOW = ['tenor.com', 'giphy.com', 'cdn.discordapp.com', 'media.discordapp.net'];

/** Global settings: store path → default. */
const GLOBAL = {
  enabled: { path: `${ROOT}.enabled`, default: false },
  ignoreStaff: { path: `${ROOT}.ignoreStaff`, default: true },
  notify: { path: `${ROOT}.notify`, default: true },
  exemptRoles: { path: `${ROOT}.exemptRoles`, default: [] },
  exemptChannels: { path: `${ROOT}.exemptChannels`, default: [] },
  strikeWindow: { path: `${ROOT}.strikeWindow`, default: 24 * 60 * MIN },
  escalation: { path: `${ROOT}.escalation`, default: [{ strikes: 3, action: 'timeout', duration: 10 * MIN }, { strikes: 5, action: 'timeout', duration: 60 * MIN }] },
  badwords: { path: `${ROOT}.badwords`, default: [] },
  linkMode: { path: `${ROOT}.links.mode`, default: 'allowlist' },
  linkAllow: { path: `${ROOT}.links.allow`, default: DEFAULT_ALLOW },
  linkDeny: { path: `${ROOT}.links.deny`, default: [] }
};

/** Data (not settings): strike timestamps per user. */
const STRIKES = `${ROOT}.strikes`;

const filterPath = (filter, key) => `${ROOT}.filters.${filter}.${key}`;

/**
 * Reads the full automod configuration of a guild with defaults applied.
 * @param {{get: Function}} gs Guild store handle.
 */
function getConfig(gs) {
  const g = (name) => gs.get(GLOBAL[name].path, GLOBAL[name].default);
  const filters = {};
  for (const [name, def] of Object.entries(FILTERS)) {
    const f = {
      enabled: gs.get(filterPath(name, 'enabled'), def.enabled),
      action: gs.get(filterPath(name, 'action'), def.action),
      duration: gs.get(filterPath(name, 'duration'), def.duration),
      exemptRoles: gs.get(filterPath(name, 'exemptRoles'), []),
      exemptChannels: gs.get(filterPath(name, 'exemptChannels'), [])
    };
    if (!ACTIONS.includes(f.action)) f.action = def.action;
    for (const [param, p] of Object.entries(def.params)) f[param] = gs.get(filterPath(name, param), p.default);
    filters[name] = f;
  }
  return {
    enabled: g('enabled'),
    ignoreStaff: g('ignoreStaff'),
    notify: g('notify'),
    exemptRoles: g('exemptRoles'),
    exemptChannels: g('exemptChannels'),
    strikeWindow: g('strikeWindow'),
    escalation: normalizeSteps(g('escalation')),
    badwords: g('badwords'),
    links: { mode: g('linkMode'), allow: g('linkAllow'), deny: g('linkDeny') },
    filters
  };
}

const L = (k) => `automod:dashboard.${k}`;
const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildCategory, ChannelType.GuildVoice];
const gfield = (name, type, extra = {}) => ({ path: GLOBAL[name].path, type, label: L(`fields.${name}.label`), help: L(`fields.${name}.help`), default: GLOBAL[name].default, ...extra });

/**
 * Builds the web dashboard schema: one general section, one for link lists and
 * one per filter (fields generated from FILTERS).
 */
function buildDashboard() {
  const sections = [
    {
      id: 'general',
      title: L('general.title'),
      description: L('general.description'),
      fields: [
        gfield('enabled', 'boolean'),
        gfield('ignoreStaff', 'boolean'),
        gfield('notify', 'boolean'),
        gfield('exemptRoles', 'roles'),
        gfield('exemptChannels', 'channels', { channelTypes: TEXT_CHANNELS }),
        gfield('strikeWindow', 'duration', { min: 0 })
      ]
    },
    {
      id: 'lists',
      title: L('lists.title'),
      description: L('lists.description'),
      fields: [
        gfield('badwords', 'list', { maxLength: 50 }),
        gfield('linkMode', 'select', { options: ['allowlist', 'denylist'].map((v) => ({ value: v, label: `automod:linkModes.${v}` })) }),
        gfield('linkAllow', 'list', { maxLength: 100 }),
        gfield('linkDeny', 'list', { maxLength: 100 })
      ]
    }
  ];
  for (const [name, def] of Object.entries(FILTERS)) {
    const fl = (key, type, dflt, extra = {}) => ({ path: filterPath(name, key), type, label: L(`filter.${key}.label`), help: L(`filter.${key}.help`), default: dflt, ...extra });
    sections.push({
      id: `filter-${name}`,
      title: `automod:filters.${name}.name`,
      description: `automod:filters.${name}.description`,
      fields: [
        fl('enabled', 'boolean', def.enabled),
        fl('action', 'select', def.action, { options: ACTIONS.map((a) => ({ value: a, label: `automod:actions.${a}` })) }),
        fl('duration', 'duration', def.duration, { min: 0 }),
        ...Object.entries(def.params).map(([param, p]) => fl(param, p.type || 'number', p.default, p.type ? {} : { min: p.min, max: p.max })),
        fl('exemptRoles', 'roles', []),
        fl('exemptChannels', 'channels', [], { channelTypes: TEXT_CHANNELS })
      ]
    });
  }
  return {
    sections,
    actions: [
      {
        id: 'resetStrikes',
        label: L('actions.resetStrikes'),
        danger: true,
        run: async (ctx, guild) => {
          ctx.store.guild(guild.id).delete(STRIKES);
          return 'automod:dashboard.actions.resetStrikesDone';
        }
      }
    ]
  };
}

module.exports = { ROOT, FILTERS, GLOBAL, STRIKES, DEFAULT_ALLOW, filterPath, getConfig, buildDashboard };
