'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { GLOBAL, getConfig } = require('../lib/config');
const { compileWord } = require('../lib/filters');
const { paginate, chunk } = require('../../../core/paginate');
const { confirm } = require('../../../core/confirm');

const MAX_WORDS = 500;
const MAX_LEN = 50;

/**
 * Splits "word1, word2 ,word3" into clean unique patterns.
 * @param {string} text
 * @returns {string[]}
 */
function parseWords(text) {
  return [...new Set(String(text || '').split(',').map((w) => w.trim().toLowerCase()).filter((w) => w && w.length <= MAX_LEN && compileWord(w)))];
}

module.exports = {
  parseWords,
  data: new SlashCommandBuilder()
    .setName('badwords')
    .setDescription('Banned words list of automod')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('add').setDescription('Add words (comma separated, * = wildcard)')
      .addStringOption((o) => o.setName('words').setDescription('e.g. word, word*, *word*').setRequired(true).setMaxLength(1500)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove words (comma separated)')
      .addStringOption((o) => o.setName('words').setDescription('Words to remove').setRequired(true).setMaxLength(1500)))
    .addSubcommand((s) => s.setName('list').setDescription('Show the banned words (only to you)'))
    .addSubcommand((s) => s.setName('clear').setDescription('Remove every banned word')),
  /** @param {import('discord.js').ChatInputCommandInteraction} interaction */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const gs = ctx.store.guild(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    const current = getConfig(gs).badwords;
    const title = t(interaction, 'automod:badwords.title');
    const footer = getConfig(gs).filters.badwords.enabled ? undefined : t(interaction, 'automod:badwords.filterOff');

    if (sub === 'add' || sub === 'remove') {
      const words = parseWords(interaction.options.getString('words', true));
      if (!words.length) return interaction.reply({ embeds: [embeds.error(t(interaction, 'automod:errors.title'), t(interaction, 'automod:errors.noWords', { max: MAX_LEN }))], flags: MessageFlags.Ephemeral });
      let next;
      let changed;
      if (sub === 'add') {
        const fresh = words.filter((w) => !current.includes(w));
        if (current.length + fresh.length > MAX_WORDS) return interaction.reply({ embeds: [embeds.error(t(interaction, 'automod:errors.title'), t(interaction, 'automod:errors.tooManyWords', { max: MAX_WORDS }))], flags: MessageFlags.Ephemeral });
        next = [...current, ...fresh];
        changed = fresh.length;
      } else {
        next = current.filter((w) => !words.includes(w));
        changed = current.length - next.length;
      }
      gs.set(GLOBAL.badwords.path, next);
      // Ephemeral: the words themselves are often offensive.
      return interaction.reply({ embeds: [embeds.success(title, t(interaction, sub === 'add' ? 'automod:badwords.added' : 'automod:badwords.removed', { count: changed, total: next.length }), { footer })], flags: MessageFlags.Ephemeral });
    }
    if (sub === 'clear') {
      if (!current.length) return interaction.reply({ embeds: [embeds.info(title, t(interaction, 'automod:badwords.empty'))], flags: MessageFlags.Ephemeral });
      const ok = await confirm(interaction, { description: t(interaction, 'automod:badwords.clearConfirm', { count: current.length }) });
      if (!ok) return null;
      gs.set(GLOBAL.badwords.path, []);
      return interaction.editReply({ embeds: [embeds.success(title, t(interaction, 'automod:badwords.cleared'))] });
    }
    if (!current.length) return interaction.reply({ embeds: [embeds.info(title, t(interaction, 'automod:badwords.empty'), { footer })], flags: MessageFlags.Ephemeral });
    const pages = chunk(current.map((w) => `||${w}||`), 30).map((text) => embeds.info(t(interaction, 'automod:badwords.listTitle', { count: current.length }), text, { footer: footer || t(interaction, 'automod:badwords.help') }));
    return paginate(interaction, pages, { ephemeral: true });
  }
};
