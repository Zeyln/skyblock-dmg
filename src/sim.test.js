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

describe('weapon abilities', () => {
  const vorpal = { id: 'VORPAL_KATANA', name: 'Vorpal Katana', category: 'SWORD', tier: 'LEGENDARY', stats: { DAMAGE: 95 } };
  const enderman = { mobs: ['Ender'], families: ['Enderman'] };

  it('Soulcry adds Ferocity against Endermen, on unless switched off', () => {
    expect(calculate({ weapon: { item: vorpal }, target: enderman }).totals.FEROCITY).toBe(300);
    expect(calculate({ weapon: { item: vorpal, abilityOn: false }, target: enderman }).totals.FEROCITY || 0).toBe(0);
    expect(calculate({ weapon: { item: vorpal }, target: { mobs: ['Ender'] } }).totals.FEROCITY || 0).toBe(0); // an Endermite
  });

  it('the simulation gets 3 extra strikes per hit from Vorpal Soulcry', () => {
    const s = simulate(noCrit({ item: vorpal }, { target: enderman }), { duration: 1 });
    expect(s.ferocity).toBe(2 * 3);
  });
});

describe('Voidgloom Seraph phases', () => {
  const seraph = (tier, maxHp) => ({ enemy: `Voidgloom Seraph ${tier}`, maxHp, mobs: ['Ender'], families: ['Enderman'], boss: true });

  it('Hitshield takes hits, Ferocity counts toward it and is divided by 4 once it is down', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95, FEROCITY: 400 }) }, { target: seraph('I', 1e9) }), { duration: 5 });
    // 15-hit shield, 5 hits per swing (1 + 4 Ferocity strikes): 3 swings.
    expect(s.events.slice(0, 3).every((e) => e.shielded && e.damage === 0)).toBe(true);
    expect(s.events[3].shielded).toBeUndefined();
    expect(s.events[3].ferocity).toBe(1); // 400 / 4
    expect(s.phases[0]).toMatchObject({ kind: 'shield', start: 0, end: 1 });
  });

  it('T4: shields, laser immunity, glyph breaks and heads all play out', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 3.5e6 - 5 }) }, { target: seraph('IV', 210e6) }), { mode: 'kill', seed: 2 });
    const kinds = (k) => s.phases.filter((p) => p.kind === k);
    expect(kinds('shield')).toHaveLength(3);
    expect(kinds('laser')).toHaveLength(3);
    // Heads: one every 6 s; when the second is up the player spends 1 s looking at both, no hits.
    const batches = kinds('heads').filter((p) => p.end - p.start >= 7);
    expect(batches.length).toBeGreaterThan(1);
    for (const [i, p] of batches.entries()) {
      expect(s.events.some((e) => e.t >= p.end - 1 && e.t < p.end)).toBe(false);
      if (i) expect(p.start - batches[i - 1].start).toBe(12);
    }
    expect(kinds('glyph').length).toBeGreaterThan(0);
    // T4 shields are shot down with a Terminator in 2.5–3 s, with no melee hits meanwhile.
    for (const p of kinds('shield')) {
      expect(p.end - p.start).toBeGreaterThanOrEqual(2.5);
      expect(p.end - p.start).toBeLessThanOrEqual(3);
    }
    expect(s.events[0].t).toBeGreaterThanOrEqual(kinds('shield')[0].end);
    expect(s.events.some((e) => e.shielded)).toBe(false);
    // No hits while immune (after the first 2 s of each laser) or while breaking a glyph.
    const hitIn = (a, b) => s.events.some((e) => e.t >= a && e.t < b);
    for (const p of kinds('laser')) expect(hitIn(p.start + 2, p.end)).toBe(false);
    for (const p of kinds('shield')) expect(hitIn(p.start + 1e-9, p.end)).toBe(false);
    for (const p of kinds('glyph')) {
      expect(p.end - p.start).toBeGreaterThanOrEqual(0.5);
      expect(p.end - p.start).toBeLessThanOrEqual(0.75);
      expect(hitIn(p.start, p.end)).toBe(false);
    }
    expect(s.killedAt).toBeGreaterThan(3 * 2.5 + 3 * 6);
  });

  it('below T4, a Terminator breaks shields only above 900 Magical Power', () => {
    const run = (magicalPower) => simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { target: seraph('III', 1e9), magicalPower }), { duration: 40 });
    expect(run(900).events.slice(0, 60).every((e) => e.shielded)).toBe(true); // 60 hits by hand
    const fast = run(901);
    expect(fast.events.some((e) => e.shielded)).toBe(false);
    expect(fast.phases[0].end).toBeLessThanOrEqual(3);
  });

  it('other enemies have no phases', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95, FEROCITY: 400 }) }, { target: { maxHp: 1e9 } }), { duration: 1 });
    expect(s.phases).toEqual([]);
    expect(s.events[0].ferocity).toBe(4);
  });
});

describe('Tarantula Broodfather phases', () => {
  const brood = (tier, maxHp) => ({ enemy: `Tarantula Broodfather ${tier}`, maxHp, mobs: ['Arthropod'], boss: true });
  const hitIn = (s, a, b) => s.events.some((e) => e.t >= a && e.t < b);

  it('Backstab: a leap every 5 s costs 200 ms re-aiming', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { target: brood('I', 1e9) }), { duration: 12 });
    const leaps = s.phases.filter((p) => p.kind === 'leap');
    expect(leaps.map((p) => p.start)).toEqual([5, 10]);
    for (const p of leaps) {
      expect(p.end - p.start).toBeCloseTo(0.2);
      expect(hitIn(s, p.start, p.end)).toBe(false);
    }
  });

  it('Web of Lies at 66% and 33%: swap, then one sac’s hits in shortbow shots', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 100e3 - 5 }) }, { target: brood('IV', 2.5e6) }), { mode: 'kill' });
    const webs = s.phases.filter((p) => p.kind === 'web');
    expect(webs).toHaveLength(2);
    // T4: 6 hits a sac; 0 attack speed shoots every 0.5 s: 1 s + 3 s.
    for (const p of webs) {
      expect(p.end - p.start).toBeCloseTo(4);
      expect(hitIn(s, p.start + 1e-9, p.end)).toBe(false); // after the hit that set it off
    }
  });

  it('T5: the Conjoined Brood takes over with twice the health', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 1e6 - 5 }) }, { target: brood('V', 10e6) }), { mode: 'kill' });
    const takeover = s.phases.find((p) => p.kind === 'brood');
    expect(takeover).toBeTruthy();
    expect(s.events.at(-1).maxHp).toBe(20e6);
    expect(s.total).toBe(30e6);
    expect(s.killedAt).toBeGreaterThan(takeover.start);
  });

  it('always finishes, whatever the attack speed (pauses ending between ticks)', () => {
    // Used to hang: a leap pushed past a web ended at 57.85 + 0.2 s, just past a tick.
    const stuck = simulate(noCrit({ item: sword({ DAMAGE: 1e5, ATTACK_SPEED: 12 }) }, { target: brood('IV', 2.5e6) }), { mode: 'kill' });
    expect(stuck.seconds).toBeGreaterThan(0);
    for (let as = 0; as <= 100; as += 7) {
      for (const seed of [1, 2, 3]) {
        const s = simulate(noCrit({ item: sword({ DAMAGE: 2e5, ATTACK_SPEED: as, FEROCITY: 150 }) }, { target: brood('V', 10e6) }), { mode: 'kill', seed });
        expect(s.seconds).toBeGreaterThan(0);
      }
    }
  });

  it('despawns after 3 minutes', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { target: brood('IV', 2.5e6) }), { mode: 'kill' });
    expect(s.despawned).toBe(true);
    expect(s.seconds).toBe(180);
    expect(s.events.at(-1).t).toBeLessThan(180);
  });
});
