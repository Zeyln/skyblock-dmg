import { describe, it, expect } from 'vitest';
import { makeClock, fromInstability } from './clock.js';
import { simulate } from './sim.js';

const sword = { item: { id: 'TEST_SWORD', name: 'Test', category: 'SWORD', tier: 'LEGENDARY', stats: { DAMAGE: 95 } } };
const noCrit = { weapon: sword, bonuses: [{ label: 'x', CRITICAL_CHANCE: -30 }] };

describe('clock', () => {
  it('at full speed, game time is real time', () => {
    const c = makeClock();
    expect(c.plain).toBe(true);
    expect(c.real(12.35)).toBe(12.35);
    expect(c.after(3, 1.5, 'real')).toBe(4.5);
    expect(makeClock({ serverInstability: 0, clientInstability: 0 }).plain).toBe(true);
  });

  it('a slow server stretches game time; real-time cooldowns stay real', () => {
    const c = makeClock({ tps: 10 });
    expect(c.real(5)).toBeCloseTo(10);
    expect(c.game(10)).toBeCloseTo(5);
    expect(c.after(2, 1, 'real')).toBeCloseTo(2.5); // 1 real second is half a game second
    expect(c.after(2, 1, 'tick')).toBe(3);
  });

  it('a varying TPS drifts around its average', () => {
    const c = makeClock({ tps: 15, tpsVar: 3, seed: 2 }, 300);
    const perSecond = Array.from({ length: 300 }, (_, s) => c.real(s + 1) - c.real(s));
    expect(new Set(perSecond.map((x) => x.toFixed(4))).size).toBeGreaterThan(20);
    const avgTps = 20 * 300 / c.real(300);
    expect(avgTps).toBeGreaterThan(13);
    expect(avgTps).toBeLessThan(17.5);
  });

  it('ping adds a round trip to the player’s actions, varying with jitter', () => {
    const c = makeClock({ ping: 200 });
    expect(c.plain).toBe(true);
    expect(c.action(1, 0.5)).toBeCloseTo(1.7);
    expect(c.action(1, 0.5, 1)).toBeCloseTo(2.7); // plus a second of in-game work
    const j = makeClock({ ping: 200, jitter: 60, seed: 4 });
    const delays = Array.from({ length: 200 }, () => j.action(0, 0));
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(0);
    expect(new Set(delays.map((x) => x.toFixed(3))).size).toBeGreaterThan(100);
    const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
    expect(avg).toBeGreaterThan(0.17);
    expect(avg).toBeLessThan(0.23);
  });

  it('lag spikes freeze the server: real time runs on, game time stops', () => {
    const c = makeClock({ lagEvery: 5, lagMs: 1000, seed: 3 }, 120);
    expect(c.freezes.length).toBeGreaterThan(5);
    const f = c.freezes[0];
    expect(f.d).toBeGreaterThanOrEqual(0.5);
    expect(f.d).toBeLessThanOrEqual(1.5);
    expect(c.real(f.g)).toBeCloseTo(c.real(f.g - 0.05) + 0.05 + f.d);
    expect(c.game(c.real(f.g) - f.d / 2)).toBeCloseTo(f.g); // inside the freeze
    for (const g of [0.3, 17.25, 80]) expect(c.game(c.real(g))).toBeCloseTo(g);
    // The same seed gives the same spikes.
    expect(makeClock({ lagEvery: 5, lagMs: 1000, seed: 3 }, 120).freezes).toEqual(c.freezes);
  });

  it('the sliders turn into settings that grow with them', () => {
    expect(fromInstability(0, 0)).toMatchObject({ tps: 20, tpsVar: 0, lagEvery: 0, ping: 0, jitter: 0, stutterEvery: 0 });
    const mid = fromInstability(50, 50);
    const max = fromInstability(100, 100);
    expect(max.tps).toBe(8);
    expect(mid.tps).toBeGreaterThan(max.tps);
    expect(mid.lagEvery).toBeGreaterThan(max.lagEvery);
    expect(max.lagMs).toBe(3000);
    expect(max.jitter).toBe(120);
    expect(max.ping).toBe(0); // the base ping is its own setting
    expect(fromInstability(0, 100, 80).ping).toBe(80);
    expect(makeClock({ serverInstability: 0, clientInstability: 0, ping: 150 }).rtt).toBeCloseTo(0.15);
  });
});

describe('simulation on an unstable connection', () => {
  it('half the TPS, half the hits in the same real time', () => {
    const full = simulate(noCrit, { duration: 10 });
    const slow = simulate(noCrit, { duration: 10, tps: 10 });
    expect(full.hits).toBe(20);
    expect(slow.hits).toBe(10);
    expect(slow.seconds).toBeCloseTo(10);
    expect(slow.dps).toBeCloseTo(full.dps / 2);
    expect(slow.events.at(-1).t).toBeCloseTo(9); // the 10th hit, at game time 4.5
  });

  it('lag spikes cost hits and add real time to a kill', () => {
    const target = { maxHp: 5000 };
    const smooth = simulate({ ...noCrit, target }, { mode: 'kill' });
    const laggy = simulate({ ...noCrit, target }, { mode: 'kill', lagEvery: 3, lagMs: 1500 });
    expect(laggy.hits).toBe(smooth.hits); // the same hits are needed
    expect(laggy.killedAt).toBeGreaterThan(smooth.killedAt + 1);
    expect(laggy.notes.some((n) => n.startsWith('Connection:'))).toBe(true);
  });

  it('the first hit lands a ping round trip after the spawn', () => {
    expect(simulate(noCrit, { duration: 2 }).events[0].t).toBe(0);
    const s = simulate(noCrit, { duration: 2, ping: 200 });
    expect(s.events[0].t).toBeCloseTo(0.2);
    expect(s.hits).toBe(4); // at 0.2, 0.7, 1.2 and 1.7 s
  });

  it('client stutter stops hits, while the server keeps time', () => {
    const smooth = simulate(noCrit, { duration: 30 });
    const stutter = simulate(noCrit, { duration: 30, stutterEvery: 2, stutterMs: 800, seed: 5 });
    expect(stutter.hits).toBeLessThan(smooth.hits);
    expect(stutter.seconds).toBe(30);
  });

  it('both sliders at 0 give the same fight as no settings', () => {
    const a = simulate(noCrit, { duration: 10 });
    const b = simulate(noCrit, { duration: 10, serverInstability: 0, clientInstability: 0 });
    expect(b.total).toBe(a.total);
    expect(b.events.map((e) => e.t)).toEqual(a.events.map((e) => e.t));
  });
});

describe('clicks and reaction time', () => {
  const fast = { ...noCrit, weapon: { item: { ...sword.item, stats: { DAMAGE: 95, ATTACK_SPEED: 100 } } } };
  it('melee hits wait for a click: fewer at 6.5 clicks a second than one in every tick', () => {
    const ideal = simulate(noCrit, { duration: 10 });
    const clicks = simulate(noCrit, { duration: 10, cps: 6.5 });
    expect(ideal.hits).toBe(20);
    expect(clicks.hits).toBeLessThan(20);
    expect(clicks.hits).toBeGreaterThan(15);
    // At max attack speed (a hit every 5 ticks) clicking is the limit: at most 6.5 a second.
    expect(simulate(fast, { duration: 10 }).hits).toBe(40);
    expect(simulate(fast, { duration: 10, cps: 6.5 }).hits).toBeLessThanOrEqual(66);
    expect(simulate(fast, { duration: 10, cps: 6.5 }).hits).toBeLessThan(40);
    // A click every tick or more is the same as the ideal.
    expect(simulate(fast, { duration: 10, cps: 20 }).hits).toBe(40);
  });

  it('a held right click casts every 4 ticks at most; spamming at the click rate', () => {
    const hype = { weapon: { item: { id: 'HYPERION', name: 'Hyperion', category: 'SWORD', tier: 'LEGENDARY', stats: { DAMAGE: 260, INTELLIGENCE: 50000 } }, attack: 'right' } };
    const ideal = simulate(hype, { duration: 3 });
    const held = simulate(hype, { duration: 3, cps: 6.5, rightClick: 'hold' });
    const spam = simulate(hype, { duration: 3, cps: 6.5 });
    expect(ideal.casts).toBe(20); // every 0.15 s
    expect(held.casts).toBeLessThanOrEqual(15); // every 0.2 s
    expect(held.casts).toBeGreaterThanOrEqual(14);
    expect(spam.casts).toBeLessThan(20); // some clicks land in the cooldown
    expect(spam.casts).toBeGreaterThanOrEqual(14);
  });

  it('clicks are a little uneven, around the clicks per second', () => {
    const c = makeClock({ cps: 8, seed: 3 }, 30);
    const ticks = [];
    for (let k = 0; k < 600; k = ticks.at(-1) + 1) ticks.push(c.clickTick(k, 'left'));
    const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
    expect(ticks.length).toBeGreaterThan(220); // about 8 a second over 30 s (two in one tick count once)
    expect(ticks.length).toBeLessThan(250);
    expect(new Set(gaps).size).toBeGreaterThan(2);
    // Held right clicks stay even: every 4 ticks.
    const h = makeClock({ cps: 8, rightClick: 'hold', seed: 3 }, 5);
    expect(h.clickTick(h.clickTick(10, 'right') + 1, 'right') - h.clickTick(10, 'right')).toBe(4);
  });

  it('reaction time and ping delay the first hit', () => {
    const s = simulate(noCrit, { duration: 2, ping: 100, reactionMs: 250 });
    expect(s.events[0].t).toBeCloseTo(0.35);
  });
});
