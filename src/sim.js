import { calculate } from './calc.js';
import {
  TICKS_PER_SECOND, FEROCITY_CAP, meleeHitTicks, shortbowTicks, BOW_DRAW_TICKS, SHORTBOWS,
  FABLED_MAX_BONUS, DOMINUS_GAIN_S, DOMINUS_MAX, DOMINUS_SWIPE_MULT, GLYPH_BREAK_S, HEAD_LOOK_S, HEAD_BATCH, TERMINATOR_MP, TERMINATOR_SHIELD_S,
  LEAP_AIM_S, WEB_SWAP_S, bossPhases,
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
  let maxHp = base.targetMaxHp || 0; // changes when a second boss takes over (Conjoined Brood)
  let broodOn = false;
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
    const key = `${Math.min(n, 4)}|${pct}|${stacks}|${tenth}|${fourth}|${broodOn}`;
    let r = cache.get(key);
    if (!r) {
      r = calculate({
        ...input,
        player: { ...player, hitNumber: n },
        target: { ...input.target, hpPct: pct, ...(broodOn ? { maxHp: input.target.maxHp * boss.brood.hpMult } : {}) },
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

  // Boss phases (data/mechanics.js bossPhases): each is { kind, start, end } in seconds, for the
  // indicator. HP thresholds trigger in order as the boss's HP falls past them.
  const boss = maxHp ? bossPhases(input.target?.enemy) : null;
  const phases = [];
  const startFrac = hp / maxHp;
  const triggers = boss ? [
    ...(boss.shield?.at || []).filter((f) => f < 1).map((f) => ({ f, kind: 'shield' })),
    ...(boss.lasers?.at || []).map((f) => ({ f, kind: 'laser' })),
    ...(boss.webs?.at || []).map((f) => ({ f, kind: 'web' })),
    ...(boss.glyphs ? [{ f: boss.glyphs.from, kind: 'glyphs' }] : []),
    ...(boss.heads ? [{ f: boss.heads.from, kind: 'heads' }] : []),
  ].filter((x) => x.f < startFrac).sort((a, b) => b.f - a.f) : [];
  // Hitshields: hit down with the weapon, or (T4, or above TERMINATOR_MP) shot down with a Terminator
  // in a fixed time, during which there are no melee hits and the player does nothing else.
  const terminator = !!boss?.shield && (boss.tier === 4 || (input.magicalPower || 0) > TERMINATOR_MP);
  let shield = null;
  let shieldUntil = 0;
  const raiseShield = (t) => {
    if (!terminator) { shield = { left: boss.shield.hits, start: t }; return; }
    const [lo, hi] = TERMINATOR_SHIELD_S;
    shieldUntil = t + lo + random() * (hi - lo);
    phases.push({ kind: 'shield', start: t, end: shieldUntil });
    blocked.push([t, shieldUntil]);
    playerBusy.push([t, shieldUntil]);
  };
  let nextGlyph = boss?.glyphs && startFrac <= boss.glyphs.from ? boss.glyphs.hold : null;
  const blocked = []; // [start, end) windows with no hits: laser immunity, glyphs, heads
  // The player's own pauses go one after another: a new one starts once any earlier one is over.
  const playerBusy = [];
  const pause = (kind, start, length, phaseStart = start) => {
    for (const [s, e] of playerBusy) if (start >= s && start < e) start = e;
    playerBusy.push([start, start + length]);
    blocked.push([start, start + length]);
    phases.push({ kind, start: phaseStart, end: start + length });
  };
  let nextHead = null;
  let heads = []; // spawn times of heads still alive
  if (boss?.shield && startFrac >= 1) raiseShield(0);
  // Backstab leaps: the player re-aims for a moment after each.
  let nextLeap = boss?.leaps ? boss.leaps.every : null;
  // Web of Lies: swap to a shortbow and shoot the egg sacs (Piercing hits them all), no melee meanwhile.
  const sacShot = shortbowTicks(base.totals.ATTACK_SPEED || 0) / TICKS_PER_SECOND;
  const despawnTick = boss?.despawnS ? boss.despawnS * TICKS_PER_SECOND : Infinity;
  const trigger = (kind, t) => {
    if (kind === 'shield') raiseShield(t);
    else if (kind === 'web') pause('web', t, WEB_SWAP_S + boss.webs.hits * sacShot);
    else if (kind === 'laser') {
      const { vulnerable, immune } = boss.lasers;
      phases.push({ kind: 'laser', start: t, end: t + vulnerable + immune });
      blocked.push([t + vulnerable, t + vulnerable + immune]);
    } else if (kind === 'glyphs') nextGlyph = t + boss.glyphs.hold;
    else if (kind === 'heads') nextHead = t;
  };

  for (let tick = 0, n = 1; tick < Math.min(endTick, despawnTick); n++) {
    const t = tick / TICKS_PER_SECOND;
    while (nextLeap !== null && t >= nextLeap) {
      pause('leap', nextLeap, LEAP_AIM_S);
      nextLeap += boss.leaps.every;
    }
    // A glyph lands: the player stops to break it (never while the shield is up; it waits for the shield).
    // (A glyph due while a Terminator-broken shield is up waits for it, plus the hold.)
    if (nextGlyph !== null && nextGlyph < shieldUntil && t >= nextGlyph) nextGlyph = shieldUntil + boss.glyphs.hold;
    if (nextGlyph !== null && t >= nextGlyph && !shield) {
      pause('glyph', nextGlyph, GLYPH_BREAK_S[0] + random() * (GLYPH_BREAK_S[1] - GLYPH_BREAK_S[0]));
      nextGlyph += boss.glyphs.every;
    }
    // Heads spawn every few seconds; once HEAD_BATCH are up, the player looks at each in turn.
    // The indicator stays lit from the first head of a batch until the last one is gone.
    while (nextHead !== null && t >= nextHead) {
      heads.push(nextHead);
      if (heads.length >= HEAD_BATCH) {
        pause('heads', nextHead, heads.length * HEAD_LOOK_S, heads[0]);
        heads = [];
      }
      nextHead += boss.heads.every;
    }
    // (The tolerance keeps float sums like 57.85 + 0.2 from leaving a window open forever.)
    const wait = blocked.find(([s, e]) => t >= s && t < e - 1e-9);
    if (wait) {
      tick = Math.max(tick + 1, Math.ceil(wait[1] * TICKS_PER_SECOND - 1e-9));
      n--;
      continue;
    }

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
    let fero = Math.min(FEROCITY_CAP, Math.max(0, r.totals.FEROCITY || 0));
    if (boss?.feroDivisor && !shield) fero /= boss.feroDivisor;
    const strikes = Math.floor(fero / 100) + (random() * 100 < fero % 100 ? 1 : 0);

    out.hits++;
    if (crit) out.crits++;
    out.ferocity += strikes;
    if (shield) {
      // The shield takes hits, not damage.
      shield.left -= 1 + strikes;
      if (shield.left <= 0) {
        phases.push({ kind: 'shield', start: shield.start, end: t });
        shield = null;
        if (nextGlyph !== null && nextGlyph < t) nextGlyph = t + boss.glyphs.hold;
      }
      events.push({ t, hit: 0, crit, ferocity: strikes, swipe: 0, bonuses: [], damage: 0, total, hp, shielded: true });
      tick += ticksPerHit;
      continue;
    }

    const bolt = r.lightningPct && n % 3 === 0 ? Math.floor(dmg * r.lightningPct / 100) : 0;
    if (bolt) bonuses.push('Lightning');
    // Swipe: the hit × Swipe Strength / its Additive Multiplier, doubled the first time it hits the enemy.
    const swipe = swipeReady ? Math.floor(dmg * swipeMult / r.additiveMult) * (out.swipes ? 1 : 2) : 0;
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
    events.push({ t, hit: dmg, crit, ferocity: strikes, swipe, bonuses, damage: dealt, total, hp, maxHp });
    if (maxHp && hp <= 0 && boss?.brood && !broodOn) {
      // Till Death Do Us Part: the Conjoined Brood takes over with more health and only its passives.
      broodOn = true;
      maxHp *= boss.brood.hpMult;
      hp = maxHp;
      hpPct = 100;
      triggers.length = 0;
      phases.push({ kind: 'brood', start: t, end: Infinity });
      tick += ticksPerHit;
      continue;
    }
    if (maxHp && hp <= 0) { killedAt = t; break; }
    while (triggers.length && hp <= triggers[0].f * maxHp) trigger(triggers.shift().kind, t);
    tick += ticksPerHit;
  }

  const limit = mode === 'kill' ? SIM_MAX_SECONDS : duration;
  const despawned = killedAt === null && boss?.despawnS < limit;
  const seconds = killedAt ?? (despawned ? boss.despawnS : limit);
  if (shield) phases.push({ kind: 'shield', start: shield.start, end: seconds });
  if (heads.length) phases.push({ kind: 'heads', start: heads[0], end: seconds });
  for (const p of phases) p.end = Math.min(p.end, seconds);
  if (despawned) notes.push(`The boss despawned after ${boss.despawnS / 60} minutes: the Slayer quest failed.`);
  else if (mode === 'kill' && killedAt === null) notes.push(`The enemy was still alive after ${SIM_MAX_SECONDS / 60} minutes; the fight was stopped.`);
  if (bow && !SHORTBOWS.includes(weaponId)) notes.push('Bows are assumed fully drawn: one shot per second.');
  if (weaponId === 'TERMINATOR') notes.push('Terminator fires 3 arrows per shot; only one is counted.');
  if (crimson) notes.push('Dominus swipe timing is estimated: one swipe per stack gain while at 10 stacks.');
  if (terminator) notes.push(`Hitshields are broken with a Terminator (explosive arrows) in ${TERMINATOR_SHIELD_S.join('–')} s.`);
  if (boss?.shield) notes.push('Boss phases: Ferocity strikes are counted as Hitshield hits; glyphs every 8 s (unconfirmed for T3+), 0.5–0.75 s to break; a head every 6 s, looked at 0.5 s each once two are up.');
  if (boss?.leaps) notes.push(`Boss phases: a Backstab leap every ${boss.leaps.every} s (assumed) costs ${LEAP_AIM_S * 1000} ms re-aiming${boss.webs ? `; Web of Lies costs ${WEB_SWAP_S} s to swap and re-engage plus ${boss.webs.hits} shortbow shots at the egg sacs` : ''}${boss.brood ? '; natural regeneration is not modelled' : ''}.`);
  if (!boss && input.target?.boss) notes.push('Boss damage caps are not modelled.');

  return {
    mode, seconds, killedAt, despawned, maxHp: base.targetMaxHp || 0, startHp: maxHp * Math.min(100, Math.max(0, opts.enemyHpPct ?? 100)) / 100,
    endHp: hp, total, dps: seconds > 0 ? total / seconds : 0,
    hitsPerSecond: TICKS_PER_SECOND / ticksPerHit, ...out, events, phases, notes,
  };
}
