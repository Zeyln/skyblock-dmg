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
 * options: [{ value, label, rich?, node?, group?, cls?, prefix?, prefixCls?, note?, suffix?, disabled?, search? }]
 *   label is plain text (used for search, type-ahead and the text box); rich is optional parsed §
 *   formatting (see mctext.js) and node() an optional custom display (e.g. star icons).
 * value: currently selected value ('' = none)
 * onSelect(value): called with the chosen option's value
 * opts: { placeholder, searchable, disabled, ariaLabel, className, display(option) -> Node | string }
 *   className is added to both the control and its open list (e.g. 'mc' for the Minecraft font).
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

  const focusEl = () => input || trigger;
  const setExpanded = (v) => focusEl().setAttribute('aria-expanded', String(v));

  function render() {
    const list = pop.querySelector('.combo-list');
    list.replaceChildren();
    const shown = filtered.slice(0, MAX_RENDERED);
    let group = null;
    shown.forEach((o, i) => {
      if (o.group && o.group !== group) {
        group = o.group;
        list.append(h('div', { class: 'combo-group', role: 'presentation' }, group));
      }
      list.append(h('div', {
        id: `${id}-opt-${i}`, role: 'option', class: `combo-opt${i === active ? ' is-active' : ''}${String(o.value) === String(value ?? '') ? ' is-selected' : ''}${o.disabled ? ' is-disabled' : ''}`,
        'aria-selected': String(String(o.value) === String(value ?? '')),
        onmousedown: (e) => { e.preventDefault(); if (!o.disabled) choose(o); },
        onmousemove: () => { if (active !== i) { active = i; paintActive(); } },
      }, o.prefix ? h('span', { class: `combo-prefix ${o.prefixCls || ''}` }, o.prefix) : '',
      h('span', { class: `combo-opt-label ${o.cls || ''}` },
        o.node ? o.node() : o.rich ? renderFormatted(o.rich, input?.value) : highlight(plainLabel(o), input?.value)),
      o.suffix ? h('span', { class: 'combo-suffix' }, o.suffix) : '',
      o.note ? h('span', { class: 'combo-note' }, o.note) : ''));
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
    const el = pop.querySelector(`#${id}-opt-${active}`);
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
      pop.style.width = `${pop.offsetWidth}px`;
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
  }

  function open() {
    if (pop) return;
    if (openCombo) openCombo.close();
    openCombo = { close };
    filtered = options;
    active = Math.max(0, filtered.findIndex((o) => String(o.value) === String(value ?? '')));
    // mousedown inside the list (incl. its scrollbar) must not blur the trigger and close the list.
    pop = h('div', { class: `combo-pop glass${opts.className ? ` ${opts.className}` : ''}`, role: 'listbox', id: `${id}-list`, onmousedown: (e) => e.preventDefault() },
      h('div', { class: 'combo-list' }));
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
    if (!root.contains(e.target) && !pop?.contains(e.target)) close();
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
    filtered = q ? options.filter((o) => `${plainLabel(o)} ${o.search || ''}`.toLowerCase().includes(q)) : options;
    active = filtered.length ? 0 : -1;
    render();
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

  function onKey(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!pop) open(); else move(e.key === 'ArrowDown' ? 1 : -1);
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
