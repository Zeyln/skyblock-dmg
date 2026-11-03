// The results of a finished simulation (sim.js simulate()), for the results screen: what the fight
// came to, counted from its events and phases.

// Hits per weapon: the build's weapons (by event w), its ability's casts, then the Terminator's shots at
// Hitshields, the shortbow's at Web of Lies egg sacs, and hits on Fire Pillars. Each { name, count, unit, note }.
function hitsByWeapon(s) {
  const hits = s.events.filter((e) => !e.feroOnly && !e.ability);
  const names = s.weaponNames?.length ? s.weaponNames : ['No weapon'];
  const rows = names.map((name, w) => ({ name, count: hits.filter((e) => (e.w || 0) === w).length, unit: 'hits' }));
  const casts = s.events.filter((e) => e.cast).length;
  if (casts) {
    const ticks = s.events.filter((e) => e.dot).length;
    rows.push({ name: s.spellName, count: casts, unit: 'casts', ...(ticks ? { note: `and ${ticks} more seconds of its damage over time` } : {}) });
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
