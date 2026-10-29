import { describe, it, expect } from 'vitest';
import { simulate } from './sim.js';
import { calculate } from './calc.js';
import { meleeHitTicks, shortbowTicks } from './data/mechanics.js';

const sword = (stats, extra = {}) => ({ id: 'TEST_SWORD', name: 'Test', category: 'SWORD', tier: 'LEGENDARY', stats, ...extra });
// No crits (0 crit chance) unless a test wants them.
const noCrit = (weapon, extra = {}) => ({ weapon, bonuses: [{ label: 'x', CRITICAL_CHANCE: -30 }], ...extra });

describe('attack speed', () => {
  it('melee hit rate follows the invulnerability ticks, rounded', () => {
    expect(meleeHitTicks(0)).toBe(10);
    expect(meleeHitTicks(5)).toBe(10);
    expect(meleeHitTicks(6)).toBe(9);
    expect(meleeHitTicks(82)).toBe(5);
    expect(meleeHitTicks(200)).toBe(5); // capped at 100
    expect(shortbowTicks(82)).toBe(6); // rounded up
    expect(shortbowTicks(100)).toBe(5);
  });

  it('a 10 s fight at 0 attack speed is 20 hits', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }) }), { duration: 10 });
    expect(s.hits).toBe(20);
    expect(s.total).toBe(20 * 100);
    expect(s.dps).toBe(200);
  });
});

describe('fight length', () => {
  it('until dead stops at the killing hit', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { target: { maxHp: 1000 } }), { mode: 'kill' });
    expect(s.hits).toBe(10);
    expect(s.killedAt).toBeCloseTo(4.5);
    expect(s.endHp).toBe(0);
  });

  it('starting enemy HP sets how much is left to kill', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { target: { maxHp: 1000 } }), { mode: 'kill', enemyHpPct: 50 });
    expect(s.hits).toBe(5);
  });

  it('needs a max HP to fight until dead', () => {
    expect(simulate(noCrit({ item: sword({ DAMAGE: 95 }) }), { mode: 'kill' }).error).toMatch(/max HP/);
  });

  it('starting player HP sets full / low health', () => {
    const r = (pct) => simulate(noCrit({ item: sword({ DAMAGE: 95 }) }), { duration: 1, playerHpPct: pct });
    expect(r(100).total).toBe(r(50).total); // nothing here depends on health
  });
});

describe('per-hit effects', () => {
  it('ferocity: each 100 is a guaranteed extra strike', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95, FEROCITY: 200 }) }), { duration: 1 });
    expect(s.hits).toBe(2);
    expect(s.ferocity).toBe(4);
    expect(s.total).toBe(2 * 3 * 100);
  });

  it('Thunderlord strikes every 3rd hit for a % of it', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }), enchants: { thunderlord: 7 } }), { duration: 3 });
    expect(s.hits).toBe(6);
    expect(s.lightning).toBe(2);
    expect(s.damage.lightning).toBe(2 * 60);
    // No effect on a single hit.
    expect(calculate(noCrit({ item: sword({ DAMAGE: 95 }), enchants: { thunderlord: 7 } })).nonCrit).toBe(100);
  });

  it('First Strike counts on the first hit only, Triple-Strike on the first three', () => {
    const first = simulate(noCrit({ item: sword({ DAMAGE: 95 }), enchants: { first_strike: 4 } }), { duration: 1 });
    expect(first.total).toBe(200 + 100);
    const triple = simulate(noCrit({ item: sword({ DAMAGE: 95 }), enchants: { triple_strike: 5 } }), { duration: 2.5 });
    expect(triple.total).toBe(3 * 150 + 2 * 100);
  });

  it('Tarantula Talisman (assumed from MP) multiplies every 10th melee hit', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { magicalPower: 12 }), { duration: 5 });
    expect(s.hits).toBe(10);
    expect(s.total).toBe(9 * 100 + 110); // 12 MP: the talisman is the only accessory yet
  });

  it('Execute grows as the enemy loses HP', () => {
    const w = { item: sword({ DAMAGE: 95 }), enchants: { execute: 6 } };
    const s = simulate(noCrit(w, { target: { maxHp: 1e9 } }), { duration: 1, enemyHpPct: 10 });
    expect(s.total).toBe(2 * Math.floor(100 * (1 + 1.25 * 90 / 100)));
  });

  it('crits and Fabled are repeatable with a seed', () => {
    const w = { weapon: { item: sword({ DAMAGE: 95, CRITICAL_CHANCE: 20 }), reforge: 'fabled' } };
    const a = simulate(w, { duration: 20, seed: 7 });
    expect(simulate(w, { duration: 20, seed: 7 }).total).toBe(a.total);
    expect(a.crits).toBeGreaterThan(0);
    expect(a.crits).toBeLessThan(a.hits);
  });
});

describe('playback events', () => {
  it('one event per hit, in time order, with procs named', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }), enchants: { thunderlord: 7, first_strike: 4 } }), { duration: 2 });
    expect(s.events.map((e) => e.t)).toEqual([0, 0.5, 1, 1.5]);
    expect(s.events[0].bonuses).toEqual(['First Strike']);
    expect(s.events[2].bonuses).toEqual(['Lightning']);
    expect(s.events.at(-1).total).toBe(s.total);
  });

  it('Dominus builds stacks, adds Ferocity and swipes at 10 stacks', () => {
    const piece = (slot) => ({ item: { id: `INFERNAL_CRIMSON_${slot}`, name: slot, category: slot, tier: 'LEGENDARY', stats: {} } });
    const armor = ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'].map(piece);
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { armor }), { duration: 10, seed: 3 });
    // 4 pieces: a stack every 0.5 s (every hit at 0 attack speed), 10 stacks after 10 hits.
    expect(s.swipes).toBe(s.hits - 10);
    expect(s.ferocity).toBeGreaterThan(0);
    expect(s.events[0].swipe).toBe(0);
  });

  it('a swipe is the hit × Swipe Strength / its Additive Multiplier, doubled the first time', () => {
    const piece = (slot) => ({ item: { id: `INFERNAL_CRIMSON_${slot}`, name: slot, category: slot, tier: 'LEGENDARY', stats: {} } });
    const armor = ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'].map(piece);
    const swipes = (combatLevel) => simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { armor, combatLevel }), { duration: 6 }).events.filter((e) => e.swipe);
    // At 10 stacks: hit = 100 × (1 + 100% Dominus) = 200, Infernal 4 pieces Swipe Strength 3.
    const [first, second] = swipes(0);
    expect(first.hit).toBe(200);
    expect(first.swipe).toBe(Math.floor(200 * 3 / 2) * 2);
    expect(second.swipe).toBe(Math.floor(200 * 3 / 2));
    // More additive damage (Combat 50: +200%): the hit grows, the swipe stays the same size.
    const [, more] = swipes(50);
    expect(more.hit).toBe(400);
    expect(more.swipe).toBe(Math.floor(400 * 3 / 4));
  });
});
