import { describe, it, expect } from 'vitest';
import { PRESET_SECTIONS, presetState, presetItemIds, presetTargetsExist } from './data/presets.js';

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
});
