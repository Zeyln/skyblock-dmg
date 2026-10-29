// Armor / equipment set bonuses and piece bonuses that change a single hit.
// Values from each set's page on hypixelskyblock.minecraft.wiki (checked Oct 2026).
//
// A set definition:
//   id, name, bonus (in-game bonus name), slot: 'armor' | 'equipment'
//   match(baseId) -> true for the set's pieces (fragged STARRED_ ids are matched by their base id)
//   tierOf(baseId) -> 0..4 for tiered (Kuudra) sets; the lowest tier worn counts
//   min: pieces needed for the bonus; full: pieces in a full set
//   inputs: situational values the user supplies [{ key, label, type: 'number'|'toggle', min, max, def }]
//   effect(ctx) -> { additive?, multiplier?, stats?, statPct?, pieceStatPct?, post?, text, inactive? }
//     ctx: { count, tier, bow, inDungeon, target, weaponId, cataLevel, speed, input(key) }
//   noHitEffect: description for sets that are detected but don't change a single hit.

const KUUDRA_TIERS = ['Basic', 'Hot', 'Burning', 'Fiery', 'Infernal'];
const kuudraTier = (id) => Math.max(0, ['', 'HOT_', 'BURNING_', 'FIERY_', 'INFERNAL_'].findIndex((p, i) => i && id.startsWith(p)));
const kuudra = (name) => (id) => new RegExp(`^(HOT_|BURNING_|FIERY_|INFERNAL_)?${name}_(HELMET|CHESTPLATE|LEGGINGS|BOOTS)$`).test(id);
const prefix = (...ps) => (id) => ps.some((p) => id.startsWith(p));
const ids = (...list) => (id) => list.includes(id);
const SPEED_CAP = 400;
const fmtSpeed = (v) => +v.toFixed(1);

// Terror: damage per Hydra Strike stack by tier, for 2 / 3 / 4 pieces.
const TERROR_PER_STACK = [[2, 4, 6], [2.75, 5.5, 8.25], [3.5, 7, 10.5], [4.25, 8.5, 12.75], [5, 10, 15]];
const kills = (n, per, cap) => Math.min(cap, Math.floor(Math.max(0, n || 0) / per));

export const SETS = [
  // ---------- Kuudra armor ----------
  {
    id: 'crimson', name: 'Crimson Armor', bonus: 'Dominus', slot: 'armor', match: kuudra('CRIMSON'), tierOf: kuudraTier, min: 2, full: 4,
    inputs: [{ key: 'stacks', label: 'Dominus stacks', type: 'number', min: 0, max: 10, def: 10 }],
    // Per stack: Burning +1 Ferocity, Fiery +2, Infernal +2 and +10% damage (additive). The
    // simulation builds the stacks up over the fight (sim.js).
    effect: ({ tier, input }) => {
      const stacks = input('stacks');
      const fero = [0, 0, 1, 2, 2][tier] * stacks;
      if (!fero) return { inactive: true, text: `${KUUDRA_TIERS[tier]} tier: swing range only — Ferocity per stack needs Burning` };
      return {
        stats: { FEROCITY: fero },
        additive: tier === 4 ? 10 * stacks : 0,
        text: `+${fero} Ferocity${tier === 4 ? `, +${10 * stacks}% damage` : ''} (${stacks} stacks)`,
      };
    },
  },
  {
    id: 'terror', name: 'Terror Armor', bonus: 'Hydra Strike', slot: 'armor', match: kuudra('TERROR'), tierOf: kuudraTier, min: 2, full: 4,
    inputs: [{ key: 'stacks', label: 'Hydra Strike stacks', type: 'number', min: 0, max: 10, def: 10 }],
    effect: ({ tier, count, bow, input }) => {
      const per = TERROR_PER_STACK[tier][Math.min(count, 4) - 2];
      if (!bow) return { inactive: true, text: `+${per}% damage per stack — bows only` };
      return { additive: per * input('stacks'), text: `+${per}% damage per stack (${input('stacks')} stacks, ${KUUDRA_TIERS[tier]})` };
    },
  },
  { id: 'aurora', name: 'Aurora Armor', bonus: 'Arcane Energy', slot: 'armor', match: kuudra('AURORA'), tierOf: kuudraTier, min: 2, full: 4,
    noHitEffect: 'magic-damage stacks and homing missiles' },
  { id: 'hollow', name: 'Hollow Armor', bonus: 'Spirit', slot: 'armor', match: kuudra('HOLLOW'), tierOf: kuudraTier, min: 2, full: 4,
    noHitEffect: 'charges for the Hollow Wand' },
  { id: 'fervor', name: 'Fervor Armor', bonus: 'Fervor', slot: 'armor', match: kuudra('FERVOR'), tierOf: kuudraTier, min: 2, full: 4,
    noHitEffect: 'aggro and Ground Pound' },

  // ---------- Dungeon armor ----------
  ...[['SKELETON_GRUNT_', 'Skeleton Grunt Armor', 0], ['SKELETON_SOLDIER_', 'Skeleton Soldier Armor', 25],
    ['SKELETON_MASTER_', 'Skeleton Master Armor', 25], ['SPEED_WITHER_', "Maxor's Armor", 0]].map(([p, name, fullBonus]) => ({
    id: p.toLowerCase().replace(/_$/, ''), name, bonus: fullBonus ? 'Arrow damage' : 'Piece bonus', slot: 'armor',
    match: prefix(p), min: 1, full: 4,
    effect: ({ count, bow }) => {
      const pct = 5 * count + (fullBonus && count >= 4 ? fullBonus : 0);
      const text = `+5% arrow damage per piece${fullBonus ? `, +${fullBonus}% with the full set` : ''}`;
      return bow ? { additive: pct, text: `${text} (+${pct}%)` } : { inactive: true, text: `${text} — bows only` };
    },
  })),
  {
    id: 'skeleton_lord', name: 'Skeleton Lord Armor', bonus: 'Dungeon Lord', slot: 'armor', match: prefix('SKELETON_LORD_'), min: 4, full: 4,
    inputs: [{ key: 'minutes', label: 'Minutes in this dungeon', type: 'number', min: 0, def: 0 }],
    effect: ({ inDungeon, input }) => (inDungeon
      ? { stats: { STRENGTH: 5 * input('minutes'), CRITICAL_DAMAGE: 10 * input('minutes') }, text: `+5 Strength, +10 Crit Damage per minute (${input('minutes')} min)` }
      : { inactive: true, text: '+5 Strength, +10 Crit Damage per minute — dungeons only' }),
  },
  {
    id: 'zombie_lord', name: 'Zombie Lord Armor', bonus: 'Dungeon Lord', slot: 'armor', match: prefix('ZOMBIE_LORD_'), min: 4, full: 4,
    inputs: [{ key: 'minutes', label: 'Minutes in this dungeon', type: 'number', min: 0, def: 0 }],
    effect: ({ inDungeon, input }) => (inDungeon
      ? { stats: { STRENGTH: 10 * input('minutes') }, text: `+10 Strength per minute (${input('minutes')} min)` }
      : { inactive: true, text: '+10 Strength per minute — dungeons only' }),
  },
  {
    id: 'skeletor', name: 'Skeletor Armor', bonus: 'Skeletor', slot: 'armor', match: prefix('SKELETOR_'), min: 4, full: 4,
    inputs: [{ key: 'kills', label: 'Skeletor kills', type: 'number', min: 0, def: 0 }],
    effect: ({ input }) => {
      const n = Math.floor(input('kills') / 10);
      return { stats: { STRENGTH: n, CRITICAL_DAMAGE: n }, text: `+1 Strength, +1 Crit Damage per 10 Skeletor kills (+${n})` };
    },
  },
  {
    id: 'shadow_assassin', name: 'Shadow Assassin Armor', bonus: 'Shadow Assassin', slot: 'armor', match: prefix('SHADOW_ASSASSIN_'),
    min: 4, full: 4, armorOnly: true,
    inputs: [{ key: 'kills', label: 'Kills this dungeon', type: 'number', min: 0, def: 0 }],
    effect: ({ inDungeon, input }) => (inDungeon
      ? { stats: { STRENGTH: input('kills') }, text: `+1 Strength per kill this dungeon (+${input('kills')})` }
      : { inactive: true, text: '+1 Strength per kill — dungeons only' }),
  },
  {
    id: 'adaptive', name: 'Adaptive Armor', bonus: 'Efficient Training', slot: 'armor', match: prefix('ADAPTIVE_'), min: 4, full: 4, armorOnly: true,
    effect: ({ cataLevel }) => {
      const pct = 2 * Math.floor(Math.min(50, cataLevel || 0) / 5);
      return { pieceStatPct: pct, text: `+2% piece stats per 5 Catacombs levels (+${pct}%)` };
    },
  },
  { id: 'witherborn', name: 'Wither Armor family', bonus: 'Witherborn', slot: 'armor',
    match: prefix('WITHER_', 'POWER_WITHER_', 'TANK_WITHER_', 'WISE_WITHER_'), min: 4, full: 4,
    noHitEffect: 'spawns a wither minion; Maxor\'s pieces add arrow damage separately' },

  // ---------- Other armor ----------
  {
    id: 'superior', name: 'Superior Dragon Armor', bonus: 'Superior Blood', slot: 'armor', match: prefix('SUPERIOR_DRAGON_'), min: 4, full: 4,
    effect: () => ({ statPct: 5, text: '+5% combat stats' }),
  },
  {
    id: 'strong_dragon', name: 'Strong Dragon Armor', bonus: 'Strong Blood', slot: 'armor', match: prefix('STRONG_DRAGON_'), min: 4, full: 4,
    effect: ({ weaponId }) => (['ASPECT_OF_THE_END', 'ASPECT_OF_THE_VOID'].includes(weaponId)
      ? { stats: { DAMAGE: 75 }, text: '+75 Damage on Aspect of the End / Void' }
      : { inactive: true, text: '+75 Damage — Aspect of the End / Void only' }),
  },
  {
    id: 'final_destination', name: 'Final Destination Armor', bonus: 'Vivacious Darkness', slot: 'armor',
    match: prefix('FINAL_DESTINATION_'), min: 4, full: 4,
    inputs: [{ key: 'active', label: 'Sneaking with Soulflow (bonus active)', type: 'toggle', def: true }],
    effect: ({ target, input }) => {
      if (!input('active')) return { inactive: true, text: 'Needs sneaking with Soulflow' };
      const vsEnderman = target.families.includes('Enderman');
      return { stats: { STRENGTH: 30 }, additive: vsEnderman ? 100 : 0,
        text: `+30 Strength${vsEnderman ? ', +100% damage vs Endermen' : ' (+100% vs Endermen not applicable)'}` };
    },
  },
  ...[['CHEAP_TUXEDO_', 'Cheap Tuxedo', 50, 75], ['FANCY_TUXEDO_', 'Fancy Tuxedo', 100, 150], ['ELEGANT_TUXEDO_', 'Elegant Tuxedo', 150, 250]]
    .map(([p, name, dmg, hp]) => ({
      id: p.toLowerCase().replace(/_$/, ''), name, bonus: 'Dashing', slot: 'armor', match: prefix(p), min: 3, full: 3,
      effect: () => ({ additive: dmg, text: `+${dmg}% damage, max Health set to ${hp}` }),
    })),
  {
    id: 'tarantula', name: 'Tarantula Armor', bonus: 'Octodexterity', slot: 'armor', match: prefix('TARANTULA_'), min: 1, full: 4,
    inputs: [{ key: 'fourth', label: 'This is the 4th strike', type: 'toggle', def: false }],
    effect: ({ count, input, helmet }) => {
      const parts = [];
      const out = {};
      if (helmet) {
        out.post = (totals) => ({ CRITICAL_DAMAGE: Math.min(1000, Math.max(0, totals.STRENGTH || 0)) / 10 });
        parts.push('helmet: +1 Crit Damage per 10 Strength (max 1,000 Strength)');
      }
      if (count >= 4) {
        if (input('fourth')) out.additive = 100;
        parts.push(`full set: every 4th strike +100% damage${input('fourth') ? '' : ' (not this hit)'}`);
      }
      if (!parts.length) return { inactive: true, text: 'Full set: every 4th strike +100% damage' };
      return { ...out, text: parts.join('; ') };
    },
    pieceHelmet: 'TARANTULA_HELMET',
  },
  {
    // Every 3rd strike +50% (additive); the simulation counts strikes, a single hit uses the toggle.
    id: 'primordial', name: 'Primordial Armor', bonus: 'Octodexterity', slot: 'armor', match: prefix('PRIMORDIAL_'), min: 4, full: 4,
    inputs: [{ key: 'third', label: 'This is the 3rd strike', type: 'toggle', def: false }],
    effect: ({ input }) => (input('third')
      ? { additive: 50, text: 'every 3rd strike +50% damage' }
      : { inactive: true, text: 'every 3rd strike +50% damage (not this hit)' }),
  },
  {
    // Trolling The Reaper: +100% (additive) vs Undead, but only 1% damage to everything else.
    id: 'reaper', name: 'Reaper Armor', bonus: 'Trolling The Reaper', slot: 'armor', match: prefix('REAPER_'), min: 4, full: 4,
    effect: ({ target }) => (target.mobs.includes('Undead')
      ? { additive: 100, text: '+100% damage vs Undead' }
      : { multiplier: 0.01, text: 'only 1% damage to non-Undead mobs' }),
  },
  // Crimson Isle armor pieces: +k% (additive) per piece worn vs Magmatic mobs.
  ...[['magma_lord', 'Magma Lord Armor', prefix('MAGMA_LORD_'), 30], ['thunder', 'Thunder Armor', prefix('THUNDER_'), 20],
    ['moogma_gear', 'Taurus Helmet / Flaming Chestplate / Moogma Leggings', ids('TAURUS_HELMET', 'FLAMING_CHESTPLATE', 'MOOGMA_LEGGINGS'), 10],
  ].map(([id, name, match, per]) => ({
    id, name, bonus: 'Magmatic damage', slot: 'armor', match, min: 1, full: id === 'moogma_gear' ? 3 : 4,
    effect: ({ count, target }) => (target.mobs.includes('Magmatic')
      ? { additive: per * count, text: `+${per * count}% damage vs Magmatic (${per}% per piece)` }
      : { inactive: true, text: `+${per}% per piece vs Magmatic mobs` }),
  })),
  // Single helmets with a damage ability (wiki, Damage Calculation source lists).
  {
    // ×(1 + 0.015 per digit of coins consumed), up to 1B coins (10 digits).
    id: 'crown_avarice', name: 'Crown of Avarice', bonus: 'Overindulgence', slot: 'armor',
    match: ids('CROWN_OF_AVARICE', 'CROWN_OF_AVARICE_CELEBRATION'), min: 1, full: 1,
    inputs: [{ key: 'coins', label: 'Coins consumed', type: 'number', min: 0, max: 1e9, def: 1e9 }],
    effect: ({ input }) => {
      const coins = Math.min(1e9, Math.max(0, Math.floor(input('coins') || 0)));
      const digits = coins ? String(coins).length : 0;
      const mult = 1 + 0.015 * digits;
      return { multiplier: mult, text: `×${+mult.toFixed(3)} damage (${digits} digit${digits === 1 ? '' : 's'} of coins consumed)` };
    },
  },
  {
    // Halves Speed (after the 400 cap), then +20% additive per 25 Speed left, plus 1%.
    id: 'warden_helmet', name: 'Warden Helmet', bonus: 'Brute Force', slot: 'armor',
    match: ids('WARDEN_HELMET'), min: 1, full: 1,
    inputs: [{ key: 'speed', label: 'Speed before Brute Force (blank: from your gear)', type: 'number', min: 0, max: 500, placeholder: 'auto' }],
    effect: ({ input, speed }) => {
      const before = Math.min(SPEED_CAP, Math.max(0, input('speed') ?? speed ?? 100));
      const halved = before / 2;
      const pct = 20 * halved / 25 + 1;
      return { additive: pct, text: `+${+pct.toFixed(1)}% damage (${fmtSpeed(before)} Speed, halved to ${fmtSpeed(halved)})` };
    },
  },
  {
    id: 'mastiff', name: 'Mastiff Armor', bonus: 'Absolute Unit', slot: 'armor', match: prefix('MASTIFF_'), min: 4, full: 4,
    effect: () => ({
      post: (totals) => ({ CRITICAL_DAMAGE: Math.min(150, Math.min(300, Math.max(0, totals.DEFENSE || 0)) / 2) }),
      text: '+1 Crit Damage per 2 Defense (Defense capped at 300, max +150)',
    }),
  },

  // ---------- Equipment ----------
  {
    // ×1.01 vs dragons (the wiki marks it as needing confirmation).
    id: 'dragonfade', name: 'Dragonfade Cloak', bonus: 'Dragon damage', slot: 'equipment',
    match: ids('DRAGONFADE_CLOAK'), min: 1, full: 1,
    effect: ({ target }) => (target.families.includes('Dragon')
      ? { multiplier: 1.01, text: '×1.01 damage vs Dragons' }
      : { inactive: true, text: '×1.01 damage vs Dragons' }),
  },
  {
    id: 'vanq_magma', name: 'Vanquished Magma Necklace', bonus: 'Magma Cube Absorber', slot: 'equipment',
    match: ids('VANQUISHED_MAGMA_NECKLACE'), min: 1, full: 1,
    inputs: [{ key: 'kills', label: 'Magma Cubes killed', type: 'number', min: 0, def: 10000 }],
    effect: ({ input }) => {
      const n = kills(input('kills'), 1000, 10);
      return { stats: { CRITICAL_DAMAGE: n }, text: `+1 Crit Damage per 1,000 Magma Cube kills (+${n}, max 10)` };
    },
  },
  {
    id: 'vanq_blaze', name: 'Vanquished Blaze Belt', bonus: 'Blaze Consumer', slot: 'equipment',
    match: ids('VANQUISHED_BLAZE_BELT'), min: 1, full: 1,
    inputs: [{ key: 'kills', label: 'Blazes killed', type: 'number', min: 0, def: 10000 }],
    effect: ({ input }) => {
      const n = kills(input('kills'), 1000, 10);
      return { stats: { STRENGTH: n }, text: `+1 Strength per 1,000 Blaze kills (+${n}, max 10)` };
    },
  },
  {
    id: 'sa_cloak', name: 'Shadow Assassin Cloak', bonus: 'Teleport strike', slot: 'equipment',
    match: ids('SHADOW_ASSASSIN_CLOAK'), min: 1, full: 1,
    inputs: [{ key: 'teleported', label: 'Teleported within the last 5s', type: 'toggle', def: false }],
    effect: ({ input, bow }) => (input('teleported') && !bow
      ? { additive: 10, text: '+10% damage on the next melee hit after teleporting' }
      : { inactive: true, text: '+10% on the next melee hit after teleporting' }),
  },
  { id: 'molten', name: 'Molten Set', bonus: 'Molten Core', slot: 'equipment',
    match: ids('MOLTEN_NECKLACE', 'MOLTEN_CLOAK', 'MOLTEN_BELT', 'MOLTEN_BRACELET'), min: 1, full: 4,
    noHitEffect: 'damage resistance while fighting Kuudra' },
];

const baseId = (id) => (id || '').replace(/^STARRED_/, '');

/**
 * Detect sets from worn pieces. pieces: [{ slot: 'armor'|'equipment', id }].
 * Returns [{ set, count, tier, helmet }] for every set with at least one piece worn.
 */
export function detectSets(pieces) {
  const found = [];
  for (const set of SETS) {
    const worn = pieces.filter((p) => p.id && p.slot === set.slot && set.match(baseId(p.id)));
    if (!worn.length) continue;
    const tiers = set.tierOf ? worn.map((p) => set.tierOf(baseId(p.id))) : [0];
    found.push({
      set, count: worn.length, tier: Math.min(...tiers),
      helmet: set.pieceHelmet ? worn.some((p) => baseId(p.id) === set.pieceHelmet) : false,
      ids: worn.map((p) => p.id),
    });
  }
  return found;
}

/**
 * Evaluate detected sets. Returns per-set status plus the effects to feed into the damage calc.
 * inputs: { [setId]: { [key]: value } }
 */
export function evaluateSets(detected, ctx, inputs = {}) {
  const result = { status: [], additive: [], multiplicative: [], sources: [], statPct: 0, pieceStatPct: [], post: [] };
  for (const d of detected) {
    const { set } = d;
    const input = (key) => {
      const def = set.inputs?.find((i) => i.key === key)?.def;
      return inputs[set.id]?.[key] ?? def;
    };
    const base = { set, count: d.count, tier: d.tier, label: `${set.name} (${d.count}/${set.full})` };
    if (set.noHitEffect) {
      result.status.push({ ...base, active: false, text: `${set.bonus}: no single-hit damage effect (${set.noHitEffect})` });
      continue;
    }
    if (d.count < set.min && !(set.pieceHelmet && d.helmet)) {
      result.status.push({ ...base, active: false, text: `${set.bonus}: needs ${set.min} pieces` });
      continue;
    }
    const eff = set.effect({ ...ctx, count: d.count, tier: d.tier, helmet: d.helmet, input });
    const label = `${set.name}: ${set.bonus}`;
    const active = !eff.inactive && !!(eff.additive || eff.multiplier || eff.stats || eff.statPct || eff.pieceStatPct || eff.post);
    result.status.push({ ...base, active, text: `${set.bonus}: ${eff.text}` });
    if (eff.inactive) continue;
    if (eff.additive) result.additive.push({ label, value: eff.additive });
    if (eff.multiplier && eff.multiplier !== 1) result.multiplicative.push({ label, value: eff.multiplier });
    if (eff.stats && Object.values(eff.stats).some(Boolean)) result.sources.push({ label, stats: eff.stats });
    if (eff.statPct) result.statPct += eff.statPct;
    if (eff.pieceStatPct) result.pieceStatPct.push({ ids: d.ids, pct: eff.pieceStatPct, label });
    if (eff.post) result.post.push({ label, fn: eff.post });
  }
  return result;
}
