'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const state = require('../lib/state');
const http = require('../lib/http');

const NS = 'dashboard';

/**
 * /dashboard: replies (ephemeral) with a one-time login link for this server.
 * The link is single use, valid 10 minutes and bound to the user and the guild.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Open the web dashboard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  cooldown: 10,

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const t = (key, vars) => ctx.t(interaction, `${NS}:${key}`, vars);
    const reply = (embed, components) => interaction.reply({ embeds: [embed], components: components || [], flags: MessageFlags.Ephemeral });

    const allowed = ctx.permissions.isOwner(interaction.guild, interaction.user.id) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    if (!allowed) return reply(ctx.embeds.error(t('command.title'), t('command.noPermission')));

    const server = state.get();
    if (!server) {
      const problem = state.problem();
      const key = problem === 'listenFailed' ? 'command.listenFailed' : 'command.notRunning';
      return reply(ctx.embeds.warn(t('command.title'), t(key, { error: state.error() || '' })));
    }

    // Get public URL, fallback to localhost for local development
    let base = server.publicUrl.get();
    const isLocal = !base;
    if (isLocal) {
      const port = state.port() || 3000;
      base = `http://localhost:${port}`;
    }

    const token = server.auth.issueLink(interaction.user.id, interaction.guildId);
    const link = `${base}/login#token=${token}`;
    const embed = ctx.embeds.info(t('command.title'), t('command.body', { url: link }), { footer: isLocal ? t('command.footerLocal') : t('command.footer') });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(link).setLabel(t('command.button')));
    return reply(embed, [row]);
  }
};
