'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const duration = require('../../../core/duration');
const { SETTINGS, ACTIONS, ADDER_ACTIONS, coerce, readConfig } = require('../logic');
const { getRaid } = require('../raid');
const { getLockdown } = require('../lockdown');

const NS = 'antiraid';
const choices = (list) => list.map((v) => ({ name: v, value: v }));

// Option name -> setting key. Booleans and integers map one to one.
const OPTION_MAP = {
  join_threshold: 'joinThreshold', join_window: 'joinWindowSec', raid_action: 'raidAction', timeout_minutes: 'timeoutMinutes',
  raid_duration: 'raidDurationMin', punish_burst: 'punishBurst', auto_lockdown: 'autoLockdown', no_avatar: 'noAvatar',
  filter_action: 'filterAction', anti_bot: 'antiBot', allow_verified_bots: 'allowVerifiedBots', bot_adder_action: 'botAdderAction', dm_notice: 'dmNotice'
};

const data = new SlashCommandBuilder()
  .setName('antiraid')
  .setDescription('Configure raid protection')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('status').setDescription('Show raid protection settings'))
  .addSubcommand((s) => s.setName('enable').setDescription('Enable raid protection'))
  .addSubcommand((s) => s.setName('disable').setDescription('Disable raid protection'))
  .addSubcommand((s) => s.setName('set').setDescription('Change raid protection settings')
    .addIntegerOption((o) => o.setName('join_threshold').setDescription('Joins that trigger raid mode').setMinValue(SETTINGS.joinThreshold.min).setMaxValue(SETTINGS.joinThreshold.max))
    .addIntegerOption((o) => o.setName('join_window').setDescription('Detection window in seconds').setMinValue(SETTINGS.joinWindowSec.min).setMaxValue(SETTINGS.joinWindowSec.max))
    .addStringOption((o) => o.setName('raid_action').setDescription('Action on joiners during raid mode').addChoices(...choices(ACTIONS)))
    .addIntegerOption((o) => o.setName('timeout_minutes').setDescription('Timeout length in minutes').setMinValue(SETTINGS.timeoutMinutes.min).setMaxValue(SETTINGS.timeoutMinutes.max))
    .addIntegerOption((o) => o.setName('raid_duration').setDescription('Raid mode length in minutes').setMinValue(SETTINGS.raidDurationMin.min).setMaxValue(SETTINGS.raidDurationMin.max))
    .addBooleanOption((o) => o.setName('punish_burst').setDescription('Also punish the joins that triggered detection'))
    .addBooleanOption((o) => o.setName('auto_lockdown').setDescription('Lock channels when a raid starts'))
    .addStringOption((o) => o.setName('min_account_age').setDescription('Minimum account age (e.g. 7d, 0 = off)').setMaxLength(20))
    .addBooleanOption((o) => o.setName('no_avatar').setDescription('Filter accounts without avatar'))
    .addStringOption((o) => o.setName('filter_action').setDescription('Action for filtered accounts').addChoices(...choices(ACTIONS)))
    .addBooleanOption((o) => o.setName('anti_bot').setDescription('Kick bots added by untrusted members'))
    .addBooleanOption((o) => o.setName('allow_verified_bots').setDescription('Let verified bots in'))
    .addStringOption((o) => o.setName('bot_adder_action').setDescription('Action on who added the bot').addChoices(...choices(ADDER_ACTIONS)))
    .addBooleanOption((o) => o.setName('dm_notice').setDescription('DM a notice before kick or ban')));

/**
 * Builds the /antiraid status embed.
 * @param {object} ctx
 * @param {import('discord.js').Interaction} i
 */
function statusEmbed(ctx, i) {
  const t = (k, v) => ctx.t(i, `${NS}:${k}`, v);
  const cfg = readConfig(ctx.store.guild(i.guildId));
  const raid = getRaid(ctx.store, i.guildId);
  const lock = getLockdown(ctx.store, i.guildId);
  const yes = (b) => t(b ? 'status.on' : 'status.off');
  const age = cfg.minAccountAgeMs ? duration.format(cfg.minAccountAgeMs, i) : t('status.off');
  return ctx.embeds.info(t('status.title'), t(cfg.enabled ? 'status.enabled' : 'status.disabled'), {
    fields: [
      { name: t('status.detection'), value: t('status.detectionValue', { count: cfg.joinThreshold, seconds: cfg.joinWindowSec }), inline: true },
      { name: t('status.raidAction'), value: t(`actions.${cfg.raidAction}`) + (cfg.raidAction === 'timeout' ? ` (${duration.format(cfg.timeoutMinutes * 60000, i)})` : ''), inline: true },
      { name: t('status.raidDuration'), value: duration.format(cfg.raidDurationMin * 60000, i), inline: true },
      { name: t('status.punishBurst'), value: yes(cfg.punishBurst), inline: true },
      { name: t('status.autoLockdown'), value: yes(cfg.autoLockdown), inline: true },
      { name: t('status.dmNotice'), value: yes(cfg.dmNotice), inline: true },
      { name: t('status.accountAge'), value: age, inline: true },
      { name: t('status.noAvatar'), value: yes(cfg.noAvatar), inline: true },
      { name: t('status.filterAction'), value: t(`actions.${cfg.filterAction}`), inline: true },
      { name: t('status.antiBot'), value: yes(cfg.antiBot), inline: true },
      { name: t('status.verifiedBots'), value: yes(cfg.allowVerifiedBots), inline: true },
      { name: t('status.botAdder'), value: t(`actions.${cfg.botAdderAction}`), inline: true },
      { name: t('status.raidMode'), value: raid ? t('status.raidActive', { until: `<t:${Math.floor(raid.until / 1000)}:R>` }) : t('status.off'), inline: true },
      { name: t('lockdown.title'), value: lock ? t('status.lockActive', { count: Object.keys(lock.channels || {}).length }) : t('status.off'), inline: true }
    ]
  });
}

module.exports = {
  data,
  statusEmbed,
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const gs = ctx.store.guild(interaction.guildId);
    const t = (k, v) => ctx.t(interaction, `${NS}:${k}`, v);
    const flags = MessageFlags.Ephemeral;
    if (sub === 'status') return interaction.reply({ embeds: [statusEmbed(ctx, interaction)], flags });
    if (sub === 'enable' || sub === 'disable') {
      gs.set(SETTINGS.enabled.path, sub === 'enable');
      return interaction.reply({ embeds: [ctx.embeds.success(t(`set.${sub}d`), t(`set.${sub}dHelp`))], flags });
    }

    const changed = [];
    for (const [opt, key] of Object.entries(OPTION_MAP)) {
      const raw = interaction.options.get(opt)?.value;
      if (raw === undefined || raw === null) continue;
      gs.set(SETTINGS[key].path, coerce(SETTINGS[key], raw));
      changed.push(t(`dashboard.fields.${key}.label`));
    }
    const ageText = interaction.options.getString('min_account_age');
    if (ageText !== null) {
      const off = ['0', 'off', 'none', 'non', 'no'].includes(ageText.trim().toLowerCase());
      const ms = off ? 0 : duration.parse(ageText);
      if (ms === null) return interaction.reply({ embeds: [ctx.embeds.error(t('errors.badDuration'), t('errors.badDurationHelp'))], flags });
      gs.set(SETTINGS.minAccountAgeMs.path, coerce(SETTINGS.minAccountAgeMs, ms));
      changed.push(t('dashboard.fields.minAccountAgeMs.label'));
    }
    if (!changed.length) return interaction.reply({ embeds: [ctx.embeds.warn(t('set.nothing'))], flags });
    return interaction.reply({ embeds: [ctx.embeds.success(t('set.saved'), changed.map((c) => `- ${c}`).join('\n')), statusEmbed(ctx, interaction)], flags });
  }
};
