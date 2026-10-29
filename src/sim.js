import { calculate } from './calc.js';
import {
  TICKS_PER_SECOND, FEROCITY_CAP, meleeHitTicks, shortbowTicks, BOW_DRAW_TICKS, SHORTBOWS,
  FABLED_MAX_BONUS, DOMINUS_GAIN_S, DOMINUS_MAX, DOMINUS_SWIPE_MULT,
} from './data/mechanics.js';

// Hits keep coming until the enemy dies; this stops "until dead" fights against huge HP pools.
export const SIM_MAX_SECONDS = 600;

// Small seeded RNG (mulberry32) so a run can be repeated.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulate a fight hit by hit. Each hit runs the single-hit calculation with that moment's state
 * (hit number, enemy HP, Dominus stacks, 4th / 10th hit bonuses), then rolls crits, Fabled and
 * Ferocity, adds Thunderlord / Thunderbolt lightning on every 3rd hit and Dominus swipes.
 *
 * opts: { mode: 'duration' | 'kill', duration (s), enemyHpPct, playerHpPct, godMode, seed }
 * Returns totals, a per-source breakdown and one event per hit, in time order:
 *   { t, hit, crit, ferocity (strikes), swipe (damage), bonuses: [names], damage, total, hp }
 */
export function simulate(input, opts = {}) {
  const mode = opts.mode === 'kill' ? 'kill' : 'duration';
  const duration = Math.max(0.05, opts.duration || 30);
  const random = rng(opts.seed ?? 1);
  const notes = [];

  // The player's health stays where it starts until a health system exists (god mode or not).
  const playerHpPct = Math.min(100, Math.max(1, opts.playerHpPct ?? 100));
  const player = { ...input.player, fullHealth: playerHpPct >= 100, lowHealth: playerHpPct < 20 };

  const base = calculate({ ...input, player: { ...player, hitNumber: 1 } });
  const maxHp = base.targetMaxHp || 0;
  let hpPct = Math.min(100, Math.max(0, opts.enemyHpPct ?? 100));
  let hp = maxHp * hpPct / 100;
  if (mode === 'kill' && !maxHp) {
    return { error: 'Set the target’s max HP (or pick an enemy) to simulate until it dies.' };
  }

  const bow = base.bow;
  const weaponId = input.weapon?.item?.id;
  const ticksPerHit = !bow ? meleeHitTicks(base.totals.ATTACK_SPEED || 0)
    : SHORTBOWS.includes(weaponId) ? shortbowTicks(base.totals.ATTACK_SPEED || 0) : BOW_DRAW_TICKS;
  const fabled = !bow && input.weapon?.reforge === 'fabled';
  const crimson = !bow && base.setStatus.find((s) => s.set.id === 'crimson' && s.count >= 2);
  const dominusEvery = crimson ? DOMINUS_GAIN_S[Math.min(crimson.count, 4)] : 0;
  const swipeMult = crimson ? DOMINUS_SWIPE_MULT[crimson.tier][Math.min(crimson.count, 4) - 2] : 0;

  // The single-hit result for a hit's state; most hits share one, so cache them.
  const cache = new Map();
  const hitResult = (n, stacks) => {
    const tenth = n % 10 === 0;
    const fourth = n % 4 === 0;
    const pct = maxHp ? Math.round(hpPct * 10) / 10 : hpPct;
    const key = `${Math.min(n, 4)}|${pct}|${stacks}|${tenth}|${fourth}`;
    let r = cache.get(key);
    if (!r) {
      r = calculate({
        ...input,
        player: { ...player, hitNumber: n },
        target: { ...input.target, hpPct: pct },
        accessoryInputs: { ...input.accessoryInputs, tenthHit: tenth },
        setInputs: { ...input.setInputs, crimson: { ...input.setInputs?.crimson, stacks }, tarantula: { ...input.setInputs?.tarantula, fourth } },
      });
      // Bonuses that only some hits get, for the action indicator.
      const labels = [...r.additive, ...r.multiplicative].map((b) => b.label);
      r.procs = [
        n <= 3 && labels.find((l) => /^(First Strike|Triple-Strike)/.test(l)),
        tenth && labels.find((l) => l.startsWith('Tarantula Talisman')) && 'Tarantula Talisman',
        fourth && labels.find((l) => l.includes('Octodexterity')) && 'Octodexterity',
      ].filter(Boolean).map((l) => l.replace(/ [IVX]+$/, ''));
      cache.set(key, r);
    }
    return r;
  };

  const out = { hits: 0, crits: 0, ferocity: 0, lightning: 0, swipes: 0, damage: { hits: 0, ferocity: 0, lightning: 0, swipes: 0 } };
  const events = [];
  const endTick = Math.round((mode === 'kill' ? SIM_MAX_SECONDS : duration) * TICKS_PER_SECOND);
  let total = 0;
  let stacks = 0;
  let lastStackTick = -Infinity;
  let killedAt = null;

  for (let tick = 0, n = 1; tick < endTick; tick += ticksPerHit, n++) {
    // Dominus: a melee hit gains a stack if the last one was long enough ago; at 10 stacks it swipes.
    let swipeReady = false;
    if (dominusEvery && tick - lastStackTick >= dominusEvery * TICKS_PER_SECOND) {
      swipeReady = stacks === DOMINUS_MAX;
      stacks = Math.min(DOMINUS_MAX, stacks + 1);
      lastStackTick = tick;
    }
    const r = hitResult(n, stacks);
    const bonuses = [...r.procs];
    const crit = random() * 100 < r.critChance;
    let dmg = crit ? r.crit : r.nonCrit;
    if (crit && fabled) {
      dmg = Math.floor(dmg * (1 + random() * FABLED_MAX_BONUS));
      bonuses.push('Fabled');
    }
    // Ferocity: each full 100 is an extra strike, the rest a chance at one more; strikes repeat the hit.
    const fero = Math.min(FEROCITY_CAP, Math.max(0, r.totals.FEROCITY || 0));
    const strikes = Math.floor(fero / 100) + (random() * 100 < fero % 100 ? 1 : 0);
    const bolt = r.lightningPct && n % 3 === 0 ? Math.floor(dmg * r.lightningPct / 100) : 0;
    if (bolt) bonuses.push('Lightning');
    // Swipe: the hit × Swipe Strength / its Additive Multiplier, doubled the first time it hits the enemy.
    const swipe = swipeReady ? Math.floor(dmg * swipeMult / r.additiveMult) * (out.swipes ? 1 : 2) : 0;

    out.hits++;
    if (crit) out.crits++;
    out.ferocity += strikes;
    if (bolt) out.lightning++;
    if (swipe) out.swipes++;
    out.damage.hits += dmg;
    out.damage.ferocity += dmg * strikes;
    out.damage.lightning += bolt;
    out.damage.swipes += swipe;
    const dealt = dmg * (1 + strikes) + bolt + swipe;
    total += dealt;
    if (maxHp) {
      hp = Math.max(0, hp - dealt);
      hpPct = hp / maxHp * 100;
    }
    const t = tick / TICKS_PER_SECOND;
    events.push({ t, hit: dmg, crit, ferocity: strikes, swipe, bonuses, damage: dealt, total, hp });
    if (maxHp && hp <= 0) { killedAt = t; break; }
  }

  const seconds = killedAt ?? (mode === 'kill' ? SIM_MAX_SECONDS : duration);
  if (mode === 'kill' && killedAt === null) notes.push(`The enemy was still alive after ${SIM_MAX_SECONDS / 60} minutes; the fight was stopped.`);
  if (bow && !SHORTBOWS.includes(weaponId)) notes.push('Bows are assumed fully drawn: one shot per second.');
  if (weaponId === 'TERMINATOR') notes.push('Terminator fires 3 arrows per shot; only one is counted.');
  if (crimson) notes.push('Dominus swipe timing is estimated: one swipe per stack gain while at 10 stacks.');
  if (input.target?.boss) notes.push('Boss damage caps are not modelled.');

  return {
    mode, seconds, killedAt, maxHp, startHp: maxHp * Math.min(100, Math.max(0, opts.enemyHpPct ?? 100)) / 100,
    endHp: hp, total, dps: seconds > 0 ? total / seconds : 0,
    hitsPerSecond: TICKS_PER_SECOND / ticksPerHit, ...out, events, notes,
  };
}
