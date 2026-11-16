'use strict';

const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const catalog = require('../lib/catalog');

const { NS } = catalog;
const PREFIX = 'core:help:';

/**
 * Select menu listing every module that has commands (Discord allows 25 options).
 * @param {*} target
 * @param {object[]} modules
 * @param {string} [current] Module shown right now (pre-selected).
 */
function moduleSelect(ctx, target, modules, current) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}mod`)
    .setPlaceholder(ctx.t(target, `${NS}:help.placeholder`))
    .addOptions(modules.slice(0, 25).map((m) => {
      const info = catalog.moduleInfo(target, m.name);
      return { label: info.name.slice(0, 100), value: m.name, description: (info.description || ctx.t(target, `${NS}:help.commandCount`, { count: m.commands.length })).slice(0, 100), default: m.name === current };
    }));
  return new ActionRowBuilder().addComponents(menu);
}

/** Overview page: introduction plus one line per module. */
function overview(ctx, target) {
  const modules = catalog.modulesWithCommands(ctx.modules);
  const total = modules.reduce((n, m) => n + m.commands.length, 0);
  const lines = modules.map((m) => {
    const info = catalog.moduleInfo(target, m.name);
    return `**${info.name}** (${m.commands.length}) : ${info.description}`;
  });
  const embed = ctx.embeds.base({
    title: ctx.t(target, `${NS}:help.title`),
    description: `${ctx.t(target, `${NS}:help.intro`)}\n\n${lines.join('\n')}`,
    footer: ctx.t(target, `${NS}:help.footer`, { count: total })
  });
  return { embeds: [embed], components: modules.length ? [moduleSelect(ctx, target, modules)] : [] };
}

/** One page of a module's command list, with select + page buttons. */
function modulePage(ctx, target, name, page = 0) {
  const modules = catalog.modulesWithCommands(ctx.modules);
  const mod = modules.find((m) => m.name === name);
  if (!mod) return overview(ctx, target);
  const pages = catalog.modulePages(target, mod, ctx.commandIds);
  const index = Math.min(Math.max(0, page), pages.length - 1);
  const info = catalog.moduleInfo(target, mod.name);
  const embed = ctx.embeds.base({
    title: ctx.t(target, `${NS}:help.moduleTitle`, { module: info.name }),
    description: `${info.description ? `${info.description}\n\n` : ''}${pages[index] || ctx.t(target, `${NS}:help.noCommands`)}`,
    footer: ctx.t(target, 'common:page', { page: index + 1, total: pages.length })
  });
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}home`).setStyle(ButtonStyle.Secondary).setLabel(ctx.t(target, `${NS}:help.home`)),
    new ButtonBuilder().setCustomId(`${PREFIX}page:${mod.name}:${index - 1}`).setStyle(ButtonStyle.Secondary).setLabel(ctx.t(target, 'common:pagination.previous')).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`${PREFIX}page:${mod.name}:${index + 1}`).setStyle(ButtonStyle.Secondary).setLabel(ctx.t(target, 'common:pagination.next')).setDisabled(index >= pages.length - 1)
  );
  return { embeds: [embed], components: [moduleSelect(ctx, target, modules, mod.name), buttons] };
}

/** Detail of one command: description, subcommands or options, permissions. */
function commandDetail(ctx, target, cmd) {
  const entries = catalog.commandEntries(target, cmd);
  const info = catalog.moduleInfo(target, cmd.module);
  const fields = [{ name: ctx.t(target, `${NS}:help.module`), value: info.name, inline: true }];
  const perms = catalog.requiredPermissions(target, cmd);
  fields.push({ name: ctx.t(target, `${NS}:help.permissions`), value: perms.length ? perms.join(', ') : ctx.t(target, 'common:everyone'), inline: true });
  if (cmd.cooldown) fields.push({ name: ctx.t(target, `${NS}:help.cooldown`), value: require('../../../core/duration').format(cmd.cooldown * 1000, target), inline: true });

  const describeOptions = (entry) => entry.options.map((o) => {
    const key = `${entry.key}.options.${o.name}`;
    const desc = catalog.tOr(target, key, catalog.tOr(target, `${key}.description`, o.description));
    const flag = ctx.t(target, `${NS}:help.${o.required ? 'required' : 'optional'}`);
    return `\`${o.name}\` (${flag}) : ${desc}`;
  });

  let description;
  if (entries.length === 1 && entries[0].path === cmd.data.name) {
    const opts = describeOptions(entries[0]);
    description = entries[0].description;
    if (opts.length) fields.push({ name: ctx.t(target, `${NS}:help.options`), value: opts.join('\n').slice(0, 1024) });
  } else {
    description = catalog.tOr(target, `${cmd.module}:commands.${cmd.data.name}.description`, cmd.data.description);
    const lines = entries.map((e) => `${catalog.mention(e.path, ctx.commandIds)} : ${e.description}`);
    fields.push({ name: ctx.t(target, `${NS}:help.subcommands`), value: lines.join('\n').slice(0, 1024) });
  }
  return { embeds: [ctx.embeds.info(`/${cmd.data.name}`, description, { fields })], components: [] };
}

/** /help [command] */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('List the commands of every module')
    .addStringOption((o) => o.setName('command').setDescription('Show the details of one command').setAutocomplete(true)),
  cooldown: 3,

  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const name = interaction.options.getString('command');
    if (name) {
      const cmd = catalog.findCommand(ctx.modules, name);
      if (!cmd) return interaction.reply({ embeds: [ctx.embeds.error(ctx.t(interaction, `${NS}:help.title`), ctx.t(interaction, `${NS}:help.notFound`, { name }))], flags: MessageFlags.Ephemeral });
      return interaction.reply({ ...commandDetail(ctx, interaction, cmd), flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ ...overview(ctx, interaction), flags: MessageFlags.Ephemeral });
  },

  async autocomplete(interaction, ctx) {
    await interaction.respond(catalog.searchCommands(interaction, ctx.modules, interaction.options.getFocused()));
  },

  /** Component handler for the help select and buttons (stateless, survives restarts). */
  component: {
    prefix: PREFIX,
    async execute(interaction, ctx) {
      const action = interaction.customId.slice(PREFIX.length);
      if (action === 'mod' && interaction.isStringSelectMenu()) return interaction.update(modulePage(ctx, interaction, interaction.values[0], 0));
      if (action.startsWith('page:')) {
        const [, mod, page] = action.split(':');
        return interaction.update(modulePage(ctx, interaction, mod, Number(page) || 0));
      }
      return interaction.update(overview(ctx, interaction));
    }
  },

  overview, modulePage, commandDetail
};
