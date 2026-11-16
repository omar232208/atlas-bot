'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { COLLECTIONS, setting } = require('../lib/config');
const { paginate, chunk } = require('../../../core/paginate');
const { NS, en, fail, ok, respond, ensureBotPerms, apiError, clip } = require('../lib/util');
const S = require('../lib/suggestions');
const service = require('../lib/suggestionService');

const DECISIONS = ['accept', 'deny', 'consider', 'implement'];
const TO_STATUS = { accept: 'accepted', deny: 'denied', consider: 'considered', implement: 'implemented' };

const decision = (name) => (sc) => sc.setName(name).setDescription(en(`commands.suggestion.options.${name}.description`))
  .addIntegerOption((o) => o.setName('id').setDescription(en(`commands.suggestion.options.${name}.options.id`)).setRequired(true).setMinValue(1).setAutocomplete(true))
  .addStringOption((o) => o.setName('reason').setDescription(en(`commands.suggestion.options.${name}.options.reason`)).setMaxLength(1000));

const data = new SlashCommandBuilder()
  .setName('suggestion')
  .setDescription(en('commands.suggestion.description'))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
for (const name of DECISIONS) data.addSubcommand(decision(name));
data
  .addSubcommand((sc) => sc.setName('delete').setDescription(en('commands.suggestion.options.delete.description'))
    .addIntegerOption((o) => o.setName('id').setDescription(en('commands.suggestion.options.delete.options.id')).setRequired(true).setMinValue(1).setAutocomplete(true)))
  .addSubcommand((sc) => sc.setName('list').setDescription(en('commands.suggestion.options.list.description'))
    .addStringOption((o) => o.setName('status').setDescription(en('commands.suggestion.options.list.options.status.description'))
      .addChoices(...Object.keys(S.STATUS).map((v) => ({ name: en(`commands.suggestion.options.list.options.status.choices.${v}`), value: v })))))
  .addSubcommand((sc) => sc.setName('config').setDescription(en('commands.suggestion.options.config.description'))
    .addChannelOption((o) => o.setName('channel').setDescription(en('commands.suggestion.options.config.options.channel')).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addBooleanOption((o) => o.setName('anonymous').setDescription(en('commands.suggestion.options.config.options.anonymous')))
    .addBooleanOption((o) => o.setName('threads').setDescription(en('commands.suggestion.options.config.options.threads')))
    .addBooleanOption((o) => o.setName('dm').setDescription(en('commands.suggestion.options.config.options.dm')))
    .addIntegerOption((o) => o.setName('cooldown').setDescription(en('commands.suggestion.options.config.options.cooldown')).setMinValue(0).setMaxValue(86400)));

/** Staff decision: updates status, edits the public message, informs the author. */
async function decide(interaction, ctx, sub) {
  const number = interaction.options.getInteger('id', true);
  const item = service.getItem(ctx, interaction.guildId, number);
  if (!item) return fail(interaction, ctx, 'suggestions.notFound', { number });
  const next = { ...item, status: TO_STATUS[sub], reason: interaction.options.getString('reason') || null, staffId: interaction.user.id, decidedAt: Date.now() };
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  service.saveItem(ctx, interaction.guildId, next);
  try {
    const message = await service.fetchMessage(interaction.guild, next);
    const updated = message ? await service.refreshMessage(ctx, interaction.guild, next) : false;
    await service.notifyAuthor(ctx, interaction.guild, next, message?.url);
    const status = ctx.t(interaction, `${NS}:suggestions.status.${next.status}`);
    return ok(interaction, ctx, 'suggestions.decided', updated ? 'suggestions.decidedDesc' : 'suggestions.decidedNoMessage', { number, status });
  } catch (err) {
    return apiError(interaction, ctx, err);
  }
}

async function remove(interaction, ctx) {
  const number = interaction.options.getInteger('id', true);
  const item = service.getItem(ctx, interaction.guildId, number);
  if (!item) return fail(interaction, ctx, 'suggestions.notFound', { number });
  const message = await service.fetchMessage(interaction.guild, item);
  if (message) await message.delete().catch(() => {});
  service.deleteItem(ctx, interaction.guildId, number);
  return ok(interaction, ctx, 'suggestions.deleted', null, { number });
}

async function list(interaction, ctx) {
  const status = interaction.options.getString('status');
  const items = Object.values(ctx.store.guild(interaction.guildId).get(COLLECTIONS.suggestions, {}))
    .filter((i) => !status || i.status === status)
    .sort((a, b) => b.number - a.number);
  if (!items.length) return fail(interaction, ctx, 'suggestions.listEmpty');
  const lines = items.map((i) => ctx.t(interaction, `${NS}:suggestions.listLine`, {
    number: i.number,
    status: ctx.t(interaction, `${NS}:suggestions.status.${i.status}`),
    up: i.up?.length || 0,
    down: i.down?.length || 0,
    text: clip(i.content.replace(/\s+/g, ' '), 70)
  }));
  const pages = chunk(lines, 10).map((d) => ctx.embeds.info(ctx.t(interaction, `${NS}:suggestions.listTitle`, { count: items.length }), d));
  return paginate(interaction, pages, { ephemeral: true });
}

async function config(interaction, ctx) {
  const g = ctx.store.guild(interaction.guildId);
  const channel = interaction.options.getChannel('channel');
  if (channel && !(await ensureBotPerms(interaction, ctx, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel))) return null;
  if (channel) g.set('community.suggestions.channelId', channel.id);
  const map = { anonymous: 'community.suggestions.anonymous', threads: 'community.suggestions.threads', dm: 'community.suggestions.dmUpdates' };
  for (const [opt, path] of Object.entries(map)) {
    const value = interaction.options.getBoolean(opt);
    if (value !== null) g.set(path, value);
  }
  const cooldown = interaction.options.getInteger('cooldown');
  if (cooldown !== null) g.set('community.suggestions.cooldown', cooldown);
  const yes = (v) => ctx.t(interaction, `${NS}:common.${v ? 'on' : 'off'}`);
  const cid = setting(g, 'community.suggestions.channelId');
  const embed = ctx.embeds.success(ctx.t(interaction, `${NS}:suggestions.configTitle`), null, {
    fields: [
      { name: ctx.t(interaction, `${NS}:suggestions.configChannel`), value: cid ? `<#${cid}>` : ctx.t(interaction, `${NS}:common.none`), inline: true },
      { name: ctx.t(interaction, `${NS}:suggestions.configAnonymous`), value: yes(setting(g, 'community.suggestions.anonymous')), inline: true },
      { name: ctx.t(interaction, `${NS}:suggestions.configThreads`), value: yes(setting(g, 'community.suggestions.threads')), inline: true },
      { name: ctx.t(interaction, `${NS}:suggestions.configDm`), value: yes(setting(g, 'community.suggestions.dmUpdates')), inline: true },
      { name: ctx.t(interaction, `${NS}:suggestions.configCooldown`), value: String(setting(g, 'community.suggestions.cooldown')), inline: true }
    ]
  });
  return respond(interaction, embed, { ephemeral: true });
}

module.exports = {
  data,
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (DECISIONS.includes(sub)) return decide(interaction, ctx, sub);
    if (sub === 'delete') return remove(interaction, ctx);
    if (sub === 'list') return list(interaction, ctx);
    return config(interaction, ctx);
  },
  /** Suggests the latest suggestion numbers with their first words. */
  async autocomplete(interaction, ctx) {
    const typed = String(interaction.options.getFocused() || '');
    const items = Object.values(ctx.store.guild(interaction.guildId).get(COLLECTIONS.suggestions, {}))
      .filter((i) => !typed || String(i.number).startsWith(typed))
      .sort((a, b) => b.number - a.number)
      .slice(0, 25);
    await interaction.respond(items.map((i) => ({ name: clip(`#${i.number} ${i.content.replace(/\s+/g, ' ')}`, 100), value: i.number }))).catch(() => {});
  }
};
