'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { confirm } = require('../../../core/confirm');
const settings = require('../lib/settings');

const NS = 'core-commands';

/** Field showing which protection modules are on, only for the ones loaded. */
function protectionField(ctx, interaction) {
  const guildStore = ctx.store.guild(interaction.guildId);
  const lines = settings.loadedProtections(ctx.modules).map((p) => {
    const on = guildStore.get(p.path, false) === true;
    return `${ctx.t(interaction, `${NS}:protections.${p.module}`)} : ${ctx.t(interaction, on ? 'common:enabled' : 'common:disabled')}`;
  });
  return lines.length ? { name: ctx.t(interaction, `${NS}:config.protections`), value: lines.join('\n') } : null;
}

/** /config show */
async function show(interaction, ctx) {
  const guildStore = ctx.store.guild(interaction.guildId);
  const lang = ctx.i18n.resolveLang(interaction);
  const saved = guildStore.get('language', null);
  const whitelist = guildStore.get('whitelist', []);
  const setup = guildStore.get('setup', null);
  const logChannels = Object.entries(guildStore.get('logs.channels', {}) || {}).filter(([, id]) => id);
  const fields = [
    { name: ctx.t(interaction, `${NS}:config.language`), value: `${settings.LANGUAGE_NAMES[lang]}${saved ? '' : ` (${ctx.t(interaction, `${NS}:config.default`)})`}`, inline: true },
    { name: ctx.t(interaction, `${NS}:config.whitelist`), value: ctx.t(interaction, `${NS}:config.whitelistValue`, { count: Array.isArray(whitelist) ? whitelist.length : 0 }), inline: true },
    {
      name: ctx.t(interaction, `${NS}:config.setup`),
      value: setup?.completedAt ? ctx.t(interaction, `${NS}:config.setupDone`, { date: `<t:${Math.floor(setup.completedAt / 1000)}:D>`, user: `<@${setup.by}>` }) : ctx.t(interaction, `${NS}:config.setupNever`),
      inline: true
    },
    {
      name: ctx.t(interaction, `${NS}:config.logs`),
      value: logChannels.length ? logChannels.map(([cat, id]) => `${cat} : <#${id}>`).join('\n') : ctx.t(interaction, 'common:notSet')
    }
  ];
  const prot = protectionField(ctx, interaction);
  if (prot) fields.push(prot);
  if (process.env.DASHBOARD_URL && ctx.modules.some((m) => m.name === 'dashboard')) {
    fields.push({ name: ctx.t(interaction, `${NS}:config.dashboard`), value: process.env.DASHBOARD_URL });
  }
  return interaction.reply({ embeds: [ctx.embeds.info(ctx.t(interaction, `${NS}:config.showTitle`, { server: interaction.guild.name }), undefined, { fields })], flags: MessageFlags.Ephemeral });
}

/** /config language <value> */
async function language(interaction, ctx) {
  const value = interaction.options.getString('value', true);
  ctx.store.guild(interaction.guildId).set('language', value);
  // Answer in the language just chosen, so the admin sees the effect at once.
  return interaction.reply({ embeds: [ctx.embeds.success(ctx.t(value, `${NS}:config.languageSetTitle`), ctx.t(value, `${NS}:config.languageSet`, { language: settings.LANGUAGE_NAMES[value] }))] });
}

/** /config reset: wipes every setting of this server after confirmation. */
async function reset(interaction, ctx) {
  const ok = await confirm(interaction, { description: ctx.t(interaction, `${NS}:config.resetConfirm`) });
  if (!ok) return;
  ctx.store.guild(interaction.guildId).reset();
  ctx.logger.child('core-commands').info(`Settings of guild ${interaction.guildId} reset by ${interaction.user.id}`);
  await interaction.editReply({ embeds: [ctx.embeds.success(ctx.t(interaction, `${NS}:config.resetTitle`), ctx.t(interaction, `${NS}:config.resetDone`))], components: [] });
}

/** /config language|show|reset */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Bot settings for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('language').setDescription('Change the bot language on this server')
      .addStringOption((o) => o.setName('value').setDescription('Language').setRequired(true)
        .addChoices(...settings.LANGUAGES.map((l) => ({ name: settings.LANGUAGE_NAMES[l], value: l })))))
    .addSubcommand((s) => s.setName('show').setDescription('Show the current settings'))
    .addSubcommand((s) => s.setName('reset').setDescription('Reset every setting of this server')),

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'language') return language(interaction, ctx);
    if (sub === 'reset') {
      // Wiping everything (protections included) is reserved to owners.
      if (!ctx.permissions.isOwner(interaction.guild, interaction.user.id)) {
        return interaction.reply({ embeds: [ctx.embeds.error(ctx.t(interaction, 'common:errors.permissionTitle'), ctx.t(interaction, 'common:errors.ownerOnly'))], flags: MessageFlags.Ephemeral });
      }
      return reset(interaction, ctx);
    }
    return show(interaction, ctx);
  }
};
