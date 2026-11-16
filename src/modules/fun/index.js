'use strict';

const { SETTINGS } = require('./settings');
const { dispatch } = require('./games/tracker');

/**
 * Dashboard schema: every field path is read through readSetting() in the
 * code (see test/fun.test.js), and defaults and bounds come from SETTINGS, so
 * a change made in the dashboard is effective immediately.
 */
const numberField = (path, label, help) => ({
  path,
  type: 'number',
  label,
  help,
  default: SETTINGS[path].default,
  min: SETTINGS[path].min,
  max: SETTINGS[path].max
});

const dashboard = {
  sections: [
    {
      id: 'games',
      title: 'fun:dashboard.games.title',
      description: 'fun:dashboard.games.description',
      fields: [
        numberField('fun.games.timeoutMinutes', 'fun:dashboard.games.timeoutMinutes.label', 'fun:dashboard.games.timeoutMinutes.help')
      ]
    },
    {
      id: 'trivia',
      title: 'fun:dashboard.trivia.title',
      description: 'fun:dashboard.trivia.description',
      fields: [
        numberField('fun.trivia.questionSeconds', 'fun:dashboard.trivia.questionSeconds.label', 'fun:dashboard.trivia.questionSeconds.help')
      ]
    }
  ]
};

module.exports = {
  name: 'fun',
  commands: [
    require('./commands/eightball'),
    require('./commands/dice'),
    require('./commands/game'),
    require('./commands/fun')
  ],
  events: [],
  // One router for every game button: games/tracker.js finds the game by message.
  components: [{ prefix: 'fun:', execute: (interaction, ctx) => dispatch(interaction, ctx) }],
  dashboard
};
