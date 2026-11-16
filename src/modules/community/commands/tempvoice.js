'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { COLLECTIONS } = require('../lib/config');
const { NS, en, fail, ok, respond, ensureBotPerms, requireMember, apiError } = require('../lib/util');
const TV = require('../lib/tempvoice');

async function setup(interaction, ctx, g) {
  if (!(await requireMember(interaction, ctx, PermissionFlagsBits.ManageChannels))) return null;
  if (Object.keys(g.get(COLLECTIONS.hubs, {})).length >= TV.MAX_HUBS) return fail(interaction, ctx, 'tempvoice.tooManyHubs', { max: TV.MAX_HUBS });
  const category = interaction.options.getChannel('category');
  if (!(await ensureBotPerms(interaction, ctx, TV.NEEDED, category || undefined))) return null;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const hub = await interaction.guild.channels.create({
      name: (interaction.options.getString('name') || ctx.t(interaction.guild, `${NS}:tempvoice.hubName`)).slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: category?.id,
      reason: ctx.t(interaction.guild, `${NS}:tempvoice.auditHub`)
    });
    g.set(TV.hubPath(hub.id), { categoryId: category?.id || null, createdBy: interaction.user.id });
    return ok(interaction, ctx, 'tempvoice.hubCreated', 'tempvoice.hubCreatedDesc', { channel: `<#${hub.id}>` });
  } catch (err) {
    return apiError(interaction, ctx, err);
  }
}

async function remove(interaction, ctx, g) {
  if (!(await requireMember(interaction, ctx, PermissionFlagsBits.ManageChannels))) return null;
  const channel = interaction.options.getChannel('hub', true);
  if (!g.get(TV.hubPath(channel.id), null)) return fail(interaction, ctx, 'tempvoice.notHub');
  g.delete(TV.hubPath(channel.id));
  if (interaction.options.getBoolean('delete') !== false) {
    await interaction.guild.channels.cache.get(channel.id)?.delete(ctx.t(interaction.guild, `${NS}:tempvoice.auditHub`)).catch(() => {});
  }
  return ok(interaction, ctx, 'tempvoice.hubRemoved');
}

async function list(interaction, ctx, g) {
  if (!(await requireMember(interaction, ctx, PermissionFlagsBits.ManageChannels))) return null;
  const hubs = Object.entries(g.get(COLLECTIONS.hubs, {}));
  const temps = Object.entries(g.get(COLLECTIONS.tempChannels, {}));
  if (!hubs.length) return fail(interaction, ctx, 'tempvoice.noHubs');
  const t = (k, v) => ctx.t(interaction, `${NS}:${k}`, v);
  return respond(interaction, ctx.embeds.info(t('tempvoice.listTitle'), null, {
    fields: [
      { name: t('tempvoice.hubs'), value: hubs.map(([id, h]) => `<#${id}>${h.categoryId ? ` → <#${h.categoryId}>` : ''}`).join('\n') },
      { name: t('tempvoice.active', { count: temps.length }), value: temps.length ? temps.slice(0, 20).map(([id, r]) => `<#${id}> — <@${r.ownerId}>`).join('\n') : t('common.none') }
    ]
  }), { ephemeral: true });
}

async function panel(interaction, ctx) {
  const channelId = interaction.member.voice?.channelId;
  const record = channelId ? TV.getTemp(ctx, interaction.guildId, channelId) : null;
  if (!record) return fail(interaction, ctx, 'tempvoice.notInTemp');
  if (record.ownerId !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return fail(interaction, ctx, 'tempvoice.notOwner', { owner: `<@${record.ownerId}>` });
  }
  return interaction.reply({ ...TV.panel(ctx.t, interaction, channelId, record.ownerId), flags: MessageFlags.Ephemeral });
}

const HANDLERS = { setup, remove, list, panel };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempvoice')
    .setDescription(en('commands.tempvoice.description'))
    .addSubcommand((sc) => sc.setName('setup').setDescription(en('commands.tempvoice.options.setup.description'))
      .addChannelOption((o) => o.setName('category').setDescription(en('commands.tempvoice.options.setup.options.category')).addChannelTypes(ChannelType.GuildCategory))
      .addStringOption((o) => o.setName('name').setDescription(en('commands.tempvoice.options.setup.options.name')).setMaxLength(100)))
    .addSubcommand((sc) => sc.setName('remove').setDescription(en('commands.tempvoice.options.remove.description'))
      .addChannelOption((o) => o.setName('hub').setDescription(en('commands.tempvoice.options.remove.options.hub')).setRequired(true).addChannelTypes(ChannelType.GuildVoice))
      .addBooleanOption((o) => o.setName('delete').setDescription(en('commands.tempvoice.options.remove.options.delete'))))
    .addSubcommand((sc) => sc.setName('list').setDescription(en('commands.tempvoice.options.list.description')))
    .addSubcommand((sc) => sc.setName('panel').setDescription(en('commands.tempvoice.options.panel.description'))),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  execute(interaction, ctx) {
    return HANDLERS[interaction.options.getSubcommand()](interaction, ctx, ctx.store.guild(interaction.guildId));
  }
};
