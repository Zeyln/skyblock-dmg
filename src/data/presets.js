// Build presets: a typical player's gear at three stages of current progression.
// Sources (reviewed 2026-11-04): hypixel.net Guides and Strategies threads from 2026 (Berserk, Archer,
// melee weapon and helmet guides; T4 Voidgloom, Blaze Slayer and T5 Tara guides; Kuudra gear threads),
// plus Coflnet prices. Stages follow power creep, not item age: early ≈ F5–F6 / Burning Kuudra,
// mid ≈ F7–early Master Mode / Fiery Kuudra, end ≈ M7 / Infernal Kuudra.
// Items are referenced by ID (renames keep IDs); an ID the item list doesn't have is reported, not guessed.
import { reforgeTable, calculate } from '../calc.js';
import { ENCHANTS, ENCHANT_CONFLICTS, enchantFits, ultimatesFor, ENEMIES, SLOT_ACCEPTS, tuningPoints, SHARDS,
  ARMOR_ULTIMATES, TUNING_PER_POINT, meleeHitTicks, shortbowTicks, SHORTBOWS, FEROCITY_CAP } from './mechanics.js';

export const PRESETS_REVIEWED = '2026-11-04';
export const STAGES = [['early', 'Early game'], ['mid', 'Mid game'], ['end', 'End game']];

// Upgrades every preset at a stage gets.
const LEVELS = {
  early: { books: 10, recomb: false, gems: 'FINE', mp: 700, combat: 40, cata: 30, cls: 30, sb: 200, god: false },
  mid: { books: 10, recomb: true, gems: 'FLAWLESS', mp: 1100, combat: 50, cata: 40, cls: 40, sb: 300, god: true },
  end: { books: 15, recomb: true, gems: 'PERFECT', mp: 1500, combat: 60, cata: 50, cls: 50, sb: 400, god: true },
};
// How each style spends its upgrades.
const STYLES = {
  melee: { armorReforge: 'ancient', weaponReforge: 'withered', power: ['strong', 'bloody', 'bloody'], gems: ['JASPER', 'ONYX'], tuning: { STRENGTH: 0.5, CRITICAL_DAMAGE: 0.5 } },
  bow: { armorReforge: 'ancient', weaponReforge: 'spiritual', power: ['strong', 'bloody', 'bloody'], gems: ['JASPER', 'ONYX'], tuning: { STRENGTH: 0.5, CRITICAL_DAMAGE: 0.5 } },
  mage: { armorReforge: 'necrotic', weaponReforge: 'heroic', power: ['sighted', 'bizarre', 'bizarre'], gems: ['SAPPHIRE'], tuning: { INTELLIGENCE: 1 } },
};
const STAGE_IDX = { early: 0, mid: 1, end: 2 };

// Weapon enchants: every one the weapon takes, at its stage's level (early, mid, end; capped at the
// enchant's top level). Sharpness, Smite, Bane of Arthropods and the other mob-type enchants don't
// conflict in SkyBlock (NEU enchant pools), so a weapon has them all. Of each conflicting pair the
// first is used, except Giant Killer / Titan Killer, which the calculator picks for the target.
const ENCH_LEVELS = {
  sharpness: [6, 6, 7], smite: [6, 7, 7], bane: [6, 6, 7], ender_slayer: [6, 6, 7], cubism: [5, 5, 6],
  impaling: [3, 3, 5], smoldering: [3, 4, 5], gravity: [5, 5, 6], woodsplitter: [5, 5, 6], pyroclasm: [4, 5, 6],
  critical: [6, 6, 7], giant_killer: [6, 6, 7], titan_killer: [6, 6, 7], prosecute: [5, 6, 6], first_strike: [4, 5, 5],
  thunderlord: [6, 6, 7], fire_aspect: [2, 3, 3], power: [6, 7, 7], overload: [4, 5, 5],
};
const ENCH_PREFER = ['prosecute', 'first_strike', 'thunderlord', 'giant_killer']; // over their conflict partner
// Weapon ultimates when a preset names none: melee Soul Eater early, Chimera later; mage weapons
// Ultimate Wise; other weapons Soul Eater.
const MELEE_ULT = { early: ['soul_eater', 5], mid: ['chimera', 1], end: ['chimera', 5] };
// Armor ultimates (one per piece, picked by the calculator) and attribute shards, at each stage's level.
const ARMOR_ULT_LEVEL = { early: 2, mid: 4, end: 5 };
const SHARD_LEVEL = { early: 3, mid: 6, end: 10 };
// The conditions the presets assume: teammates nearby (Legion: a dungeon party of 5, a Kuudra party
// of 4, solo elsewhere), experience levels (Wisdom).
const PLAYERS_NEARBY = { dungeon: 4, kuudra: 3 };
const EXP_LEVELS = { early: 50, mid: 100, end: 100 };
// Power stones the calculator compares, by style (the damage ones).
const POWER_CHOICES = {
  melee: ['strong', 'bloody', 'hurtful', 'shaded', 'silky', 'itchy', 'forceful', 'sanguisuge', 'scorching', 'bubba', 'mythical', 'fortuitous'],
  mage: ['sighted', 'bizarre', 'demonic', 'inspired', 'pretty'],
};
POWER_CHOICES.bow = POWER_CHOICES.melee;

const SLOTS = ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'];
const set = (prefix) => Object.fromEntries(SLOTS.map((s) => [s, `${prefix}${s}`]));
const withHelmet = (helmet, prefix) => ({ ...set(prefix), HELMET: helmet });

// Equipment by location and stage.
const DUNGEON_EQ = {
  early: { NECKLACE: 'BONE_NECKLACE', BELT: 'ADAPTIVE_BELT' },
  mid: { NECKLACE: 'BONE_NECKLACE', CLOAK: 'SHADOW_ASSASSIN_CLOAK', BELT: 'ADAPTIVE_BELT', WRIST: 'SOULWEAVER_GLOVES' },
  end: { NECKLACE: 'BONE_NECKLACE', CLOAK: 'SHADOW_ASSASSIN_CLOAK', BELT: 'ADAPTIVE_BELT', WRIST: 'SOULWEAVER_GLOVES' },
};
const OUTSIDE_EQ = {
  early: { NECKLACE: 'MOLTEN_NECKLACE', CLOAK: 'MOLTEN_CLOAK', BELT: 'MOLTEN_BELT', WRIST: 'MOLTEN_BRACELET' },
  mid: { NECKLACE: 'VANQUISHED_MAGMA_NECKLACE', CLOAK: 'DESTRUCTION_CLOAK', BELT: 'VANQUISHED_BLAZE_BELT', WRIST: 'GAUNTLET_OF_CONTAGION' },
  end: { NECKLACE: 'VANQUISHED_MAGMA_NECKLACE', CLOAK: 'ANNIHILATION_CLOAK', BELT: 'VANQUISHED_BLAZE_BELT', WRIST: 'GAUNTLET_OF_CONTAGION' },
};
// Equipment stars: dungeon gear gets master stars at endgame; Kuudra gear goes to 10.
const EQ_STARS = { dungeon: { early: 5, mid: 5, end: 10 }, outside: { early: 5, mid: 5, end: 10 } };
const EQ_SLOTS = ['NECKLACE', 'CLOAK', 'BELT', 'WRIST'];
// Equipment the calculator picks from when a preset loads (the location default above is where it
// starts), by slot, with prices in millions of coins (Coflnet lowest BIN, 2026-11-04). A stage takes
// the pieces up to its price limit. David's Cloak isn't sold, but its milestones are bought as shards
// on the Bazaar, so it's in every stage at milestone XXX.
const EQ_POOL = {
  NECKLACE: { MAGMA_LORD_GAUNTLET: 23, MYTHOS_NECKLACE: 12.7, STARRED_BONE_NECKLACE: 8.2, BONE_NECKLACE: 8.2, LAVA_SHELL_NECKLACE: 4.1,
    TERA_SHELL_NECKLACE: 3.2, DELIRIUM_NECKLACE: 1.7, MOLTEN_NECKLACE: 1.6, VANQUISHED_MAGMA_NECKLACE: 1.6, CHALLENGER_NECKLACE: 0.8,
    SNOW_NECKLACE: 0.2, BALLOON_SNAKE: 0.18 },
  CLOAK: { ANNIHILATION_CLOAK: 209, DESTRUCTION_CLOAK: 90, GOLDEN_FLEECE: 62.7, MYTHOS_CLOAK: 19.1, STARRED_SHADOW_ASSASSIN_CLOAK: 4,
    SHADOW_ASSASSIN_CLOAK: 2, ZORROS_CAPE: 1, MOLTEN_CLOAK: 0.9, SNOW_CLOAK: 0.2, DAVIDS_CLOAK: 0 },
  BELT: { THE_PRIMORDIAL: 180, MYTHOS_BELT: 9.3, SCOVILLE_BELT: 3.9, MOLTEN_BELT: 2.6, STARRED_ADAPTIVE_BELT: 2.2, IMPLOSION_BELT: 1.7,
    VANQUISHED_BLAZE_BELT: 1.1, ADAPTIVE_BELT: 0.83, SNOW_BELT: 0.2, BLAZE_BELT: 0.16 },
  WRIST: { MANTICORE_CLAW: 65.9, DEMONLORD_GAUNTLET: 40, SHRIVELED_BRACELET: 27, MYTHOS_BRACELET: 9.4, FLAMING_FIST: 7.5, SOULWEAVER_GLOVES: 4.5,
    GAUNTLET_OF_CONTAGION: 2.2, MOLTEN_BRACELET: 1.9, VANQUISHED_GLOWSTONE_GAUNTLET: 0.9, SNOW_GLOVES: 0.2, GLOWSTONE_GAUNTLET: 0.08 },
};
const EQ_PRICE_CAP = { early: 10, mid: 70, end: Infinity };
const EQ_MILESTONE = { DAVIDS_CLOAK: 30 };

const LION = { id: 'LION', rarity: 'LEGENDARY', level: 100, item: 'PET_ITEM_SHARPENED_CLAWS_UNCOMMON' };
const SKELETON = { id: 'SKELETON', rarity: 'LEGENDARY', level: 100, item: 'PET_ITEM_SHARPENED_CLAWS_UNCOMMON' };
const SHEEP = { id: 'SHEEP', rarity: 'LEGENDARY', level: 100, item: '' };
const SUBZERO_WISP = { id: 'SUBZERO_WISP', rarity: 'LEGENDARY', level: 100, item: 'PET_ITEM_SHARPENED_CLAWS_UNCOMMON' };
const TARANTULA = { id: 'TARANTULA', rarity: 'LEGENDARY', level: 100, item: 'PET_ITEM_SHARPENED_CLAWS_UNCOMMON' };
// Golden Dragon: midgame with a modest bank, endgame with 1B banked and the best pet item.
const GDRAG = {
  mid: { id: 'GOLDEN_DRAGON', rarity: 'LEGENDARY', level: 200, item: 'ANTIQUE_REMEDIES', bank: 100e6, goldDigits: 8 },
  end: { id: 'GOLDEN_DRAGON', rarity: 'LEGENDARY', level: 200, item: 'HEPHAESTUS_REMEDIES', bank: 1e9, goldDigits: 9 },
};
const GDRAG_MAGE = {
  mid: { ...GDRAG.mid, item: 'MINOS_RELIC' },
  end: { ...GDRAG.end, item: 'HEPHAESTUS_RELIC' },
};
const DUNGEON_TARGET = { early: 'Sadan (F6)', mid: 'Maxor (F7)', end: 'Maxor (M7)' };
// Kuudra (Future77): Duplex Terminator with Cubism (Kuudra is Cubic), Golden Dragon with 1B banked,
// a Gauntlet of Contagion and an Implosion Belt (the other two pieces "don't matter too much").
const KUUDRA_BOW = { cubism: 6 }; // on top of the stage's enchants
const KUUDRA_EQ = { BELT: 'IMPLOSION_BELT', WRIST: 'GAUNTLET_OF_CONTAGION' };
const GDRAG_KUUDRA = { ...GDRAG.end };

// One preset. weapon: [id, { stars, ench (levels over the stage's), ult: [id, level], attack, secondId }]; armor: slot -> id;
// armorStars; equipment: slot -> id (location + stage default when omitted).
const p = (stage, o) => ({ stage, ...o });

export const PRESET_SECTIONS = [
  {
    id: 'dungeon', name: 'Dungeon classes', location: 'dungeon',
    builds: [
      { id: 'berserk', name: 'Berserk', style: 'melee', cls: 'berserk', presets: [
        p('early', { weapon: ['HYPER_CLEAVER', { stars: 5 }], armor: set('SHADOW_ASSASSIN_'), armorStars: 5, pet: LION }),
        p('mid', { weapon: ['GIANT_CLEAVER', { stars: 5, ult: ['soul_eater', 5] }],
          armor: { ...set('POWER_WITHER_'), BOOTS: 'SPEED_WITHER_BOOTS' }, armorStars: 5, pet: GDRAG.mid }),
        p('end', { weapon: ['DARK_CLAYMORE', { stars: 10, ult: ['chimera', 5] }],
          armor: { ...withHelmet('DIAMOND_NECRON_HEAD', 'POWER_WITHER_'), BOOTS: 'SPEED_WITHER_BOOTS' }, armorStars: 10, pet: GDRAG.end }),
      ] },
      { id: 'archer', name: 'Archer', style: 'bow', cls: 'archer', presets: [
        p('early', { weapon: ['JUJU_SHORTBOW', { stars: 5, ult: ['soul_eater', 5] }], armor: set('SHADOW_ASSASSIN_'), armorStars: 5, pet: SKELETON }),
        p('mid', { weapon: ['TERMINATOR', { stars: 5, ult: ['duplex', 5] }],
          armor: { ...withHelmet('GOLD_NECRON_HEAD', 'POWER_WITHER_'), BOOTS: 'SPEED_WITHER_BOOTS' }, armorStars: 5, pet: GDRAG.mid }),
        p('end', { weapon: ['TERMINATOR', { stars: 5, ult: ['duplex', 5] }],
          armor: { HELMET: 'DIAMOND_NECRON_HEAD', CHESTPLATE: 'SKELETON_MASTER_CHESTPLATE', LEGGINGS: 'POWER_WITHER_LEGGINGS', BOOTS: 'SPEED_WITHER_BOOTS' },
          armorStars: 10, pet: GDRAG.end }),
      ] },
      { id: 'mage', name: 'Mage (right click)', style: 'mage', cls: 'mage', presets: [
        p('early', { weapon: ['BAT_WAND', { stars: 5, ult: ['ultimate_wise', 5], attack: 'right' }],
          armor: withHelmet('WITHER_GOGGLES', 'NECROMANCER_LORD_'), armorStars: 5, pet: SHEEP }),
        p('mid', { weapon: ['HYPERION', { stars: 5, ult: ['ultimate_wise', 5], attack: 'right' }],
          armor: withHelmet('WITHER_GOGGLES', 'WISE_WITHER_'), armorStars: 5, pet: GDRAG_MAGE.mid, deployable: 'OVERFLUX' }),
        p('end', { weapon: ['HYPERION', { stars: 10, ult: ['ultimate_wise', 5], attack: 'right' }],
          armor: set('WISE_WITHER_'), armorStars: 10, pet: GDRAG_MAGE.end, deployable: 'PLASMAFLUX' }),
      ] },
      // Left-click Mage is an endgame-only playstyle (every 2026 source).
      { id: 'mage_lcm', name: 'Mage (left click)', style: 'melee', cls: 'mage', presets: [
        p('end', { weapon: ['DARK_CLAYMORE', { stars: 10, ult: ['chimera', 5] }],
          armor: withHelmet('DIAMOND_NECRON_HEAD', 'WISE_WITHER_'), armorStars: 10, pet: GDRAG.end }),
      ] },
      // Few recent sources for Healer and Tank; endgame runs full Necron's with a Diamond Necron Head.
      { id: 'healer', name: 'Healer', style: 'bow', cls: 'healer', presets: [
        p('early', { weapon: ['HYPER_CLEAVER', { stars: 5 }], style: 'melee',
          armor: withHelmet('MENDER_FEDORA', 'SHADOW_ASSASSIN_'), armorStars: 5, pet: LION }),
        p('mid', { weapon: ['JUJU_SHORTBOW', { stars: 5, ult: ['soul_eater', 5] }],
          armor: withHelmet('MENDER_CROWN', 'NECROMANCER_LORD_'), armorStars: 5, pet: GDRAG.mid }),
        p('end', { weapon: ['TERMINATOR', { stars: 5, ult: ['duplex', 5] }],
          armor: withHelmet('DIAMOND_NECRON_HEAD', 'POWER_WITHER_'), armorStars: 10, pet: GDRAG.end }),
      ] },
      { id: 'tank', name: 'Tank', style: 'bow', cls: 'tank', presets: [
        p('early', { weapon: ['JUJU_SHORTBOW', { stars: 5, ult: ['soul_eater', 5] }],
          armor: set('NECROMANCER_LORD_'), armorStars: 5, pet: SKELETON }),
        p('mid', { weapon: ['TERMINATOR', { stars: 5, ult: ['duplex', 5] }],
          armor: withHelmet('REAPER_MASK', 'TANK_WITHER_'), armorStars: 5, pet: GDRAG.mid }),
        p('end', { weapon: ['TERMINATOR', { stars: 5, ult: ['duplex', 5] }],
          armor: withHelmet('DIAMOND_NECRON_HEAD', 'POWER_WITHER_'), armorStars: 10, pet: GDRAG.end }),
      ] },
    ],
  },
  {
    // Full Kuudra sets: outside dungeons a full Infernal 0★ set beats 3/4 with a Warden Helmet.
    id: 'outside', name: 'Outside dungeons', location: 'outside',
    builds: [
      { id: 'melee', name: 'Melee', style: 'melee', presets: [
        p('early', { weapon: ['BOUQUET_OF_LIES', { stars: 5 }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: LION }),
        p('mid', { weapon: ['HYPERION', { stars: 5, ult: ['chimera', 1] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid }),
        p('end', { weapon: ['DARK_CLAYMORE', { stars: 5, ult: ['chimera', 5] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, deployable: 'SOS_FLARE' }),
      ] },
      { id: 'archer', name: 'Archer', style: 'bow', presets: [
        p('early', { weapon: ['JUJU_SHORTBOW', { stars: 5, ult: ['soul_eater', 5] }], armor: set('BURNING_TERROR_'), armorStars: 10, pet: SKELETON }),
        p('mid', { weapon: ['TERMINATOR', { stars: 5, ult: ['duplex', 5] }], armor: set('INFERNAL_TERROR_'), armorStars: 0, pet: GDRAG.mid }),
        p('end', { weapon: ['TERMINATOR', { stars: 5, ult: ['duplex', 5] }], armor: set('INFERNAL_TERROR_'), armorStars: 10,
          pet: GDRAG.end, deployable: 'SOS_FLARE' }),
      ] },
      { id: 'mage', name: 'Mage', style: 'mage', presets: [
        p('early', { weapon: ['FIRE_VEIL_WAND', { stars: 10, attack: 'right' }], armor: set('BURNING_AURORA_'), armorStars: 10, pet: SHEEP }),
        p('mid', { weapon: ['HYPERION', { stars: 5, ult: ['ultimate_wise', 5], attack: 'right' }], armor: set('INFERNAL_AURORA_'), armorStars: 0,
          pet: GDRAG_MAGE.mid, deployable: 'OVERFLUX' }),
        p('end', { weapon: ['HYPERION', { stars: 5, ult: ['ultimate_wise', 5], attack: 'right' }], armor: set('INFERNAL_AURORA_'), armorStars: 10,
          pet: GDRAG_MAGE.end, deployable: 'PLASMAFLUX' }),
      ] },
    ],
  },
  {
    // Slayers follow general progression (the same stage armor), with each slayer's own weapon line.
    id: 'slayer', name: 'Slayers', location: 'outside',
    builds: [
      // The calculator shows Crimson beating Reaper Armor on Revenant bosses at every stage.
      { id: 'revenant', name: 'Revenant Horror', style: 'melee', presets: [
        p('early', { weapon: ['REAPER_SWORD', { stars: 5 }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: LION, target: 'Revenant Horror IV' }),
        p('mid', { weapon: ['AXE_OF_THE_SHREDDED', { stars: 5 }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid, target: 'Atoned Horror' }),
        p('end', { weapon: ['AXE_OF_THE_SHREDDED', { stars: 5, ult: ['chimera', 5] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, target: 'Atoned Horror' }),
      ] },
      { id: 'tarantula', name: 'Tarantula Broodfather', style: 'melee', presets: [
        p('early', { weapon: ['SCORPION_FOIL', { stars: 5 }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: TARANTULA, target: 'Tarantula Broodfather IV' }),
        p('mid', { weapon: ['SCORPION_FOIL', { stars: 5 }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid, target: 'Tarantula Broodfather V' }),
        p('end', { weapon: ['STING', { stars: 5, ult: ['chimera', 5] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, target: 'Conjoined Brood' }),
      ] },
      // Sven is easy enough that Sven-specific gear is obsolete past very early game: general melee builds.
      { id: 'sven', name: 'Sven Packmaster', style: 'melee', presets: [
        p('early', { weapon: ['BOUQUET_OF_LIES', { stars: 5 }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: LION, target: 'Sven Packmaster IV' }),
        p('mid', { weapon: ['HYPERION', { stars: 5, ult: ['chimera', 1] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid, target: 'Sven Packmaster IV' }),
        p('end', { weapon: ['DARK_CLAYMORE', { stars: 5, ult: ['chimera', 5] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, deployable: 'SOS_FLARE', target: 'Sven Packmaster IV' }),
      ] },
      // The Terminator for Hitshields is used automatically by the simulation.
      { id: 'voidgloom', name: 'Voidgloom Seraph', style: 'melee', presets: [
        p('early', { weapon: ['VORPAL_KATANA', {}], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: LION, target: 'Voidgloom Seraph III' }),
        p('mid', { weapon: ['ATOMSPLIT_KATANA', {}], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid, target: 'Voidgloom Seraph IV' }),
        p('end', { weapon: ['ATOMSPLIT_KATANA', { ult: ['chimera', 5] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, target: 'Voidgloom Seraph IV' }),
      ] },
      // Subzero Wisp early, then Golden Dragon (the user: both beat the Blaze pet).
      { id: 'demonlord', name: 'Inferno Demonlord', style: 'melee', presets: [
        p('early', { weapon: ['BURSTFIRE_DAGGER', { secondId: 'BURSTMAW_DAGGER' }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: SUBZERO_WISP, target: 'Inferno Demonlord II' }),
        p('mid', { weapon: ['HEARTFIRE_DAGGER', { secondId: 'HEARTMAW_DAGGER' }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid, target: 'Inferno Demonlord III' }),
        p('end', { weapon: ['HEARTFIRE_DAGGER', { ult: ['chimera', 5], secondId: 'HEARTMAW_DAGGER' }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, target: 'Inferno Demonlord IV' }),
      ] },
    ],
  },
  {
    // Future77, "The ULTIMATE Kuudra Guide" (YouTube, 2026-04-11), gear requirements and DPS / boss
    // chapters. Basic and Hot end with the Ballista (no player damage on Kuudra), so they have no preset.
    // The Burning and Fiery gear lists are the same (only the Kuudra talisman differs). Burning and
    // Fiery use the midgame upgrade level, Infernal the endgame one. Rend setups (pulling Rend arrows
    // out with the Terminator's ability) aren't modeled; only Duplex is.
    id: 'kuudra', name: 'Kuudra (not finished)', location: 'outside',
    stages: [['burning', 'Burning (T3)'], ['fiery', 'Fiery (T4)'], ['infernal', 'Infernal (T5)']],
    builds: [
      { id: 'dps', name: 'DPS phase', style: 'bow', presets: ['burning', 'fiery'].map((tier) =>
        p(tier, { level: 'mid', weapon: ['TERMINATOR', { stars: 5, ench: KUUDRA_BOW, ult: ['duplex', 5] }],
          armor: withHelmet('WITHER_GOGGLES', 'BURNING_TERROR_'), armorStars: 10, reforges: { CHESTPLATE: 'loving' },
          equipment: KUUDRA_EQ, pet: GDRAG_KUUDRA, target: 'Kuudra (not finished)' })).concat(
        p('infernal', { level: 'end', weapon: ['TERMINATOR', { stars: 5, ench: KUUDRA_BOW, ult: ['duplex', 5] }],
          armor: withHelmet('INFERNAL_AURORA_HELMET', 'INFERNAL_TERROR_'), armorStars: 10, reforges: { CHESTPLATE: 'loving' },
          equipment: KUUDRA_EQ, pet: GDRAG_KUUDRA, deployable: 'SOS_FLARE', target: 'Kuudra (not finished)' })) },
      // The Lair: swap to the damage Terror set. Warden Helmet beats Crown of Avarice for Duplex (Future77's pinned comment).
      { id: 'lair', name: 'Lair phase', style: 'bow', presets: [
        p('infernal', { level: 'end', weapon: ['TERMINATOR', { stars: 5, ench: KUUDRA_BOW, ult: ['duplex', 5] }],
          armor: withHelmet('WARDEN_HELMET', 'INFERNAL_TERROR_'), armorStars: 10,
          equipment: KUUDRA_EQ, pet: GDRAG_KUUDRA, deployable: 'SOS_FLARE', target: 'Kuudra (Infernal Lair phase, not finished)' }),
      ] },
    ],
  },
];

// Preset lookup by "section/build/stage".
export function findPreset(key) {
  const [sectionId, buildId, stage] = key.split('/');
  const section = PRESET_SECTIONS.find((s) => s.id === sectionId);
  const build = section?.builds.find((b) => b.id === buildId);
  const preset = build?.presets.find((x) => x.stage === stage);
  return preset ? { section, build, preset } : null;
}

// Gems for an item's slots: the style's preferred gem where a slot takes it, else the first damage gem it takes.
function gemsFor(item, quality, prefer) {
  const order = [...prefer, 'JASPER', 'ONYX', 'SAPPHIRE', 'RUBY', 'AMETHYST', 'OPAL'];
  return (item.gem_slots || []).map((type) => {
    const gem = order.find((g) => SLOT_ACCEPTS[type]?.includes(g));
    return gem ? { gem, quality } : null;
  });
}

// Turns a preset into calculator state (the parts it sets) for the given item lookup.
// Returns { state, target, missing: [item ids not in the list], dropped: [what didn't fit] }.
export function presetState(key, byId) {
  const found = findPreset(key);
  if (!found) return null;
  const { section, build, preset } = found;
  const level = preset.level || preset.stage; // the upgrade level (Kuudra tiers map onto mid / end)
  const lv = LEVELS[level];
  const style = STYLES[preset.style || build.style];
  const stageIdx = STAGE_IDX[level];
  const inDungeon = section.location === 'dungeon';
  const missing = [];
  const dropped = [];
  const books = { hpb: Math.min(10, lv.books), fuming: Math.max(0, lv.books - 10) };
  const piece = (id, kind, opts = {}) => {
    const item = id && byId.get(id);
    if (id && !item) missing.push(id);
    if (!item) return { id: '', reforge: 'none', recomb: false, stars: 0, gems: [], hpb: 0, fuming: 0 };
    let reforge = opts.reforge || 'none';
    const table = reforgeTable(kind, item);
    if (reforge !== 'none' && !table[reforge]) {
      // Items that take no reforge at all (wands) just go without.
      if (Object.keys(table).length) dropped.push(`${reforge} reforge on ${item.name}`);
      reforge = 'none';
    }
    const maxStars = item.dungeon_item ? 10 : item.max_stars || 0;
    return {
      id, reforge, recomb: lv.recomb && item.can_recombobulate !== false, stars: Math.min(opts.stars || 0, maxStars),
      gems: gemsFor(item, lv.gems, style.gems), ...(opts.books === false ? { hpb: 0, fuming: 0 } : books),
    };
  };

  const [weaponId, w] = preset.weapon;
  const weapon = { ...piece(weaponId, 'weapon', { reforge: style.weaponReforge, stars: w.stars }), enchants: {} };
  const witem = byId.get(weaponId);
  if (witem) {
    weapon.enchants = weaponEnchants(witem, stageIdx);
    // A preset's own levels on top (ench: id -> level).
    for (const [id, lv] of Object.entries(w.ench || {})) {
      const e = ENCHANTS.find((x) => x.id === id);
      if (e && enchantFits(e, witem)) weapon.enchants[id] = Math.min(lv, e.values.length);
      else dropped.push(`${id} on ${witem.name}`);
    }
    const ults = ultimatesFor(witem);
    const ult = w.ult || ((preset.style || build.style) === 'mage' ? ['ultimate_wise', 5]
      : ults.some((u) => u.id === 'chimera') ? MELEE_ULT[level] : ['soul_eater', 5]);
    const u = ults.find((x) => x.id === ult[0]);
    if (u) weapon.ultimate = { id: u.id, level: Math.min(ult[1], u.values.length) };
    else if (w.ult) dropped.push(`${w.ult[0]} on ${witem.name}`);
  }
  if (w.attack) weapon.attack = w.attack;
  if (w.secondId) weapon.secondId = w.secondId;

  const armor = Object.fromEntries(SLOTS.map((s) => [s, piece(preset.armor[s], 'armor', { reforge: preset.reforges?.[s] || style.armorReforge, stars: preset.armorStars })]));
  for (const s of SLOTS) if (armor[s].id) armor[s].ultimate = { id: 'legion', level: ARMOR_ULT_LEVEL[level] };
  const eqIds = { ...(inDungeon ? DUNGEON_EQ : OUTSIDE_EQ)[level], ...preset.equipment };
  const eqStars = EQ_STARS[inDungeon ? 'dungeon' : 'outside'][level];
  const eqPiece = (id) => ({ ...piece(id, 'equipment', { stars: eqStars, books: false }), ...(EQ_MILESTONE[id] ? { level: EQ_MILESTONE[id] } : {}) });
  const equipment = Object.fromEntries(EQ_SLOTS.map((s) => [s, eqPiece(eqIds[s])]));
  // The pieces the calculator may pick from (with their items): the default and the pool within the price limit.
  const eqPool = Object.fromEntries(EQ_SLOTS.map((s) => {
    const ids = new Set([eqIds[s], ...Object.entries(EQ_POOL[s]).filter(([, m]) => m <= EQ_PRICE_CAP[level]).map(([id]) => id)]);
    return [s, [...ids].filter((id) => id && byId.has(id)).map((id) => ({ ...eqPiece(id), item: byId.get(id) }))];
  }));

  const points = tuningPoints(lv.mp);
  const tuning = Object.fromEntries(Object.entries(style.tuning).map(([stat, share]) => [stat, Math.round(points * share)]));
  const pet = preset.pet || {};
  const state = {
    weapon, armor, equipment,
    magicalPower: lv.mp, power: style.power[stageIdx], tuning,
    pet: { id: pet.id || '', rarity: pet.rarity || 'LEGENDARY', level: pet.level || 100, item: pet.item || '' },
    petExtras: { bankCoins: pet.bank || 0, magicFind: 0, goldDigits: pet.goldDigits || 0 },
    combatLevel: lv.combat, catacombsLevel: lv.cata, skyblockLevel: lv.sb,
    dungeonClass: { id: build.cls || '', level: lv.cls, solo: false },
    godPotion: lv.god, deployable: preset.deployable || '',
    player: { nearbyPlayers: PLAYERS_NEARBY[section.id] || 0, expLevels: EXP_LEVELS[level] },
  };
  const target = preset.target || (inDungeon ? DUNGEON_TARGET[preset.stage] : '');
  // What tunePreset needs once the target is known.
  const tune = { style: preset.style || build.style, level, equipment: eqPool };
  return { state, target, missing: [...new Set(missing)], dropped, tune };
}

// Every damage enchant the weapon takes, at the stage's level, one of each conflicting pair.
function weaponEnchants(item, stageIdx) {
  const out = {};
  for (const e of ENCHANTS) {
    const lv = ENCH_LEVELS[e.id]?.[stageIdx];
    if (!lv || !enchantFits(e, item)) continue;
    const pair = ENCHANT_CONFLICTS.find((p) => p.includes(e.id));
    if (pair && !ENCH_PREFER.includes(e.id) && pair.some((x) => ENCH_PREFER.includes(x))) continue;
    out[e.id] = Math.min(lv, e.values.length);
  }
  return out;
}

// How good a build is for the calculator: damage per second from one hit's expected damage, the hit
// rate and Ferocity (melee and bows), or the ability's hit (mage).
export function buildScore(input, style) {
  if (style === 'mage') return calculate({ ...input, damageType: 'magic' }).expected || 0;
  const r = calculate(input);
  const as = r.totals?.ATTACK_SPEED || 0;
  const rate = !r.bow ? 20 / meleeHitTicks(as) : SHORTBOWS.includes(input.weapon?.item?.id) ? 20 / shortbowTicks(as) : 1;
  return (r.expected || 0) * rate * (1 + Math.min(FEROCITY_CAP, Math.max(0, r.totals?.FEROCITY || 0)) / 100);
}

/**
 * The choices a preset leaves to the calculator, against the input's target (input: calculator input
 * built from presetState's state; tune: its tune). Picks, in order: Giant or Titan Killer; each
 * equipment slot's piece (from tune.equipment); each armor piece's ultimate; the attribute shards that add damage; then the power stone and tuning together, so
 * Strength and Crit Damage (and Crit Chance, Attack Speed breakpoints) are balanced through both.
 * Returns { enchants, equipment (slot -> piece, without its item), armorUltimates (by armor index), shards, power, tuning }.
 */
export function tunePreset(input, tune) {
  const { style, level } = tune;
  const score = (inp) => buildScore(inp, style);
  let cur = { ...input, weapon: { ...input.weapon, enchants: { ...input.weapon.enchants } } };

  // Giant Killer or Titan Killer, whichever hits this target harder.
  const ench = cur.weapon.enchants;
  if (ench.giant_killer) {
    const tk = { ...ench, titan_killer: ench.giant_killer };
    delete tk.giant_killer;
    const alt = { ...cur, weapon: { ...cur.weapon, enchants: tk } };
    if (score(alt) > score(cur)) cur = alt;
  }

  // Equipment, slot by slot, twice round (for pieces that work together): the piece that adds the most.
  let equipment = null;
  if (tune.equipment) {
    const eq = EQ_SLOTS.map((s, i) => cur.equipment?.[i] || tune.equipment[s][0] || { id: '' });
    for (let round = 0; round < 2; round++) EQ_SLOTS.forEach((s, i) => {
      let best = eq[i];
      let bestScore = score({ ...cur, equipment: eq });
      for (const p of tune.equipment[s]) {
        const sc = score({ ...cur, equipment: eq.map((q, j) => (j === i ? p : q)) });
        if (sc > bestScore + 1e-9) { best = p; bestScore = sc; }
      }
      eq[i] = best;
    });
    cur.equipment = eq;
    equipment = Object.fromEntries(EQ_SLOTS.map((s, i) => { const { item, ...p } = eq[i]; return [s, p]; }));
  }

  // Armor ultimates, piece by piece: the one that adds the most (Legion when none adds anything).
  const ultLevel = ARMOR_ULT_LEVEL[level];
  const ults = ARMOR_ULTIMATES.filter((u) => u.effect && ultLevel >= (u.minLevel || 1));
  cur.armor = cur.armor.map((p) => ({ ...p }));
  cur.armor.forEach((p, i) => {
    if (!p?.item) return;
    let best = { id: 'legion', level: ultLevel };
    let bestScore = -Infinity;
    for (const u of ults) {
      const pick = { id: u.id, level: Math.min(ultLevel, u.values.length) };
      cur.armor[i] = { ...p, ultimate: pick };
      const sc = score(cur);
      if (sc > bestScore + 1e-9) { best = pick; bestScore = sc; }
    }
    cur.armor[i] = { ...p, ultimate: best };
  });

  // Attribute shards: each one that adds damage (with the Echoes when a Ruler does).
  const shardLevel = SHARD_LEVEL[level];
  const shards = {};
  const shardIds = SHARDS.filter((x) => !x.lowHealth && !x.afterHit).map((x) => x.id);
  if (style === 'mage') shards.mana_regeneration = shardLevel;
  for (const id of shardIds) {
    if (id === 'mana_regeneration') continue;
    const before = score({ ...cur, shards });
    if (score({ ...cur, shards: { ...shards, [id]: shardLevel } }) > before * (1 + 1e-6)) shards[id] = shardLevel;
  }
  if (Object.keys(shards).some((id) => id.startsWith('ruler_'))) Object.assign(shards, { echo_ruler: shardLevel, echo_echoes: shardLevel });
  cur.shards = shards;

  // Power stone and tuning together.
  const points = tuningPoints(cur.magicalPower);
  let best = { power: cur.power, tuning: cur.tuning, score: -Infinity };
  for (const power of POWER_CHOICES[style] || POWER_CHOICES.melee) {
    const t = bestTuning({ ...cur, power }, points, style, score);
    if (t.score > best.score) best = { power, ...t };
  }
  return { enchants: cur.weapon.enchants, equipment, armorUltimates: cur.armor.map((p) => p?.ultimate || null), shards, power: best.power, tuning: best.tuning };
}

// The best split of the tuning points: Intelligence for mages; otherwise Attack Speed up to each hit
// rate breakpoint in turn (it only counts when it reaches one), and the rest handed out a share at a
// time to whichever of Strength, Crit Damage and Crit Chance adds the most, then evened out point by point.
function bestTuning(input, points, style, score) {
  const at = (tuning) => score({ ...input, tuning });
  if (style === 'mage') return { tuning: { INTELLIGENCE: points }, score: at({ INTELLIGENCE: points }) };
  const stats = ['STRENGTH', 'CRITICAL_DAMAGE', 'CRITICAL_CHANCE'];
  const base = calculate({ ...input, tuning: {} });
  const as0 = base.totals?.ATTACK_SPEED || 0;
  const shortbow = SHORTBOWS.includes(input.weapon?.item?.id);
  const ticks = base.bow ? (shortbow ? shortbowTicks : null) : meleeHitTicks;
  const asOptions = [0];
  if (ticks) {
    for (let n = ticks(as0) - 1; n >= 1; n--) {
      const need = base.bow ? 100 * (10 / n - 1) : 100 * (10 / (n + 0.5) - 1) + 1e-6;
      const pts = Math.ceil((need - as0) / TUNING_PER_POINT.ATTACK_SPEED);
      if (pts > points) break;
      if (pts > 0) asOptions.push(pts);
    }
  }
  let best = { tuning: {}, score: -Infinity };
  for (const asPts of asOptions) {
    const t = Object.fromEntries(stats.map((k) => [k, 0]));
    if (asPts) t.ATTACK_SPEED = asPts;
    let left = points - asPts;
    const chunk = Math.max(1, Math.round(points / 30));
    while (left > 0) {
      const step = Math.min(chunk, left);
      let pick = null;
      let pickScore = -Infinity;
      for (const k of stats) {
        const sc = at({ ...t, [k]: t[k] + step });
        if (sc > pickScore) { pick = k; pickScore = sc; }
      }
      t[pick] += step;
      left -= step;
    }
    // Even out: move single points between the stats while that helps.
    let sc = at(t);
    for (let moved = true, guard = 0; moved && guard < 200; guard++) {
      moved = false;
      for (const a of stats) for (const b of stats) {
        if (a === b || t[a] < 1) continue;
        const next = { ...t, [a]: t[a] - 1, [b]: t[b] + 1 };
        const ns = at(next);
        if (ns > sc + 1e-9) { Object.assign(t, next); sc = ns; moved = true; }
      }
    }
    if (sc > best.score) best = { tuning: Object.fromEntries(Object.entries(t).filter(([, v]) => v)), score: sc };
  }
  return best;
}

// Item ids every preset uses (for checks against the item list).
export function presetItemIds() {
  const ids = new Set();
  for (const s of PRESET_SECTIONS) for (const b of s.builds) for (const x of b.presets) {
    ids.add(x.weapon[0]);
    if (x.weapon[1].secondId) ids.add(x.weapon[1].secondId);
    Object.values(x.armor).forEach((id) => ids.add(id));
    Object.values({ ...(s.location === 'dungeon' ? DUNGEON_EQ : OUTSIDE_EQ)[x.level || x.stage], ...x.equipment }).forEach((id) => ids.add(id));
  }
  for (const pool of Object.values(EQ_POOL)) Object.keys(pool).forEach((id) => ids.add(id));
  return [...ids];
}
export const presetTargetsExist = () => PRESET_SECTIONS.every((s) => s.builds.every((b) => b.presets.every((x) => {
  const t = x.target || (s.location === 'dungeon' ? DUNGEON_TARGET[x.stage] : '');
  return !t || ENEMIES.some((e) => e.name === t);
})));
