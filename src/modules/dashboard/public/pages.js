'use strict';

/* Pages: login, server picker, overview and module settings. */
(function () {
  const D = window.Dash;
  const { el, icon } = D;
  const ui = (k, v) => D.ui(k, v);

  const fmtNumber = (n) => new Intl.NumberFormat(D.S.lang).format(n);
  function relTime(at) {
    const diff = (at - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(D.S.lang, { numeric: 'auto' });
    for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]]) if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit);
    return rtf.format(0, 'minute');
  }

  const header = (title, sub, extra) => el('div', { class: 'page-header' }, [
    el('div', {}, [el('h1', { class: 'page-title', text: title }), sub ? el('p', { class: 'muted', text: sub }) : null]),
    extra || null
  ]);

  const guildIcon = (g, size) => (g.icon
    ? el('img', { class: 'guild-icon', src: g.icon, alt: '', width: size, height: size })
    : el('span', { class: 'guild-icon guild-icon-empty', 'aria-hidden': 'true', text: (g.name || '?').split(/\s+/).map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase() }));

  /** Full-page login / sign-in state. */
  function loginScreen(state) {
    const root = document.getElementById('app');
    root.textContent = '';
    const me = D.S.me || {};
    const card = el('div', { class: 'card login-card' }, [
      el('img', { src: '/favicon.svg', alt: '', width: 40, height: 40 }),
      el('h1', { class: 'page-title', text: ui('login.title') }),
      state === 'signingIn' ? el('p', { class: 'muted', text: ui('login.signingIn') }) : null,
      state && state !== 'signingIn' ? el('p', { class: 'notice notice-error', role: 'alert' }, [icon('alert', 16), el('span', { text: ui(`login.${state}`) })]) : null,
      state === 'signingIn' ? null : el('p', { class: 'muted', text: ui('login.howTo') }),
      state === 'signingIn' ? null : el('code', { class: 'command', text: '/dashboard' }),
      state !== 'signingIn' && me.oauth ? el('div', { class: 'login-or' }, [el('span', { text: ui('login.or') })]) : null,
      state !== 'signingIn' && me.oauth ? el('a', { class: 'btn btn-primary btn-block', href: '/auth/discord' }, [ui('login.discord')]) : null
    ]);
    root.appendChild(el('main', { class: 'login' }, [card]));
    root.appendChild(el('footer', { class: 'footer' }, [el('span', { text: ui('developer') }), el('a', { href: 'https://aclclouds.com', target: '_blank', rel: 'noopener' }, ['ACLClouds'])]));
  }

  /** Logged-in account summary shown above the server picker. */
  function accountCard() {
    const user = D.S.me && D.S.me.user;
    if (!user) return null;
    const totalMembers = D.S.guilds.reduce((n, g) => n + (g.memberCount || 0), 0);
    return el('section', { class: 'card account-card' }, [
      user.avatar
        ? el('img', { class: 'account-avatar', src: user.avatar, alt: '', width: 56, height: 56 })
        : el('span', { class: 'account-avatar avatar-empty', 'aria-hidden': 'true', text: (user.username || '?').charAt(0).toUpperCase() }),
      el('div', { class: 'account-info' }, [
        el('strong', { class: 'account-name', text: user.username }),
        el('span', { class: 'muted', text: ui('servers', { count: D.S.guilds.length }) }),
        el('span', { class: 'muted', text: ui('members', { count: fmtNumber(totalMembers) }) })
      ])
    ]);
  }

  /** Server picker shown when no server is selected. */
  function picker() {
    const guilds = D.S.guilds;
    if (!guilds.length) {
      return el('div', {}, [header(ui('picker.title')), accountCard(), el('div', { class: 'card empty' }, [el('p', { text: ui('picker.empty') }), el('code', { class: 'command', text: '/dashboard' })])]);
    }
    return el('div', {}, [
      header(ui('picker.title'), ui('picker.subtitle')),
      accountCard(),
      el('div', { class: 'guild-grid' }, guilds.map((g) => el('a', { class: 'card guild-card', href: `#/g/${g.id}` }, [
        guildIcon(g, 48),
        el('div', { class: 'guild-card-text' }, [el('strong', { text: g.name }), el('span', { class: 'muted', text: ui('members', { count: fmtNumber(g.memberCount) }) })])
      ])))
    ]);
  }

  function stat(label, value, iconName) {
    return el('div', { class: 'card stat' }, [el('div', { class: 'stat-label' }, [icon(iconName, 16), el('span', { text: label })]), el('div', { class: 'stat-value', text: value })]);
  }

  const pill = (on) => el('span', { class: `pill ${on ? 'pill-on' : 'pill-off'}`, text: ui(on ? 'enabled' : 'disabled') });

  function overview() {
    const o = D.S.overview;
    const g = o.guild;
    const stats = [stat(ui('stats.members'), fmtNumber(g.memberCount), 'users'), stat(ui('stats.channels'), fmtNumber(g.channelCount), 'list'), stat(ui('stats.roles'), fmtNumber(g.roleCount), 'tag')];
    if (o.openTickets !== null && o.openTickets !== undefined) stats.push(stat(ui('stats.tickets'), fmtNumber(o.openTickets), 'ticket'));

    const moduleRows = (list) => list.map((m) => el('a', { class: 'list-row', href: `#/g/${g.id}/m/${m.module}` }, [
      el('span', { class: 'list-row-main' }, [icon(D.MODULE_ICONS[m.module] || 'sliders', 16), el('span', { text: D.modTitle(m.module) })]),
      pill(!!D.current(togglePath(m.module)))
    ]));
    const protections = o.modules.filter((m) => m.protection);
    const others = o.modules.filter((m) => !m.protection);

    const history = o.history.length
      ? o.history.map((h) => el('li', { class: 'list-row' }, [
        el('span', { class: 'list-row-main' }, [icon(h.kind === 'action' ? 'play' : 'sliders', 16), el('span', { text: ui(h.kind === 'action' ? 'history.action' : 'history.config', { user: h.user, module: (h.modules || []).map(D.modTitle).join(', ') }) })]),
        el('time', { class: 'muted small', datetime: new Date(h.at).toISOString(), text: relTime(h.at) })
      ]))
      : [el('li', { class: 'list-empty muted', text: ui('history.empty') })];

    return el('div', {}, [
      el('div', { class: 'page-header' }, [el('div', { class: 'row' }, [guildIcon(g, 40), el('div', {}, [el('h1', { class: 'page-title', text: g.name }), el('p', { class: 'muted', text: ui('overview') })])])]),
      el('div', { class: 'stats' }, stats),
      el('div', { class: 'grid-2' }, [
        el('section', { class: 'card' }, [el('h2', { class: 'card-title', text: ui('protections') }), protections.length ? el('div', { class: 'list' }, moduleRows(protections)) : el('p', { class: 'muted', text: ui('noProtections') })]),
        el('section', { class: 'card' }, [el('h2', { class: 'card-title', text: ui('recentChanges') }), el('ul', { class: 'list' }, history)])
      ]),
      others.length ? el('section', { class: 'card' }, [el('h2', { class: 'card-title', text: ui('otherModules') }), el('div', { class: 'list list-cols' }, moduleRows(others))]) : null
    ]);
  }

  const togglePath = (name) => ((D.S.schema.modules.find((m) => m.name === name) || {}).toggle);

  function fieldRow(field, mod) {
    const id = `f-${field.path.replace(/[^\w-]/g, '-')}`;
    const err = D.S.errors[field.path];
    const changed = Object.prototype.hasOwnProperty.call(D.S.pending, field.path);
    const input = D.fieldInput(field, D.current(field.path), (v) => {
      D.setValue(field.path, v);
      row.classList.toggle('field-changed', Object.prototype.hasOwnProperty.call(D.S.pending, field.path));
      const msg = row.querySelector('.field-error');
      if (msg) msg.remove();
      if (field.path === mod.toggle) D.renderMain();
    }, { ui: (k) => ui(`field.${k}`), tr: D.tr, res: D.S.res, id });
    if (field.readOnly) D.lock(input);
    const inline = field.type === 'boolean';
    const row = el('div', { class: `field${inline ? ' field-inline' : ''}${changed ? ' field-changed' : ''}${err ? ' field-invalid' : ''}` }, [
      el('div', { class: 'field-text' }, [
        el(inline ? 'span' : 'label', { class: 'field-label', for: inline ? null : id, text: D.tr(field.label) }),
        field.help ? el('p', { class: 'field-help', text: D.tr(field.help) }) : null
      ]),
      el('div', { class: 'field-control' }, [input]),
      err ? el('p', { class: 'field-error', role: 'alert', text: ui(`errors.${err.error}`, { min: err.min, max: err.max }) }) : null
    ]);
    return row;
  }

  async function runAction(mod, action) {
    const label = D.tr(action.label);
    if (action.danger && !(await D.confirm(label, ui('actionConfirm'), true))) return;
    try {
      const out = await D.api('POST', `/api/guilds/${D.S.guildId}/actions/${mod.name}/${action.id}`, { lang: D.S.lang });
      D.toast(out.message || ui('actionDone'), 'success');
      await D.reloadOverview();
    } catch (err) {
      D.toast((err.data && err.data.message) || ui(err.status === 429 ? 'errors.rateLimited' : 'actionFailed'), 'error');
    }
  }

  const fieldDirty = (f) => Object.prototype.hasOwnProperty.call(D.S.pending, f.path) || !!D.S.errors[f.path];

  /** One collapsible card per command group (fields sharing `group`). */
  function commandGroup(gid, fields, mod) {
    if (fields.length === 1) return el('div', { class: 'fields' }, [fieldRow(fields[0], mod)]);
    const master = fields.find((f) => f.type === 'boolean') || null;
    const first = fields[0];
    const det = el('details', { class: 'cmd-group' });
    det.appendChild(el('summary', { class: 'cmd-summary' }, [
      el('span', { class: 'cmd-caret', 'aria-hidden': 'true' }, [icon('chevron', 14)]),
      el('code', { class: 'cmd-name', text: `/${gid}` }),
      first.label ? el('span', { class: 'cmd-label', text: D.tr(first.label) }) : null,
      master ? pill(!!D.current(master.path)) : null,
      fields.some(fieldDirty) ? el('span', { class: 'cmd-dot', 'aria-hidden': 'true' }) : null
    ]));
    det.appendChild(el('div', { class: 'fields cmd-fields' }, fields.map((f) => fieldRow(f, mod))));
    return det;
  }

  /** Renders section fields, collapsing runs that share a `group` id. */
  function renderFields(fields, mod) {
    const out = [];
    let plain = [];
    const flush = () => {
      if (plain.length) out.push(el('div', { class: 'fields' }, plain.map((f) => fieldRow(f, mod))));
      plain = [];
    };
    let i = 0;
    while (i < fields.length) {
      const f = fields[i];
      if (!f.group) { plain.push(f); i++; continue; }
      flush();
      const gid = f.group;
      const group = [f];
      i++;
      while (i < fields.length && fields[i].group === gid) { group.push(fields[i]); i++; }
      out.push(commandGroup(gid, group, mod));
    }
    flush();
    return out;
  }

  function modulePage(name) {
    const mod = D.S.schema.modules.find((m) => m.name === name);
    if (!mod) return el('div', { class: 'card empty' }, [el('p', { text: ui('notFound') })]);
    const enabled = mod.toggle ? !!D.current(mod.toggle) : true;
    const toggleLocked = mod.toggle && (D.fieldOf(mod.toggle) || {}).readOnly;
    const headSwitch = mod.toggle ? D.toggle(enabled, (v) => { D.setValue(mod.toggle, v); D.renderMain(); }, ui('enableModule', { module: D.modTitle(name) })) : null;
    if (toggleLocked) D.lock(headSwitch);
    const headToggle = mod.toggle ? el('label', { class: 'head-toggle', title: toggleLocked ? ui('ownerOnly') : null }, [el('span', { text: ui(enabled ? 'enabled' : 'disabled') }), headSwitch]) : null;
    const ownerNote = () => el('p', { class: 'notice notice-lock' }, [icon('lock', 16), el('span', { text: ui('ownerOnly') })]);
    const sections = mod.sections.map((s) => {
      const fields = s.fields.filter((f) => f.path !== mod.toggle);
      if (!fields.length) return null;
      const inner = [
        s.description ? el('p', { class: 'muted section-desc', text: D.tr(s.description) }) : null,
        s.readOnly ? ownerNote() : null,
        ...renderFields(fields, mod)
      ];
      if (s.collapsible) {
        const groups = new Set(fields.map((f) => f.group).filter(Boolean));
        const det = el('details', { class: 'card section sec-collapse', open: s.open ? true : null });
        det.appendChild(el('summary', { class: 'sec-summary' }, [
          el('span', { class: 'sec-caret', 'aria-hidden': 'true' }, [icon('chevron', 16)]),
          el('span', { class: 'sec-title', text: s.title ? D.tr(s.title) : '' }),
          groups.size ? el('span', { class: 'sec-count muted', text: ui('items', { count: groups.size }) }) : null,
          fields.some(fieldDirty) ? el('span', { class: 'cmd-dot', 'aria-hidden': 'true' }) : null
        ]));
        det.appendChild(el('div', { class: 'sec-body' }, inner));
        return det;
      }
      return el('section', { class: 'card section' }, [
        s.title ? el('h2', { class: 'card-title', text: D.tr(s.title) }) : null,
        ...inner
      ]);
    });
    const actions = mod.actions.length ? el('section', { class: 'card' }, [
      el('h2', { class: 'card-title', text: ui('actions') }),
      mod.actions.some((a) => a.readOnly) ? ownerNote() : null,
      el('div', { class: 'actions' }, mod.actions.map((a) => el('button', { type: 'button', class: `btn ${a.danger ? 'btn-danger-outline' : 'btn-secondary'}`, disabled: a.readOnly, title: a.readOnly ? ui('ownerOnly') : null, onclick: () => runAction(mod, a) }, [D.tr(a.label)])))
    ]) : null;
    return el('div', {}, [
      header(D.modTitle(name), mod.toggle && !enabled ? ui('moduleOff') : null, headToggle),
      ...sections,
      actions
    ]);
  }

  /* ================= Command Center (commands-manager) ================= */

  const CC_ICONS = { core: 'home', admin: 'flag', protection: 'shield', logs: 'list', tickets: 'ticket', welcome: 'userPlus', economy: 'coins', levels: 'chart', giveaways: 'gift', fun: 'dice', community: 'users', music: 'music', backup: 'archive' };
  const cc = { query: '', filter: 'all', cat: null, cmd: null };
  const ccStore = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }
  };
  const ccFavs = () => ccStore.get('dash.cc.favs', []);
  const ccIsFav = (n) => ccFavs().includes(n);
  const ccToggleFav = (n) => { const f = ccFavs(); ccStore.set('dash.cc.favs', f.includes(n) ? f.filter((x) => x !== n) : [...f, n]); D.renderMain(); };

  /** Enabled master switch of a command (3-segment *.enabled path). */
  const ccEnabledField = (cmd) => cmd.fields.find((f) => f.type === 'boolean' && f.path.split('.').length === 3 && f.path.endsWith('.enabled'));
  const ccEnabled = (cmd) => { const f = ccEnabledField(cmd); if (!f) return true; const v = D.current(f.path); return v === undefined || v === null ? !!f.default : !!v; };
  const ccSubFields = (cmd) => cmd.fields.filter((f) => f.type === 'boolean' && f.path.split('.').length === 4);
  /** True when any field differs from its schema default (saved or pending). */
  const ccEdited = (cmd) => cmd.fields.some((f) => { const v = D.current(f.path); const cur = v === undefined ? f.default : v; return JSON.stringify(cur) !== JSON.stringify(f.default); });
  const ccName = (cmd) => { const f = ccEnabledField(cmd) || cmd.fields[0]; return f ? D.tr(f.label) : `/${cmd.name}`; };
  const ccDesc = (cmd) => { const f = ccEnabledField(cmd); return f && f.help ? D.tr(f.help) : ''; };

  /** Parses the commands-manager + admin-commands schemas into categories/commands. */
  function ccData() {
    const mods = D.S.schema.modules || [];
    const mod = mods.find((m) => m.name === 'commands-manager');
    if (!mod) return null;
    const roles = mods.find((m) => m.name === 'admin-commands');
    const roleFields = new Map();
    if (roles) for (const s of roles.sections) for (const f of s.fields) {
      const m = /^adminCommands\.([\w-]+)\.role$/.exec(f.path);
      if (m) roleFields.set(m[1], f);
    }
    const cats = [];
    for (const s of mod.sections) {
      if (s.id === 'overview') continue;
      const groups = new Map();
      for (const f of s.fields) {
        if (!f.group) continue;
        if (!groups.has(f.group)) groups.set(f.group, []);
        groups.get(f.group).push(f);
      }
      cats.push({
        id: s.id, title: s.title, desc: s.description,
        cmds: [...groups.entries()].map(([name, fields]) => {
          const rf = roleFields.get(name);
          return { name, cat: s.id, fields: rf ? [...fields, { ...rf, group: name }] : fields };
        })
      });
    }
    return { overview: mod.sections.find((s) => s.id === 'overview'), cats, actions: mod.actions || [] };
  }

  const ccAllCmds = (data) => data.cats.flatMap((c) => c.cmds);

  const ccCatTitle = (catId) => { const c = (cc._data?.cats || []).find((x) => x.id === catId); return c ? D.tr(c.title) : ''; };

  function ccCard(cmd) {
    const on = ccEnabled(cmd);
    const fav = ccIsFav(cmd.name);
    const edited = ccEdited(cmd);
    const en = ccEnabledField(cmd);
    return el('div', { class: 'card cc-card', role: 'button', tabindex: '0', onclick: () => { cc.cmd = cmd.name; cc.cat = cmd.cat; D.renderMain(); }, onkeydown: (e) => { if (e.key === 'Enter') { cc.cmd = cmd.name; cc.cat = cmd.cat; D.renderMain(); } } }, [
      el('div', { class: 'cc-card-top' }, [
        el('code', { class: 'cmd-name', text: `/${cmd.name}` }),
        el('span', { class: `pill ${on ? 'pill-on' : 'pill-off'}`, text: ui(on ? 'enabled' : 'disabled') }),
        fav ? el('span', { class: 'cc-fav', title: ui('cc.fav') }, [icon('star', 14)]) : null,
        edited ? el('span', { class: 'cmd-dot', title: ui('cc.edited') }) : null
      ]),
      el('p', { class: 'cc-card-desc muted', text: ccDesc(cmd) || '—' }),
      el('div', { class: 'cc-card-bottom' }, [
        el('span', { class: 'muted small', text: ccCatTitle(cmd.cat) }),
        en ? el('span', { onclick: (e) => e.stopPropagation() }, [D.toggle(on, (v) => { D.setValue(en.path, v); D.renderMain(); }, ui('enableModule', { module: `/${cmd.name}` }))]) : null
      ])
    ]);
  }

  function ccGrid(cmds) {
    if (!cmds.length) return el('div', { class: 'card empty' }, [el('p', { class: 'muted', text: ui('cc.empty') })]);
    return el('div', { class: 'cc-grid' }, cmds.map(ccCard));
  }

  function ccDetail(cmd) {
    const data = cc._data || ccData();
    const cat = data.cats.find((c) => c.id === cmd.cat);
    const en = ccEnabledField(cmd);
    const general = cmd.fields.filter((f) => !ccSubFields(cmd).includes(f));
    const subs = ccSubFields(cmd);
    const back = el('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { cc.cmd = null; D.renderMain(); } }, [icon('back', 16), ui('cc.back')]);
    const favBtn = el('button', { type: 'button', class: `btn ${ccIsFav(cmd.name) ? 'btn-primary' : 'btn-secondary'}`, onclick: () => ccToggleFav(cmd.name) }, [icon('star', 16), ui(ccIsFav(cmd.name) ? 'cc.unfav' : 'cc.fav')]);
    const resetBtn = el('button', { type: 'button', class: 'btn btn-secondary', onclick: () => {
      for (const f of cmd.fields) D.setValue(f.path, f.default === undefined ? null : f.default);
      D.renderMain();
    } }, [ui('cc.reset')]);
    const cards = [
      el('section', { class: 'card' }, [
        el('h2', { class: 'card-title', text: ui('cc.settings') }),
        el('div', { class: 'fields' }, general.map((f) => fieldRow(f, { toggle: null })))
      ])
    ];
    if (subs.length) cards.push(el('section', { class: 'card' }, [
      el('h2', { class: 'card-title', text: ui('cc.subcommands') }),
      el('div', { class: 'fields' }, subs.map((f) => fieldRow(f, { toggle: null })))
    ]));
    return el('div', {}, [
      el('div', { class: 'page-header' }, [
        el('div', { class: 'row' }, [back, el('code', { class: 'cmd-name cmd-name-lg', text: `/${cmd.name}` }), el('span', { class: 'chip', text: D.tr(cat.title) })]),
        el('div', { class: 'row' }, [favBtn, resetBtn])
      ]),
      el('p', { class: 'muted cc-desc', text: ccDesc(cmd) }),
      ...cards
    ]);
  }

  function commandCenter() {
    const data = ccData();
    if (!data) return modulePage('commands-manager');
    cc._data = data;
    const all = ccAllCmds(data);
    const enabledCount = all.filter(ccEnabled).length;
    const favs = ccFavs();
    const q = cc.query.trim().toLowerCase();
    const match = (cmd) => {
      if (cc.cat && cmd.cat !== cc.cat) return false;
      if (cc.filter === 'favs' && !favs.includes(cmd.name)) return false;
      if (cc.filter === 'on' && !ccEnabled(cmd)) return false;
      if (cc.filter === 'off' && ccEnabled(cmd)) return false;
      if (cc.filter === 'edited' && !ccEdited(cmd)) return false;
      if (!q) return true;
      const hay = `/${cmd.name} ${ccName(cmd)} ${ccDesc(cmd)} ${D.tr(data.cats.find((c) => c.id === cmd.cat).title)}`.toLowerCase();
      return hay.includes(q);
    };

    // Detail view for one command.
    if (cc.cmd) {
      const cmd = all.find((c) => c.name === cc.cmd);
      if (cmd) return el('div', {}, [
        ccOverviewCard(data),
        ccDetail(cmd)
      ]);
      cc.cmd = null;
    }

    // Stats + search + filters.
    const stats = el('div', { class: 'stats cc-stats' }, [
      stat(ui('cc.total'), all.length, 'list'),
      stat(ui('cc.on'), enabledCount, 'check'),
      stat(ui('cc.off'), all.length - enabledCount, 'x'),
      stat(ui('cc.cats'), data.cats.length, 'grid')
    ]);
    const search = el('input', { class: 'input cc-search', type: 'search', placeholder: ui('cc.search'), value: cc.query, oninput: (e) => {
      cc.query = e.target.value;
      const pos = e.target.selectionStart;
      D.renderMain();
      const inp = document.querySelector('.cc-search');
      if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch { /* type=search */ } }
    } });
    const chips = el('div', { class: 'chips cc-filters' }, [['all', ui('cc.filterAll')], ['on', ui('enabled')], ['off', ui('disabled')], ['favs', ui('cc.filterFavs')], ['edited', ui('cc.filterEdited')]].map(([id, label]) =>
      el('button', { type: 'button', class: `chip cc-chip${cc.filter === id ? ' cc-chip-on' : ''}`, onclick: () => { cc.filter = id; D.renderMain(); } }, [label])));

    // Category sidebar.
    const navItem = (id, label, iconName, count, active, onPick) => el('button', { type: 'button', class: `nav-item cc-nav-item${active ? ' active' : ''}`, onclick: onPick || (() => { cc.cat = id; cc.filter = 'all'; cc.query = ''; D.renderMain(); }) }, [
      el('span', { class: 'nav-link' }, [icon(iconName, 16), el('span', { text: label })]),
      el('span', { class: 'sec-count', text: String(count) })
    ]);
    const side = el('aside', { class: 'card cc-side' }, [
      navItem(null, ui('cc.all'), 'grid', all.length, !cc.cat && cc.filter === 'all' && !q),
      navItem('favs', ui('cc.favs'), 'star', favs.length, cc.filter === 'favs', () => { cc.filter = 'favs'; cc.cat = null; D.renderMain(); }),
      ...data.cats.map((c) => navItem(c.id, D.tr(c.title), CC_ICONS[c.id] || 'sliders', c.cmds.length, cc.cat === c.id && cc.filter === 'all'))
    ]);

    // Content: filtered commands, grouped by category unless searching.
    let body;
    if (q || cc.filter !== 'all') {
      const cmds = all.filter(match);
      body = el('div', {}, [el('p', { class: 'muted small', text: ui('cc.results', { count: cmds.length }) }), ccGrid(cmds)]);
    } else if (cc.cat) {
      const c = data.cats.find((x) => x.id === cc.cat);
      body = el('div', {}, [
        el('div', { class: 'page-header' }, [el('h2', { class: 'page-title', text: D.tr(c.title) }), el('p', { class: 'muted', text: D.tr(c.desc) || '' })]),
        ccGrid(c.cmds)
      ]);
    } else {
      body = el('div', {}, data.cats.map((c) => el('div', {}, [
        el('div', { class: 'page-header cc-cat-head' }, [
          el('h2', { class: 'page-title' }, [icon(CC_ICONS[c.id] || 'sliders', 20), el('span', { text: ` ${D.tr(c.title)}` })]),
          el('span', { class: 'sec-count', text: `${c.cmds.filter(ccEnabled).length}/${c.cmds.length}` })
        ]),
        ccGrid(c.cmds)
      ])));
    }

    return el('div', {}, [
      header(D.modTitle('commands-manager'), null, null),
      stats,
      el('div', { class: 'row cc-toolbar' }, [search, chips]),
      el('div', { class: 'cc-layout' }, [side, el('div', { class: 'cc-main' }, [body])]),
      ccActionsRow(data)
    ]);
  }

  /** Compact overview card: global toggles, shown on the command center. */
  function ccOverviewCard(data) {
    if (!data.overview) return null;
    return el('section', { class: 'card cc-global' }, [
      el('h2', { class: 'card-title', text: D.tr(data.overview.title) }),
      data.overview.description ? el('p', { class: 'muted section-desc', text: D.tr(data.overview.description) }) : null,
      el('div', { class: 'fields' }, data.overview.fields.map((f) => fieldRow(f, { toggle: null })))
    ]);
  }

  function ccActionsRow(data) {
    if (!data.actions.length) return null;
    return el('section', { class: 'card' }, [
      el('h2', { class: 'card-title', text: ui('actions') }),
      el('div', { class: 'actions' }, data.actions.map((a) => el('button', { type: 'button', class: `btn ${a.danger ? 'btn-danger-outline' : 'btn-secondary'}`, disabled: a.readOnly, title: a.readOnly ? ui('ownerOnly') : null, onclick: () => runAction({ name: 'commands-manager' }, a) }, [D.tr(a.label)])))
    ]);
  }

  /** Content of the main column for the current route and loading state. */
  function current() {
    const S = D.S;
    if (S.loading) return el('div', { class: 'state', role: 'status' }, [el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { text: ui('loading') })]);
    if (S.failed) {
      return el('div', { class: 'card empty' }, [
        el('p', { class: 'notice notice-error' }, [icon('alert', 16), el('span', { text: ui(S.failed === 'forbidden' ? 'forbidden' : 'loadFailed') })]),
        el('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { S.guildId = null; D.go(`#/g/${window.location.hash.split('/')[2] || ''}`); } }, [ui('retry')])
      ]);
    }
    if (S.module === 'commands-manager') return commandCenter();
    return S.module ? modulePage(S.module) : overview();
  }

  D.pages = { loginScreen, picker, current };
})();
