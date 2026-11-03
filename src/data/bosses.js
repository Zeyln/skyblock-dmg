// Boss mechanics as data: their numbers (from the wiki and forums, notes below) and the parameter
// blocks enemies are built from. What each block kind does in a fight is in bossMechanics.js.
// No imports: data/mechanics.js (the enemy list) and the simulation both read from here.

// Voidgloom Seraph, from its wiki page (Oct 2026). HP thresholds are fractions of max HP.
//   Hitshield: on spawn and at 2/3 and 1/3; takes no damage until it has taken this many hits. Ferocity
//     strikes are counted as hits (the wiki only says Ferocity is weakened while the shield is down).
//   Ferocity is divided by 4 while the shield is down.
//   No phase skipping (Apr 2024): the damage that crosses a Hitshield or beam threshold is capped at it,
//     so the next phase always starts. A Hitshield due while the beams are up starts once they end,
//     with no Yang Glyphs until it is down (wiki).
//   Broken Heart Radiation (T4): at 5/6, 1/2 and 1/6 the boss sits for 8 s, immune from the start (the
//     beams "activate instantly" since a patch players report on the Hypixel forum, which ended
//     hitting through their start). Ferocity strikes still on their way when it starts do nothing.
//   Yang Glyphs: from 1/2 (T2) or 2/3 (T3+); held 2 s then thrown, one every 8 s (an older wiki
//     figure; T3+ are said to throw "more often"), never while the shield is up. Breaking one takes
//     the player GLYPH_BREAK_S, with no hits meanwhile.
//   Nukekubi Fixations (T3+): from 1/3, a head every 6 s (older wiki figure; max 6 alive). A head goes
//     after being looked at for HEAD_LOOK_S, with no hits meanwhile. The player lets heads pile up to
//     HEAD_BATCH, then looks at them all.
// The player's own pauses (glyphs, heads) happen one after another, never at the same time.
//   Hitshield on T4, or any tier above TERMINATOR_MP: the player swaps to a Terminator with explosive
//     arrows and shoots the ground under the boss, with no melee hits meanwhile. Every shot is
//     TERMINATOR_ARROWS arrows at the shortbow fire rate; the arrows themselves miss, and each one's
//     explosion is a hit plus its Ferocity strikes (stats with the Terminator held; the shield is up, so
//     Ferocity isn't divided).
export const GLYPH_BREAK_S = [0.5, 0.75];
// Wipe timers (wiki): a Yang Glyph not broken within 5 s of landing, or a Fire Pillar within 7 s, deals
// 1000 × Max Health as True Damage to everyone fighting the boss (the wipeTimer blocks' `wipe`). A
// clutch: when the boss dies before the timer runs out anyway, the player keeps hitting and leaves it alone.
export const TERMINATOR_MP = 900;
export const TERMINATOR_ARROWS = 3;
export const HEAD_LOOK_S = 0.5;
export const HEAD_BATCH = 2;
// Tarantula Broodfather, from its wiki page and the 0.23.2 patch notes (Oct 2026):
//   Backstab: the boss leaps behind the player; the player loses LEAP_AIM_S re-aiming. The wiki says
//     only "occasionally": one leap every 5 s is assumed.
//   Web of Lies (T3+): at 66% and 33% the boss leaps away behind webs with egg sacs above it (2 × 3 /
//     3 × 6 / 4 × 9 hits for T3–T5). The player takes WEB_SWAP_S to swap to a shortbow and re-engage, then
//     shoots the sacs; Piercing hits every sac, so it takes one sac's hits in shots, no melee meanwhile.
//   Till Death Do Us Part (T5): killing it summons the Conjoined Brood with twice its health, which
//     only uses the passives (Backstab). T5's natural regeneration has no published rate: left out.
//   Bat Barrage only stops magic damage. Slayer bosses despawn after despawnS (3 min here, 4 for Voidgloom).
// Inferno Demonlord, from its wiki page (Oct 2026):
//   Hellion Shield (T2+): the boss and its demons take 99% less damage unless hit by a Blaze Slayer
//     dagger attuned like the shield; Ferocity never gets through, enchant damage (Thunderlord, Crimson
//     swipes) does. Every 8 matching hits the boss's shield moves on: Ashen > Spirit > Auric > Crystal.
//   Demonsplit: at 1/2 (T1–T2) or 2/3 and 1/3 (T3–T4) the boss splits into Quazii and Typhoeus
//     (demonHp each); its own HP waits until both are dead. Only one demon can be hurt at a time; on T2+
//     each has a shield (Quazii Spirit/Crystal, Typhoeus Ashen/Auric) and every 8 matching hits the
//     damageable demon switches, starting with Quazii on Spirit. On T1, Quazii first, then Typhoeus.
//   Fire Pillars (T2+, from 1/2 on T2, 2/3 on T3–T4): every 20 s a fireball is held 3.5 s, then lands as a
//     pillar the player reaches in PILLAR_REACH_S and breaks with 8 hits, no hits on the boss meanwhile.
//   DDR Apocalypse and the demons' beams and fire trails are dodged at no cost. Despawn time isn't
//     published: 4 minutes is assumed.
// Each attunement change is a dagger swap or attunement toggle taking DAGGER_SWAP_S.
export const HELLION_ORDER = ['ASHEN', 'SPIRIT', 'AURIC', 'CRYSTAL'];
export const HELLION_SWITCH_HITS = 8;
export const HELLION_REDUCTION = 0.99;
export const DAGGER_SWAP_S = 0.15;
export const PILLAR_REACH_S = 0.5;
// The two Blaze Slayer dagger families, tier by tier, and the attunements each can take.
export const DAGGER_FAMILIES = {
  fire: { ids: ['FIREDUST_DAGGER', 'BURSTFIRE_DAGGER', 'HEARTFIRE_DAGGER'], attunes: ['ASHEN', 'AURIC'] },
  twilight: { ids: ['MAWDUST_DAGGER', 'BURSTMAW_DAGGER', 'HEARTMAW_DAGGER'], attunes: ['SPIRIT', 'CRYSTAL'] },
};
export const daggerFamily = (id) => Object.keys(DAGGER_FAMILIES).find((f) => DAGGER_FAMILIES[f].ids.includes(id)) || null;
// The other family's dagger of the same tier (the default second dagger).
export function daggerPartner(id) {
  const fam = daggerFamily(id);
  if (!fam) return null;
  const other = DAGGER_FAMILIES[fam === 'fire' ? 'twilight' : 'fire'];
  return other.ids[DAGGER_FAMILIES[fam].ids.indexOf(id)];
}

// Sven Packmaster (T3–T4), from its wiki page: at 50% it is protected while it spawns a pup every
// second for 5 s, each with 10% of its max health, and stays protected until all of them are dead. The
// player kills each pup as it arrives. No despawn time is published for it, so none is applied.

// Mage Outlaw (Crimson Isle), from its wiki page and Hypixel forums posts; durations in seconds.
// Its base phase is the End Crystal: the boss can be hit until it has lost the next tenth-of-70M (every
// 10M health, so at 6/7, 5/7 … 1/7). The crystal itself fades after 11 s; the boss stays hittable.
// At each threshold it does one of three things, picked at random:
//   Summoned Skulls: invulnerable while both skulls live; the player takes 1 s to kill one (no hits on
//     the boss meanwhile), then hits the boss for the rest of the 8 s.
//   Damage Shield with a Red Ring (3 s) or a Lightning Storm (8 s), then 2 s more of shield. It reflects
//     all damage, so the player doesn't hit.
export const OUTLAW = {
  steps: 7,
  crystal: 11,
  skulls: { kill: 1, window: 8 },
  shield: { attacks: [['Red Ring', 3], ['Lightning Storm', 8]], linger: 2 },
};

// Atoned Horror (Revenant Horror V), from its wiki page (Nov 2026):
//   Natural regeneration: 1/1000 of max health a second, always.
//   Thermonuclear: every 30 s it stops, a bedrock circle spreads and "Boom!" shows; a hidden 5 s timer
//     ends in a lightning barrage killing anything within 7 blocks (no protection works). The player
//     hits until hitUntil, then backs out (out), waits out the barrage and comes back. The barrage
//     length and the movement times aren't published: assumed. Every 30 s from spawn is assumed.
//   Explosive Assault's TNT heals it 500k per player hit: left out, as the player dodges it (best case).
// Revenant Horror, from its wiki page (Nov 2026): despawns after 3 minutes. Enrage (T3+): 40 s in it
//   goes Mad, 5 s later Enraged for 12 s (faster, much more damage). The player tanks it (best-case
//   gear), so it costs no time; shown only. Once per fight is assumed (the wiki gives no repeat).
//   Life Drain, Pestilence and Slam Dunk only hurt the player. Its regeneration only starts when it
//   hasn't hit the player for a while, which never happens in melee: left out.
export const REVENANT_ENRAGE = { at: 40, mad: 5, enraged: 12 };
export const ATONED_REGEN = 1 / 1000;
export const ATONED_BOOM = { every: 30, hitUntil: 4.5, out: 0.5, barrage: 1, back: 0.5 };

export const LEAP_AIM_S = 0.2;
export const WEB_SWAP_S = 1;


// ---------- Parameter blocks ----------
// A block is { kind, ...params }: one mechanic with its numbers. An enemy lists its blocks (ENEMIES
// in data/mechanics.js, `blocks`); a block can be made once and given to any number of enemies.
// What each kind does (indicator rows, nametag status, notes, its part in the fight) is defined once
// in bossMechanics.js, by kind.
const block = (kind) => (params = {}) => ({ kind, ...params });
// Despawns (Slayer quest failed) after this many seconds.
export const despawn = (seconds) => ({ kind: 'despawn', seconds });
// Heals this fraction of its max health a second, always.
export const regen = (perSecond) => ({ kind: 'regen', perSecond });
// { hits, at: [HP fractions; 1 = on spawn], feroDivisor (while down), terminator: always shot down with one }
export const hitshield = block('hitshield');
export const beams = block('beams'); // { at, immune (s) }
export const nukekubiHeads = block('nukekubiHeads'); // { from, every }
export const backstab = block('backstab'); // { every }
export const webOfLies = block('webOfLies'); // { at, hits }
export const conjoinedBrood = block('conjoinedBrood'); // { hpMult }
export const hellionShield = block('hellionShield');
export const daggerSwaps = (seconds) => ({ kind: 'daggerSwaps', seconds }); // swapping or toggling attunement
export const demonsplit = block('demonsplit'); // { at, demonHp }
export const callThePups = block('callThePups'); // { at, count, every, hpFrac }
export const outlawSpecials = block('outlawSpecials'); // OUTLAW
// Something that lands on a timer and wipes the fight unless the player deals with it in time (or
// the boss dies first: a clutch).
//   row, label: its indicator row; name: what notes call it (default label); tag: nametag status
//   from: starts once the boss is below this HP fraction, or at: seconds from spawn
//   delay: from then to the first one; every: seconds between them
//   hitFor: seconds the player keeps hitting after one lands; stop: seconds spent dealing with it,
//     [min, max] (random) or { reach, hits } (reach it, then that many hits)
//   wipe: seconds after landing before it wipes; afterShield: never lands while a Hitshield is up
//   note: a line for the fight's notes
export const wipeTimer = block('wipeTimer');
export const enrage = block('enrage'); // REVENANT_ENRAGE
// Takes pct% less Magic Damage (100: immune). Abilities that count as melee (Giant's Slam) get through.
export const magicResist = (pct) => ({ kind: 'magicResist', pct });
export const MAGIC_IMMUNE = magicResist(100);
// Bow (arrow) damage does nothing.
export const BOW_IMMUNE = { kind: 'bowImmune' };

// Shared blocks.
export const SLAYER_DESPAWN = despawn(180);
export const LONG_DESPAWN = despawn(240); // Voidgloom (wiki), Demonlord (assumed)

// Each boss's blocks by tier index (0 = T1).
export const voidgloomBlocks = (t) => [
  LONG_DESPAWN,
  hitshield({ hits: [15, 30, 60, 100][t], at: [1, 2 / 3, 1 / 3], feroDivisor: 4, terminator: t === 3 }),
  t === 3 && beams({ at: [5 / 6, 1 / 2, 1 / 6], immune: 8 }),
  t >= 1 && wipeTimer({
    row: 'glyph', label: 'Yang Glyph', from: t === 1 ? 1 / 2 : 2 / 3, delay: 2, every: 8, stop: GLYPH_BREAK_S, wipe: 5,
    afterShield: true, note: 'a Yang Glyph every 8 s (unconfirmed for T3+), 0.5–0.75 s to break',
  }),
  t >= 2 && nukekubiHeads({ from: 1 / 3, every: 6 }),
].filter(Boolean);
export const revenantBlocks = (t) => [SLAYER_DESPAWN, t >= 2 && enrage(REVENANT_ENRAGE)].filter(Boolean);
// Revenant Horror V (wiki): "Heals rapidly and is immune to magic damage."
export const ATONED_BLOCKS = [SLAYER_DESPAWN, MAGIC_IMMUNE, regen(ATONED_REGEN), wipeTimer({
  row: 'boom', label: 'Thermonuclear', name: 'Thermonuclear lightning', tag: ['Boom!', 'c', true],
  at: 0, delay: ATONED_BOOM.every, every: ATONED_BOOM.every, hitFor: ATONED_BOOM.hitUntil,
  stop: ATONED_BOOM.out + ATONED_BOOM.barrage + ATONED_BOOM.back, wipe: 5,
  note: 'Thermonuclear every 30 s (assumed from spawn): hits for 4.5 s of its 5 s countdown, then 2 s out of range (assumed); TNT heals are left out (dodged)',
})];
// Every Sven Packmaster is immune to ability damage and ranged damage (wiki); the Slayer quest's 3 minutes.
export const svenBlocks = (t) => [SLAYER_DESPAWN, MAGIC_IMMUNE, BOW_IMMUNE, t >= 2 && callThePups({ at: 1 / 2, count: 5, every: 1, hpFrac: 0.1 })].filter(Boolean);
export const demonlordBlocks = (t) => [
  LONG_DESPAWN,
  t >= 1 && hellionShield(),
  demonsplit({ at: t <= 1 ? [1 / 2] : [2 / 3, 1 / 3], demonHp: [500e3, 1.75e6, 5e6, 10e6][t] }),
  t >= 1 && wipeTimer({
    row: 'pillar', label: 'Fire Pillar', from: t === 1 ? 1 / 2 : 2 / 3, delay: 3.5, every: 20, stop: { reach: PILLAR_REACH_S, hits: 8 }, wipe: 7,
    note: 'a Fire Pillar every 20 s, 500 ms to reach plus 8 hits',
  }),
  t >= 1 && daggerSwaps(DAGGER_SWAP_S),
].filter(Boolean);
export const broodfatherBlocks = (t) => [
  SLAYER_DESPAWN,
  backstab({ every: 5 }),
  t >= 2 && webOfLies({ at: [2 / 3, 1 / 3], hits: [3, 6, 9][t - 2] }),
  t === 4 && conjoinedBrood({ hpMult: 2 }),
].filter(Boolean);
export const CONJOINED_BROOD_BLOCKS = [SLAYER_DESPAWN, backstab({ every: 5 })];
export const OUTLAW_BLOCKS = [outlawSpecials(OUTLAW)];
