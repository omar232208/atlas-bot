'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { FILTERS, GLOBAL, STRIKES, filterPath, getConfig } = require('../lib/config');
const { FILTER_ORDER, detect } = require('../lib/filters');
const { ACTIONS, STEP_ACTIONS, activeStrikes, normalizeSteps } = require('../lib/escalation');
const { statusEmbed, actionText, filtersWith } = require('../lib/status');
const duration = require('../../../core/duration');

const MAX_STEPS = 10;
const filterOpt = (o) => o.setName('filter').setDescription('Filter').setRequired(true).addChoices(...FILTER_ORDER.map((v) => ({ name: v, value: v })));
const actionOpt = (o, list) => o.setName('action').setDescription('Action').setRequired(true).addChoices(...list.map((v) => ({ name: v, value: v })));

const reply = (interaction, embed, ephemeral = false) => interaction.reply({ embeds: [embed], flags: ephemeral ? MessageFlags.Ephemeral : undefined });
const fail = (ctx, interaction, key, vars) => reply(interaction, ctx.embeds.error(ctx.t(interaction, 'automod:errors.title'), ctx.t(interaction, key, vars)), true);

/** Adds or removes an ID in a stored list. */
function toggleIn(gs, path, id, add) {
  return gs.update(path, (list) => {
    const next = (Array.isArray(list) ? list : []).filter((x) => x !== id);
    return add ? [...next, id] : next;
  }, []);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Automatic moderation filters')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Show the automod configuration'))
    .addSubcommand((s) => s.setName('enable').setDescription('Turn automod on'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn automod off'))
    .addSubcommand((s) => s.setName('filter').setDescription('Turn one filter on or off')
      .addStringOption(filterOpt)
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('action').setDescription('Choose what a filter does')
      .addStringOption(filterOpt)
      .addStringOption((o) => actionOpt(o, ACTIONS))
      .addStringOption((o) => o.setName('duration').setDescription('For timeout or temporary ban, e.g. 10m').setMaxLength(20)))
    .addSubcommand((s) => s.setName('set').setDescription('Tune the thresholds of a filter')
      .addStringOption(filterOpt)
      .addIntegerOption((o) => o.setName('limit').setDescription('Limit').setMinValue(1).setMaxValue(200))
      .addIntegerOption((o) => o.setName('seconds').setDescription('Time window in seconds').setMinValue(1).setMaxValue(120))
      .addIntegerOption((o) => o.setName('percent').setDescription('Percentage of capitals').setMinValue(1).setMaxValue(100))
      .addIntegerOption((o) => o.setName('min_length').setDescription('Minimum letters before checking').setMinValue(1).setMaxValue(200))
      .addBooleanOption((o) => o.setName('allow_own').setDescription('Allow invites to this server')))
    .addSubcommand((s) => s.setName('exempt').setDescription('Exempt a role or channel (from all filters or one)')
      .addStringOption((o) => o.setName('mode').setDescription('Add or remove').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }))
      .addRoleOption((o) => o.setName('role').setDescription('Role'))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel or category')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildCategory, ChannelType.GuildVoice))
      .addStringOption((o) => o.setName('filter').setDescription('Only for this filter').addChoices(...FILTER_ORDER.map((v) => ({ name: v, value: v })))))
    .addSubcommand((s) => s.setName('settings').setDescription('General automod settings')
      .addBooleanOption((o) => o.setName('notify').setDescription('Short notice in the channel'))
      .addBooleanOption((o) => o.setName('ignore_staff').setDescription('Ignore members who can manage messages'))
      .addStringOption((o) => o.setName('strike_window').setDescription('How long a strike counts, e.g. 24h, or "off"').setMaxLength(20)))
    .addSubcommand((s) => s.setName('test').setDescription('Check which filters a text would trigger')
      .addStringOption((o) => o.setName('text').setDescription('Text').setRequired(true).setMaxLength(2000)))
    .addSubcommandGroup((g) => g.setName('escalation').setDescription('Harsher actions after repeated strikes')
      .addSubcommand((s) => s.setName('add').setDescription('Add or replace a step')
        .addIntegerOption((o) => o.setName('strikes').setDescription('Number of strikes').setRequired(true).setMinValue(1).setMaxValue(100))
        .addStringOption((o) => actionOpt(o, STEP_ACTIONS))
        .addStringOption((o) => o.setName('duration').setDescription('For timeout or temporary ban').setMaxLength(20)))
      .addSubcommand((s) => s.setName('remove').setDescription('Remove a step')
        .addIntegerOption((o) => o.setName('strikes').setDescription('Number of strikes').setRequired(true).setMinValue(1).setMaxValue(100))))
    .addSubcommandGroup((g) => g.setName('strikes').setDescription('Strikes of a member')
      .addSubcommand((s) => s.setName('view').setDescription('Show the strikes of a member')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
      .addSubcommand((s) => s.setName('reset').setDescription('Reset the strikes of a member')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))),

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const gs = ctx.store.guild(interaction.guild.id);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const show = () => reply(interaction, statusEmbed(ctx, interaction, getConfig(gs), { success: sub !== 'status' }));

    if (group === 'escalation') {
      const strikes = interaction.options.getInteger('strikes', true);
      const steps = getConfig(gs).escalation;
      if (sub === 'remove') {
        if (!steps.some((s) => s.strikes === strikes)) return fail(ctx, interaction, 'automod:errors.noStep', { count: strikes });
        gs.set(GLOBAL.escalation.path, steps.filter((s) => s.strikes !== strikes));
        return show();
      }
      const action = interaction.options.getString('action', true);
      const raw = interaction.options.getString('duration');
      const ms = raw ? duration.parse(raw) : undefined;
      if (ms === null || (action === 'timeout' && ms > 28 * 86400000)) return fail(ctx, interaction, 'automod:errors.badDuration');
      if (steps.length >= MAX_STEPS && !steps.some((s) => s.strikes === strikes)) return fail(ctx, interaction, 'automod:errors.tooManySteps', { max: MAX_STEPS });
      gs.set(GLOBAL.escalation.path, normalizeSteps([...steps.filter((s) => s.strikes !== strikes), { strikes, action, duration: action === 'timeout' ? ms || 600000 : ms }]));
      return show();
    }

    if (group === 'strikes') {
      const user = interaction.options.getUser('user', true);
      const path = `${STRIKES}.${user.id}`;
      if (sub === 'reset') {
        gs.delete(path);
        return reply(interaction, embeds.success(t(interaction, 'automod:strikes.title'), t(interaction, 'automod:strikes.reset', { user: `<@${user.id}>` })));
      }
      const cfg = getConfig(gs);
      const list = activeStrikes(gs.get(path, []), cfg.strikeWindow);
      const next = cfg.escalation.find((s) => s.strikes > list.length);
      const lines = [t(interaction, 'automod:strikes.count', { user: `<@${user.id}>`, count: list.length })];
      if (list.length) lines.push(t(interaction, 'automod:strikes.last', { when: `<t:${Math.floor(list[list.length - 1] / 1000)}:R>` }));
      if (next) lines.push(t(interaction, 'automod:strikes.next', { count: next.strikes, action: actionText(t, interaction, next.action, next.duration) }));
      return reply(interaction, embeds.info(t(interaction, 'automod:strikes.title'), lines.join('\n')), true);
    }

    switch (sub) {
      case 'status':
        return show();
      case 'enable':
      case 'disable':
        gs.set(GLOBAL.enabled.path, sub === 'enable');
        return show();
      case 'filter':
        gs.set(filterPath(interaction.options.getString('filter', true), 'enabled'), interaction.options.getBoolean('enabled', true));
        return show();
      case 'action': {
        const filter = interaction.options.getString('filter', true);
        const action = interaction.options.getString('action', true);
        const raw = interaction.options.getString('duration');
        const ms = raw ? duration.parse(raw) : undefined;
        if (ms === null || (action === 'timeout' && ms > 28 * 86400000)) return fail(ctx, interaction, 'automod:errors.badDuration');
        gs.set(filterPath(filter, 'action'), action);
        // A ban without duration is permanent: store 0 rather than keep an old value.
        if (ms !== undefined || action === 'ban') gs.set(filterPath(filter, 'duration'), ms || (action === 'ban' ? 0 : FILTERS[filter].duration));
        return show();
      }
      case 'set':
        return setThresholds(ctx, interaction, gs, show);
      case 'exempt': {
        const role = interaction.options.getRole('role');
        const channel = interaction.options.getChannel('channel');
        if (!role && !channel) return fail(ctx, interaction, 'automod:errors.exemptNothing');
        const filter = interaction.options.getString('filter');
        const add = interaction.options.getString('mode', true) === 'add';
        if (role) toggleIn(gs, filter ? filterPath(filter, 'exemptRoles') : GLOBAL.exemptRoles.path, role.id, add);
        if (channel) toggleIn(gs, filter ? filterPath(filter, 'exemptChannels') : GLOBAL.exemptChannels.path, channel.id, add);
        return show();
      }
      case 'settings': {
        const notify = interaction.options.getBoolean('notify');
        const staff = interaction.options.getBoolean('ignore_staff');
        const raw = interaction.options.getString('strike_window');
        if (raw) {
          const ms = ['0', 'off', 'none'].includes(raw.trim().toLowerCase()) ? 0 : duration.parse(raw);
          if (ms === null) return fail(ctx, interaction, 'automod:errors.badDuration');
          gs.set(GLOBAL.strikeWindow.path, ms);
        }
        if (notify !== null) gs.set(GLOBAL.notify.path, notify);
        if (staff !== null) gs.set(GLOBAL.ignoreStaff.path, staff);
        return show();
      }
      default:
        return runTest(ctx, interaction, gs);
    }
  }
};

/** /automod set: only the parameters that exist for the chosen filter. */
function setThresholds(ctx, interaction, gs, show) {
  const filter = interaction.options.getString('filter', true);
  const def = FILTERS[filter];
  const given = {
    limit: interaction.options.getInteger('limit'),
    seconds: interaction.options.getInteger('seconds'),
    percent: interaction.options.getInteger('percent'),
    minLength: interaction.options.getInteger('min_length'),
    allowOwn: interaction.options.getBoolean('allow_own')
  };
  const entries = Object.entries(given).filter(([, v]) => v !== null);
  if (!entries.length) return fail(ctx, interaction, 'automod:errors.setNothing');
  for (const [param, value] of entries) {
    const p = def.params[param];
    if (!p) return fail(ctx, interaction, 'automod:errors.setWrongParam', { param, filters: filtersWith(param).join(', ') || '-' });
    if (p.type !== 'boolean' && (value < p.min || value > p.max)) return fail(ctx, interaction, 'automod:errors.setRange', { param, min: p.min, max: p.max });
  }
  for (const [param, value] of entries) gs.set(filterPath(filter, param), value);
  return show();
}

/**
 * /automod test: runs the text through every filter as if all were enabled,
 * so admins can tune thresholds and word lists before turning them on.
 */
function runTest(ctx, interaction, gs) {
  const { t, embeds } = ctx;
  const text = interaction.options.getString('text', true);
  const cfg = getConfig(gs);
  const all = { ...cfg, filters: Object.fromEntries(Object.entries(cfg.filters).map(([k, f]) => [k, { ...f, enabled: true }])) };
  // Own invites are not fetched here so the test answers instantly; rate
  // filters (spam, duplicates, attachments) need several messages and are skipped.
  const hits = detect({ content: text, ownInvites: [] }, all, null);
  const lines = hits.map((h) => {
    const off = cfg.filters[h.filter].enabled ? '' : ` (${t(interaction, 'automod:test.disabled')})`;
    return `**${t(interaction, `automod:filters.${h.filter}.name`)}**${off} — ${t(interaction, `automod:reasons.${h.filter}`, h.detail)}`;
  });
  const footer = t(interaction, 'automod:test.note');
  if (!lines.length) return reply(interaction, embeds.success(t(interaction, 'automod:test.title'), t(interaction, 'automod:test.clean'), { footer }), true);
  return reply(interaction, embeds.warn(t(interaction, 'automod:test.title'), lines.join('\n'), { footer }), true);
}
