// Right-click damage abilities, by item id: their Magic Damage, mana and cooldown.
// Sources: hypixelskyblock.minecraft.wiki (Damage Calculation › Damage Abilities for base damage and
// Intelligence scaling, the item pages and NEU item lore for mana costs and cooldowns), Nov 2026.
//
//   base: base ability damage; scaling: Intelligence scaling; mana: mana cost; cooldown (s, 0: none)
//   over (s): damage over time: the base is dealt in equal parts once a second over this long
//   perSecond: the base is per second while it lasts (over), not the total
//   noAdditive: the Additive Multiplier doesn't apply (wiki notes)
//   melee: the damage counts as melee for immunities (Giant's Slam, wiki: Tarantula Broodfather)
//   greed: base damage from the Dark Auction price, { min, bonus, cap } (Midas Staff)
//   fixedCooldown: the cooldown isn't shortened (Wither Impact's 3-tick anti-autoclick limit)
//   manaStep, manaReset (s): each cast costs manaStep more than the last, until manaReset passes without one
//   explosion: the damage is an explosion (Implosion Belt)
//   meleeHit: { pct, count, abilityEnchants?, perMissing10? }: not Magic Damage but count hits of pct% of the
//     melee hit (crits, Strength and Crit Damage; no Ferocity). abilityEnchants: the enchants that don't affect
//     abilities (Sharpness, First Strike, Triple-Strike) don't count; perMissing10: % more per 10% of your
//     health missing
//   charges: { max, every (s) }: casts held, one coming back every so often (instead of a cooldown)
//   healthCost: Health a cast costs (not modelled: until damage taken exists it can always be paid)
//   fixedBase: the base damage is the ability's own; noAbilityDamage: Ability Damage doesn't apply

const ability = (name, base, scaling, mana, cooldown = 0, extra = {}) => ({ name, base, scaling, mana, cooldown, ...extra });

const WITHER_IMPACT = ability('Wither Impact', 10000, 0.3, 300, 0.15, { fixedCooldown: true, explosion: true });
const IMPLOSION = ability('Implosion', 10000, 0.3, 300, 10, { explosion: true });
// Necron's Blade variants: the scrolls applied (all three replace them with Wither Impact).
export const WITHER_BLADES = ['NECRON_BLADE', 'HYPERION', 'VALKYRIE', 'ASTRAEA', 'SCYLLA'];
export const WITHER_SCROLLS = [
  ['impact', 'Wither Impact (all 3 scrolls)'], ['implosion', 'Implosion scroll only'], ['none', 'No damage scroll'],
];

const GIANTS_SLAM = ability("Giant's Slam", 100000, 0.05, 100, 30, { melee: true });
const SPIRIT = (base) => ability('Guided Bat', base, 0.2, 200, 0, { explosion: true });
const YETI = (base) => ability('Terrain Toss', base, 0.3, 250, 1);
const BONZO = (base) => ability('Showtime', base, 0.2, 90, 0, { explosion: true });
const ICE_BOLT = (base, mana) => ability('Ice Bolt', base, 0.3, mana);
const ICE_SPRAY = (base) => ability('Ice Spray', base, 0.1, 50, 5);
const MOLTEN_WAVE = (bonus, cap) => ability('Molten Wave', 6000, 0.3, 500, 1, { greed: { min: 6000, bonus, cap } });
const DREADLORD = ability('Dreadlord', 500, 0.3, 40);
// Reaving Strike (wiki, Nov 2026): 125% / 135% of the melee hit, on charges.
const REAVING = (pct, max, every) => ability('Reaving Strike', 0, 0, 0, 0, { meleeHit: { pct, count: 1 }, charges: { max, every } });
// Roses (wiki, Flower of Truth / Bouquet of Lies, Nov 2026): the melee damage formula, without Ferocity or
// the enchants that don't affect abilities. Against one target each rose hits once (no bounces).
const ROSES = (name, count, healthCost, perMissing10 = 0) => ability(name, 0, 0, 0, 1,
  { meleeHit: { pct: 100, count, abilityEnchants: true, perMissing10 }, healthCost });
// Precursor Eye's Eye Beam (wiki, Nov 2026): 4,000 a second, +100% each second for 5 s; 40 mana a second,
// +25% each second; Intelligence and Ability Damage don't apply, enchants that affect abilities do. The
// simulation fires it while the helmet is worn.
export const EYE_BEAM = ability('Eye Beam', 4000, 0, 40, 0, { fixedBase: true, noAbilityDamage: true, ramp: { pct: 100, costPct: 25, seconds: 5 } });

export const ABILITIES = {
  GIANTS_SWORD: GIANTS_SLAM,
  ASPECT_OF_THE_DRAGON: ability('Dragon Rage', 12000, 0.1, 100, 0, { noAdditive: true }),
  // Greed: +26,000 base at 100M paid (+34,000 at 500M upgraded); the wiki gives no curve between, so linear.
  MIDAS_STAFF: MOLTEN_WAVE(26000, 100e6),
  STARRED_MIDAS_STAFF: MOLTEN_WAVE(34000, 500e6),
  BAT_WAND: SPIRIT(2000),
  STARRED_BAT_WAND: SPIRIT(2250),
  YETI_SWORD: YETI(15000),
  STARRED_YETI_SWORD: YETI(17000),
  BONZO_STAFF: BONZO(1000),
  STARRED_BONZO_STAFF: BONZO(1100),
  FROZEN_SCYTHE: ICE_BOLT(1000, 50),
  GLACIAL_SCYTHE: ICE_BOLT(1500, 75),
  STARRED_GLACIAL_SCYTHE: ICE_BOLT(1700, 75),
  ICE_SPRAY_WAND: ICE_SPRAY(17000),
  STARRED_ICE_SPRAY_WAND: ICE_SPRAY(19000),
  FIRE_FURY_STAFF: ability('Firestorm', 42000, 0.3, 1000, 20, { over: 10 }),
  FIRE_VEIL_WAND: ability('Fire Veil', 15000, 0.3, 300, 1, { over: 5, perSecond: true }),
  STAFF_OF_THE_VOLCANO: ability('Explode', 24000, 0.3, 100, 30, { explosion: true }),
  // Starfall (wiki, Nov 2026): 300 a second for 5 s, 0.3 Intelligence scaling.
  STARLIGHT_WAND: ability('Starfall', 300, 0.3, 100, 2, { over: 5, perSecond: true }),
  BONE_REAVER: REAVING(125, 4, 5),
  FELTHORN_REAPER: REAVING(135, 5, 4),
  STARRED_FELTHORN_REAPER: REAVING(135, 5, 4),
  FLOWER_OF_TRUTH: ROSES('Heat-Seeking Rose', 1, 100),
  BOUQUET_OF_LIES: ROSES('Petal Barrage', 3, 250, 2),
  PIGMAN_SWORD: ability('Burning Souls', 30000, 0.1, 400, 5, { over: 5, noAdditive: true }),
  RUNIC_STAFF: ability('Runic Zap', 10000, 0.2, 10, 1),
  CRYPT_DREADLORD_SWORD: DREADLORD,
  STARRED_CRYPT_DREADLORD_SWORD: DREADLORD,
  INK_WAND: ability('Ink Bomb', 10000, 1, 60, 30),
  GOLEM_SWORD: ability('Iron Punch', 250, 1, 70, 3),
  LEAPING_SWORD: ability('Leap', 350, 1, 50, 1),
  SILK_EDGE_SWORD: ability('Leap', 400, 1, 50, 1),
  // Each shot costs 30 more than the last, back to 30 after 4 s without firing; 5 shots a second (wiki).
  JERRY_STAFF: ability('Rapid-fire', 500, 0.2, 30, 0.2, { manaStep: 30, manaReset: 4 }),
};

// Enchantments that don't affect abilities: Sharpness (wiki, Flower of Truth: "Enchantments that do not
// affect abilities, such as Sharpness, Life Steal, Drain, Cleave, and Mana Steal"), and First Strike and
// Triple-Strike, which count melee hits (assumed). Smite, Execute, Giant Killer, Prosecute and the like do.
export const NOT_ON_ABILITIES = ['sharpness', 'first_strike', 'triple_strike'];

// The weapon's damage ability (piece: { item, scrolls }), or null.
export function weaponAbility(piece) {
  const id = piece?.item?.id;
  if (!id) return null;
  if (WITHER_BLADES.includes(id.replace(/^STARRED_/, ''))) {
    return { impact: WITHER_IMPACT, implosion: IMPLOSION }[piece.scrolls || 'impact'] || null;
  }
  return ABILITIES[id] || null;
}

// The Dark Auction price's base damage (Midas Staff).
export function greedBase(ab, price) {
  if (!ab.greed) return ab.base;
  const { min, bonus, cap } = ab.greed;
  return min + bonus * Math.max(0, Math.min(cap, price || 0)) / cap;
}

// ---------- Mana (wiki, Mana) ----------
// Max mana = 100 + Intelligence. Each second it regenerates 2% of max mana, raised by Mana Regen %
// (pets, the Mana Regeneration attribute) and multiplied by a Power Orb or Flare, rounded up ("Mana
// regen ticks are now rounded up", wiki history); a Mana Potion adds a flat amount on top. How the %
// and the deployable combine isn't on the wiki: the % add up, the deployable multiplies.
// In dungeons every melee or bow hit restores 5 + 1% of max mana (wiki, Catacombs); abilities don't.
export const BASE_MANA = 100;
export const MANA_REGEN_PCT = 2;
export const DUNGEON_HIT_MANA = { flat: 5, pct: 1 };
// Mana Potion I–VIII: +1 mana a second per level.
export const MANA_POTION_MAX = 8;
// Deployables (only one buff applies): mana regen multiplier and the stats they grant (wiki, Nov 2026).
export const DEPLOYABLES = {
  MANA_FLUX: { name: 'Mana Flux Power Orb', regenMult: 1.5, stats: { STRENGTH: 10 } },
  OVERFLUX: { name: 'Overflux Power Orb', regenMult: 2, stats: { STRENGTH: 25 } },
  PLASMAFLUX: { name: 'Plasmaflux Power Orb', regenMult: 2.25, stats: { STRENGTH: 35 } },
  ALERT_FLARE: { name: 'Alert Flare', regenMult: 1.5, stats: { FEROCITY: 10, TRUE_DEFENSE: 20 } },
  SOS_FLARE: { name: 'SOS Flare', regenMult: 2.25, stats: { FEROCITY: 10, ATTACK_SPEED: 5, TRUE_DEFENSE: 30 } },
};
// Wise Dragon Armor (full set): abilities cost exactly 2/3. Mana cost reductions multiply (wiki).
export const WISE_DRAGON_COST = 2 / 3;

// ---------- Mage class (wiki, Mage), in dungeons ----------
// Efficient Spells: -25% cooldowns, and -1% more every other level (-50% at 50).
// Intelligence: +5 per level; the wiki's "+250, for a total of +500" at 50 implies a base of 250.
// Ability Damage: +5, and +1 every 5 levels (+15 at 50).
// Mage Staff: melee attacks become a beam dealing (30% + 0.9 × Intelligence / 1000) of the melee damage
// (full damage up to 10 blocks: the best case).
export const MAGE = {
  cooldownBase: 25, cooldownPerTwoLevels: 1,
  intBase: 250, intPerLevel: 5,
  adBase: 5, adEvery: 5,
  beamBase: 0.3, beamPerInt: 0.9 / 1000,
};
export const mageStats = (level) => ({
  INTELLIGENCE: MAGE.intBase + MAGE.intPerLevel * level,
  ABILITY_DAMAGE_PERCENT: MAGE.adBase + Math.floor(level / MAGE.adEvery),
});
export const mageCooldownPct = (level) => MAGE.cooldownBase + MAGE.cooldownPerTwoLevels * Math.floor(level / 2);
export const mageBeamMult = (intelligence) => MAGE.beamBase + MAGE.beamPerInt * Math.max(0, intelligence);
