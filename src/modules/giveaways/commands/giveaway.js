'use strict';

const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const duration = require('../../../core/duration');
const permissions = require('../../../core/permissions');
const { MIN_DURATION_MS, getConfig, newId, listGiveaways } = require('../lib/logic');
const { giveawayEmbed, enterRow, relative } = require('../lib/render');
const { load, save, endGiveaway, rerollGiveaway, cancelGiveaway } = require('../lib/finish');

const DAY = 24 * 60 * 60 * 1000;
const MAX_WINNERS = 20;
const MAX_AGE_DAYS = 365;

/** Reply helper that also works after a deferred reply. */
function answer(interaction, embed, ephemeral = false) {
  if (interaction.deferred || interaction.replied) return interaction.editReply({ embeds: [embed] });
  return interaction.reply({ embeds: [embed], flags: ephemeral ? 64 : undefined });
}

const fail = (ctx, interaction, key, vars) => answer(interaction, ctx.embeds.error(ctx.t(interaction, 'giveaways:errors.title'), ctx.t(interaction, key, vars)), true);

/** Start, end, reroll, cancel and list need Manage Server (or bot owner rights). */
const isAdmin = (interaction) => permissions.isOwner(interaction.guild, interaction.user.id)
  || !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

/** Autocomplete for the id option: any giveaway of the guild, by prize or id. */
async function autocomplete(interaction, ctx) {
  const typed = String(interaction.options.getFocused() || '').toLowerCase();
  const choices = listGiveaways(ctx.store, interaction.guildId)
    .filter((g) => g.prize.toLowerCase().includes(typed) || g.id.includes(typed))
    .slice(0, 25)
    .map((g) => ({ name: `${g.prize} (${g.status})`.slice(0, 100), value: g.id }));
  return interaction.respond(choices);
}

/** Creates the giveaway, posts it and arms the end job. */
async function start(interaction, ctx) {
  const guildId = interaction.guildId;
  const cfg = getConfig(ctx.store, guildId);
  const ms = duration.parse(interaction.options.getString('duration', true));
  if (!ms) return fail(ctx, interaction, 'giveaways:errors.badDuration');
  if (ms < MIN_DURATION_MS) return fail(ctx, interaction, 'giveaways:errors.tooShort');
  if (ms > cfg.maxDays * DAY) return fail(ctx, interaction, 'giveaways:errors.tooLong', { max: cfg.maxDays });

  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const missing = permissions.botMissing(interaction.guild, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel);
  if (missing.length) return fail(ctx, interaction, 'giveaways:errors.botMissing', { perms: missing.join(', ') });

  const role = interaction.options.getRole('role');
  const record = {
    id: newId(),
    guildId,
    channelId: channel.id,
    messageId: null,
    prize: interaction.options.getString('prize', true).trim(),
    winnersCount: interaction.options.getInteger('winners') ?? 1,
    hostId: interaction.user.id,
    createdAt: Date.now(),
    endsAt: Date.now() + ms,
    requiredRoleId: role?.id ?? null,
    minAccountDays: interaction.options.getInteger('min_account_days') ?? 0,
    entries: {},
    status: 'active',
    winnerIds: [],
    jobId: null
  };

  let message;
  try {
    message = await channel.send({ embeds: [giveawayEmbed(ctx, interaction, record)], components: [enterRow(ctx, interaction, record)] });
  } catch (err) {
    ctx.logger.warn(`giveaway: could not post in ${channel.id}:`, err.message);
    return fail(ctx, interaction, 'giveaways:errors.postFailed');
  }
  record.messageId = message.id;
  record.jobId = ctx.scheduler.schedule('giveaways:end', record.endsAt, { guildId, giveawayId: record.id });
  save(ctx, guildId, record);
  const link = `https://discord.com/channels/${guildId}/${channel.id}/${message.id}`;
  return answer(interaction, ctx.embeds.success(
    ctx.t(interaction, 'giveaways:start.title'),
    ctx.t(interaction, 'giveaways:start.done', { id: record.id, link, time: relative(record.endsAt) })
  ));
}

/** Subcommand router. */
async function execute(interaction, ctx) {
  if (!isAdmin(interaction)) return fail(ctx, interaction, 'giveaways:errors.adminOnly');
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') return start(interaction, ctx);
  if (sub === 'list') return list(interaction, ctx);

  await interaction.deferReply();
  const id = interaction.options.getString('id', true);
  const client = interaction.client;
  if (!load(ctx, interaction.guildId, id)) return fail(ctx, interaction, 'giveaways:errors.notFound');

  if (sub === 'end') {
    const settled = await endGiveaway(ctx, client, interaction.guildId, id);
    if (!settled) return fail(ctx, interaction, 'giveaways:errors.notActive');
    return answer(interaction, ctx.embeds.success(ctx.t(interaction, 'giveaways:end.title'), ctx.t(interaction, 'giveaways:end.done', { prize: settled.prize })));
  }
  if (sub === 'reroll') {
    const settled = await rerollGiveaway(ctx, client, interaction.guildId, id);
    if (!settled) return fail(ctx, interaction, 'giveaways:errors.notEnded');
    if (settled.noAlternative) return fail(ctx, interaction, 'giveaways:errors.noAlternative');
    const winners = settled.winnerIds.map((w) => `<@${w}>`).join(' ');
    return answer(interaction, ctx.embeds.success(ctx.t(interaction, 'giveaways:reroll.title'), ctx.t(interaction, 'giveaways:reroll.done', { winners })));
  }
  if (sub === 'cancel') {
    const settled = await cancelGiveaway(ctx, client, interaction.guildId, id);
    if (!settled) return fail(ctx, interaction, 'giveaways:errors.notActive');
    return answer(interaction, ctx.embeds.warn(ctx.t(interaction, 'giveaways:cancel.title'), ctx.t(interaction, 'giveaways:cancel.done', { prize: settled.prize })));
  }
  return undefined;
}

/** /giveaway list: the ten most recent giveaways of the guild. */
function list(interaction, ctx) {
  const items = listGiveaways(ctx.store, interaction.guildId).slice(0, 10);
  if (!items.length) return answer(interaction, ctx.embeds.info(ctx.t(interaction, 'giveaways:list.title'), ctx.t(interaction, 'giveaways:list.empty')));
  const fields = items.map((g) => ({
    name: `${g.prize}`.slice(0, 256),
    value: [
      `ID \`${g.id}\` · ${ctx.t(interaction, `giveaways:status.${g.status}`)}`,
      ctx.t(interaction, 'giveaways:list.entries', { count: Object.keys(g.entries).length }),
      g.status === 'active' ? relative(g.endsAt) : null
    ].filter(Boolean).join('\n')
  }));
  return answer(interaction, ctx.embeds.info(ctx.t(interaction, 'giveaways:list.title'), undefined, { fields }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Run giveaways')
    .addSubcommand((s) => s.setName('start').setDescription('Start a giveaway')
      .addStringOption((o) => o.setName('prize').setDescription('What is given away').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('duration').setDescription('How long, e.g. 1h or 2d 4h').setRequired(true))
      .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setRequired(false).setMinValue(1).setMaxValue(MAX_WINNERS))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel for the giveaway').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addRoleOption((o) => o.setName('role').setDescription('Role required to enter').setRequired(false))
      .addIntegerOption((o) => o.setName('min_account_days').setDescription('Minimum account age in days').setRequired(false).setMinValue(0).setMaxValue(MAX_AGE_DAYS)))
    .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now and draw winners')
      .addStringOption((o) => o.setName('id').setDescription('Giveaway').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('reroll').setDescription('Draw new winners for an ended giveaway')
      .addStringOption((o) => o.setName('id').setDescription('Giveaway').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a giveaway without winners')
      .addStringOption((o) => o.setName('id').setDescription('Giveaway').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List recent giveaways')),
  autocomplete,
  execute
};
