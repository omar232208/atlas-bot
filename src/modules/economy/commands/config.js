'use strict';

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const permissions = require('../../../core/permissions');
const { LIMITS, getConfig, formatMoney, currencyName } = require('../lib/config');
const { send, fail } = require('../lib/reply');

/** Integer option bounded by LIMITS, so the command and the dashboard agree. */
const intOption = (name, key, description) => (o) => o.setName(name).setDescription(description).setRequired(false)
  .setMinValue(LIMITS[key][0])
  .setMaxValue(LIMITS[key][1]);

/** Option name (snake_case, Discord style) to config key. */
const OPTION_TO_KEY = Object.freeze({
  currency: 'currency', symbol: 'symbol', daily: 'daily', weekly: 'weekly',
  work_min: 'workMin', work_max: 'workMax', rob_fail: 'robFailPercent'
});

/**
 * /eco config: admin settings (Manage Server). Shows the current values when no
 * option is given. Used as the "config" subcommand of /eco.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Show or change the economy settings (Manage Server)')
    .addStringOption((o) => o.setName('currency').setDescription('Currency name').setRequired(false).setMaxLength(24))
    .addStringOption((o) => o.setName('symbol').setDescription('Currency symbol').setRequired(false).setMaxLength(8))
    .addIntegerOption(intOption('daily', 'daily', 'Daily reward'))
    .addIntegerOption(intOption('weekly', 'weekly', 'Weekly reward'))
    .addIntegerOption(intOption('work_min', 'workMin', 'Minimum work pay'))
    .addIntegerOption(intOption('work_max', 'workMax', 'Maximum work pay'))
    .addIntegerOption(intOption('rob_fail', 'robFailPercent', 'Chance (%) that a robbery fails')),
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const isAdmin = permissions.isOwner(interaction.guild, interaction.user.id)
      || !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!isAdmin) return fail(ctx, interaction, 'economy:errors.adminOnly');

    const changes = {};
    for (const option of Object.keys(OPTION_TO_KEY)) {
      const value = option === 'currency' || option === 'symbol'
        ? interaction.options.getString(option)
        : interaction.options.getInteger(option);
      if (value !== null && value !== undefined) changes[OPTION_TO_KEY[option]] = value;
    }

    if (Object.keys(changes).length) {
      const merged = { ...getConfig(ctx.store, guildId), ...changes };
      if (merged.workMin > merged.workMax) return fail(ctx, interaction, 'economy:config.minAboveMax');
      for (const [key, value] of Object.entries(changes)) {
        ctx.store.guild(guildId).set(`economy.config.${key}`, value);
      }
    }

    const cfg = getConfig(ctx.store, guildId);
    const fields = [
      { name: ctx.t(interaction, 'economy:config.currency'), value: currencyName(cfg, interaction), inline: true },
      { name: ctx.t(interaction, 'economy:config.symbol'), value: cfg.symbol, inline: true },
      { name: ctx.t(interaction, 'economy:config.daily'), value: formatMoney(cfg.daily, cfg, interaction), inline: true },
      { name: ctx.t(interaction, 'economy:config.weekly'), value: formatMoney(cfg.weekly, cfg, interaction), inline: true },
      { name: ctx.t(interaction, 'economy:config.work'), value: `${formatMoney(cfg.workMin, cfg, interaction)} – ${formatMoney(cfg.workMax, cfg, interaction)}`, inline: true },
      { name: ctx.t(interaction, 'economy:config.robFail'), value: `${cfg.robFailPercent} %`, inline: true }
    ];
    const title = ctx.t(interaction, Object.keys(changes).length ? 'economy:config.saved' : 'economy:config.title');
    return send(interaction, ctx.embeds.info(title, undefined, { fields }));
  }
};
