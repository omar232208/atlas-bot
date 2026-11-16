'use strict';

/*
 * DOM helpers, line icons and the generic schema field renderer.
 * User-controlled text (channel names, role names, values) is only ever set
 * through textContent / value, never innerHTML, so it cannot inject markup.
 */
(function () {
  const ICONS = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    shield: 'M12 3l8 3v6c0 4.5-3.4 8.1-8 9-4.6-.9-8-4.5-8-9V6z',
    flag: 'M5 21V4M5 4h12l-2.5 4L17 12H5',
    list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
    userPlus: 'M15 21v-1a5 5 0 0 0-10 0v1M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M16 11h6',
    check: 'M20 6L9 17l-5-5',
    ticket: 'M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4zM14 6v12',
    tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7c-1-3-5-4-5-1.5S10 7 12 7zM12 7c1-3 5-4 5-1.5S14 7 12 7z',
    chart: 'M5 20v-8M12 20V5M19 20v-5',
    archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
    coins: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v10M14.5 9.5h-4a1.5 1.5 0 0 0 0 3h3a1.5 1.5 0 0 1 0 3h-4',
    dice: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 15.5h.01M12 12h.01',
    users: 'M16 21v-1a4 4 0 0 0-8 0v1M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 21v-1a3 3 0 0 0-3-3M17 5.5a3 3 0 0 1 0 5.5M4 21v-1a3 3 0 0 1 3-3M7 5.5a3 3 0 0 0 0 5.5',
    music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
    menu: 'M4 6h16M4 12h16M4 18h16',
    x: 'M6 6l12 12M18 6L6 18',
    logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
    external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    plus: 'M12 5v14M5 12h14',
    back: 'M15 18l-6-6 6-6',
    alert: 'M12 9v4M12 16.5h.01M12 3.5l9 16H3z',
    play: 'M7 4l12 8-12 8z',
    lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    chevron: 'M9 6l6 6-6 6',
    star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
    palette: 'M12 3a9 9 0 1 0 0 18c1.4 0 2-.8 2-1.8 0-.9-.6-1.4-.6-2.2 0-.9.7-1.5 1.6-1.5H18a3.5 3.5 0 0 0 3.5-3.5C21.5 6.5 17.2 3 12 3zM7.5 11a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zM10.5 7.5a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zM15 7.5a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z',
  };

  const MODULE_ICONS = {
    antiraid: 'shield', antinuke: 'shield', automod: 'shield', verification: 'check', moderation: 'flag', logs: 'list',
    welcome: 'userPlus', tickets: 'ticket', roles: 'tag', utility: 'grid', giveaways: 'gift', levels: 'chart',
    backup: 'archive', economy: 'coins', fun: 'dice', community: 'users', music: 'music', embeds: 'palette'
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Inline SVG line icon. */
  function icon(name, size) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size || 18));
    svg.setAttribute('height', String(size || 18));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name] || ICONS.sliders);
    svg.appendChild(path);
    return svg;
  }

  /** Tiny element builder: el('div', { class: 'x', onclick }, [children]). */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked') node.checked = !!v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of [].concat(children || [])) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  /** Accessible on/off switch built on a real checkbox. */
  function toggle(checked, onChange, label) {
    const input = el('input', { type: 'checkbox', class: 'switch-input', checked, 'aria-label': label || null, onchange: (e) => onChange(e.target.checked) });
    return el('label', { class: 'switch' }, [input, el('span', { class: 'switch-track', 'aria-hidden': 'true' })]);
  }

  const DURATION_UNITS = [['d', 86400000], ['h', 3600000], ['m', 60000], ['s', 1000]];

  /** Largest unit that represents the value exactly (0 shows as minutes). */
  function splitDuration(ms) {
    if (!ms) return { amount: 0, unit: 'm' };
    for (const [unit, size] of DURATION_UNITS) if (ms % size === 0) return { amount: ms / size, unit };
    return { amount: Math.round(ms / 1000), unit: 's' };
  }

  const TEXT_TYPES = [0, 5, 15, 16];
  const VOICE_TYPES = [2, 13];
  const CATEGORY = 4;

  /** Channel options for a field, grouped under their category. */
  function channelOptions(field, channels, ui) {
    const types = field.channelTypes && field.channelTypes.length ? field.channelTypes : TEXT_TYPES;
    const allowed = channels.filter((c) => types.includes(c.type));
    const label = (c) => (c.type === CATEGORY ? c.name : VOICE_TYPES.includes(c.type) ? `${c.name} (${ui('voice')})` : `# ${c.name}`);
    const groups = new Map([[null, []]]);
    const cats = channels.filter((c) => c.type === CATEGORY);
    for (const c of allowed) {
      const key = c.type === CATEGORY ? null : c.parentId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const out = [];
    for (const c of groups.get(null)) out.push(el('option', { value: c.id, text: label(c) }));
    for (const cat of cats) {
      const list = groups.get(cat.id);
      if (!list || !list.length) continue;
      out.push(el('optgroup', { label: cat.name }, list.map((c) => el('option', { value: c.id, text: label(c) }))));
    }
    return out;
  }

  function roleOptions(roles) {
    return roles.filter((r) => !r.managed).map((r) => el('option', { value: r.id, text: `@${r.name}` }));
  }

  function nameOf(kind, id, res) {
    const list = kind === 'channels' ? res.channels : res.roles;
    const found = list.find((x) => x.id === id);
    if (!found) return id;
    return kind === 'channels' ? `# ${found.name}` : `@${found.name}`;
  }

  /** Chip list with remove buttons and an "add" control. */
  function chipEditor(items, render, onChange, adder, ui) {
    const chips = el('div', { class: 'chips' });
    const draw = () => {
      chips.textContent = '';
      if (!items.length) chips.appendChild(el('span', { class: 'chips-empty', text: ui('emptyList') }));
      items.forEach((item, i) => {
        const remove = el('button', { type: 'button', class: 'chip-remove', 'aria-label': ui('remove'), onclick: () => { items.splice(i, 1); onChange(items.slice()); draw(); } }, [icon('x', 14)]);
        chips.appendChild(el('span', { class: 'chip' }, [el('span', { class: 'chip-text', text: render(item) }), remove]));
      });
    };
    draw();
    const add = (value) => {
      if (value === '' || value === null || items.includes(value)) return;
      items.push(value);
      onChange(items.slice());
      draw();
    };
    return el('div', { class: 'multi' }, [chips, adder(add)]);
  }

  /**
   * Builds the input for one schema field.
   * @param {object} field Public schema field.
   * @param {*} value Current (pending or saved) value.
   * @param {(value: any) => void} onChange
   * @param {{ui: Function, tr: Function, res: {channels: object[], roles: object[]}, id: string}} c
   */
  function fieldInput(field, value, onChange, c) {
    const { ui, tr, res, id } = c;
    switch (field.type) {
      case 'boolean':
        return toggle(!!value, onChange, tr(field.label));
      case 'number':
        return el('input', { id, type: 'number', class: 'input input-short', value: value ?? '', min: field.min ?? null, max: field.max ?? null, step: 'any', oninput: (e) => onChange(e.target.value === '' ? null : Number(e.target.value)) });
      case 'string':
        return el('input', { id, type: 'text', class: 'input', value: value ?? '', maxlength: field.maxLength || 200, oninput: (e) => onChange(e.target.value) });
      case 'text':
        return el('textarea', { id, class: 'input textarea', rows: 4, maxlength: field.maxLength || 4000, value: value ?? '', oninput: (e) => onChange(e.target.value) });
      case 'select': {
        const opts = (field.options || []).map((o, i) => el('option', { value: String(i), text: tr(o.label) }));
        const sel = el('select', { id, class: 'input', onchange: (e) => onChange(field.options[Number(e.target.value)].value) }, opts);
        sel.value = String(Math.max(0, (field.options || []).findIndex((o) => o.value === value)));
        return sel;
      }
      case 'channel':
      case 'role': {
        const opts = field.type === 'channel' ? channelOptions(field, res.channels, ui) : roleOptions(res.roles);
        const sel = el('select', { id, class: 'input', onchange: (e) => onChange(e.target.value || null) }, [el('option', { value: '', text: ui('none') }), ...opts]);
        sel.value = value || '';
        if (value && sel.value !== value) sel.prepend(el('option', { value, text: ui('missing'), selected: true }));
        return sel;
      }
      case 'channels':
      case 'roles': {
        const kind = field.type;
        return chipEditor(Array.isArray(value) ? value.slice() : [], (v) => nameOf(kind, v, res), onChange, (add) => {
          const opts = kind === 'channels' ? channelOptions(field, res.channels, ui) : roleOptions(res.roles);
          const sel = el('select', { id, class: 'input', 'aria-label': ui('add') }, [el('option', { value: '', text: ui(kind === 'channels' ? 'addChannel' : 'addRole') }), ...opts]);
          sel.addEventListener('change', () => { add(sel.value); sel.value = ''; });
          return sel;
        }, ui);
      }
      case 'list':
        return chipEditor(Array.isArray(value) ? value.slice() : [], (v) => v, onChange, (add) => {
          const input = el('input', { id, type: 'text', class: 'input', maxlength: field.maxLength || 200, placeholder: ui('addItem') });
          const submit = () => { const v = input.value.trim(); if (v) add(v); input.value = ''; input.focus(); };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
          return el('div', { class: 'row' }, [input, el('button', { type: 'button', class: 'btn btn-secondary', onclick: submit }, [icon('plus', 16), ui('add')])]);
        }, ui);
      case 'duration': {
        const parts = splitDuration(Number(value) || 0);
        const amount = el('input', { id, type: 'number', class: 'input input-short', min: 0, step: 1, value: parts.amount });
        const unit = el('select', { class: 'input input-unit', 'aria-label': ui('unit') }, DURATION_UNITS.map(([u]) => el('option', { value: u, text: ui(`units.${u}`) })));
        unit.value = parts.unit;
        const emit = () => {
          const size = DURATION_UNITS.find(([u]) => u === unit.value)[1];
          onChange(amount.value === '' ? 0 : Math.max(0, Math.round(Number(amount.value) * size)));
        };
        amount.addEventListener('input', emit);
        unit.addEventListener('change', emit);
        return el('div', { class: 'row' }, [amount, unit]);
      }
      default:
        return el('span', { class: 'muted', text: String(value) });
    }
  }

  /** Disables every control inside a node (read-only owner-only settings). */
  function lock(node) {
    const controls = node.matches && node.matches('input, select, textarea, button') ? [node] : [];
    for (const c of controls.concat([...node.querySelectorAll('input, select, textarea, button')])) c.disabled = true;
    return node;
  }

  window.Dash = { el, icon, toggle, lock, fieldInput, splitDuration, MODULE_ICONS };
})();
