'use strict';

const { MessageFlags, DiscordAPIError, PermissionsBitField } = require('discord.js');
const i18n = require('./i18n');
const embeds = require('./embeds');
const permissions = require('./permissions');
const cooldowns = require('./cooldown');
const duration = require('./duration');
const { createCommandGuard } = require('./command-guard');
const logger = require('./logger').child('interactions');

const { t } = i18n;

// Custom id prefixes answered by short-lived collectors (core/confirm, core/paginate),
// so the router must not treat them as unknown while the collector is alive.
const COLLECTOR_PREFIXES = ['confirm:', 'paginate:'];
// Discord gives 3 s for the first answer; past ~2.5 s with nobody answering we
// tell the user the menu expired instead of letting Discord show "interaction failed".
const EXPIRED_AFTER_MS = 2500;

// Command guard instance (created when router is created)
let commandGuard = null;

/**
 * Sends an ephemeral embed whether or not the interaction was already answered.
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').EmbedBuilder} embed
 */
async function replyEphemeral(interaction, embed) {
  if (!interaction.isRepliable()) return;
  const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (err) {
    logger.debug('Could not send the error reply:', err.message);
  }
}

/**
 * Names a list of permission flags in the interaction's language.
 * @param {*} target
 * @param {Array<bigint|string>} perms
 */
function permissionList(target, perms) {
  return perms.map((p) => `**${permissions.permissionLabel(target, p)}**`).join(', ');
}

/**
 * Turns any thrown error into a clear localized reply. Discord permission errors
 * (50013 / 50001) say which permission is missing when the command declared
 * `botPermissions`, otherwise give the usual fixes.
 * @param {import('discord.js').Interaction} interaction
 * @param {Error} err
 * @param {{botPermissions?: Array<bigint|string>}} [handler]
 */
async function handleError(interaction, err, handler) {
  if (err instanceof DiscordAPIError || typeof err?.code === 'number') {
    // 10062: the interaction token expired; nothing can be answered any more.
    if (err.code === 10062 || err.code === 40060) return logger.debug('Interaction expired before reply:', err.message);
    if (err.code === 50013) {
      const missing = handler?.botPermissions?.length && interaction.guild ? permissions.botMissing(interaction.guild, handler.botPermissions, interaction.channel) : [];
      const description = missing.length
        ? t(interaction, 'common:errors.missingBotPermissions', { permissions: permissionList(interaction, missing) })
        : t(interaction, 'common:errors.missingPermissionsUnknown');
      return replyEphemeral(interaction, embeds.error(t(interaction, 'common:errors.permissionTitle'), description));
    }
    if (err.code === 50001) return replyEphemeral(interaction, embeds.error(t(interaction, 'common:errors.permissionTitle'), t(interaction, 'common:errors.missingAccess')));
    if (err.code === 50007) return replyEphemeral(interaction, embeds.warn(t(interaction, 'common:errors.title'), t(interaction, 'common:errors.dmClosed')));
    if (err.status === 429) return replyEphemeral(interaction, embeds.warn(t(interaction, 'common:errors.title'), t(interaction, 'common:errors.rateLimited')));
  }
  logger.error(`Interaction ${interaction.commandName || interaction.customId || interaction.type} failed:`, err);
  return replyEphemeral(interaction, embeds.error(t(interaction, 'common:errors.title'), t(interaction, 'common:errors.generic')));
}

/**
 * Checks done before running a command or component: guild-only, owner-only and
 * the bot permissions it declared. Returns true when the handler may run.
 * Optional handler fields: `dm`, `ownerOnly`, `botPermissions`.
 */
async function preflight(interaction, handler) {
  if (!interaction.inGuild() && !handler.dm) {
    await replyEphemeral(interaction, embeds.error(t(interaction, 'common:errors.title'), t(interaction, 'common:errors.guildOnly')));
    return false;
  }
  if (handler.ownerOnly && !permissions.isOwner(interaction.guild, interaction.user.id)) {
    await replyEphemeral(interaction, embeds.error(t(interaction, 'common:errors.permissionTitle'), t(interaction, 'common:errors.ownerOnly')));
    return false;
  }
  if (handler.botPermissions?.length && interaction.guild) {
    const missing = permissions.botMissing(interaction.guild, handler.botPermissions, interaction.channel);
    if (missing.length) {
      await replyEphemeral(interaction, embeds.error(t(interaction, 'common:errors.permissionTitle'), t(interaction, 'common:errors.missingBotPermissions', { permissions: permissionList(interaction, missing) })));
      return false;
    }
  }
  return true;
}

/**
 * Finds the component handler whose prefix matches the custom id (longest wins,
 * so "tkt:close" can coexist with "tkt:").
 * @param {Array<{prefix: string}>} components
 * @param {string} customId
 */
function findComponent(components, customId) {
  let best = null;
  for (const comp of components) {
    if (customId.startsWith(comp.prefix) && (!best || comp.prefix.length > best.prefix.length)) best = comp;
  }
  return best;
}

/**
 * Builds the single interactionCreate listener that routes slash commands,
 * autocomplete, buttons, select menus and modals to the loaded modules.
 * @param {object} ctx Shared context (ctx.modules must be set).
 * @returns {(interaction: import('discord.js').Interaction) => Promise<void>}
 */
function createRouter(ctx) {
  const commands = new Map();
  const components = [];
  for (const mod of ctx.modules) {
    for (const cmd of mod.commands) commands.set(cmd.data.name, cmd);
    for (const comp of mod.components) components.push({ ...comp, module: mod.name });
  }

  // Initialize command guard (exposed on ctx so modules like commands-manager
  // can reuse its keyword check for message triggers).
  if (!commandGuard) commandGuard = createCommandGuard(ctx);
  ctx.commandGuard = commandGuard;

  const runCommand = async (interaction) => {
    const cmd = commands.get(interaction.commandName);
    if (!cmd) return replyEphemeral(interaction, embeds.warn(t(interaction, 'common:errors.title'), t(interaction, 'common:errors.unknownCommand')));
    
    // Check command guard (enabled, roles, channels)
    const guard = await commandGuard.checkCommand(interaction);
    if (!guard.allowed) {
      return replyEphemeral(interaction, embeds.warn(t(interaction, 'common:errors.title'), guard.reason));
    }
    
    if (!(await preflight(interaction, cmd))) return;
    if (cmd.cooldown && !permissions.isOwner(interaction.guild, interaction.user.id)) {
      // cooldown is in seconds, as in most discord.js guides.
      const left = cooldowns.hit(`${cmd.data.name}:${interaction.user.id}`, cmd.cooldown * 1000);
      if (left > 0) return replyEphemeral(interaction, embeds.warn(t(interaction, 'common:errors.cooldownTitle'), t(interaction, 'common:errors.cooldown', { time: duration.format(left, interaction) })));
    }
    try {
      await cmd.execute(interaction, ctx);
    } catch (err) {
      await handleError(interaction, err, cmd);
    }
  };

  const runAutocomplete = async (interaction) => {
    const cmd = commands.get(interaction.commandName);
    try {
      if (cmd?.autocomplete) await cmd.autocomplete(interaction, ctx);
      else await interaction.respond([]);
    } catch (err) {
      logger.debug(`Autocomplete /${interaction.commandName} failed:`, err.message);
      if (!interaction.responded) await interaction.respond([]).catch(() => {});
    }
  };

  const runComponent = async (interaction) => {
    const comp = findComponent(components, interaction.customId);
    if (!comp) {
      // Collectors (confirm, paginate) may answer this one; if nobody does in
      // time, the message is from a menu that no longer exists.
      setTimeout(() => {
        if (!interaction.replied && !interaction.deferred) replyEphemeral(interaction, embeds.info(t(interaction, 'common:errors.expired')));
      }, COLLECTOR_PREFIXES.some((p) => interaction.customId.startsWith(p)) ? EXPIRED_AFTER_MS : 0).unref?.();
      return;
    }
    if (!(await preflight(interaction, comp))) return;
    try {
      await comp.execute(interaction, ctx);
    } catch (err) {
      await handleError(interaction, err, comp);
    }
  };

  return async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) return await runCommand(interaction);
      if (interaction.isAutocomplete()) return await runAutocomplete(interaction);
      if (interaction.isMessageComponent() || interaction.isModalSubmit()) return await runComponent(interaction);
    } catch (err) {
      logger.error('Interaction router failed:', err);
    }
  };
}

/**
 * True when the member has every permission listed (used by components that
 * repeat a command's default_member_permissions check, since buttons skip it).
 * @param {import('discord.js').GuildMember} member
 * @param {Array<bigint|string>} perms
 */
function memberHas(member, perms) {
  const have = member?.permissions instanceof PermissionsBitField ? member.permissions : new PermissionsBitField(member?.permissions ?? 0n);
  return perms.every((p) => have.has(p));
}

module.exports = { createRouter, handleError, replyEphemeral, findComponent, preflight, memberHas, permissionList };
