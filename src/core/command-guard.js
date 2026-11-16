'use strict';

const { getDefaultStorePath, getRolesStorePath, getChannelsStorePath, getKeywordsStorePath, getSubEnabledStorePath, getRequiredRolePath, getAllCommands } = require('./command-registry');
const i18n = require('./i18n');
const permissions = require('./permissions');

/**
 * First-level subcommand identifier of a chat input interaction: the group
 * name when the command uses subcommand groups ("/community stats ...",
 * "/ticket config ..."), otherwise the subcommand name ("/eco daily").
 * Returns null for commands without subcommands.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {string|null}
 */
function subNameOf(interaction) {
  try {
    const options = interaction.options;
    if (!options) return null;
    return options.getSubcommandGroup?.() || options.getSubcommand?.(false) || null;
  } catch {
    return null;
  }
}

/**
 * Command permission checker - integrates with slash command execution.
 * Checks: global enable, command enable (and per-subcommand enable), role
 * restrictions, channel restrictions and the admin-commands required role.
 * Everything defaults to "enabled": a fresh server has every command on.
 * @param {object} ctx - Bot context (client, store, logger, etc.)
 * @returns {Function} Middleware function
 */
function createCommandGuard(ctx) {
  const { store, logger } = ctx;

  /**
   * True when `member` passes the allowedRoles / allowedChannels lists of a
   * command. Shared by slash commands and keyword triggers.
   * @param {object} gs Guild store handle.
   * @param {string} commandName
   * @param {import('discord.js').GuildMember} member
   * @param {string} channelId
   * @param {string} guildId
   * @returns {{allowed: boolean, reason?: string}}
   */
  function checkAccess(gs, commandName, member, channelId, guildId) {
    // Owner and admin bypasses (both default on, like the dashboard shows).
    if (gs.get('commands.bypassOwner', true) && permissions.isOwner(member.guild, member.id)) return { allowed: true };
    if (gs.get('commands.bypassAdmin', true) && member.permissions?.has('ManageGuild')) return { allowed: true };

    // Optional single required role (admin-commands module).
    const requiredRole = gs.get(getRequiredRolePath(commandName));
    if (requiredRole && !member.roles?.cache?.has(requiredRole)) {
      return { allowed: false, reason: i18n.t(guildId, 'commands-manager:errors.noRole', { roles: `<@&${requiredRole}>` }) };
    }

    // Allowed roles list (empty = everyone).
    const allowedRoles = gs.get(getRolesStorePath(commandName)) || [];
    if (allowedRoles.length > 0) {
      const hasRole = member.roles?.cache && [...member.roles.cache.keys()].some((id) => allowedRoles.includes(id));
      if (!hasRole) {
        const roleMentions = allowedRoles.map(id => `<@&${id}>`).join(', ');
        return { allowed: false, reason: i18n.t(guildId, 'commands-manager:errors.noRole', { roles: roleMentions }) };
      }
    }

    // Allowed channels list (empty = all channels).
    const allowedChannels = gs.get(getChannelsStorePath(commandName)) || [];
    if (allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
      const channelMentions = allowedChannels.map(id => `<#${id}>`).join(', ');
      return { allowed: false, reason: i18n.t(guildId, 'commands-manager:errors.wrongChannel', { channels: channelMentions }) };
    }

    return { allowed: true };
  }

  /**
   * Check if a command can be executed by a member in a channel.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @returns {{allowed: boolean, reason?: string, ephemeral?: boolean}}
   */
  async function checkCommand(interaction) {
    const { guildId, member, channelId, commandName } = interaction;
    if (!guildId) return { allowed: true }; // DMs always allowed

    const gs = store.guild(guildId);

    // 1. Global command system toggle (on unless an admin turned it off).
    if (gs.get('commands.globalEnabled', true) === false) {
      return { allowed: false, reason: i18n.t(guildId, 'commands-manager:errors.disabled'), ephemeral: true };
    }

    // 2. Find command config
    const cmdConfig = getAllCommands().find(c => c.name === commandName);
    if (!cmdConfig) return { allowed: true }; // Unknown command, let Discord handle

    // 2b. Bypasses skip every per-command restriction (enable switch included);
    // the global kill switch above still applies to everyone.
    if (gs.get('commands.bypassOwner', true) && permissions.isOwner(interaction.guild, member.id)) return { allowed: true };
    if (gs.get('commands.bypassAdmin', true) && member.permissions?.has('ManageGuild')) return { allowed: true };

    const enabledPath = getDefaultStorePath(commandName);

    // 3. Command enabled? (default comes from the registry)
    const enabled = gs.get(enabledPath) ?? cmdConfig.defaultEnabled;
    if (!enabled) {
      return { allowed: false, reason: i18n.t(guildId, 'commands-manager:errors.cmdDisabled', { cmd: cmdConfig.label }), ephemeral: true };
    }

    // 3b. Per-subcommand switch: inherits the command's resolved value.
    const sub = subNameOf(interaction);
    if (sub && cmdConfig.subcommands?.includes(sub)) {
      const subEnabled = gs.get(getSubEnabledStorePath(commandName, sub), enabled);
      if (!subEnabled) {
        return { allowed: false, reason: i18n.t(guildId, 'commands-manager:errors.cmdDisabled', { cmd: `/${commandName} ${sub}` }), ephemeral: true };
      }
    }

    // 4-7. Roles, required role and channels.
    const access = checkAccess(gs, commandName, member, channelId, guildId);
    if (!access.allowed) return { ...access, ephemeral: true };

    return { allowed: true };
  }

  /**
   * Find the first command whose keywords match a chat message. Used by the
   * commands-manager messageCreate event to answer with a command mention.
   * Applies the same enable/role/channel rules as checkCommand.
   * @param {import('discord.js').Message} message
   * @returns {string|null} Command name to trigger, or null
   */
  function checkKeywords(message) {
    if (!message.guild || message.author.bot || !message.member) return null;
    const guildId = message.guild.id;
    const gs = store.guild(guildId);
    if (gs.get('commands.globalEnabled', true) === false) return null;

    const content = message.content.toLowerCase();
    if (!content.trim()) return null;

    for (const cmd of getAllCommands()) {
      const enabled = gs.get(getDefaultStorePath(cmd.name)) ?? cmd.defaultEnabled;
      if (!enabled) continue;
      const keywords = gs.get(getKeywordsStorePath(cmd.name)) || [];
      if (!keywords.length) continue;
      if (!keywords.some((kw) => typeof kw === 'string' && kw.trim() && content.includes(kw.toLowerCase()))) continue;

      const access = checkAccess(gs, cmd.name, message.member, message.channelId, guildId);
      if (access.allowed) return cmd.name;
    }
    return null;
  }

  return { checkCommand, checkKeywords };
}

module.exports = { createCommandGuard, subNameOf };
