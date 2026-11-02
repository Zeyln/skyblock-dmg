import { describe, it, expect } from 'vitest';
import { simulate } from './sim.js';
import { calculate } from './calc.js';
import { meleeHitTicks, shortbowTicks } from './data/mechanics.js';
import { petNumbers, cleanLore } from './data/pets.js';

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
  it('Ferocity strikes land one by one, 100 ms after their hit and 100 ms apart', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95, FEROCITY: 200 }) }), { duration: 1 });
    expect(s.events.map((e) => [Math.round(e.t * 1000), e.feroOnly ? 'fero' : 'hit', e.damage])).toEqual([
      [0, 'hit', 100], [100, 'fero', 100], [200, 'fero', 100], [500, 'hit', 100], [600, 'fero', 100], [700, 'fero', 100]]);
    expect(s.total).toBe(600);
  });

  it('strikes still to come land after the next hit, in time order', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95, FEROCITY: 400, ATTACK_SPEED: 100 }) }, { target: { maxHp: 1e6 } }), { duration: 1 });
    const order = s.events.map((e) => [Math.round(e.t * 1000), e.feroOnly ? 'fero' : 'hit']);
    expect(order.slice(0, 7)).toEqual([[0, 'hit'], [100, 'fero'], [200, 'fero'], [250, 'hit'], [300, 'fero'], [350, 'fero'], [400, 'fero']]);
    for (let i = 1; i < s.events.length; i++) {
      expect(s.events[i].t).toBeGreaterThanOrEqual(s.events[i - 1].t);
      expect(s.events[i].hp).toBeLessThanOrEqual(s.events[i - 1].hp);
      expect(s.events[i].total).toBe(s.events[i - 1].total + s.events[i].damage);
    }
    expect(s.events.every((e) => e.t <= 1)).toBe(true);
  });

  it('a kill by Ferocity strikes alone lands 100 ms after the hit', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95, FEROCITY: 100 }) }, { target: { maxHp: 150 } }), { mode: 'kill' });
    expect(s.killedAt).toBeCloseTo(0.1);
  });


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
    const hits = s.events.filter((e) => !e.feroOnly);
    expect(hits.slice(0, 3).every((e) => e.shielded && e.damage === 0)).toBe(true);
    expect(hits[3].shielded).toBeUndefined();
    // Its Ferocity strike: 400 / 4 = 1, landing 100 ms after the hit.
    const strike = s.events[s.events.indexOf(hits[3]) + 1];
    expect(strike).toMatchObject({ feroOnly: true, ferocity: 1 });
    expect(strike.t - hits[3].t).toBeCloseTo(0.1);
    // It breaks on the third swing's last strike: 1 s + 100 ms + 3 × 100 ms.
    expect(s.phases[0]).toMatchObject({ kind: 'shield', start: 0 });
    expect(s.phases[0].end).toBeCloseTo(1.4);
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
    // T4 shields are shot down with a Terminator, with no melee hits meanwhile: 3 arrows a shot every
    // 0.5 s (0 attack speed, no Ferocity), so 34 shots for 100 hits.
    for (const p of kinds('shield')) {
      expect(p.shots).toHaveLength(34);
      expect(p.end - p.start).toBeCloseTo(16.5);
      expect(p.left.at(-1)).toEqual([p.end, 0]);
    }
    expect(s.events[0].t).toBeGreaterThanOrEqual(kinds('shield')[0].end);
    expect(s.events.some((e) => e.shielded)).toBe(false);
    // No hits while immune (the whole laser) or while breaking a glyph.
    const hitIn = (a, b) => s.events.some((e) => e.t >= a && e.t < b);
    for (const p of kinds('laser')) {
      expect(hitIn(p.start + 1e-9, p.end)).toBe(false);
      expect(s.events.filter((e) => e.t > p.start && e.t < p.end).every((e) => e.damage === 0)).toBe(true);
    }
    for (const p of kinds('shield')) expect(hitIn(p.start + 1e-9, p.end)).toBe(false);
    for (const p of kinds('glyph')) {
      // At least the break itself; longer when the glyph lands while the player is busy (it waits).
      expect(p.end - p.start).toBeGreaterThanOrEqual(0.5);
      expect(hitIn(p.start, p.end)).toBe(false);
    }
    expect(s.killedAt).toBeGreaterThan(3 * 2.5 + 3 * 6);
  });

  it('T4 beams are immune from the start, and strikes past a shield or beam line are absorbed', () => {
    // 30M a swing and one strike (400 / 4): from 180M the strike crosses 5/6 (175M), and the beams start on it.
    const s = simulate(noCrit({ item: sword({ DAMAGE: 3e7, FEROCITY: 400 }) }, { target: seraph('IV', 210e6) }), { mode: 'kill' });
    const shields = s.phases.filter((p) => p.kind === 'shield');
    const lasers = s.phases.filter((p) => p.kind === 'laser');
    expect(lasers[0].start).toBeCloseTo(shields[0].end + 0.1);
    for (const a of shields) for (const b of lasers) expect(a.start < b.end - 1e-6 && b.start < a.end - 1e-6).toBe(false);
    for (const p of lasers) expect(s.events.some((e) => e.t > p.start && e.t < p.end - 1e-6 && e.damage > 0)).toBe(false);
    // The strike that crosses 2/3 is capped at it (145M → 140M), and the shield starts on it.
    const crossing = s.events.find((e) => !e.shielded && e.t >= shields[1].start - 1e-9 - 0.1);
    expect(crossing.hp).toBeCloseTo(145e6, -2);
    const strike = s.events[s.events.indexOf(crossing) + 1];
    expect(strike).toMatchObject({ feroOnly: true });
    expect(strike.hp).toBeCloseTo(140e6, -2);
    expect(strike.t).toBeCloseTo(shields[1].start);
  });

  it('one hit can’t jump past the next phase: its damage stops at the line', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 1e9 }) }, { target: seraph('IV', 210e6) }), { mode: 'kill' });
    const lines = [5 / 6, 2 / 3, 1 / 2, 1 / 3, 1 / 6].map((f) => f * 210e6);
    const hits = s.events.filter((e) => !e.shielded && e.damage > 0);
    hits.slice(0, 5).forEach((e, i) => expect(e.hp).toBeCloseTo(lines[i], -1));
    expect(s.phases.filter((p) => p.kind === 'shield')).toHaveLength(3);
    expect(s.phases.filter((p) => p.kind === 'laser')).toHaveLength(3);
    expect(hits.at(-1).hp).toBe(0);
  });

  it('Clutch: a Yang Glyph is left alone when the boss dies within its 5 s anyway', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 1e5 }) }, { target: seraph('II', 12e6) }), { mode: 'kill' });
    const m = s.mechanics.at(-1);
    expect(m).toMatchObject({ kind: 'glyph', clutch: true });
    expect(s.killedAt).toBeLessThanOrEqual(m.land + 5);
    expect(s.phases.some((p) => p.kind === 'glyph' && p.start === m.land)).toBe(false);
    expect(s.phases.find((p) => p.kind === 'clutch').detail).toMatch(/^Yang Glyph · \d+\.\d s left$/);
    expect(s.phaseKinds).toContain('clutch');
    // Earlier glyphs were too far from the kill, and were broken.
    expect(s.mechanics.slice(0, -1).every((x) => !x.clutch)).toBe(true);
  });

  it('below T4, a Terminator breaks shields only above 900 Magical Power', () => {
    const run = (magicalPower) => simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { target: seraph('III', 1e9), magicalPower }), { duration: 40 });
    expect(run(900).events.slice(0, 60).every((e) => e.shielded)).toBe(true); // 60 hits by hand
    const fast = run(901);
    expect(fast.events.some((e) => e.shielded)).toBe(false);
    expect(fast.phases[0].end).toBeCloseTo(9.5); // 60 hits: 20 shots of 3 arrows, 0.5 s apart
  });

  it('a Terminator shoots faster and harder with its own stats', () => {
    // Terminator: 40 attack speed (8-tick shots); with 200 Ferocity each arrow is 3 hits, 9 a shot.
    const terminator = { id: 'TERMINATOR', name: 'Terminator', category: 'BOW', tier: 'LEGENDARY', stats: { DAMAGE: 310, ATTACK_SPEED: 40, FEROCITY: 200 } };
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { target: seraph('IV', 1e12), terminator }), { duration: 20 });
    const p = s.phases.find((x) => x.kind === 'shield');
    expect(p.shots).toHaveLength(12); // ceil(100 / 9)
    expect(p.end - p.start).toBeCloseTo(11 * 0.4);
    // Each shot: 3 explosions at once, then their strikes one by one, 100 ms apart.
    expect(p.left.slice(0, 9).map(([x, left]) => [Math.round((x - p.start) * 1000), left])).toEqual([
      [0, 99], [0, 98], [0, 97], [100, 96], [100, 95], [100, 94], [200, 93], [200, 92], [200, 91]]);
  });

  it('by hand, the shield loses a hit per strike as each lands, and breaks on the last one', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95, FEROCITY: 200 }) }, { target: seraph('III', 1e9) }), { duration: 40 });
    const shielded = s.events.filter((e) => e.shielded);
    const p = s.phases.find((x) => x.kind === 'shield');
    const first = shielded.filter((e) => e.t <= p.end);
    first.forEach((e, i) => expect(e.shieldLeft).toBe(first.length - i - 1));
    expect(first.at(-1).t).toBeCloseTo(p.end);
    expect(first.at(-1).feroOnly).toBe(true);
    expect(s.events.some((e) => !e.shielded && e.t < p.end)).toBe(false);
  });

  it('other enemies have no phases', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95, FEROCITY: 400 }) }, { target: { maxHp: 1e9 } }), { duration: 1 });
    expect(s.phases).toEqual([]);
    expect(s.events.slice(1, 5).map((e) => e.feroOnly && e.ferocity)).toEqual([1, 1, 1, 1]);
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

describe('Inferno Demonlord phases', () => {
  const dagger = (id, DAMAGE = 95, extra = {}) => ({ item: { id, name: id, category: 'SWORD', tier: 'LEGENDARY', stats: { DAMAGE, ...extra } } });
  const lord = (tier, maxHp) => ({ enemy: `Inferno Demonlord ${tier}`, maxHp, mobs: ['Infernal'], boss: true });
  const run = (weapon, weapon2, target, opts) =>
    simulate({ weapon, weapon2, target, bonuses: [{ label: 'x', CRITICAL_CHANCE: -30 }] }, { mode: 'kill', ...opts });

  it('Hellion Shield: the matching dagger every 8 hits, a 150 ms swap between', () => {
    // Pyrochaos ×2 vs Infernal (Ashen/Auric), Deathripper ×3.5 (Spirit/Crystal); the shield starts on Ashen.
    const s = run(dagger('HEARTFIRE_DAGGER'), dagger('HEARTMAW_DAGGER'), lord('II', 1e9), { mode: 'duration', duration: 9 });
    expect(s.events.slice(0, 8).every((e) => e.hit === 200)).toBe(true);
    expect(s.events[8].hit).toBe(350);
    const swap = s.phases.find((p) => p.kind === 'swap');
    expect(swap.end - swap.start).toBeCloseTo(0.15);
    expect(s.events[8].t).toBeGreaterThanOrEqual(swap.end);
    expect(s.phases.find((p) => p.kind === 'hellion').detail).toMatch(/^Ashen/);
  });

  it('one dagger: the wrong attunement and all Ferocity lose 99%', () => {
    const s = run(dagger('HEARTFIRE_DAGGER', 95, { FEROCITY: 100 }), null, lord('II', 1e9), { mode: 'duration', duration: 9 });
    const hits = s.events.filter((e) => !e.feroOnly);
    expect(hits[0].hit).toBe(200);
    expect(s.events[1]).toMatchObject({ feroOnly: true, damage: 2 }); // the Ferocity strike: 1%
    expect(hits[8].hit).toBe(2); // Spirit, no Twilight-family dagger
  });

  it('Demonsplit at 50%: the boss waits at 5M while Quazii and Typhoeus trade shields', () => {
    const s = run(dagger('HEARTFIRE_DAGGER', 250e3), dagger('HEARTMAW_DAGGER', 250e3), lord('II', 10e6));
    const split = s.phases.find((p) => p.kind === 'split');
    expect(split).toBeTruthy();
    const during = s.events.filter((e) => e.target);
    expect(during[0].target).toBe('Quazii');
    expect(during[0].maxHp).toBe(1.75e6);
    expect(during.some((e) => e.target === 'Typhoeus')).toBe(true);
    // Back on the boss afterwards, from 5M down to 0.
    const after = s.events.filter((e) => !e.target && e.t > split.end);
    expect(after[0].hp).toBeLessThan(5e6);
    expect(s.killedAt).toBeGreaterThan(split.end);
  });

  it('Fire Pillars: 500 ms to reach plus 8 hits, every 20 s from 50%', () => {
    const s = run(dagger('HEARTFIRE_DAGGER', 20e3), dagger('HEARTMAW_DAGGER', 20e3), lord('II', 10e6));
    const pillars = s.phases.filter((p) => p.kind === 'pillar');
    expect(pillars.length).toBeGreaterThan(1);
    expect(pillars[0].end - pillars[0].start).toBeCloseTo(0.5 + 8 * 0.5);
    expect(pillars[1].start - pillars[0].start).toBeCloseTo(20);
  });

  it('Clutch: a pillar is left alone when the boss dies within its 7 s anyway', () => {
    const s = run(dagger('HEARTFIRE_DAGGER', 25e3), dagger('HEARTMAW_DAGGER', 25e3), lord('II', 10e6));
    const m = s.mechanics.at(-1);
    expect(m).toMatchObject({ kind: 'pillar', clutch: true });
    expect(s.killedAt).toBeLessThanOrEqual(m.deadline);
    expect(s.killedAt).toBeGreaterThan(m.land);
    expect(s.phases.some((p) => p.kind === 'pillar' && p.start === m.land)).toBe(false);
    expect(s.phases.find((p) => p.kind === 'clutch')).toMatchObject({ start: m.land, end: s.killedAt });
    expect(s.events.some((e) => e.t > m.land && e.t < s.killedAt && !e.feroOnly)).toBe(true);
    // Too far from the kill: the pillar is broken as usual.
    const slow = run(dagger('HEARTFIRE_DAGGER', 20e3), dagger('HEARTMAW_DAGGER', 20e3), lord('II', 10e6));
    expect(slow.mechanics.some((x) => x.clutch)).toBe(false);
    expect(slow.phases.some((p) => p.kind === 'clutch')).toBe(false);
  });

  it('T1: no shield; Quazii, then Typhoeus', () => {
    const s = run(dagger('HEARTFIRE_DAGGER', 50e3), null, lord('I', 2.5e6));
    expect(s.phases.some((p) => p.kind === 'hellion' || p.kind === 'swap')).toBe(false);
    const names = [...new Set(s.events.filter((e) => e.target).map((e) => e.target))];
    expect(names).toEqual(['Quazii', 'Typhoeus']);
    expect(s.killedAt).not.toBeNull();
  });
});

describe('Sven Packmaster phases', () => {
  const sven = (tier, maxHp) => ({ enemy: `Sven Packmaster ${tier}`, maxHp, mobs: ['Animal'], families: ['Wolf'], boss: true });

  it('T4: at 50% the boss is protected until all 5 pups (10% HP each) are dead', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 100e3 - 5 }) }, { target: sven('IV', 2e6) }), { mode: 'kill' });
    const pupHits = s.events.filter((e) => e.target === 'Sven Pup');
    // 200k pups, 100k hits: two hits each; they arrive a second apart, so it takes about 4 s plus a hit.
    expect(pupHits).toHaveLength(10);
    expect(pupHits[0].maxHp).toBe(200e3);
    const phase = s.phases.filter((p) => p.kind === 'pups');
    expect(phase[0].detail).toBe('0 of 5 pups killed');
    expect(phase.at(-1).end - phase[0].start).toBeGreaterThanOrEqual(4);
    // The boss's HP waits at 1M meanwhile, then it dies.
    const bossAfter = s.events.filter((e) => !e.target && e.t > pupHits.at(-1).t);
    expect(bossAfter[0].hp).toBe(1e6 - 100e3);
    expect(s.killedAt).toBeGreaterThan(pupHits.at(-1).t);
  });

  it('T1–T2 call no pups', () => {
    const s = simulate(noCrit({ item: sword({ DAMAGE: 1e3 - 5 }) }, { target: sven('II', 40e3) }), { mode: 'kill' });
    expect(s.phases).toEqual([]);
  });
});

describe('Mage Outlaw phases', () => {
  const outlaw = { enemy: 'Mage Outlaw', maxHp: 70e6, mobs: ['Humanoid', 'Arcane'], boss: true };
  const run = (DAMAGE, seed = 1, opts = {}, extra = {}) =>
    simulate(noCrit({ item: sword({ DAMAGE, ...extra }) }, { target: outlaw }), { mode: 'kill', seed, ...opts });
  const specials = (s) => s.phases.filter((p) => p.kind === 'skulls' || p.kind === 'reflect');
  // Hits after a phase starts (the hit that set it off lands at its first instant).
  const hitIn = (s, a, b) => s.events.some((e) => !e.feroOnly && e.t > a + 1e-9 && e.t < b - 1e-9);

  it('a kill always takes 6 special phases, one per 10M lost', () => {
    for (const seed of [1, 2, 3]) {
      const s = run(500e3 - 5, seed);
      expect(s.killedAt).not.toBeNull();
      expect(specials(s)).toHaveLength(6);
    }
  });

  it('Damage Shield: Red Ring 3 s or Lightning Storm 8 s, then 2 s more, no hits', () => {
    const s = run(500e3 - 5);
    for (const p of s.phases.filter((x) => x.kind === 'reflect')) {
      expect(p.end - p.start).toBeCloseTo(p.detail === 'Red Ring' ? 5 : 10);
      expect(hitIn(s, p.start, p.end)).toBe(false);
    }
  });

  it('Summoned Skulls: 1 s to kill one, then the boss for the rest of the 8 s', () => {
    const seed = [1, 2, 3, 4, 5, 6].find((x) => specials(run(100e3 - 5, x)).some((p) => p.kind === 'skulls'));
    const s = run(100e3 - 5, seed);
    const p = s.phases.find((x) => x.kind === 'skulls');
    expect(p.end - p.start).toBeCloseTo(8);
    expect(hitIn(s, p.start, p.start + 1)).toBe(false);
    const after = s.events.filter((e) => !e.feroOnly && e.t >= p.start + 1 && e.t < p.end);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((e) => !e.target)).toBe(true); // all on the boss
  });

  it('the boss stays hittable after the crystal fades (11 s), until the next threshold', () => {
    const s = run(20e3 - 5);
    const crystal = s.phases.find((x) => x.kind === 'crystal');
    expect(crystal.end - crystal.start).toBeCloseTo(11);
    expect(s.events.some((e) => !e.target && e.t > crystal.end && e.t < specials(s)[0].start)).toBe(true);
  });

  it('the boss picks its phases the same way whatever the build', () => {
    const pick = (s) => specials(s).map((p) => p.detail || p.kind);
    expect(pick(run(500e3 - 5, 4))).toEqual(pick(run(800e3 - 5, 4, {}, { CRITICAL_CHANCE: 60, FEROCITY: 150 })));
  });

  it('shows every phase it can have', () => {
    expect(run(500e3 - 5).phaseKinds).toEqual(['crystal', 'skulls', 'reflect']);
  });
});

describe('Primordial Armor in the simulation', () => {
  it('every 3rd hit gets +50%', () => {
    const armor = ['HELMET', 'CHESTPLATE', 'LEGGINGS', 'BOOTS'].map((s) => ({ item: { id: `PRIMORDIAL_${s}`, name: s, category: s, tier: 'LEGENDARY', stats: {} } }));
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { armor }), { duration: 3 });
    expect(s.events.map((e) => e.hit)).toEqual([100, 100, 150, 100, 100, 150]);
  });
});

describe('Golem Toss in the simulation', () => {
  it('every 5th hit, at most once per 5 s', () => {
    const nums = { GOLEM: { LEGENDARY: { 1: { otherNums: [20], statNums: {} }, 100: { otherNums: [20], statNums: {} } } } };
    const pet = { id: 'GOLEM', name: 'Golem', rarity: 'LEGENDARY', level: 100, ...petNumbers(nums, 'GOLEM', 'LEGENDARY', 100),
      lore: cleanLore(['Toss', 'Every 5 hits, throw the enemy up into', 'the air and deal 5x damage (5s', 'cooldown)']) };
    const s = simulate(noCrit({ item: sword({ DAMAGE: 95 }) }, { pet }), { duration: 10 });
    // Hits every 0.5 s: hit 5 at 2 s tosses; hit 10 (4.5 s) is on cooldown; hit 15 (7 s) tosses.
    const tossed = s.events.filter((e) => e.hit === 500).map((e) => e.t);
    expect(tossed).toEqual([2, 7]);
  });
});

describe('Soulcry carried over to the Terminator', () => {
  it('a Vorpal Katana Soulcry adds 300 Ferocity to the Terminator shots', () => {
    const terminator = { id: 'TERMINATOR', name: 'Terminator', category: 'BOW', tier: 'LEGENDARY', stats: { DAMAGE: 310, ATTACK_SPEED: 40 } };
    const vorpal = { id: 'VORPAL_KATANA', name: 'Vorpal Katana', category: 'SWORD', tier: 'LEGENDARY', stats: { DAMAGE: 95 } };
    const target = { enemy: 'Voidgloom Seraph IV', maxHp: 1e12, mobs: ['Ender'], families: ['Enderman'], boss: true };
    const shots = (abilityOn) => simulate(noCrit({ item: vorpal, abilityOn }, { target, terminator }), { duration: 20 })
      .phases.find((p) => p.kind === 'shield').shots.length;
    expect(shots(false)).toBe(34); // 3 hits a shot
    expect(shots(true)).toBe(9); // 300 Ferocity: 4 hits an arrow, 12 a shot
  });
});

describe('Ferocity strikes past a phase line', () => {
  const run = (target, DAMAGE) => simulate(noCrit({ item: sword({ DAMAGE, FEROCITY: 400 }) }, { target }), { mode: 'kill' });
  // No damage to the boss itself once the phase has started, from strikes still on their way either.
  const bossDamageIn = (s, a, b) => s.events.filter((e) => e.tid === 'boss' && e.t > a + 1e-9 && e.t < b - 1e-6 && e.damage > 0);
  const cases = [
    ['Sven pups', { enemy: 'Sven Packmaster IV', maxHp: 2e6, mobs: ['Animal'], families: ['Wolf'], boss: true }, 1e5, ['pups'], (p) => p.end],
    ['Demonsplit', { enemy: 'Inferno Demonlord I', maxHp: 2.5e6, mobs: ['Infernal'], boss: true }, 5e4, ['split'], (p) => p.end],
    ['Web of Lies', { enemy: 'Tarantula Broodfather III', maxHp: 1e6, mobs: ['Arthropod'], boss: true }, 2e4, ['web'], (p) => p.end],
    ['Mage Outlaw specials', { enemy: 'Mage Outlaw', maxHp: 70e6, mobs: ['Humanoid', 'Arcane'], boss: true }, 1e6, ['reflect', 'skulls'],
      (p) => (p.kind === 'skulls' ? p.start + 1 : p.end)],
  ];
  for (const [name, target, dmg, kinds, until] of cases) {
    it(`${name}: absorbed once the phase starts`, () => {
      const s = run(target, dmg);
      const phases = s.phases.filter((p) => kinds.includes(p.kind));
      expect(phases.length).toBeGreaterThan(0);
      for (const p of phases) expect(bossDamageIn(s, p.start, until(p))).toEqual([]);
    });
  }
});

describe('Atoned Horror phases', () => {
  const atoned = { enemy: 'Atoned Horror', maxHp: 10e6, mobs: ['Undead'], boss: true };
  const run = (DAMAGE, opts) => simulate(noCrit({ item: sword({ DAMAGE }) }, { target: atoned }), { mode: 'kill', ...opts });

  it('Thermonuclear every 30 s: hits for 4.5 s of the countdown, then 2 s out of range', () => {
    const s = run(5e4);
    const booms = s.phases.filter((p) => p.kind === 'boom');
    expect(booms.map((p) => p.start)).toEqual([30, 60, 90]);
    for (const p of booms) {
      expect(p.end - p.start).toBeCloseTo(6.5);
      expect(s.events.some((e) => e.t >= p.start && e.t < p.start + 4.5)).toBe(true);
      expect(s.events.some((e) => e.t >= p.start + 4.5 && e.t < p.end - 1e-9)).toBe(false);
    }
  });

  it('natural regeneration: 1/1000 of max health a second between hits', () => {
    const s = run(5e4, { mode: 'duration', duration: 3 });
    for (let i = 1; i < s.events.length; i++) {
      const [a, b] = [s.events[i - 1], s.events[i]];
      expect(b.hp).toBeCloseTo(Math.min(10e6, a.hp + 10e6 / 1000 * (b.t - a.t)) - b.damage, 0);
    }
    expect(s.events.at(-1).hp).toBeGreaterThan(10e6 - s.total);
  });

  it('Clutch: stays in when the boss dies within the 5 s countdown', () => {
    const s = run(9e4);
    const m = s.mechanics.at(-1);
    expect(m).toMatchObject({ kind: 'boom', clutch: true });
    expect(s.killedAt).toBeLessThanOrEqual(m.land + 5);
    expect(s.phases.find((p) => p.kind === 'clutch').detail).toMatch(/^Thermonuclear lightning · /);
    expect(s.phaseKinds).toEqual(['boom', 'clutch']);
  });
});

describe('Revenant Horror phases', () => {
  const rev = (tier, maxHp) => ({ enemy: `Revenant Horror ${tier}`, maxHp, mobs: ['Undead'], boss: true });
  const run = (tier, maxHp, DAMAGE) => simulate(noCrit({ item: sword({ DAMAGE }) }, { target: rev(tier, maxHp) }), { mode: 'kill' });

  it('T3+: Mad at 40 s, Enraged 45–57 s, tanked: no time lost', () => {
    const s = run('IV', 1.5e6, 2e3);
    expect(s.phases.filter((p) => p.kind === 'enrage').map((p) => [p.start, p.end, p.detail]))
      .toEqual([[40, 45, 'Mad'], [45, 57, 'Enraged']]);
    expect(s.phaseKinds).toEqual(['enrage']);
    const gaps = s.events.filter((e) => !e.feroOnly).map((e, i, a) => (i ? e.t - a[i - 1].t : 0));
    expect(Math.max(...gaps)).toBeCloseTo(0.5);
  });

  it('no Enrage phase when the boss dies first; none below T3', () => {
    expect(run('IV', 1.5e6, 2e5).phases).toEqual([]);
    expect(run('II', 20000, 50).phaseKinds).toEqual([]);
  });

  it('despawns after 3 minutes: the quest fails', () => {
    const s = run('IV', 1.5e6, 100);
    expect(s.despawned).toBe(true);
    expect(s.seconds).toBe(180);
  });
});

describe('mechanic blocks', () => {
  it('every block an enemy has is a defined mechanic, and every row has a label', async () => {
    const { ENEMIES } = await import('./data/mechanics.js');
    const { MECHANICS, PHASE_ROWS, phaseKinds } = await import('./bossMechanics.js');
    for (const e of ENEMIES) {
      for (const b of e.blocks) expect(MECHANICS[b.kind], `${e.name}: ${b.kind}`).toBeDefined();
      for (const k of phaseKinds(e.blocks, { weapons: 2 })) expect(PHASE_ROWS[k]?.label, `${e.name}: ${k}`).toBeTruthy();
    }
  });

  it('a block can be shared: the same object on several enemies', async () => {
    const { ENEMIES, SLAYER_DESPAWN } = await import('./data/mechanics.js');
    expect(ENEMIES.filter((e) => e.blocks.includes(SLAYER_DESPAWN)).length).toBeGreaterThan(5);
  });
});
