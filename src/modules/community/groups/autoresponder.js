'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { paginate, chunk } = require('../../../core/paginate');
const { COLLECTIONS } = require('../lib/config');
const { NS, en, fail, ok, clip } = require('../lib/util');
const AR = require('../lib/autoresponder');

const rulesPath = COLLECTIONS.responders;

async function add(interaction, ctx, g) {
  const rules = g.get(rulesPath, []);
  if (rules.length >= AR.MAX_RULES) return fail(interaction, ctx, 'autoresponder.tooMany', { max: AR.MAX_RULES });
  const trigger = interaction.options.getString('trigger', true).trim();
  const mode = interaction.options.getString('match') || 'contains';
  if (AR.normalize(trigger).length < 2) return fail(interaction, ctx, 'autoresponder.tooShort');
  if (rules.some((r) => AR.normalize(r.trigger) === AR.normalize(trigger) && r.mode === mode)) return fail(interaction, ctx, 'autoresponder.duplicate');
  const channel = interaction.options.getChannel('channel');
  // "\n" typed in the option becomes a real line break: slash options are single-line.
  const response = interaction.options.getString('response', true).replace(/\\n/g, '\n');
  const id = g.update(COLLECTIONS.responderCounter.split('.'), (n) => (Number(n) || 0) + 1, 0);
  g.set(rulesPath, [...rules, { id, trigger, response, mode, channels: channel ? [channel.id] : [], createdBy: interaction.user.id, createdAt: Date.now() }]);
  return ok(interaction, ctx, 'autoresponder.added', 'autoresponder.addedDesc', { id, trigger: clip(trigger, 100), mode: ctx.t(interaction, `${NS}:autoresponder.modes.${mode}`) });
}

async function remove(interaction, ctx, g) {
  const id = interaction.options.getInteger('id', true);
  const rules = g.get(rulesPath, []);
  if (!rules.some((r) => r.id === id)) return fail(interaction, ctx, 'autoresponder.notFound', { id });
  g.set(rulesPath, rules.filter((r) => r.id !== id));
  return ok(interaction, ctx, 'autoresponder.removed', null, { id });
}

async function list(interaction, ctx, g) {
  const rules = g.get(rulesPath, []);
  if (!rules.length) return fail(interaction, ctx, 'autoresponder.listEmpty');
  const lines = rules.map((r) => ctx.t(interaction, `${NS}:autoresponder.listLine`, {
    id: r.id,
    mode: ctx.t(interaction, `${NS}:autoresponder.modes.${r.mode}`),
    trigger: clip(r.trigger.replace(/`/g, "'"), 60),
    response: clip(r.response.replace(/\s+/g, ' '), 80),
    where: r.channels?.length ? r.channels.map((c) => `<#${c}>`).join(' ') : ctx.t(interaction, `${NS}:autoresponder.everywhere`)
  }));
  const pages = chunk(lines, 8).map((d) => ctx.embeds.info(ctx.t(interaction, `${NS}:autoresponder.listTitle`, { count: rules.length }), d));
  return paginate(interaction, pages, { ephemeral: true });
}

async function test(interaction, ctx, g) {
  const rule = AR.findRule(interaction.options.getString('message', true), g.get(rulesPath, []));
  if (!rule) return fail(interaction, ctx, 'autoresponder.noMatch');
  return ok(interaction, ctx, 'autoresponder.match', 'autoresponder.matchDesc', { id: rule.id, trigger: clip(rule.trigger, 100) });
}

const HANDLERS = { add, remove, list, test };

module.exports = {
  name: 'autoresponder',
  /** Member permission checked at runtime: /community mixes features of different staff levels. */
  permission: PermissionFlagsBits.ManageGuild,
  /**
   * Adds this subcommand group to /community.
   * @param {import('discord.js').SlashCommandSubcommandGroupBuilder} group
   */
  build: (group) => group
    .setName('autoresponder')
    .setDescription(en('commands.community.options.autoresponder.description'))
    .addSubcommand((sc) => sc.setName('add').setDescription(en('commands.community.options.autoresponder.options.add.description'))
      .addStringOption((o) => o.setName('trigger').setDescription(en('commands.community.options.autoresponder.options.add.options.trigger')).setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('response').setDescription(en('commands.community.options.autoresponder.options.add.options.response')).setRequired(true).setMaxLength(2000))
      .addStringOption((o) => o.setName('match').setDescription(en('commands.community.options.autoresponder.options.add.options.match.description'))
        .addChoices(...AR.MODES.map((v) => ({ name: en(`commands.community.options.autoresponder.options.add.options.match.choices.${v}`), value: v }))))
      .addChannelOption((o) => o.setName('channel').setDescription(en('commands.community.options.autoresponder.options.add.options.channel')).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)))
    .addSubcommand((sc) => sc.setName('remove').setDescription(en('commands.community.options.autoresponder.options.remove.description'))
      .addIntegerOption((o) => o.setName('id').setDescription(en('commands.community.options.autoresponder.options.remove.options.id')).setRequired(true).setMinValue(1).setAutocomplete(true)))
    .addSubcommand((sc) => sc.setName('list').setDescription(en('commands.community.options.autoresponder.options.list.description')))
    .addSubcommand((sc) => sc.setName('test').setDescription(en('commands.community.options.autoresponder.options.test.description'))
      .addStringOption((o) => o.setName('message').setDescription(en('commands.community.options.autoresponder.options.test.options.message')).setRequired(true).setMaxLength(2000))),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  execute(interaction, ctx) {
    return HANDLERS[interaction.options.getSubcommand()](interaction, ctx, ctx.store.guild(interaction.guildId));
  },

  /** Lists rules as "#id trigger" for removal. */
  async autocomplete(interaction, ctx) {
    const typed = AR.normalize(interaction.options.getFocused());
    const rules = ctx.store.guild(interaction.guildId).get(rulesPath, [])
      .filter((r) => !typed || String(r.id).startsWith(typed) || AR.normalize(r.trigger).includes(typed)).slice(0, 25);
    await interaction.respond(rules.map((r) => ({ name: clip(`#${r.id} ${r.trigger}`, 100), value: r.id }))).catch(() => {});
  }
};
