'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { fail, permName } = require('../lib/format');

// Less frequent moderation tools live under /mod to stay within Discord's
// limit of 100 top-level commands per bot.
const dir = path.join(__dirname, '..', 'subcommands');
const SUBS = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().map((f) => require(path.join(dir, f)));
const byName = new Map(SUBS.map((s) => [s.name, s]));

const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('More moderation tools and settings')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
for (const sub of SUBS) {
  if (sub.group) data.addSubcommandGroup((g) => sub.build(g));
  else data.addSubcommand((s) => sub.build(s));
}

/** Flag name of a permission bit, e.g. "BanMembers". */
const flagName = (bit) => Object.keys(PermissionFlagsBits).find((k) => PermissionFlagsBits[k] === bit);

module.exports = {
  data,
  SUBS,
  cooldown: 2,
  /**
   * Routes to the subcommand file. Discord only knows one permission for the
   * whole /mod command, so each subcommand's own permission is checked here.
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction, ctx) {
    const name = interaction.options.getSubcommandGroup(false) || interaction.options.getSubcommand();
    const sub = byName.get(name);
    if (!sub) return null;
    if (sub.perm && !interaction.memberPermissions?.has(sub.perm)) {
      return fail(ctx, interaction, 'moderation:errors.userMissing', { perm: permName(ctx.t, interaction, flagName(sub.perm)) });
    }
    return sub.execute(interaction, ctx);
  },
  /** Autocomplete is only used by subcommands that define it. */
  async autocomplete(interaction, ctx) {
    const sub = byName.get(interaction.options.getSubcommandGroup(false) || interaction.options.getSubcommand());
    if (sub?.autocomplete) return sub.autocomplete(interaction, ctx);
    return interaction.respond([]).catch(() => {});
  }
};
