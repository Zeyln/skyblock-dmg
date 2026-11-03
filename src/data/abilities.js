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

const ability = (name, base, scaling, mana, cooldown = 0, extra = {}) => ({ name, base, scaling, mana, cooldown, ...extra });

const WITHER_IMPACT = ability('Wither Impact', 10000, 0.3, 300, 0.15, { fixedCooldown: true });
const IMPLOSION = ability('Implosion', 10000, 0.3, 300, 10);
// Necron's Blade variants: the scrolls applied (all three replace them with Wither Impact).
export const WITHER_BLADES = ['NECRON_BLADE', 'HYPERION', 'VALKYRIE', 'ASTRAEA', 'SCYLLA'];
export const WITHER_SCROLLS = [
  ['impact', 'Wither Impact (all 3 scrolls)'], ['implosion', 'Implosion scroll only'], ['none', 'No damage scroll'],
];

const GIANTS_SLAM = ability("Giant's Slam", 100000, 0.05, 100, 30, { melee: true });
const SPIRIT = (base) => ability('Guided Bat', base, 0.2, 200);
const YETI = (base) => ability('Terrain Toss', base, 0.3, 250, 1);
const BONZO = (base) => ability('Showtime', base, 0.2, 90);
const ICE_BOLT = (base, mana) => ability('Ice Bolt', base, 0.3, mana);
const ICE_SPRAY = (base) => ability('Ice Spray', base, 0.1, 50, 5);
const MOLTEN_WAVE = (bonus, cap) => ability('Molten Wave', 6000, 0.3, 500, 1, { greed: { min: 6000, bonus, cap } });
const DREADLORD = ability('Dreadlord', 500, 0.3, 40);

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
  STAFF_OF_THE_VOLCANO: ability('Explode', 24000, 0.3, 100, 30),
  PIGMAN_SWORD: ability('Burning Souls', 30000, 0.1, 400, 5, { over: 5, noAdditive: true }),
  RUNIC_STAFF: ability('Runic Zap', 10000, 0.2, 10, 1),
  CRYPT_DREADLORD_SWORD: DREADLORD,
  STARRED_CRYPT_DREADLORD_SWORD: DREADLORD,
  INK_WAND: ability('Ink Bomb', 10000, 1, 60, 30),
  GOLEM_SWORD: ability('Iron Punch', 250, 1, 70, 3),
  LEAPING_SWORD: ability('Leap', 350, 1, 50, 1),
  SILK_EDGE_SWORD: ability('Leap', 400, 1, 50, 1),
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
// Max mana = 100 + Intelligence; it regenerates 2% of max mana each second (more with Mana Regen %).
// In dungeons a melee hit restores 5 + 1% of max mana (wiki, Mage › Strategies).
export const BASE_MANA = 100;
export const MANA_REGEN_PCT = 2;
export const DUNGEON_HIT_MANA = { flat: 5, pct: 1 };

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
