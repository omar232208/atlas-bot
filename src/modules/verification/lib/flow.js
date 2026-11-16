'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, PermissionFlagsBits } = require('discord.js');
const duration = require('../../../core/duration');
const { setting, roleProblem, KICK_JOB } = require('./config');
const { createChallenges, spaced, MAX_LENGTH } = require('./captcha');

const PREFIX = 'vrf:';
const BUTTON_ID = `${PREFIX}start`;
const MODAL_ID = `${PREFIX}modal`;
const INPUT_ID = 'code';

const challenges = createChallenges();
const keyOf = (guildId, userId) => `${guildId}:${userId}`;
const ephemeral = (embed) => ({ embeds: [embed], flags: MessageFlags.Ephemeral });

/**
 * Posts (or re-posts) the verification panel, removing the previous one.
 * @param {object} ctx
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ok: true, url: string}|{ok: false, reason: 'noChannel'|'missing', perms?: string[]}>}
 */
async function postPanel(ctx, guild) {
  const g = ctx.store.guild(guild.id);
  const channel = guild.channels.cache.get(setting(g, 'verification.channelId'));
  if (!channel?.isTextBased()) return { ok: false, reason: 'noChannel' };
  const missing = ctx.permissions.botMissing(guild, ['ViewChannel', 'SendMessages', 'EmbedLinks'], channel);
  if (missing.length) return { ok: false, reason: 'missing', perms: missing };
  const oldId = setting(g, 'verification.messageId');
  if (oldId) await channel.messages.delete(oldId).catch(() => {});
  const embed = ctx.embeds.info(ctx.t(guild, 'verification:panel.title'), setting(g, 'verification.panelMessage') || ctx.t(guild, 'verification:panel.description'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_ID).setStyle(ButtonStyle.Success).setLabel(ctx.t(guild, 'verification:panel.button'))
  );
  const message = await channel.send({ embeds: [embed], components: [row], _keepEmbeds: true });
  g.set('verification.messageId', message.id);
  return { ok: true, url: message.url };
}

/** Cancels the pending kick jobs of one member (or of the whole guild if userId is omitted). */
function cancelKicks(ctx, guildId, userId) {
  const jobs = ctx.scheduler.list(KICK_JOB, (p) => p?.guildId === guildId && (!userId || p.userId === userId));
  for (const job of jobs) ctx.scheduler.cancel(job.id);
  return jobs.length;
}

/**
 * Checks that verification can run for this member; returns an error embed or null.
 * @param {object} ctx
 * @param {import('discord.js').ButtonInteraction|import('discord.js').ModalSubmitInteraction} interaction
 */
function precheck(ctx, interaction) {
  const { t, embeds } = ctx;
  const g = ctx.store.guild(interaction.guildId);
  if (!setting(g, 'verification.enabled')) return embeds.error(t(interaction, 'verification:verify.title'), t(interaction, 'verification:verify.disabled'));
  const role = interaction.guild.roles.cache.get(setting(g, 'verification.roleId'));
  if (!role) return embeds.error(t(interaction, 'verification:verify.title'), t(interaction, 'verification:verify.noRole'));
  if (interaction.member.roles.cache.has(role.id)) return embeds.info(t(interaction, 'verification:verify.title'), t(interaction, 'verification:verify.already'));
  return null;
}

/** Button: shows the modal with a fresh code in the field label. */
async function onButton(interaction, ctx) {
  const problem = precheck(ctx, interaction);
  if (problem) return interaction.reply(ephemeral(problem));
  const { t } = ctx;
  const key = keyOf(interaction.guildId, interaction.user.id);
  const locked = challenges.lockedFor(key);
  if (locked) return interaction.reply(ephemeral(ctx.embeds.error(t(interaction, 'verification:verify.title'), t(interaction, 'verification:verify.locked', { time: duration.format(locked, interaction) }))));
  const code = challenges.issue(key, setting(ctx.store.guild(interaction.guildId), 'verification.codeLength'));
  const input = new TextInputBuilder()
    .setCustomId(INPUT_ID)
    .setLabel(t(interaction, 'verification:modal.label', { code: spaced(code) }).slice(0, 45))
    .setPlaceholder(t(interaction, 'verification:modal.placeholder').slice(0, 100))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(code.length)
    .setMaxLength(MAX_LENGTH * 2);
  const modal = new ModalBuilder().setCustomId(MODAL_ID).setTitle(t(interaction, 'verification:modal.title').slice(0, 45)).addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

/** Gives the verified role and removes the unverified one. */
async function grant(ctx, member) {
  const g = ctx.store.guild(member.guild.id);
  const role = member.guild.roles.cache.get(setting(g, 'verification.roleId'));
  const problem = role ? roleProblem(member.guild, role) : 'missingRole';
  if (problem) return problem;
  await member.roles.add(role, ctx.t(member.guild, 'verification:reasons.verified'));
  const unverified = member.guild.roles.cache.get(setting(g, 'verification.unverifiedRoleId'));
  if (unverified && member.roles.cache.has(unverified.id) && !roleProblem(member.guild, unverified)) {
    await member.roles.remove(unverified, ctx.t(member.guild, 'verification:reasons.verified')).catch(() => {});
  }
  return null;
}

/** Modal submit: checks the code and verifies the member. */
async function onModal(interaction, ctx) {
  const problem = precheck(ctx, interaction);
  if (problem) return interaction.reply(ephemeral(problem));
  const { t, embeds } = ctx;
  const g = ctx.store.guild(interaction.guildId);
  const key = keyOf(interaction.guildId, interaction.user.id);
  const answer = interaction.fields.getTextInputValue(INPUT_ID);
  const res = challenges.check(key, answer, setting(g, 'verification.maxAttempts'));
  const title = t(interaction, 'verification:verify.title');
  if (res.result === 'expired') return interaction.reply(ephemeral(embeds.error(title, t(interaction, 'verification:verify.expired'))));
  if (res.result === 'wrong') return interaction.reply(ephemeral(embeds.error(title, t(interaction, 'verification:verify.wrong', { left: res.left }))));
  if (res.result === 'locked') {
    await ctx.modlog.send(interaction.guild, 'verification', embeds.warn(t(interaction.guild, 'verification:logs.lockedTitle'), t(interaction.guild, 'verification:logs.locked', { user: `<@${interaction.user.id}> (\`${interaction.user.id}\`)` })), { _keepEmbeds: true });
    return interaction.reply(ephemeral(embeds.error(title, t(interaction, 'verification:verify.locked', { time: duration.format(res.lockedMs, interaction) }))));
  }
  let failure;
  try {
    failure = await grant(ctx, interaction.member);
  } catch (err) {
    failure = err.code === 50013 ? 'hierarchy' : 'error';
  }
  if (failure) {
    ctx.logger.warn(`verification: cannot give role in ${interaction.guildId} (${failure})`);
    return interaction.reply(ephemeral(embeds.error(title, t(interaction, 'verification:verify.grantFailed'))));
  }
  challenges.clear(key);
  cancelKicks(ctx, interaction.guildId, interaction.user.id);
  await ctx.modlog.send(interaction.guild, 'verification', embeds.success(t(interaction.guild, 'verification:logs.verifiedTitle'), t(interaction.guild, 'verification:logs.verified', { user: `<@${interaction.user.id}> (\`${interaction.user.id}\`)` })), { _keepEmbeds: true });
  return interaction.reply(ephemeral(embeds.success(title, t(interaction, 'verification:verify.success', { server: interaction.guild.name }))));
}

/**
 * New member: gives the unverified role and schedules the kick if configured.
 * @param {object} ctx
 * @param {import('discord.js').GuildMember} member
 */
async function onJoin(ctx, member) {
  if (member.user.bot) return;
  const g = ctx.store.guild(member.guild.id);
  if (!setting(g, 'verification.enabled')) return;
  const unverified = member.guild.roles.cache.get(setting(g, 'verification.unverifiedRoleId'));
  if (unverified && !roleProblem(member.guild, unverified)) {
    await member.roles.add(unverified, ctx.t(member.guild, 'verification:reasons.unverified')).catch((err) => ctx.logger.warn('verification: unverified role failed:', err.message));
  }
  const kickAfter = Number(setting(g, 'verification.kickAfter')) || 0;
  if (kickAfter > 0) ctx.scheduler.schedule(KICK_JOB, Date.now() + kickAfter, { guildId: member.guild.id, userId: member.id });
}

/**
 * Scheduler handler: kicks the member if still unverified, after a localized DM.
 * @param {import('discord.js').Client} client
 * @param {object} ctx
 * @param {{guildId: string, userId: string}} payload
 */
async function runKick(client, ctx, payload) {
  const guild = client.guilds.cache.get(payload?.guildId);
  if (!guild) return;
  const g = ctx.store.guild(guild.id);
  if (!setting(g, 'verification.enabled')) return;
  const member = await guild.members.fetch(payload.userId).catch(() => null);
  const roleId = setting(g, 'verification.roleId');
  if (!member || member.roles.cache.has(roleId)) return;
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.KickMembers) || !member.kickable) {
    ctx.logger.warn(`verification: cannot kick ${member.id} in ${guild.id} (missing Kick Members or hierarchy)`);
    return;
  }
  const time = duration.format(Number(setting(g, 'verification.kickAfter')), guild);
  await member.send({ embeds: [ctx.embeds.warn(ctx.t(guild, 'verification:kick.dmTitle', { server: guild.name }), ctx.t(guild, 'verification:kick.dm', { server: guild.name, time }))], _keepEmbeds: true }).catch(() => {});
  await member.kick(ctx.t(guild, 'verification:reasons.kick', { time }));
  challenges.clear(keyOf(guild.id, member.id));
  await ctx.modlog.send(guild, 'verification', ctx.embeds.warn(ctx.t(guild, 'verification:logs.kickedTitle'), ctx.t(guild, 'verification:logs.kicked', { user: `<@${member.id}> (\`${member.id}\`)`, time })), { _keepEmbeds: true });
}

/** Member left: no kick to run anymore, and their code is useless. */
function onLeave(ctx, member) {
  cancelKicks(ctx, member.guild.id, member.id);
  challenges.clear(keyOf(member.guild.id, member.id));
}

/**
 * Component router entry (customIds starting with "vrf:").
 * @param {import('discord.js').Interaction} interaction
 * @param {object} ctx
 */
async function handleComponent(interaction, ctx) {
  if (!interaction.inGuild() || !interaction.member) return;
  if (interaction.isButton() && interaction.customId === BUTTON_ID) return onButton(interaction, ctx);
  if (interaction.isModalSubmit() && interaction.customId === MODAL_ID) return onModal(interaction, ctx);
  return null;
}

module.exports = { PREFIX, BUTTON_ID, MODAL_ID, postPanel, cancelKicks, handleComponent, onJoin, onLeave, runKick, challenges };
