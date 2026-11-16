'use strict';

const { PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { COLLECTIONS } = require('../lib/config');
const { NS, en, fail, ok, respond, ensureBotPerms, apiError } = require('../lib/util');
const stats = require('../lib/stats');

const MAX_CHANNELS = 10;
const statPath = (id) => [...COLLECTIONS.stats.split('.'), id];

async function add(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const existing = g.get(COLLECTIONS.stats, {});
  if (Object.keys(existing).length >= MAX_CHANNELS) return fail(interaction, ctx, 'stats.tooMany', { max: MAX_CHANNELS });
  const type = interaction.options.getString('type', true);
  const template = interaction.options.getString('template') || ctx.t(interaction.guild, `${NS}:stats.defaults.${type}`);
  if (!template.includes('{count}')) return fail(interaction, ctx, 'stats.needCount');
  const category = interaction.options.getChannel('category');
  if (!(await ensureBotPerms(interaction, ctx, [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel]))) return null;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const bots = type === 'bots' || type === 'humans' ? await stats.botCount(interaction.guild) : 0;
    const value = stats.counts(interaction.guild, bots)[type];
    // Members can see the channel but not join it: it is a read-only counter.
    const channel = await interaction.guild.channels.create({
      name: stats.render(template, value, ctx.t(interaction.guild, `${NS}:meta.locale`)),
      type: ChannelType.GuildVoice,
      parent: category?.id,
      position: 0,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] },
        { id: ctx.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] }
      ],
      reason: ctx.t(interaction.guild, `${NS}:stats.auditReason`)
    });
    stats.limiter.record(channel.id);
    g.set(statPath(channel.id), { type, template, createdBy: interaction.user.id });
    return ok(interaction, ctx, 'stats.added', 'stats.addedDesc', { channel: `<#${channel.id}>`, type: ctx.t(interaction, `${NS}:stats.types.${type}`) });
  } catch (err) {
    return apiError(interaction, ctx, err);
  }
}

async function remove(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const channel = interaction.options.getChannel('channel', true);
  if (!g.get(statPath(channel.id), null)) return fail(interaction, ctx, 'stats.notStat');
  g.delete(statPath(channel.id));
  stats.limiter.forget(channel.id);
  if (interaction.options.getBoolean('delete') !== false) {
    const real = interaction.guild.channels.cache.get(channel.id);
    if (real) await real.delete(ctx.t(interaction.guild, `${NS}:stats.auditReason`)).catch(() => {});
  }
  return ok(interaction, ctx, 'stats.removed');
}

async function list(interaction, ctx) {
  const entries = Object.entries(ctx.store.guild(interaction.guildId).get(COLLECTIONS.stats, {}));
  if (!entries.length) return fail(interaction, ctx, 'stats.listEmpty');
  const lines = entries.map(([id, c]) => ctx.t(interaction, `${NS}:stats.listLine`, { channel: `<#${id}>`, type: ctx.t(interaction, `${NS}:stats.types.${c.type}`), template: c.template.replace(/`/g, "'") }));
  return respond(interaction, ctx.embeds.info(ctx.t(interaction, `${NS}:stats.listTitle`), lines.join('\n'), { footer: ctx.t(interaction, `${NS}:stats.rateNote`) }), { ephemeral: true });
}

async function refresh(interaction, ctx) {
  if (!stats.hasStats(ctx, interaction.guildId)) return fail(interaction, ctx, 'stats.listEmpty');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { renamed, waiting } = await stats.refresh(ctx, interaction.guild);
  return ok(interaction, ctx, 'stats.refreshed', waiting ? 'stats.refreshedWaiting' : 'stats.refreshedDesc', { count: renamed });
}

const HANDLERS = { add, remove, list, refresh };

module.exports = {
  name: 'stats',
  /** Member permission checked at runtime: /community mixes features of different staff levels. */
  permission: PermissionFlagsBits.ManageChannels,
  /**
   * Adds this subcommand group to /community.
   * @param {import('discord.js').SlashCommandSubcommandGroupBuilder} group
   */
  build: (group) => group
    .setName('stats')
    .setDescription(en('commands.community.options.stats.description'))
    .addSubcommand((sc) => sc.setName('add').setDescription(en('commands.community.options.stats.options.add.description'))
      .addStringOption((o) => o.setName('type').setDescription(en('commands.community.options.stats.options.add.options.type.description')).setRequired(true)
        .addChoices(...stats.TYPES.map((v) => ({ name: en(`commands.community.options.stats.options.add.options.type.choices.${v}`), value: v }))))
      .addStringOption((o) => o.setName('template').setDescription(en('commands.community.options.stats.options.add.options.template')).setMaxLength(90))
      .addChannelOption((o) => o.setName('category').setDescription(en('commands.community.options.stats.options.add.options.category')).addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand((sc) => sc.setName('remove').setDescription(en('commands.community.options.stats.options.remove.description'))
      .addChannelOption((o) => o.setName('channel').setDescription(en('commands.community.options.stats.options.remove.options.channel')).setRequired(true).addChannelTypes(ChannelType.GuildVoice))
      .addBooleanOption((o) => o.setName('delete').setDescription(en('commands.community.options.stats.options.remove.options.delete'))))
    .addSubcommand((sc) => sc.setName('list').setDescription(en('commands.community.options.stats.options.list.description')))
    .addSubcommand((sc) => sc.setName('refresh').setDescription(en('commands.community.options.stats.options.refresh.description'))),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  execute(interaction, ctx) {
    return HANDLERS[interaction.options.getSubcommand()](interaction, ctx);
  }
};
