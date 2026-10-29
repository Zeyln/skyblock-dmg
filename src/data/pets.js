// Pet stat scaling and damage-relevant pet abilities / pet items.
// Pet numbers come from the NotEnoughUpdates repo (constants/petnums.json): each pet and rarity
// has stat and ability numbers at level 1 and level 100, interpolated linearly in between.
// Ability text comes from the NEU pet item lore, so ability rules match on that text and
// read the {n} placeholder index from it (indices differ between rarities).

import { RARITIES } from './mechanics.js';

const PET_STAT_KEYS = {
  CRIT_DAMAGE: 'CRITICAL_DAMAGE',
  CRIT_CHANCE: 'CRITICAL_CHANCE',
  BONUS_ATTACK_SPEED: 'ATTACK_SPEED',
  SPEED: 'WALK_SPEED',
};
export const normalizeStat = (k) => PET_STAT_KEYS[k] || k;

export const PET_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];

// Level range for stats. Dragons (Golden/Jade/Rose) use "101:200:1": levels 101-200 map to 1-100.
export function petLevelRange(petnums, pet, rarity) {
  const curve = petnums?.[pet]?.[rarity]?.stats_levelling_curve;
  if (curve) {
    const [from, to] = curve.split(':').map(Number);
    return { min: from, max: to, offset: from - 1 };
  }
  return { min: 1, max: 100, offset: 0 };
}

// Linear interpolation between the level-1 and level-100 numbers.
export function petNumbers(petnums, pet, rarity, level) {
  const data = petnums?.[pet]?.[rarity];
  if (!data?.['1'] || !data?.['100']) return null;
  const { min, max, offset } = petLevelRange(petnums, pet, rarity);
  const lvl = Math.max(min, Math.min(max, Math.floor(level || min))) - offset;
  const t = (lvl - 1) / 99;
  const lerp = (a = 0, b = 0) => a + (b - a) * t;
  const stats = {};
  const keys = new Set([...Object.keys(data['1'].statNums || {}), ...Object.keys(data['100'].statNums || {})]);
  for (const k of keys) stats[k] = lerp(data['1'].statNums?.[k], data['100'].statNums?.[k]);
  const lo = data['1'].otherNums || [];
  const hi = data['100'].otherNums || [];
  const otherNums = hi.map((v, i) => lerp(lo[i], v));
  return { stats, otherNums };
}

// Tier Boost raises the pet one rarity when data for it exists.
export function effectiveRarity(petnums, pet, rarity, item) {
  if (item !== 'PET_ITEM_TIER_BOOST') return rarity;
  const next = PET_RARITIES[PET_RARITIES.indexOf(rarity) + 1];
  return next && petnums?.[pet]?.[next] ? next : rarity;
}

export const rarityIdx = (r) => RARITIES.indexOf(r);

// ---------- Pet items ----------
// flat: added stats (boosted by T-Rex "Tyrant"). pct: % boost to the pet's own stats.
export const PET_ITEMS = {
  PET_ITEM_SHARPENED_CLAWS_UNCOMMON: { flat: { CRITICAL_DAMAGE: 15 } },
  SERRATED_CLAWS: { flat: { CRITICAL_DAMAGE: 25 } },
  PET_ITEM_BIG_TEETH_COMMON: { flat: { CRITICAL_CHANCE: 5 } },
  BIGGER_TEETH: { flat: { CRITICAL_CHANCE: 10 } },
  PET_ITEM_SPOOKY_CUPCAKE: { flat: { STRENGTH: 30 } },
  PET_ITEM_IRON_CLAWS_COMMON: { pct: { CRITICAL_DAMAGE: 40, CRITICAL_CHANCE: 40 } },
  GOLD_CLAWS: { pct: { CRITICAL_DAMAGE: 50, CRITICAL_CHANCE: 50 } },
  ANTIQUE_REMEDIES: { pct: { STRENGTH: 80 } },
  HEPHAESTUS_REMEDIES: { pct: { STRENGTH: 100 } },
  MINOS_RELIC: { pct: { __all: 33.3 } },
  HEPHAESTUS_RELIC: { pct: { __all: 50 } },
  PET_ITEM_TIER_BOOST: { tierBoost: true },
};

// ---------- Ability rules ----------
// re: matched against the lore (colour codes stripped, whitespace collapsed); capture groups
// return placeholder indices into otherNums. Each rule's apply() turns values into effects.
// ctx: { target, player, weaponId, bow, inDungeon, extras }
const R = (pet, name, re, apply) => ({ pet, name, re, apply });
// For lore with the numbers written out (no {n} placeholders): captures are read as numbers.
const RAW = (pet, name, re, apply) => ({ ...R(pet, name, re, apply), raw: true });
const N = '\\{(\\d+)\\}';
const mob = (m) => (ctx) => ctx.target.mobs.includes(m);

export const PET_RULES = [
  R('ENDER_DRAGON', 'End Strike', new RegExp(`Deal ${N}% more damage to [^.]*Ender mobs`),
    ([v], ctx) => (mob('Ender')(ctx) ? { additive: v } : null)),
  R('ENDER_DRAGON', 'Superior', new RegExp(`Increases all Combat stats and Magic Find by ${N}%`),
    ([v]) => ({ statPct: { __all: v } })),
  R('ENDER_DRAGON', 'One With The Dragon', new RegExp(`Aspect of the Dragons sword by ${N}\\s*Damage and ${N}`),
    ([d, s], ctx) => (ctx.weaponId === 'ASPECT_OF_THE_DRAGON' ? { stats: { DAMAGE: d, STRENGTH: s } } : null)),

  R('GOLDEN_DRAGON', 'Legendary Treasure', new RegExp(`Gain ${N}% damage for every million coins in your bank\\. \\(Max ${N}%\\)`),
    ([v, max], ctx) => ({ additive: Math.min(max, v * Math.floor((ctx.extras.bankCoins || 0) / 1e6)) })),
  R('GOLDEN_DRAGON', "Dragon's Greed", new RegExp(`Grants \\+${N}% Strength per 5 Magic Find\\. \\(Max \\+${N}%\\)`),
    ([v, max], ctx) => ({ statPct: { STRENGTH: Math.min(max, v * Math.floor((ctx.extras.magicFind || 0) / 5)) } })),
  R('GOLDEN_DRAGON', 'Shining Scales', /Grants \+11\.1 Strength and \+2\.2 Magic Find to your pet for each digit in your Gold Collection/,
    (_, ctx) => ({ petStats: { STRENGTH: 11.1 * Math.min(9, ctx.extras.goldDigits || 0) } })),

  R('LION', 'Primal Force', new RegExp(`Adds \\+${N}\\s*Damage and \\+${N}\\s*Strength to your weapons`),
    ([d, s]) => ({ stats: { DAMAGE: d, STRENGTH: s } })),
  R('LION', 'First Pounce', new RegExp(`First Strike, Triple-Strike, and Combo are ${N}% more effective`),
    ([v]) => ({ firstStrikeBoost: v })),
  R('LION', 'King of the Jungle', new RegExp(`Deal \\+${N}%\\s*Damage against mobs that have attacked you`),
    ([v], ctx) => (ctx.target.attackedYou ? { additive: v } : null)),

  R('MEGALODON', 'Blood Scent', new RegExp(`Deal up to \\+${N}%\\s*Damage based on the enemy's missing health`),
    ([v], ctx) => ({ additive: v * (100 - ctx.target.hpPct) / 100 })),
  R('TIGER', 'Apex Predator', new RegExp(`Deal \\+${N}% damage against targets with no other mobs within 15 blocks`),
    ([v], ctx) => (ctx.target.isolated ? { additive: v } : null)),
  R('TYRANNOSAURUS', 'Close Combat', new RegExp(`Deal ${N}% more damage to enemies within 1\\.5 blocks`),
    ([v], ctx) => (ctx.target.distance === 'close' ? { additive: v } : null)),
  R('TYRANNOSAURUS', 'Tyrant', new RegExp(`Combat stats granted by pet items on this pet are increased by ${N}%`),
    ([v]) => ({ petItemBoost: v })),
  // Additive by the target's level (the player enters it under the pet; unset counts as 100+).
  RAW('PIGMAN', 'Giant Slayer', /Deal \+(\d+)% damage to monsters Level 50\+ and \+(\d+)% damage to monsters Level 100\+/,
    ([lo, hi], ctx) => {
      const level = ctx.extras.targetLevel ?? 100;
      return level >= 100 ? { additive: hi } : level >= 50 ? { additive: lo } : null;
    }),
  // Multiplicative (wiki): Spooky mobs only appear during the Spooky Festival.
  R('BAT', 'Wings of Steel', new RegExp(`Deals \\+${N}% damage to Spooky enemies`),
    ([v], ctx) => (mob('Spooky')(ctx) ? { multiplier: 1 + v / 100 } : null)),
  R('ROCK', 'Steady Ground', new RegExp(`While sitting on your rock, deal \\+${N}x damage`),
    ([v], ctx) => (ctx.extras.onRock ? { multiplier: v } : null)),
  // Every 5th hit (5 s cooldown), ×5: only the simulation counts hits (it sets player.toss).
  RAW('GOLEM', 'Toss', /Every 5 hits, throw the enemy up into the air and deal (\d+)x damage/,
    ([v], ctx) => (ctx.player.toss ? { multiplier: v } : null)),
  // Not added: Bal's Cannibal (damage to Bal, which isn't a target here).
  R('GIRAFFE', 'Long Neck', new RegExp(`Increases your melee damage by ${N}% if you are more than 3 blocks away`),
    ([v], ctx) => (!ctx.bow && ctx.target.distance === 'far' ? { additive: v } : null)),
  R('GRIFFIN', 'Sacred Strength', new RegExp(`Gain \\+${N}%\\s*Strength when above 85%\\s*Health`),
    ([v], ctx) => (ctx.player.fullHealth ? { statPct: { STRENGTH: v } } : null)),
  R('GOLEM', 'Last Stand', /While at less than 20% HP[^(]*deal 40% more damage/,
    (_, ctx) => (ctx.player.lowHealth ? { additive: 40 } : null)),
  R('SKELETON', 'Bone Arrows', new RegExp(`Increase arrow damage by ${N}% which is doubled while in dungeons`),
    ([v], ctx) => (ctx.bow ? { additive: ctx.inDungeon ? v * 2 : v } : null)),

  R('WITHER_SKELETON', 'Wither Blood', new RegExp(`Deal ${N}% more damage to\\s*Wither mobs`),
    ([v], ctx) => (mob('Wither')(ctx) ? { additive: v } : null)),
  R('ZOMBIE', 'Rotten Blade', new RegExp(`Deal ${N}% more damage to\\s*Undead mobs`),
    ([v], ctx) => (mob('Undead')(ctx) ? { additive: v } : null)),
  R('MAGMA_CUBE', 'Salt Blade', new RegExp(`Deal ${N}% more damage to slimes`),
    ([v], ctx) => (mob('Cubic')(ctx) ? { additive: v } : null)),
  // The wiki lists Hedgehog's pest bonus as multiplicative (up to ×2).
  R('HEDGEHOG', 'Spiky Quills', new RegExp(`Deal ${N}% more damage to\\s*Pests`),
    ([v], ctx) => (mob('Pest')(ctx) ? { multiplier: 1 + v / 100 } : null)),
  R('KUUDRA', 'Kuudra Specialist', new RegExp(`Increases all damage to Kuudra and his minions by ${N}%`),
    ([v], ctx) => (/Kuudra/.test(ctx.target.enemy || '') ? { additive: v } : null)),

  R('PIGMAN', 'Pork Master', new RegExp(`Pigman Sword by ${N}\\s*Damage and ${N}`),
    ([d, s], ctx) => (ctx.weaponId === 'PIGMAN_SWORD' ? { stats: { DAMAGE: d, STRENGTH: s } } : null)),
  R('SQUID', 'Ink Specialty', new RegExp(`Ink Wand by ${N}\\s*Damage and ${N}`),
    ([d, s], ctx) => (ctx.weaponId === 'INK_WAND' ? { stats: { DAMAGE: d, STRENGTH: s } } : null)),
  R('BABY_YETI', 'Yeti Fury', new RegExp(`Yeti Sword by ${N}\\s*Damage`),
    ([d], ctx) => (ctx.weaponId === 'YETI_SWORD' ? { stats: { DAMAGE: d } } : null)),
  R('JERRY', 'Jerry', new RegExp(`Actually adds ${N} damage to the Aspect of the Jerry`),
    ([d], ctx) => (ctx.weaponId === 'ASPECT_OF_THE_JERRY' ? { stats: { DAMAGE: d } } : null)),
];

// Strips colour codes and stat icons (non-ASCII glyphs) so rules can match plain text.
export const cleanLore = (lines) => (lines || []).map((l) => l.replace(/§./g, '')).join(' ')
  .replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ');

// Fill {n} / {STAT} placeholders for display.
export function fillLore(line, nums) {
  return line
    .replace(/\{(\d+)\}/g, (_, i) => fmtNum(nums.otherNums[+i]))
    .replace(/\{([A-Z_]+)\}/g, (_, k) => fmtNum(nums.stats[k]));
}
const fmtNum = (v) => (v == null ? '?' : String(Math.round(v * 100) / 100));

/**
 * Resolve the equipped pet into stat sources and damage effects.
 * pet: { name, rarity, level, item, itemName, stats, otherNums, lore } (stats/otherNums from petNumbers)
 */
export function applyPet(pet, ctx) {
  const result = { sources: [], additive: [], multiplicative: [], statPct: {}, firstStrikeBoost: 0, abilities: [] };
  if (!pet?.stats) return result;

  const effects = [];
  const lore = pet.lore || '';
  for (const rule of PET_RULES) {
    if (rule.pet !== pet.id) continue;
    const m = lore.match(rule.re);
    if (!m) continue;
    const values = m.slice(1).map((i) => (rule.raw ? +i : pet.otherNums[+i] ?? 0));
    const eff = rule.apply(values, ctx);
    result.abilities.push({ name: rule.name, active: !!eff });
    if (eff) effects.push({ name: rule.name, ...eff });
  }

  // Pet's own stats (+ ability stats that count as pet stats), then pet item % boosts.
  const base = {};
  for (const [k, v] of Object.entries(pet.stats)) base[normalizeStat(k)] = v;
  for (const e of effects) for (const [k, v] of Object.entries(e.petStats || {})) base[k] = (base[k] || 0) + v;
  const item = PET_ITEMS[pet.item] || {};
  for (const [k, pct] of Object.entries(item.pct || {})) {
    for (const stat of Object.keys(base)) if (k === '__all' || k === stat) base[stat] *= 1 + pct / 100;
  }
  result.sources.push({ label: `Pet: ${pet.name} (${pet.rarity.toLowerCase()}, lvl ${pet.level})`, stats: base });

  if (item.flat) {
    const boost = 1 + effects.reduce((a, e) => a + (e.petItemBoost || 0), 0) / 100;
    const flat = Object.fromEntries(Object.entries(item.flat).map(([k, v]) => [k, v * boost]));
    result.sources.push({ label: `↳ Pet item: ${pet.itemName || pet.item}`, stats: flat });
  }

  for (const e of effects) {
    const label = `${pet.name}: ${e.name}`;
    if (e.stats) result.sources.push({ label: `↳ ${e.name}`, stats: e.stats });
    if (e.additive) result.additive.push({ label, value: e.additive });
    if (e.multiplier) result.multiplicative.push({ label, value: e.multiplier });
    for (const [k, v] of Object.entries(e.statPct || {})) if (v) result.statPct[k] = (result.statPct[k] || 0) + v;
    if (e.firstStrikeBoost) result.firstStrikeBoost += e.firstStrikeBoost;
  }
  return result;
}
