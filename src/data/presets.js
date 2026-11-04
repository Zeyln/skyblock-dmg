// Build presets: a typical player's gear at three stages of current progression.
// Sources (reviewed 2026-11-04): hypixel.net Guides and Strategies threads from 2026 (Berserk, Archer,
// melee weapon and helmet guides; T4 Voidgloom, Blaze Slayer and T5 Tara guides; Kuudra gear threads),
// plus Coflnet prices. Stages follow power creep, not item age: early ≈ F5–F6 / Burning Kuudra,
// mid ≈ F7–early Master Mode / Fiery Kuudra, end ≈ M7 / Infernal Kuudra.
// Items are referenced by ID (renames keep IDs); an ID the item list doesn't have is reported, not guessed.
import { reforgeTable } from '../calc.js';
import { ENCHANTS, enchantFits, ultimatesFor, ENEMIES, SLOT_ACCEPTS, tuningPoints } from './mechanics.js';

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

const SWORD_ENCH = {
  early: { sharpness: 6, critical: 6, giant_killer: 6, prosecute: 5, first_strike: 4 },
  mid: { sharpness: 6, critical: 6, giant_killer: 6, prosecute: 6, first_strike: 5 },
  end: { sharpness: 7, critical: 7, giant_killer: 7, prosecute: 6, first_strike: 5 },
};
const BOW_ENCH = {
  early: { power: 6, overload: 4 },
  mid: { power: 7, overload: 5 },
  end: { power: 7, overload: 5 },
};
// Slayer weapons swap Sharpness for the mob-type enchant at the same level.
const swap = (ench, id) => Object.fromEntries(Object.entries(ench).map(([k, v]) => [k === 'sharpness' ? id : k, v]));

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

const LION = { id: 'LION', rarity: 'LEGENDARY', level: 100, item: 'PET_ITEM_SHARPENED_CLAWS_UNCOMMON' };
const SKELETON = { id: 'SKELETON', rarity: 'LEGENDARY', level: 100, item: 'PET_ITEM_SHARPENED_CLAWS_UNCOMMON' };
const SHEEP = { id: 'SHEEP', rarity: 'LEGENDARY', level: 100, item: '' };
const BLAZE = { id: 'BLAZE', rarity: 'LEGENDARY', level: 100, item: 'ANTIQUE_REMEDIES' };
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
const KUUDRA_BOW = { mid: { ...BOW_ENCH.mid, cubism: 6 }, end: { ...BOW_ENCH.end, cubism: 6 } };
const KUUDRA_EQ = { BELT: 'IMPLOSION_BELT', WRIST: 'GAUNTLET_OF_CONTAGION' };
const GDRAG_KUUDRA = { ...GDRAG.end };

// One preset. weapon: [id, { stars, ench, ult: [id, level], attack, secondId }]; armor: slot -> id;
// armorStars; equipment: slot -> id (location + stage default when omitted).
const p = (stage, o) => ({ stage, ...o });

export const PRESET_SECTIONS = [
  {
    id: 'dungeon', name: 'Dungeon classes', location: 'dungeon',
    builds: [
      { id: 'berserk', name: 'Berserk', style: 'melee', cls: 'berserk', presets: [
        p('early', { weapon: ['HYPER_CLEAVER', { stars: 5, ench: SWORD_ENCH.early }], armor: set('SHADOW_ASSASSIN_'), armorStars: 5, pet: LION }),
        p('mid', { weapon: ['GIANT_CLEAVER', { stars: 5, ench: SWORD_ENCH.mid, ult: ['soul_eater', 5] }],
          armor: { ...set('POWER_WITHER_'), BOOTS: 'SPEED_WITHER_BOOTS' }, armorStars: 5, pet: GDRAG.mid }),
        p('end', { weapon: ['DARK_CLAYMORE', { stars: 10, ench: SWORD_ENCH.end, ult: ['chimera', 5] }],
          armor: { ...withHelmet('DIAMOND_NECRON_HEAD', 'POWER_WITHER_'), BOOTS: 'SPEED_WITHER_BOOTS' }, armorStars: 10, pet: GDRAG.end }),
      ] },
      { id: 'archer', name: 'Archer', style: 'bow', cls: 'archer', presets: [
        p('early', { weapon: ['JUJU_SHORTBOW', { stars: 5, ench: BOW_ENCH.early, ult: ['soul_eater', 5] }], armor: set('SHADOW_ASSASSIN_'), armorStars: 5, pet: SKELETON }),
        p('mid', { weapon: ['TERMINATOR', { stars: 5, ench: BOW_ENCH.mid, ult: ['duplex', 5] }],
          armor: { ...withHelmet('GOLD_NECRON_HEAD', 'POWER_WITHER_'), BOOTS: 'SPEED_WITHER_BOOTS' }, armorStars: 5, pet: GDRAG.mid }),
        p('end', { weapon: ['TERMINATOR', { stars: 5, ench: BOW_ENCH.end, ult: ['duplex', 5] }],
          armor: { HELMET: 'DIAMOND_NECRON_HEAD', CHESTPLATE: 'SKELETON_MASTER_CHESTPLATE', LEGGINGS: 'POWER_WITHER_LEGGINGS', BOOTS: 'SPEED_WITHER_BOOTS' },
          armorStars: 10, pet: GDRAG.end }),
      ] },
      { id: 'mage', name: 'Mage (right click)', style: 'mage', cls: 'mage', presets: [
        p('early', { weapon: ['BAT_WAND', { stars: 5, ench: SWORD_ENCH.early, ult: ['ultimate_wise', 5], attack: 'right' }],
          armor: withHelmet('WITHER_GOGGLES', 'NECROMANCER_LORD_'), armorStars: 5, pet: SHEEP }),
        p('mid', { weapon: ['HYPERION', { stars: 5, ench: SWORD_ENCH.mid, ult: ['ultimate_wise', 5], attack: 'right' }],
          armor: withHelmet('WITHER_GOGGLES', 'WISE_WITHER_'), armorStars: 5, pet: GDRAG_MAGE.mid, deployable: 'OVERFLUX' }),
        p('end', { weapon: ['HYPERION', { stars: 10, ench: SWORD_ENCH.end, ult: ['ultimate_wise', 5], attack: 'right' }],
          armor: set('WISE_WITHER_'), armorStars: 10, pet: GDRAG_MAGE.end, deployable: 'PLASMAFLUX' }),
      ] },
      // Left-click Mage is an endgame-only playstyle (every 2026 source).
      { id: 'mage_lcm', name: 'Mage (left click)', style: 'melee', cls: 'mage', presets: [
        p('end', { weapon: ['DARK_CLAYMORE', { stars: 10, ench: SWORD_ENCH.end, ult: ['chimera', 5] }],
          armor: withHelmet('DIAMOND_NECRON_HEAD', 'WISE_WITHER_'), armorStars: 10, pet: GDRAG.end }),
      ] },
      // Few recent sources for Healer and Tank; endgame runs full Necron's with a Diamond Necron Head.
      { id: 'healer', name: 'Healer', style: 'bow', cls: 'healer', presets: [
        p('early', { weapon: ['HYPER_CLEAVER', { stars: 5, ench: SWORD_ENCH.early }], style: 'melee',
          armor: withHelmet('MENDER_FEDORA', 'SHADOW_ASSASSIN_'), armorStars: 5, pet: LION }),
        p('mid', { weapon: ['JUJU_SHORTBOW', { stars: 5, ench: BOW_ENCH.mid, ult: ['soul_eater', 5] }],
          armor: withHelmet('MENDER_CROWN', 'NECROMANCER_LORD_'), armorStars: 5, pet: GDRAG.mid }),
        p('end', { weapon: ['TERMINATOR', { stars: 5, ench: BOW_ENCH.end, ult: ['duplex', 5] }],
          armor: withHelmet('DIAMOND_NECRON_HEAD', 'POWER_WITHER_'), armorStars: 10, pet: GDRAG.end }),
      ] },
      { id: 'tank', name: 'Tank', style: 'bow', cls: 'tank', presets: [
        p('early', { weapon: ['JUJU_SHORTBOW', { stars: 5, ench: BOW_ENCH.early, ult: ['soul_eater', 5] }],
          armor: set('NECROMANCER_LORD_'), armorStars: 5, pet: SKELETON }),
        p('mid', { weapon: ['TERMINATOR', { stars: 5, ench: BOW_ENCH.mid, ult: ['duplex', 5] }],
          armor: withHelmet('REAPER_MASK', 'TANK_WITHER_'), armorStars: 5, pet: GDRAG.mid }),
        p('end', { weapon: ['TERMINATOR', { stars: 5, ench: BOW_ENCH.end, ult: ['duplex', 5] }],
          armor: withHelmet('DIAMOND_NECRON_HEAD', 'POWER_WITHER_'), armorStars: 10, pet: GDRAG.end }),
      ] },
    ],
  },
  {
    // Full Kuudra sets: outside dungeons a full Infernal 0★ set beats 3/4 with a Warden Helmet.
    id: 'outside', name: 'Outside dungeons', location: 'outside',
    builds: [
      { id: 'melee', name: 'Melee', style: 'melee', presets: [
        p('early', { weapon: ['BOUQUET_OF_LIES', { stars: 5, ench: SWORD_ENCH.early }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: LION }),
        p('mid', { weapon: ['HYPERION', { stars: 5, ench: SWORD_ENCH.mid, ult: ['chimera', 1] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid }),
        p('end', { weapon: ['DARK_CLAYMORE', { stars: 5, ench: SWORD_ENCH.end, ult: ['chimera', 5] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, deployable: 'SOS_FLARE' }),
      ] },
      { id: 'archer', name: 'Archer', style: 'bow', presets: [
        p('early', { weapon: ['JUJU_SHORTBOW', { stars: 5, ench: BOW_ENCH.early, ult: ['soul_eater', 5] }], armor: set('BURNING_TERROR_'), armorStars: 10, pet: SKELETON }),
        p('mid', { weapon: ['TERMINATOR', { stars: 5, ench: BOW_ENCH.mid, ult: ['duplex', 5] }], armor: set('INFERNAL_TERROR_'), armorStars: 0, pet: GDRAG.mid }),
        p('end', { weapon: ['TERMINATOR', { stars: 5, ench: BOW_ENCH.end, ult: ['duplex', 5] }], armor: set('INFERNAL_TERROR_'), armorStars: 10,
          pet: GDRAG.end, deployable: 'SOS_FLARE' }),
      ] },
      { id: 'mage', name: 'Mage', style: 'mage', presets: [
        p('early', { weapon: ['FIRE_VEIL_WAND', { stars: 10, ench: {}, attack: 'right' }], armor: set('BURNING_AURORA_'), armorStars: 10, pet: SHEEP }),
        p('mid', { weapon: ['HYPERION', { stars: 5, ench: SWORD_ENCH.mid, ult: ['ultimate_wise', 5], attack: 'right' }], armor: set('INFERNAL_AURORA_'), armorStars: 0,
          pet: GDRAG_MAGE.mid, deployable: 'OVERFLUX' }),
        p('end', { weapon: ['HYPERION', { stars: 5, ench: SWORD_ENCH.end, ult: ['ultimate_wise', 5], attack: 'right' }], armor: set('INFERNAL_AURORA_'), armorStars: 10,
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
        p('early', { weapon: ['REAPER_SWORD', { stars: 5, ench: swap(SWORD_ENCH.early, 'smite') }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: LION, target: 'Revenant Horror IV' }),
        p('mid', { weapon: ['AXE_OF_THE_SHREDDED', { stars: 5, ench: swap(SWORD_ENCH.mid, 'smite') }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid, target: 'Atoned Horror' }),
        p('end', { weapon: ['AXE_OF_THE_SHREDDED', { stars: 5, ench: swap(SWORD_ENCH.end, 'smite'), ult: ['chimera', 5] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, target: 'Atoned Horror' }),
      ] },
      { id: 'tarantula', name: 'Tarantula Broodfather', style: 'melee', presets: [
        p('early', { weapon: ['SCORPION_FOIL', { stars: 5, ench: swap(SWORD_ENCH.early, 'bane') }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: TARANTULA, target: 'Tarantula Broodfather IV' }),
        p('mid', { weapon: ['SCORPION_FOIL', { stars: 5, ench: swap(SWORD_ENCH.mid, 'bane') }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid, target: 'Tarantula Broodfather V' }),
        p('end', { weapon: ['STING', { stars: 5, ench: swap(SWORD_ENCH.end, 'bane'), ult: ['chimera', 5] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, target: 'Conjoined Brood' }),
      ] },
      // Sven is easy enough that Sven-specific gear is obsolete past very early game: general melee builds.
      { id: 'sven', name: 'Sven Packmaster', style: 'melee', presets: [
        p('early', { weapon: ['BOUQUET_OF_LIES', { stars: 5, ench: SWORD_ENCH.early }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: LION, target: 'Sven Packmaster IV' }),
        p('mid', { weapon: ['HYPERION', { stars: 5, ench: SWORD_ENCH.mid, ult: ['chimera', 1] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid, target: 'Sven Packmaster IV' }),
        p('end', { weapon: ['DARK_CLAYMORE', { stars: 5, ench: SWORD_ENCH.end, ult: ['chimera', 5] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, deployable: 'SOS_FLARE', target: 'Sven Packmaster IV' }),
      ] },
      // The Terminator for Hitshields is used automatically by the simulation.
      { id: 'voidgloom', name: 'Voidgloom Seraph', style: 'melee', presets: [
        p('early', { weapon: ['VORPAL_KATANA', { ench: swap(SWORD_ENCH.early, 'ender_slayer') }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: LION, target: 'Voidgloom Seraph III' }),
        p('mid', { weapon: ['ATOMSPLIT_KATANA', { ench: swap(SWORD_ENCH.mid, 'ender_slayer') }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: GDRAG.mid, target: 'Voidgloom Seraph IV' }),
        p('end', { weapon: ['ATOMSPLIT_KATANA', { ench: swap(SWORD_ENCH.end, 'ender_slayer'), ult: ['chimera', 5] }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: GDRAG.end, target: 'Voidgloom Seraph IV' }),
      ] },
      // The Blaze pet beats Golden Dragon here (sraam's guide), so it stays at every stage.
      { id: 'demonlord', name: 'Inferno Demonlord', style: 'melee', presets: [
        p('early', { weapon: ['BURSTFIRE_DAGGER', { ench: SWORD_ENCH.early, secondId: 'BURSTMAW_DAGGER' }], armor: set('BURNING_CRIMSON_'), armorStars: 10, pet: BLAZE, target: 'Inferno Demonlord II' }),
        p('mid', { weapon: ['HEARTFIRE_DAGGER', { ench: SWORD_ENCH.mid, secondId: 'HEARTMAW_DAGGER' }], armor: set('INFERNAL_CRIMSON_'), armorStars: 0, pet: BLAZE, target: 'Inferno Demonlord III' }),
        p('end', { weapon: ['HEARTFIRE_DAGGER', { ench: SWORD_ENCH.end, ult: ['chimera', 5], secondId: 'HEARTMAW_DAGGER' }], armor: set('INFERNAL_CRIMSON_'), armorStars: 10,
          pet: BLAZE, target: 'Inferno Demonlord IV' }),
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
        p(tier, { level: 'mid', weapon: ['TERMINATOR', { stars: 5, ench: KUUDRA_BOW.mid, ult: ['duplex', 5] }],
          armor: withHelmet('WITHER_GOGGLES', 'BURNING_TERROR_'), armorStars: 10, reforges: { CHESTPLATE: 'loving' },
          equipment: KUUDRA_EQ, pet: GDRAG_KUUDRA, target: 'Kuudra (not finished)' })).concat(
        p('infernal', { level: 'end', weapon: ['TERMINATOR', { stars: 5, ench: KUUDRA_BOW.end, ult: ['duplex', 5] }],
          armor: withHelmet('INFERNAL_AURORA_HELMET', 'INFERNAL_TERROR_'), armorStars: 10, reforges: { CHESTPLATE: 'loving' },
          equipment: KUUDRA_EQ, pet: GDRAG_KUUDRA, deployable: 'SOS_FLARE', target: 'Kuudra (not finished)' })) },
      // The Lair: swap to the damage Terror set. Warden Helmet beats Crown of Avarice for Duplex (Future77's pinned comment).
      { id: 'lair', name: 'Lair phase', style: 'bow', presets: [
        p('infernal', { level: 'end', weapon: ['TERMINATOR', { stars: 5, ench: KUUDRA_BOW.end, ult: ['duplex', 5] }],
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
    for (const [id, level] of Object.entries(w.ench || {})) {
      const e = ENCHANTS.find((x) => x.id === id);
      if (e && enchantFits(e, witem)) weapon.enchants[id] = Math.min(level, e.values.length);
      else dropped.push(`${id} on ${witem.name}`);
    }
    if (w.ult) {
      const u = ultimatesFor(witem).find((x) => x.id === w.ult[0]);
      if (u) weapon.ultimate = { id: u.id, level: Math.min(w.ult[1], u.values.length) };
      else dropped.push(`${w.ult[0]} on ${witem.name}`);
    }
  }
  if (w.attack) weapon.attack = w.attack;
  if (w.secondId) weapon.secondId = w.secondId;

  const armor = Object.fromEntries(SLOTS.map((s) => [s, piece(preset.armor[s], 'armor', { reforge: preset.reforges?.[s] || style.armorReforge, stars: preset.armorStars })]));
  const eqIds = { ...(inDungeon ? DUNGEON_EQ : OUTSIDE_EQ)[level], ...preset.equipment };
  const eqStars = EQ_STARS[inDungeon ? 'dungeon' : 'outside'][level];
  const equipment = Object.fromEntries(['NECKLACE', 'CLOAK', 'BELT', 'WRIST'].map((s) => [s, piece(eqIds[s], 'equipment', { stars: eqStars, books: false })]));

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
  };
  const target = preset.target || (inDungeon ? DUNGEON_TARGET[preset.stage] : '');
  return { state, target, missing: [...new Set(missing)], dropped };
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
  return [...ids];
}
export const presetTargetsExist = () => PRESET_SECTIONS.every((s) => s.builds.every((b) => b.presets.every((x) => {
  const t = x.target || (s.location === 'dungeon' ? DUNGEON_TARGET[x.stage] : '');
  return !t || ENEMIES.some((e) => e.name === t);
})));
