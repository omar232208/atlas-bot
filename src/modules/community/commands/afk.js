'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { setting } = require('../lib/config');
const { en, fail, ok } = require('../lib/util');
const afk = require('../lib/afk');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription(en('commands.afk.description'))
    .addStringOption((o) => o.setName('reason').setDescription(en('commands.afk.options.reason')).setMaxLength(200)),

  /**
   * Marks the member AFK; or, if they already are, removes it (toggle).
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const g = ctx.store.guild(interaction.guildId);
    if (!setting(g, 'community.afk.enabled')) return fail(interaction, ctx, 'afk.disabled');
    const member = interaction.member;
    if (g.get(afk.afkPath(member.id), null)) {
      await afk.clearAfk(ctx, member);
      return ok(interaction, ctx, 'afk.cleared');
    }
    // Mentions in the reason would ping people every time someone pings us.
    const reason = (interaction.options.getString('reason') || '').replace(/@(everyone|here)/g, '@​$1').trim();
    const nick = await afk.setAfk(ctx, member, reason || null);
    return ok(interaction, ctx, 'afk.set', nick ? 'afk.setDesc' : 'afk.setDescNoNick', { reason: reason || '-' }, { ephemeral: false });
  }
};
