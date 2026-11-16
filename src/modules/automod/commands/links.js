'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { GLOBAL, getConfig } = require('../lib/config');
const { normalizeDomain } = require('../lib/filters');

const MAX_DOMAINS = 200;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('links')
    .setDescription('Allowed and blocked domains of the links filter')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('allow').setDescription('Allow a domain (and its subdomains)')
      .addStringOption((o) => o.setName('domain').setDescription('e.g. youtube.com').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('deny').setDescription('Always block a domain (and its subdomains)')
      .addStringOption((o) => o.setName('domain').setDescription('e.g. example.com').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove a domain from both lists')
      .addStringOption((o) => o.setName('domain').setDescription('Domain').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('mode').setDescription('Block every link except allowed ones, or only denied ones')
      .addStringOption((o) => o.setName('mode').setDescription('Mode').setRequired(true)
        .addChoices({ name: 'allowlist', value: 'allowlist' }, { name: 'denylist', value: 'denylist' })))
    .addSubcommand((s) => s.setName('list').setDescription('Show both lists')),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const gs = ctx.store.guild(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    const err = (key, vars) => interaction.reply({ embeds: [embeds.error(t(interaction, 'automod:errors.title'), t(interaction, key, vars))], flags: MessageFlags.Ephemeral });

    if (sub === 'mode') gs.set(GLOBAL.linkMode.path, interaction.options.getString('mode', true));
    if (['allow', 'deny', 'remove'].includes(sub)) {
      const domain = normalizeDomain(interaction.options.getString('domain', true));
      if (!domain) return err('automod:errors.badDomain');
      const { links } = getConfig(gs);
      const allow = links.allow.filter((d) => d !== domain);
      const deny = links.deny.filter((d) => d !== domain);
      if (sub === 'remove' && allow.length === links.allow.length && deny.length === links.deny.length) return err('automod:errors.domainUnknown', { domain });
      if (sub === 'allow') allow.push(domain);
      if (sub === 'deny') deny.push(domain);
      if (allow.length > MAX_DOMAINS || deny.length > MAX_DOMAINS) return err('automod:errors.tooManyDomains', { max: MAX_DOMAINS });
      // A domain is in one list at most, so allow/deny never contradict each other.
      gs.set(GLOBAL.linkAllow.path, allow);
      gs.set(GLOBAL.linkDeny.path, deny);
    }

    const cfg = getConfig(gs);
    const fields = [
      { name: t(interaction, 'automod:links.mode'), value: `${t(interaction, `automod:linkModes.${cfg.links.mode}`)}\n${t(interaction, `automod:links.modeHelp.${cfg.links.mode}`)}` },
      { name: t(interaction, 'automod:links.allowed', { count: cfg.links.allow.length }), value: cfg.links.allow.map((d) => `\`${d}\``).join(', ').slice(0, 1000) || t(interaction, 'automod:status.none') },
      { name: t(interaction, 'automod:links.denied', { count: cfg.links.deny.length }), value: cfg.links.deny.map((d) => `\`${d}\``).join(', ').slice(0, 1000) || t(interaction, 'automod:status.none') }
    ];
    const footer = cfg.filters.links.enabled ? undefined : t(interaction, 'automod:links.filterOff');
    const title = t(interaction, 'automod:links.title');
    const embed = sub === 'list' ? embeds.info(title, undefined, { fields, footer }) : embeds.success(title, t(interaction, 'automod:links.saved'), { fields, footer });
    return interaction.reply({ embeds: [embed] });
  }
};
