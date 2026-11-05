// The results of a finished simulation (sim.js simulate()), for the results screen: what the fight
// came to, counted from its events and phases.

// Hits per weapon: the build's weapons (by event w), its ability's casts, then the Terminator's shots at
// Hitshields, the shortbow's at Web of Lies egg sacs, and hits on Fire Pillars. Each { name, count, unit, note }.
function hitsByWeapon(s) {
  const hits = s.events.filter((e) => !e.feroOnly && !e.ability && !e.fire);
  const names = s.weaponNames?.length ? s.weaponNames : ['No weapon'];
  const rows = names.map((name, w) => ({ name, count: hits.filter((e) => (e.w || 0) === w).length, unit: 'hits' }));
  const casts = s.events.filter((e) => e.cast).length;
  if (casts) {
    const ticks = s.events.filter((e) => e.dot).length;
    rows.push({ name: s.spellName, count: casts, unit: 'casts', ...(ticks ? { note: `and ${ticks} more seconds of its damage over time` } : {}) });
  }
  for (const [src, name, unit] of [['fire', 'Fire Aspect', 'burn ticks'], ['fist', 'Flaming Fist', 'burn ticks'], ['aura', 'Blazing Aura', 'ticks'], ['eye', 'Eye Beam', 'seconds']]) {
    const n = s.events.filter((e) => e.fire && (e.src || 'fire') === src).length;
    if (n) rows.push({ name, count: n, unit });
  }
  const phases = s.phases || [];
  const shots = phases.filter((p) => p.kind === 'shield' && p.shots).reduce((n, p) => n + p.shots.length, 0);
  if (shots) rows.push({ name: s.terminatorName || 'Terminator', count: shots, unit: 'shots', note: `${shots * 3} explosive arrows at Hitshields` });
  const sacs = phases.filter((p) => p.kind === 'web').reduce((n, p) => n + (p.shots || 0), 0);
  if (sacs) rows.push({ name: 'Shortbow', count: sacs, unit: 'shots', note: 'at Web of Lies egg sacs' });
  const pillar = phases.filter((p) => p.hits).reduce((n, p) => n + p.hits, 0);
  if (pillar) rows.push({ name: 'Fire Pillars', count: pillar, unit: 'hits', note: 'with the dagger in hand' });
  return rows.filter((r) => r.count);
}

// Every swap of weapon or item: dagger swaps, to the Terminator and back for each Hitshield it shoots,
// to the shortbow and back for each Web of Lies.
function swaps(s) {
  const phases = s.phases || [];
  return phases.filter((p) => p.kind === 'swap').length
    + 2 * phases.filter((p) => p.kind === 'shield' && p.shots).length
    + 2 * phases.filter((p) => p.kind === 'web').length;
}

// ---------- Several runs ----------
// The figures one run leaves for the batch (its events aren't kept), with its damage curve for the
// graph: [t, damage so far] at most CURVE_POINTS steps along the fight, ending at its end.
const CURVE_POINTS = 120;
function damageCurve(s) {
  const end = s.killedAt ?? s.seconds ?? 0;
  const out = [[0, 0]];
  const step = end / CURVE_POINTS || 1;
  let next = step;
  let last = 0;
  let lastT = 0;
  for (const e of s.events || []) {
    // A point at the last event before each step (a point on the curve itself).
    if (e.t > next && last !== out.at(-1)[1]) {
      out.push([Math.min(lastT, end), last]);
      next = e.t + step;
    }
    last = e.total;
    lastT = e.t;
  }
  out.push([end, s.total || last]);
  return out;
}
// phases: [kind, start, end] each, ended at the run's end at the latest (for the graph's bands).
export const runRecord = (s, seed) => ({
  seed, killedAt: s.killedAt, despawned: !!s.despawned, seconds: s.seconds, total: s.total, dps: s.dps, curve: damageCurve(s),
  phases: (s.phases || []).map((p) => [p.kind, p.start, Math.min(p.end, s.killedAt ?? s.seconds)]),
});

// Linear-interpolated percentile (p in 0–100) of a sorted list.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const x = (sorted.length - 1) * p / 100;
  const lo = Math.floor(x);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (x - lo);
}

// Average, median, spread (standard deviation), extremes, 5–95% range and outliers (outside 1.5 × the
// interquartile range, Tukey's rule) of values, each { value, seed }.
function spread(list) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a.value - b.value);
  const v = sorted.map((x) => x.value);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  const q1 = percentile(v, 25);
  const q3 = percentile(v, 75);
  const fence = 1.5 * (q3 - q1);
  return {
    count: v.length, mean, median: percentile(v, 50), sd, min: v[0], max: v.at(-1), p5: percentile(v, 5), p95: percentile(v, 95),
    outliers: sorted.filter((x) => x.value < q1 - fence || x.value > q3 + fence),
    lowSeed: sorted[0].seed, highSeed: sorted.at(-1).seed, medianSeed: sorted[Math.floor((sorted.length - 1) / 2)].seed,
  };
}

// A batch of runs (runRecord each) in a fight mode: how many killed, failed (despawned) or ran out of
// time, the time to kill over the kills (mode 'kill') or the damage dealt (fixed duration), and damage / s
// over every run. best / median / worst: the seeds to play back (fastest kill or most damage first).
export function summarizeRuns(runs, mode) {
  const killed = runs.filter((r) => r.killedAt !== null);
  const failed = runs.filter((r) => r.killedAt === null && r.despawned).length;
  const byTime = mode === 'kill' && killed.length;
  const main = byTime ? spread(killed.map((r) => ({ value: r.killedAt, seed: r.seed })))
    : spread(runs.map((r) => ({ value: r.total, seed: r.seed })));
  const dps = spread(runs.map((r) => ({ value: r.dps, seed: r.seed })));
  return {
    runs: runs.length, killed: killed.length, failed, alive: runs.length - killed.length - failed,
    metric: byTime ? 'time' : 'damage', main, dps,
    best: byTime ? main.lowSeed : main.highSeed, worst: byTime ? main.highSeed : main.lowSeed, median: main.medianSeed,
  };
}

export function summarize(s) {
  const events = s.events || [];
  // Hits that did damage (not those on a Hitshield).
  const landed = events.filter((e) => !e.feroOnly && !e.shielded && e.hit > 0);
  const bonusCounts = new Map();
  for (const e of events) for (const b of e.bonuses || []) bonusCounts.set(b, (bonusCounts.get(b) || 0) + 1);
  const terminatorStrikes = (s.phases || []).reduce((n, p) => n + (p.strikes || 0), 0);
  // The boss's own health (or the Conjoined Brood's), lowest as a share of its max.
  const bossEvents = events.filter((e) => e.tid === 'boss' || e.tid === 'brood');
  const lowestEnemyPct = !s.maxHp ? null
    : Math.min(s.startHp / s.maxHp, ...bossEvents.map((e) => e.hp / (e.maxHp || s.maxHp))) * 100;
  return {
    outcome: s.killedAt !== null ? 'killed' : s.despawned ? 'failed' : 'alive',
    timeToKill: s.killedAt,
    seconds: s.seconds,
    hitsByWeapon: hitsByWeapon(s),
    dps: s.dps,
    total: s.total,
    highestHit: landed.length ? Math.max(...landed.map((e) => e.hit)) : null,
    lowestHit: landed.length ? Math.min(...landed.map((e) => e.hit)) : null,
    ferocityProcs: events.filter((e) => e.feroOnly).length + terminatorStrikes,
    swipeProcs: events.filter((e) => e.swipe > 0).length,
    // Each bonus on its own, most often first.
    bonusProcs: [...bonusCounts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    // Only the stats that changed during the fight.
    statChanges: Object.entries(s.statRanges || {}).filter(([, [lo, hi]]) => Math.abs(hi - lo) > 1e-9)
      .map(([stat, [low, high]]) => ({ stat, low, high })),
    swaps: swaps(s),
    lowestEnemyPct: s.killedAt === null ? lowestEnemyPct : null,
    // The mana pool's lowest point, when the ability was cast.
    lowestMana: s.lowestMana ?? null,
    maxMana: s.maxMana,
    // Time the cast's cooldown was up but its mana wasn't (null when nothing was cast).
    manaWait: s.manaWaitSeconds ?? null,
  };
}
