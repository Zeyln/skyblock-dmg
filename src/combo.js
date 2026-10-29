// Themed dropdown that replaces <select> and <input list>.
// The open list is rendered into document.body with fixed positioning so the panels
// (clipped to their pixel-edge shape) can't cover or clip it.
import { h } from './dom.js';
import { renderFormatted } from './mctext.js';

const SEARCH_THRESHOLD = 12; // lists longer than this get a search box
const MAX_RENDERED = 150; // keep huge filtered lists fast
const MAX_HEIGHT = 320; // tallest the open list gets
const MIN_HEIGHT = 200; // less room than this on both sides: scroll the field into view first
const EDGE = 12; // gap kept between the open list and the window edges
const GAP = 6; // gap between the field and its list
const MAX_WIDTH = 440; // widest the open list grows to fit long names
// Fixed bars that cover the top of the page (the header; on narrow screens also the damage
// strip under it). An open list must not reach underneath them.
const TOP_BARS = '.topbar, .hero-panel';
// Lowest bottom edge of a top bar that sits above the field (horizontally overlapping it).
function topEdge(r) {
  let top = 0;
  for (const el of document.querySelectorAll(TOP_BARS)) {
    const b = el.getBoundingClientRect();
    if (b.height && b.left < r.right && b.right > r.left && b.top < window.innerHeight / 2) top = Math.max(top, b.bottom);
  }
  return top;
}

let openCombo = null; // only one list open at a time
let uid = 0;

/**
 * options: [{ value, label, rich?, node?, group?, cls?, prefix?, prefixCls?, note?, suffix?, disabled?, search?, wide? }]
 *   label is plain text (used for search, type-ahead and the text box); rich is optional parsed §
 *   formatting (see mctext.js) and node() an optional custom display (e.g. star icons).
 * value: currently selected value ('' = none)
 * onSelect(value): called with the chosen option's value
 * opts: { placeholder, searchable, disabled, ariaLabel, className, columns, submenus, display(option) -> Node | string }
 *   className is added to both the control and its open list (e.g. 'mc' for the Minecraft font).
 *   columns lays the open list out as a grid (wide options take a whole row); the arrow keys then
 *   move up/down between rows and left/right within a row.
 *   submenus collapses grouped options: until something is typed, the list shows the ungrouped
 *   options and one row per group; hovering/clicking a group (or Right/Enter on it) opens its
 *   options in a second list beside the first (Left/Esc goes back). Typing searches everything.
 */
export function combo(options, value, onSelect, opts = {}) {
  const id = `combo-${++uid}`;
  const searchable = opts.searchable ?? options.length > SEARCH_THRESHOLD;
  const find = (v) => options.find((o) => String(o.value) === String(v ?? ''));
  let current = find(value);
  const root = h('div', { class: `combo${opts.disabled ? ' is-disabled' : ''}${searchable ? ' is-search' : ''}${opts.className ? ` ${opts.className}` : ''}` });

  const labelNode = (o) => (opts.display ? opts.display(o) : optionLabel(o));
  let trigger;
  let input;
  // Parts of the closed control that show the current choice; repainted after every pick so
  // the control is right even when the caller doesn't re-render.
  let paintTrigger;
  if (searchable) {
    input = h('input', {
      type: 'text', placeholder: opts.placeholder || 'Search…', disabled: opts.disabled, role: 'combobox',
      'aria-expanded': 'false', 'aria-controls': `${id}-list`, 'aria-autocomplete': 'list',
      'aria-label': opts.ariaLabel || opts.placeholder || 'Search',
    });
    const prefixEl = h('span', {});
    // A text box can't show mixed colours, so formatted names get a styled overlay while closed.
    const richEl = h('span', { 'aria-hidden': 'true' });
    const suffixEl = h('span', { class: 'combo-suffix' });
    trigger = h('div', { class: 'combo-field' },
      prefixEl, h('span', { class: 'combo-input-wrap' }, input, richEl), suffixEl,
      h('span', { class: 'combo-caret', 'aria-hidden': 'true' }));
    paintTrigger = () => {
      input.className = `combo-input ${current?.cls || ''}`;
      input.value = current ? plainLabel(current) : '';
      prefixEl.className = `combo-prefix ${current?.prefixCls || ''}`;
      prefixEl.replaceChildren(current?.prefix || '');
      prefixEl.hidden = !current?.prefix;
      richEl.className = `combo-rich ${current?.cls || ''}`;
      richEl.replaceChildren(...(current?.rich ? renderFormatted(current.rich) : []));
      trigger.classList.toggle('has-rich', !!current?.rich);
      suffixEl.replaceChildren(current?.suffix || '');
      suffixEl.hidden = !current?.suffix;
    };
  } else {
    const valueEl = h('span', { class: 'combo-value' });
    trigger = h('button', {
      type: 'button', class: 'combo-btn', disabled: opts.disabled, role: 'combobox',
      'aria-expanded': 'false', 'aria-controls': `${id}-list`, 'aria-label': opts.ariaLabel || null,
    }, valueEl, h('span', { class: 'combo-caret', 'aria-hidden': 'true' }));
    paintTrigger = () => valueEl.replaceChildren(current ? labelNode(current)
      : h('span', { class: 'combo-placeholder' }, opts.placeholder || 'Select…'));
  }
  paintTrigger();
  root.append(trigger);
  if (opts.disabled) return root;

  let pop = null;
  let dropUp = null; // open list placed above the field (decided when it opens)
  let filtered = options;
  let active = -1;
  let typeahead = '';
  let typeaheadTimer = 0;
  // Submenus: the typed search, and the open group's list ("flyout") beside the main list.
  let query = '';
  let fly = null;
  let flyRow = -1;        // index (in filtered) of the group row whose flyout is open
  let flyActive = -1;     // highlighted option in the flyout
  let inFly = false;      // keyboard focus is in the flyout
  let hoverTimer = 0;

  const submenuMode = () => opts.submenus && !query;
  function collapsedRows() {
    const rows = [];
    const groups = new Map();
    for (const o of options) {
      if (!o.group) { rows.push(o); continue; }
      let g = groups.get(o.group);
      if (!g) {
        g = { value: `group:${o.group}`, label: o.group, isGroup: true, items: [] };
        groups.set(o.group, g);
        rows.push(g);
      }
      g.items.push(o);
    }
    return rows;
  }
  const isCurrent = (o) => String(o.value) === String(value ?? '');
  // Row to highlight on opening: the current option, or the group that holds it.
  const rowActive = () => Math.max(0, filtered.findIndex((r) => (r.isGroup ? r.items.some(isCurrent) : isCurrent(r))));

  const focusEl = () => input || trigger;
  const setExpanded = (v) => focusEl().setAttribute('aria-expanded', String(v));

  // One option row. elId: its element id; onHover: called when the mouse moves over it.
  function optionEl(o, elId, onHover) {
    return h('div', {
      id: elId, role: 'option', class: `combo-opt${o.wide ? ' is-wide' : ''}${isCurrent(o) ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}`,
      'aria-selected': String(isCurrent(o)),
      onmousedown: (e) => { e.preventDefault(); if (!o.disabled) choose(o); },
      onmousemove: onHover,
    }, o.prefix ? h('span', { class: `combo-prefix ${o.prefixCls || ''}` }, o.prefix) : '',
    h('span', { class: `combo-opt-label ${o.cls || ''}` },
      o.node ? o.node() : o.rich ? renderFormatted(o.rich, input?.value) : highlight(plainLabel(o), input?.value)),
    o.suffix ? h('span', { class: 'combo-suffix' }, o.suffix) : '',
    o.note ? h('span', { class: 'combo-note' }, o.note) : '');
  }

  function render() {
    const list = pop.querySelector('.combo-list');
    list.replaceChildren();
    const shown = filtered.slice(0, MAX_RENDERED);
    let group = null;
    shown.forEach((o, i) => {
      const hover = () => {
        if (active !== i || inFly) { active = i; inFly = false; paintActive(); }
        // With a flyout open, switch only after a short pause, so moving the mouse diagonally
        // towards the flyout across other rows doesn't swap it.
        clearTimeout(hoverTimer);
        const change = o.isGroup ? flyRow !== i : !!fly;
        if (!change) return;
        const act = () => { if (pop && active === i) { if (o.isGroup) openFly(i, false); else { closeFly(); paintActive(); } } };
        if (fly) hoverTimer = setTimeout(act, 150); else act();
      };
      if (o.isGroup) {
        // Collapsed group: its name, how many options it holds and an arrow; opens the flyout.
        list.append(h('div', {
          id: `${id}-opt-${i}`, role: 'option', 'aria-haspopup': 'listbox',
          class: `combo-opt combo-cat${o.items.some(isCurrent) ? ' is-selected' : ''}`,
          onmousedown: (e) => { e.preventDefault(); openFly(i, false); },
          onmousemove: hover,
        }, h('span', { class: 'combo-opt-label' }, o.label),
        h('span', { class: 'combo-note' }, String(o.items.length)),
        h('span', { class: 'chev', 'aria-hidden': 'true' })));
        return;
      }
      if (o.group && o.group !== group) {
        group = o.group;
        list.append(h('div', { class: 'combo-group', role: 'presentation' }, group));
      }
      list.append(optionEl(o, `${id}-opt-${i}`, hover));
    });
    if (!shown.length) list.append(h('div', { class: 'combo-empty' }, 'No matches'));
    if (filtered.length > MAX_RENDERED) {
      list.append(h('div', { class: 'combo-empty' }, `${filtered.length - MAX_RENDERED} more — keep typing to narrow down`));
    }
    paintActive();
  }

  function paintActive() {
    if (!pop) return;
    pop.querySelectorAll('.combo-opt').forEach((el, i) => el.classList.toggle('is-active', i === active));
    fly?.querySelectorAll('.combo-opt').forEach((el, j) => el.classList.toggle('is-active', j === flyActive));
    const el = inFly ? fly?.querySelector(`#${id}-fly-${flyActive}`) : pop.querySelector(`#${id}-opt-${active}`);
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
      focusEl().setAttribute('aria-activedescendant', el.id);
    } else focusEl().removeAttribute('aria-activedescendant');
  }

  // Free space above / below the trigger, keeping EDGE px clear of the window edges and of the
  // fixed bars at the top (see topEdge).
  function room() {
    const r = trigger.getBoundingClientRect();
    const top = topEdge(r);
    return { r, top, above: r.top - top - GAP - EDGE, below: window.innerHeight - r.bottom - GAP - EDGE };
  }

  // Open the flyout of the group row at index i (focus: move keyboard focus into it).
  function openFly(i, focus) {
    const row = filtered[i];
    if (!row?.isGroup) return;
    if (flyRow !== i) {
      closeFly();
      flyRow = i;
      fly = h('div', { class: `combo-pop combo-fly glass${opts.className ? ` ${opts.className}` : ''}`, role: 'listbox', id: `${id}-fly`, 'aria-label': row.label, onmousedown: (e) => e.preventDefault() },
        h('div', { class: 'combo-list' }, row.items.map((o, j) => optionEl(o, `${id}-fly-${j}`, () => {
          clearTimeout(hoverTimer); // reached the flyout: keep it, and keep its group highlighted
          if (flyActive !== j || !inFly || active !== i) { flyActive = j; inFly = true; active = i; paintActive(); }
        }))));
      document.body.append(fly);
      flyActive = -1;
      positionFly();
    }
    inFly = focus;
    if (focus) flyActive = Math.max(0, row.items.findIndex(isCurrent));
    paintActive();
  }
  function closeFly() {
    clearTimeout(hoverTimer);
    fly?.remove();
    fly = null;
    flyRow = -1;
    flyActive = -1;
    inFly = false;
  }
  // Beside the main list (right, or left if there's no room), level with its group row.
  function positionFly() {
    if (!fly || !pop) return;
    const p = pop.getBoundingClientRect();
    const row = pop.querySelector(`#${id}-opt-${flyRow}`)?.getBoundingClientRect() || p;
    const top = topEdge(p) + EDGE;
    fly.style.maxWidth = `${Math.min(MAX_WIDTH, window.innerWidth - EDGE * 2)}px`;
    fly.style.maxHeight = `${Math.max(0, Math.min(MAX_HEIGHT * 1.5, window.innerHeight - top - EDGE))}px`;
    let left = p.right + 4;
    if (left + fly.offsetWidth > window.innerWidth - EDGE) left = Math.max(EDGE, p.left - 4 - fly.offsetWidth);
    fly.style.left = `${left}px`;
    fly.style.top = `${Math.max(top, Math.min(row.top - 6, window.innerHeight - EDGE - fly.offsetHeight))}px`;
  }

  // The list's full height (capped), i.e. how much room it would like.
  const wanted = () => Math.min(MAX_HEIGHT, pop.scrollHeight);

  function position() {
    if (!pop) return;
    const { r, top, above, below } = room();
    // Field scrolled under the header or off screen: close rather than float a detached list.
    if (r.bottom <= top || r.top >= window.innerHeight) { close(); return; }
    // The side and width are picked once per opening so the list doesn't jump while typing a search.
    if (dropUp === null) {
      dropUp = below < wanted() && above > below;
      // At least as wide as the field, wider (up to MAX_WIDTH) when the names need it.
      pop.style.width = '';
      pop.style.minWidth = `${Math.min(Math.max(r.width, 240), window.innerWidth - EDGE * 2)}px`;
      pop.style.maxWidth = `${Math.min(Math.max(r.width, MAX_WIDTH), window.innerWidth - EDGE * 2)}px`;
      // The content width doesn't count the space reserved for the scrollbar; add it back.
      const cs = getComputedStyle(pop);
      const scrollbar = pop.offsetWidth - pop.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      pop.style.width = `${Math.min(pop.offsetWidth + Math.max(0, scrollbar), window.innerWidth - EDGE * 2)}px`;
    }
    pop.style.left = `${Math.max(EDGE, Math.min(r.left, window.innerWidth - pop.offsetWidth - EDGE))}px`;
    pop.style.maxHeight = `${Math.max(0, Math.min(MAX_HEIGHT, dropUp ? above : below))}px`;
    if (dropUp) {
      pop.style.top = '';
      pop.style.bottom = `${window.innerHeight - r.top + GAP}px`;
    } else {
      pop.style.bottom = '';
      pop.style.top = `${r.bottom + GAP}px`;
    }
    positionFly();
  }

  function open() {
    if (pop) return;
    if (openCombo) openCombo.close();
    openCombo = { close };
    query = '';
    filtered = opts.submenus ? collapsedRows() : options;
    active = rowActive();
    // mousedown inside the list (incl. its scrollbar) must not blur the trigger and close the list.
    pop = h('div', { class: `combo-pop glass${opts.className ? ` ${opts.className}` : ''}`, role: 'listbox', id: `${id}-list`, onmousedown: (e) => e.preventDefault() },
      h('div', { class: `combo-list${opts.columns ? ' is-grid' : ''}`, style: opts.columns ? `grid-template-columns: repeat(${opts.columns}, minmax(0, 1fr))` : null }));
    document.body.append(pop);
    render();
    // Field hidden under the header, or too close to an edge for the list to fit on either side
    // (e.g. at the very bottom of the window): scroll it towards the middle first.
    const { r, top, above, below } = room();
    if (r.top < top || Math.max(above, below) < Math.min(wanted(), MIN_HEIGHT)) trigger.scrollIntoView({ block: 'center' });
    dropUp = null;
    position();
    setExpanded(true);
    root.classList.add('is-open');
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    document.addEventListener('mousedown', outside, true);
  }

  function close(restore = true) {
    if (!pop) return;
    closeFly();
    pop.remove();
    pop = null;
    if (openCombo?.close === close) openCombo = null;
    setExpanded(false);
    root.classList.remove('is-open');
    focusEl().removeAttribute('aria-activedescendant');
    window.removeEventListener('scroll', position, true);
    window.removeEventListener('resize', position);
    document.removeEventListener('mousedown', outside, true);
    if (restore && input) input.value = current ? plainLabel(current) : '';
  }

  function outside(e) {
    if (!root.contains(e.target) && !pop?.contains(e.target) && !fly?.contains(e.target)) close();
  }

  function choose(o) {
    close(false);
    const changed = String(o.value) !== String(value ?? '');
    value = o.value;
    current = o;
    paintTrigger();
    if (changed) onSelect(o.value);
  }

  function filter(text) {
    const q = text.trim().toLowerCase();
    query = q;
    closeFly();
    if (submenuMode()) { filtered = collapsedRows(); active = rowActive(); render(); return; }
    filtered = q ? options.filter((o) => `${plainLabel(o)} ${o.search || ''}`.toLowerCase().includes(q)) : options;
    active = filtered.length ? 0 : -1;
    render();
  }

  // Keyboard inside the flyout (submenus): Up/Down move, Enter picks, Left/Esc go back.
  // Returns true when it handled the key.
  function onFlyKey(e) {
    const items = filtered[flyRow].items;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      let j = flyActive;
      for (let n = 0; n < items.length; n++) { j = (j + d + items.length) % items.length; if (!items[j].disabled) break; }
      flyActive = j;
      paintActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[flyActive] && !items[flyActive].disabled) choose(items[flyActive]);
    } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closeFly();
      paintActive();
    } else if (e.key === 'Tab') {
      close();
    } else return false;
    return true;
  }

  function move(delta) {
    if (!filtered.length) return;
    let i = active;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + delta + filtered.length) % filtered.length;
      if (!filtered[i].disabled) break;
    }
    active = i;
    paintActive();
  }

  // Grid lists: the option visually above or below the active one (nearest row, then column).
  function moveRow(dir) {
    const els = [...pop.querySelectorAll('.combo-opt')];
    const cur = els[active]?.getBoundingClientRect();
    if (!cur) return move(dir);
    let best = -1;
    let bestScore = Infinity;
    els.forEach((el, i) => {
      if (filtered[i].disabled) return;
      const r = el.getBoundingClientRect();
      const gap = dir > 0 ? r.top - cur.bottom : cur.top - r.bottom;
      if (gap < -1) return;
      const score = gap * 1000 + Math.abs((r.left + r.right) / 2 - (cur.left + cur.right) / 2);
      if (score < bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) { active = best; paintActive(); }
  }

  function onKey(e) {
    if (pop && fly && inFly && onFlyKey(e)) return;
    if (pop && submenuMode() && filtered[active]?.isGroup && (e.key === 'ArrowRight' || e.key === 'Enter')) {
      e.preventDefault();
      openFly(active, true);
      return;
    }
    if (pop && fly && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFly(); paintActive(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (fly) closeFly();
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      if (!pop) open(); else if (opts.columns) moveRow(dir); else move(dir);
    } else if (opts.columns && pop && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      move(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'Home' && pop && !input) {
      e.preventDefault(); active = 0; paintActive();
    } else if (e.key === 'End' && pop && !input) {
      e.preventDefault(); active = Math.min(filtered.length, MAX_RENDERED) - 1; paintActive();
    } else if (e.key === 'Enter') {
      if (pop && filtered[active] && !filtered[active].disabled) { e.preventDefault(); choose(filtered[active]); } else if (!pop && !input) { e.preventDefault(); open(); }
    } else if (e.key === 'Escape') {
      if (pop) { e.preventDefault(); e.stopPropagation(); close(); }
    } else if (e.key === 'Tab') {
      close();
    } else if (!input && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Button lists: type letters to jump to a matching option.
      typeahead += e.key.toLowerCase();
      clearTimeout(typeaheadTimer);
      typeaheadTimer = setTimeout(() => { typeahead = ''; }, 600);
      if (!pop) open();
      const i = filtered.findIndex((o) => plainLabel(o).toLowerCase().startsWith(typeahead));
      if (i >= 0) { active = i; paintActive(); }
    }
  }

  if (input) {
    input.addEventListener('focus', () => { input.select(); open(); });
    input.addEventListener('mousedown', () => { if (document.activeElement === input && !pop) open(); });
    input.addEventListener('input', () => { if (!pop) open(); filter(input.value); });
    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', () => setTimeout(() => { if (pop && !pop.contains(document.activeElement)) close(); }, 0));
    trigger.querySelector('.combo-caret').addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (pop) close(); else input.focus();
    });
  } else {
    trigger.addEventListener('click', () => (pop ? close() : open()));
    trigger.addEventListener('keydown', onKey);
    trigger.addEventListener('blur', () => setTimeout(() => close(), 0));
  }
  return root;
}

function plainLabel(o) {
  return String(o.label ?? o.value ?? '');
}

function optionLabel(o) {
  return h('span', { class: 'combo-label' },
    o.prefix ? h('span', { class: `combo-prefix ${o.prefixCls || ''}` }, o.prefix) : '',
    h('span', { class: o.cls || '' }, o.node ? o.node() : o.rich ? renderFormatted(o.rich) : plainLabel(o)),
    o.suffix ? h('span', { class: 'combo-suffix' }, o.suffix) : '');
}

// Bold the part of the label that matches the search text.
function highlight(text, query) {
  const q = (query || '').trim();
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return [text.slice(0, i), h('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
}
