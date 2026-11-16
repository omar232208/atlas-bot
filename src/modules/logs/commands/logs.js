'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { CATEGORIES, PATHS, DEFAULTS, channelIdFor } = require('../lib/config');

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const SEND_PERMS = ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles'];

const categoryOption = (o, required = true) => o.setName('category').setDescription('Log category').setRequired(required)
  .addChoices({ name: 'all', value: 'all' }, ...CATEGORIES.map((c) => ({ name: c, value: c })));

const data = new SlashCommandBuilder()
  .setName('logs')
  .setDescription('Configure log channels')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('set').setDescription('Send a category to a channel')
    .addStringOption((o) => categoryOption(o))
    .addChannelOption((o) => o.setName('channel').setDescription('Log channel').setRequired(true).addChannelTypes(...TEXT_TYPES)))
  .addSubcommand((s) => s.setName('disable').setDescription('Stop logging a category')
    .addStringOption((o) => categoryOption(o)))
  .addSubcommand((s) => s.setName('ignore').setDescription('Ignore or watch again a channel')
    .addChannelOption((o) => o.setName('channel').setDescription('Channel or category').setRequired(true)))
  .addSubcommand((s) => s.setName('bots').setDescription('Log messages from bots or not')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Log bot messages').setRequired(true)))
  .addSubcommand((s) => s.setName('status').setDescription('Show the log configuration'));

const reply = (interaction, embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

/**
 * Builds the status embed (also reused by tests through a fake getter).
 * @param {object} ctx
 * @param {*} target Language target.
 * @param {(path: string, def?: any) => any} get
 */
function statusEmbed(ctx, target, get) {
  const { t } = ctx;
  const fields = CATEGORIES.map((c) => {
    const own = get(PATHS.channel(c), null);
    const routed = channelIdFor(get, c);
    let value = t(target, 'logs:status.off');
    if (own) value = `<#${own}>`;
    else if (routed) value = t(target, 'logs:status.fallback', { channel: `<#${routed}>` });
    return { name: t(target, `logs:categories.${c}`), value, inline: true };
  });
  const ignored = get(PATHS.ignored, DEFAULTS.ignored) || [];
  fields.push({ name: t(target, 'logs:status.ignored'), value: ignored.length ? ignored.map((id) => `<#${id}>`).join(' ') : t(target, 'logs:status.none') });
  fields.push({ name: t(target, 'logs:status.bots'), value: t(target, get(PATHS.ignoreBots, DEFAULTS.ignoreBots) ? 'logs:status.botsIgnored' : 'logs:status.botsLogged') });
  return ctx.embeds.info(t(target, 'logs:status.title'), t(target, 'logs:status.description'), { fields });
}

module.exports = {
  data,
  statusEmbed,
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const g = ctx.store.guild(interaction.guildId);
    const sub = interaction.options.getSubcommand();
    const category = interaction.options.getString('category');
    const targets = category === 'all' ? CATEGORIES : [category];
    const label = (c) => (c === 'all' ? t(interaction, 'logs:categories.all') : t(interaction, `logs:categories.${c}`));

    if (sub === 'set') {
      const channel = interaction.options.getChannel('channel', true);
      const missing = ctx.permissions.botMissing(interaction.guild, SEND_PERMS, channel);
      if (missing.length) {
        return reply(interaction, embeds.error(t(interaction, 'logs:errors.title'), t(interaction, 'logs:errors.missingPerms', { channel: `<#${channel.id}>`, perms: missing.map((p) => `\`${p}\``).join(', ') })));
      }
      for (const c of targets) g.set(PATHS.channel(c), channel.id);
      return reply(interaction, embeds.success(t(interaction, 'logs:set.title'), t(interaction, 'logs:set.done', { category: label(category), channel: `<#${channel.id}>` })));
    }

    if (sub === 'disable') {
      for (const c of targets) g.delete(PATHS.channel(c));
      return reply(interaction, embeds.success(t(interaction, 'logs:disable.title'), t(interaction, 'logs:disable.done', { category: label(category) })));
    }

    if (sub === 'ignore') {
      const channel = interaction.options.getChannel('channel', true);
      let nowIgnored = false;
      g.update(PATHS.ignored, (list) => {
        const set = new Set(list || []);
        if (set.has(channel.id)) set.delete(channel.id);
        else { set.add(channel.id); nowIgnored = true; }
        return [...set];
      }, DEFAULTS.ignored);
      return reply(interaction, embeds.success(t(interaction, 'logs:ignore.title'), t(interaction, nowIgnored ? 'logs:ignore.added' : 'logs:ignore.removed', { channel: `<#${channel.id}>` })));
    }

    if (sub === 'bots') {
      const enabled = interaction.options.getBoolean('enabled', true);
      g.set(PATHS.ignoreBots, !enabled);
      return reply(interaction, embeds.success(t(interaction, 'logs:bots.title'), t(interaction, enabled ? 'logs:bots.on' : 'logs:bots.off')));
    }

    return reply(interaction, statusEmbed(ctx, interaction, g.get));
  }
};
