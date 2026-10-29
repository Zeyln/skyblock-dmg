import { loadItems, loadPets, loadPetLore, ARMOR_SLOTS } from './api.js';
import { h } from './dom.js';
import { combo } from './combo.js';
import './sculk.js'; // dark-theme sculk strips (sets --sculk-* CSS variables)
import './wipe-rim.js'; // feathered edge for the theme wipe (sets --wipe-rim-* CSS variables)
import { initLogo } from './logo.js';
import { parseFormatting } from './mctext.js';
import { detectSets, evaluateSets } from './data/sets.js';
import { simulate } from './sim.js';
import {
  PET_RARITIES, PET_ITEMS, petLevelRange, petNumbers, effectiveRarity, cleanLore, fillLore, rarityIdx,
} from './data/pets.js';
import {
  calculate, itemStats, isBow, roman, rarityIndex, reforgeTable, statTierCount, baseTier, recombHasEffect,
} from './calc.js';
import {
  ENCHANTS, POWERS, TUNING_PER_POINT, tuningPoints, powerMultiplier, SHARDS, MOB_TYPES, ENEMIES,
  ARMOR_REFORGES, RARITIES, GEMS, GEM_QUALITIES, SLOT_ACCEPTS, GEM_FILL_PRIORITY, gemValue,
  DUNGEON_MODES, PROGRESSION_ITEMS, maxStars, starMultiplier,
  POTATO_STATS, HOT_POTATO_MAX, FUMING_POTATO_MAX, ART_OF_WAR, PRICE_ITEMS, greedBonus,
  ENCHANT_CONFLICTS, enchantConflict, ultimatesFor, enchantFits, TARGET_FAMILIES, weaponMultipliers, assumedAccessories, WEAPON_ABILITIES,
  DAGGER_FAMILIES, daggerFamily, daggerPartner,
  QUALITY_MAX, floorLabel, isDungeonDrop, catacombsBoost, CATACOMBS_MAX_LEVEL, clampCatacombs, asDungeonItem,
  DUNGEON_CLASSES, CLASS_MAX_LEVEL, classDamageBonus, enemyDungeonMode, floorStats,
} from './data/mechanics.js';

const STATE_KEY = 'dpscalc.state.v1';
const STAT_LABELS = {
  DAMAGE: 'Damage', STRENGTH: 'Strength', CRITICAL_DAMAGE: 'Crit Damage', CRITICAL_CHANCE: 'Crit Chance',
  HEALTH: 'Health', DEFENSE: 'Defense', WALK_SPEED: 'Speed', INTELLIGENCE: 'Intelligence',
  ATTACK_SPEED: 'Attack Speed', FEROCITY: 'Ferocity',
};
const EQUIP_SLOTS = [
  { key: 'NECKLACE', name: 'Necklace', cats: ['NECKLACE'] },
  { key: 'CLOAK', name: 'Cloak', cats: ['CLOAK'] },
  { key: 'BELT', name: 'Belt', cats: ['BELT'] },
  { key: 'WRIST', name: 'Gloves / Bracelet', cats: ['GLOVES', 'BRACELET'] },
];

const piece = (extra = {}) => ({ id: '', reforge: 'none', recomb: false, stars: 0, gems: [], hpb: 0, fuming: 0, ...extra });
const defaultState = () => ({
  weapon: piece({ enchants: {} }),
  armor: Object.fromEntries(ARMOR_SLOTS.map((s) => [s, piece()])),
  equipment: Object.fromEntries(EQUIP_SLOTS.map((s) => [s.key, piece()])),
  magicalPower: 0,
  power: 'none',
  tuning: {},
  accessoryInputs: { time: 'day' },
  // Simulation screen options.
  sim: { mode: 'kill', duration: 30, enemyHpPct: 100, playerHpPct: 100, godMode: true, speed: 1 },
  shards: {},
  pet: { id: '', rarity: 'LEGENDARY', level: 100, item: '' },
  petExtras: { bankCoins: 0, magicFind: 0, goldDigits: 0 },
  combatLevel: 0,
  catacombsLevel: 0,
  dungeonMode: 'none',
  dungeonClass: { id: '', level: 50, solo: false },
  setInputs: {},
  godPotion: false,
  mayor: '', // '' | 'derpy' | 'jerry'
  bonuses: [
    { label: 'Pet effects not modeled' }, { label: 'Accessories (flat stats)' }, { label: 'Potions / buffs' }, { label: 'Other' },
  ],
  target: {
    enemy: '', mobs: [], families: [], boss: false, hpPct: 100, maxHp: 0, defense: 0,
    attackedYou: false, isolated: false, distance: 'normal',
  },
  player: { maxHp: 0, firstHit: true, fullHealth: true, lowHealth: false, recentlyHit: false },
});

let state = loadState();
let items = null;
let pets = null; // NEU pet data, or { error } when it could not be loaded
const petLore = new Map(); // "PET;rarityIdx" -> raw lore lines
const byId = new Map();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    // Free-form "extra stats" were replaced by anvil controls; drop them so they don't count invisibly.
    for (const p of [saved?.weapon, ...Object.values(saved?.armor || {}), ...Object.values(saved?.equipment || {})]) {
      if (p) delete p.extra;
    }
    if (saved && 'inDungeon' in saved) {
      saved.dungeonMode = saved.inDungeon ? 'catacombs' : 'none';
      delete saved.inDungeon;
    }
    if (saved) {
      const merged = deepMerge(defaultState(), saved);
      // Presets saved before creature families existed: take them from the preset.
      const preset = ENEMIES.find((e) => e.name === merged.target.enemy);
      if (preset && !saved.target?.families) merged.target.families = [...preset.families];
      return merged;
    }
  } catch { /* ignore */ }
  return defaultState();
}
function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
function deepMerge(base, over) {
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') deepMerge(base[k], v);
    else base[k] = v;
  }
  return base;
}

// ---------- tiny DOM helpers ----------
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
// Short number for dropdown notes: 1,200,000,000 -> "1.2B".
const fmtShort = (n) => Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function getPath(path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), state);
}
function setPath(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const obj = keys.reduce((o, k) => (o[k] ??= {}), state);
  obj[last] = value;
}

function numField(label, path, opts = {}) {
  return h('label', { class: 'field' }, label,
    h('input', { type: 'number', step: opts.step ?? 'any', min: opts.min, max: opts.max, value: getPath(path) ?? '',
      placeholder: opts.placeholder ?? '0', 'data-path': path, 'data-num': '1', 'data-rerender': opts.rerender ? '1' : null }));
}
// On/off setting shown as a toggle chip (place chips in an h('div', { class: 'chips' }) row).
function chipField(label, path, opts = {}) {
  return h('label', { title: opts.title || null },
    h('input', { type: 'checkbox', checked: !!getPath(path), 'data-path': path, 'data-rerender': opts.rerender ? '1' : null }), label);
}
// Option list entries are [value, label] tuples or full combo option objects.
const toOption = (o) => (Array.isArray(o) ? { value: o[0], label: o[1] } : o);

// Themed dropdown bound to a state path. opts: num, rerender, disabled, searchable, placeholder.
function selectField(label, path, options, opts = {}) {
  const list = options.map(toOption);
  // Unset numeric fields (e.g. enchant levels) show their "0" option ("—") rather than a placeholder.
  const raw = getPath(path);
  const value = raw ?? (opts.num && list.some((o) => String(o.value) === '0') ? 0 : '');
  const sel = combo(list, value, (v) => {
    setPath(path, opts.num ? (v === '' ? undefined : Number(v)) : v);
    if (opts.rerender) rerenderForm(); else update();
  }, { disabled: opts.disabled, searchable: opts.searchable, placeholder: opts.placeholder, className: opts.className,
    ariaLabel: typeof label === 'string' ? label : undefined });
  return label ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), sel) : sel;
}
// Dropdown not bound to state (actions, custom handlers).
function actionSelect(label, options, value, onSelect, opts = {}) {
  const sel = combo(options.map(toOption), value, onSelect, opts);
  return label ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), sel) : sel;
}
// Greyed-out placeholder dropdown with an explanation.
const disabledSelect = (label, text) => actionSelect(label, [['', text]], '', () => {}, { disabled: true });
function levelOptions(max) {
  return [[0, '—'], ...Array.from({ length: max }, (_, i) => [i + 1, roman(i + 1)])];
}

// ---------- confirmation modal ----------
// Native <dialog> gives focus trapping, Esc to close and a backdrop; resolves true on confirm.
// extra: optional node shown under the message (e.g. a "don't ask again" checkbox the caller reads).
function confirmModal({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, extra = null }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(ok);
    };
    const dialog = h('dialog', { class: 'modal glass', 'aria-labelledby': 'modal-title' },
      h('form', { onsubmit: (e) => { e.preventDefault(); finish(e.submitter?.value === 'confirm'); } },
        h('h2', { id: 'modal-title' }, title),
        h('p', {}, message),
        extra || '',
        h('div', { class: 'modal-actions' },
          h('button', { value: 'cancel', autofocus: true }, cancelLabel),
          h('button', { value: 'confirm', class: danger ? 'danger' : 'primary' }, confirmLabel))));
    // Esc fires "cancel" on the dialog.
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    // Clicking the backdrop (outside the dialog box) cancels; the dialog's own padding doesn't.
    dialog.addEventListener('click', (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

// ---------- collapsible panels ----------
// Open/closed state per panel survives re-renders and reloads (per-viewer convenience).
const UI_KEY = 'dpscalc.ui.v1';
const uiOpen = (() => {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; }
})();
function rememberOpen(key, open) {
  uiOpen[key] = open;
  try { localStorage.setItem(UI_KEY, JSON.stringify(uiOpen)); } catch { /* ignore */ }
}
// Summaries and counts given as functions are refreshed on every update() without rebuilding
// the form, so typing in number fields keeps focus.
const liveUpdaters = new Set();
function live(fn) {
  fn();
  liveUpdaters.add(fn);
}
function collapsible(cls, key, title, summary, body, defaultOpen) {
  const summaryEl = h('span', { class: 'panel-summary' });
  const setText = (text) => { summaryEl.textContent = text || ''; summaryEl.title = text || ''; };
  if (typeof summary === 'function') live(() => setText(summary()));
  else setText(summary);
  const d = h('details', { class: cls, id: `panel-${key}`, open: uiOpen[key] ?? defaultOpen },
    h('summary', {},
      typeof title === 'string' ? h('span', { class: 'panel-title' }, title) : title,
      summaryEl,
      h('span', { class: 'chev' })),
    h('div', { class: cls.includes('sub') ? 'sub-body' : 'panel-body' }, body));
  // Opened or closed by the user (click, or Enter/Space on the header) rather than Expand all:
  // bring the panel fully into view once it has changed size.
  let byUser = false;
  d.querySelector('summary').addEventListener('click', () => { byUser = true; });
  d.addEventListener('toggle', () => {
    rememberOpen(key, d.open);
    if (byUser) revealPanel(d);
    byUser = false;
  });
  return d;
}

// Scroll so the whole panel is on screen below the fixed header (or, if it is taller than the
// space, so its top is). Panels in the summary column scroll that column instead of the page.
function revealPanel(el) {
  const GAP = 16;
  const results = el.closest('.results');
  const scroller = results && getComputedStyle(results).overflowY === 'auto' ? results : null;
  const r = el.getBoundingClientRect();
  let top = GAP;
  let bottom = window.innerHeight - GAP;
  if (scroller) {
    const s = scroller.getBoundingClientRect();
    top = s.top + GAP;
    bottom = s.bottom - GAP;
  } else {
    // Fixed bars above the panel: the header, and on narrow screens the damage strip.
    for (const bar of document.querySelectorAll('.topbar, .hero-panel')) {
      const b = bar.getBoundingClientRect();
      if (b.height && b.left < r.right && b.right > r.left && b.top < window.innerHeight / 2) top = Math.max(top, b.bottom + GAP);
    }
  }
  const delta = r.top < top || r.height > bottom - top ? r.top - top : r.bottom > bottom ? r.bottom - bottom : 0;
  if (!delta) return;
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  (scroller || window).scrollBy({ top: delta, behavior });
}
// Top-level section card.
const panel = (key, title, summary, body, defaultOpen = false) =>
  collapsible('panel glass', key, title, summary, body, defaultOpen);
// Nested group inside a section.
const sub = (key, title, summary, body, defaultOpen = false) =>
  collapsible('sub', key, h('span', {}, title), summary, body, defaultOpen);
function countBadge(countFn) {
  const el = h('span', { class: 'count' });
  live(() => {
    const n = countFn();
    el.textContent = String(n);
    el.className = `count${n ? '' : ' zero'}`;
  });
  return el;
}
const joinParts = (...parts) => parts.flat().filter(Boolean).join(' · ');

// ---------- item pickers ----------
// In-game markers: fragged (STARRED_*) items carry ⚚ before the name; dungeon stars are gold ✪,
// master stars a red numbered badge (drawn in CSS: the ➊–➎ glyphs are unreadable at small sizes).
const FRAGGED_ICON = '⚚';
const masterStarBadge = (n) => h('span', { class: 'master-star', title: `${n} master star${n > 1 ? 's' : ''}` }, String(n));

// Non-dungeon stars past 5 (Crimson Isle / Kuudra gear) don't add icons: they recolour the five
// stars from the left, gold -> pink for stars 6-10, pink -> aqua for stars 11-15.
const STAR_TIERS = ['star-gold', 'star-pink', 'star-aqua'];

function starIcons(item, stars, dungeonized) {
  const n = Math.max(0, stars || 0);
  if (!item || !n) return '';
  const dungeon = asDungeonItem(item, dungeonized).dungeon_item;
  const title = `${n} star${n > 1 ? 's' : ''}`;
  if (dungeon || n <= 5) {
    return h('span', { class: 'star-icons', title },
      h('span', { class: 'star-gold' }, '✪'.repeat(Math.min(n, 5))),
      dungeon && n > 5 ? masterStarBadge(Math.min(n - 5, 5)) : '');
  }
  const tier = Math.min(Math.ceil(n / 5) - 1, STAR_TIERS.length - 1); // 1 for 6-10, 2 for 11-15
  const upgraded = Math.min(n - tier * 5, 5);
  return h('span', { class: 'star-icons', title },
    h('span', { class: STAR_TIERS[tier] }, '✪'.repeat(upgraded)),
    h('span', { class: STAR_TIERS[tier - 1] }, '✪'.repeat(5 - upgraded)));
}

// Key combat stats for the option list, e.g. "260 Dmg · 150 Str".
function itemNote(item) {
  const s = itemStats(item);
  return ['DAMAGE', 'STRENGTH', 'CRITICAL_DAMAGE', 'CRITICAL_CHANCE', 'DEFENSE', 'HEALTH']
    .filter((k) => s[k]).slice(0, 1).map((k) => `${fmtShort(s[k])} ${STAT_SHORT[k]}`).join('');
}

function itemPicker(list, slotPath) {
  const path = `${slotPath}.id`;
  const piece = getPath(slotPath) || {};
  const current = byId.get(piece.id);
  const names = {};
  for (const i of list) if (!i.id.startsWith('STARRED_')) names[i.name] = (names[i.name] || 0) + 1;
  const showStat = !slotPath.startsWith('armor.'); // armor lists show names only
  const options = [
    { value: '', label: 'None', cls: 'muted', search: 'empty none' },
    ...list.map((i) => {
      const fragged = i.id.startsWith('STARRED_');
      return {
        value: i.id, label: i.name, cls: `tier tier-${i.tier}`,
        rich: i.fmtName ? parseFormatting(i.fmtName) : undefined, // in-game § colours/styles
        prefix: fragged ? FRAGGED_ICON : '', prefixCls: `tier tier-${i.tier}`,
        // Two different non-fragged items with the same name: a readable form of the id tells them apart.
        note: !fragged && names[i.name] > 1 ? titleCase(i.id) : showStat ? itemNote(i) : '',
        search: `${i.id} ${fragged ? 'fragged' : ''}`,
      };
    }),
  ];
  // The selected item shows in its effective rarity (recomb, quality, milestone).
  if (current) {
    const idx = options.findIndex((o) => o.value === current.id);
    const canRecomb = current.can_recombobulate !== false && recombHasEffect(current, piece.level);
    const tier = recombHasEffect(current, piece.level)
      ? RARITIES[rarityIndex(current, canRecomb && piece.recomb, piece.level, piece.quality)]
      : baseTier(current, piece.level);
    options[idx] = { ...options[idx], cls: `tier tier-${tier}`, prefixCls: `tier tier-${tier}` };
  }
  const input = combo(options, current?.id ?? '', (id) => {
    setPath(path, id);
    // Gem slots, star count and tiers differ per item.
    setPath(`${slotPath}.gems`, []);
    setPath(`${slotPath}.stars`, 0);
    setPath(`${slotPath}.level`, undefined);
    setPath(`${slotPath}.statTier`, undefined);
    setPath(`${slotPath}.price`, undefined);
    setPath(`${slotPath}.quality`, undefined);
    setPath(`${slotPath}.dungeonized`, false);
    rerenderForm();
  }, { searchable: true, placeholder: 'Search item…', ariaLabel: 'Item', className: 'mc' });
  const info = h('div', { class: 'item-stats' });
  showItemInfo(info, current, { tier: piece.statTier, level: piece.level });
  return { input, dl: '', info };
}
// Unstarred base stats at the selected stat tier / milestone.
function showItemInfo(el, item, opts = {}) {
  el.replaceChildren();
  if (!item) return;
  const stats = itemStats(item, opts);
  const tier = baseTier(item, opts.level) || '';
  el.append(
    h('span', { class: `tier tier-${tier}` }, tier.replace('_', ' ')), ' ',
    item.category ? `${item.category.toLowerCase()} · ` : '',
    Object.entries(stats).map(([k, v]) => `${STAT_LABELS[k] || k.toLowerCase().replace(/_/g, ' ')} ${v > 0 ? '+' : ''}${fmt(v, 2)}`).join(', ') || 'no stats',
  );
}
// Potato books, Art of War and "Bought for" price, depending on the slot.
function anvilControls(kind, path) {
  const item = byId.get(getPath(`${path}.id`));
  const perBook = POTATO_STATS[kind];
  if (!item || !perBook) return '';
  const hpb = getPath(`${path}.hpb`) || 0;
  const bookOpts = (max, offset) => Array.from({ length: max + 1 }, (_, n) =>
    (n ? { value: n, label: `${n} book${n === 1 ? '' : 's'}`, note: statText(Object.fromEntries(Object.entries(perBook).map(([k, v]) => [k, v * (n + offset)]))) } : [n, 'None']));
  const price = PRICE_ITEMS[item.id];
  const greed = price ? greedBonus(item.id, getPath(`${path}.price`)) : 0;
  return h('div', { class: 'anvil' },
    selectField('Hot Potato Books', `${path}.hpb`, bookOpts(HOT_POTATO_MAX, 0), { num: true, rerender: true }),
    hpb >= HOT_POTATO_MAX
      ? selectField('Fuming Potato Books', `${path}.fuming`, bookOpts(FUMING_POTATO_MAX, HOT_POTATO_MAX), { num: true })
      : disabledSelect('Fuming Potato Books', 'Needs 10 Hot Potato Books'),
    kind === 'weapon' ? h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: !!getPath(`${path}.artOfWar`), 'data-path': `${path}.artOfWar` }),
      `The Art of War (${statText(ART_OF_WAR)})`) : '',
    price ? h('label', { class: 'field' }, `Bought for (coins, max ${fmt(price.cap)})`,
      h('input', { type: 'number', min: 0, step: 100000, value: getPath(`${path}.price`) ?? '', placeholder: '0',
        'data-path': `${path}.price`, 'data-num': '1', 'data-rerender': '1' }),
      h('span', { class: 'muted' }, `Greed: +${greed} Damage, +${greed} Strength`)) : '',
  );
}

const STAT_SHORT = { STRENGTH: 'Str', CRITICAL_DAMAGE: 'Crit Dmg', CRITICAL_CHANCE: 'Crit Chance', DAMAGE: 'Dmg',
  INTELLIGENCE: 'Int', HEALTH: 'Health', DEFENSE: 'Def', TRUE_DEFENSE: 'True Def', FEROCITY: 'Ferocity', ATTACK_SPEED: 'Atk Speed' };
const statText = (stats) => Object.entries(stats).filter(([, v]) => v)
  .map(([k, v]) => `${v > 0 ? '+' : ''}${fmt(v, 2)} ${STAT_SHORT[k] || k}`).join(', ');

function reforgeOptions(table, rIdx) {
  // Per-Catacombs-level bonuses (Withered, Ancient) are shown at the player's level.
  const cata = clampCatacombs(state.catacombsLevel);
  return [['none', 'None'], ...Object.entries(table).map(([k, r]) => {
    const stats = Object.fromEntries(Object.entries(r.stats).map(([s, arr]) => [s, arr[Math.min(rIdx, arr.length - 1)]]));
    if (r.perCataStr) stats.STRENGTH = (stats.STRENGTH || 0) + r.perCataStr * cata;
    if (r.perCataCD) stats.CRITICAL_DAMAGE = (stats.CRITICAL_DAMAGE || 0) + r.perCataCD * cata;
    const txt = joinParts(statText(stats), r.perCataStr || r.perCataCD ? `incl. Catacombs ${cata}` : '');
    return { value: k, label: r.name, note: txt, search: r.stone || '' };
  })];
}

// Reforge, recomb and gemstone controls shared by weapon / armor / equipment slots.
function upgradeControls(kind, path) {
  const item = byId.get(getPath(`${path}.id`));
  if (!item) return null;
  const tierCtl = tierControl(path);
  const canRecomb = item.can_recombobulate !== false;
  const level = getPath(`${path}.level`);
  const rIdx = rarityIndex(item, canRecomb && getPath(`${path}.recomb`), level, getPath(`${path}.quality`));
  // Divine and above: show the item's own rarity (Special etc. aren't in RARITIES) and no recomb gain.
  const topTier = !recombHasEffect(item, level);
  const tierName = topTier ? (baseTier(item, level) || '') : RARITIES[rIdx];
  const tierLabel = h('span', { class: `tier tier-${tierName}` }, titleCase(tierName || 'COMMON'));
  const table = reforgeTable(kind, item);
  const gemSlots = item.gem_slots || [];
  const gems = getPath(`${path}.gems`) || [];
  return h('div', { style: 'margin-top:6px' },
    h('div', { class: 'upgrades' },
      Object.keys(table).length ? selectField('Reforge', `${path}.reforge`, reforgeOptions(table, rIdx)) : '',
      kind === 'equipment' ? tierCtl : '',
      !canRecomb
        ? h('span', {}, tierLabel, h('span', { class: 'muted' }, " · can't be recombobulated"))
        : topTier
          ? h('label', { class: 'check', title: 'Recombobulating Divine or Special-and-above items gives no extra stats' },
            h('input', { type: 'checkbox', disabled: true }),
            h('span', { class: 'muted' }, 'Recombobulated'), ' → ', tierLabel)
          : h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: !!getPath(`${path}.recomb`), 'data-path': `${path}.recomb`, 'data-rerender': '1' }),
            'Recombobulated', ' → ', tierLabel),
      kind !== 'equipment' && tierCtl ? tierCtl : '',
      item.can_dungeonize ? h('label', { class: 'check', title: 'Converted into a Dungeon Item with essence' },
        h('input', { type: 'checkbox', checked: !!getPath(`${path}.dungeonized`), 'data-path': `${path}.dungeonized`, 'data-rerender': '1' }),
        'Dungeonized') : ''),
    gemSlots.length ? h('div', { class: 'gems' }, gemSlots.map((type, i) => {
      const accepts = SLOT_ACCEPTS[type];
      const cur = gems[i];
      const label = `${type[0]}${type.slice(1).toLowerCase()} slot`;
      if (!accepts) return disabledSelect(label, 'Not combat-relevant');
      // Grouped by gem, coloured like the gemstone.
      const opts = [{ value: '', label: 'Empty', cls: 'muted' }, ...accepts.flatMap((g) => GEM_QUALITIES.slice().reverse().map((q) => ({
        value: `${g}:${q}`, group: GEMS[g].name, cls: `gem gem-${g}`,
        label: `${q[0]}${q.slice(1).toLowerCase()} ${GEMS[g].name}`,
        note: statText({ [GEMS[g].stat]: gemValue(g, q, rIdx) }),
      })))];
      const value = cur ? `${cur.gem}:${cur.quality}` : '';
      return actionSelect(label, opts, value, (v) => {
        const [gem, quality] = v.split(':');
        const list = [...(getPath(`${path}.gems`) || [])];
        list[i] = gem ? { gem, quality } : null;
        setPath(`${path}.gems`, list);
        update();
      }, { searchable: false });
    })) : null,
  );
}

// Star dropdown sized to the item's upgrade count; labels show the stat boost at the chosen location.
function starsField(path) {
  const item = asDungeonItem(byId.get(getPath(`${path}.id`)), getPath(`${path}.dungeonized`));
  const max = maxStars(item);
  if (!max) return h('span');
  if ((getPath(`${path}.stars`) || 0) > max) setPath(`${path}.stars`, max); // e.g. after un-dungeonizing
  // Each option shows the in-game star icons and the stat bonus at the current location.
  const opts = Array.from({ length: max + 1 }, (_, n) => {
    const pct = Math.round((starMultiplier(item, n, state.dungeonMode) - 1) * 100);
    return {
      value: n, label: `${n} star${n === 1 ? '' : 's'}`, search: String(n),
      node: () => (n
        ? h('span', { class: 'star-option' }, starIcons(item, n, false), h('span', { class: 'star-bonus' }, `+${pct}%`))
        : h('span', { class: 'muted' }, 'No stars')),
    };
  });
  return selectField('Stars', `${path}.stars`, opts, { num: true, searchable: false });
}

// Milestone (David's Cloak) or stat tier (API tiered_stats) picker.
function tierControl(path) {
  const item = byId.get(getPath(`${path}.id`));
  if (!item) return '';
  const prog = PROGRESSION_ITEMS[item.id];
  if (prog) {
    const opts = Array.from({ length: prog.max + 1 }, (_, n) => ({ value: n, label: prog.names[n] || 'None', note: titleCase(prog.tierAt(n)) }));
    if (getPath(`${path}.level`) == null) setPath(`${path}.level`, prog.max);
    return selectField(prog.label, `${path}.level`, opts, { num: true, rerender: true });
  }
  const tiers = statTierCount(item);
  if (!tiers) return '';
  if (!getPath(`${path}.statTier`)) setPath(`${path}.statTier`, tiers);
  if (!isDungeonDrop(item, tiers)) {
    const opts = Array.from({ length: tiers }, (_, i) => [i + 1, `Tier ${i + 1}${i + 1 === tiers ? ' (best)' : ''}`]);
    return selectField('Stat tier', `${path}.statTier`, opts, { num: true, rerender: true });
  }
  // Dungeon drop: floor it dropped from + quality roll.
  const floorOpts = Array.from({ length: tiers }, (_, i) => ({ value: i + 1, label: floorLabel(i + 1), search: `tier ${i + 1}` }));
  return [
    selectField('Dropped floor', `${path}.statTier`, floorOpts, { num: true, rerender: true }),
    h('label', { class: 'field', title: `${QUALITY_MAX}% quality = +1 rarity` }, `Quality (0–${QUALITY_MAX}%)`,
      h('input', { type: 'number', min: 0, max: QUALITY_MAX, step: 1, value: getPath(`${path}.quality`) ?? '', placeholder: '0',
        'data-path': `${path}.quality`, 'data-num': '1', 'data-rerender': '1' })),
  ];
}

// One-line description of a slot's upgrades, shown on the collapsed "Upgrades" row.
function upgradeSummary(kind, path) {
  const item = byId.get(getPath(`${path}.id`));
  if (!item) return '';
  const p = getPath(path) || {};
  const ref = reforgeTable(kind, item)[p.reforge];
  const prog = PROGRESSION_ITEMS[item.id];
  const gems = (p.gems || []).filter(Boolean).length;
  const books = (p.hpb || 0) + ((p.hpb || 0) >= HOT_POTATO_MAX ? (p.fuming || 0) : 0);
  return joinParts(
    ref?.name,
    p.recomb && recombHasEffect(item, p.level) ? 'recomb' : '',
    p.dungeonized ? 'dungeonized' : '',
    prog ? `${prog.label} ${prog.names[p.level ?? prog.max] || 0}` : '',
    p.statTier && statTierCount(item) ? (isDungeonDrop(item, statTierCount(item)) ? floorLabel(p.statTier).split(' / ')[0] : `tier ${p.statTier}`) : '',
    p.quality ? `${p.quality}% quality` : '',
    item.gem_slots?.length ? `${gems}/${item.gem_slots.length} gems` : '',
    books ? `${books} books` : '',
    p.artOfWar ? 'Art of War' : '',
    PRICE_ITEMS[item.id] && p.price ? `bought ${fmt(p.price)}` : '',
  ) || 'none';
}

function slotBlock(kind, path, list, title, dlId, openUpgrades = false) {
  const p = itemPicker(list, path);
  const item = byId.get(getPath(`${path}.id`));
  return h('div', { class: 'slot' },
    h('div', { class: 'slot-head' }, h('span', { class: 'name' }, title), p.input, starsField(path)),
    p.dl, p.info,
    item ? sub(`${path}-upgrades`, 'Upgrades', () => upgradeSummary(kind, path),
      [upgradeControls(kind, path), anvilControls(kind, path)], openUpgrades) : '');
}

// Armor / equipment slot folded into one row: closed it reads "Helmet  Item · ★5 · reforge · gems…";
// open it shows the picker, stars and every upgrade control. Opening one closes the other open
// slot in the same section, so only one is being edited at a time.
function compactSlot(kind, path, list, title) {
  const p = itemPicker(list, path);
  const item = byId.get(getPath(`${path}.id`));
  const summary = () => {
    const it = byId.get(getPath(`${path}.id`));
    if (!it) return 'empty';
    const stars = getPath(`${path}.stars`);
    return joinParts(it.name, stars ? `★${stars}` : '', upgradeSummary(kind, path));
  };
  const d = sub(`${path}-slot`, title, summary, [
    h('div', { class: 'slot-head compact' }, p.input, starsField(path)),
    p.dl, p.info,
    item ? h('div', { class: 'slot-upgrades' }, upgradeControls(kind, path), anvilControls(kind, path)) : '',
  ]);
  d.classList.add('slot-acc');
  d.addEventListener('toggle', () => {
    if (!d.open) return;
    for (const other of d.parentElement?.querySelectorAll(':scope > details.slot-acc[open]') || []) if (other !== d) other.open = false;
  });
  return d;
}

// Fill every combat-relevant gem slot on all gear with the given quality.
function fillAllGems(quality) {
  const paths = ['weapon', ...ARMOR_SLOTS.map((s) => `armor.${s}`), ...EQUIP_SLOTS.map((s) => `equipment.${s.key}`)];
  for (const path of paths) {
    const item = byId.get(getPath(`${path}.id`));
    if (!item) continue;
    setPath(`${path}.gems`, (item.gem_slots || []).map((type) => {
      if (!quality) return null;
      const gem = GEM_FILL_PRIORITY.find((g) => SLOT_ACCEPTS[type]?.includes(g));
      return gem ? { gem, quality } : null;
    }));
  }
  rerenderForm();
}

// ---------- form sections ----------
function weaponSection() {
  const weapon = byId.get(state.weapon.id);
  const bow = isBow(weapon);
  // Only the enchants this weapon's type can take (e.g. fishing rods: Spiked Hook, Impaling…).
  const enchants = ENCHANTS.filter((e) => enchantFits(e, weapon));
  const ults = ultimatesFor(weapon);
  const ult = ults.find((u) => u.id === state.weapon.ultimate?.id);
  const oneForAll = !!ult?.exclusive;

  // Ultimate enchants are shown in-game in bold pink; one option per level, grouped by enchant.
  const ultOpts = [{ value: '', label: 'None', cls: 'muted' }, ...ults.flatMap((u) => u.values.map((_, i) => ({
    value: `${u.id}:${i + 1}`, group: u.name, label: `${u.name} ${roman(i + 1)}`, cls: 'ench-ultimate',
    note: u.effect ? '' : 'no single-hit effect',
  })))];
  const ultSelect = actionSelect(null, ultOpts, ult ? `${ult.id}:${state.weapon.ultimate.level}` : '', (v) => {
    const [id, level] = v.split(':');
    state.weapon.ultimate = id ? { id, level: Number(level) } : null;
    rerenderForm();
  }, { ariaLabel: 'Ultimate enchantment' });

  // Situational inputs only some ultimates need.
  const ultInputs = {
    perEnemy: () => numField('Enemies within 10 blocks', 'target.nearbyEnemies', { min: 0, max: 10, step: 1 }),
    perKill: () => numField('Kills in the combo window', 'player.comboKills', { min: 0, step: 1 }),
    soulEater: () => numField("Last killed mob's damage", 'player.soulEaterMobDamage', { min: 0 }),
  }[ult?.effect];

  const ability = WEAPON_ABILITIES[weapon?.id];
  // Blaze Slayer daggers come in pairs: the simulation swaps to a dagger of the other family
  // (same upgrades as this one) when the Inferno Demonlord's shield needs it.
  const family = daggerFamily(weapon?.id);
  const secondOpts = family ? DAGGER_FAMILIES[family === 'fire' ? 'twilight' : 'fire'].ids
    .map((id) => byId.get(id)).filter(Boolean).map((i) => ({ value: i.id, label: i.name, cls: `tier tier-${i.tier}` })) : [];
  const bonusText = weaponMultipliers(weapon?.id).map((r) => {
    const against = (r.mobs || r.families).join('/');
    return r.perMissingHp ? `up to ×${1 + r.perMissingHp} vs ${against} (scales with missing HP)` : `×${r.mult} vs ${against}`;
  }).join(', ');

  const enchantField = (e) => {
    const clash = enchantConflict(e.id, state.weapon.enchants);
    const blockedBy = clash && !state.weapon.enchants[e.id] ? ENCHANTS.find((x) => x.id === clash).name : null;
    // Conflicting enchants re-render so their partner gets blocked/unblocked.
    const sel = selectField(null, `weapon.enchants.${e.id}`, levelOptions(e.values.length),
      { num: true, rerender: ENCHANT_CONFLICTS.flat().includes(e.id), disabled: oneForAll || !!blockedBy });
    return h('div', { class: 'field', title: blockedBy ? `Can't be combined with ${blockedBy}` : '' },
      h('span', { class: 'field-label' }, e.name, blockedBy ? h('span', { class: 'conflict' }, ` ✕ ${blockedBy}`) : ''), sel);
  };
  const active = (list) => list.filter((e) => state.weapon.enchants[e.id]);
  const activeText = (list) => active(list).map((e) => `${e.name} ${roman(state.weapon.enchants[e.id])}`).join(', ');
  const general = enchants.filter((e) => !e.mobs);
  const mobSpecific = enchants.filter((e) => e.mobs);
  const enchantGroup = (key, title, list) => sub(`weapon-${key}`, [title, ' ', countBadge(() => (oneForAll ? 0 : active(list).length))],
    () => (oneForAll ? 'removed by One For All' : activeText(list) || 'none'),
    h('div', { class: `grid${oneForAll ? ' disabled' : ''}` }, list.map(enchantField)),
    !oneForAll && active(list).length > 0);

  const summary = () => (weapon
    ? joinParts(weapon.name, state.weapon.stars ? `${state.weapon.stars}✪` : '',
      ult ? `${ult.name} ${roman(state.weapon.ultimate.level)}` : '',
      oneForAll ? '' : `${active(enchants).length} enchants`)
    : 'No weapon selected');

  return panel('weapon', 'Weapon', summary, [
    slotBlock('weapon', 'weapon', items.weapons, 'Item', null, true),
    bonusText ? h('p', { class: 'weapon-bonus' }, `Weapon bonus: ${bonusText}`) : '',
    ability ? h('div', { class: 'chips' }, h('label', {},
      h('input', { type: 'checkbox', checked: state.weapon.abilityOn !== false, 'data-path': 'weapon.abilityOn' }),
      `${ability.name} active (${statText(ability.stats)} vs ${ability.families.join('/')})`)) : '',
    secondOpts.length ? h('div', { class: 'grid wide' },
      h('div', { class: 'field', title: 'Swapped to for the other attunements; uses this dagger’s upgrades' },
        h('span', { class: 'field-label' }, 'Second dagger'),
        actionSelect(null, secondOpts, secondDaggerId(), (v) => { state.weapon.secondId = v; update(); },
          { searchable: false, ariaLabel: 'Second dagger' }))) : '',
    h('h3', {}, 'Enchantments'),
    h('div', { class: 'grid wide' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Ultimate enchantment'), ultSelect),
      ultInputs ? ultInputs() : ''),
    enchantGroup('general', 'General', general),
    mobSpecific.length ? enchantGroup('mobench', 'Vs. specific enemies', mobSpecific) : '',
  ], true);
}

function armorSection() {
  // Action dropdowns: pick an option to apply it; they don't keep a selection.
  const allReforge = actionSelect('Reforge all armor',
    [['none', 'None'], ...Object.entries(ARMOR_REFORGES).map(([k, r]) => [k, r.name])], '', (v) => {
      for (const s of ARMOR_SLOTS) state.armor[s].reforge = v;
      rerenderForm();
    }, { placeholder: 'Choose…', searchable: false });
  const allRecomb = h('button', { type: 'button', onclick: () => {
    const on = !ARMOR_SLOTS.every((s) => state.armor[s].recomb);
    for (const s of ARMOR_SLOTS) state.armor[s].recomb = on;
    rerenderForm();
  } }, 'Toggle recomb on all');
  const fillGems = actionSelect('Fill all gem slots (all gear)', [
    ...GEM_QUALITIES.slice().reverse().map((q) => [q, `${q[0]}${q.slice(1).toLowerCase()}`]),
    { value: 'CLEAR', label: 'Clear all gems', cls: 'muted' },
  ], '', (v) => fillAllGems(v === 'CLEAR' ? '' : v), { placeholder: 'Choose…', searchable: false });
  const summary = () => {
    const worn = ARMOR_SLOTS.map((s) => byId.get(state.armor[s].id)).filter(Boolean);
    const reforges = [...new Set(ARMOR_SLOTS.map((s) => ARMOR_REFORGES[state.armor[s].reforge]?.name).filter(Boolean))];
    return worn.length
      ? joinParts(`${worn.length}/4 pieces`, commonName(worn.map((i) => i.name)), reforges.join('/'))
      : 'No armor';
  };
  return panel('armor', 'Armor', summary, [
    h('div', { class: 'presets' }, allReforge, fillGems, allRecomb),
    setBonusPanel('armor'),
    ARMOR_SLOTS.map((slot) =>
      compactSlot('armor', `armor.${slot}`, items.armor[slot], slot[0] + slot.slice(1).toLowerCase())),
  ]);
}

// Shared leading words of item names ("Necron's Helmet", "Necron's Boots" -> "Necron's").
function commonName(names) {
  if (names.length < 2) return names[0] || '';
  const words = names.map((n) => n.split(' '));
  const out = [];
  for (let i = 0; words.every((w) => w[i] && w[i] === words[0][i]); i++) out.push(words[0][i]);
  return out.length ? `${out.join(' ')} set` : '';
}

// Set / piece bonuses for one slot group ('armor' | 'equipment'): live status plus situational inputs.
function setBonusPanel(slot) {
  const pieces = slot === 'armor'
    ? ARMOR_SLOTS.map((s) => ({ slot, id: state.armor[s].id }))
    : EQUIP_SLOTS.map((s) => ({ slot, id: state.equipment[s.key].id }));
  const detected = detectSets(pieces);
  const evaluate = () => {
    const weapon = byId.get(state.weapon.id);
    return evaluateSets(detected, {
      bow: isBow(weapon), target: { mobs: [], families: [], ...state.target }, weaponId: weapon?.id,
      cataLevel: clampCatacombs(state.catacombsLevel), speed: lastResult?.speed,
      inDungeon: state.dungeonMode === 'catacombs' || state.dungeonMode === 'master',
    }, state.setInputs).status;
  };
  const title = slot === 'armor' ? 'Set bonuses' : 'Piece bonuses';
  if (!detected.length) return ''; // shown once a set piece is worn

  // Status lines refresh on every update (e.g. stack counts, in-dungeon switch).
  const list = h('div', { class: 'set-list' });
  live(() => list.replaceChildren(...evaluate().map((s) => h('div', { class: `set-row${s.active ? ' on' : ''}` },
    h('div', { class: 'set-head' },
      h('span', { class: 'set-name' }, s.label),
      h('span', { class: `tag${s.active ? ' on' : ''}` }, s.active ? 'active' : 'inactive')),
    h('div', { class: 'set-text' }, s.text)))));

  // Situational inputs, only for sets that have enough pieces to matter.
  const inputs = detected.filter((d) => d.set.inputs && (d.count >= d.set.min || d.helmet)).flatMap((d) => d.set.inputs.map((inp) => {
    const path = `setInputs.${d.set.id}.${inp.key}`;
    if (inp.type === 'toggle') {
      return h('label', { class: 'check', style: 'align-self:end;padding-bottom:8px' },
        h('input', { type: 'checkbox', checked: !!(getPath(path) ?? inp.def), 'data-path': path }), inp.label);
    }
    return numField(inp.label, path, { min: inp.min, max: inp.max, step: 1, placeholder: inp.placeholder ?? String(inp.def ?? 0) });
  }));

  return sub(`${slot}-sets`, [title, ' ', countBadge(() => evaluate().filter((s) => s.active).length)],
    () => evaluate().map((s) => `${s.set.name} ${s.count}/${s.set.full}`).join(', '),
    [list, inputs.length ? h('div', { class: 'grid wide', style: 'margin-top:10px' }, inputs) : ''], true);
}

function equipmentSection() {
  const summary = () => {
    const worn = EQUIP_SLOTS.map((s) => byId.get(state.equipment[s.key].id)).filter(Boolean);
    return worn.length ? worn.map((i) => i.name).join(', ') : 'No equipment';
  };
  return panel('equipment', 'Equipment', summary, [
    setBonusPanel('equipment'),
    EQUIP_SLOTS.map((slot) => {
      const list = slot.cats.flatMap((c) => items.equipment[c] || []).sort((a, b) => a.name.localeCompare(b.name));
      return compactSlot('equipment', `equipment.${slot.key}`, list, slot.name);
    })]);
}

function accessorySection() {
  const powerOpts = POWERS.map((p) => {
    const stone = p.stone ? items.powerStones[p.stone] || p.stone : p.id === 'none' ? '' : 'starter';
    return { value: p.id, label: p.name, note: stone, search: stone };
  });
  const tuningInfo = h('span', { class: 'muted', id: 'tuning-info' });
  const summary = () => {
    const mp = state.magicalPower || 0;
    const power = POWERS.find((p) => p.id === state.power);
    const used = Object.values(state.tuning).reduce((a, b) => a + (b || 0), 0);
    return joinParts(`${fmt(mp)} MP`, power && power.id !== 'none' ? power.name : 'no power',
      used ? `${used}/${tuningPoints(mp)} tuning` : '');
  };
  // Conditions of the accessories assumed at this MP, shown only once one of them is reached.
  const held = assumedAccessories(state.magicalPower);
  const has = (...ids) => ids.some((id) => held[id]);
  const accInputs = [
    has('day_crystal', 'night_crystal') ? selectField('Time of day', 'accessoryInputs.time', [['day', 'Day'], ['night', 'Night']]) : '',
    has('blood_god') ? numField('Blood God kill digits', 'accessoryInputs.killDigits', { min: 0, max: 7, step: 1 }) : '',
    has('reaper_orb') ? numField('Kills in the last 5s', 'accessoryInputs.recentKills', { min: 0, step: 1 }) : '',
  ].filter(Boolean);
  const accChips = has('bluetooth') ? [chipField('6+ players on the island', 'accessoryInputs.crowded')] : [];
  return panel('accessories', 'Accessories & Power', summary, [
    h('div', { class: 'grid wide' },
      numField('Magical Power', 'magicalPower', { min: 0, step: 1, rerender: true }),
      selectField('Power', 'power', powerOpts),
      h('div', { class: 'field muted', id: 'power-mult', style: 'align-self:end;padding-bottom:8px' })),
    h('h3', {}, 'Tuning — ', tuningInfo),
    h('div', { class: 'grid' },
      Object.entries(TUNING_PER_POINT).map(([stat, per]) =>
        numField(`${STAT_LABELS[stat]} (+${per}/pt)`, `tuning.${stat}`, { min: 0, step: 1 }))),
    accInputs.length || accChips.length ? h('h3', {}, 'Accessory conditions') : '',
    accInputs.length ? h('div', { class: 'grid' }, accInputs) : '',
    accChips.length ? h('div', { class: 'chips', style: accInputs.length ? 'margin-top:12px' : null }, accChips) : '',
  ]);
}

function shardSection() {
  const shardOpts = levelOptions(10);
  const echoes = [
    { id: 'echo_ruler', name: 'Echo of Ruler', shard: 'Caiman' },
    { id: 'echo_echoes', name: 'Echo of Echoes', shard: 'Tiamat' },
  ];
  const active = (list) => list.filter((s) => state.shards[s.id]);
  const activeText = (list) => active(list).map((s) => `${s.name} ${roman(state.shards[s.id])}`).join(', ');
  const group = (key, title, list) => sub(`shards-${key}`, [title, ' ', countBadge(() => active(list).length)], () => activeText(list) || 'none',
    h('div', { class: 'grid wide' },
      list.map((s) => h('label', { class: 'field', title: `${s.shard} Shard` }, `${s.name} · ${s.shard}`,
        selectField(null, `shards.${s.id}`, shardOpts, { num: true })))),
    active(list).length > 0);
  const all = [...SHARDS, ...echoes];
  return panel('shards', 'Shards (Attributes)', () => activeText(all) || 'None', [
    group('damage', 'Damage & stats', SHARDS.filter((s) => !s.ruler)),
    group('ruler', 'Ruler attributes', SHARDS.filter((s) => s.ruler)),
    group('echoes', 'Echoes', echoes),
  ]);
}

// ---------- pets ----------
const titleCase = (id) => id.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const petName = (id) => pets?.displayNames?.[id] || titleCase(id);
const petRarities = (id) => PET_RARITIES.filter((r) => pets?.petnums?.[id]?.[r]);

// Pet as the calculator needs it: rarity after Tier Boost, interpolated numbers, cleaned lore.
function resolvedPet() {
  const { id, rarity, level, item } = state.pet;
  if (!id || !pets?.petnums?.[id]) return null;
  const eff = effectiveRarity(pets.petnums, id, rarity, item);
  const nums = petNumbers(pets.petnums, id, eff, level);
  if (!nums) return null;
  const range = petLevelRange(pets.petnums, id, eff);
  const lore = petLore.get(`${id};${rarityIdx(eff)}`);
  return {
    id, name: petName(id), rarity: eff, level: Math.max(range.min, Math.min(range.max, level || range.max)),
    item, itemName: items.petItems.find((i) => i.id === item)?.name,
    ...nums, lore: lore ? cleanLore(lore) : '', loreLines: lore,
  };
}

function ensurePetLore() {
  const pet = resolvedPet();
  if (!pet) return;
  const key = `${pet.id};${rarityIdx(pet.rarity)}`;
  if (petLore.has(key)) return;
  petLore.set(key, null);
  loadPetLore(pet.id, rarityIdx(pet.rarity)).then((lore) => { petLore.set(key, lore); update(); });
}

function petItemEffect(id) {
  const e = PET_ITEMS[id];
  if (!e) return '';
  if (e.tierBoost) return '+1 pet rarity';
  const parts = [];
  if (e.flat) parts.push(statText(e.flat));
  for (const [k, v] of Object.entries(e.pct || {})) parts.push(`+${v}% pet ${k === '__all' ? 'stats' : STAT_SHORT[k]}`);
  return parts.join(', ');
}

function petSection() {
  const body = [];
  const summary = () => {
    if (!pets || pets.error || !state.pet.id) return pets?.error ? 'Pet data unavailable' : 'No pet';
    const item = items.petItems.find((i) => i.id === state.pet.item);
    return joinParts(petName(state.pet.id), `${titleCase(state.pet.rarity)} ${state.pet.level || ''}`.trim(), item?.name);
  };
  const card = panel('pet', 'Pet', summary, body);
  const content = card.querySelector('.panel-body');
  if (!pets) {
    content.append(h('p', { class: 'muted' }, 'Loading pet data…'));
    return card;
  }
  if (pets.error) {
    content.append(h('p', { class: 'muted' }, `Pet data unavailable (${pets.error}). Enter pet stats under Buffs & skills.`));
    return card;
  }
  const ids = Object.keys(pets.petnums).filter((id) => petRarities(id).length);
  const groups = {};
  for (const id of ids) (groups[pets.types[id] || 'OTHER'] ??= []).push(id);
  // The chosen pet shows in its (Tier Boost-adjusted) rarity colour.
  const shownRarity = resolvedPet()?.rarity || state.pet.rarity;
  const petOpts = [{ value: '', label: 'No pet', cls: 'muted' },
    ...Object.keys(groups).sort().flatMap((g) => groups[g].sort((a, b) => petName(a).localeCompare(petName(b))).map((id) => ({
      value: id, label: petName(id), group: titleCase(g),
      cls: id === state.pet.id ? `tier tier-${shownRarity}` : '',
      search: petRarities(id).join(' ').toLowerCase(),
    })))];
  const petSelect = actionSelect('Pet', petOpts, state.pet.id, (v) => {
    state.pet.id = v;
    const rs = petRarities(state.pet.id);
    if (rs.length && !rs.includes(state.pet.rarity)) state.pet.rarity = rs[rs.length - 1];
    state.pet.level = state.pet.id ? petLevelRange(pets.petnums, state.pet.id, state.pet.rarity).max : 100;
    rerenderForm();
  }, { searchable: true, placeholder: 'Search pet…', className: 'mc' });

  content.append(h('div', { class: 'grid wide' }, petSelect));
  if (!state.pet.id || !pets.petnums[state.pet.id]) return card;

  const range = petLevelRange(pets.petnums, state.pet.id, state.pet.rarity);
  const itemOpts = [{ value: '', label: 'None', cls: 'muted' }, ...items.petItems.map((i) => ({
    value: i.id, label: i.name, cls: `tier tier-${i.tier || 'COMMON'}`, note: petItemEffect(i.id),
    rich: i.fmtName ? parseFormatting(i.fmtName) : undefined,
    search: `${i.tier || ''} ${petItemEffect(i.id)}`,
  }))];
  content.append(
    h('div', { class: 'grid wide', style: 'margin-top:10px' },
      selectField('Rarity', 'pet.rarity', petRarities(state.pet.id).map((r) => ({ value: r, label: titleCase(r), cls: `tier tier-${r}` })), { rerender: true }),
      numField(`Level (${range.min}–${range.max})`, 'pet.level', { min: range.min, max: range.max, step: 1 }),
      selectField('Pet item', 'pet.item', itemOpts, { rerender: true, placeholder: 'Search pet item…', className: 'mc' })),
    state.pet.id === 'GOLDEN_DRAGON' ? h('div', { class: 'grid', style: 'margin-top:8px' },
      numField('Bank coins', 'petExtras.bankCoins', { min: 0 }),
      numField('Magic Find', 'petExtras.magicFind', { min: 0 }),
      numField('Gold collection digits', 'petExtras.goldDigits', { min: 0, max: 9, step: 1 })) : '',
    h('div', { id: 'pet-lore', class: 'pet-lore' }),
  );
  ensurePetLore();
  return card;
}

function renderPetLore(r) {
  const el = document.getElementById('pet-lore');
  if (!el) return;
  const pet = resolvedPet();
  if (!pet) return el.replaceChildren();
  if (!pet.loreLines) return el.replaceChildren(h('span', { class: 'muted' }, 'Loading abilities…'));
  const active = new Map((r.petAbilities || []).map((a) => [a.name, a.active]));
  const lines = pet.loreLines
    .map((l) => l.replace(/§./g, '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim())
    .filter((l) => l && !/Right-click|PET$|^\*|Pet, feed|Pet$|Mount$|Morph$/.test(l));
  // Group wrapped lore lines into stat lines and ability blocks (a short header + its description).
  const blocks = [];
  for (const l of lines) {
    const isStat = /^[A-Za-z ]+: [-+]?\{[A-Z_]+\}/.test(l);
    const isHeader = !isStat && !/[{}\d%+.,()]/.test(l) && l.split(' ').length <= 4;
    if (isStat || isHeader || !blocks.length || blocks.at(-1).stat) blocks.push({ head: isHeader ? l : null, stat: isStat, text: isHeader ? '' : l });
    else blocks.at(-1).text += ` ${l}`;
  }
  el.replaceChildren(
    pet.rarity !== state.pet.rarity ? h('p', { class: 'muted' }, `Tier Boost: counted as ${pet.rarity.toLowerCase()}.`) : '',
    ...blocks.map((b) => {
      if (!b.head) return h('div', {}, fillLore(b.text.trim(), pet));
      const status = active.has(b.head)
        ? h('span', { class: active.get(b.head) ? 'tag on' : 'tag' }, active.get(b.head) ? 'applied' : 'condition not met')
        : '';
      return h('div', { class: 'ability-block' },
        h('div', { class: 'ability' }, b.head, ' ', status), b.text ? h('div', {}, fillLore(b.text.trim(), pet)) : '');
    }),
  );
}

function bonusSection() {
  const cols = [['DAMAGE', 'Damage'], ['STRENGTH', 'Str'], ['CRITICAL_DAMAGE', 'CD'], ['CRITICAL_CHANCE', 'CC'],
    ['additive', 'Add. %'], ['multiplier', 'Mult ×']];
  const body = h('tbody', {}, state.bonuses.map((b, i) => h('tr', {},
    h('td', {}, h('input', { value: b.label || '', 'data-path': `bonuses.${i}.label`, style: 'min-width:120px' })),
    cols.map(([k]) => h('td', {}, h('input', {
      type: 'number', step: 'any', value: b[k] ?? '', placeholder: k === 'multiplier' ? '1' : '0',
      'data-path': `bonuses.${i}.${k}`, 'data-num': '1', style: 'min-width:60px',
    }))),
    h('td', {}, h('button', { type: 'button', class: 'link', title: 'Remove', onclick: () => {
      state.bonuses.splice(i, 1); rerenderForm();
    } }, '✕')),
  )));
  const usedRows = () => state.bonuses.filter((b) => ['DAMAGE', 'STRENGTH', 'CRITICAL_DAMAGE', 'CRITICAL_CHANCE', 'additive']
    .some((k) => b[k]) || (b.multiplier && b.multiplier !== 1));
  const summary = () => joinParts(
    `Combat ${state.combatLevel || 0}`, `Catacombs ${clampCatacombs(state.catacombsLevel)}`,
    state.godPotion ? 'God Potion' : '', MAYORS[state.mayor] ? `Mayor ${MAYORS[state.mayor]}` : '', usedRows().length ? `${usedRows().length} custom bonus${usedRows().length > 1 ? 'es' : ''}` : '');
  return panel('buffs', 'Buffs & skills', summary, [
    h('div', { class: 'grid' },
      numField('Combat level', 'combatLevel', { min: 0, max: 60, step: 1 }),
      numField(`Catacombs level (0–${CATACOMBS_MAX_LEVEL})`, 'catacombsLevel', { min: 0, max: CATACOMBS_MAX_LEVEL, step: 1, rerender: true }),
      // Only special mayors that change a hit are listed.
      selectField('Mayor', 'mayor', [{ value: '', label: 'Other / none', cls: 'muted' },
        ...Object.entries(MAYORS).map(([id, name]) => ({ value: id, label: name, note: MAYOR_EFFECTS[id] }))], { rerender: true }),
      h('div', { class: 'chips', style: 'align-self:end;padding-bottom:6px' },
        chipField('God Potion', 'godPotion', { rerender: true, title: 'Strength VIII, Critical IV, Spirit IV, Archery IV' }))),
    sub('buffs-custom', ['Custom bonuses ', countBadge(() => usedRows().length)],
      'Pets effects, potions, accessories, abilities…', [
        h('div', { class: 'table-scroll' }, h('table', { class: 'rows' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Source'), cols.map(([, t]) => h('th', {}, t)), h('th'))),
          body)),
        h('button', { type: 'button', style: 'margin-top:10px', onclick: () => {
          state.bonuses.push({ label: 'New source' }); rerenderForm();
        } }, '+ Add source'),
      ], usedRows().length > 0),
  ]);
}

// Set while the user is editing a preset enemy's stats (the "Edit" link); a new enemy resets it.
let editingEnemy = false;

function chooseEnemy(name) {
  editingEnemy = false;
  const e = ENEMIES.find((x) => x.name === name);
  state.target.enemy = e ? name : '';
  if (e) {
    Object.assign(state.target, {
      mobs: [...e.mobs], families: [...e.families], boss: e.boss, maxHp: e.maxHp || undefined, defense: e.defense, hpPct: 100,
    });
    syncDungeonMode(); // picks a floor the mob spawns on
    applyFloorStats(e);
  }
  rerenderForm();
}

// Regular dungeon mobs: fill Target max HP and defense from the chosen floor (DUNGEON_FLOORS).
function applyFloorStats(e) {
  const stats = floorStats(e, state.dungeonFloor);
  if (stats) Object.assign(state.target, { maxHp: stats.hp, defense: stats.defense });
}

// Dungeon floors for regular dungeon mobs: Entrance, then each Catacombs floor next to its Master
// Mode counterpart (the dropdown shows them as a two-column grid).
const FLOORS = ['E', ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => [`F${n}`, `M${n}`])];
const floorName = (f) => (f === 'E' ? 'Entrance' : f);
const floorNumber = (f) => (f === 'E' ? 0 : Number(f.slice(1)));
// A floor the mob spawns on, as close as possible to `floor`: same mode first (the highest one
// up to it, else the lowest above), then the other mode.
function nearestFloor(e, floor) {
  const master = floor.startsWith('M');
  const have = FLOORS.filter((f) => floorStats(e, f));
  const same = have.filter((f) => f.startsWith('M') === master);
  const pool = same.length ? same : have;
  const below = pool.filter((f) => floorNumber(f) <= floorNumber(floor));
  return below.length ? below[below.length - 1] : pool[0];
}

// The chosen enemy decides where the fight happens; only custom targets are free.
// Regular dungeon mobs/minibosses ('either') are fought on the floor the user picks, which decides
// Catacombs or Master Mode (an unset floor follows the current mode: F7 or M7).
function syncDungeonMode() {
  const e = ENEMIES.find((x) => x.name === state.target.enemy);
  state.dungeonMode = enemyDungeonMode(e, state.dungeonMode);
  if (e?.dungeon === 'either') {
    if (!FLOORS.includes(state.dungeonFloor)) state.dungeonFloor = state.dungeonMode === 'master' ? 'M7' : 'F7';
    if (!floorStats(e, state.dungeonFloor)) state.dungeonFloor = nearestFloor(e, state.dungeonFloor);
    state.dungeonMode = state.dungeonFloor.startsWith('M') ? 'master' : 'catacombs';
  }
}

// In-dungeon switch: drives star bonuses, the Catacombs-level boost and class passives.
function dungeonControls() {
  const inDungeon = state.dungeonMode === 'catacombs' || state.dungeonMode === 'master';
  const set = (mode) => { state.dungeonMode = mode; rerenderForm(); };
  const cata = clampCatacombs(state.catacombsLevel);
  const e = ENEMIES.find((x) => x.name === state.target.enemy);
  const lock = e ? (e.dungeon || 'outside') : null; // null = custom target, user decides

  let controls;
  if (!lock) {
    controls = [
      h('div', { class: 'field location-field' }, h('span', { class: 'field-label' }, 'Location'),
        actionSelect(null, [['none', 'Outside dungeons'], ['catacombs', 'Catacombs'], ['master', 'Master Mode']],
          inDungeon ? state.dungeonMode : 'none', set, { searchable: false, ariaLabel: 'Location' })),
    ];
  } else if (lock === 'either') {
    // Regular dungeon mob: always in a dungeon, user picks the floor (F = Catacombs, M = Master Mode).
    // Floors the mob doesn't spawn on are greyed out.
    const floorOpts = FLOORS.map((f) => ({ value: f, label: f === 'E' ? 'Entrance (F0)' : f, wide: f === 'E', disabled: !floorStats(e, f) }));
    controls = [
      h('span', { class: `badge dungeon${state.dungeonMode === 'master' ? ' master' : ''}` },
        state.dungeonMode === 'master' ? 'In dungeon — Master Mode' : 'In dungeon — Catacombs'),
      h('div', { class: 'field floor-field' }, h('span', { class: 'field-label' }, 'Floor'),
        combo(floorOpts, state.dungeonFloor, (f) => {
          state.dungeonFloor = f;
          state.dungeonMode = f.startsWith('M') ? 'master' : 'catacombs';
          applyFloorStats(e);
          rerenderForm();
        }, { searchable: false, columns: 2, ariaLabel: 'Floor' })),
    ];
  } else {
    const text = { outside: 'Outside dungeons', floor: 'In dungeon — Catacombs', master: 'In dungeon — Master Mode' }[lock];
    controls = [
      h('span', { class: `badge${lock === 'outside' ? '' : ' dungeon'}${lock === 'master' ? ' master' : ''}` }, text),
      h('span', { class: 'muted' }, `set by ${e.name}`)];
  }

  return h('div', { class: 'location' },
    ...controls,
    inDungeon ? h('span', { class: 'hint' }, `Dungeon items +${catacombsBoost(cata)}% (Catacombs ${cata})`) : '',
    inDungeon ? classControls() : '');
}

// Selected dungeon class + level; its damage passive only counts in dungeons.
function classControls() {
  const cls = DUNGEON_CLASSES.find((c) => c.id === state.dungeonClass.id);
  const bow = isBow(byId.get(state.weapon.id));
  const pct = cls ? classDamageBonus(cls.id, state.dungeonClass.level, bow, state.dungeonClass.solo) : 0;
  const effect = !cls ? ''
    : pct ? `${cls.name}: +${fmt(pct, 2)}% ${bow ? 'arrow' : 'melee'} damage (multiplicative)`
      : `${cls.name} has no ${bow ? 'bow' : 'melee'} damage passive`
        + (cls.melee || cls.bow ? ` — its bonus is for ${cls.melee ? 'melee' : 'bows'}` : '');
  return h('div', { class: 'grid wide class-row' },
    selectField('Selected dungeon class', 'dungeonClass.id',
      [['', 'None'], ...DUNGEON_CLASSES.map((c) => [c.id, c.name])], { rerender: true }),
    cls ? numField(`Class level (0–${CLASS_MAX_LEVEL})`, 'dungeonClass.level',
      { min: 0, max: CLASS_MAX_LEVEL, step: 1, rerender: true }) : '',
    cls ? h('label', { class: 'check', style: 'align-self:end', title: 'Class passives are doubled when no one else picked this class' },
      h('input', { type: 'checkbox', checked: !!state.dungeonClass.solo, 'data-path': 'dungeonClass.solo', 'data-rerender': '1' }),
      'No dupes') : '',
    effect ? h('p', { class: 'hint', style: 'grid-column:1/-1;margin:0' }, effect) : '');
}

// Toggle chips for a list field on the target (mob types / creature families).
function targetChips(field, options) {
  return h('div', { class: 'mobs' }, options.map((m) => h('label', {},
    h('input', { type: 'checkbox', checked: (state.target[field] || []).includes(m), onchange: (e) => {
      const cur = state.target[field] || [];
      state.target[field] = e.target.checked ? [...cur, m] : cur.filter((x) => x !== m);
      state.target.enemy = '';
      rerenderForm();
    } }), m)));
}

function targetSection() {
  const groups = [...new Set(ENEMIES.map((e) => e.group))];
  const enemyOpts = [{ value: '', label: 'Custom target', cls: 'muted' },
    ...groups.flatMap((g) => ENEMIES.filter((e) => e.group === g).map((e) => ({
      value: e.name, label: e.name, group: g, cls: e.boss ? 'enemy-boss' : '',
      note: e.maxHp ? `${fmtShort(e.maxHp)} HP` : '',
      search: `${g} ${e.mobs.join(' ')} ${e.families.join(' ')}`,
    })))];
  const enemySelect = actionSelect(null, enemyOpts, state.target.enemy, chooseEnemy,
    { searchable: true, submenus: true, placeholder: 'Search enemy, area or mob type…', ariaLabel: 'Enemy' });
  const chosen = ENEMIES.find((e) => e.name === state.target.enemy);
  const onFloor = floorStats(chosen, state.dungeonFloor); // regular dungeon mobs: stats on the chosen floor
  const desc = chosen ? joinParts([...chosen.mobs, ...chosen.families].join(', '), chosen.boss ? 'boss' : '',
    onFloor ? `${fmt(onFloor.hp)} HP on ${floorName(state.dungeonFloor)}`
      : chosen.maxHp ? `${fmt(chosen.maxHp)} HP` : chosen.hpRange ? `${chosen.hpRange} HP` : '',
    (onFloor ? onFloor.defense : chosen.defense) ? `${fmt(onFloor ? onFloor.defense : chosen.defense)} defense` : '') : '';
  const summary = () => {
    const cls = DUNGEON_CLASSES.find((c) => c.id === state.dungeonClass.id);
    const loc = chosen?.dungeon === 'either' ? floorName(state.dungeonFloor)
      : { none: 'outside dungeons', catacombs: 'Catacombs', master: 'Master Mode' }[state.dungeonMode] || '';
    return joinParts(state.target.enemy || 'Custom target', loc,
      cls && state.dungeonMode !== 'none' ? `${cls.name} ${state.dungeonClass.level ?? 0}` : '');
  };
  const typeCount = () => (state.target.mobs || []).length + (state.target.families || []).length;
  const presetView = !!chosen && !editingEnemy;
  return panel('target', 'Target & fight', summary, [
    h('div', { class: 'grid wide' }, h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Enemy'), enemySelect)),
    // A preset enemy's stats are filled in: show them as this line, with the fields behind "Edit".
    desc ? h('p', { class: 'item-stats enemy-line', style: 'margin:6px 0 14px' }, desc,
      presetView ? h('button', { type: 'button', class: 'link', onclick: () => { editingEnemy = true; rerenderForm(); } }, 'Edit') : '') : '',
    dungeonControls(),
    h('div', { class: 'grid' },
      numField('Target HP %', 'target.hpPct', { min: 0, max: 100 }),
      presetView ? '' : numField('Target max HP', 'target.maxHp', { min: 0 }),
      presetView ? '' : numField('Target defense', 'target.defense', { min: 0 }),
      numField('Your max HP', 'player.maxHp', { min: 0 }),
      presetView ? '' : h('div', { class: 'chips', style: 'align-self:end;padding-bottom:6px' }, chipField('Boss / miniboss', 'target.boss'))),
    presetView ? '' : sub('target-types', ['Enemy types ', countBadge(typeCount)],
      () => [...(state.target.mobs || []), ...(state.target.families || [])].join(', ') || 'none', [
        targetChips('mobs', MOB_TYPES),
        h('h3', {}, 'Creature'),
        targetChips('families', TARGET_FAMILIES),
      ], !state.target.enemy),
    sub('target-situation', 'Situation', () => joinParts(
      state.player.firstHit ? 'first hit' : '', state.player.fullHealth ? 'full health' : '',
      state.player.lowHealth ? 'below 20% HP' : '', state.player.recentlyHit ? 'just hit' : '',
      state.target.attackedYou ? 'target attacked you' : '', state.target.isolated ? 'isolated target' : '',
      { close: 'within 1.5 blocks', far: '3+ blocks away' }[state.target.distance] || '') || 'default', [
      h('div', { class: 'chips' },
        chipField('First hit(s) on mob', 'player.firstHit'),
        chipField('At full health', 'player.fullHealth', { rerender: true }),
        chipField('Below 20% health', 'player.lowHealth', { rerender: true }),
        chipField('Was just hit', 'player.recentlyHit', { rerender: true }),
        chipField('Target has attacked you', 'target.attackedYou'),
        chipField('No other mobs within 15 blocks', 'target.isolated')),
      h('div', { class: 'grid', style: 'margin-top:12px' },
        selectField('Distance to target', 'target.distance',
          [['close', 'Within 1.5 blocks'], ['normal', '1.5–3 blocks'], ['far', 'More than 3 blocks']])),
      // Possible (absorption, a 0-damage hit) but unusual: a hit normally takes you below full health.
      state.player.fullHealth && state.player.recentlyHit
        ? h('p', { class: 'hint', style: 'margin:8px 0 0' }, 'At full health and just hit rarely apply together: taking a hit usually drops you below full health.')
        : '',
    ]),
  ], true);
}

const SECTIONS = [
  ['target', 'Target'], ['weapon', 'Weapon'], ['armor', 'Armor'], ['equipment', 'Equipment'],
  ['pet', 'Pet'], ['accessories', 'Accessories'], ['shards', 'Shards'], ['buffs', 'Buffs & skills'],
];

// Section shortcuts in the top bar: open the panel and scroll to it.
// Header controls: expand / collapse every section. Rendered once; doesn't depend on state.
function renderNav() {
  const nav = document.getElementById('nav');
  if (nav.childElementCount) return;
  const setAll = (open) => SECTIONS.forEach(([key]) => {
    const el = document.getElementById(`panel-${key}`);
    if (el) { el.open = open; rememberOpen(key, open); }
  });
  nav.replaceChildren(
    h('button', { type: 'button', title: 'Expand all sections', onclick: () => setAll(true) }, 'Expand all'),
    h('button', { type: 'button', title: 'Collapse all sections', onclick: () => setAll(false) }, 'Collapse all'),
  );
}

function rerenderForm() {
  syncDungeonMode(); // before rendering: star labels and class controls depend on it
  liveUpdaters.clear();
  const builders = { target: targetSection, weapon: weaponSection, armor: armorSection, equipment: equipmentSection,
    pet: petSection, accessories: accessorySection, shards: shardSection, buffs: bonusSection };
  const form = document.getElementById('config');
  form.replaceChildren(
    ...SECTIONS.map(([key]) => builders[key]()),
    h('div', { style: 'display:flex;justify-content:flex-end' }, h('button', { type: 'button', class: 'ghost', onclick: () =>
      confirmModal({
        title: 'Reset all fields?',
        message: 'This clears your gear, pet, accessories, shards, buffs and target. It can\'t be undone.',
        confirmLabel: 'Reset everything',
        danger: true,
      }).then((ok) => { if (ok) { state = defaultState(); rerenderForm(); } }),
    }, 'Reset all fields')),
  );
  update();
}

// Generic two-way binding via data-path
function onFormInput(e) {
  const el = e.target;
  const path = el.dataset?.path;
  if (!path) return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.dataset.num) v = el.value === '' ? undefined : Number(el.value);
  else v = el.value;
  // Browsers don't stop typing past min/max, so clamp; fix the field once editing is done.
  if (el.type === 'number' && v !== undefined) {
    const clamped = Math.min(el.max === '' ? Infinity : Number(el.max), Math.max(el.min === '' ? -Infinity : Number(el.min), v));
    if (clamped !== v && e.type === 'change') el.value = clamped;
    v = clamped;
  }
  setPath(path, v);
  // You can't be at full health and below 20% health at once: ticking one unticks the other.
  const opposite = { 'player.fullHealth': 'player.lowHealth', 'player.lowHealth': 'player.fullHealth' }[path];
  if (opposite && v) {
    setPath(opposite, false);
    return rerenderForm();
  }
  // Hand-edited target stats no longer match the chosen enemy.
  if (state.target.enemy && /^target\.(boss|maxHp|defense)$/.test(path)) {
    state.target.enemy = '';
    return rerenderForm();
  }
  if (el.dataset.rerender && e.type === 'change') return rerenderForm();
  update();
}

// ---------- results ----------
// The second Blaze Slayer dagger: the one picked, if it fits the main dagger, else the same tier of the other family.
function secondDaggerId() {
  const partner = daggerPartner(state.weapon.id);
  if (!partner) return null;
  const other = DAGGER_FAMILIES[daggerFamily(partner)].ids;
  return other.includes(state.weapon.secondId) ? state.weapon.secondId : partner;
}

function buildInput() {
  const piece = (s) => ({ ...s, item: byId.get(s.id) });
  const second = secondDaggerId();
  return {
    weapon: piece(state.weapon),
    // Mirrors the main dagger's upgrades (enchants, reforge, stars, books).
    weapon2: second && byId.get(second) ? { ...piece(state.weapon), id: second, item: byId.get(second) } : null,
    armor: ARMOR_SLOTS.map((s) => piece(state.armor[s])),
    equipment: EQUIP_SLOTS.map((s) => piece(state.equipment[s.key])),
    magicalPower: state.magicalPower,
    power: state.power,
    tuning: state.tuning,
    accessoryInputs: state.accessoryInputs,
    shards: state.shards,
    pet: resolvedPet(),
    petExtras: state.petExtras,
    combatLevel: state.combatLevel,
    catacombsLevel: state.catacombsLevel,
    dungeonMode: state.dungeonMode,
    godPotion: state.godPotion,
    mayor: state.mayor,
    dungeonClass: state.dungeonClass,
    setInputs: state.setInputs,
    bonuses: state.bonuses,
    target: state.target,
    player: state.player,
  };
}

let lastBow = null;
let lastResult = null; // the latest single-hit result (the set panel reads the player's Speed from it)
function update() {
  saveState();
  if (!items) return;
  const r = calculate(buildInput());
  lastResult = r;
  if (lastBow !== null && lastBow !== r.bow) { lastBow = r.bow; rerenderForm(); return; }
  lastBow = r.bow;

  const mp = state.magicalPower || 0;
  const pm = document.getElementById('power-mult');
  if (pm) pm.textContent = `Power stat multiplier: ×${powerMultiplier(mp).toFixed(2)}`;
  const ti = document.getElementById('tuning-info');
  if (ti) {
    const used = Object.values(state.tuning).reduce((a, b) => a + (b || 0), 0);
    ti.textContent = `${used} / ${tuningPoints(mp)} points`;
  }
  renderResults(r);
  renderPetLore(r);
  for (const fn of liveUpdaters) fn();
  renderNav();
}

function renderResults(r) {
  const statRows = ['DAMAGE', 'STRENGTH', 'CRITICAL_DAMAGE', 'CRITICAL_CHANCE'];
  const breakdown = h('table', { class: 'kv' },
    h('tr', { class: 'head' }, h('td', {}, 'Source'), statRows.map((s) => h('td', {}, STAT_SHORT[s]))),
    r.sources.filter((s) => statRows.some((k) => s.stats[k])).map((s) =>
      h('tr', {}, h('td', {}, s.label), statRows.map((k) => h('td', {}, s.stats[k] ? fmt(s.stats[k], 1) : '')))),
    h('tr', { class: 'total' }, h('td', {}, 'Total'),
      h('td', {}, fmt(r.damage, 1)), h('td', {}, fmt(r.strength, 1)), h('td', {}, fmt(r.critDamage, 1)), h('td', {}, fmt(r.critChance, 1))),
  );
  const list = (rows, fmtV, total) => h('table', { class: 'kv' },
    rows.length ? rows.map((x) => h('tr', {}, h('td', {}, x.label), h('td', {}, fmtV(x.value))))
      : h('tr', {}, h('td', { class: 'muted' }, 'None')),
    h('tr', { class: 'total' }, h('td', {}, 'Multiplier'), h('td', {}, `×${fmt(total, 4)}`)));


  // The damage chain: each step multiplies into the next.
  const step = (k, note, v, cls2 = '') => h('div', { class: `chain-row ${cls2}` },
    h('div', { class: 'k' }, k, note ? h('small', {}, note) : ''), h('div', { class: 'v' }, v));
  const chain = h('div', { class: 'chain' },
    step('Base damage', `(5 + ${fmt(r.damage, 1)} Damage) × (1 + ${fmt(r.strength, 1)}% Strength)`, fmt(r.initial, 1)),
    step('Additive bonuses', `${r.additive.length} source${r.additive.length === 1 ? '' : 's'}`, `×${fmt(r.additiveMult, 3)}`),
    step('Multiplicative bonuses', `${r.multiplicative.length} source${r.multiplicative.length === 1 ? '' : 's'}`, `×${fmt(r.multMult, 3)}`),
    r.defense ? step('Target defense', `100 / (100 + ${fmt(r.defense)})`, `×${fmt(r.defenseMult, 3)}`) : '',
    step('Non-crit hit', '', fmt(r.nonCrit), 'total'),
    step('Crit multiplier', `1 + ${fmt(r.critDamage, 1)}% Crit Damage${r.soulEaterStr ? ' (+ Soul Eater Strength)' : ''}`, `×${fmt(r.critMult, 3)}`),
  );

  const card = (title, ...body) => h('section', { class: 'card glass' }, h('h2', {}, title), ...body);
  const detail = (key, title, summary, body, open = false) => sub(`res-${key}`, title, summary, body, open);

  renderHero(r);

  document.getElementById('results').replaceChildren(
    card('How it adds up', chain),
    card('Your stats',
      h('div', { class: 'stat-tiles' },
        [['Damage', r.damage], ['Strength', r.strength], ['Crit Dmg', r.critDamage], ['Crit Chance', r.critChance]]
          .map(([k, v]) => h('div', {}, h('b', {}, fmt(v, 1)), h('span', {}, k)))),
      detail('stats', 'Where stats come from', `${r.sources.filter((s) => statRows.some((k) => s.stats[k])).length} sources`, breakdown),
      detail('additive', 'Additive bonuses', `×${fmt(r.additiveMult, 3)}`, list(r.additive, (v) => `+${fmt(v, 2)}%`, r.additiveMult)),
      detail('mult', 'Multiplicative bonuses', `×${fmt(r.multMult, 3)}`, list(r.multiplicative, (v) => `×${fmt(v, 3)}`, r.multMult)),
      detail('formula', 'Full formula', '', h('div', { class: 'formula' },
        `(5 + ${fmt(r.damage, 1)}) × (1 + ${fmt(r.strength, 1)}/100)`, h('br'),
        `= ${fmt(r.baseDamage, 1)} × ${fmt(r.strengthMult, 4)} = ${fmt(r.initial, 1)}`, h('br'),
        `× additive ${fmt(r.additiveMult, 4)} × mult ${fmt(r.multMult, 4)}`,
        r.defense ? ` × defense 100/(100 + ${fmt(r.defense)})` : '', h('br'),
        `= ${fmt(r.nonCrit)} non-crit`, h('br'),
        `× crit (1 + ${fmt(r.critDamage, 1)}/100) = ${fmt(r.crit)}`))),
    r.notes.length ? card('Notes', h('ul', { class: 'notes' }, r.notes.map((n) => h('li', {}, n)))) : '',
  );

}

// Final damage panel in the top-right corner: always visible while editing anywhere on the page.
let lastHero = null;
function renderHero(r) {
  const changed = (k) => lastHero && lastHero[k] !== r[k];
  const num = (k, cls) => h('div', { class: `hero-num ${cls}${changed(k) ? ' bump' : ''}` }, fmt(r[k]));
  document.getElementById('hero').replaceChildren(
    h('div', { class: 'hero-stat crit' }, h('span', { class: 'hero-lbl' }, 'Critical hit'), num('crit', 'crit')),
    h('div', { class: 'hero-row' },
      h('div', { class: 'hero-stat' }, h('span', { class: 'hero-lbl' }, 'Non-crit'), num('nonCrit', '')),
      h('div', { class: 'hero-stat' }, h('span', { class: 'hero-lbl' }, `Average · ${fmt(r.critChance, 1)}% crit`), num('expected', 'avg'))),
    h('button', { type: 'button', class: 'primary sim-btn', onclick: startSimulation },
      h('span', { class: 'play', 'aria-hidden': 'true' }), 'Simulate'),
  );
  lastHero = { crit: r.crit, nonCrit: r.nonCrit, expected: r.expected };
}

// ---------- continuous damage simulation ----------
// "Don't ask again" lasts until the page is reloaded (kept in memory only).
let skipSimConfirm = false;
async function startSimulation() {
  if (!skipSimConfirm) {
    const dontAsk = h('input', { type: 'checkbox' });
    const ok = await confirmModal({
      title: 'Start simulation?',
      message: 'The simulation uses everything you have entered. Have you filled in all the details you want included?',
      confirmLabel: 'Simulate', cancelLabel: 'Not yet',
      extra: h('label', { class: 'check modal-check' }, dontAsk, 'Do not ask me this again'),
    });
    if (!ok) return;
    skipSimConfirm = dontAsk.checked;
  }
  openSimScreen();
}

// A short fake load when the screen opens, for suspense.
const SIM_LOAD_MS = 1400;

function openSimScreen() {
  const body = h('div', { class: 'sim-body' },
    h('div', { class: 'sim-loader', role: 'status' },
      h('div', { class: 'sim-spinner', 'aria-hidden': 'true' }, Array.from({ length: 8 }, (_, i) => h('i', { style: `--i:${i}` }))),
      h('span', {}, 'Preparing simulation…')));
  const dialog = h('dialog', { class: 'modal glass sim-screen', 'aria-labelledby': 'sim-title' },
    h('div', { class: 'sim-head' },
      h('h2', { id: 'sim-title' }, 'Simulation'),
      h('button', { type: 'button', class: 'ghost', onclick: () => dialog.close() }, 'Close')),
    body);
  setTimeout(() => { if (dialog.open) renderSim(body); }, SIM_LOAD_MS);
  dialog.addEventListener('close', () => { stopSimPlayback(); dialog.remove(); });
  // Clicking the backdrop closes it, as with the confirmation modal.
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
}

// The fight plays back in real time (or 2× / 4×). Settings on top restart it; the action
// indicator on the left lights up for 100 ms whenever its action happens; the middle stays empty
// for a graphic. Changing a setting re-runs with the same seed; "Restart" re-rolls.
let simSeed = 1;
let simTimer = 0;
const SIM_FLASH_MS = 100;
const stopSimPlayback = () => { clearInterval(simTimer); simTimer = 0; };

function renderSim(body) {
  stopSimPlayback();
  const o = state.sim;
  const restart = () => renderSim(body);
  const set = (key, v) => { o[key] = v; saveState(); restart(); };
  const num = (label, key, min, max) => h('label', { class: 'field' }, label,
    h('input', { type: 'number', min, max, step: 1, value: o[key],
      onchange: (e) => set(key, Math.min(max, Math.max(min, Number(e.target.value) || min))) }));
  const segmented = (name, options, value, onPick) => h('div', { class: 'segmented' }, options.map(([v, label]) =>
    h('label', {}, h('input', { type: 'radio', name, checked: value === v, onchange: () => onPick(v) }), label)));

  const s = simulate(buildInput(), { ...o, seed: simSeed });
  const events = s.error ? [] : s.events;
  let paused = false;
  const playBtn = h('button', { type: 'button', class: 'primary', onclick: () => {
    paused = !paused;
    playBtn.textContent = paused ? 'Play' : 'Pause';
  } }, 'Pause');

  const settings = h('div', { class: 'sim-settings' },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Fight'),
      segmented('sim-mode', [['duration', 'Fixed duration'], ['kill', 'Until enemy dies']], o.mode, (v) => set('mode', v))),
    o.mode === 'duration' ? num('Duration (s)', 'duration', 1, 600) : '',
    num('Enemy HP %', 'enemyHpPct', 1, 100),
    num('Your HP %', 'playerHpPct', 1, 100),
    h('div', { class: 'chips' }, h('label', { title: 'Health and incoming damage are not simulated yet' },
      h('input', { type: 'checkbox', checked: o.godMode, onchange: (e) => { o.godMode = e.target.checked; saveState(); } }), 'God mode')),
    h('div', { class: 'sim-controls' },
      segmented('sim-speed', [[1, '1×'], [2, '2×'], [4, '4×']], o.speed, (v) => { o.speed = v; saveState(); }),
      playBtn,
      h('button', { type: 'button', onclick: () => { simSeed++; restart(); } }, 'Restart')));

  // Action indicator, like a switch's status lights: an LED and its label flash together.
  const flash = (el) => {
    el.classList.add('on');
    clearTimeout(el.flashTimer);
    el.flashTimer = setTimeout(() => el.classList.remove('on'), SIM_FLASH_MS);
  };
  // names: the bonuses this row can show ("A | B | C"); each lights with the row when it procs.
  const proc = (label, names = []) => {
    const tags = new Map(names.map((n) => [n, h('span', {}, n)]));
    const list = names.length ? h('span', { class: 'sim-bonuses' },
      [...tags.values()].flatMap((t, i) => (i ? [h('span', { class: 'sep', 'aria-hidden': 'true' }, '|'), t] : [t]))) : '';
    const row = h('li', {}, h('i', { class: 'led', 'aria-hidden': 'true' }), h('span', {}, label, list));
    return {
      row,
      fire(fired = []) {
        flash(row);
        for (const n of fired) if (tags.has(n)) flash(tags.get(n));
      },
    };
  };
  const bonusNames = [...new Set(events.flatMap((e) => e.bonuses))];
  const procs = {
    hit: proc('Player hit'), ferocity: proc('Ferocity proc'), swipe: proc('Swipe proc'), bonus: proc('Other bonus proc', bonusNames),
  };
  // Boss phases (only those this fight has): lit for as long as the phase lasts, not flashed.
  const PHASE_LABELS = {
    shield: 'Hitshield', laser: 'Broken Heart Radiation', glyph: 'Yang Glyph', heads: 'Nukekubi Fixations',
    leap: 'Backstab', web: 'Web of Lies', brood: 'Conjoined Brood',
    hellion: 'Hellion Shield', split: 'Demonsplit', pillar: 'Fire Pillar', swap: 'Dagger swap',
    pups: 'Call the pups!',
    crystal: 'End Crystal', skulls: 'Summoned Skulls', reflect: 'Damage Shield',
  };
  const phases = s.phases || [];
  // Every phase the boss can have, so the list doesn't change with how the fight went.
  const phaseRows = Object.entries(PHASE_LABELS).filter(([k]) => (s.phaseKinds || []).includes(k))
    .map(([k, label]) => {
      // A phase can name what's happening (e.g. the shield's attunement and the dagger in hand).
      const detail = h('span', { class: 'sim-bonuses' });
      return { k, detail, row: h('li', {}, h('i', { class: 'led', 'aria-hidden': 'true' }), h('span', {}, label, detail)) };
    });

  const readout = (k) => {
    const v = h('b', {}, '—');
    const label = h('span', {}, k);
    return { v, label, el: h('div', {}, v, label) };
  };
  const time = readout(s.mode === 'kill' ? 'Time' : `Time (of ${fmt(s.seconds)} s)`);
  const dmg = readout('Damage');
  const dps = readout('Damage / s');
  // The chosen enemy's name (the health bar says the rest), or whatever is being hit instead (a demon, a pup, the Brood).
  const enemyName = state.target.enemy || 'Enemy';
  const hpRead = readout(enemyName);
  const hpBar = h('i', { style: 'width:100%' });
  if (s.maxHp) hpRead.el.append(h('span', { class: 'sim-hpbar' }, hpBar)); // a span: tile divs get tile styling

  body.replaceChildren(settings,
    h('div', { class: 'sim-main' },
      h('div', { class: 'sim-indicators' },
        h('ul', { class: 'sim-procs', 'aria-label': 'Actions' }, Object.values(procs).map((p) => p.row)),
        phaseRows.length ? h('ul', { class: 'sim-procs', 'aria-label': 'Boss phases' }, phaseRows.map((p) => p.row)) : ''),
      h('div', { class: 'sim-stage' }, s.error ? h('p', { class: 'hint' }, s.error) : '')),
    h('div', { class: 'stat-tiles sim-status' }, time.el, dmg.el, dps.el, hpRead.el));
  if (s.error) return;

  // Playback: advance the fight clock by real time × speed and replay every event it passes.
  let i = 0;
  let clock = 0;
  let total = 0;
  let last = null;
  // The fight runs to its end (kill or duration), so phases after the last hit still play out.
  const fightEnd = s.killedAt ?? s.seconds;
  // Damage / s changes only when a hit lands (set in frame); the rest updates every frame.
  const show = () => {
    const end = i >= events.length && clock >= fightEnd;
    const t = Math.min(clock, fightEnd);
    time.v.textContent = `${fmt(t, 1)} s`;
    dmg.v.textContent = fmt(total);
    if (end) dps.v.textContent = fmt(s.dps);
    if (s.maxHp) {
      // Each event carries the current boss's max HP (it changes when the Conjoined Brood takes over).
      const e = i ? events[i - 1] : null;
      const hp = e ? e.hp : s.startHp;
      hpRead.v.textContent = fmt(hp);
      const label = e?.target || enemyName;
      if (hpRead.label.textContent !== label) hpRead.label.textContent = label;
      hpBar.style.width = `${hp / (e?.maxHp || s.maxHp) * 100}%`;
    } else hpRead.v.textContent = '—';
  };
  // A ~60 fps timer reading the real clock (keeps going in a background tab, unlike animation frames).
  const frame = () => {
    const now = performance.now();
    if (last !== null && !paused) clock += (now - last) / 1000 * o.speed;
    last = now;
    while (i < events.length && events[i].t <= clock) {
      const e = events[i++];
      total = e.total;
      // Average so far, as of this hit (blank for the first second, when it would swing wildly).
      dps.v.textContent = e.t >= 1 ? fmt(total / e.t) : '—';
      // Ferocity strikes arrive as their own event a moment after the hit.
      if (!e.feroOnly) procs.hit.fire();
      if (e.ferocity) procs.ferocity.fire();
      if (e.swipe) procs.swipe.fire();
      if (e.bonuses.length) procs.bonus.fire(e.bonuses);
    }
    for (const { k, row, detail } of phaseRows) {
      const now = phases.find((p) => p.kind === k && clock >= p.start && clock < p.end);
      row.classList.toggle('on', !!now);
      if (now?.detail && detail.textContent !== now.detail) detail.textContent = now.detail;
    }
    show();
    if (i >= events.length && clock >= fightEnd) {
      for (const { row } of phaseRows) row.classList.remove('on');
      stopSimPlayback();
      playBtn.disabled = true;
      playBtn.textContent = s.killedAt !== null ? 'Killed' : s.despawned ? 'Despawned' : 'Done';
    }
  };
  show();
  simTimer = setInterval(frame, 16);
}

// Keep layout offsets in sync with the header and the corner damage panel (their heights vary
// with content and screen width): --header-h and --hero-h drive the results column position.
function trackHeaderHeight() {
  const root = document.documentElement.style;
  const watch = (id, prop) => {
    const el = document.getElementById(id);
    const set = () => root.setProperty(prop, `${el.getBoundingClientRect().height}px`); // unrounded
    new ResizeObserver(set).observe(el);
    set();
  };
  watch('topbar', '--header-h');
  watch('hero', '--hero-h');
}

// Summary column: fade its top / bottom edge while there is more content scrolled out of view
// that way (classes drive a CSS mask). Re-checked on scroll, resize and whenever the results
// re-render or a breakdown is opened or closed.
function trackResultsOverflow() {
  const el = document.getElementById('results');
  const set = () => {
    el.classList.toggle('more-above', el.scrollTop > 0);
    el.classList.toggle('more-below', el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  };
  el.addEventListener('scroll', set, { passive: true });
  new ResizeObserver(set).observe(el);
  new MutationObserver(set).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
  set();
}

// ---------- mayors ----------
// Special mayors that change a hit (calc.js applies them).
const MAYORS = { derpy: 'Derpy', jerry: 'Jerry' };
const MAYOR_EFFECTS = { derpy: '2× mob health', jerry: '+10% combat stats' };

// ---------- theme ----------
// The logo switches between the light and dark theme. index.html applies the saved (or system)
// theme before the first paint; this wires up the button and saves the choice. The new theme
// wipes in through a view transition while the logo turns (logo.js), where the browser supports it.
const THEME_KEY = 'dpscalc.theme';
function initThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  const root = document.documentElement;
  const isDark = () => root.dataset.theme === 'dark';
  const turnLogo = initLogo(btn, isDark());
  const paint = () => {
    btn.setAttribute('aria-pressed', String(isDark()));
    btn.title = isDark() ? 'Switch to light theme' : 'Switch to dark theme';
  };
  const apply = (dark) => {
    if (dark) root.dataset.theme = 'dark'; else delete root.dataset.theme;
    paint();
  };
  btn.addEventListener('click', () => {
    const dark = !isDark();
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* private mode */ }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduced) {
      turnLogo(dark, reduced ? 0 : 500);
      return apply(dark);
    }
    // The wipe direction (style.css): down into the dark theme, back up to the light one.
    const wipe = dark ? 'down' : 'up';
    root.dataset.themeWipe = wipe;
    const transition = document.startViewTransition(() => apply(dark));
    // Start the logo turn when the wipe starts (after the old page has been captured).
    transition.ready.then(() => turnLogo(dark, 500), () => turnLogo(dark, 500));
    transition.finished.finally(() => {
      if (root.dataset.themeWipe === wipe) delete root.dataset.themeWipe; // not if a newer one started
    });
  });
  paint();
}

// ---------- boot ----------
async function boot(force = false) {
  const status = document.getElementById('api-status');
  status.className = 'api-status';
  status.textContent = 'Loading items from Hypixel API…';
  try {
    items = await loadItems({ force });
    byId.clear();
    for (const i of [...items.weapons, ...Object.values(items.armor).flat(), ...Object.values(items.equipment).flat()]) byId.set(i.id, i);
    status.title = `${fmt(byId.size)} items from the Hypixel API, updated ${new Date(items.lastUpdated).toLocaleDateString()}`;
    status.replaceChildren(
      `${fmt(byId.size)} items`,
      h('button', { type: 'button', title: 'Reload item data from the Hypixel API', onclick: () => boot(true) }, 'Refresh'));
    rerenderForm();
  } catch (err) {
    status.className = 'api-status error';
    status.replaceChildren(`Could not load items: ${err.message}`, h('button', { type: 'button', onclick: () => boot(true) }, 'Retry'));
    return;
  }
  // Pet data is optional; the calculator works without it.
  try {
    pets = await loadPets({ force });
  } catch (err) {
    pets = { error: err.message };
  }
  rerenderForm();
}

const form = document.getElementById('config');
form.addEventListener('input', onFormInput);
form.addEventListener('change', onFormInput);
form.addEventListener('submit', (e) => e.preventDefault());
trackHeaderHeight();
trackResultsOverflow();
initThemeToggle();
boot();
