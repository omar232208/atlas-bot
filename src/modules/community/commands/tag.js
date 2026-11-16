'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { paginate, chunk } = require('../../../core/paginate');
const confirm = require('../../../core/confirm');
const { COLLECTIONS } = require('../lib/config');
const { NS, en, fail, ok, respond, clip } = require('../lib/util');
const T = require('../lib/tags');

const nameOption = (sub, auto = true) => (o) => o.setName('name').setDescription(en(`commands.tag.options.${sub}.options.name`)).setRequired(true).setMaxLength(32).setAutocomplete(auto);

/** Reads and validates the name option, answering the error itself. */
async function readName(interaction, ctx) {
  const name = T.normalizeName(interaction.options.getString('name', true));
  if (!T.isValidName(name)) {
    await fail(interaction, ctx, 'tags.badName');
    return null;
  }
  return name;
}

async function use(interaction, ctx, g) {
  const name = await readName(interaction, ctx);
  if (!name) return null;
  const tag = g.get(T.tagPath(name), null);
  if (!tag) return fail(interaction, ctx, 'tags.notFound', { name });
  const target = interaction.options.getUser('user');
  g.set(T.tagPath(name), { ...tag, uses: (tag.uses || 0) + 1 });
  const embed = ctx.embeds.base({ description: clip(T.renderTag(tag.content, T.tagVars(interaction, target)), 4096), footer: ctx.t(interaction, `${NS}:tags.footer`, { name }) });
  // Only the explicitly targeted user is pinged; tag content can never ping roles or everyone.
  return interaction.reply({ content: target ? `<@${target.id}>` : undefined, embeds: [embed], allowedMentions: { users: target ? [target.id] : [] } });
}

async function manage(interaction, ctx, g, sub) {
  if (!T.canManage(interaction, ctx)) return fail(interaction, ctx, 'tags.noPermission');
  const name = await readName(interaction, ctx);
  if (!name) return null;
  const tag = g.get(T.tagPath(name), null);
  if (sub === 'create') {
    if (tag) return fail(interaction, ctx, 'tags.exists', { name });
    return interaction.showModal(T.modal(interaction, ctx.t, 'create', name));
  }
  if (!tag) return fail(interaction, ctx, 'tags.notFound', { name });
  if (sub === 'edit') return interaction.showModal(T.modal(interaction, ctx.t, 'edit', name, tag.content));
  const yes = await confirm.confirm(interaction, { description: ctx.t(interaction, `${NS}:tags.confirmDelete`, { name }) });
  if (!yes) return null;
  g.delete(T.tagPath(name));
  return interaction.editReply({ embeds: [ctx.embeds.success(ctx.t(interaction, `${NS}:tags.deleted`, { name }))], components: [] });
}

async function list(interaction, ctx, g) {
  const tags = Object.values(g.get(COLLECTIONS.tags, {})).sort((a, b) => a.name.localeCompare(b.name));
  if (!tags.length) return fail(interaction, ctx, 'tags.listEmpty');
  const lines = tags.map((tg) => ctx.t(interaction, `${NS}:tags.listLine`, { name: tg.name, uses: tg.uses || 0 }));
  const pages = chunk(lines, 20).map((d) => ctx.embeds.info(ctx.t(interaction, `${NS}:tags.listTitle`, { count: tags.length }), d));
  return paginate(interaction, pages, { ephemeral: true });
}

async function info(interaction, ctx, g) {
  const name = await readName(interaction, ctx);
  if (!name) return null;
  const tag = g.get(T.tagPath(name), null);
  if (!tag) return fail(interaction, ctx, 'tags.notFound', { name });
  const tt = (k) => ctx.t(interaction, `${NS}:${k}`);
  return respond(interaction, ctx.embeds.info(ctx.t(interaction, `${NS}:tags.infoTitle`, { name }), `\`\`\`\n${clip(tag.content.replace(/```/g, "'''"), 1500)}\n\`\`\``, {
    fields: [
      { name: tt('tags.owner'), value: `<@${tag.ownerId}>`, inline: true },
      { name: tt('tags.uses'), value: String(tag.uses || 0), inline: true },
      { name: tt('tags.created'), value: `<t:${Math.floor(tag.createdAt / 1000)}:R>`, inline: true },
      { name: tt('tags.variables'), value: tt('tags.variablesList') }
    ]
  }), { ephemeral: true });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription(en('commands.tag.description'))
    .addSubcommand((sc) => sc.setName('use').setDescription(en('commands.tag.options.use.description')).addStringOption(nameOption('use'))
      .addUserOption((o) => o.setName('user').setDescription(en('commands.tag.options.use.options.user'))))
    .addSubcommand((sc) => sc.setName('create').setDescription(en('commands.tag.options.create.description')).addStringOption(nameOption('create', false)))
    .addSubcommand((sc) => sc.setName('edit').setDescription(en('commands.tag.options.edit.description')).addStringOption(nameOption('edit')))
    .addSubcommand((sc) => sc.setName('delete').setDescription(en('commands.tag.options.delete.description')).addStringOption(nameOption('delete')))
    .addSubcommand((sc) => sc.setName('info').setDescription(en('commands.tag.options.info.description')).addStringOption(nameOption('info')))
    .addSubcommand((sc) => sc.setName('list').setDescription(en('commands.tag.options.list.description'))),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  execute(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    const g = ctx.store.guild(interaction.guildId);
    if (sub === 'use') return use(interaction, ctx, g);
    if (sub === 'list') return list(interaction, ctx, g);
    if (sub === 'info') return info(interaction, ctx, g);
    return manage(interaction, ctx, g, sub);
  },

  /** Autocompletes existing tag names. */
  async autocomplete(interaction, ctx) {
    const names = Object.keys(ctx.store.guild(interaction.guildId).get(COLLECTIONS.tags, {}));
    const found = T.searchNames(names, interaction.options.getFocused());
    await interaction.respond(found.map((n) => ({ name: n, value: n }))).catch(() => {});
  }
};
