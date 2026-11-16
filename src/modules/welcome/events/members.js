'use strict';

const { Events } = require('discord.js');
const { sendToChannel, sendDm, applyAutoroles } = require('../lib/send');

const log = (ctx) => (ctx.logger.child ? ctx.logger.child('welcome') : ctx.logger);

/** Runs a step and only logs its failure, so one broken step never blocks the others. */
async function attempt(ctx, label, fn) {
  try {
    const result = await fn();
    if (result && result.ok === false && result.reason === 'missing') log(ctx).warn(`${label}: missing ${result.perms.join(', ')} in channel ${result.channelId}`);
    return result;
  } catch (err) {
    log(ctx).warn(`${label} failed:`, err.message);
    return null;
  }
}

async function greet(ctx, member) {
  await attempt(ctx, 'autorole', () => applyAutoroles(ctx, member));
  if (member.user.bot) return;
  await attempt(ctx, 'welcome', () => sendToChannel(ctx, member, 'welcome'));
  await attempt(ctx, 'welcome dm', () => sendDm(ctx, member));
}

module.exports = [
  {
    event: Events.GuildMemberAdd,
    async execute(ctx, member) {
      // With membership screening, roles cannot be given (and the member has not
      // really joined) until the rules are accepted: wait for that update.
      if (member.pending) return;
      await greet(ctx, member);
    }
  },
  {
    event: Events.GuildMemberUpdate,
    async execute(ctx, oldMember, newMember) {
      if (oldMember.pending && !newMember.pending) await greet(ctx, newMember);
    }
  },
  {
    event: Events.GuildMemberRemove,
    async execute(ctx, member) {
      if (member.user.bot) return;
      await attempt(ctx, 'goodbye', () => sendToChannel(ctx, member, 'goodbye'));
    }
  }
];
