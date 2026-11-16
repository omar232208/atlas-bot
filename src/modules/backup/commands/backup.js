'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const duration = require('../../../core/duration');
const { confirm } = require('../../../core/confirm');
const { serialize, summarize, isValid } = require('../lib/snapshot');
const { restore } = require('../lib/restore');
const auto = require('../lib/auto');
const backups = require('../lib/store');

const { NS, respond, fail } = backups;
const PROGRESS_EVERY_MS = 2500;
// Only one load per guild at a time: two concurrent loads would fight over the same channels.
const loading = new Set();

const idOption = (o) => o.setName('id').setDescription('id').setRequired(true).setAutocomplete(true);

const data = new SlashCommandBuilder()
  .setName('backup')
  .setDescription('Server backups')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName('create').setDescription('create').addStringOption((o) => o.setName('name').setDescription('name').setMaxLength(60)))
  .addSubcommand((s) => s.setName('list').setDescription('list'))
  .addSubcommand((s) => s.setName('info').setDescription('info').addStringOption(idOption))
  .addSubcommand((s) => s.setName('load').setDescription('load').addStringOption(idOption)
    .addStringOption((o) => o.setName('mode').setDescription('mode').addChoices({ name: 'replace', value: 'replace' }, { name: 'merge', value: 'merge' })))
  .addSubcommand((s) => s.setName('delete').setDescription('delete').addStringOption(idOption))
  .addSubcommand((s) => s.setName('auto').setDescription('auto')
    .addStringOption((o) => o.setName('interval').setDescription('interval').setRequired(true).setMaxLength(10))
    .addIntegerOption((o) => o.setName('keep').setDescription('keep').setMinValue(1).setMaxValue(10)));

const tr = (ctx, i, k, v) => ctx.t(i, `${NS}:${k}`, v);
const when = (ms) => `<t:${Math.floor(ms / 1000)}:f>`;

/**
 * Text progress bar, e.g. "[#####-----] 50%".
 * @param {number} ratio 0..1
 */
function bar(ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(r * 20);
  return `\`[${'#'.repeat(filled)}${'-'.repeat(20 - filled)}]\` ${Math.round(r * 100)}%`;
}

/** Fields describing a backup. */
function describe(ctx, i, b) {
  const s = summarize(b.data);
  return [
    { name: tr(ctx, i, 'info.id'), value: `\`${b.id}\``, inline: true },
    { name: tr(ctx, i, 'info.server'), value: b.guildName, inline: true },
    { name: tr(ctx, i, 'info.created'), value: when(b.createdAt), inline: true },
    { name: tr(ctx, i, 'info.author'), value: `<@${b.authorId}>`, inline: true },
    { name: tr(ctx, i, 'info.type'), value: tr(ctx, i, b.auto ? 'info.auto' : 'info.manual'), inline: true },
    { name: tr(ctx, i, 'info.size'), value: `${(s.bytes / 1024).toFixed(1)} KB`, inline: true },
    { name: tr(ctx, i, 'info.content'), value: tr(ctx, i, 'info.contentValue', s) }
  ];
}

async function create(interaction, ctx) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { guild } = interaction;
  await guild.roles.fetch().catch(() => null);
  await guild.channels.fetch().catch(() => null);
  const entry = backups.save(ctx.store, { guildId: guild.id, guildName: guild.name, authorId: interaction.user.id, name: interaction.options.getString('name'), data: serialize(guild) });
  await ctx.modlog.send(guild, 'server', ctx.embeds.info(tr(ctx, guild, 'log.createdTitle'), tr(ctx, guild, 'log.created', { id: entry.id, user: `<@${interaction.user.id}>` })));
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'create.title'), tr(ctx, interaction, 'create.done', { id: entry.id }), { fields: describe(ctx, interaction, entry) }));
}

async function load(interaction, ctx, entry) {
  const { guild } = interaction;
  const mode = interaction.options.getString('mode') || 'replace';
  if (!isValid(entry.data)) return fail(interaction, ctx, 'errors.corrupted');
  if (loading.has(guild.id)) return fail(interaction, ctx, 'errors.loading');
  const missing = ctx.permissions.botMissing(guild, [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels]);
  if (missing.length) return fail(interaction, ctx, 'errors.botMissing', { perms: missing.join(', ') });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const s = summarize(entry.data);
  const ok = await confirm(interaction, {
    title: tr(ctx, interaction, 'load.confirmTitle'),
    description: tr(ctx, interaction, `load.confirm.${mode}`, { id: entry.id, server: entry.guildName, ...s }),
    timeMs: 60000
  });
  if (!ok) return null;

  loading.add(guild.id);
  try {
    // Safety net: the current state is saved first, so a wrong load can be undone.
    let safetyId = null;
    if (mode === 'replace') {
      await guild.roles.fetch().catch(() => null);
      await guild.channels.fetch().catch(() => null);
      safetyId = backups.save(ctx.store, { guildId: guild.id, guildName: guild.name, authorId: interaction.user.id, name: tr(ctx, guild, 'load.safetyName'), data: serialize(guild) }).id;
    }
    let last = 0;
    const result = await restore(guild, entry.data, {
      mode,
      keepChannelId: interaction.channelId,
      reason: tr(ctx, guild, 'load.auditReason', { id: entry.id, user: interaction.user.tag }),
      onProgress: async (done, total, phase) => {
        if (Date.now() - last < PROGRESS_EVERY_MS && done < total) return;
        last = Date.now();
        await respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'load.progressTitle'), tr(ctx, interaction, 'load.progress', { phase: tr(ctx, interaction, `load.phases.${phase}`), done, total, bar: bar(done / total) })));
      }
    });
    const summary = [tr(ctx, interaction, 'load.result', result)];
    if (safetyId) summary.push(tr(ctx, interaction, 'load.safety', { id: safetyId }));
    const embed = ctx.embeds.success(tr(ctx, interaction, 'load.doneTitle'), summary.join('\n\n'));
    await respond(interaction, embed);
    // The interaction token expires after 15 minutes; a long load is also reported by DM.
    await interaction.user.send({ embeds: [embed] }).catch(() => {});
    await ctx.modlog.send(guild, 'server', ctx.embeds.warn(tr(ctx, guild, 'log.loadedTitle'), tr(ctx, guild, 'log.loaded', { id: entry.id, user: `<@${interaction.user.id}>`, mode })));
  } finally {
    loading.delete(guild.id);
  }
  return null;
}

async function setAuto(interaction, ctx) {
  const raw = interaction.options.getString('interval').trim().toLowerCase();
  const keep = interaction.options.getInteger('keep');
  const gstore = ctx.store.guild(interaction.guildId);
  if (keep) gstore.set('backup.config.autoKeep', keep);
  if (['off', '0', 'none', 'non', 'aus', 'no'].includes(raw)) {
    gstore.set('backup.config.autoInterval', 0);
    return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'auto.title'), tr(ctx, interaction, 'auto.disabled')));
  }
  const ms = duration.parse(raw);
  if (!ms || ms < auto.MIN_INTERVAL || ms > auto.MAX_INTERVAL) return fail(interaction, ctx, 'errors.badInterval');
  gstore.set('backup.config.autoInterval', ms);
  auto.ensureTick(ctx.scheduler);
  const { autoKeep } = backups.getConfig(ctx.store, interaction.guildId);
  return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'auto.title'), tr(ctx, interaction, 'auto.enabled', { interval: duration.format(ms, interaction), keep: autoKeep })));
}

module.exports = {
  data,
  cooldown: 5,
  /**
   * Routes /backup subcommands. Owner only: a backup can rebuild or wipe the whole server.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    if (!ctx.permissions.isOwner(interaction.guild, interaction.user.id)) return fail(interaction, ctx, 'errors.ownerOnly');
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return create(interaction, ctx);
    if (sub === 'auto') return setAuto(interaction, ctx);
    if (sub === 'list') {
      const list = backups.visible(ctx.store, interaction.guildId, interaction.user.id);
      if (!list.length) return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'list.title'), tr(ctx, interaction, 'list.empty')));
      const lines = list.slice(0, 25).map((b) => tr(ctx, interaction, 'list.line', {
        id: b.id, name: b.name || tr(ctx, interaction, 'list.unnamed'), server: b.guildName, date: when(b.createdAt), auto: b.auto ? ` ${tr(ctx, interaction, 'list.autoTag')}` : ''
      }));
      return respond(interaction, ctx.embeds.info(tr(ctx, interaction, 'list.title'), lines.join('\n')));
    }
    const entry = backups.get(ctx.store, interaction.options.getString('id'));
    // Backups of other servers are only reachable by their author.
    if (!entry || (entry.guildId !== interaction.guildId && entry.authorId !== interaction.user.id)) return fail(interaction, ctx, 'errors.unknown');
    if (sub === 'info') return respond(interaction, ctx.embeds.info(entry.name || tr(ctx, interaction, 'list.unnamed'), undefined, { fields: describe(ctx, interaction, entry) }));
    if (sub === 'delete') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const ok = await confirm(interaction, { description: tr(ctx, interaction, 'delete.confirm', { id: entry.id }) });
      if (!ok) return null;
      backups.remove(ctx.store, entry.id);
      return respond(interaction, ctx.embeds.success(tr(ctx, interaction, 'delete.title'), tr(ctx, interaction, 'delete.done', { id: entry.id })));
    }
    return load(interaction, ctx, entry);
  },
  /** Suggests the backups the user can see. */
  async autocomplete(interaction, ctx) {
    if (!ctx.permissions.isOwner(interaction.guild, interaction.user.id)) return interaction.respond([]).catch(() => {});
    const typed = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = backups.visible(ctx.store, interaction.guildId, interaction.user.id)
      .filter((b) => b.id.includes(typed) || (b.name || '').toLowerCase().includes(typed))
      .slice(0, 25)
      .map((b) => ({ name: `${b.id} - ${b.name || b.guildName} (${new Date(b.createdAt).toISOString().slice(0, 16).replace('T', ' ')})`.slice(0, 100), value: b.id }));
    return interaction.respond(choices).catch(() => {});
  },
  bar
};
