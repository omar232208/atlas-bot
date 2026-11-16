'use strict';

const { COMMANDS, CATEGORIES, getDefaultStorePath, getRolesStorePath, getKeywordsStorePath, getChannelsStorePath, getSubEnabledStorePath } = require('../../core/command-registry');
const cooldowns = require('../../core/cooldown');
const { tryKeywordRun } = require('./lib/runner');
const { usagePayload } = require('./lib/usage');

const NS = 'commands-manager';
const KEYWORD_COOLDOWN_MS = 5000;

/** Channel types a command may be restricted to (text, announcement, forum, thread). */
const ALLOWED_CHANNEL_TYPES = [0, 5, 15, 16];

/**
 * Fields of one command card in the dashboard: master switch, required roles,
 * keyword triggers, allowed channels, then one switch per subcommand.
 */
function commandFields(cmd) {
  const fields = [
    {
      path: getDefaultStorePath(cmd.name),
      type: 'boolean',
      label: `${NS}:dashboard.commands.${cmd.name}.label`,
      help: `${NS}:dashboard.commands.${cmd.name}.description`,
      default: cmd.defaultEnabled,
      group: cmd.name,
    },
    {
      path: getRolesStorePath(cmd.name),
      type: 'roles',
      label: `${NS}:dashboard.fields.${cmd.name}.allowedRoles`,
      help: `${NS}:dashboard.fields.${cmd.name}.allowedRolesHelp`,
      default: [],
      group: cmd.name,
    },
    {
      path: getKeywordsStorePath(cmd.name),
      type: 'list',
      label: `${NS}:dashboard.fields.${cmd.name}.keywords`,
      help: `${NS}:dashboard.fields.${cmd.name}.keywordsHelp`,
      default: [],
      maxLength: 50,
      group: cmd.name,
    },
    {
      path: getChannelsStorePath(cmd.name),
      type: 'channels',
      label: `${NS}:dashboard.fields.${cmd.name}.allowedChannels`,
      help: `${NS}:dashboard.fields.${cmd.name}.allowedChannelsHelp`,
      default: [],
      channelTypes: ALLOWED_CHANNEL_TYPES,
      group: cmd.name,
    },
  ];

  for (const sub of cmd.subcommands || []) {
    fields.push({
      path: getSubEnabledStorePath(cmd.name, sub),
      type: 'boolean',
      // Plain label on purpose: "/eco daily" reads clearly in every language.
      label: `/${cmd.name} ${sub}`,
      help: `${NS}:dashboard.fields.subcommandHelp`,
      default: cmd.defaultEnabled,
      group: cmd.name,
    });
  }
  return fields;
}

const dashboard = {
  sections: [
    {
      id: 'overview',
      title: `${NS}:dashboard.overview.title`,
      description: `${NS}:dashboard.overview.description`,
      fields: [
        {
          path: 'commands.globalEnabled',
          type: 'boolean',
          label: `${NS}:dashboard.overview.globalEnabled`,
          help: `${NS}:dashboard.overview.globalEnabledHelp`,
          default: true,
        },
        {
          path: 'commands.bypassOwner',
          type: 'boolean',
          label: `${NS}:dashboard.overview.bypassOwner`,
          help: `${NS}:dashboard.overview.bypassOwnerHelp`,
          default: true,
        },
        {
          path: 'commands.bypassAdmin',
          type: 'boolean',
          label: `${NS}:dashboard.overview.bypassAdmin`,
          help: `${NS}:dashboard.overview.bypassAdminHelp`,
          default: true,
        },
      ],
    },
    ...CATEGORIES.map(cat => {
      const cmds = COMMANDS.filter(c => c.category === cat.id);
      if (!cmds.length) return null;

      return {
        id: cat.id,
        title: `${NS}:dashboard.categories.${cat.id}.name`,
        description: `${NS}:dashboard.categories.${cat.id}.description`,
        collapsible: true,
        open: true,
        fields: cmds.flatMap(commandFields),
      };
    }).filter(Boolean),
  ],
  actions: [
    {
      id: 'resetAll',
      ownerOnly: true,
      label: `${NS}:dashboard.actions.resetAll`,
      danger: true,
      run: async (ctx, guild, actorUserId) => {
        const store = ctx.store.guild(guild.id);
        for (const cmd of COMMANDS) {
          store.delete(getDefaultStorePath(cmd.name));
          store.delete(getRolesStorePath(cmd.name));
          store.delete(getKeywordsStorePath(cmd.name));
          store.delete(getChannelsStorePath(cmd.name));
          for (const sub of cmd.subcommands || []) store.delete(getSubEnabledStorePath(cmd.name, sub));
        }
        store.delete('commands.globalEnabled');
        store.delete('commands.bypassOwner');
        store.delete('commands.bypassAdmin');
        return `${NS}:dashboard.actions.resetAllDone`;
      },
    },
    {
      id: 'enableAll',
      ownerOnly: true,
      label: `${NS}:dashboard.actions.enableAll`,
      danger: false,
      run: async (ctx, guild, actorUserId) => {
        const store = ctx.store.guild(guild.id);
        for (const cmd of COMMANDS) {
          store.set(getDefaultStorePath(cmd.name), true);
          for (const sub of cmd.subcommands || []) store.set(getSubEnabledStorePath(cmd.name, sub), true);
        }
        return `${NS}:dashboard.actions.enableAllDone`;
      },
    },
    {
      id: 'disableAll',
      ownerOnly: true,
      label: `${NS}:dashboard.actions.disableAll`,
      danger: true,
      run: async (ctx, guild, actorUserId) => {
        const store = ctx.store.guild(guild.id);
        for (const cmd of COMMANDS) {
          store.set(getDefaultStorePath(cmd.name), false);
          for (const sub of cmd.subcommands || []) store.set(getSubEnabledStorePath(cmd.name, sub), false);
        }
        return `${NS}:dashboard.actions.disableAllDone`;
      },
    },
  ],
};

/**
 * Keyword triggers: when a message contains a command's keyword, the bot
 * runs the command with the message's mentions and text as its options.
 * When the arguments cannot be parsed it answers with a usage embed instead.
 * The same enable/role/channel rules as the command apply.
 * @param {object} ctx
 * @param {import('discord.js').Message} message
 */
async function onKeywordMessage(ctx, message) {
  const name = ctx.commandGuard?.checkKeywords(message);
  if (!name) return;
  // Try to actually run the command with the message's mentions and text as
  // its options; when the arguments cannot be parsed, fall back to posting a
  // clickable slash-command mention so the user can finish in the UI.
  if (await tryKeywordRun(ctx, message, name).catch((err) => {
    ctx.logger?.warn?.(`keyword run for /${name} failed:`, err?.message || err);
    return false;
  })) return;
  const key = `kw:${message.guild.id}:${message.author.id}`;
  if (cooldowns.hit(key, KEYWORD_COOLDOWN_MS) > 0) return;
  // ProBot style: explain the correct syntax instead of silently ignoring.
  // _keepEmbeds opts out of the bot-wide embed→text flattening for this reply.
  const payload = usagePayload(ctx, message.guild, name);
  await message.reply({ ...(payload || { content: `/${name}` }), _keepEmbeds: !!payload, allowedMentions: { parse: [] } }).catch((err) => {
    ctx.logger?.debug?.(`keyword reply for /${name} failed:`, err.message);
  });
}

module.exports = {
  name: NS,
  commands: [],
  events: [{ event: 'messageCreate', execute: onKeywordMessage }],
  components: [],
  dashboard,
};
