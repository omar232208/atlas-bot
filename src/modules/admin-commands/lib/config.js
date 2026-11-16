'use strict';

const { COMMANDS, CATEGORIES, getRequiredRolePath } = require('../../../core/command-registry');

const NS = 'admin-commands';

/**
 * Per-command required role ("Pro Bot" style): when set, only members holding
 * this role may run the command, in addition to the role/channel lists managed
 * by commands-manager. Read directly from the store by command-guard through
 * getRequiredRolePath(), so this table only feeds the dashboard schema.
 */
const SETTINGS = Object.fromEntries(COMMANDS.map((cmd) => [cmd.name, { path: getRequiredRolePath(cmd.name), default: null }]));

/**
 * Current required role of every command, for callers that want the whole map.
 * @param {object} gs Guild store handle.
 * @returns {Record<string, string|null>}
 */
function getSettings(gs) {
  const out = {};
  for (const cmd of COMMANDS) out[cmd.name] = gs.get(getRequiredRolePath(cmd.name)) || null;
  return out;
}

/** Web dashboard schema: one role picker per command, grouped by category. */
const dashboard = {
  sections: [
    ...CATEGORIES.map((cat) => {
      const cmds = COMMANDS.filter((c) => c.category === cat.id);
      if (!cmds.length) return null;
      return {
        id: cat.id,
        // Reuse the Commands Manager category names so both pages read alike.
        title: `commands-manager:dashboard.categories.${cat.id}.name`,
        description: `commands-manager:dashboard.categories.${cat.id}.description`,
        collapsible: true,
        open: true,
        fields: cmds.map((cmd) => ({
          path: getRequiredRolePath(cmd.name),
          type: 'role',
          label: `/${cmd.name}`,
          help: `${NS}:dashboard.requiredRoles.help`,
          default: null,
        })),
      };
    }).filter(Boolean),
  ],
};

module.exports = { NS, SETTINGS, getSettings, dashboard };
