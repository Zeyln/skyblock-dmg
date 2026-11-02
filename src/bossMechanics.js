// What each boss mechanic block does, defined once by kind. Enemies list their blocks (parameter
// blocks from data/bosses.js); everything about a mechanic is read from its definition here:
//   rows: the indicator rows it owns, in order (or (block) => rows), each { label, band (a graph
//     band; default true), tag (the nametag status line while its phase is active: (phase, clock) =>
//     [text, colour, bold]), when (fight) => whether this fight shows the row }
//   note (block, fight) => a line for the fight's notes
//   despawnS (block) => seconds, regen (block) => fraction of max health healed a second
//   wipe: true for a timer that wipes the fight unless dealt with (it can be clutched)
// Rows show in the order of the enemy's blocks, then Clutch.
import { ENEMIES } from './data/mechanics.js';

// Hellion Shield attunements in their in-game colours (nametag colour codes).
const ATTUNE = { Ashen: '7', Spirit: 'f', Auric: 'e', Crystal: 'b' };

export const MECHANICS = {
  despawn: { despawnS: (b) => b.seconds },
  regen: { regen: (b) => b.perSecond, note: (b) => `natural regeneration of 1/${Math.round(1 / b.perSecond)} of max health a second` },
  hitshield: { rows: { shield: { label: 'Hitshield' } } },
  beams: { rows: { laser: { label: 'Broken Heart Radiation', tag: () => ['IMMUNE', 'c', true] } } },
  nukekubiHeads: { rows: { heads: { label: 'Nukekubi Fixations' } } },
  backstab: { rows: { leap: { label: 'Backstab' } } },
  webOfLies: { rows: { web: { label: 'Web of Lies' } } },
  conjoinedBrood: { rows: { brood: { label: 'Conjoined Brood' } } },
  hellionShield: {
    rows: {
      hellion: {
        label: 'Hellion Shield', band: false,
        tag: (p) => {
          const att = p.detail.split(' · ')[0];
          return [att.toUpperCase(), ATTUNE[att] || 'f', true];
        },
      },
    },
  },
  demonsplit: { rows: { split: { label: 'Demonsplit' } } },
  daggerSwaps: { rows: { swap: { label: 'Dagger swap', when: (fight) => fight.weapons > 1 } } },
  callThePups: { rows: { pups: { label: 'Call the pups!', tag: () => ['Protected', 'c'] } } },
  outlawSpecials: {
    rows: {
      crystal: { label: 'End Crystal' },
      skulls: { label: 'Summoned Skulls', tag: (p, clock) => (clock < p.start + 1 ? ['Invulnerable', '5'] : null) },
      reflect: { label: 'Damage Shield', tag: () => ['SHIELD', 'b', true] },
    },
  },
  enrage: { rows: { enrage: { label: 'Enrage' } } },
  // One row per timer, named by the block.
  wipeTimer: {
    wipe: true,
    rows: (b) => ({ [b.row]: { label: b.label, ...(b.tag ? { tag: () => b.tag } : {}) } }),
    note: (b) => b.note,
  },
};

// Clutch: shown for any enemy with a wipe timer.
const CLUTCH_ROW = { clutch: { label: 'Clutch', band: false } };

const defs = (blocks) => blocks.map((b) => [b, MECHANICS[b.kind]]).filter(([, m]) => m);
const rowsOf = (b, m) => (typeof m.rows === 'function' ? m.rows(b) : m.rows || {});

// Every row any enemy's mechanics have, by phase kind.
export const PHASE_ROWS = Object.assign({}, ...ENEMIES.flatMap((e) => defs(e.blocks).map(([b, m]) => rowsOf(b, m))), CLUTCH_ROW);
export const PHASE_LABELS = Object.fromEntries(Object.entries(PHASE_ROWS).map(([k, r]) => [k, r.label]));

// The indicator rows (phase kinds) an enemy with these blocks shows, in order. fight: { weapons }.
export function phaseKinds(blocks, fight = {}) {
  const kinds = defs(blocks).flatMap(([b, m]) => Object.entries(rowsOf(b, m)).filter(([, r]) => !r.when || r.when(fight)).map(([k]) => k));
  if (defs(blocks).some(([, m]) => m.wipe)) kinds.push('clutch');
  return kinds;
}

// The notes the mechanics add to a fight.
export const blockNotes = (blocks, fight = {}) => defs(blocks).map(([b, m]) => m.note?.(b, fight)).filter(Boolean);

// Despawn time in seconds (null: none), and the share of max health healed a second.
export const despawnSeconds = (blocks) => defs(blocks).map(([b, m]) => m.despawnS?.(b)).find((x) => x != null) ?? null;
export const regenPerSecond = (blocks) => defs(blocks).reduce((sum, [b, m]) => sum + (m.regen?.(b) || 0), 0);

// The nametag status for the phases active at clock: the first row (in the enemy's order) whose tag has one.
export function nametagStatus(kinds, phases, clock) {
  for (const k of kinds) {
    const tag = PHASE_ROWS[k]?.tag;
    if (!tag) continue;
    const p = phases.find((x) => x.kind === k && clock >= x.start && clock < x.end);
    const out = p && tag(p, clock);
    if (out) return out;
  }
  return null;
}

// Temporary, while the simulation moves over to blocks: the boss object it reads, from the blocks.
const LEGACY = {
  hitshield: (b) => ({ shield: { hits: b.hits, at: b.at }, feroDivisor: b.feroDivisor, tier: b.terminator ? 4 : 0 }),
  beams: (b) => ({ lasers: { at: b.at, immune: b.immune } }),
  nukekubiHeads: (b) => ({ heads: { from: b.from, every: b.every } }),
  backstab: (b) => ({ leaps: { every: b.every } }),
  webOfLies: (b) => ({ webs: { at: b.at, hits: b.hits } }),
  conjoinedBrood: (b) => ({ brood: { hpMult: b.hpMult } }),
  hellionShield: () => ({ hellion: true }),
  demonsplit: (b) => ({ split: { at: b.at, demonHp: b.demonHp } }),
  callThePups: (b) => ({ pups: { at: b.at, count: b.count, every: b.every, hpFrac: b.hpFrac } }),
  outlawSpecials: ({ kind, ...o }) => ({ outlaw: o }),
  enrage: ({ kind, ...o }) => ({ enrage: o }),
};
export function legacyBoss(blocks) {
  if (!blocks.length) return null;
  return Object.assign({ blocks }, ...blocks.map((b) => LEGACY[b.kind]?.(b) || {}));
}
