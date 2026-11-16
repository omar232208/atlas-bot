'use strict';

const {
  SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType
} = require('discord.js');
const settings = require('../lib/settings');
const { memberHas } = require('../../../core/interactions');

const NS = 'core-commands';
const PREFIX = 'core:setup:';
const LOG_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

/** Steps shown for this bot: the protections step only exists if a protection module is loaded. */
function stepsFor(ctx) {
  const steps = ['language'];
  if (ctx.modules.some((m) => m.name === 'logs')) steps.push('logs');
  if (settings.loadedProtections(ctx.modules).length) steps.push('protections');
  steps.push('done');
  return steps;
}

const nav = (ctx, target, steps, step) => {
  const index = steps.indexOf(step);
  const row = new ActionRowBuilder();
  if (index > 0) row.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}go:${steps[index - 1]}`).setStyle(ButtonStyle.Secondary).setLabel(ctx.t(target, 'common:back')));
  if (step !== 'done') row.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}go:${steps[index + 1]}`).setStyle(ButtonStyle.Secondary).setLabel(ctx.t(target, 'common:skip')));
  return row;
};

/**
 * Builds the message of one wizard step. State lives in the store and the step
 * in the custom id, so the wizard keeps working after a restart.
 * @param {object} ctx
 * @param {import('discord.js').Interaction} interaction
 * @param {string} step language | logs | protections | done
 * @param {string} [notice] Extra line (e.g. a permission warning).
 */
function render(ctx, interaction, step, notice) {
  const steps = stepsFor(ctx);
  if (!steps.includes(step)) step = 'done';
  const t = (key, vars) => ctx.t(interaction, `${NS}:setup.${key}`, vars);
  const guildStore = ctx.store.guild(interaction.guildId);
  const footer = t('step', { step: steps.indexOf(step) + 1, total: steps.length });
  const components = [];
  let description;

  if (step === 'language') {
    description = t('languageIntro');
    const current = ctx.i18n.resolveLang(interaction);
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}lang`).setPlaceholder(t('languagePlaceholder'))
      .addOptions(settings.LANGUAGES.map((l) => ({ label: settings.LANGUAGE_NAMES[l], value: l, default: l === current })))));
  } else if (step === 'logs') {
    description = t('logsIntro');
    components.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`${PREFIX}logs`).setPlaceholder(t('logsPlaceholder'))
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));
  } else if (step === 'protections') {
    description = t('protectionsIntro');
    const prots = settings.loadedProtections(ctx.modules);
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}prot`).setPlaceholder(t('protectionsPlaceholder'))
      .setMinValues(0).setMaxValues(prots.length)
      .addOptions(prots.map((p) => ({
        label: ctx.t(interaction, `${NS}:protections.${p.module}`),
        description: ctx.t(interaction, `${NS}:protectionsHelp.${p.module}`).slice(0, 100),
        value: p.module,
        default: guildStore.get(p.path, false) === true
      })))));
  } else {
    const logId = guildStore.get('logs.channels.moderation', null);
    const enabled = settings.loadedProtections(ctx.modules).filter((p) => guildStore.get(p.path, false) === true).map((p) => ctx.t(interaction, `${NS}:protections.${p.module}`));
    description = `${t('doneIntro')}\n\n${t('doneLanguage', { language: settings.LANGUAGE_NAMES[ctx.i18n.resolveLang(interaction)] })}\n`
      + `${t('doneLogs', { channel: logId ? `<#${logId}>` : ctx.t(interaction, 'common:notSet') })}\n`
      + `${t('doneProtections', { list: enabled.length ? enabled.join(', ') : ctx.t(interaction, 'common:none') })}\n\n${t('doneNext')}`;
  }
  if (notice) description = `${notice}\n\n${description}`;
  components.push(nav(ctx, interaction, steps, step));
  const embed = step === 'done' ? ctx.embeds.success(t('doneTitle'), description, { footer }) : ctx.embeds.info(t(`${step}Title`), description, { footer });
  return { embeds: [embed], components };
}

/** Saves the "setup completed" marker shown by /config show. */
function markDone(ctx, interaction) {
  ctx.store.guild(interaction.guildId).set('setup', { completedAt: Date.now(), by: interaction.user.id });
}

/** Handles every wizard component; the admin check is repeated because buttons skip default_member_permissions. */
async function onComponent(interaction, ctx) {
  if (!interaction.inGuild() || !memberHas(interaction.member, [PermissionFlagsBits.ManageGuild])) {
    return interaction.reply({ embeds: [ctx.embeds.error(ctx.t(interaction, 'common:errors.permissionTitle'), ctx.t(interaction, 'common:errors.missingUserPermissions', { permissions: `**${ctx.permissions.permissionLabel(interaction, 'ManageGuild')}**` }))], flags: MessageFlags.Ephemeral });
  }
  const action = interaction.customId.slice(PREFIX.length);
  const steps = stepsFor(ctx);
  const after = (step) => steps[steps.indexOf(step) + 1] || 'done';
  const guildStore = ctx.store.guild(interaction.guildId);
  const go = (step, notice) => {
    if (step === 'done') markDone(ctx, interaction);
    return interaction.update(render(ctx, interaction, step, notice));
  };

  if (action === 'lang' && interaction.isStringSelectMenu()) {
    guildStore.set('language', interaction.values[0]);
    return go(after('language'));
  }
  if (action === 'logs' && interaction.isChannelSelectMenu()) {
    const channel = interaction.channels.first();
    const missing = ctx.permissions.botMissing(interaction.guild, LOG_PERMS, channel);
    if (missing.length) {
      const notice = ctx.t(interaction, 'common:errors.missingBotPermissions', { permissions: missing.map((p) => `**${ctx.permissions.permissionLabel(interaction, p)}**`).join(', ') });
      return go('logs', notice);
    }
    for (const category of settings.LOG_CATEGORIES) guildStore.set(`logs.channels.${category}`, channel.id);
    return go(after('logs'));
  }
  if (action === 'prot' && interaction.isStringSelectMenu()) {
    const chosen = new Set(interaction.values);
    for (const p of settings.loadedProtections(ctx.modules)) guildStore.set(p.path, chosen.has(p.module));
    return go(after('protections'));
  }
  if (action.startsWith('go:')) return go(action.slice(3));
  return go('language');
}

/** /setup: guided first-time configuration (language, log channel, protections). */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Guided first-time setup of the bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  cooldown: 5,

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    return interaction.reply({ ...render(ctx, interaction, 'language'), flags: MessageFlags.Ephemeral });
  },

  component: { prefix: PREFIX, execute: onComponent },
  render, stepsFor
};
