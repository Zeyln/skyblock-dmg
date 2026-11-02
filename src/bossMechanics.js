// What each boss mechanic block does, defined once by kind. Enemies list their blocks (parameter
// blocks from data/bosses.js); everything about a mechanic is read from its definition here:
//   rows: the indicator rows it owns, in order (or (block) => rows), each { label, band (a graph
//     band; default true), tag (the nametag status line while its phase is active: (phase, clock) =>
//     [text, colour, bold]), when (fight) => whether this fight shows the row }
//   note (block, fight) => a line for the fight's notes
//   phases (block) => phases on a fixed clock ({ kind, start, end, detail }), dropped if the fight ends first
//   lines (block) => HP fractions where it acts, as the boss's health falls past them; gate: crossing
//     one starts a phase that stops damage to the boss, so Ferocity strikes still on their way after
//     the hit or strike that crossed it are absorbed; cap: that hit or strike's damage also stops at
//     the line (no phase skipping)
//   despawnS (block) => seconds, regen (block) => fraction of max health healed a second
//   wipe: true for a timer that wipes the fight unless dealt with (it can be clutched)
// Rows show in the order of the enemy's blocks, then Clutch.
import { ENEMIES, WEB_SWAP_S, HEAD_LOOK_S, HEAD_BATCH, LEAP_AIM_S } from './data/mechanics.js';

// Hellion Shield attunements in their in-game colours (nametag colour codes).
const ATTUNE = { Ashen: '7', Spirit: 'f', Auric: 'e', Crystal: 'b' };

export const MECHANICS = {
  despawn: { despawnS: (b) => b.seconds },
  regen: { regen: (b) => b.perSecond, note: (b) => `natural regeneration of 1/${Math.round(1 / b.perSecond)} of max health a second` },
  hitshield: {
    gate: true, cap: true, lines: (b) => b.at.filter((f) => f < 1), // 1: up on spawn
    rows: { shield: { label: 'Hitshield' } },
    note: () => 'Ferocity strikes are counted as Hitshield hits',
  },
  beams: { gate: true, cap: true, lines: (b) => b.at, rows: { laser: { label: 'Broken Heart Radiation', tag: () => ['IMMUNE', 'c', true] } } },
  nukekubiHeads: {
    lines: (b) => [b.from], rows: { heads: { label: 'Nukekubi Fixations' } },
    note: (b) => `a head every ${b.every} s, looked at ${HEAD_LOOK_S} s each once ${HEAD_BATCH} are up`,
  },
  backstab: {
    rows: { leap: { label: 'Backstab' } },
    note: (b) => `a Backstab leap every ${b.every} s (assumed) costs ${LEAP_AIM_S * 1000} ms re-aiming`,
  },
  webOfLies: {
    gate: true, lines: (b) => b.at, rows: { web: { label: 'Web of Lies' } },
    note: (b) => `Web of Lies costs ${WEB_SWAP_S} s to swap and re-engage plus ${b.hits} shortbow shots at the egg sacs`,
  },
  conjoinedBrood: { rows: { brood: { label: 'Conjoined Brood' } }, note: () => 'natural regeneration is not modelled' },
  hellionShield: {
    note: (b, fight) => (fight.weapons < 2 ? 'only one dagger: hits on the wrong attunement lose 99% of their damage' : null),
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
  demonsplit: {
    gate: true, lines: (b) => b.at, rows: { split: { label: 'Demonsplit' } },
    note: () => 'fire pits and demon beams are dodged; despawn after 4 minutes is assumed',
  },
  daggerSwaps: { rows: { swap: { label: 'Dagger swap', when: (fight) => fight.weapons > 1 } }, note: (b) => `dagger swaps take ${b.seconds * 1000} ms` },
  callThePups: { gate: true, lines: (b) => [b.at], rows: { pups: { label: 'Call the pups!', tag: () => ['Protected', 'c'] } } },
  outlawSpecials: {
    gate: true, lines: (b) => Array.from({ length: b.steps - 1 }, (_, i) => (i + 1) / b.steps), // every 1/steps lost
    rows: {
      crystal: { label: 'End Crystal' },
      skulls: { label: 'Summoned Skulls', tag: (p, clock) => (clock < p.start + 1 ? ['Invulnerable', '5'] : null) },
      reflect: { label: 'Damage Shield', tag: () => ['SHIELD', 'b', true] },
    },
  },
  // On a clock, and tanked, so only shown.
  enrage: {
    rows: { enrage: { label: 'Enrage' } },
    phases: (b) => [
      { kind: 'enrage', start: b.at, end: b.at + b.mad, detail: 'Mad' },
      { kind: 'enrage', start: b.at + b.mad, end: b.at + b.mad + b.enraged, detail: 'Enraged' },
    ],
    note: (b) => `Enrage (Mad at ${b.at} s, Enraged ${b.mad} s later for ${b.enraged} s) is tanked, so it costs no time`,
  },
  // One row per timer, named by the block.
  wipeTimer: {
    wipe: true, lines: (b) => (b.from != null ? [b.from] : []),
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

// Every HP line the mechanics act at, in block order: { f, b (the block), gate, cap }.
export const hpLines = (blocks) => defs(blocks).flatMap(([b, m]) => (m.lines?.(b) || []).map((f) => ({ f, b, gate: !!m.gate, cap: !!m.cap })));

// Phases on a fixed clock (each definition's phases).
export const scheduledPhases = (blocks) => defs(blocks).flatMap(([b, m]) => m.phases?.(b) || []);

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
