import { describe, it, expect } from 'vitest';
import { calculate, itemStats, rarityIndex, reforgeTable } from './calc.js';
import {
  powerMultiplier, combatWarriorBonus, POWERS, greedBonus, enchantConflict, floorLabel, catacombsBoost,
  ENEMIES, MOB_TYPES, enemyDungeonMode, floorStats, ENCHANTS, ultimatesFor, assumedAccessories,
} from './data/mechanics.js';
import { petNumbers, cleanLore } from './data/pets.js';
import { parseFormatting, stripFormatting, hasFormatting, MC_COLORS } from './mctext.js';

const sword = (stats, extra = {}) => ({ id: 'TEST_SWORD', name: 'Test', category: 'SWORD', tier: 'LEGENDARY', stats, ...extra });
const bow = (stats) => ({ id: 'TEST_BOW', name: 'Bow', category: 'BOW', tier: 'LEGENDARY', stats });

describe('core formula', () => {
  it('unarmed with base stats', () => {
    const r = calculate({});
    expect(r.nonCrit).toBe(5);
    expect(r.crit).toBe(7); // 5 * 1.5 = 7.5 -> 7
  });

  it('(5 + dmg) * (1 + str/100) * crit', () => {
    const r = calculate({ weapon: { item: sword({ DAMAGE: 100, STRENGTH: 100 }) } });
    // 105 * 2 = 210; crit 210 * 1.5 = 315
    expect(r.nonCrit).toBe(210);
    expect(r.crit).toBe(315);
  });

  it('sums additive bonuses then multiplies by multiplicative', () => {
    const r = calculate({
      weapon: { item: sword({ DAMAGE: 95 }), enchants: { sharpness: 5 } },
      combatLevel: 50,
      bonuses: [{ label: 'x', multiplier: 2 }],
    });
    // 100 * 1 * (1 + (30 + 200)/100) * 2 = 660
    expect(r.additiveMult).toBeCloseTo(3.3);
    expect(r.nonCrit).toBe(660);
  });

  it('target defense reduces the hit after all bonuses, then rounds', () => {
    const weapon = { item: sword({ DAMAGE: 95 }), enchants: { sharpness: 5 } };
    const r = calculate({ weapon, combatLevel: 50, bonuses: [{ label: 'x', multiplier: 2 }], target: { defense: 1000 } });
    // 660 × 100 / 1100 = 60; crit 990 × 100 / 1100 = 90
    expect(r.defenseMult).toBeCloseTo(1 / 11);
    expect(r.nonCrit).toBe(60);
    expect(r.crit).toBe(90);
    expect(calculate({ weapon }).defenseMult).toBe(1);
  });

  it('mixed-case and tiered API stats', () => {
    expect(itemStats({ stats: { damage: 10, DAMAGE: 5 }, tiered_stats: { STRENGTH: [1, 4] } }))
      .toEqual({ DAMAGE: 15, STRENGTH: 4 });
  });
});

describe('target-dependent bonuses', () => {
  it('smite only vs undead', () => {
    const w = { item: sword({ DAMAGE: 95 }), enchants: { smite: 7 } };
    expect(calculate({ weapon: w }).nonCrit).toBe(100);
    expect(calculate({ weapon: w, target: { mobs: ['Undead'] } }).nonCrit).toBe(150);
  });

  it('weapon multiplier vs mob type', () => {
    const r = calculate({ weapon: { item: sword({ DAMAGE: 95 }, { id: 'UNDEAD_SWORD' }) }, target: { mobs: ['Undead'] } });
    expect(r.nonCrit).toBe(200);
  });

  it('katanas hit Endermen, not every Ender mob', () => {
    const w = { item: sword({ DAMAGE: 95 }, { id: 'ATOMSPLIT_KATANA' }) };
    expect(calculate({ weapon: w, target: { mobs: ['Ender'], families: ['Enderman'] } }).multMult).toBe(4);
    expect(calculate({ weapon: w, target: { mobs: ['Ender', 'Airborne'] } }).multMult).toBe(1); // dragon
  });

  it('daggers have two bonuses, spirit sword scales with missing HP', () => {
    const dagger = { item: sword({ DAMAGE: 95 }, { id: 'HEARTMAW_DAGGER' }) };
    expect(calculate({ weapon: dagger, target: { mobs: ['Infernal'] } }).multMult).toBe(3.5);
    expect(calculate({ weapon: dagger, target: { mobs: ['Skeletal'] } }).multMult).toBe(2);
    const spirit = { item: sword({ DAMAGE: 95 }, { id: 'SPIRIT_SWORD' }) };
    expect(calculate({ weapon: spirit, target: { mobs: ['Undead'], hpPct: 25 } }).multMult).toBeCloseTo(2.5);
  });

  it('Hyperion ×1.5 vs Wither', () => {
    const r = calculate({ weapon: { item: sword({ DAMAGE: 95 }, { id: 'HYPERION' }) }, target: { mobs: ['Wither'] } });
    expect(r.multMult).toBe(1.5);
  });

  it('power applies to bows only, sharpness to melee only', () => {
    const r = calculate({ weapon: { item: bow({ DAMAGE: 95 }), enchants: { power: 7, sharpness: 7 } } });
    expect(r.additiveMult).toBeCloseTo(1.65);
  });

  it('execute scales with missing health', () => {
    const r = calculate({ weapon: { item: sword({ DAMAGE: 95 }), enchants: { execute: 5 } }, target: { hpPct: 40 } });
    expect(r.additiveMult).toBeCloseTo(1.6);
  });

  it('giant killer is capped', () => {
    const r = calculate({
      weapon: { item: sword({ DAMAGE: 95 }), enchants: { giant_killer: 7 } },
      target: { maxHp: 1e9 }, player: { maxHp: 1000 },
    });
    expect(r.additiveMult).toBeCloseTo(1.65);
  });

  it('ruler shard with both echoes maxes at +39%', () => {
    const r = calculate({
      weapon: { item: sword({ DAMAGE: 95 }) },
      shards: { ruler_undead: 10, echo_ruler: 10, echo_echoes: 10 },
      target: { mobs: ['Undead'] },
    });
    expect(r.additiveMult).toBeCloseTo(1.39);
  });
});

describe('mayors', () => {
  it('Jerry adds 10% to combat stats', () => {
    const r = calculate({ weapon: { item: sword({ DAMAGE: 100, STRENGTH: 100 }) }, mayor: 'jerry' });
    // Strength 100 -> 110: 105 * 2.1 = 220.5 -> 220; Crit Damage 50 -> 55
    expect(r.nonCrit).toBe(220);
    expect(r.critMult).toBeCloseTo(1.55);
  });

  it('Derpy doubles the target max HP for HP-based effects', () => {
    const hit = (mayor) => calculate({
      weapon: { item: sword({ DAMAGE: 95 }), enchants: { giant_killer: 1 } },
      target: { maxHp: 1100 }, player: { maxHp: 1000 }, mayor,
    });
    expect(hit('').additiveMult).toBeCloseTo(1.01);      // 10% more HP -> +1%
    expect(hit('derpy').additiveMult).toBeCloseTo(1.05); // 2,200 HP -> capped at +5%
  });
});

describe('accessories', () => {
  it('power multiplier matches wiki value at 250 MP', () => {
    expect(powerMultiplier(250)).toBeCloseTo(9.64, 1);
  });

  it('bloody power at 250 MP gives listed stats', () => {
    const r = calculate({ magicalPower: 250, power: 'bloody' });
    // + assumed accessories at 250 MP: Shark Tooth 8 and Day Crystal 5 Strength, Red Claw Talisman 1 Crit Damage
    expect(r.strength).toBeCloseTo(104.13 + 13, 1);
    expect(r.critDamage).toBeCloseTo(50 + 104.13 + 1, 1);
    expect(POWERS.find((p) => p.id === 'bloody').unique.ATTACK_SPEED).toBe(10);
  });

  it('tuning adds stats and warns when over budget', () => {
    const r = calculate({ magicalPower: 100, tuning: { STRENGTH: 15 } });
    expect(r.strength).toBe(15 + 13); // + Shark Tooth and Day Crystal assumed at 100 MP
    expect(r.notes.join()).toMatch(/only grants 10/);
  });
});

describe('reforges and gemstones', () => {
  const armor = (tier, extra = {}) => ({ item: { id: 'X_HELMET', name: 'Helm', category: 'HELMET', tier, stats: {} }, ...extra });

  it('armor reforge follows rarity and recomb', () => {
    expect(calculate({ armor: [armor('LEGENDARY', { reforge: 'fierce' })] }).strength).toBe(10);
    expect(calculate({ armor: [armor('LEGENDARY', { reforge: 'fierce', recomb: true })] }).strength).toBe(12);
  });

  it('recomb gives no stat increase at Divine, Special or above', () => {
    for (const tier of ['DIVINE', 'SPECIAL', 'VERY_SPECIAL', 'SUPREME']) {
      const piece = armor(tier, { reforge: 'fierce' });
      expect(calculate({ armor: [{ ...piece, recomb: true }] }).strength).toBe(calculate({ armor: [piece] }).strength);
    }
    // Mythic -> Divine still counts
    expect(calculate({ armor: [armor('MYTHIC', { reforge: 'fierce', recomb: true })] }).strength).toBe(14);
  });

  it('sword reforge damage stat', () => {
    const r = calculate({ weapon: { item: sword({ DAMAGE: 100 }), reforge: 'suspicious' } });
    expect(r.damage).toBe(113);
  });

  it('bow table used for bows', () => {
    const r = calculate({ weapon: { item: bow({ DAMAGE: 100 }), reforge: 'spiritual', recomb: true } });
    expect(r.strength).toBe(38); // legendary -> mythic
  });

  it('gem value by rarity and recomb', () => {
    const gems = [{ gem: 'JASPER', quality: 'PERFECT' }, { gem: 'ONYX', quality: 'PERFECT' }];
    const r = calculate({ armor: [armor('EPIC', { gems, recomb: true })] });
    expect(r.strength).toBe(13);
    expect(r.critDamage).toBe(50 + 10);
  });

  it('withered and ancient scale with catacombs level', () => {
    const r = calculate({
      catacombsLevel: 40,
      weapon: { item: sword({ DAMAGE: 100 }), reforge: 'withered' },
      armor: [armor('LEGENDARY', { reforge: 'ancient' })],
    });
    expect(r.strength).toBe(135 + 40 + 25);
    expect(r.critDamage).toBe(50 + 40);
  });

  it('renowned gives +1% stats per piece', () => {
    const r = calculate({ armor: [armor('LEGENDARY', { reforge: 'renowned' }), armor('LEGENDARY', { reforge: 'renowned' })] });
    expect(r.strength).toBeCloseTo(20 * 1.02);
  });
});

describe('enchants per weapon type', () => {
  const rod = (stats) => ({ id: 'TEST_ROD', name: 'Rod', category: 'FISHING_ROD', tier: 'LEGENDARY', stats });

  it('fishing rods ignore sword enchants but take Spiked Hook', () => {
    const r = calculate({ weapon: { item: rod({ DAMAGE: 95 }), enchants: { sharpness: 7, spiked_hook: 7 } } });
    expect(r.additiveMult).toBeCloseTo(1.35); // Spiked Hook VII only
    const s = calculate({ weapon: { item: sword({ DAMAGE: 95 }), enchants: { sharpness: 7, spiked_hook: 7 } } });
    expect(s.additiveMult).toBeCloseTo(1.5); // Sharpness VII only
  });

  it('a leftover Critical enchant adds no crit damage on a bow or rod', () => {
    expect(calculate({ weapon: { item: rod({ DAMAGE: 95 }), enchants: { critical: 7 } } }).critDamage).toBe(50);
    expect(calculate({ weapon: { item: bow({ DAMAGE: 95 }), enchants: { critical: 7 } } }).critDamage).toBe(50);
    expect(calculate({ weapon: { item: sword({ DAMAGE: 95 }), enchants: { critical: 7 } } }).critDamage).toBe(150);
  });

  it('offers only the ultimates a weapon type can take', () => {
    const names = (item) => ultimatesFor(item).map((u) => u.id);
    expect(names(rod({}))).toEqual(expect.arrayContaining(['soul_eater', 'fatal_tempo', 'inferno', 'ultimate_wise', 'flash']));
    expect(names(rod({}))).not.toContain('one_for_all');
    expect(names(sword({}))).not.toContain('flash');
  });

  it('Woodsplitter is for axes only', () => {
    const ws = ENCHANTS.find((e) => e.id === 'woodsplitter');
    expect(ws.on).toEqual(['AXE']);
  });
});

describe('accessories assumed from magical power', () => {
  const run = (magicalPower, accessoryInputs = {}, extra = {}) =>
    calculate({ weapon: { item: sword({ DAMAGE: 95 }) }, magicalPower, accessoryInputs, ...extra });

  it('picks the tiers reached at this MP', () => {
    expect(assumedAccessories(0)).toEqual({});
    expect(assumedAccessories(60)).toEqual({ shark_tooth: 1, day_crystal: 1 });
    expect(assumedAccessories(700)).toMatchObject({ red_claw: 3, day_crystal: 2, runeblade: 3, master_skull: 2 });
  });

  it('adds flat stats and the crystal for the time of day', () => {
    expect(run(100).strength).toBe(8 + 5);
    expect(run(100, { time: 'night' }).strength).toBe(8 + 5);
    expect(run(60, { time: 'night' }).strength).toBe(8); // no Night Crystal yet
    expect(run(700).critDamage).toBe(50 + 5);
  });

  it('conditional effects need their condition', () => {
    expect(run(600).damage).toBe(95);
    expect(run(600, { crowded: true }).damage).toBe(96); // Bluetooth Ring
    expect(run(600, { killDigits: 9 }).strength).toBe(8 + 10 + 7); // Blood God Crest, max 7 digits
    expect(run(1200, { recentKills: 4 }).strength).toBe(8 + 10 + 8); // Reaper Orb
  });

  it('Master Skull is a % Strength boost in Master Mode only', () => {
    const str = { item: sword({ DAMAGE: 95, STRENGTH: 100 }) };
    const strength = (dungeonMode) => calculate({ weapon: str, magicalPower: 500, dungeonMode }).strength;
    expect(strength('none')).toBe(113); // + Shark Tooth 8 and Day Crystal 5
    expect(strength('master')).toBeCloseTo(113 * 1.03); // Master Skull - Tier 3
  });

  it('Draconic vs dragons and Runeblade (axes vs Woodland) are additive', () => {
    const dragon = { mobs: ['Ender'], families: ['Dragon'] };
    expect(run(1000, {}, { target: dragon }).additiveMult).toBeCloseTo(1.03);
    expect(run(1000).additiveMult).toBe(1);
    const axe = { item: { id: 'TEST_AXE', name: 'Axe', category: 'AXE', tier: 'RARE', stats: { DAMAGE: 95 } } };
    const woodland = { mobs: ['Woodland'] };
    expect(calculate({ weapon: axe, magicalPower: 700, target: woodland }).additiveMult).toBeCloseTo(1.15);
    expect(run(700, {}, { target: woodland }).additiveMult).toBe(1); // a sword
  });

  it('End dragons are tagged as dragons', () => {
    expect(ENEMIES.find((e) => e.name === 'Superior Dragon').families).toContain('Dragon');
  });
});

describe('enchant conflicts and ultimates', () => {
  const w = (x) => ({ item: sword({ DAMAGE: 95 }), ...x });

  it('conflicting enchants: only the first counts', () => {
    const r = calculate({ weapon: w({ enchants: { execute: 5, prosecute: 5 } }), target: { hpPct: 50 } });
    expect(r.additive.map((a) => a.label)).toEqual(['Execute V']);
    expect(r.notes.join()).toMatch(/Prosecute conflicts with Execute/);
    expect(enchantConflict('prosecute', { execute: 1 })).toBe('execute');
    expect(enchantConflict('sharpness', { smite: 7 })).toBeNull();
  });

  it('One For All: +500% additive and ignores all other enchants', () => {
    const r = calculate({ weapon: w({ enchants: { sharpness: 7, critical: 7 }, ultimate: { id: 'one_for_all', level: 1 } }) });
    expect(r.additiveMult).toBeCloseTo(6);
    expect(r.critDamage).toBe(50);
  });

  it('One For All is melee only', () => {
    const r = calculate({ weapon: { item: bow({ DAMAGE: 95 }), ultimate: { id: 'one_for_all', level: 1 } } });
    expect(r.additiveMult).toBe(1);
  });

  it('Swarm and Combo scale with enemies / kills, capped', () => {
    const swarm = calculate({ weapon: w({ ultimate: { id: 'swarm', level: 5 } }), target: { nearbyEnemies: 20 } });
    expect(swarm.additiveMult).toBeCloseTo(2);
    const combo = calculate({ weapon: w({ ultimate: { id: 'combo', level: 3 } }), player: { comboKills: 50 } });
    expect(combo.additiveMult).toBeCloseTo(1.18);
  });

  it('Soul Eater adds Strength to the crit only, capped outside dungeons', () => {
    const r = calculate({ weapon: w({ ultimate: { id: 'soul_eater', level: 5 } }), player: { soulEaterMobDamage: 10000 } });
    expect(r.nonCrit).toBe(100);
    expect(r.crit).toBe(Math.floor(100 * 51 * 1.5)); // +5000 Strength
  });

  it('Ultimate Jerry multiplies Aspect of the Jerry base damage', () => {
    const aotj = { id: 'ASPECT_OF_THE_JERRY', name: 'AOTJ', category: 'SWORD', tier: 'COMMON', stats: { DAMAGE: 1 } };
    expect(calculate({ weapon: { item: aotj, ultimate: { id: 'ultimate_jerry', level: 5 } } }).damage).toBe(51);
    expect(calculate({ weapon: w({ ultimate: { id: 'ultimate_jerry', level: 5 } }) }).damage).toBe(95);
  });
});

describe('anvil books and Midas', () => {
  it('hot potato books, fuming only after 10, art of war', () => {
    const w = (x) => calculate({ weapon: { item: sword({ DAMAGE: 100 }), ...x } });
    expect(w({ hpb: 10 }).damage).toBe(120);
    expect(w({ hpb: 10, fuming: 5 }).strength).toBe(30);
    expect(w({ hpb: 9, fuming: 5 }).strength).toBe(18);
    expect(w({ artOfWar: true }).strength).toBe(5);
  });

  it('armor books add health/defense, not damage', () => {
    const helm = { id: 'H', name: 'H', category: 'HELMET', tier: 'EPIC', stats: {} };
    const r = calculate({ armor: [{ item: helm, hpb: 10, fuming: 5 }] });
    expect(r.totals.HEALTH).toBe(60);
    expect(r.damage).toBe(0);
  });

  it('greed bonus follows the price brackets', () => {
    expect(greedBonus('MIDAS_SWORD', 100000)).toBe(2);
    expect(greedBonus('MIDAS_SWORD', 2.5e6)).toBe(35);
    expect(greedBonus('MIDAS_SWORD', 50e6)).toBe(120);
    expect(greedBonus('MIDAS_SWORD', 250e6)).toBe(120);
    expect(greedBonus('STARRED_MIDAS_SWORD', 100e6)).toBe(170);
    expect(greedBonus('STARRED_MIDAS_SWORD', 250e6)).toBe(225);
  });

  it('midas price + gilded reforge, gilded hidden elsewhere', () => {
    const midas = { id: 'MIDAS_SWORD', name: "Midas' Sword", category: 'SWORD', tier: 'LEGENDARY', stats: { DAMAGE: 170 }, max_stars: 5 };
    const r = calculate({ weapon: { item: midas, price: 50e6, reforge: 'gilded', recomb: true } });
    expect(r.damage).toBe(170 + 120 + 90);
    expect(r.strength).toBe(120 + 90);
    expect(reforgeTable('weapon', midas).gilded).toBeDefined();
    expect(reforgeTable('weapon', sword({})).gilded).toBeUndefined();
  });
});

describe('stars and item tiers', () => {
  const dungeonSword = sword({ DAMAGE: 100 }, { dungeon_item: true });
  const crimson = { id: 'MOLTEN_BELT', name: 'Molten Belt', category: 'BELT', tier: 'EPIC', max_stars: 10, stats: { STRENGTH: 10 } };

  it('dungeon stars: +2%/star outside, +10%/star inside, master stars only in Master Mode', () => {
    const w = { item: dungeonSword, stars: 10 };
    expect(calculate({ weapon: w }).damage).toBeCloseTo(110);
    // In dungeons the Catacombs boost (+10% at Catacombs 0) adds to the star bonus.
    expect(calculate({ weapon: w, dungeonMode: 'catacombs' }).damage).toBeCloseTo(100 * (1 + 0.5 + 0.1));
    expect(calculate({ weapon: w, dungeonMode: 'master' }).damage).toBeCloseTo(100 * (1 + 0.75 + 0.1));
  });

  it('crit chance gets stars but not the Catacombs boost', () => {
    const w = { item: sword({ DAMAGE: 100, CRITICAL_CHANCE: 10 }, { dungeon_item: true }), stars: 5 };
    const r = calculate({ weapon: w, dungeonMode: 'catacombs', catacombsLevel: 50 });
    expect(r.critChance).toBeCloseTo(30 + 10 * 1.5); // 30 base player crit chance
    expect(r.damage).toBeCloseTo(100 * (1 + 0.5 + 4.85));
  });

  it('catacombs level boosts dungeon items only in dungeons', () => {
    expect(catacombsBoost(0)).toBe(10);
    expect(catacombsBoost(8)).toBe(65);
    expect(catacombsBoost(27)).toBe(255);
    expect(catacombsBoost(50)).toBe(485);
    expect(catacombsBoost(70)).toBe(485);
    // Catacombs level is capped at 50 everywhere, including per-level reforge bonuses.
    const r = calculate({ catacombsLevel: 70, weapon: { item: sword({ DAMAGE: 100 }), reforge: 'withered' } });
    expect(r.strength).toBe(135 + 50);
    expect(r.catacombsLevel).toBe(50);
    const w = { item: dungeonSword, stars: 5 };
    expect(calculate({ weapon: w, catacombsLevel: 50 }).damage).toBeCloseTo(110); // outside: stars only
    expect(calculate({ weapon: w, catacombsLevel: 50, dungeonMode: 'catacombs' }).damage).toBeCloseTo(100 * (1 + 0.5 + 4.85));
    const normal = { item: sword({ DAMAGE: 100 }) };
    expect(calculate({ weapon: normal, catacombsLevel: 50, dungeonMode: 'catacombs' }).damage).toBe(100);
  });

  it('dungeonized items get dungeon stars, master stars and the Catacombs boost', () => {
    const term = { id: 'TERMINATOR', name: 'Terminator', category: 'BOW', tier: 'LEGENDARY', can_dungeonize: true,
      max_stars: 5, stats: { DAMAGE: 100 } };
    const inMaster = (x) => calculate({ weapon: { item: term, stars: 10, ...x }, dungeonMode: 'master', catacombsLevel: 50 }).damage;
    expect(inMaster({})).toBeCloseTo(110); // normal item: +2%/star, max 5 stars, no Catacombs boost
    expect(inMaster({ dungeonized: true })).toBeCloseTo(100 * (1 + 0.75 + 4.85));
    // Outside dungeons dungeonizing changes nothing beyond the normal +2%/star.
    expect(calculate({ weapon: { item: term, stars: 5, dungeonized: true }, catacombsLevel: 50 }).damage).toBeCloseTo(110);
    // Items that can't be dungeonized ignore the flag.
    expect(calculate({ weapon: { item: { ...term, can_dungeonize: false }, stars: 5, dungeonized: true },
      dungeonMode: 'catacombs' }).damage).toBeCloseTo(110);
  });

  it('non-dungeon equipment stars give +2% each anywhere, capped at the item max', () => {
    expect(calculate({ equipment: [{ item: crimson, stars: 10 }] }).strength).toBeCloseTo(12);
    expect(calculate({ equipment: [{ item: crimson, stars: 15 }], dungeonMode: 'catacombs' }).strength).toBeCloseTo(12);
  });

  it('tiered_stats uses the selected tier', () => {
    const item = { id: 'T', name: 'T', category: 'HELMET', tier: 'EPIC', tiered_stats: { CRITICAL_DAMAGE: [19, 30, 50] } };
    expect(calculate({ armor: [{ item, statTier: 1 }] }).critDamage).toBe(50 + 19);
    expect(calculate({ armor: [{ item }] }).critDamage).toBe(50 + 50);
  });

  it('dungeon drops: floor tier picks base stats, quality multiplies them and 50% bumps rarity', () => {
    const tiers = (lo, hi) => Array.from({ length: 10 }, (_, i) => lo + i * (hi - lo) / 9);
    const drop = { id: 'SILENT_DEATH', name: 'Silent Death', category: 'SWORD', tier: 'EPIC', dungeon_item: true,
      tiered_stats: { DAMAGE: tiers(100, 190) } };
    expect(calculate({ weapon: { item: drop, statTier: 1 } }).damage).toBe(100);
    expect(calculate({ weapon: { item: drop, statTier: 10, quality: 50 } }).damage).toBe(285);
    expect(calculate({ weapon: { item: drop, statTier: 10, quality: 80 } }).damage).toBe(285); // capped
    expect(rarityIndex(drop, false, undefined, 50)).toBe(4); // epic -> legendary
    expect(rarityIndex(drop, true, undefined, 50)).toBe(5);
    expect(floorLabel(4)).toBe('Floor IV / Master Mode I');
    expect(floorLabel(10)).toBe('Master Mode VII');
  });

  it('quality is ignored on non-drop items', () => {
    const helm = { id: 'CRYPT_WITHERLORD_HELMET', name: 'C', category: 'HELMET', tier: 'EPIC', dungeon_item: true,
      tiered_stats: { CRITICAL_DAMAGE: [10, 20] } };
    expect(calculate({ armor: [{ item: helm, quality: 50 }] }).critDamage).toBe(70);
  });

  it("David's Cloak milestones set stats and rarity", () => {
    const item = { id: 'DAVIDS_CLOAK', name: "David's Cloak", category: 'CLOAK', tier: 'COMMON', stats: { health: 50 } };
    expect(calculate({ equipment: [{ item, level: 0 }] }).strength).toBe(0);
    expect(calculate({ equipment: [{ item, level: 15 }] }).strength).toBe(15);
    expect(calculate({ equipment: [{ item, level: 30 }] }).strength).toBe(50);
    expect(itemStats(item, { level: 30 }).HEALTH).toBe(100);
    expect(rarityIndex(item, false, 18)).toBe(3); // epic
  });
});

describe('pets', () => {
  const petnums = {
    ENDER_DRAGON: { LEGENDARY: {
      1: { otherNums: [2, 0.5, 0.3, 0.1], statNums: { STRENGTH: 0.5, CRIT_DAMAGE: 0.5, CRIT_CHANCE: 0.1 } },
      100: { otherNums: [200, 50, 30, 10], statNums: { STRENGTH: 50, CRIT_DAMAGE: 50, CRIT_CHANCE: 10 } },
    } },
    GOLDEN_DRAGON: { LEGENDARY: {
      1: { otherNums: [5.05, 0.25, 2.5, 0.125, 126.2], statNums: { STRENGTH: 25 } },
      100: { otherNums: [10, 0.5, 5, 0.25, 250], statNums: { STRENGTH: 50 } },
      stats_levelling_curve: '101:200:1',
    } },
  };
  const edragLore = cleanLore(['§7End Strike', '§7Deal §a{0}% §7more damage to §5⊙ Ender', '§7mobs.',
    'Superior', 'Increases all Combat stats and ✯ Magic Find by {3}%.']);
  const pet = (id, level, extra = {}) => ({
    id, name: id, rarity: 'LEGENDARY', level, ...petNumbers(petnums, id, 'LEGENDARY', level), lore: edragLore, ...extra,
  });

  it('interpolates stats between level 1 and 100', () => {
    expect(petNumbers(petnums, 'ENDER_DRAGON', 'LEGENDARY', 100).stats.STRENGTH).toBe(50);
    expect(petNumbers(petnums, 'ENDER_DRAGON', 'LEGENDARY', 1).stats.STRENGTH).toBe(0.5);
  });

  it('dragon pets use levels 101-200', () => {
    expect(petNumbers(petnums, 'GOLDEN_DRAGON', 'LEGENDARY', 200).otherNums[3]).toBe(0.25);
    expect(petNumbers(petnums, 'GOLDEN_DRAGON', 'LEGENDARY', 101).stats.STRENGTH).toBe(25);
  });

  it('applies pet stats, ability bonuses and pet item', () => {
    const r = calculate({ pet: pet('ENDER_DRAGON', 100, { item: 'GOLD_CLAWS' }), target: { mobs: ['Ender'] } });
    // Superior +10% combat stats; Gold Claws +50% pet CD
    expect(r.strength).toBeCloseTo(50 * 1.1);
    expect(r.critDamage).toBeCloseTo((50 + 75) * 1.1);
    expect(r.additive.find((a) => a.label.includes('End Strike')).value).toBe(200);
  });

  it('end strike only vs ender', () => {
    const r = calculate({ pet: pet('ENDER_DRAGON', 100) });
    expect(r.additive).toHaveLength(0);
    expect(r.petAbilities.find((a) => a.name === 'End Strike').active).toBe(false);
  });

  it('golden dragon legendary treasure is capped', () => {
    const lore = cleanLore(['Gain {3}% damage for every million coins in your bank. (Max {4}%)']);
    const r = calculate({ pet: pet('GOLDEN_DRAGON', 200, { lore }), petExtras: { bankCoins: 2e9 } });
    expect(r.additiveMult).toBeCloseTo(3.5);
  });
});

describe('dungeon classes', () => {
  const melee = { item: sword({ DAMAGE: 95 }) };
  const ranged = { item: bow({ DAMAGE: 95 }) };
  const run = (weapon, dungeonClass, dungeonMode = 'catacombs') => calculate({ weapon, dungeonClass, dungeonMode }).multMult;

  it('Berserk boosts melee in dungeons only', () => {
    expect(run(melee, { id: 'berserk', level: 50 })).toBeCloseTo(1.775);
    expect(run(melee, { id: 'berserk', level: 0 })).toBeCloseTo(1.4);
    expect(run(melee, { id: 'berserk', level: 50 }, 'none')).toBe(1);
    expect(run(ranged, { id: 'berserk', level: 50 })).toBe(1);
  });

  it('Archer boosts bows: +230% at 50; solo doubles; level capped at 50', () => {
    expect(run(ranged, { id: 'archer', level: 50 })).toBeCloseTo(3.3);
    expect(run(ranged, { id: 'archer', level: 99 })).toBeCloseTo(3.3);
    expect(run(ranged, { id: 'archer', level: 50, solo: true })).toBeCloseTo(5.6);
    expect(run(melee, { id: 'archer', level: 50 })).toBe(1);
  });

  it('Healer / Mage / Tank add no hit damage', () => {
    for (const id of ['healer', 'mage', 'tank']) expect(run(melee, { id, level: 50 })).toBe(1);
  });
});

describe('enemy presets', () => {
  const find = (name) => ENEMIES.find((e) => e.name === name);

  it('enemy decides the dungeon mode; regular dungeon mobs keep the user choice', () => {
    expect(enemyDungeonMode(find('Zealot'), 'master')).toBe('none');
    expect(enemyDungeonMode(find('Necron (F7)'), 'master')).toBe('catacombs');
    expect(enemyDungeonMode(find('Necron (M7)'), 'none')).toBe('master');
    expect(enemyDungeonMode(find('Wither Dragon (M7, any color)'), 'catacombs')).toBe('master');
    expect(enemyDungeonMode(find('Zombie Lord'), 'none')).toBe('catacombs');
    expect(enemyDungeonMode(find('Zombie Lord'), 'master')).toBe('master');
    expect(enemyDungeonMode(undefined, 'master')).toBe('master'); // custom target
  });

  it('every preset is well-formed and uses known mob types', () => {
    const names = ENEMIES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const e of ENEMIES) {
      for (const m of e.mobs) expect(MOB_TYPES).toContain(m);
      expect(['floor', 'master', 'either', undefined]).toContain(e.dungeon);
      if (e.dungeon === 'either') expect(e.hpRange).toBeTruthy();
    }
    expect(find('Crypt Ghoul').dungeon).toBeUndefined(); // Hub mob, not a dungeon mob
  });

  it('regular dungeon mobs have per-floor stats inside their HP range', () => {
    const FLOORS = ['E', ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => [`F${n}`, `M${n}`])];
    for (const e of ENEMIES.filter((x) => x.dungeon === 'either')) {
      const floors = Object.keys(e.floors || {});
      expect(floors.length, e.name).toBeGreaterThan(0);
      for (const f of floors) expect(FLOORS, `${e.name} ${f}`).toContain(f);
      const [lo, hi] = e.hpRange.split('–').map((v) => Number(v.replace(/[^0-9]/g, '')));
      for (const f of floors) {
        const { hp } = floorStats(e, f);
        expect(hp, `${e.name} ${f}`).toBeGreaterThanOrEqual(lo);
        expect(hp, `${e.name} ${f}`).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('floor stats give health and defense, or nothing where the mob does not spawn', () => {
    expect(floorStats(find('Zombie Soldier'), 'M7')).toEqual({ hp: 36000000, defense: 0 });
    expect(floorStats(find('Lost Adventurer'), 'F5')).toEqual({ hp: 302500, defense: 100 });
    expect(floorStats(find('Angry Archaeologist'), 'M3')).toEqual({ hp: 3000000, defense: 1050 });
    expect(floorStats(find('Zombie Lord'), 'F3')).toBeNull();
    expect(floorStats(find('Revenant Horror I'), 'F7')).toBeNull();
  });
});

describe('set bonuses', () => {
  const piece = (id, stats = {}, category = 'CHESTPLATE') => ({ item: { id, name: id, category, tier: 'LEGENDARY', stats } });
  const armorOf = (...ids) => ids.map((id) => piece(id));
  const swordW = { item: sword({ DAMAGE: 95 }) };
  const bowW = { item: bow({ DAMAGE: 95 }) };

  it('Crimson Dominus only adds damage at Infernal (lowest tier counts)', () => {
    const infernal = armorOf('INFERNAL_CRIMSON_HELMET', 'INFERNAL_CRIMSON_CHESTPLATE');
    expect(calculate({ weapon: swordW, armor: infernal }).additiveMult).toBeCloseTo(2); // 10 stacks × 10%
    expect(calculate({ weapon: swordW, armor: infernal, setInputs: { crimson: { stacks: 3 } } }).additiveMult).toBeCloseTo(1.3);
    const mixed = armorOf('INFERNAL_CRIMSON_HELMET', 'FIERY_CRIMSON_CHESTPLATE');
    expect(calculate({ weapon: swordW, armor: mixed }).additiveMult).toBe(1);
    expect(calculate({ weapon: swordW, armor: armorOf('INFERNAL_CRIMSON_HELMET') }).additiveMult).toBe(1); // 1 piece
  });

  it('Terror Hydra Strike scales with tier and piece count, bows only', () => {
    const three = armorOf('BURNING_TERROR_HELMET', 'INFERNAL_TERROR_CHESTPLATE', 'INFERNAL_TERROR_LEGGINGS');
    expect(calculate({ weapon: bowW, armor: three }).additiveMult).toBeCloseTo(1.7); // Burning, 3 pc: 7% × 10
    expect(calculate({ weapon: swordW, armor: three }).additiveMult).toBe(1);
  });

  it('skeleton arrow pieces + full set, Tuxedo, Final Destination toggle', () => {
    const master = armorOf('SKELETON_MASTER_HELMET', 'SKELETON_MASTER_CHESTPLATE', 'SKELETON_MASTER_LEGGINGS', 'SKELETON_MASTER_BOOTS');
    expect(calculate({ weapon: bowW, armor: master }).additiveMult).toBeCloseTo(1.45);
    const tux = armorOf('ELEGANT_TUXEDO_CHESTPLATE', 'ELEGANT_TUXEDO_LEGGINGS', 'ELEGANT_TUXEDO_BOOTS');
    expect(calculate({ weapon: swordW, armor: tux }).additiveMult).toBeCloseTo(2.5);
    const fd = armorOf('FINAL_DESTINATION_HELMET', 'FINAL_DESTINATION_CHESTPLATE', 'FINAL_DESTINATION_LEGGINGS', 'FINAL_DESTINATION_BOOTS');
    const vsEnderman = calculate({ weapon: swordW, armor: fd, target: { families: ['Enderman'] } });
    expect(vsEnderman.additiveMult).toBeCloseTo(2);
    expect(vsEnderman.strength).toBe(30);
    expect(calculate({ weapon: swordW, armor: fd, setInputs: { final_destination: { active: false } } }).strength).toBe(0);
  });

  it('Superior +5% stats, Adaptive scales piece stats with Catacombs, fragged pieces count', () => {
    const sup = ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'].map((s) => piece(`SUPERIOR_DRAGON_${s}`, { STRENGTH: 10 }));
    expect(calculate({ armor: sup }).strength).toBeCloseTo(42);
    const ad = ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'].map((s, i) => piece(`${i ? '' : 'STARRED_'}ADAPTIVE_${s}`, { STRENGTH: 10 }));
    expect(calculate({ armor: ad, catacombsLevel: 50 }).strength).toBeCloseTo(40 * 1.2);
  });

  it('Tarantula helmet and Mastiff derive Crit Damage from final stats', () => {
    const tara = [piece('TARANTULA_HELMET', { STRENGTH: 400 })];
    expect(calculate({ armor: tara }).critDamage).toBeCloseTo(50 + 40);
    const mastiff = ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'].map((s) => piece(`MASTIFF_${s}`, { DEFENSE: 100 }));
    expect(calculate({ armor: mastiff }).critDamage).toBeCloseTo(50 + 150); // Defense capped at 300 → +150
  });

  it('dungeon-only sets need the In dungeon switch; equipment piece bonuses', () => {
    const lord = ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'].map((s) => piece(`ZOMBIE_LORD_${s}`));
    const si = { zombie_lord: { minutes: 6 } };
    expect(calculate({ armor: lord, setInputs: si }).strength).toBe(0);
    expect(calculate({ armor: lord, setInputs: si, dungeonMode: 'catacombs' }).strength).toBe(60);
    const belt = { item: { id: 'VANQUISHED_BLAZE_BELT', name: 'b', category: 'BELT', tier: 'EPIC', stats: {} } };
    expect(calculate({ equipment: [belt] }).strength).toBe(10); // default 10,000 kills
    expect(calculate({ equipment: [belt], setInputs: { vanq_blaze: { kills: 3500 } } }).strength).toBe(3);
  });
});

describe('god potion', () => {
  it('adds strength / crit stats, and archery only for bows', () => {
    const melee = calculate({ weapon: { item: sword({ DAMAGE: 95 }) }, godPotion: true });
    expect(melee.strength).toBeCloseTo(78.75);
    expect(melee.critChance).toBe(55);
    expect(melee.critDamage).toBe(130);
    expect(melee.additiveMult).toBe(1);
    const ranged = calculate({ weapon: { item: bow({ DAMAGE: 95 }) }, godPotion: true });
    expect(ranged.additiveMult).toBeCloseTo(1.8);
  });
});

describe('minecraft text formatting', () => {
  it('splits colour codes into styled segments', () => {
    const segs = parseFormatting('§4Sin§5seeker Scythe');
    expect(segs.map((s) => s.text)).toEqual(['Sin', 'seeker Scythe']);
    expect(segs[0].color).toBe(MC_COLORS[4]);
    expect(segs[1].color).toBe(MC_COLORS[5]);
  });

  it('bold sticks until the next colour code; §r resets', () => {
    const segs = parseFormatting('§4§lS§c§lw §8(x)§r plain');
    expect(segs[0]).toMatchObject({ text: 'S', bold: true, color: MC_COLORS[4] });
    expect(segs[1]).toMatchObject({ text: 'w ', bold: true, color: MC_COLORS.c });
    expect(segs[2].bold).toBeUndefined();
    expect(segs[3]).toEqual({ text: ' plain' });
  });

  it('strips codes for plain text', () => {
    expect(stripFormatting('§4§lS§c§lword')).toBe('Sword');
    expect(stripFormatting('Booster Cookie §8(Quest)')).toBe('Booster Cookie (Quest)');
    expect(hasFormatting('Hyperion')).toBe(false);
  });
});

describe('combat skill', () => {
  it('4% per level to 50, then 1%', () => {
    expect(combatWarriorBonus(50)).toBe(200);
    expect(combatWarriorBonus(60)).toBe(210);
  });
});
