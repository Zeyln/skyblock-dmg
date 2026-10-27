import { hasFormatting, stripFormatting } from './mctext.js';

// Hypixel SkyBlock items resource (public, no API key, CORS enabled).
const ITEMS_URL = 'https://api.hypixel.net/v2/resources/skyblock/items';
const CACHE_KEY = 'dpscalc.items.v7';
const CACHE_TTL = 12 * 60 * 60 * 1000;

export const ARMOR_SLOTS = ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'];
export const EQUIPMENT_SLOTS = ['NECKLACE', 'CLOAK', 'BELT', 'GLOVES', 'BRACELET'];
const NON_WEAPON = new Set([...ARMOR_SLOTS, ...EQUIPMENT_SLOTS, 'ACCESSORY', 'PICKAXE', 'DRILL', 'VACUUM', 'SPADE', 'ARROW']);

// name: plain text (search, summaries, breakdown labels); fmtName: original with § codes, kept
// only when it has formatting, for styled display.
const slim = (i) => ({
  id: i.id,
  name: stripFormatting(i.name),
  fmtName: hasFormatting(i.name) ? i.name : undefined,
  category: i.category,
  tier: i.tier,
  stats: i.stats,
  tiered_stats: i.tiered_stats,
  dungeon_item: i.dungeon_item,
  item_model: i.item_model,
  gem_slots: (i.gemstone_slots || []).map((s) => s.slot_type),
  max_stars: i.upgrade_costs?.length || 0,
  can_recombobulate: i.can_recombobulate,
  can_dungeonize: !!i.dungeon_item_conversion_cost,
});

function readCache(key = CACHE_KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return Date.now() - data.fetchedAt < CACHE_TTL ? data : null;
  } catch {
    return null;
  }
}

function writeCache(data, key = CACHE_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Storage unavailable or full: run uncached.
  }
}

// Pet numbers and pet lore from the NotEnoughUpdates community repo (Hypixel's API has no pet data).
const NEU = 'https://raw.githubusercontent.com/NotEnoughUpdates/NotEnoughUpdates-REPO/master';
const PET_CACHE_KEY = 'dpscalc.pets.v1';

export async function loadPets({ force = false } = {}) {
  if (!force) {
    const cached = readCache(PET_CACHE_KEY);
    if (cached) return cached;
  }
  const [petnums, pets] = await Promise.all(
    ['constants/petnums.json', 'constants/pets.json'].map(async (p) => {
      const res = await fetch(`${NEU}/${p}`);
      if (!res.ok) throw new Error(`NEU repo returned ${res.status} for ${p}`);
      return res.json();
    }),
  );
  const data = { fetchedAt: Date.now(), petnums, displayNames: pets.id_to_display_name || {}, types: pets.pet_types || {} };
  writeCache(data, PET_CACHE_KEY);
  return data;
}

// Lore for one pet at one rarity; falls back to lower rarities when NEU has no entry.
const loreCache = new Map();
export async function loadPetLore(pet, rarityIdx) {
  const key = `${pet};${rarityIdx}`;
  if (loreCache.has(key)) return loreCache.get(key);
  const promise = (async () => {
    for (let i = rarityIdx; i >= 0; i--) {
      const res = await fetch(`${NEU}/items/${encodeURIComponent(`${pet};${i}`)}.json`);
      if (res.ok) return (await res.json()).lore || [];
    }
    return [];
  })().catch(() => []);
  loreCache.set(key, promise);
  return promise;
}

export async function loadItems({ force = false } = {}) {
  if (!force) {
    const cached = readCache();
    if (cached) return cached;
  }
  const res = await fetch(ITEMS_URL);
  if (!res.ok) throw new Error(`Hypixel API returned ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error('Hypixel API reported failure');

  const weapons = [];
  const armor = Object.fromEntries(ARMOR_SLOTS.map((s) => [s, []]));
  const equipment = Object.fromEntries(EQUIPMENT_SLOTS.map((s) => [s, []]));
  const powerStones = {};
  const petItems = [];

  for (const raw of json.items) {
    if (raw.hide_from_api) continue;
    const i = slim(raw);
    const stats = i.stats || {};
    if ((i.item_model || '').includes('power_stones')) powerStones[i.id] = i.name;
    if (i.category === 'PET_ITEM') petItems.push({ id: i.id, name: i.name, fmtName: i.fmtName, tier: i.tier });
    if (armor[i.category]) armor[i.category].push(i);
    else if (equipment[i.category]) equipment[i.category].push(i);
    // Dungeon drops keep Damage in tiered_stats rather than stats.
    else if ((stats.DAMAGE || stats.damage || i.tiered_stats?.DAMAGE) && !NON_WEAPON.has(i.category)) weapons.push(i);
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  weapons.sort(byName);
  Object.values(armor).forEach((l) => l.sort(byName));
  Object.values(equipment).forEach((l) => l.sort(byName));

  petItems.sort(byName);

  const data = { fetchedAt: Date.now(), lastUpdated: json.lastUpdated, weapons, armor, equipment, powerStones, petItems };
  writeCache(data);
  return data;
}
