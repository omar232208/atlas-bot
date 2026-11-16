'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { safe, respond, getPlayer, guard, ensureConnected } = require('../lib/runtime');
const { MusicError } = require('../lib/source');
const { getConfig, LIMITS } = require('../lib/config');

const ANNOUNCE_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice];

/** Settings embed shared by "show" and "config". */
function settingsEmbed(interaction, ctx, title, kind = 'info') {
  const cfg = getConfig(ctx.store, interaction.guildId);
  const t = (k, v) => ctx.t(interaction, k, v);
  const yes = t('music:config.yes');
  const no = t('music:config.no');
  const fields = [
    { name: t('music:config.fields.djRole'), value: cfg.djRole ? `<@&${cfg.djRole}>` : t('music:config.noDj'), inline: true },
    { name: t('music:config.fields.maxQueue'), value: String(cfg.maxQueue), inline: true },
    { name: t('music:config.fields.defaultVolume'), value: `${cfg.defaultVolume}%`, inline: true },
    { name: t('music:config.fields.stay247'), value: cfg.stay247 ? yes : no, inline: true },
    { name: t('music:config.fields.announce'), value: cfg.announce ? yes : no, inline: true },
    { name: t('music:config.fields.announceChannel'), value: cfg.announceChannel ? `<#${cfg.announceChannel}>` : t('music:config.sameChannel'), inline: true },
    { name: t('music:config.fields.allowFiles'), value: cfg.allowFiles ? yes : no, inline: true }
  ];
  return ctx.embeds[kind](title, undefined, { fields, footer: t('music:config.footer') });
}

/**
 * /music join|leave|show|config|reset. join/leave are for every listener (leave
 * needs DJ rights); settings need Manage Server, checked here because the
 * command itself stays visible to everyone for join/leave.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music settings')
    .addSubcommand((s) => s.setName('join').setDescription('Join your voice channel'))
    .addSubcommand((s) => s.setName('leave').setDescription('Disconnect from voice'))
    .addSubcommand((s) => s.setName('show').setDescription('Show the music settings'))
    .addSubcommand((s) => s.setName('config').setDescription('Change the music settings')
      .addRoleOption((o) => o.setName('dj_role').setDescription('Role allowed to skip, stop and edit the queue'))
      .addBooleanOption((o) => o.setName('remove_dj_role').setDescription('Everyone in the channel can control the music'))
      .addIntegerOption((o) => o.setName('max_queue').setDescription('Maximum tracks in the queue').setMinValue(LIMITS.maxQueue.min).setMaxValue(LIMITS.maxQueue.max))
      .addIntegerOption((o) => o.setName('default_volume').setDescription('Volume when the bot joins (0-150)').setMinValue(0).setMaxValue(150))
      .addBooleanOption((o) => o.setName('stay_247').setDescription('Stay in the voice channel 24/7'))
      .addBooleanOption((o) => o.setName('announce').setDescription('Announce each new track'))
      .addChannelOption((o) => o.setName('announce_channel').setDescription('Channel for announcements').addChannelTypes(...ANNOUNCE_TYPES))
      .addBooleanOption((o) => o.setName('announce_here').setDescription('Announce where the track was requested'))
      .addBooleanOption((o) => o.setName('allow_files').setDescription('Allow playing attached files')))
    .addSubcommand((s) => s.setName('reset').setDescription('Restore the default music settings')),
  execute: safe(async (interaction, ctx) => {
    const sub = interaction.options.getSubcommand();
    const store = ctx.store.guild(interaction.guildId);
    const t = (k, v) => ctx.t(interaction, k, v);
    if (sub === 'join') {
      guard(interaction, ctx);
      await interaction.deferReply();
      const player = await ensureConnected(interaction, ctx);
      if (!player.queue.current) player.armIdle();
      return respond(interaction, { embeds: [ctx.embeds.success(t('music:join.done'), t('music:join.details', { channel: `<#${player.channelId}>` }))] });
    }
    if (sub === 'leave') {
      // Admins may disconnect a 24/7 bot without joining its channel.
      const { player } = guard(interaction, ctx, { dj: true, voice: !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) });
      if (!player?.connection) throw new MusicError('notConnected');
      player.destroy();
      return respond(interaction, { embeds: [ctx.embeds.success(t('music:leave.done'))] });
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new MusicError('manageGuild');
    if (sub === 'show') return respond(interaction, { embeds: [settingsEmbed(interaction, ctx, t('music:config.title'))] });
    if (sub === 'reset') {
      for (const key of ['djRole', 'maxQueue', 'stay247', 'announce', 'announceChannel', 'defaultVolume', 'allowFiles', 'session']) store.delete(`music.${key}`);
      getPlayer(interaction.guildId)?.armIdle();
      return respond(interaction, { embeds: [settingsEmbed(interaction, ctx, t('music:config.resetDone'), 'success')] });
    }

    const o = interaction.options;
    const changes = [];
    const set = (key, value) => { store.set(`music.${key}`, value); changes.push(key); };
    if (o.getRole('dj_role')) set('djRole', o.getRole('dj_role').id);
    if (o.getBoolean('remove_dj_role')) set('djRole', null);
    if (o.getInteger('max_queue') !== null) set('maxQueue', o.getInteger('max_queue'));
    if (o.getInteger('default_volume') !== null) set('defaultVolume', o.getInteger('default_volume'));
    if (o.getBoolean('stay_247') !== null) set('stay247', o.getBoolean('stay_247'));
    if (o.getBoolean('announce') !== null) set('announce', o.getBoolean('announce'));
    if (o.getChannel('announce_channel')) set('announceChannel', o.getChannel('announce_channel').id);
    if (o.getBoolean('announce_here')) set('announceChannel', null);
    if (o.getBoolean('allow_files') !== null) set('allowFiles', o.getBoolean('allow_files'));
    if (!changes.length) return respond(interaction, { embeds: [settingsEmbed(interaction, ctx, t('music:config.title'))] });

    // 24/7 changes apply at once: save the session or arm the idle/alone timers.
    const player = getPlayer(interaction.guildId);
    if (player && changes.includes('stay247')) {
      player.saveSession();
      if (!player.queue.current) player.armIdle();
      else clearTimeout(player.idleTimer);
    }
    return respond(interaction, { embeds: [settingsEmbed(interaction, ctx, t('music:config.saved'), 'success')] });
  })
};
