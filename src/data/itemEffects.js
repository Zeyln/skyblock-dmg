// Item abilities from their lore (NEU item lore, Nov 2026) that the set (sets.js), weapon (mechanics.js
// WEAPON_MULTIPLIERS) and ability (abilities.js) tables don't cover: stats that change with where the
// fight is, with the dungeon class or with other gear, and damage multipliers against mob types.
//
// An effect:
//   name, kind: 'weapon' | 'armor' | 'equipment', match(id) (fragged STARRED_ ids are matched by their base id)
//   piece(ctx) -> { mult, stats? (keys; all when left out), text }: the piece's own stats are multiplied
//   effect(ctx) -> { stats?, multiplier?, alwaysCrit?, burnPct?, flamingFist?, staticCharge?, shred?, text }: once per worn piece
//     burnPct: % more burning damage (Fire Aspect, Flaming Fist); flamingFist, staticCharge: the simulation's;
//     shred: { pct, max }: the target loses pct% of its Defense per earlier hit, up to max stacks
//   ctx: { location (enemyLocation), target, night, inDungeon, cataLevel, classId, armorIds, weaponId, bow, magic }

import { MINING_ISLANDS } from './mechanics.js';

const ids = (...list) => (id) => list.includes(id);
const armorSet = (name) => (id) => new RegExp(`^${name}_(HELMET|CHESTPLATE|LEGGINGS|BOOTS)$`).test(id);
const mob = (ctx, m) => ctx.target.mobs.includes(m);

export const ITEM_EFFECTS = [
  // ---------- Armor and equipment stats that change with the place ----------
  { name: 'End Armor', kind: 'armor', match: armorSet('END'),
    piece: (c) => (c.location === 'The End' ? { mult: 2, text: '×2 on the End Island' } : null) },
  { name: 'Ender equipment', kind: 'equipment', match: ids('ENDER_NECKLACE', 'ENDER_CLOAK', 'ENDER_BELT', 'ENDER_GAUNTLET'),
    piece: (c) => (c.location === 'The End' ? { mult: 2, text: '×2 on the End Island' } : null) },
  { name: 'Pressurized Coating', kind: 'armor', match: armorSet('HEAT'),
    piece: (c) => (MINING_ISLANDS.includes(c.location) ? { mult: 3, stats: ['DEFENSE', 'STRENGTH'], text: '×3 Defense and Strength on Mining Islands' } : null) },
  // ×3 during the Spooky Festival (Spooky mobs only appear then), else ×2 at night.
  { name: 'Bat Person Armor', kind: 'armor', match: armorSet('BAT_PERSON'),
    piece: (c) => (mob(c, 'Spooky') ? { mult: 3, text: '×3 during the Spooky Festival' } : c.night ? { mult: 2, text: '×2 at night' } : null) },
  // Mythological mobs only appear in the Hub during Diana's Mythological Ritual.
  { name: "Mythos' Might", kind: 'armor', match: (id) => armorSet('MYTHOS')(id) || armorSet('CHALLENGER')(id),
    piece: (c) => (mob(c, 'Mythological') ? { mult: 2, text: "×2 during Diana's Mythological Ritual" } : null) },
  { name: "Mythos' Might", kind: 'equipment', match: (id) => /^(MYTHOS|CHALLENGER)_(NECKLACE|CLOAK|BELT|BRACELET)$/.test(id),
    piece: (c) => (mob(c, 'Mythological') ? { mult: 2, text: "×2 during Diana's Mythological Ritual" } : null) },
  { name: 'Rampart Armor', kind: 'armor', match: armorSet('RAMPART'),
    effect: (c) => (c.location === 'Crimson Isle' ? { stats: { HEALTH: 50, STRENGTH: 20, CRITICAL_DAMAGE: 15 }, text: 'on the Crimson Isle' } : null) },

  // ---------- Equipment ----------
  { name: 'Adaptive Belt', kind: 'equipment', match: ids('ADAPTIVE_BELT'),
    effect: (c) => {
      const stats = { berserk: { STRENGTH: 10 }, healer: { HEALTH: 10, MENDING: 5 }, mage: { INTELLIGENCE: 25 }, tank: { HEALTH: 5, DEFENSE: 10 },
        archer: { CRITICAL_CHANCE: 2, CRITICAL_DAMAGE: 5 } }[c.classId];
      return stats ? { stats, text: `${c.classId} bonus` } : null;
    } },
  { name: 'Demonlord Gauntlet', kind: 'equipment', match: ids('DEMONLORD_GAUNTLET'),
    effect: (c) => (mob(c, 'Infernal') ? { multiplier: 1.15, text: '×1.15 vs Infernal mobs' } : null) },
  { name: 'Magma Lord Gauntlet', kind: 'equipment', match: ids('MAGMA_LORD_GAUNTLET'),
    effect: (c) => (mob(c, 'Magmatic') ? { multiplier: 1.3, text: '×1.3 vs Magmatic mobs' } : null) },
  { name: 'Thunderbolt Necklace', kind: 'equipment', match: ids('THUNDERBOLT_NECKLACE'),
    effect: (c) => ({ staticCharge: true, ...(mob(c, 'Magmatic') ? { multiplier: 1.1 } : {}), text: mob(c, 'Magmatic') ? '×1.1 vs Magmatic mobs' : 'Static Charge' }) },
  // Thunder Armor's and the Thunderbolt Necklace's lines are per piece (taken as multiplying together).
  { name: 'Thunder Armor', kind: 'armor', match: armorSet('THUNDER'),
    effect: (c) => ({ staticCharge: true, ...(mob(c, 'Magmatic') ? { multiplier: 1.2 } : {}), text: mob(c, 'Magmatic') ? '×1.2 vs Magmatic mobs' : 'Static Charge' }) },
  { name: 'Flaming Fist', kind: 'equipment', match: ids('FLAMING_FIST'),
    effect: (c) => (c.bow || c.magic ? null : { flamingFist: true, text: 'melee hits light its burn' }) },
  { name: 'Dragonfuse Glove', kind: 'equipment', match: ids('DRAGONFUSE_GLOVE'),
    effect: (c) => (c.weaponId === 'ASPECT_OF_THE_DRAGON' ? { stats: { DAMAGE: 35, STRENGTH: 50 }, text: 'Aspect of the Dragons upgrade' } : null) },

  // ---------- Weapons ----------
  // Per Catacombs level, in and out of dungeons.
  { name: 'Catacombs level', kind: 'weapon', match: ids('HYPERION'), effect: (c) => perCata(c, { DAMAGE: 1, INTELLIGENCE: 2 }) },
  { name: 'Catacombs level', kind: 'weapon', match: ids('VALKYRIE'), effect: (c) => perCata(c, { DAMAGE: 1, STRENGTH: 1 }) },
  { name: 'Catacombs level', kind: 'weapon', match: ids('SCYLLA'), effect: (c) => perCata(c, { DAMAGE: 1, CRITICAL_DAMAGE: 1 }) },
  { name: 'Catacombs level', kind: 'weapon', match: ids('ASTRAEA'), effect: (c) => perCata(c, { DAMAGE: 1, DEFENSE: 2 }) },
  { name: 'Stinger', kind: 'weapon', match: ids('STING'), effect: (c) => (c.magic ? null : { alwaysCrit: true, text: 'always crits' }) },
  { name: 'Void Sword', kind: 'weapon', match: ids('VOID_SWORD'),
    effect: (c) => {
      const n = c.armorIds.filter(armorSet('END')).length;
      return n ? { stats: { STRENGTH: 20 * n }, text: `+20 Strength per Ender Armor piece (${n})` } : null;
    } },
  { name: 'Zombie Knight', kind: 'weapon', match: ids('ZOMBIE_KNIGHT_SWORD'),
    effect: (c) => (c.armorIds.filter(armorSet('ZOMBIE_KNIGHT')).length === 4 ? { stats: { STRENGTH: 30 }, text: 'with the Zombie Knight Armor' } : null) },
  // Dungeons only. Archer (arrows +10% for 5 s after a melee hit) and Healer aren't damage on the blade's own hit.
  { name: 'Stone Blade', kind: 'weapon', match: ids('STONE_BLADE'),
    effect: (c) => {
      const stats = c.inDungeon && { berserk: { DAMAGE: 10, STRENGTH: 75, WALK_SPEED: 10 }, mage: { INTELLIGENCE: 100, DAMAGE: 10 },
        tank: { DEFENSE: 100, VITALITY: 5, TRUE_DEFENSE: 5 } }[c.classId];
      return stats ? { stats, text: `${c.classId} bonus` } : null;
    } },
  // −10% of the target's max Defense per hit, up to 5 stacks (kept for the fight, assumed).
  { name: 'Last Breath', kind: 'weapon', match: ids('LAST_BREATH'), effect: (c) => (c.bow ? { shred: { pct: 10, max: 5 }, text: '−10% Defense per hit' } : null) },
  { name: 'Bejeweled Blade', kind: 'weapon', match: ids('FANCY_SWORD'),
    effect: (c) => (MINING_ISLANDS.includes(c.location) && !c.magic ? { multiplier: 2.5, text: '+150% on Mining Islands' } : null) },
];

function perCata(c, per) {
  if (!c.cataLevel) return null;
  return { stats: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v * c.cataLevel])), text: `Catacombs ${c.cataLevel}` };
}

// Rekindle (Rekindled Ember Armor, 2+ pieces): +200% / +400% / +600% burning damage at 2 / 3 / 4 pieces
// (wiki, Rekindled Ember Armor, Nov 2026; the extra for being on fire yourself isn't counted). The wiki
// says the bonus is bugged and does nothing in the game, so it's off until that's fixed.
export const REKINDLE_PCT = { 2: 200, 3: 400, 4: 600 };
export const REKINDLE_WORKS = false;
export const rekindlePieces = (armorIds) => armorIds.filter(armorSet('REKINDLED_EMBER')).length;

const baseId = (id) => (id || '').replace(/^STARRED_/, '');
export const itemEffectsFor = (id, kind) => ITEM_EFFECTS.filter((e) => e.kind === kind && e.match(baseId(id)));
