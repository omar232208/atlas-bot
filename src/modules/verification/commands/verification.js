'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const duration = require('../../../core/duration');
const { setting, roleProblem, KICK_MIN_MS, KICK_MAX_MS, KICK_JOB } = require('../lib/config');
const { MIN_LENGTH, MAX_LENGTH } = require('../lib/captcha');
const { postPanel, cancelKicks } = require('../lib/flow');

const data = new SlashCommandBuilder()
  .setName('verification')
  .setDescription('Captcha verification for new members')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('setup').setDescription('Configure and post the verification panel')
    .addRoleOption((o) => o.setName('role').setDescription('Role given once verified').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('Panel channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption((o) => o.setName('kick_after').setDescription('Kick unverified after (e.g. 30m, 0 = never)').setMaxLength(20))
    .addRoleOption((o) => o.setName('unverified_role').setDescription('Role given on join, removed once verified'))
    .addIntegerOption((o) => o.setName('code_length').setDescription('Code length').setMinValue(MIN_LENGTH).setMaxValue(MAX_LENGTH))
    .addIntegerOption((o) => o.setName('attempts').setDescription('Wrong answers before a 5 minute lock').setMinValue(1).setMaxValue(10))
    .addStringOption((o) => o.setName('message').setDescription('Panel text').setMaxLength(1500)))
  .addSubcommand((s) => s.setName('panel').setDescription('Post the panel again'))
  .addSubcommand((s) => s.setName('disable').setDescription('Disable verification'))
  .addSubcommand((s) => s.setName('status').setDescription('Show the verification configuration'));

const reply = (interaction, embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
const perms = (list) => list.map((p) => `\`${p}\``).join(', ');

/**
 * Parses the kick_after option: null when absent, 0 for "off", ms otherwise, NaN when invalid.
 * @param {string|null} value
 */
function parseKickAfter(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim().toLowerCase();
  if (['0', 'off', 'non', 'no', 'none', 'never', 'jamais'].includes(v)) return 0;
  const ms = duration.parse(v);
  if (!ms || ms < KICK_MIN_MS || ms > KICK_MAX_MS) return NaN;
  return ms;
}

module.exports = {
  data,
  parseKickAfter,
  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} ctx
   */
  async execute(interaction, ctx) {
    const { t, embeds } = ctx;
    const g = ctx.store.guild(interaction.guildId);
    const sub = interaction.options.getSubcommand();
    const errTitle = t(interaction, 'verification:errors.title');

    if (sub === 'setup') {
      const role = interaction.options.getRole('role', true);
      const channel = interaction.options.getChannel('channel', true);
      const unverified = interaction.options.getRole('unverified_role');
      const kickAfter = parseKickAfter(interaction.options.getString('kick_after'));
      if (Number.isNaN(kickAfter)) return reply(interaction, embeds.error(errTitle, t(interaction, 'verification:errors.badDuration', { min: duration.format(KICK_MIN_MS, interaction), max: duration.format(KICK_MAX_MS, interaction) })));
      for (const r of [role, unverified].filter(Boolean)) {
        const problem = roleProblem(interaction.guild, r);
        if (problem) return reply(interaction, embeds.error(errTitle, t(interaction, `verification:errors.role.${problem}`, { role: `<@&${r.id}>` })));
      }
      if (unverified && unverified.id === role.id) return reply(interaction, embeds.error(errTitle, t(interaction, 'verification:errors.sameRole')));
      const missing = ctx.permissions.botMissing(interaction.guild, ['ViewChannel', 'SendMessages', 'EmbedLinks'], channel);
      if (missing.length) return reply(interaction, embeds.error(errTitle, t(interaction, 'verification:errors.missingPerms', { channel: `<#${channel.id}>`, perms: perms(missing) })));

      g.set('verification.roleId', role.id);
      g.set('verification.channelId', channel.id);
      g.set('verification.unverifiedRoleId', unverified ? unverified.id : null);
      if (kickAfter !== null) g.set('verification.kickAfter', kickAfter);
      const len = interaction.options.getInteger('code_length');
      if (len) g.set('verification.codeLength', len);
      const attempts = interaction.options.getInteger('attempts');
      if (attempts) g.set('verification.maxAttempts', attempts);
      const message = interaction.options.getString('message');
      if (message) g.set('verification.panelMessage', message.replace(/\\n/g, '\n'));
      g.set('verification.enabled', true);

      let posted;
      try { posted = await postPanel(ctx, interaction.guild); } catch (err) { posted = { ok: false, reason: err.code === 50013 ? 'missing' : 'error', perms: [] }; }
      if (!posted.ok) return reply(interaction, embeds.error(errTitle, t(interaction, 'verification:errors.panelFailed')));
      const notes = [];
      const kickMs = setting(g, 'verification.kickAfter');
      if (kickMs > 0 && !ctx.permissions.botCan(interaction.guild, PermissionFlagsBits.KickMembers)) notes.push(t(interaction, 'verification:setup.noKickPerm'));
      // Members already in the server keep their access: only newcomers are concerned.
      notes.push(t(interaction, 'verification:setup.channelTip', { role: `<@&${role.id}>`, channel: `<#${channel.id}>` }));
      return reply(interaction, embeds.success(t(interaction, 'verification:setup.title'), [t(interaction, 'verification:setup.done', { url: posted.url }), ...notes].join('\n\n')));
    }

    if (sub === 'panel') {
      if (!setting(g, 'verification.enabled')) return reply(interaction, embeds.error(errTitle, t(interaction, 'verification:errors.notEnabled')));
      let posted;
      try { posted = await postPanel(ctx, interaction.guild); } catch { posted = { ok: false }; }
      if (!posted.ok) return reply(interaction, embeds.error(errTitle, t(interaction, 'verification:errors.panelFailed')));
      return reply(interaction, embeds.success(t(interaction, 'verification:setup.title'), t(interaction, 'verification:setup.reposted', { url: posted.url })));
    }

    if (sub === 'disable') {
      g.set('verification.enabled', false);
      const channel = interaction.guild.channels.cache.get(setting(g, 'verification.channelId'));
      const messageId = setting(g, 'verification.messageId');
      if (channel?.isTextBased() && messageId) await channel.messages.delete(messageId).catch(() => {});
      g.set('verification.messageId', null);
      const cancelled = cancelKicks(ctx, interaction.guildId);
      return reply(interaction, embeds.success(t(interaction, 'verification:disable.title'), t(interaction, 'verification:disable.done', { count: cancelled })));
    }

    const yes = t(interaction, 'verification:status.on');
    const no = t(interaction, 'verification:status.off');
    const roleId = setting(g, 'verification.roleId');
    const unverifiedId = setting(g, 'verification.unverifiedRoleId');
    const channelId = setting(g, 'verification.channelId');
    const kickMs = Number(setting(g, 'verification.kickAfter')) || 0;
    const pending = ctx.scheduler.list(KICK_JOB, (p) => p?.guildId === interaction.guildId).length;
    const none = t(interaction, 'verification:status.none');
    return reply(interaction, embeds.info(t(interaction, 'verification:status.title'), undefined, {
      fields: [
        { name: t(interaction, 'verification:status.state'), value: setting(g, 'verification.enabled') ? yes : no, inline: true },
        { name: t(interaction, 'verification:status.role'), value: roleId ? `<@&${roleId}>` : none, inline: true },
        { name: t(interaction, 'verification:status.unverifiedRole'), value: unverifiedId ? `<@&${unverifiedId}>` : none, inline: true },
        { name: t(interaction, 'verification:status.channel'), value: channelId ? `<#${channelId}>` : none, inline: true },
        { name: t(interaction, 'verification:status.kickAfter'), value: kickMs ? duration.format(kickMs, interaction) : t(interaction, 'verification:status.never'), inline: true },
        { name: t(interaction, 'verification:status.code'), value: t(interaction, 'verification:status.codeValue', { length: setting(g, 'verification.codeLength'), attempts: setting(g, 'verification.maxAttempts') }), inline: true },
        { name: t(interaction, 'verification:status.pending'), value: String(pending), inline: true }
      ]
    }));
  }
};
