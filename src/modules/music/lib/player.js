'use strict';

const { spawn } = require('node:child_process');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { Queue, ffmpegArgs, parseFfmpegInfo, clampVolume } = require('./logic');
const { openAudio, MusicError } = require('./source');
const { getConfig } = require('./config');
const { escape, nowPlayingPayload } = require('./ui');

const LEAVE_AFTER_MS = 120000;
const START_TIMEOUT_MS = 20000;
const MAX_FAILURES_IN_ROW = 5;

/**
 * Playback state of one guild: voice connection, audio player, queue and the
 * single ffmpeg process feeding it. Created by the manager (index.js).
 */
class GuildPlayer {
  /**
   * @param {object} deps { voice, ffmpegPath, ctx, onDestroy }
   * @param {import('discord.js').Guild} guild
   */
  constructor(deps, guild) {
    this.deps = deps;
    this.voice = deps.voice;
    this.ctx = deps.ctx;
    this.guild = guild;
    this.queue = new Queue();
    this.volume = getConfig(this.ctx.store, guild.id).defaultVolume;
    this.connection = null;
    this.proc = null;
    this.input = null;
    this.resource = null;
    this.seekOffset = 0;
    this.gen = 0;
    this.failures = 0;
    this.awaited = new Set();
    this.autoPaused = false;
    this.lastAnnounce = null;
    this.idleTimer = null;
    this.aloneTimer = null;
    this.destroyed = false;

    const { createAudioPlayer, NoSubscriberBehavior, AudioPlayerStatus } = this.voice;
    this.audio = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.audio.on('error', (err) => this.ctx.logger.warn(`[music] player error in ${guild.id}:`, err.message));
    this.audio.on('stateChange', (oldState, newState) => {
      if (newState.status !== AudioPlayerStatus.Idle || oldState.status === AudioPlayerStatus.Idle) return;
      const meta = oldState.resource?.metadata;
      // Ignore the end of a resource replaced by seek/volume (older generation).
      if (meta && meta.gen === this.gen) this.onTrackEnd(meta);
    });
  }

  /** Voice channel id the bot is in, if any. */
  get channelId() { return this.connection ? this.guild.members.me?.voice?.channelId || this.connection.joinConfig.channelId : null; }

  /** True while a track is loaded (playing or paused). */
  get active() { return !!this.queue.current && !!this.resource; }

  get paused() {
    const { AudioPlayerStatus } = this.voice;
    return [AudioPlayerStatus.Paused, AudioPlayerStatus.AutoPaused].includes(this.audio.state.status);
  }

  /** Current position in ms (seek offset + time actually played). */
  get position() { return this.resource ? this.seekOffset + this.resource.playbackDuration : 0; }

  /**
   * Joins a voice (or stage) channel and waits until the connection is ready.
   * @param {import('discord.js').VoiceBasedChannel} channel
   */
  async connect(channel) {
    const { joinVoiceChannel, entersState, VoiceConnectionStatus } = this.voice;
    if (this.connection && this.channelId === channel.id) return;
    const connection = joinVoiceChannel({ channelId: channel.id, guildId: this.guild.id, adapterCreator: this.guild.voiceAdapterCreator, selfDeaf: true });
    if (this.connection !== connection) {
      this.connection = connection;
      connection.subscribe(this.audio);
      connection.on('stateChange', async (_old, state) => {
        if (state.status === VoiceConnectionStatus.Disconnected) {
          // A move to another channel or a short network cut reconnects by itself;
          // otherwise the bot was kicked from the channel and we clean up.
          try {
            await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]);
          } catch {
            if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
          }
        } else if (state.status === VoiceConnectionStatus.Destroyed && this.connection === connection) {
          this.destroy({ keepConnection: true });
        }
      });
    }
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    } catch {
      connection.destroy();
      throw new MusicError('connectFailed');
    }
    if (channel.type === ChannelType.GuildStageVoice) {
      // On a stage the bot joins as audience: become a speaker if allowed,
      // otherwise raise a hand so a moderator can invite it.
      const me = this.guild.members.me;
      await me?.voice.setSuppressed(false).catch(() => me.voice.setRequestToSpeak(true).catch(() => {}));
    }
    this.saveSession();
  }

  /**
   * Starts the current track of the queue, optionally at a position.
   * @param {{seekMs?: number, awaited?: boolean}} [opts] awaited: the caller reports errors itself.
   * @returns {Promise<void>} Resolves once audio is flowing, rejects with a MusicError.
   */
  start(opts = {}) {
    const track = this.queue.current;
    if (!track) return Promise.resolve();
    track.lastError = null;
    clearTimeout(this.idleTimer);
    this.killProcess();
    const gen = ++this.gen;
    if (opts.awaited) this.awaited.add(gen);
    const seekMs = track.live ? 0 : Math.max(0, opts.seekMs || 0);
    const { createAudioResource, StreamType, AudioPlayerStatus } = this.voice;

    const meta = { track, gen, inputError: null };
    const input = openAudio(track, { onTitle: (title) => { track.streamTitle = title; } });
    const proc = spawn(this.deps.ffmpegPath, ffmpegArgs({ seekMs, volume: this.volume, live: track.live }), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.input = input;
    this.proc = proc;
    input.on('error', (err) => { meta.inputError = err; proc.stdin.end(); });
    proc.stdin.on('error', () => { /* ffmpeg exited first (EPIPE): nothing to do */ });
    input.pipe(proc.stdin);
    let banner = '';
    proc.stderr.on('data', (chunk) => {
      if (banner.length > 16000) return;
      banner += chunk;
      if (!track.live && !track.durationMs) {
        const info = parseFfmpegInfo(banner);
        if (info.durationMs) track.durationMs = info.durationMs;
        else if (info.kbps && track.contentLength) { track.durationMs = Math.round((track.contentLength * 8) / info.kbps); track.estimated = true; }
      }
    });
    proc.on('error', (err) => this.ctx.logger.error('[music] ffmpeg failed to start:', err.message));

    const resource = createAudioResource(proc.stdout, { inputType: StreamType.OggOpus, metadata: meta });
    this.resource = resource;
    this.seekOffset = seekMs;
    this.audio.play(resource);
    this.saveSession();

    // Success means the player is playing AND ffmpeg produced real audio: an
    // empty or broken input still yields a tiny Ogg header and a short
    // "playing" state, which must count as a failure.
    return new Promise((resolve, reject) => {
      let done = false;
      let playing = false;
      let outBytes = 0;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.audio.off('stateChange', onState);
        proc.off('close', onClose);
        proc.stdout.off('data', onData);
        if (err) {
          meta.inputError = meta.inputError || err;
          // Stopping emits Idle for this generation, so onTrackEnd moves on even
          // when nobody listens (an auto-paused player never reaches the end).
          if (gen === this.gen) { this.killProcess(); this.audio.stop(true); }
          reject(err);
        } else { this.failures = 0; this.awaited.delete(gen); resolve(); }
      };
      const ready = () => playing && outBytes > 2048 && finish();
      const onData = (chunk) => { outBytes += chunk.length; ready(); };
      const onState = (_o, s) => {
        if (gen !== this.gen) return finish(new MusicError('aborted'));
        if (s.status === AudioPlayerStatus.Playing && s.resource === resource) { playing = true; ready(); }
      };
      const onClose = () => finish(meta.inputError instanceof MusicError ? meta.inputError : new MusicError('decode'));
      const timer = setTimeout(() => finish(new MusicError('timeout')), START_TIMEOUT_MS);
      this.audio.on('stateChange', onState);
      // Extra listener next to the resource's pipe: both see the same chunks.
      proc.stdout.on('data', onData);
      proc.once('close', onClose);
    }).catch((err) => {
      track.lastError = err;
      throw err;
    });
  }

  /** Called when the resource of the current generation ended or failed. */
  async onTrackEnd(meta) {
    const { track, gen } = meta;
    const error = meta.inputError || track.lastError;
    const failed = !!meta.inputError || this.position < 1000;
    const reported = this.awaited.delete(gen);
    this.resource = null;
    this.killProcess();
    if (failed) {
      this.failures += 1;
      if (!reported) this.notify('error', error instanceof MusicError ? error.code : 'decode', { title: track.title, ...(error?.vars || {}) }, track);
    }
    if (this.failures >= MAX_FAILURES_IN_ROW) {
      this.queue.reset();
      this.notify('error', 'tooManyFailures', {}, track);
    } else {
      this.queue.next({ skip: failed });
    }
    await this.playNextAvailable();
  }

  /** Plays the current queue entry or arms the idle timer when the queue is empty. */
  async playNextAvailable() {
    if (this.destroyed) return;
    if (!this.queue.current) {
      this.saveSession();
      this.armIdle();
      return;
    }
    this.start().then(() => this.announce(this.queue.current)).catch(() => { /* reported by onTrackEnd */ });
  }

  /** Skips the current track (or jumps to an upcoming position). */
  skip(toPosition) {
    const track = toPosition ? this.queue.skipTo(toPosition) : this.queue.next({ skip: true });
    if (!track) {
      this.queue.current = null;
      this.stopAudio();
      this.armIdle();
      return null;
    }
    this.playNextAvailable();
    return track;
  }

  /** Restarts the current track at `ms` (used by /seek and /volume). */
  async seek(ms) {
    if (!this.queue.current) return;
    const wasPaused = this.paused;
    await this.start({ seekMs: ms, awaited: true });
    if (wasPaused) this.audio.pause();
  }

  /**
   * Changes the volume. ffmpeg applies it, so the current track restarts at the
   * same position (live radios simply reconnect).
   * @param {number} percent 0-150
   */
  async setVolume(percent) {
    this.volume = clampVolume(percent);
    if (this.active) await this.seek(this.position);
  }

  pause() { return this.audio.pause(); }

  resume() { this.autoPaused = false; return this.audio.unpause(); }

  /** Stops playback and clears the queue, staying in the channel. */
  stop() {
    this.queue.reset();
    this.stopAudio();
    this.saveSession();
    this.armIdle();
  }

  stopAudio() {
    this.gen += 1;
    this.resource = null;
    this.audio.stop(true);
    this.killProcess();
  }

  /** Kills the ffmpeg process and the download feeding it. */
  killProcess() {
    const proc = this.proc;
    this.input?.destroy();
    this.input = null;
    this.proc = null;
    if (proc && proc.exitCode === null) {
      proc.kill('SIGTERM');
      // ffmpeg normally exits at once; make sure no process can linger.
      setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); }, 2000).unref();
    }
  }

  /** Leaves after 2 minutes without music, unless 24/7 mode is on. */
  armIdle() {
    clearTimeout(this.idleTimer);
    if (getConfig(this.ctx.store, this.guild.id).stay247) return;
    this.idleTimer = setTimeout(() => {
      if (!this.queue.current) { this.notify('info', 'leftIdle'); this.destroy(); }
    }, LEAVE_AFTER_MS);
    this.idleTimer.unref?.();
  }

  /**
   * Reacts to the human listener count of the bot's channel: pauses and arms a
   * 2-minute leave timer when alone, resumes when someone comes back.
   * @param {number} humans
   */
  updateListeners(humans) {
    if (humans > 0) {
      clearTimeout(this.aloneTimer);
      this.aloneTimer = null;
      if (this.autoPaused) this.resume();
      return;
    }
    if (this.aloneTimer) return;
    if (this.active && !this.paused) { this.audio.pause(); this.autoPaused = true; }
    if (getConfig(this.ctx.store, this.guild.id).stay247) return;
    this.aloneTimer = setTimeout(() => { this.notify('info', 'leftAlone'); this.destroy(); }, LEAVE_AFTER_MS);
    this.aloneTimer.unref?.();
  }

  /** Text channel for automatic messages: configured one, else where the track was asked. */
  textChannel(track) {
    const cfg = getConfig(this.ctx.store, this.guild.id);
    const id = cfg.announceChannel || track?.textChannelId || this.lastTextChannelId;
    const channel = id ? this.guild.channels.cache.get(id) : null;
    if (!channel?.isTextBased?.()) return null;
    const ok = this.ctx.permissions.botCan(this.guild, PermissionFlagsBits.SendMessages, channel) && this.ctx.permissions.botCan(this.guild, PermissionFlagsBits.EmbedLinks, channel);
    return ok ? channel : null;
  }

  /** Posts an info/error message about the player in the text channel. */
  notify(kind, key, vars = {}, track) {
    const channel = this.textChannel(track || this.queue.current);
    if (!channel) return;
    const t = (k, v) => this.ctx.t(this.guild, k, v);
    let embed;
    if (kind === 'error') {
      const reason = t(`music:errors.${key}`, vars);
      embed = this.ctx.embeds.error(t('music:player.errorTitle'), vars.title ? t('music:player.trackFailed', { title: escape(vars.title), reason }) : reason);
    } else {
      embed = this.ctx.embeds.info(t('music:player.infoTitle'), t(`music:player.${key}`, vars));
    }
    channel.send({ embeds: [embed] }).catch(() => {});
  }

  /** "Now playing" message with controls; the previous one is deleted to avoid clutter. */
  async announce(track) {
    if (!track || !getConfig(this.ctx.store, this.guild.id).announce) return;
    const channel = this.textChannel(track);
    if (!channel) return;
    const previous = this.lastAnnounce;
    this.lastAnnounce = await channel.send(nowPlayingPayload(this, this.guild, { compact: true })).catch(() => null);
    if (previous) previous.delete().catch(() => {});
  }

  /** Persists what is needed to rejoin after a restart in 24/7 mode. */
  saveSession() {
    const store = this.ctx.store.guild(this.guild.id);
    const cfg = getConfig(this.ctx.store, this.guild.id);
    if (!cfg.stay247 || !this.connection || this.destroyed) { if (store.get('music.session')) store.delete('music.session'); return; }
    const cur = this.queue.current;
    store.set('music.session', {
      channelId: this.channelId,
      textChannelId: cur?.textChannelId || this.lastTextChannelId || null,
      // Only live streams are resumed: a file would restart from the beginning.
      track: cur?.live ? { title: cur.title, url: cur.url, urls: cur.urls, live: true, kind: cur.kind, radioId: cur.radioId || null } : null
    });
  }

  /**
   * Stops everything and leaves the voice channel.
   * @param {{keepConnection?: boolean}} [opts] keepConnection: already destroyed by Discord.
   */
  destroy(opts = {}) {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.aloneTimer);
    this.queue.reset();
    this.stopAudio();
    const { VoiceConnectionStatus } = this.voice;
    if (!opts.keepConnection && this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    this.connection = null;
    if (this.lastAnnounce) this.lastAnnounce.edit({ components: [] }).catch(() => {});
    if (!opts.keepSession) this.ctx.store.guild(this.guild.id).delete('music.session');
    this.deps.onDestroy?.(this.guild.id);
  }
}

module.exports = { GuildPlayer, LEAVE_AFTER_MS };
