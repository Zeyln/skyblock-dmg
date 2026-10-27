// Game constants used by the calculator.
// Sources: hypixelskyblock.minecraft.wiki (Damage_Calculation, Accessory_Powers,
// Tuning, Attributes/List), October 2026. Values Hypixel changes often live here
// so they can be corrected in one place.

export const BASE_PLAYER_STATS = {
  STRENGTH: 0,
  CRITICAL_DAMAGE: 50,
  CRITICAL_CHANCE: 30,
};

// Combat skill "Warrior" perk: +4% per level for 1-50, +1% per level for 51-60 (max 210%).
export function combatWarriorBonus(level) {
  const lvl = Math.max(0, Math.min(60, Math.floor(level || 0)));
  return Math.min(lvl, 50) * 4 + Math.max(0, lvl - 50);
}

// ---------- Mob types ----------
export const MOB_TYPES = [
  'Airborne', 'Animal', 'Aquatic', 'Arcane', 'Arthropod', 'Construct', 'Critter', 'Cubic',
  'Elusive', 'Ender', 'Frozen', 'Glacial', 'Humanoid', 'Infernal', 'Magmatic', 'Mythological',
  'Pest', 'Shielded', 'Skeletal', 'Spooky', 'Subterranean', 'Timid', 'Undead', 'Wither', 'Woodland',
];

// ---------- In-game enemies ----------
// Types/HP/defense from each mob's wiki page (checked Oct 2026). defense 0 = not listed on the wiki.
// Dungeon floor bosses: the wiki gives one HP range; low end = normal floor, high end = Master Mode
// (confirmed on Bonzo, Scarf and The Professor; assumed for the F7 bosses).
// dungeon: where the enemy is fought, which drives the In dungeon setting:
//   undefined = outside dungeons, 'floor' = normal Catacombs only, 'master' = Master Mode only,
//   'either' = both (regular dungeon mobs/minibosses; HP depends on floor, hpRange shown instead).
const enemy = (group, name, mobs, maxHp, opts = {}) => ({ group, name, mobs, maxHp, defense: 0, boss: false, families: [], ...opts });

// Dungeon mode an enemy forces ('none' | 'catacombs' | 'master'). 'either' enemies keep the
// current choice, defaulting to Catacombs. No enemy (custom target) keeps the current mode.
export function enemyDungeonMode(enemy, current) {
  if (!enemy) return current;
  if (!enemy.dungeon) return 'none';
  if (enemy.dungeon === 'floor') return 'catacombs';
  if (enemy.dungeon === 'master') return 'master';
  return current === 'master' ? 'master' : 'catacombs';
}
const floorBoss = (name, mobs, hp, opts = {}) => enemy('Dungeon bosses (Catacombs)', name, mobs, hp, { boss: true, dungeon: 'floor', ...opts });
const masterBoss = (name, mobs, hp, opts = {}) => enemy('Dungeon bosses (Master Mode)', name, mobs, hp, { boss: true, dungeon: 'master', ...opts });
const dungeonMob = (group, name, mobs, hpRange, opts = {}) => enemy(group, name, mobs, 0, { dungeon: 'either', hpRange, ...opts });
export const ENEMIES = [
  ...[['I', 500], ['II', 20000], ['III', 400000], ['IV', 1500000], ['V', 10000000]].map(([t, hp]) =>
    enemy('Slayer bosses', `Revenant Horror ${t}`, ['Undead'], hp, { boss: true })),
  enemy('Slayer bosses', 'Atoned Horror', ['Undead'], 10000000, { boss: true }),
  ...[['I', 2500], ['II', 50000], ['III', 1000000], ['IV', 2500000], ['V', 10000000]].map(([t, hp]) =>
    enemy('Slayer bosses', `Tarantula Broodfather ${t}`, ['Arthropod'], hp, { boss: true })),
  enemy('Slayer bosses', 'Conjoined Brood', ['Arthropod'], 20000000, { boss: true }),
  ...[['I', 2000], ['II', 40000], ['III', 750000], ['IV', 2000000]].map(([t, hp]) =>
    enemy('Slayer bosses', `Sven Packmaster ${t}`, ['Animal'], hp, { boss: true, families: ['Wolf'] })),
  ...[['I', 300000], ['II', 12000000], ['III', 50000000], ['IV', 210000000]].map(([t, hp]) =>
    enemy('Slayer bosses', `Voidgloom Seraph ${t}`, ['Ender'], hp, { boss: true, families: ['Enderman'] })),
  ...[['I', 2500000], ['II', 10000000], ['III', 45000000], ['IV', 150000000]].map(([t, hp]) =>
    enemy('Slayer bosses', `Inferno Demonlord ${t}`, ['Infernal'], hp, { boss: true })),
  enemy('Slayer minibosses', 'Voidling Devotee', ['Ender'], 7500000, { boss: true, families: ['Enderman'] }),
  enemy('Slayer minibosses', 'Voidling Radical', ['Ender'], 15000000, { boss: true, families: ['Enderman'] }),
  enemy('Slayer minibosses', 'Voidcrazed Maniac', ['Ender'], 30000000, { boss: true, families: ['Enderman'] }),
  enemy('Slayer minibosses', 'Atoned Champion', ['Undead'], 1000000, { boss: true }),
  enemy('Slayer minibosses', 'Atoned Revenant', ['Undead'], 2500000, { boss: true }),
  enemy('Slayer minibosses', 'Primordial Jockey', ['Arthropod'], 1750000, { boss: true }),
  enemy('Slayer minibosses', 'Primordial Viscount', ['Arthropod'], 3000000, { boss: true }),

  // Bonzo's mob type is Humanoid in phase 1 and Undead in phase 2.
  floorBoss('Bonzo (F1)', ['Humanoid', 'Undead', 'Arcane'], 250000),
  floorBoss('Scarf (F2)', ['Humanoid', 'Arcane'], 1000000),
  floorBoss('The Professor (F3)', ['Humanoid', 'Arcane'], 3000000),
  floorBoss('Livid (F5)', ['Humanoid', 'Arcane'], 7000000, { defense: 100 }),
  floorBoss('Sadan (F6)', ['Arcane', 'Humanoid'], 40000000),
  floorBoss('Maxor (F7)', ['Wither', 'Arcane'], 100000000),
  floorBoss('Storm (F7)', ['Wither', 'Arcane'], 400000000),
  floorBoss('Goldor (F7)', ['Wither', 'Arcane'], 750000000),
  floorBoss('Necron (F7)', ['Arcane', 'Wither'], 1000000000),

  masterBoss('Bonzo (M1)', ['Humanoid', 'Undead', 'Arcane'], 200000000),
  masterBoss('Scarf (M2)', ['Humanoid', 'Arcane'], 375000000),
  masterBoss('The Professor (M3)', ['Humanoid', 'Arcane'], 600000000),
  masterBoss('Livid (M5)', ['Humanoid', 'Arcane'], 600000000, { defense: 100 }),
  masterBoss('Sadan (M6)', ['Arcane', 'Humanoid'], 800000000),
  masterBoss('Maxor (M7)', ['Wither', 'Arcane'], 800000000, { defense: 1000 }),
  masterBoss('Storm (M7)', ['Wither', 'Arcane'], 1000000000, { defense: 1800 }),
  masterBoss('Goldor (M7)', ['Wither', 'Arcane'], 1200000000, { defense: 1800 }),
  masterBoss('Necron (M7)', ['Arcane', 'Wither'], 1400000000, { defense: 2100 }),
  // Master Mode Floor VII only. HP/defense from the dragon stats table; mob types not listed.
  masterBoss('Wither Dragon (M7, any color)', [], 1000000000, { defense: 2500 }),

  // Regular dungeon mobs: fought on normal and Master Mode floors; HP depends on the floor.
  dungeonMob('Dungeon mobs', 'Crypt Lurker', ['Undead', 'Subterranean'], '9,000 – 13,000,000'),
  dungeonMob('Dungeon mobs', 'Crypt Dreadlord', ['Undead', 'Wither', 'Subterranean'], '14,000 – 20,000,000'),
  dungeonMob('Dungeon mobs', 'Crypt Souleater', ['Undead', 'Wither', 'Subterranean'], '13,000 – 20,000,000'),
  dungeonMob('Dungeon mobs', 'Zombie Soldier', ['Undead'], '77,000 – 36,000,000'),
  dungeonMob('Dungeon mobs', 'Zombie Knight', ['Undead'], '93,500 – 40,000,000'),
  dungeonMob('Dungeon mobs', 'Zombie Commander', ['Undead'], '1,700,000 – 250,000,000'),
  dungeonMob('Dungeon mobs', 'Zombie Lord', ['Undead'], '5,000,000 – 300,000,000'),
  dungeonMob('Dungeon mobs', 'Skeleton Master', ['Skeletal'], '31,200 – 42,000,000'),
  dungeonMob('Dungeon mobs', 'Skeleton Lord', ['Skeletal'], '2,000,000 – 120,000,000'),
  dungeonMob('Dungeon mobs', 'Super Archer', ['Skeletal'], '240,000 – 200,000,000'),
  dungeonMob('Dungeon mobs', 'Skeletor', ['Skeletal', 'Construct'], '250,000 – 10,200,000'),
  dungeonMob('Dungeon mobs', 'Withermancer', ['Wither', 'Skeletal', 'Arcane'], '180,000 – 150,000,000'),
  dungeonMob('Dungeon mobs', 'Cellar Spider', ['Arthropod', 'Subterranean'], '17,000 – 9,500,000'),
  dungeonMob('Dungeon mobs', 'Fel', ['Arcane'], '450,000 – 160,000,000'),
  dungeonMob('Dungeon mobs', 'Mimic', ['Arcane', 'Construct'], '1,500,000 – 180,000,000'),
  dungeonMob('Dungeon minibosses', 'Lost Adventurer', ['Humanoid', 'Arcane'], '40,000 – 160,000,000', { boss: true }),
  dungeonMob('Dungeon minibosses', 'Angry Archaeologist', ['Humanoid', 'Subterranean'], '8,500 – 18,000,000', { boss: true }),

  enemy('Hub', 'Crypt Ghoul', ['Undead'], 2000),

  ...[['Young', 7500000, 18], ['Old', 15000000, 18], ['Wise', 9000000, 25], ['Unstable', 9000000, 25],
    ['Strong', 9000000, 25], ['Protector', 9000000, 85], ['Superior', 12000000, 30]].map(([n, hp, def]) =>
    enemy('The End', `${n} Dragon`, ['Ender', 'Arcane', 'Airborne'], hp, { boss: true, defense: def })),
  enemy('The End', 'Zealot', ['Ender'], 13000, { families: ['Enderman'] }),

  enemy('Crimson Isle', 'Kuudra', ['Infernal', 'Cubic'], 0, { boss: true }),
  enemy('Crimson Isle', 'Ashfang', ['Infernal', 'Arcane'], 50000000, { boss: true }),
  enemy('Crimson Isle', 'Bladesoul', ['Wither', 'Skeletal', 'Arcane'], 50000000, { boss: true }),
  enemy('Crimson Isle', 'Barbarian Duke X', ['Humanoid', 'Animal'], 70000000, { boss: true }),
  enemy('Crimson Isle', 'Mage Outlaw', ['Humanoid', 'Arcane'], 70000000, { boss: true }),

  enemy('Spider\'s Den', 'Arachne (Lesser)', ['Arthropod', 'Arcane'], 20000, { boss: true }),
  enemy('Spider\'s Den', 'Arachne (Greater)', ['Arthropod', 'Arcane'], 100000, { boss: true }),

  enemy('Other', 'Minos Inquisitor', ['Mythological', 'Humanoid', 'Elusive'], 80000000),
  enemy('Other', 'Lord Jawbus', ['Magmatic', 'Construct', 'Elusive'], 100000000, { families: ['Sea creature'] }),
];

// ---------- Enchantments ----------
// kind: 'additive'  -> value is % added to the additive multiplier
//       'stat'      -> adds a flat stat
// mobs: only applies when the target has one of these types
// bow / melee: restrict to weapon class
export const ENCHANTS = [
  { id: 'sharpness', name: 'Sharpness', melee: true, values: [5, 10, 15, 20, 30, 40, 50] },
  { id: 'smite', name: 'Smite', melee: true, mobs: ['Skeletal', 'Undead', 'Wither'], values: [5, 10, 15, 20, 30, 40, 50] },
  { id: 'bane', name: 'Bane of Arthropods', melee: true, mobs: ['Arthropod'], values: [5, 10, 15, 20, 30, 40, 50] },
  { id: 'ender_slayer', name: 'Ender Slayer', melee: true, mobs: ['Ender'], values: [5, 10, 15, 20, 30, 40, 50] },
  { id: 'cubism', name: 'Cubism', mobs: ['Cubic'], values: [5, 10, 15, 20, 30, 40] },
  { id: 'impaling', name: 'Impaling', mobs: ['Aquatic'], values: [5, 10, 15, 20, 30] },
  { id: 'smoldering', name: 'Smoldering', mobs: ['Infernal'], values: [5, 10, 15, 20, 30] },
  { id: 'gravity', name: 'Gravity', mobs: ['Airborne'], values: [5, 10, 15, 20, 30, 40] },
  { id: 'woodsplitter', name: 'Woodsplitter', mobs: ['Woodland'], values: [5, 10, 15, 20, 30, 40] },
  { id: 'pyroclasm', name: 'Pyroclasm', mobs: ['Magmatic'], values: [10, 20, 30, 40, 60, 80] },
  { id: 'power', name: 'Power', bow: true, values: [8, 16, 24, 32, 40, 50, 65] },
  { id: 'first_strike', name: 'First Strike', melee: true, firstHit: true, values: [25, 50, 75, 100, 125] },
  { id: 'triple_strike', name: 'Triple-Strike', melee: true, firstThree: true, values: [10, 20, 30, 40, 50] },
  // Per 1% of target HP lost / remaining
  { id: 'execute', name: 'Execute', melee: true, perMissingHp: true, values: [0.2, 0.4, 0.6, 0.8, 1, 1.25] },
  { id: 'prosecute', name: 'Prosecute', melee: true, perCurrentHp: true, values: [0.1, 0.2, 0.3, 0.4, 0.7, 1] },
  // Per 1% of target max HP above the player's, capped
  { id: 'giant_killer', name: 'Giant Killer', melee: true, giantKiller: true,
    values: [0.1, 0.2, 0.3, 0.4, 0.6, 0.9, 1.2], caps: [5, 10, 15, 20, 30, 45, 65] },
  // Per 100 target defense, capped
  { id: 'titan_killer', name: 'Titan Killer', melee: true, titanKiller: true,
    values: [2, 4, 6, 8, 12, 16, 20], caps: [6, 12, 18, 24, 40, 60, 80] },
  { id: 'critical', name: 'Critical', melee: true, stat: 'CRITICAL_DAMAGE', values: [10, 20, 30, 40, 50, 70, 100] },
];

// Pairs that can't be on the same weapon (applying one replaces the other in-game).
export const ENCHANT_CONFLICTS = [
  ['execute', 'prosecute'],
  ['first_strike', 'triple_strike'],
  ['giant_killer', 'titan_killer'],
];
export function enchantConflict(id, enchants) {
  for (const [a, b] of ENCHANT_CONFLICTS) {
    if (id === a && enchants?.[b]) return b;
    if (id === b && enchants?.[a]) return a;
  }
  return null;
}

// ---------- Ultimate enchantments (one per item) ----------
// effect: 'additive' (% per level), 'perEnemy' / 'perKill' (additive % per unit, capped),
// 'soulEater' (×mob damage as Strength on the next crit), 'chimera' (% of pet stats),
// 'baseDamage' (% of the weapon's base Damage), or none (no effect on a single hit).
export const ULTIMATE_ENCHANTS = [
  { id: 'one_for_all', name: 'One For All', melee: true, values: [500], effect: 'additive', exclusive: true,
    note: 'Removes all other enchantments' },
  { id: 'soul_eater', name: 'Soul Eater', values: [2, 4, 6, 8, 10], effect: 'soulEater', cap: 5000,
    note: 'Strength = level × last killed mob\'s damage, on the next crit (max 5,000 outside dungeons)' },
  { id: 'swarm', name: 'Swarm', melee: true, values: [2, 4, 6, 8, 10], effect: 'perEnemy', max: 10 },
  { id: 'combo', name: 'Combo', melee: true, values: [1, 2, 3, 4, 5], caps: [2, 4, 6, 8, 10], effect: 'perKill' },
  { id: 'chimera', name: 'Chimera', melee: true, values: [20, 40, 60, 80, 100], effect: 'chimera' },
  { id: 'ultimate_jerry', name: 'Ultimate Jerry', melee: true, items: ['ASPECT_OF_THE_JERRY'],
    values: [1000, 2000, 3000, 4000, 5000], effect: 'baseDamage' },
  { id: 'fatal_tempo', name: 'Fatal Tempo', values: [10, 20, 30, 40, 50], note: 'Ferocity only — no single-hit effect' },
  { id: 'inferno', name: 'Inferno', values: [125, 150, 175, 200, 225], note: 'Every 10th hit — no single-hit effect' },
  { id: 'ultimate_wise', name: 'Ultimate Wise', melee: true, values: [10, 20, 30, 40, 50], note: 'Mana cost only' },
  { id: 'duplex', name: 'Duplex', bow: true, values: [4, 8, 12, 16, 20], note: 'Second arrow — no effect on the first arrow' },
  { id: 'rend', name: 'Rend', bow: true, values: [5, 10, 15, 20, 25], note: 'Left-click ability — no single-hit effect' },
];

export function ultimatesFor(item, bow) {
  return ULTIMATE_ENCHANTS.filter((u) => !(u.melee && bow) && !(u.bow && !bow) && (!u.items || u.items.includes(item?.id)));
}

// ---------- Weapon bonuses vs specific enemies (multiplicative) ----------
// From the wiki's Damage Calculation tables. Rules match a mob type (mobs) or a creature
// family (families) that isn't an official mob type: the katanas only hit Endermen harder,
// not every Ender mob (e.g. dragons).
export const TARGET_FAMILIES = ['Enderman', 'Wolf', 'Sea creature'];

const vs = (mobs, mult) => ({ mobs, mult });
const vsFamily = (families, mult) => ({ families, mult });
export const WEAPON_MULTIPLIERS = {
  // Endermen
  END_SWORD: [vsFamily(['Enderman'], 2)],
  VOIDWALKER_KATANA: [vsFamily(['Enderman'], 2.5)],
  VOIDEDGE_KATANA: [vsFamily(['Enderman'], 3)],
  VORPAL_KATANA: [vsFamily(['Enderman'], 3.5)],
  ATOMSPLIT_KATANA: [vsFamily(['Enderman'], 4)],
  // Arthropods
  SPIDER_SWORD: [vs(['Arthropod'], 2)],
  RECLUSE_FANG: [vs(['Arthropod'], 2.5)],
  TARANTULA_FANG: [vs(['Arthropod'], 3)],
  SCORPION_FOIL: [vs(['Arthropod'], 3.5)],
  STING: [vs(['Arthropod'], 4)],
  // Undead
  UNDEAD_SWORD: [vs(['Undead'], 2)],
  REVENANT_SWORD: [vs(['Undead'], 2.5)],
  REAPER_SWORD: [vs(['Undead'], 3)],
  AXE_OF_THE_SHREDDED: [vs(['Undead'], 3.5)],
  UNDEAD_BOW: [vs(['Undead'], 2)],
  SUPER_UNDEAD_BOW: [vs(['Undead'], 2)],
  DEATH_BOW: [vs(['Undead'], 2)],
  // 1 + 2% per 1% of the target's missing health
  SPIRIT_SWORD: [{ mobs: ['Undead'], perMissingHp: 2 }],
  ITEM_SPIRIT_BOW: [{ mobs: ['Undead'], perMissingHp: 2 }],
  // Infernal daggers (also Wither / Skeletal)
  FIREDUST_DAGGER: [vs(['Infernal'], 1.25), vs(['Wither'], 1.1)],
  BURSTFIRE_DAGGER: [vs(['Infernal'], 1.5), vs(['Wither'], 1.2)],
  HEARTFIRE_DAGGER: [vs(['Infernal'], 2), vs(['Wither'], 1.5)],
  MAWDUST_DAGGER: [vs(['Infernal'], 1.5), vs(['Skeletal'], 1.25)],
  BURSTMAW_DAGGER: [vs(['Infernal'], 2.5), vs(['Skeletal'], 1.5)],
  HEARTMAW_DAGGER: [vs(['Infernal'], 3.5), vs(['Skeletal'], 2)],
  // Wither
  WITHER_BOW: [vs(['Wither'], 2)],
  NECRON_BLADE: [vs(['Wither'], 1.5)],
  HYPERION: [vs(['Wither'], 1.5)],
  VALKYRIE: [vs(['Wither'], 1.5)],
  SCYLLA: [vs(['Wither'], 1.5)],
  ASTRAEA: [vs(['Wither'], 1.5)],
  // Sea creatures, wolves, mythological
  SOUL_WHIP: [vsFamily(['Sea creature'], 2)],
  FLAMING_FLAY: [vsFamily(['Sea creature'], 3)],
  POOCH_SWORD: [vsFamily(['Wolf'], 2)],
  SWORD_OF_REVELATIONS: [vs(['Mythological'], 1.5)],
};

// Fragged (STARRED_*) versions share their base weapon's bonus.
export const weaponMultipliers = (id) => WEAPON_MULTIPLIERS[id] || WEAPON_MULTIPLIERS[id?.replace(/^STARRED_/, '')] || [];

// ---------- Reforges (flat stats by rarity) ----------
export const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'DIVINE'];

// Rows are [Strength, Crit Chance, Crit Damage] (and optional Damage) per rarity, Common → Divine.
// Only damage-relevant stats are kept. Missing rarities fall back to the highest listed.
function reforge(name, stone, rows, extra = {}) {
  const stats = {};
  rows.forEach(([str, cc, cd, dmg]) => {
    for (const [k, v] of [['STRENGTH', str], ['CRITICAL_CHANCE', cc], ['CRITICAL_DAMAGE', cd], ['DAMAGE', dmg]]) {
      (stats[k] ??= []).push(v || 0);
    }
  });
  for (const k of Object.keys(stats)) if (stats[k].every((v) => !v)) delete stats[k];
  return { name, stone, stats, ...extra };
}

export const SWORD_REFORGES = {
  gentle: reforge('Gentle', null, [[3], [5], [7], [10], [15], [20], [25]]),
  odd: reforge('Odd', null, [[0, 12, 10], [0, 15, 15], [0, 15, 15], [0, 20, 22], [0, 25, 30], [0, 30, 40], [0, 35, 50]]),
  fair: reforge('Fair', null, [[2, 2, 2], [3, 3, 3], [4, 4, 4], [7, 7, 7], [10, 10, 10], [12, 12, 12], [14, 14, 14]]),
  epic: reforge('Epic', null, [[15, 0, 10], [20, 0, 15], [25, 0, 20], [32, 0, 27], [40, 0, 35], [50, 0, 45], [60, 0, 55]]),
  sharp: reforge('Sharp', null, [[0, 10, 20], [0, 12, 30], [0, 14, 40], [0, 17, 55], [0, 20, 75], [0, 25, 90], [0, 30, 105]]),
  heroic: reforge('Heroic', null, [[15], [20], [25], [32], [40], [50], [60]]),
  spicy: reforge('Spicy', null, [[2, 1, 25], [3, 1, 35], [4, 1, 45], [7, 1, 60], [10, 1, 80], [12, 1, 100], [14, 1, 120]]),
  legendary: reforge('Legendary', null, [[3, 5, 5], [7, 7, 10], [12, 9, 15], [18, 12, 22], [25, 15, 28], [32, 18, 36], [39, 21, 44]]),
  dirty: reforge('Dirty', 'Dirt Bottle', [[2], [4], [6], [10], [12], [15], [20]]),
  fabled: reforge('Fabled', 'Dragon Claw', [[30, 0, 15], [35, 0, 20], [40, 0, 25], [50, 0, 32], [60, 0, 40], [75, 0, 50], [90, 0, 65]]),
  suspicious: reforge('Suspicious', 'Suspicious Vial', [[0, 1, 30, 5], [0, 2, 40, 7], [0, 3, 50, 9], [0, 5, 65, 11], [0, 7, 85, 13], [0, 10, 110, 15], [0, 13, 140, 17]]),
  warped: reforge('Warped', 'Warped Stone', [[165, 0, 0, 165]]),
  withered: reforge('Withered', 'Wither Blood', [[60], [75], [90], [110], [135], [170], [220]],
    { perCataStr: 1, note: '+1 Strength per Catacombs level' }),
  fanged: reforge('Fanged', 'Full-Jaw Fanging Kit', [[30, 3], [35, 4], [40, 5], [50, 7], [60, 8], [65, 10], [75, 12]]),
  coldfused: reforge('Coldfused', 'Entropy Suppressor', [[15, 0, 20], [20, 0, 30], [25, 0, 40], [35, 0, 50], [45, 0, 60], [55, 0, 70], [65, 0, 90]]),
  jerrys: reforge("Jerry's", 'Jerry Stone', [[25, 10, 50]]),
  // Only Legendary (75) and Mythic (90) are listed; lower rarities reuse Legendary.
  gilded: reforge('Gilded', 'Midas Jewel', [[75, 0, 0, 75], [75, 0, 0, 75], [75, 0, 0, 75], [75, 0, 0, 75], [75, 0, 0, 75], [90, 0, 0, 90]],
    { items: ['MIDAS_SWORD', 'STARRED_MIDAS_SWORD', 'MIDAS_STAFF', 'STARRED_MIDAS_STAFF'] }),
};

// ---------- God Potion ----------
// Damage-relevant effects (wiki "God Potion Effect", values include its brew boosts):
// Strength VIII +78.75, Critical IV +25 CC / +40 CD, Spirit IV +40 CD, Archery IV +80% bow damage.
export const GOD_POTION = {
  stats: { STRENGTH: 78.75, CRITICAL_CHANCE: 25, CRITICAL_DAMAGE: 80 },
  bowAdditive: 80,
};

// ---------- Anvil books ----------
// Hot Potato Books (max 10) then Fuming Potato Books (5 more), same stats per book.
export const HOT_POTATO_MAX = 10;
export const FUMING_POTATO_MAX = 5;
export const POTATO_STATS = {
  weapon: { DAMAGE: 2, STRENGTH: 2 },
  armor: { HEALTH: 4, DEFENSE: 2 },
};
export const ART_OF_WAR = { STRENGTH: 5 };

// ---------- Price-paid items ----------
// Midas' Sword "Greed": +Damage and +Strength from the Dark Auction price (wiki brackets).
// The upgraded (starred) sword continues past 50M up to 250M.
const GREED_BRACKETS = [
  [0, 50000, 0], [1e6, 100000, 20], [2.5e6, 200000, 35], [7.5e6, 500000, 60], [25e6, 1e6, 95],
];
const GREED_BRACKETS_UPGRADED = [
  ...GREED_BRACKETS, [100e6, 1.5e6, 170], [130e6, 2e6, 190], [150e6, 4e6, 200],
];
export const PRICE_ITEMS = {
  MIDAS_SWORD: { brackets: GREED_BRACKETS, cap: 50e6, maxBonus: 120 },
  STARRED_MIDAS_SWORD: { brackets: GREED_BRACKETS_UPGRADED, cap: 250e6, maxBonus: 225 },
};

export function greedBonus(itemId, price) {
  const def = PRICE_ITEMS[itemId];
  if (!def) return 0;
  const x = Math.max(0, Math.min(def.cap, price || 0));
  if (x >= def.cap) return def.maxBonus;
  const [start, per, base] = def.brackets.filter(([s]) => x >= s).at(-1);
  return Math.floor(base + (x - start) / per);
}

export const BOW_REFORGES = {
  deadly: reforge('Deadly', null, [[0, 10, 5], [0, 13, 10], [0, 16, 18], [0, 19, 32], [0, 22, 50], [0, 25, 70], [0, 28, 90]]),
  fine: reforge('Fine', null, [[3, 5, 2], [7, 7, 4], [12, 9, 7], [18, 12, 10], [25, 15, 15], [40, 20, 20], [55, 25, 25]]),
  grand: reforge('Grand', null, [[25], [32], [40], [50], [60], [70], [80]]),
  hasty: reforge('Hasty', null, [[3, 20], [5, 25], [7, 30], [10, 40], [15, 50], [20, 60], [25, 70]]),
  neat: reforge('Neat', null, [[0, 10, 4], [0, 12, 8], [0, 14, 14], [0, 17, 20], [0, 20, 30], [0, 25, 40], [0, 30, 50]]),
  rapid: reforge('Rapid', null, [[2, 0, 35], [3, 0, 45], [4, 0, 55], [7, 0, 65], [10, 0, 75], [12, 0, 90], [14, 0, 105]]),
  unreal: reforge('Unreal', null, [[3, 8, 5], [7, 9, 10], [12, 10, 18], [18, 11, 32], [25, 13, 50], [34, 15, 70], [43, 17, 90]]),
  awkward: reforge('Awkward', null, [[0, 10, 5], [0, 12, 10], [0, 15, 15], [0, 20, 22], [0, 25, 30], [0, 30, 40], [0, 35, 50]]),
  rich: reforge('Rich', null, [[0, 10, 2], [0, 12, 4], [0, 14, 7], [0, 17, 10], [0, 20, 15], [0, 25, 20], [0, 30, 25]]),
  precise: reforge('Precise', 'Optical Lens', [[3, 8, 5], [7, 9, 10], [12, 10, 18], [18, 11, 32], [25, 13, 50], [34, 15, 70], [45, 18, 90]],
    { note: '+10% damage on head hits (add under Other bonuses)' }),
  spiritual: reforge('Spiritual', 'Spirit Stone', [[4, 7, 10], [8, 8, 15], [14, 9, 23], [20, 10, 37], [28, 12, 55], [38, 14, 75], [50, 16, 100]]),
  headstrong: reforge('Headstrong', 'Kaleidoscopic Mineral', [[2, 10, 4], [5, 11, 8], [10, 12, 16], [16, 13, 28], [23, 15, 42], [33, 17, 60], [45, 20, 80]]),
};

export const ARMOR_REFORGES = {
  clean: reforge('Clean', null, [[0, 2], [0, 4], [0, 6], [0, 8], [0, 10], [0, 12], [0, 14]]),
  fierce: reforge('Fierce', null, [[2, 2, 4], [4, 3, 7], [6, 4, 10], [8, 5, 14], [10, 6, 18], [12, 8, 24], [14, 10, 30]]),
  heavy: reforge('Heavy', null, [[0, 0, -1], [0, 0, -2], [0, 0, -2], [0, 0, -3], [0, 0, -5], [0, 0, -7], [0, 0, -9]]),
  light: reforge('Light', null, [[0, 1, 1], [0, 1, 2], [0, 2, 3], [0, 2, 4], [0, 3, 5], [0, 3, 6], [0, 3, 7]]),
  mythic: reforge('Mythic', null, [[2, 1], [4, 2], [6, 3], [8, 4], [10, 5], [12, 6], [14, 7]]),
  pure: reforge('Pure', null, [[2, 2, 2], [3, 4, 3], [4, 6, 4], [6, 8, 6], [8, 10, 8], [10, 12, 10], [10, 14, 8]]),
  smart: reforge('Smart', null, [[0]]),
  titanic: reforge('Titanic', null, [[0]]),
  wise: reforge('Wise', null, [[0]]),
  ancient: reforge('Ancient', 'Precursor Gear', [[4, 3], [8, 5], [12, 7], [18, 9], [25, 12], [35, 15], [50, 20]],
    { perCataCD: 1, note: '+1 Crit Damage per Catacombs level' }),
  spiked: reforge('Spiked', 'Dragon Scale', [[3, 2, 3], [4, 4, 4], [6, 6, 6], [8, 8, 8], [10, 10, 10], [12, 12, 12], [15, 15, 15]]),
  renowned: reforge('Renowned', 'Dragon Horn', [[3, 2, 3], [4, 4, 4], [6, 6, 6], [8, 8, 8], [10, 10, 10], [12, 12, 12], [15, 15, 15]],
    { statPct: 1, note: '+1% all combat stats' }),
  cubic: reforge('Cubic', 'Molten Cube', [[3], [5], [7], [10], [12], [15], [18]]),
  hyper: reforge('Hyper', 'End Stone Geode', [[2], [4], [6], [7], [10], [12], [14]]),
  ridiculous: reforge('Ridiculous', 'Red Nose', [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7]]),
  undead: reforge('Undead', 'Premium Flesh', [[1], [2], [2], [3], [5], [7], [10]]),
  submerged: reforge('Submerged', 'Deep Sea Orb', [[0, 2], [0, 4], [0, 6], [0, 8], [0, 10], [0, 12], [0, 14]]),
  necrotic: reforge('Necrotic', 'Necromancer\'s Brooch', [[0]]),
  giant: reforge('Giant', 'Giant Tooth', [[0]]),
  loving: reforge('Loving', 'Red Scarf', [[0]]),
  jaded: reforge('Jaded', 'Jaderald', [[0]]),
  bustling: reforge('Bustling', 'Skymart Brochure', [[0]]),
  perfect: reforge('Perfect', 'Diamond Atom', [[0]]),
};

// ---------- Gemstones ----------
// Combat-relevant gems only. Values per rarity Common → Mythic; Divine reuses Mythic
// (the wiki lists no Divine column for these gems).
export const GEM_QUALITIES = ['ROUGH', 'FLAWED', 'FINE', 'FLAWLESS', 'PERFECT'];
export const GEMS = {
  JASPER: { name: 'Jasper', stat: 'STRENGTH', values: {
    ROUGH: [1, 1, 1, 2, 3, 4], FLAWED: [2, 2, 3, 4, 4, 5], FINE: [3, 3, 4, 5, 6, 7],
    FLAWLESS: [5, 6, 7, 8, 10, 12], PERFECT: [6, 7, 9, 11, 13, 16] } },
  // Flawless row is as printed on the wiki (lower than Fine at low rarities).
  ONYX: { name: 'Onyx', stat: 'CRITICAL_DAMAGE', values: {
    ROUGH: [1, 1, 2, 2, 3, 4], FLAWED: [2, 2, 3, 3, 4, 6], FINE: [3, 3, 3, 4, 4, 5],
    FLAWLESS: [2, 2, 3, 3, 5, 6], PERFECT: [5, 6, 7, 8, 10, 12] } },
  SAPPHIRE: { name: 'Sapphire', stat: 'INTELLIGENCE', values: {
    ROUGH: [2, 3, 4, 5, 6, 7], FLAWED: [5, 5, 6, 8, 10, 10], FINE: [7, 8, 9, 10, 11, 12],
    FLAWLESS: [10, 11, 12, 14, 17, 20], PERFECT: [12, 14, 17, 20, 24, 30] } },
  RUBY: { name: 'Ruby', stat: 'HEALTH', values: {
    ROUGH: [1, 2, 3, 4, 5, 7], FLAWED: [3, 4, 5, 6, 8, 10], FINE: [4, 5, 6, 8, 10, 14],
    FLAWLESS: [5, 7, 10, 14, 18, 22], PERFECT: [6, 9, 13, 18, 24, 30] } },
  AMETHYST: { name: 'Amethyst', stat: 'DEFENSE', values: {
    ROUGH: [1, 2, 3, 4, 5, 7], FLAWED: [3, 4, 5, 6, 8, 10], FINE: [4, 5, 6, 8, 10, 14],
    FLAWLESS: [5, 7, 10, 14, 18, 22], PERFECT: [6, 9, 13, 18, 24, 30] } },
  OPAL: { name: 'Opal', stat: 'TRUE_DEFENSE', values: {
    ROUGH: [1, 1, 1, 2, 2, 3], FLAWED: [2, 2, 2, 3, 3, 4], FINE: [3, 3, 3, 4, 4, 5],
    FLAWLESS: [4, 4, 5, 6, 8, 9], PERFECT: [5, 6, 7, 9, 11, 13] } },
};

const COMBAT_GEMS = ['RUBY', 'AMETHYST', 'SAPPHIRE', 'JASPER', 'ONYX', 'OPAL'];
export const SLOT_ACCEPTS = {
  COMBAT: COMBAT_GEMS,
  DEFENSIVE: ['RUBY', 'AMETHYST', 'OPAL'],
  UNIVERSAL: COMBAT_GEMS,
  CHISEL: ['ONYX'],
  ...Object.fromEntries(COMBAT_GEMS.map((g) => [g, [g]])),
};

// Damage gems preferred when auto-filling slots.
export const GEM_FILL_PRIORITY = ['JASPER', 'ONYX', 'SAPPHIRE', 'RUBY', 'AMETHYST', 'OPAL'];

export function gemValue(gem, quality, rarityIdx) {
  const row = GEMS[gem]?.values[quality];
  if (!row) return 0;
  return row[Math.min(Math.max(rarityIdx, 0), row.length - 1)];
}

// Armor / equipment set bonuses live in data/sets.js.

// ---------- Accessory powers ----------
// Stat multiplier from Magical (Accessory) Power: 29.97 * ln(0.0019*MP + 1)^1.2
// (Maths Enjoyer NPC). Wiki tables list stone powers at 250 MP (multiplier 9.64).
export function powerMultiplier(mp) {
  const m = Math.max(0, mp || 0);
  return 29.97 * Math.pow(Math.log(0.0019 * m + 1), 1.2);
}

const AT_250 = powerMultiplier(250);
const from250 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v / AT_250]));

// stats: base (unscaled) stats. unique: flat bonus, not scaled. stone: API item id.
export const POWERS = [
  { id: 'none', name: 'None', stats: {}, unique: {} },
  // Starter / intermediate (wiki lists unscaled base stats)
  { id: 'fortuitous', name: 'Fortuitous', stats: { HEALTH: 3.35, DEFENSE: 1.2, STRENGTH: 4.8, CRITICAL_CHANCE: 4.35, CRITICAL_DAMAGE: 4.8 }, unique: {} },
  { id: 'pretty', name: 'Pretty', stats: { HEALTH: 1.65, DEFENSE: 1.2, WALK_SPEED: 0.65, STRENGTH: 4.8, INTELLIGENCE: 10.8, CRITICAL_CHANCE: 0.475, CRITICAL_DAMAGE: 1.2 }, unique: {} },
  { id: 'protected', name: 'Protected', stats: { HEALTH: 11.75, DEFENSE: 10.8, STRENGTH: 2.4, CRITICAL_CHANCE: 0.475, CRITICAL_DAMAGE: 1.2 }, unique: {} },
  { id: 'simple', name: 'Simple', stats: { HEALTH: 5.02, DEFENSE: 3.6, WALK_SPEED: 1.2, STRENGTH: 3.6, INTELLIGENCE: 5.4, CRITICAL_CHANCE: 1.45, CRITICAL_DAMAGE: 3.6 }, unique: {} },
  { id: 'warrior', name: 'Warrior', stats: { HEALTH: 3.35, DEFENSE: 1.2, STRENGTH: 8.4, CRITICAL_CHANCE: 2.4, CRITICAL_DAMAGE: 6 }, unique: {} },
  { id: 'commando', name: 'Commando', stats: { HEALTH: 5.02, DEFENSE: 2.4, STRENGTH: 8.4, CRITICAL_CHANCE: 0.475, CRITICAL_DAMAGE: 8.4 }, unique: {} },
  { id: 'disciplined', name: 'Disciplined', stats: { HEALTH: 5.02, DEFENSE: 2.4, STRENGTH: 7.2, CRITICAL_CHANCE: 1.45, CRITICAL_DAMAGE: 7.2 }, unique: {} },
  { id: 'inspired', name: 'Inspired', stats: { HEALTH: 1.65, DEFENSE: 1.2, STRENGTH: 4.8, INTELLIGENCE: 16.2, CRITICAL_CHANCE: 0.95, CRITICAL_DAMAGE: 3.6 }, unique: {} },
  { id: 'ominous', name: 'Ominous', stats: { HEALTH: 5.02, WALK_SPEED: 0.95, STRENGTH: 3.6, INTELLIGENCE: 6.1, CRITICAL_CHANCE: 1.45, CRITICAL_DAMAGE: 3.6, ATTACK_SPEED: 0.9 }, unique: {} },
  { id: 'prepared', name: 'Prepared', stats: { HEALTH: 12.4, DEFENSE: 11.3, STRENGTH: 1.95, CRITICAL_CHANCE: 0.4, CRITICAL_DAMAGE: 0.95 }, unique: {} },
  // Stone powers (wiki lists stats at 250 MP)
  { id: 'forceful', name: 'Forceful', stone: 'ACACIA_BIRDHOUSE', stats: from250({ CRITICAL_DAMAGE: 46.28, STRENGTH: 173.56, HEALTH: 16.2 }), unique: { FEROCITY: 4 } },
  { id: 'bloody', name: 'Bloody', stone: 'BEATING_HEART', stats: from250({ CRITICAL_DAMAGE: 104.13, STRENGTH: 104.13, INTELLIGENCE: 34.71 }), unique: { ATTACK_SPEED: 10 } },
  { id: 'bubba', name: 'Bubba', stone: 'BUBBA_BLISTER', stats: from250({ DEFENSE: -92.56, HEALTH: 48.6, CRITICAL_DAMAGE: 104.13, TRUE_DEFENSE: 7.87, STRENGTH: 46.28, ATTACK_SPEED: 17.36, CRITICAL_CHANCE: 9.26 }), unique: { COMBAT_WISDOM: 2 } },
  { id: 'shaded', name: 'Shaded', stone: 'DARK_ORB', stats: from250({ WALK_SPEED: 5.79, CRITICAL_DAMAGE: 173.56, STRENGTH: 46.28 }), unique: { ATTACK_SPEED: 3, FEROCITY: 3 } },
  { id: 'sanguisuge', name: 'Sanguisuge', stone: 'DISPLACED_LEECH', stats: from250({ CRITICAL_CHANCE: 9.26, CRITICAL_DAMAGE: 46.28, HEALTH: 32.4, STRENGTH: 138.85 }), unique: { INTELLIGENCE: 100 } },
  { id: 'bizarre', name: 'Bizarre', stone: 'ECCENTRIC_PAINTING', stats: from250({ CRITICAL_DAMAGE: -23.14, INTELLIGENCE: 416.54, STRENGTH: -23.14 }), unique: { ABILITY_DAMAGE_PERCENT: 5 } },
  { id: 'adept', name: 'Adept', stone: 'END_STONE_SHULKER', stats: from250({ DEFENSE: 92.56, INTELLIGENCE: 34.71, HEALTH: 161.99 }), unique: { HEALTH: 100, DEFENSE: 50 } },
  { id: 'sighted', name: 'Sighted', stone: 'ENDER_MONOCLE', stats: from250({ INTELLIGENCE: 347.11 }), unique: { ABILITY_DAMAGE_PERCENT: 3 } },
  { id: 'crumbly', name: 'Crumbly', stone: 'CHOCOLATE_CHIP', stats: from250({ HEALTH: 97.19, CRITICAL_CHANCE: 4.63, ATTACK_SPEED: 6.94, INTELLIGENCE: 52.07, TRUE_DEFENSE: 15.74 }), unique: { WALK_SPEED: 25 } },
  { id: 'itchy', name: 'Itchy', stone: 'FURBALL', stats: from250({ WALK_SPEED: 5.79, CRITICAL_DAMAGE: 80.99, STRENGTH: 69.42, ATTACK_SPEED: 20.83 }), unique: { STRENGTH: 15, CRITICAL_DAMAGE: 15 } },
  { id: 'frozen', name: 'Frozen', stone: 'GLACITE_SHARD', stats: from250({ TRUE_DEFENSE: 17.7, DEFENSE: 127.27 }), unique: { TRUE_DEFENSE: 10, CRITICAL_DAMAGE: 25, STRENGTH: 25 } },
  { id: 'slender', name: 'Slender', stone: 'HAZMAT_ENDERMAN', stats: from250({ CRITICAL_DAMAGE: 57.85, HEALTH: 80.99, ATTACK_SPEED: 10.41, WALK_SPEED: 5.79, INTELLIGENCE: 86.78, STRENGTH: 57.85, DEFENSE: 57.85 }), unique: { STRENGTH: 50, DEFENSE: 100 } },
  { id: 'demonic', name: 'Demonic', stone: 'HORNS_OF_TORMENT', stats: from250({ STRENGTH: 53.22, INTELLIGENCE: 267.28 }), unique: { CRITICAL_DAMAGE: 50 } },
  { id: 'silky', name: 'Silky', stone: 'LUXURIOUS_SPOOL', stats: from250({ WALK_SPEED: 5.79, CRITICAL_DAMAGE: 219.84 }), unique: { ATTACK_SPEED: 5 } },
  { id: 'hurtful', name: 'Hurtful', stone: 'MAGMA_URCHIN', stats: from250({ STRENGTH: 46.28, CRITICAL_DAMAGE: 185.13 }), unique: { ATTACK_SPEED: 15 } },
  { id: 'strong', name: 'Strong', stone: 'MANDRAA', stats: from250({ STRENGTH: 115.7, CRITICAL_DAMAGE: 115.7 }), unique: { STRENGTH: 25, CRITICAL_DAMAGE: 25 } },
  { id: 'mythical', name: 'Mythical', stone: 'OBSIDIAN_TABLET', stats: from250({ DEFENSE: 39.34, HEALTH: 55.08, CRITICAL_DAMAGE: 39.34, WALK_SPEED: 9.26, STRENGTH: 39.34, INTELLIGENCE: 59.01, CRITICAL_CHANCE: 15.74 }), unique: { STRENGTH: 40, HEALTH: 150 } },
  { id: 'pleasant', name: 'Pleasant', stone: 'PRECIOUS_PEARL', stats: from250({ HEALTH: 129.59, DEFENSE: 138.85 }), unique: {} },
  { id: 'sweet', name: 'Sweet', stone: 'ROCK_CANDY', stats: from250({ WALK_SPEED: 11.57, DEFENSE: 104.13, HEALTH: 145.79 }), unique: { WALK_SPEED: 5 } },
  { id: 'scorching', name: 'Scorching', stone: 'SCORCHED_BOOKS', stats: from250({ CRITICAL_DAMAGE: 92.56, STRENGTH: 80.99, ATTACK_SPEED: 17.36 }), unique: { FEROCITY: 7 } },
  { id: 'buttery', name: 'Buttery', stone: 'SUNFLOWER_BUTTER', stats: from250({ WALK_SPEED: 23.14, ATTACK_SPEED: 20.83 }), unique: { ATTACK_SPEED: 5 } },
  { id: 'healthy', name: 'Healthy', stone: 'VITAMIN_DEATH', stats: from250({ HEALTH: 323.97 }), unique: { HEALTH: 200 } },
];

// ---------- Tuning (Magical Power attunement) ----------
// 1 tuning point per 10 Magical Power.
export const TUNING_PER_POINT = {
  STRENGTH: 1,
  CRITICAL_DAMAGE: 1,
  CRITICAL_CHANCE: 0.2,
  HEALTH: 5,
  DEFENSE: 1,
  WALK_SPEED: 1.5,
  INTELLIGENCE: 2,
  ATTACK_SPEED: 0.3,
};
export const tuningPoints = (mp) => Math.floor(Math.max(0, mp || 0) / 10);

// ---------- Attribute shards (Hunting) ----------
// perLevel at levels 1-10. kind: 'additive' (% damage) | 'stat' (flat) | 'statPct' (% of a stat)
export const SHARDS = [
  // Ruler attributes: +3% damage vs mob type per level (boosted by Echo of Ruler)
  ...[
    ['Airborne', 'Bluebird'], ['Animal', 'Sprawl'], ['Arcane', 'Duplico'], ['Arthropod', 'Flaming Spider'],
    ['Construct', 'Shrieky Tiki'], ['Elusive', 'Queen Ant'], ['Ender', 'Zealot Bruiser'], ['Frozen', 'Polaris'],
    ['Humanoid', 'Wetwing'], ['Infernal', 'Flare'], ['Magmatic', 'Stridersurfer'], ['Mythological', 'Minos Hunter'],
    ['Pest', 'Praying Mantis'], ['Skeletal', 'Chill'], ['Subterranean', 'Driftling'], ['Undead', 'Zombie Soldier'],
    ['Woodland', 'Ent'],
  ].map(([mob, shard]) => ({
    id: `ruler_${mob.toLowerCase()}`, name: `${mob} Ruler`, shard, kind: 'additive', perLevel: 3, mobs: [mob], ruler: true,
  })),
  { id: 'elite', name: 'Elite', shard: 'Power Dragon', kind: 'additive', perLevel: 3, bossOnly: true },
  { id: 'warrior_attr', name: 'Warrior', shard: 'Barbarian Duke X', kind: 'additive', perLevel: 2.5, melee: true },
  { id: 'dominance', name: 'Dominance', shard: 'Thorn', kind: 'additive', perLevel: 1.5, fullHealth: true },
  { id: 'deadeye', name: 'Deadeye', shard: 'Skeletor', kind: 'additive', perLevel: 2.5, bow: true },
  { id: 'lifeline', name: 'Lifeline', shard: 'Kada Knight', kind: 'additive', perLevel: 2.5, lowHealth: true },
  { id: 'payback', name: 'Payback', shard: 'Spike', kind: 'additive', perLevel: 2, afterHit: true },
  { id: 'light_elem', name: 'Light Elemental', shard: 'Flash', kind: 'stat', stat: 'STRENGTH', perLevel: 1 },
  { id: 'stone_elem', name: 'Stone Elemental', shard: 'Quake', kind: 'stat', stat: 'STRENGTH', perLevel: 1 },
  { id: 'lightning_elem', name: 'Lightning Elemental', shard: 'Bolt', kind: 'stat', stat: 'STRENGTH', perLevel: 1 },
  { id: 'wind_elem', name: 'Wind Elemental', shard: 'Aero', kind: 'stat', stat: 'STRENGTH', perLevel: 1 },
  { id: 'storm_elem', name: 'Storm Elemental', shard: 'Tempest', kind: 'stat', stat: 'STRENGTH', perLevel: 1 },
  { id: 'unlimited_power', name: 'Unlimited Power', shard: 'Jormung', kind: 'statPct', stat: 'STRENGTH', perLevel: 0.1 },
  { id: 'unlimited_energy', name: 'Unlimited Energy', shard: 'Etherdrake', kind: 'statPct', stat: 'CRITICAL_DAMAGE', perLevel: 0.1 },
];

// Echo of Ruler: Ruler attributes +2%/level stronger. Echo of Echoes: other Echoes +5%/level stronger.
export const ECHO_RULER_PER_LEVEL = 2;
export const ECHO_ECHOES_PER_LEVEL = 5;

// ---------- Stars ----------
// Every star gives +2% item stats anywhere. Dungeon items instead get +10% per star (1-5)
// inside dungeons, and Master Stars (6-10) add +5% each only in Master Mode.
export const STAR_BONUS = 0.02;
export const DUNGEON_STAR_BONUS = 0.1;
export const MASTER_STAR_BONUS = 0.05;
export const DUNGEON_MODES = [['none', 'Outside dungeons'], ['catacombs', 'Catacombs'], ['master', 'Master Mode']];

// Catacombs level: multiplicative boost to dungeon item stats while in dungeons
// (wiki Dungeoneering table: +10% at level 0, +485% at 50). Levels past 50 are cosmetic,
// so the Catacombs level is capped at 50 everywhere it is used.
export const CATACOMBS_MAX_LEVEL = 50;
export const clampCatacombs = (level) => Math.max(0, Math.min(CATACOMBS_MAX_LEVEL, Math.floor(level || 0)));
const CATACOMBS_BOOST_LOW = [10, 15, 20, 25, 31, 38, 46, 55, 65];
export function catacombsBoost(level) {
  const lvl = clampCatacombs(level);
  return lvl < CATACOMBS_BOOST_LOW.length ? CATACOMBS_BOOST_LOW[lvl] : 65 + 10 * (lvl - 8);
}

// Items converted with essence ("dungeonized") become Dungeon Items: same in-dungeon star
// bonus, master stars and Catacombs boost as native dungeon gear.
export function asDungeonItem(item, dungeonized) {
  return item && !item.dungeon_item && item.can_dungeonize && dungeonized ? { ...item, dungeon_item: true } : item;
}

export function maxStars(item) {
  if (!item) return 0;
  return item.dungeon_item ? 10 : item.max_stars || 0;
}

export function starMultiplier(item, stars, dungeonMode) {
  const s = Math.max(0, Math.min(maxStars(item), Math.floor(stars || 0)));
  if (!s) return 1;
  if (!item.dungeon_item) return 1 + STAR_BONUS * s;
  const regular = Math.min(s, 5);
  const master = s - regular;
  if (dungeonMode === 'master') return 1 + DUNGEON_STAR_BONUS * regular + MASTER_STAR_BONUS * master;
  if (dungeonMode === 'catacombs') return 1 + DUNGEON_STAR_BONUS * regular;
  return 1 + STAR_BONUS * regular;
}

// ---------- Dungeon classes ----------
// Damage passives (multiplicative), only active in dungeons. Level cap 50.
// Berserk: +40% melee damage +0.75%/level (wiki: 77.5% at 50, "multiplicative melee Damage buff").
// Archer: +1.6% arrow damage per level; wiki total at 50 is +230%, so base 150%.
// Healer, Mage and Tank have no passive that changes a melee or bow hit.
// Classes page: class strength is doubled when only one player picks that class.
export const CLASS_MAX_LEVEL = 50;
export const DUNGEON_CLASSES = [
  { id: 'healer', name: 'Healer' },
  { id: 'mage', name: 'Mage' },
  { id: 'berserk', name: 'Berserk', melee: { base: 40, perLevel: 0.75 } },
  { id: 'archer', name: 'Archer', bow: { base: 150, perLevel: 1.6 } },
  { id: 'tank', name: 'Tank' },
];

// % damage from the class passive for this weapon type (0 if none).
export function classDamageBonus(classId, level, bow, solo) {
  const cls = DUNGEON_CLASSES.find((c) => c.id === classId);
  const passive = cls && (bow ? cls.bow : cls.melee);
  if (!passive) return 0;
  const lvl = Math.max(0, Math.min(CLASS_MAX_LEVEL, Math.floor(level || 0)));
  return (passive.base + passive.perLevel * lvl) * (solo ? 2 : 1);
}

// ---------- Dungeon drops ----------
// Floor tier picks the base stats (the API's 10-step tiered_stats): Floors I-VII = tiers 1-7,
// Master Mode I-VII = tiers 4-10. Quality rolls up to +50% stats; a 50% roll raises rarity by one.
export const QUALITY_MAX = 50;
const FLOOR_ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
export function floorLabel(tier) {
  const floors = [];
  if (tier >= 1 && tier <= 7) floors.push(`Floor ${FLOOR_ROMAN[tier]}`);
  if (tier >= 4 && tier <= 10) floors.push(`Master Mode ${FLOOR_ROMAN[tier - 3]}`);
  return floors.join(' / ');
}
// Only dungeon items with the full 10-tier table are floor drops with a quality roll.
export const isDungeonDrop = (item, tierCount) => !!item?.dungeon_item && tierCount === 10;

// ---------- Items that level up through milestones ----------
// The API only lists their starting stats. levelStats(n) returns the total stats at milestone n.
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV',
  'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI', 'XXVII', 'XXVIII', 'XXIX', 'XXX'];
export const PROGRESSION_ITEMS = {
  // David's Cloak (Hunting): milestones I-XXX. Strength/Health/Foraging Fortune +1 (I-XV), +2 (XVI-XXV),
  // +3 (XXVI-XXX); Sweep +1/+2/+3/+4/+5 by band; +1 Hunting Fortune each.
  DAVIDS_CLOAK: {
    label: 'Milestone',
    max: 30,
    names: ROMAN,
    base: { HEALTH: 50, MAGIC_FIND: 2 },
    rarity: [[30, 'MYTHIC'], [24, 'LEGENDARY'], [18, 'EPIC'], [12, 'RARE'], [6, 'UNCOMMON'], [0, 'COMMON']],
    levelStats(n) {
      const out = { ...this.base };
      const add = (k, v) => { out[k] = (out[k] || 0) + v; };
      for (let m = 1; m <= n; m++) {
        const main = m <= 15 ? 1 : m <= 25 ? 2 : 3;
        const sweep = m <= 5 ? 1 : m <= 10 ? 2 : m <= 15 ? 3 : m <= 20 ? 4 : 5;
        add('STRENGTH', main); add('HEALTH', main); add('FORAGING_FORTUNE', main);
        add('SWEEP', sweep); add('HUNTING_FORTUNE', 1);
      }
      return out;
    },
    tierAt(n) { return this.rarity.find(([m]) => n >= m)[1]; },
  },
};
