'use strict';

/**
 * Every per-guild moderation setting, with its store path and default.
 * Code reads settings only through get() below and the dashboard schema is
 * built from the same table, so a dashboard change applies immediately.
 */
const SETTINGS = {
  dm: { path: 'moderation.dm', default: true },
  dmShowModerator: { path: 'moderation.dmShowModerator', default: false },
  appeal: { path: 'moderation.appeal', default: '' },
  requireReason: { path: 'moderation.requireReason', default: false },
  warnExpiry: { path: 'moderation.warnExpiry', default: 0 },
  warnThresholds: { path: 'moderation.warnThresholds', default: [] }
};

/** Store paths of data (not settings) kept by the module. */
const DATA = {
  cases: 'moderation.cases',
  nextCase: 'moderation.nextCase',
  locks: 'moderation.locks'
};

/**
 * Reads one setting with its default.
 * @param {{get: Function}} gs Guild store handle.
 * @param {keyof SETTINGS} name
 */
function get(gs, name) {
  const s = SETTINGS[name];
  return gs.get(s.path, s.default);
}

/**
 * Sets one setting.
 * @param {{set: Function}} gs
 * @param {keyof SETTINGS} name
 * @param {*} value
 */
function set(gs, name, value) {
  return gs.set(SETTINGS[name].path, value);
}

const field = (name, type, extra = {}) => ({
  path: SETTINGS[name].path,
  type,
  label: `moderation:dashboard.fields.${name}.label`,
  help: `moderation:dashboard.fields.${name}.help`,
  default: SETTINGS[name].default,
  ...extra
});

/** Web dashboard schema (rendered generically by the dashboard module). */
const dashboard = {
  sections: [
    {
      id: 'sanctions',
      title: 'moderation:dashboard.sanctions.title',
      description: 'moderation:dashboard.sanctions.description',
      fields: [
        field('dm', 'boolean'),
        field('dmShowModerator', 'boolean'),
        field('appeal', 'text', { maxLength: 500 }),
        field('requireReason', 'boolean')
      ]
    },
    {
      id: 'warnings',
      title: 'moderation:dashboard.warnings.title',
      description: 'moderation:dashboard.warnings.description',
      fields: [field('warnExpiry', 'duration', { min: 0 })]
    }
  ],
  actions: []
};

module.exports = { SETTINGS, DATA, get, set, dashboard };
