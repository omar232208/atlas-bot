'use strict';

const { ineligibility } = require('../lib/logic');
const { giveawayEmbed, enterRow } = require('../lib/render');
const { load, save } = require('../lib/finish');

/**
 * Enter / leave button. customId: gw:enter:<id>. Pressing it again leaves.
 * The member must meet the requirements, and only active giveaways accept entries.
 */
const enterComponent = {
  prefix: 'gw:',
  async execute(interaction, ctx) {
    const guildId = interaction.guildId;
    const id = interaction.customId.split(':')[2];
    const record = load(ctx, guildId, id);
    const refuse = (key, vars) => interaction.reply({
      embeds: [ctx.embeds.error(ctx.t(interaction, 'giveaways:errors.title'), ctx.t(interaction, key, vars))],
      flags: 64
    });
    if (!record || record.status !== 'active' || record.endsAt <= Date.now()) return refuse('giveaways:errors.notActive');

    const userId = interaction.user.id;
    const refresh = () => interaction.update({ embeds: [giveawayEmbed(ctx, interaction, record)], components: [enterRow(ctx, interaction, record)] });
    const note = (key) => interaction.followUp({ embeds: [ctx.embeds.info(ctx.t(interaction, key))], flags: 64 }).catch(() => {});

    if (record.entries[userId]) {
      delete record.entries[userId];
      save(ctx, guildId, record);
      await refresh();
      return note('giveaways:entry.left');
    }

    const roles = Array.isArray(interaction.member?.roles)
      ? interaction.member.roles
      : [...(interaction.member?.roles?.cache?.keys() ?? [])];
    const reason = ineligibility({
      roleIds: roles,
      accountCreatedAt: interaction.user.createdTimestamp,
      now: Date.now(),
      requiredRoleId: record.requiredRoleId,
      minAccountDays: record.minAccountDays
    });
    if (reason === 'role') return refuse('giveaways:entry.needRole', { role: `<@&${record.requiredRoleId}>` });
    if (reason === 'age') return refuse('giveaways:entry.needAge', { days: record.minAccountDays });

    record.entries[userId] = true;
    save(ctx, guildId, record);
    await refresh();
    return note('giveaways:entry.joined');
  }
};

module.exports = { enterComponent };
