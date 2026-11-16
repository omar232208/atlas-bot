'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const NS = 'roles';

/** Defaults of the settings stored under "roles.config" (shared with the dashboard schema). */
const DEFAULTS = Object.freeze({
  tempRoleDm: true,
  logChanges: true
});

/**
 * Permissions that must never be handed out by a self-service menu: a member
 * clicking a button would otherwise become a moderator or an admin.
 */
const DANGEROUS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ManageMessages
];

/**
 * Reads the roles settings merged with defaults.
 * @param {object} store
 * @param {string} guildId
 * @returns {typeof DEFAULTS}
 */
function getConfig(store, guildId) {
  return { ...DEFAULTS, ...store.guild(guildId).get('roles.config', {}) };
}

/**
 * Checks whether a role can be given/removed by the bot on behalf of `member`.
 * Pure on purpose (works on plain objects) so it can be tested.
 * @param {{id: string, managed?: boolean, position: number, permissions?: {has: Function}}} role
 * @param {{guildId: string, botTop: number, actorTop: number, actorIsOwner: boolean, selfService?: boolean}} env
 * @returns {string|null} Locale key (inside the roles namespace) of the problem, or null.
 */
function roleProblem(role, env) {
  if (!role) return 'errors.roleGone';
  if (role.id === env.guildId) return 'errors.everyone';
  if (role.managed) return 'errors.managed';
  if (role.position >= env.botTop) return 'errors.botHierarchy';
  if (!env.actorIsOwner && role.position >= env.actorTop) return 'errors.userHierarchy';
  if (env.selfService && DANGEROUS.some((p) => role.permissions?.has?.(p, false))) return 'errors.dangerous';
  return null;
}

/**
 * roleProblem() bound to real Discord objects.
 * @param {import('discord.js').Role} role
 * @param {import('discord.js').GuildMember} actor
 * @param {object} ctx
 * @param {boolean} [selfService]
 */
function checkRole(role, actor, ctx, selfService = false) {
  const guild = actor.guild;
  return roleProblem(role, {
    guildId: guild.id,
    botTop: guild.members.me?.roles.highest.position ?? 0,
    actorTop: actor.roles.highest.position,
    actorIsOwner: ctx.permissions.isOwner(guild, actor.id),
    selfService
  });
}

/**
 * Replies or edits the deferred reply with an embed (ephemeral by default).
 */
async function respond(interaction, embed, extra = {}) {
  const payload = { embeds: [embed], components: [], ...extra };
  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch {
    return null;
  }
}

/** Localized error reply. */
function fail(interaction, ctx, key, vars) {
  return respond(interaction, ctx.embeds.error(ctx.t(interaction, `${NS}:errors.title`), ctx.t(interaction, `${NS}:${key}`, vars)));
}

/** Clear message for Discord permission errors; anything else is logged. */
function apiFail(interaction, ctx, err) {
  if (err?.code === 50013 || err?.code === 50001) return fail(interaction, ctx, 'errors.discordPermission');
  ctx.logger.error('roles:', err);
  return fail(interaction, ctx, 'errors.unexpected');
}

/** Tells the user which permissions the bot lacks; true when something is missing. */
async function checkBotPerms(interaction, ctx, perms, channel) {
  const missing = ctx.permissions.botMissing(interaction.guild, perms, channel);
  if (!missing.length) return false;
  await fail(interaction, ctx, 'errors.botMissing', { perms: missing.join(', ') });
  return true;
}

module.exports = { NS, DEFAULTS, DANGEROUS, getConfig, roleProblem, checkRole, respond, fail, apiFail, checkBotPerms };
