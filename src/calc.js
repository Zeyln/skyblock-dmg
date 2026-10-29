import {
  BASE_PLAYER_STATS, ENCHANTS, weaponMultipliers, SWORD_REFORGES, BOW_REFORGES, ARMOR_REFORGES, REFORGE_EXTRAS,
  RARITIES, GEMS, gemValue, PROGRESSION_ITEMS, starMultiplier,
  POTATO_STATS, HOT_POTATO_MAX, FUMING_POTATO_MAX, ART_OF_WAR, PRICE_ITEMS, greedBonus,
  ULTIMATE_ENCHANTS, ultimatesFor, enchantFits, weaponCategory, ACCESSORY_EFFECTS, assumedAccessories, WEAPON_ABILITIES, enchantConflict, GOD_POTION, MAYOR_JERRY_STAT_PCT, QUALITY_MAX, floorLabel, isDungeonDrop,
  catacombsBoost, clampCatacombs, asDungeonItem, DUNGEON_CLASSES, CLASS_MAX_LEVEL, classDamageBonus,
  POWERS, powerMultiplier, TUNING_PER_POINT, tuningPoints, SHARDS,
  ECHO_RULER_PER_LEVEL, ECHO_ECHOES_PER_LEVEL, combatWarriorBonus,
} from './data/mechanics.js';
import { REFORGE_STONES } from './data/reforgeStones.js';
import { applyPet } from './data/pets.js';
import { detectSets, evaluateSets } from './data/sets.js';

export const DAMAGE_STATS = ['DAMAGE', 'STRENGTH', 'CRITICAL_DAMAGE', 'CRITICAL_CHANCE'];

// Number of stat tiers an item has in the API's tiered_stats (0 if none).
export function statTierCount(item) {
  return Math.max(0, ...Object.values(item?.tiered_stats || {}).map((v) => (Array.isArray(v) ? v.length : 0)));
}

// API stats come in mixed case and sometimes as tiered arrays; flatten to UPPER_CASE numbers.
// tier: 1-based stat tier for tiered items (defaults to the highest). level: milestone for
// progression items such as David's Cloak (defaults to max).
export function itemStats(item, { tier, level } = {}) {
  if (!item) return {};
  const prog = PROGRESSION_ITEMS[item.id];
  if (prog) return prog.levelStats(level ?? prog.max);
  const out = {};
  for (const [k, v] of Object.entries(item.stats || {})) {
    const key = k.toUpperCase();
    out[key] = (out[key] || 0) + v;
  }
  for (const [k, v] of Object.entries(item.tiered_stats || {})) {
    const key = k.toUpperCase();
    if (!Array.isArray(v) || !v.length) continue;
    const idx = Math.min(v.length, Math.max(1, tier || v.length)) - 1;
    out[key] = (out[key] || 0) + v[idx];
  }
  return out;
}

// Rarity before recombobulation; progression items change rarity with their milestone.
export function baseTier(item, level) {
  const prog = item && PROGRESSION_ITEMS[item.id];
  return prog ? prog.tierAt(level ?? prog.max) : item?.tier;
}

export function isBow(item) {
  return item?.category === 'BOW';
}

const hitsMob = (mobs, target) => !mobs || mobs.some((m) => target.mobs.includes(m));

function addStats(into, stats, scale = 1) {
  for (const [k, v] of Object.entries(stats)) into[k] = (into[k] || 0) + v * scale;
}

// Rarity index after recombobulation (special/very special items count as their own top tier).
// Recombobulating only adds stats below Divine. Divine and the rarities above it (Special,
// Very Special, ...) aren't in the reforge/gem tables, so it changes nothing for them.
export function recombHasEffect(item, level) {
  const idx = RARITIES.indexOf(baseTier(item, level) || 'COMMON');
  return idx >= 0 && idx < RARITIES.indexOf('DIVINE');
}

export function rarityIndex(item, recomb, level, quality) {
  let idx = RARITIES.indexOf(baseTier(item, level) || 'COMMON');
  // Special / Very Special / etc. use the Mythic column of reforge and gem tables.
  if (idx < 0) idx = RARITIES.indexOf('MYTHIC');
  const perfect = quality >= QUALITY_MAX && isDungeonDrop(item, statTierCount(item));
  const recombGain = recomb && recombHasEffect(item, level) ? 1 : 0;
  return Math.min(idx + recombGain + (perfect ? 1 : 0), RARITIES.length - 1);
}

// Reforges available to an item: the Blacksmith's basic ones for its type, plus the reforge stones
// that fit its type, or that fit only certain items (Warped, Gilded, Coldfused…) when it's one of them.
// Fishing rods, axes and equipment have no basic combat reforges here.
const STONE_TYPES = {
  SWORD: ['SWORD', 'SWORD/ROD'], LONGSWORD: ['SWORD', 'SWORD/ROD'], GAUNTLET: ['SWORD', 'SWORD/ROD'],
  BOW: ['BOW'], FISHING_ROD: ['ROD', 'SWORD/ROD'], AXE: ['AXE'],
};
export function reforgeTable(kind, item) {
  const cat = weaponCategory(item);
  let basic = {};
  let types = [];
  if (kind === 'weapon') {
    basic = cat === 'BOW' ? BOW_REFORGES : STONE_TYPES[cat]?.includes('SWORD') ? SWORD_REFORGES : {};
    types = STONE_TYPES[cat] || [];
  } else if (kind === 'armor') {
    basic = ARMOR_REFORGES;
    types = ['ARMOR', item?.category];
  } else if (kind === 'equipment') types = ['EQUIPMENT', item?.category];
  const id = (item?.id || '').replace(/^STARRED_/, '');
  const stones = Object.entries(REFORGE_STONES)
    .filter(([, r]) => (r.items ? r.items.includes(id) || r.items.includes(item?.id) : r.types.some((t) => types.includes(t))))
    .map(([k, r]) => [k, { ...r, ...REFORGE_EXTRAS[k] }]);
  return { ...basic, ...Object.fromEntries(stones) };
}

function reforgeStats(ref, rarityIdx) {
  const out = {};
  for (const [k, arr] of Object.entries(ref.stats)) out[k] = arr[Math.min(rarityIdx, arr.length - 1)];
  return out;
}

// Every stat source contributed by one weapon/armor/equipment piece.
function pieceSources(piece, kind, input, statPct) {
  const item = piece.item;
  const out = [];
  const drop = isDungeonDrop(item, statTierCount(item));
  const quality = drop ? Math.max(0, Math.min(QUALITY_MAX, piece.quality || 0)) : 0;
  const inDungeon = input.dungeonMode === 'catacombs' || input.dungeonMode === 'master';
  const dungeonItem = asDungeonItem(item, piece.dungeonized);
  const cataBonus = inDungeon && dungeonItem.dungeon_item ? catacombsBoost(input.catacombsLevel) / 100 : 0;
  const starBonus = starMultiplier(dungeonItem, piece.stars, input.dungeonMode) - 1;
  // Quality rolls the base stats; stars and the Catacombs boost then add together (wiki: Catacombs ›
  // Stat Bonuses). Crit Chance gets the stars but not the Catacombs boost.
  const qualityMult = 1 + quality / 100;
  const scale = qualityMult * (1 + starBonus + cataBonus);
  const unstarred = itemStats(item, { tier: piece.statTier, level: piece.level });
  // Price-paid bonus (Midas' Sword) is part of the item's stats, so stars scale it too.
  const greed = PRICE_ITEMS[item.id] ? greedBonus(item.id, piece.price) : 0;
  if (greed) addStats(unstarred, { DAMAGE: greed, STRENGTH: greed });
  const base = {};
  for (const [k, v] of Object.entries(unstarred)) {
    base[k] = v * (k === 'CRITICAL_CHANCE' ? qualityMult * (1 + starBonus) : scale);
  }
  const prog = PROGRESSION_ITEMS[item.id];
  const tags = [
    dungeonItem !== item ? 'dungeonized' : '',
    prog ? `${prog.label} ${prog.names[piece.level ?? prog.max] || 0}` : '',
    greed ? `+${greed} Greed` : '',
    piece.statTier ? (drop ? floorLabel(piece.statTier) : `tier ${piece.statTier}`) : '',
    quality ? `${quality}% quality` : '',
    piece.stars ? `${piece.stars}✪` : '',
    cataBonus ? `Cata +${catacombsBoost(input.catacombsLevel)}%` : '',
    scale !== 1 ? `×${+scale.toFixed(3)}` : '',
  ].filter(Boolean);
  out.push({ label: `${kind === 'weapon' ? 'Weapon: ' : ''}${item.name}${tags.length ? ` (${tags.join(', ')})` : ''}`, stats: base });

  const rIdx = rarityIndex(item, piece.recomb, piece.level, quality);
  const ref = reforgeTable(kind, item)[piece.reforge];
  if (ref) {
    const stats = reforgeStats(ref, rIdx);
    const cata = clampCatacombs(input.catacombsLevel);
    if (ref.perCataStr && cata) stats.STRENGTH = (stats.STRENGTH || 0) + ref.perCataStr * cata;
    if (ref.perCataCD && cata) stats.CRITICAL_DAMAGE = (stats.CRITICAL_DAMAGE || 0) + ref.perCataCD * cata;
    if (ref.statPct) statPct.__all = (statPct.__all || 0) + ref.statPct;
    out.push({ label: `↳ ${ref.name} (${RARITIES[rIdx].toLowerCase()})`, stats });
  }

  const gems = {};
  const names = [];
  for (const g of piece.gems || []) {
    if (!g?.gem || !GEMS[g.gem]) continue;
    const def = GEMS[g.gem];
    gems[def.stat] = (gems[def.stat] || 0) + gemValue(g.gem, g.quality, rIdx);
    names.push(`${g.quality[0]}${g.quality.slice(1).toLowerCase()} ${def.name}`);
  }
  if (names.length) out.push({ label: `↳ Gems: ${names.join(', ')}`, stats: gems });

  const perBook = POTATO_STATS[kind];
  if (perBook) {
    const hpb = Math.max(0, Math.min(HOT_POTATO_MAX, Math.floor(piece.hpb || 0)));
    const fuming = hpb >= HOT_POTATO_MAX ? Math.max(0, Math.min(FUMING_POTATO_MAX, Math.floor(piece.fuming || 0))) : 0;
    if (hpb + fuming) {
      const books = {};
      addStats(books, perBook, hpb + fuming);
      out.push({ label: `↳ Potato books (${hpb}${fuming ? ` + ${fuming} fuming` : ''})`, stats: books });
    }
  }
  if (kind === 'weapon' && piece.artOfWar) out.push({ label: '↳ The Art of War', stats: { ...ART_OF_WAR } });
  return out;
}

/**
 * Compute single-hit damage.
 * Final = floor((5 + Damage) * (1 + Strength/100) * Additive * Multiplicative [* (1 + CritDamage/100)]
 *               * 100 / (100 + Target defense))
 * where Additive = 1 + sum(additive %)/100 and Multiplicative = product of multipliers.
 */
export function calculate(input) {
  const notes = [];
  const target = { mobs: [], families: [], boss: false, hpPct: 100, maxHp: 0, defense: 0, ...input.target };
  // Mayor Derpy doubles mob health (matters for effects that use the target's max HP).
  if (input.mayor === 'derpy') {
    target.maxHp *= 2;
    if (target.maxHp) notes.push('Mayor Derpy: target max HP doubled.');
  }
  const player = { maxHp: 0, fullHealth: true, lowHealth: false, recentlyHit: false, firstHit: true, ...input.player };
  const weapon = input.weapon || {};
  const bow = isBow(weapon.item);
  const sources = []; // { label, stats } for the stat breakdown
  const additive = []; // { label, value }
  const multiplicative = []; // { label, value }
  const statPct = {};

  // --- Stats ---
  sources.push({ label: 'Base player stats', stats: { ...BASE_PLAYER_STATS } });

  if (weapon.item) sources.push(...pieceSources(weapon, 'weapon', input, statPct));
  // Weapon ability kept active through the fight (Soulcry), unless switched off.
  const ability = WEAPON_ABILITIES[weapon.item?.id];
  if (ability && weapon.abilityOn !== false && ability.families.some((f) => target.families.includes(f))) {
    sources.push({ label: `↳ ${ability.name}`, stats: { ...ability.stats } });
  }
  // Base (starred) stats per worn piece, for set bonuses that scale piece stats (Adaptive).
  const pieceBase = new Map();
  for (const [kind, list] of [['armor', input.armor], ['equipment', input.equipment]]) {
    for (const p of list || []) {
      if (!p?.item) continue;
      const ps = pieceSources(p, kind, input, statPct);
      pieceBase.set(p.item.id, ps[0].stats);
      sources.push(...ps);
    }
  }

  // Pet
  const pet = applyPet(input.pet, {
    target, player, bow, weaponId: weapon.item?.id, inDungeon: !!input.dungeonMode && input.dungeonMode !== 'none', extras: input.petExtras || {},
  });
  sources.push(...pet.sources);
  additive.push(...pet.additive);
  multiplicative.push(...pet.multiplicative);
  for (const [k, v] of Object.entries(pet.statPct)) statPct[k] = (statPct[k] || 0) + v;

  // Ultimate enchantment
  let soulEaterStr = 0;
  const ultDef = weapon.ultimate?.id && ULTIMATE_ENCHANTS.find((u) => u.id === weapon.ultimate.id);
  const ult = ultDef && weapon.item && ultimatesFor(weapon.item).includes(ultDef) ? ultDef : null;
  if (ultDef && !ult) notes.push(`${ultDef.name} can't be used on this weapon.`);
  const oneForAll = ult?.exclusive;
  if (ult) {
    const lvl = Math.min(Math.max(1, weapon.ultimate.level || 1), ult.values.length);
    const v = ult.values[lvl - 1];
    const label = `${ult.name} ${roman(lvl)}`;
    if (ult.effect === 'additive') additive.push({ label, value: v });
    else if (ult.effect === 'perEnemy') {
      const n = Math.min(ult.max, Math.max(0, target.nearbyEnemies || 0));
      if (n) additive.push({ label: `${label} (${n} enemies)`, value: v * n });
    } else if (ult.effect === 'perKill') {
      const n = Math.min(ult.caps[lvl - 1], Math.max(0, player.comboKills || 0));
      if (n) additive.push({ label: `${label} (${n} kills)`, value: v * n * (1 + pet.firstStrikeBoost / 100) });
    } else if (ult.effect === 'chimera' && pet.sources[0]) {
      const copied = {};
      addStats(copied, pet.sources[0].stats, v / 100);
      sources.push({ label: `${label} (${v}% of pet stats)`, stats: copied });
    } else if (ult.effect === 'baseDamage') {
      const base = itemStats(weapon.item).DAMAGE || 0;
      sources.push({ label, stats: { DAMAGE: base * v / 100 } });
    } else if (ult.effect === 'soulEater') {
      const inDungeon = input.dungeonMode && input.dungeonMode !== 'none';
      soulEaterStr = v * Math.max(0, player.soulEaterMobDamage || 0);
      if (!inDungeon) soulEaterStr = Math.min(ult.cap, soulEaterStr);
    } else if (ult.note) notes.push(`${ult.name}: ${ult.note}.`);
  }
  if (oneForAll && Object.values(weapon.enchants || {}).some(Boolean)) notes.push('One For All removes all other enchantments; they are ignored.');

  // Enchantments
  const applied = {};
  const hitNumber = player.hitNumber || 0;
  let lightningPct = 0;
  for (const ench of ENCHANTS) {
    const lvl = weapon.enchants?.[ench.id] || 0;
    if (!lvl || oneForAll) continue;
    // Checked first so a leftover enchant (e.g. Sharpness or Critical from a sword on a fishing rod)
    // neither counts nor blocks a conflicting one that fits.
    if (!enchantFits(ench, weapon.item)) continue;
    const clash = enchantConflict(ench.id, applied);
    if (clash) {
      notes.push(`${ench.name} conflicts with ${ENCHANTS.find((e) => e.id === clash).name}; only the first is counted.`);
      continue;
    }
    applied[ench.id] = lvl;
    const v = ench.values[Math.min(lvl, ench.values.length) - 1];
    const label = `${ench.name} ${roman(lvl)}`;
    if (ench.stat) { sources.push({ label, stats: { [ench.stat]: v } }); continue; }
    if (ench.sim === 'lightning') { lightningPct = v; continue; } // every 3rd hit, simulation only
    if (!hitsMob(ench.mobs, target)) continue;
    // The simulation passes the hit's number; a single hit uses the First hit(s) setting.
    if (ench.firstHit && !(hitNumber ? hitNumber === 1 : player.firstHit)) continue;
    if (ench.firstThree && !(hitNumber ? hitNumber <= 3 : player.firstHit)) continue;
    let pct = v;
    if (ench.firstHit || ench.firstThree) pct *= 1 + pet.firstStrikeBoost / 100;
    if (ench.perMissingHp) pct = v * (100 - target.hpPct);
    else if (ench.perCurrentHp) pct = v * target.hpPct;
    else if (ench.giantKiller) {
      const diff = player.maxHp > 0 ? Math.max(0, (target.maxHp - player.maxHp) / player.maxHp * 100) : 0;
      pct = Math.min(ench.caps[lvl - 1], v * diff);
    } else if (ench.titanKiller) {
      pct = Math.min(ench.caps[lvl - 1], v * Math.floor(target.defense / 100));
    }
    if (pct) additive.push({ label, value: pct });
  }

  // Accessory power
  const power = POWERS.find((p) => p.id === input.power);
  const mp = input.magicalPower || 0;
  if (power && power.id !== 'none') {
    const mult = powerMultiplier(mp);
    const scaled = {};
    addStats(scaled, power.stats, mult);
    sources.push({ label: `Power: ${power.name} (${mp} MP, ×${mult.toFixed(2)})`, stats: scaled });
    if (Object.keys(power.unique).length) sources.push({ label: `${power.name} unique bonus`, stats: { ...power.unique } });
  }

  // Tuning
  const tuning = input.tuning || {};
  const available = tuningPoints(mp);
  const used = Object.values(tuning).reduce((a, b) => a + (b || 0), 0);
  if (used > available) notes.push(`Tuning uses ${used} points but ${mp} MP only grants ${available}.`);
  const tuned = {};
  for (const [stat, pts] of Object.entries(tuning)) if (pts) tuned[stat] = pts * (TUNING_PER_POINT[stat] || 0);
  if (Object.keys(tuned).length) sources.push({ label: `Tuning (${used}/${available} pts)`, stats: tuned });

  // Shards (attributes)
  const shards = input.shards || {};
  const echoRuler = (shards.echo_ruler || 0) * ECHO_RULER_PER_LEVEL / 100;
  const echoEchoes = (shards.echo_echoes || 0) * ECHO_ECHOES_PER_LEVEL / 100;
  const rulerMult = 1 + echoRuler * (1 + echoEchoes);
  for (const s of SHARDS) {
    const lvl = shards[s.id] || 0;
    if (!lvl) continue;
    let v = s.perLevel * lvl;
    const label = `${s.name} ${roman(lvl)} (${s.shard} Shard)`;
    if (s.kind === 'stat') { sources.push({ label, stats: { [s.stat]: v } }); continue; }
    if (s.kind === 'statPct') { statPct[s.stat] = (statPct[s.stat] || 0) + v; continue; }
    if (s.melee && bow) continue;
    if (s.bow && !bow) continue;
    if (!hitsMob(s.mobs, target)) continue;
    if (s.bossOnly && !target.boss) continue;
    if (s.fullHealth && !player.fullHealth) continue;
    if (s.lowHealth && !player.lowHealth) continue;
    if (s.afterHit && !player.recentlyHit) continue;
    if (s.ruler) v *= rulerMult;
    additive.push({ label, value: v });
  }

  // Accessories assumed from magical power (data/mechanics.js ACCESSORY_EFFECTS)
  const owned = assumedAccessories(mp);
  const ax = input.accessoryInputs || {};
  const accWhen = {
    day: ax.time !== 'night', night: ax.time === 'night', master: input.dungeonMode === 'master', crowded: !!ax.crowded,
    tenthHit: !!ax.tenthHit,
  };
  for (const fx of ACCESSORY_EFFECTS) {
    const tier = Math.min(Math.max(0, owned[fx.id] || 0), fx.tiers.length);
    if (!tier) continue;
    if (fx.when && !accWhen[fx.when]) continue;
    if (fx.on && !fx.on.includes(weaponCategory(weapon.item))) continue;
    if (!hitsMob(fx.mobs, target)) continue;
    if (fx.families && !fx.families.some((f) => target.families.includes(f))) continue;
    const [label, v] = fx.tiers[tier - 1];
    const n = fx.per ? Math.min(fx.perMax ?? Infinity, Math.max(0, ax[fx.per] || 0)) : 1;
    if (!n) continue;
    if (fx.kind === 'stat') sources.push({ label: `${label} (assumed from MP)`, stats: Object.fromEntries(fx.stats.map((s) => [s, v * n])) });
    else if (fx.kind === 'statPct') statPct.STRENGTH = (statPct.STRENGTH || 0) + v;
    else if (fx.kind === 'additive') additive.push({ label: `${label} (assumed from MP)`, value: v });
    else if (fx.kind === 'mult') multiplicative.push({ label: `${label} (assumed from MP)`, value: v });
  }

  // Dungeon class passive (dungeons only)
  const dClass = input.dungeonClass;
  const dungeonFight = input.dungeonMode === 'catacombs' || input.dungeonMode === 'master';
  if (dClass?.id && dungeonFight) {
    const pct = classDamageBonus(dClass.id, dClass.level, bow, dClass.solo);
    const name = DUNGEON_CLASSES.find((c) => c.id === dClass.id)?.name;
    const lvl = Math.max(0, Math.min(CLASS_MAX_LEVEL, Math.floor(dClass.level || 0)));
    if (pct) {
      multiplicative.push({ label: `${name} ${lvl}${dClass.solo ? ' (no dupes ×2)' : ''}: ${bow ? 'arrow' : 'melee'} damage`, value: 1 + pct / 100 });
    } else notes.push(`${name} has no ${bow ? 'bow' : 'melee'} damage passive.`);
  }

  // God Potion
  if (input.godPotion) {
    sources.push({ label: 'God Potion', stats: { ...GOD_POTION.stats } });
    if (bow) additive.push({ label: 'God Potion: Archery IV', value: GOD_POTION.bowAdditive });
  }

  // Mayor Jerry: +10% to all combat stats, added to the other percentage stat boosts.
  if (input.mayor === 'jerry') statPct.__all = (statPct.__all || 0) + MAYOR_JERRY_STAT_PCT;

  // Combat skill
  const combat = combatWarriorBonus(input.combatLevel);
  if (combat) additive.push({ label: `Combat ${input.combatLevel} (Warrior)`, value: combat });

  // Armor / equipment set bonuses and piece bonuses (data/sets.js)
  const detected = detectSets([
    ...(input.armor || []).map((p) => ({ slot: 'armor', id: p?.item?.id })),
    ...(input.equipment || []).map((p) => ({ slot: 'equipment', id: p?.item?.id })),
  ]);
  // Speed so far (base 100 plus gear, pet, reforges…), for the Warden Helmet.
  const speed = 100 + sources.reduce((a, src) => a + (src.stats.WALK_SPEED || 0), 0);
  const sets = evaluateSets(detected, {
    bow, target, weaponId: weapon.item?.id, cataLevel: clampCatacombs(input.catacombsLevel), speed,
    inDungeon: input.dungeonMode === 'catacombs' || input.dungeonMode === 'master',
  }, input.setInputs);
  sources.push(...sets.sources);
  additive.push(...sets.additive);
  multiplicative.push(...sets.multiplicative);
  if (sets.statPct) statPct.__all = (statPct.__all || 0) + sets.statPct;
  for (const { ids, pct, label } of sets.pieceStatPct) {
    const extra = {};
    for (const id of ids) addStats(extra, pieceBase.get(id) || {}, pct / 100);
    if (pct) sources.push({ label, stats: extra });
  }

  // Weapon bonus vs specific enemies
  for (const rule of weaponMultipliers(weapon.item?.id)) {
    const against = rule.mobs || rule.families;
    const hit = rule.mobs ? hitsMob(rule.mobs, target) : rule.families.some((f) => target.families.includes(f));
    if (!hit) continue;
    const value = rule.perMissingHp ? 1 + rule.perMissingHp * (100 - target.hpPct) / 100 : rule.mult;
    if (value !== 1) multiplicative.push({ label: `${weapon.item.name} vs ${against.join('/')}`, value });
  }

  // Other user-entered sources (pets, potions, gems, talismans, abilities…)
  for (const b of input.bonuses || []) {
    const stats = {};
    for (const k of DAMAGE_STATS) if (b[k]) stats[k] = b[k];
    if (Object.keys(stats).length) sources.push({ label: b.label || 'Other', stats });
    if (b.additive) additive.push({ label: b.label || 'Other', value: b.additive });
    if (b.multiplier && b.multiplier !== 1) multiplicative.push({ label: b.label || 'Other', value: b.multiplier });
  }

  // --- Totals ---
  const totals = {};
  for (const s of sources) addStats(totals, s.stats);
  for (const stat of ['STRENGTH', 'CRITICAL_DAMAGE', 'CRITICAL_CHANCE']) {
    const pct = (statPct[stat] || 0) + (statPct.__all || 0);
    if (pct) totals[stat] = (totals[stat] || 0) * (1 + pct / 100);
  }
  // Set effects derived from final stats (Tarantula helmet: CD from Strength; Mastiff: CD from Defense).
  for (const { label, fn } of sets.post) {
    const extra = fn({ ...totals });
    addStats(totals, extra);
    sources.push({ label, stats: extra });
  }
  const damage = totals.DAMAGE || 0;
  const strength = totals.STRENGTH || 0;
  const critDamage = totals.CRITICAL_DAMAGE || 0;
  const critChance = Math.min(100, Math.max(0, totals.CRITICAL_CHANCE || 0));

  const baseDamage = 5 + damage;
  const strengthMult = 1 + strength / 100;
  const initial = baseDamage * strengthMult;
  const additiveMult = 1 + additive.reduce((a, b) => a + b.value, 0) / 100;
  const multMult = multiplicative.reduce((a, b) => a * b.value, 1);
  const critMult = 1 + critDamage / 100;

  // Target defense reduces the hit after all bonuses: × 100 / (100 + Defense); rounding comes last.
  const defense = Math.max(0, target.defense || 0);
  const defenseMult = 100 / (100 + defense);

  const preCrit = initial * additiveMult * multMult;
  const nonCrit = Math.floor(preCrit * defenseMult);
  // Soul Eater's Strength only applies to the next crit.
  const critInitial = baseDamage * (1 + (strength + soulEaterStr) / 100);
  const crit = Math.floor(critInitial * additiveMult * multMult * critMult * defenseMult);
  const expected = nonCrit + (crit - nonCrit) * critChance / 100;
  if (soulEaterStr) notes.push(`Soul Eater adds +${Math.round(soulEaterStr)} Strength to the crit hit only.`);

  return {
    bow, totals, sources, additive, multiplicative, notes, petAbilities: pet.abilities, setStatus: sets.status,
    damage, strength, critDamage, critChance, soulEaterStr,
    inDungeon: input.dungeonMode === 'catacombs' || input.dungeonMode === 'master',
    masterMode: input.dungeonMode === 'master',
    catacombsLevel: clampCatacombs(input.catacombsLevel),
    cataBoost: catacombsBoost(input.catacombsLevel),
    baseDamage, strengthMult, initial, additiveMult, multMult, critMult, defense, defenseMult,
    targetMaxHp: target.maxHp, lightningPct, speed,
    nonCrit, crit, expected,
  };
}

export function roman(n) {
  const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
  return s;
}
