import { describe, it, expect } from 'vitest';
import { PRESET_SECTIONS, presetState, presetItemIds, presetTargetsExist, tunePreset } from './data/presets.js';
import { tuningPoints } from './data/mechanics.js';

// Stand-in items: every preset id, as a plain sword / armor piece with two combat gem slots.
const fakeItems = () => new Map(presetItemIds().map((id) => {
  const cat = ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'].find((s) => id.endsWith(s) || (s === 'HELMET' && /HEAD|MASK|GOGGLES|FEDORA|CROWN/.test(id)));
  return [id, { id, name: id, category: cat || 'SWORD', tier: 'LEGENDARY', stats: {}, gem_slots: ['COMBAT', 'COMBAT'], max_stars: 10 }];
}));

describe('build presets', () => {
  const keys = PRESET_SECTIONS.flatMap((s) => s.builds.flatMap((b) => b.presets.map((x) => `${s.id}/${b.id}/${x.stage}`)));

  it('has 44 presets, every target an existing enemy', () => {
    expect(keys).toHaveLength(44);
    expect(new Set(keys).size).toBe(44);
    expect(presetTargetsExist()).toBe(true);
  });

  it('fills weapon, four armor pieces and stage upgrades', () => {
    const byId = fakeItems();
    for (const key of keys) {
      const r = presetState(key, byId);
      expect(r.missing, key).toEqual([]);
      expect(r.state.weapon.id, key).toBeTruthy();
      expect(Object.values(r.state.armor).every((p) => p.id), key).toBe(true);
    }
    const end = presetState('dungeon/berserk/end', byId).state;
    expect(end.armor.CHESTPLATE).toMatchObject({ stars: 10, hpb: 10, fuming: 5, recomb: true });
    expect(end.armor.CHESTPLATE.gems).toEqual([{ gem: 'JASPER', quality: 'PERFECT' }, { gem: 'JASPER', quality: 'PERFECT' }]);
    expect(presetState('dungeon/mage/end', byId).state.armor.HELMET.gems[0].gem).toBe('SAPPHIRE');
    expect(end.dungeonClass).toMatchObject({ id: 'berserk', level: 50 });
  });

  it('reports ids the item list lacks instead of guessing', () => {
    const byId = fakeItems();
    byId.delete('TERMINATOR');
    const r = presetState('outside/archer/end', byId);
    expect(r.missing).toEqual(['TERMINATOR']);
    expect(r.state.weapon.id).toBe('');
  });

  it('sets the slayer boss as target, nothing outside dungeons', () => {
    const byId = fakeItems();
    expect(presetState('slayer/revenant/end', byId).target).toBe('Atoned Horror');
    expect(presetState('outside/melee/mid', byId).target).toBe('');
    expect(presetState('dungeon/archer/early', byId).target).toBe('Sadan (F6)');
  });

  it('puts every damage enchant the weapon takes on it, with an ultimate, and armor ultimates', () => {
    const byId = fakeItems();
    const w = presetState('slayer/revenant/end', byId).state.weapon;
    // Sharpness and Smite don't conflict in SkyBlock; of a conflicting pair only one is on.
    expect(w.enchants).toMatchObject({ sharpness: 7, smite: 7, critical: 7, thunderlord: 7, prosecute: 6, first_strike: 5 });
    expect(w.enchants.thunderbolt).toBeUndefined();
    expect(w.enchants.execute).toBeUndefined();
    expect(w.ultimate).toEqual({ id: 'chimera', level: 5 });
    expect(presetState('dungeon/berserk/early', byId).state.weapon.ultimate).toEqual({ id: 'soul_eater', level: 5 });
    expect(presetState('kuudra/dps/burning', byId).state.weapon.enchants.cubism).toBe(6); // the preset's own level
    const st = presetState('dungeon/berserk/end', byId).state;
    expect(Object.values(st.armor).every((p) => p.ultimate?.id)).toBe(true);
    expect(st.player.nearbyPlayers).toBe(4);
  });

  it('picks equipment within the stage price limit (David’s Cloak at XXX everywhere)', () => {
    const byId = fakeItems();
    const pool = (key, slot) => presetState(key, byId).tune.equipment[slot].map((p) => p.id);
    expect(pool('slayer/revenant/early', 'NECKLACE')).not.toContain('MAGMA_LORD_GAUNTLET'); // 23M
    expect(pool('slayer/revenant/mid', 'NECKLACE')).toContain('MAGMA_LORD_GAUNTLET');
    expect(pool('slayer/revenant/mid', 'BELT')).not.toContain('THE_PRIMORDIAL'); // 180M
    expect(pool('slayer/revenant/end', 'BELT')).toContain('THE_PRIMORDIAL');
    const david = presetState('slayer/revenant/early', byId).tune.equipment.CLOAK.find((p) => p.id === 'DAVIDS_CLOAK');
    expect(david.level).toBe(30);

    // A piece that adds damage is picked over the default; the result carries no item.
    byId.set('FLAMING_FIST', { ...byId.get('FLAMING_FIST'), category: 'GLOVES', stats: { STRENGTH: 200 } });
    const r = presetState('slayer/revenant/early', byId);
    const pc = (p) => ({ ...p, item: byId.get(p.id) });
    const input = { ...r.state, weapon: pc(r.state.weapon), armor: Object.values(r.state.armor).map(pc),
      equipment: Object.values(r.state.equipment).map(pc), shards: {}, target: { mobs: [], families: [] } };
    const t = tunePreset(input, r.tune);
    expect(t.equipment.WRIST.id).toBe('FLAMING_FIST');
    expect(t.equipment.WRIST.item).toBeUndefined();
  });

  it('leaves the power stone, tuning, shards and armor ultimates to the calculator', () => {
    const byId = fakeItems();
    const r = presetState('slayer/revenant/end', byId);
    const pc = (p) => ({ ...p, item: byId.get(p.id) });
    const input = { ...r.state, weapon: pc(r.state.weapon), armor: Object.values(r.state.armor).map(pc), equipment: [], shards: {},
      target: { enemy: 'Atoned Horror', mobs: ['Undead'], families: [], boss: true, maxHp: 1e8 } };
    const t = tunePreset(input, r.tune);
    const used = Object.values(t.tuning).reduce((a, b) => a + b, 0);
    expect(used).toBeLessThanOrEqual(tuningPoints(r.state.magicalPower));
    expect(used).toBeGreaterThan(0);
    expect(t.power).toBeTruthy();
    expect(t.shards.ruler_undead).toBe(10); // the target's mob type
    expect(t.shards.ruler_ender).toBeUndefined();
    expect(t.shards.elite).toBe(10);
    expect(t.armorUltimates.every((u) => u?.id)).toBe(true);
  });
});
