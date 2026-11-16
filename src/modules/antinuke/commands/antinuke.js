'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const duration = require('../../../core/duration');
const { ACTIONS, PUNISHMENTS, SETTINGS, coerce, readConfig } = require('../logic');
const { getPanic } = require('../panic');
const { release, listQuarantined } = require('../punish');

const NS = 'antinuke';
const NEEDED = ['ViewAuditLog', 'ManageRoles', 'ManageChannels', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageWebhooks', 'ManageGuildExpressions'];
const choices = (list) => list.map((v) => ({ name: v, value: v }));

const data = new SlashCommandBuilder()
  .setName('antinuke')
  .setDescription('Configure nuke protection')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName('status').setDescription('Show nuke protection settings'))
  .addSubcommand((s) => s.setName('enable').setDescription('Enable nuke protection'))
  .addSubcommand((s) => s.setName('disable').setDescription('Disable nuke protection'))
  .addSubcommand((s) => s.setName('limit').setDescription('Set the limit of an action')
    .addStringOption((o) => o.setName('action').setDescription('Watched action').setRequired(true).addChoices(...choices(ACTIONS)))
    .addIntegerOption((o) => o.setName('limit').setDescription('Actions allowed inside the window').setRequired(true).setMinValue(0).setMaxValue(100))
    .addIntegerOption((o) => o.setName('window').setDescription('Window in seconds').setMinValue(1).setMaxValue(86400)))
  .addSubcommand((s) => s.setName('punishment').setDescription('Choose the punishment')
    .addStringOption((o) => o.setName('type').setDescription('Punishment').setRequired(true).addChoices(...choices(PUNISHMENTS)))
    .addRoleOption((o) => o.setName('quarantine_role').setDescription('Role given in quarantine'))
    .addIntegerOption((o) => o.setName('timeout_minutes').setDescription('Timeout length in minutes').setMinValue(1).setMaxValue(40320)))
  .addSubcommand((s) => s.setName('settings').setDescription('Restore and panic options')
    .addBooleanOption((o) => o.setName('restore').setDescription('Undo what was done'))
    .addBooleanOption((o) => o.setName('auto_panic').setDescription('Start panic mode when a nuke is caught'))
    .addIntegerOption((o) => o.setName('panic_minutes').setDescription('Default panic length').setMinValue(5).setMaxValue(1440))
    .addBooleanOption((o) => o.setName('panic_strip_roles').setDescription('Remove dangerous permissions from roles during panic')))
  .addSubcommand((s) => s.setName('release').setDescription('Give back the roles removed from a member')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
  .addSubcommand((s) => s.setName('quarantined').setDescription('List members whose roles were removed'));

/**
 * Builds the status embed (also used by /antinuke enable).
 * @param {object} ctx
 * @param {import('discord.js').Interaction} i
 */
function statusEmbed(ctx, i) {
  const t = (k, v) => ctx.t(i, `${NS}:${k}`, v);
  const cfg = readConfig(ctx.store.guild(i.guildId));
  const panic = getPanic(ctx.store, i.guildId);
  const yes = (b) => t(b ? 'status.on' : 'status.off');
  const lines = ACTIONS.map((a) => t('status.limitLine', { action: t(`actions.${a}`), limit: cfg.limits[a].limit, seconds: cfg.limits[a].windowSec }));
  const missing = ctx.permissions.botMissing(i.guild, NEEDED);
  const punishment = t(`punishments.${cfg.punishment}`) + (cfg.punishment === 'quarantine' && cfg.quarantineRoleId ? ` (<@&${cfg.quarantineRoleId}>)` : '')
    + (cfg.punishment === 'timeout' ? ` (${duration.format(cfg.timeoutMinutes * 60000, i)})` : '');
  const fields = [
    { name: t('status.punishment'), value: punishment, inline: true },
    { name: t('status.restore'), value: yes(cfg.restore), inline: true },
    { name: t('status.autoPanic'), value: yes(cfg.autoPanic), inline: true },
    { name: t('status.panic'), value: panic ? t('status.panicActive', { until: `<t:${Math.floor(panic.until / 1000)}:R>` }) : t('status.off'), inline: true },
    { name: t('status.whitelist'), value: String(ctx.store.guild(i.guildId).get('whitelist', []).length), inline: true },
    { name: t('status.limits'), value: lines.join('\n') }
  ];
  if (missing.length) fields.push({ name: t('status.missing'), value: t('status.missingValue', { perms: missing.map((p) => t(`perms.${p}`)).join(', ') }) });
  fields.push({ name: t('status.tip'), value: t('status.tipValue') });
  return ctx.embeds.info(t('status.title'), t(cfg.enabled ? 'status.enabled' : 'status.disabled'), { fields });
}

const OWNER_ONLY = new Set(['enable', 'disable', 'limit', 'punishment', 'settings', 'release']);

module.exports = {
  data,
  statusEmbed,
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const t = (k, v) => ctx.t(interaction, `${NS}:${k}`, v);
    const flags = MessageFlags.Ephemeral;
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const gs = ctx.store.guild(guild.id);
    // A compromised administrator must not be able to switch the protection off.
    if (OWNER_ONLY.has(sub) && !ctx.permissions.isOwner(guild, interaction.user.id)) {
      return interaction.reply({ embeds: [ctx.embeds.error(t('errors.ownerOnly'), t('errors.ownerOnlyHelp'))], flags });
    }
    const saved = (desc) => interaction.reply({ embeds: [ctx.embeds.success(t('set.saved'), desc)], flags });

    switch (sub) {
      case 'status':
        return interaction.reply({ embeds: [statusEmbed(ctx, interaction)], flags });
      case 'enable':
      case 'disable':
        gs.set(SETTINGS.enabled.path, sub === 'enable');
        return interaction.reply({ embeds: [ctx.embeds.success(t(`set.${sub}d`), t(`set.${sub}dHelp`)), ...(sub === 'enable' ? [statusEmbed(ctx, interaction)] : [])], flags });
      case 'limit': {
        const action = interaction.options.getString('action', true);
        const limit = interaction.options.getInteger('limit', true);
        const windowSec = interaction.options.getInteger('window');
        gs.set(SETTINGS[`${action}Limit`].path, coerce(SETTINGS[`${action}Limit`], limit));
        if (windowSec !== null) gs.set(SETTINGS[`${action}Window`].path, coerce(SETTINGS[`${action}Window`], windowSec));
        const cfg = readConfig(gs);
        return saved(t('set.limitDone', { action: t(`actions.${action}`), limit: cfg.limits[action].limit, seconds: cfg.limits[action].windowSec }));
      }
      case 'punishment': {
        const type = interaction.options.getString('type', true);
        const role = interaction.options.getRole('quarantine_role');
        const minutes = interaction.options.getInteger('timeout_minutes');
        if (role) {
          if (role.managed || role.id === guild.id || role.position >= guild.members.me.roles.highest.position) {
            return interaction.reply({ embeds: [ctx.embeds.error(t('errors.badRole'), t('errors.badRoleHelp'))], flags });
          }
          gs.set(SETTINGS.quarantineRoleId.path, role.id);
        }
        if (type === 'quarantine' && !role && !readConfig(gs).quarantineRoleId) {
          return interaction.reply({ embeds: [ctx.embeds.error(t('errors.needRole'), t('errors.needRoleHelp'))], flags });
        }
        gs.set(SETTINGS.punishment.path, type);
        if (minutes !== null) gs.set(SETTINGS.timeoutMinutes.path, coerce(SETTINGS.timeoutMinutes, minutes));
        return saved(t('set.punishmentDone', { punishment: t(`punishments.${type}`) }));
      }
      case 'settings': {
        const map = { restore: 'restore', auto_panic: 'autoPanic', panic_minutes: 'panicMinutes', panic_strip_roles: 'panicStripRoles' };
        const changed = [];
        for (const [opt, key] of Object.entries(map)) {
          const value = interaction.options.get(opt)?.value;
          if (value === undefined || value === null) continue;
          gs.set(SETTINGS[key].path, coerce(SETTINGS[key], value));
          changed.push(`- ${t(`dashboard.fields.${key}.label`)}`);
        }
        if (!changed.length) return interaction.reply({ embeds: [ctx.embeds.warn(t('set.nothing'))], flags });
        return saved(changed.join('\n'));
      }
      case 'release': {
        const user = interaction.options.getUser('user', true);
        await interaction.deferReply({ flags });
        const res = await release(ctx, guild, user.id, readConfig(gs).quarantineRoleId, t('release.audit', { user: interaction.user.tag }));
        if (res.status !== 'done') return interaction.editReply({ embeds: [ctx.embeds.info(t(`release.${res.status}`, { user: `<@${user.id}>` }))] });
        return interaction.editReply({ embeds: [ctx.embeds.success(t('release.title'), t('release.done', { user: `<@${user.id}>`, ...res }))] });
      }
      default: {
        const list = listQuarantined(ctx.store, guild.id);
        if (!list.length) return interaction.reply({ embeds: [ctx.embeds.info(t('release.empty'))], flags });
        const lines = list.slice(0, 40).map((q) => t('release.line', { user: `<@${q.userId}>`, roles: q.roles.length, at: `<t:${Math.floor(q.at / 1000)}:R>` }));
        return interaction.reply({ embeds: [ctx.embeds.info(t('release.listTitle'), lines.join('\n'))], flags });
      }
    }
  }
};
