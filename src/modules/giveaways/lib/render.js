'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/** Discord's relative timestamp, rendered by the client in each user's language. */
const relative = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

/**
 * Embed shown in the giveaway message. Recomputed from the record every time,
 * so the entry count stays right after a restart.
 * @param {object} ctx
 * @param {*} target Language target.
 * @param {object} g Giveaway record.
 */
function giveawayEmbed(ctx, target, g) {
  const { t, embeds } = ctx;
  const fields = [
    { name: t(target, 'giveaways:embed.host'), value: `<@${g.hostId}>`, inline: true },
    { name: t(target, 'giveaways:embed.winners'), value: String(g.winnersCount), inline: true },
    { name: t(target, 'giveaways:embed.entries'), value: String(Object.keys(g.entries).length), inline: true }
  ];
  const requirements = [];
  if (g.requiredRoleId) requirements.push(t(target, 'giveaways:embed.requireRole', { role: `<@&${g.requiredRoleId}>` }));
  if (g.minAccountDays > 0) requirements.push(t(target, 'giveaways:embed.requireAge', { days: g.minAccountDays }));
  if (requirements.length) fields.push({ name: t(target, 'giveaways:embed.requirements'), value: requirements.join('\n'), inline: false });

  const description = g.status === 'active'
    ? `${t(target, 'giveaways:embed.instructions')}\n${t(target, 'giveaways:embed.ends', { time: relative(g.endsAt) })}`
    : t(target, `giveaways:embed.${g.status}`, { winners: g.winnerIds.length ? g.winnerIds.map((id) => `<@${id}>`).join(' ') : '-' });
  const build = g.status === 'active' ? embeds.info : g.status === 'cancelled' ? embeds.warn : embeds.success;
  return build(g.prize, description, { fields });
}

/**
 * The Enter button, with the live entry count. Disabled once the giveaway is over.
 * @param {object} ctx
 * @param {*} target
 * @param {object} g
 */
function enterRow(ctx, target, g) {
  const active = g.status === 'active';
  const button = new ButtonBuilder()
    .setCustomId(`gw:enter:${g.id}`)
    .setStyle(ButtonStyle.Success)
    .setLabel(active
      ? ctx.t(target, 'giveaways:buttons.enter', { count: Object.keys(g.entries).length })
      : ctx.t(target, 'giveaways:buttons.over'))
    .setDisabled(!active);
  return new ActionRowBuilder().addComponents(button);
}

module.exports = { giveawayEmbed, enterRow, relative };
