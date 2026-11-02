import { calculate } from './calc.js';
import {
  TICKS_PER_SECOND, FEROCITY_CAP, meleeHitTicks, shortbowTicks, BOW_DRAW_TICKS, SHORTBOWS,
  FABLED_MAX_BONUS, DOMINUS_GAIN_S, DOMINUS_MAX, DOMINUS_SWIPE_MULT, HEAD_LOOK_S, HEAD_BATCH, TERMINATOR_MP, TERMINATOR_ARROWS,
  LEAP_AIM_S, WEB_SWAP_S, HELLION_ORDER, HELLION_SWITCH_HITS, HELLION_REDUCTION, DAGGER_SWAP_S,
  DAGGER_FAMILIES, daggerFamily, FEROCITY_DELAY_S, FEROCITY_GAP_S, WEAPON_ABILITIES, enemyBlocks,
} from './data/mechanics.js';
import { legacyBoss, phaseKinds, despawnSeconds, regenPerSecond, blockNotes } from './bossMechanics.js';

// Phase thresholds that stop damage to the boss: Hitshield and beams (Voidgloom), Call the Pups (Sven),
// Demonsplit (Demonlord), Web of Lies (Broodfather), the Mage Outlaw's 10M specials.
const GATES = new Set(['shield', 'laser', 'pups', 'split', 'web', 'outlaw']);

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
  let s = fight(input, opts, new Set());
  if (s.error) return s;
  // Clutches: the last wipe mechanic the player stopped for before the kill is left alone instead, if
  // the boss then dies before its timer runs out. Repeated while it works (the kill comes earlier,
  // so an earlier one may be clutched too). Same seed, so each rerun is the same fight up to there.
  while (s.killedAt !== null && !s.error) {
    const last = s.mechanics.filter((m) => !m.clutch).at(-1);
    if (!last) break;
    const next = fight(input, opts, new Set([...s.mechanics.filter((m) => m.clutch).map((m) => m.id), last.id]));
    if (next.killedAt === null || next.mechanics.some((m) => m.clutch && next.killedAt > m.deadline)) break;
    s = next;
  }
  for (const m of s.mechanics.filter((x) => x.clutch)) {
    const left = m.deadline - s.killedAt;
    s.phases.push({ kind: 'clutch', start: m.land, end: s.killedAt, detail: `${m.name} · ${left.toFixed(1)} s left` });
    s.notes.push(`Clutch: the boss died ${left.toFixed(1)} s before the ${m.name} would have wiped the fight, so it was left alone.`);
  }
  return s;
}

// One run of the fight. skip: the wipe mechanics (by id, e.g. glyph2) the player leaves alone.
function fight(input, opts, skip) {
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
  const startHp = hp;
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

  // Weapons the player swaps between: the main one, and a second Blaze Slayer dagger (input.weapon2).
  const weapons = [input.weapon, input.weapon2].filter((w) => w?.item);
  // The target being hit, when it isn't the boss itself (a demon): its max HP before Mayor Derpy and its HP %.
  let side = null;
  // The single-hit result for a hit's state; most hits share one, so cache them.
  const cache = new Map();
  const hitResult = (n, stacks, w = 0, toss = false) => {
    const tenth = n % 10 === 0;
    const fourth = n % 4 === 0;
    const third = n % 3 === 0; // Primordial Armor
    const pct = side ? Math.round(side.pct * 10) / 10 : maxHp ? Math.round(hpPct * 10) / 10 : hpPct;
    const key = `${Math.min(n, 4)}|${pct}|${stacks}|${tenth}|${fourth}|${third}|${broodOn}|${w}|${side?.maxHp}|${toss}`;
    let r = cache.get(key);
    if (!r) {
      const targetMax = side ? { maxHp: side.maxHp } : broodOn ? { maxHp: input.target.maxHp * boss.brood.hpMult } : {};
      r = calculate({
        ...input,
        weapon: weapons[w] || input.weapon,
        player: { ...player, hitNumber: n, toss },
        target: { ...input.target, hpPct: pct, ...targetMax },
        accessoryInputs: { ...input.accessoryInputs, tenthHit: tenth },
        setInputs: { ...input.setInputs, crimson: { ...input.setInputs?.crimson, stacks }, tarantula: { ...input.setInputs?.tarantula, fourth },
          primordial: { ...input.setInputs?.primordial, third } },
      });
      // Bonuses that only some hits get, for the action indicator.
      const labels = [...r.additive, ...r.multiplicative].map((b) => b.label);
      r.procs = [
        n <= 3 && labels.find((l) => /^(First Strike|Triple-Strike)/.test(l)),
        tenth && labels.find((l) => l.startsWith('Tarantula Talisman')) && 'Tarantula Talisman',
        (fourth || third) && labels.find((l) => l.includes('Octodexterity')) && 'Octodexterity',
        toss && labels.find((l) => l.includes('Toss')) && 'Toss',
      ].filter(Boolean).map((l) => l.replace(/ [IVX]+$/, ''));
      cache.set(key, r);
    }
    return r;
  };

  const out = { hits: 0, crits: 0, ferocity: 0, lightning: 0, swipes: 0, damage: { hits: 0, ferocity: 0, lightning: 0, swipes: 0 } };
  const events = [];
  // A hit's event, then one per Ferocity strike: the first FEROCITY_DELAY_S after the hit, the rest
  // FEROCITY_GAP_S apart. Strikes can land after the next hit, so once the fight is done the events
  // are put in time order and the damage total and each target's HP are counted along them (by
  // tid: which target, tidStart: its HP when first hit).
  const record = (ev, feroPart = 0) => {
    if (!ev.ferocity) { events.push(ev); return [ev]; }
    const from = events.length + 1;
    events.push({ ...ev, ferocity: 0, damage: ev.damage - feroPart });
    for (let k = 0; k < ev.ferocity; k++) {
      events.push({ t: ev.t + FEROCITY_DELAY_S + k * FEROCITY_GAP_S, feroOnly: true, hit: 0, crit: false, ferocity: 1, swipe: 0,
        bonuses: [], damage: feroPart / ev.ferocity, maxHp: ev.maxHp, target: ev.target, tid: ev.tid, tidStart: ev.tidStart,
        shielded: ev.shielded, sid: ev.sid });
    }
    return events.slice(from - 1); // the hit, then its strikes
  };
  const endTick = Math.round((mode === 'kill' ? SIM_MAX_SECONDS : duration) * TICKS_PER_SECOND);
  let total = 0;
  let stacks = 0;
  let lastStackTick = -Infinity;
  let killedAt = null;
  let lastToss = -Infinity;

  // Boss phases, from the enemy's mechanic blocks (data/bosses.js, bossMechanics.js): each is
  // { kind, start, end } in seconds, for the indicator. HP thresholds trigger in order as the boss's
  // HP falls past them.
  const blocks = maxHp ? enemyBlocks(input.target?.enemy) : [];
  const boss = legacyBoss(blocks);
  const despawnS = despawnSeconds(blocks);
  const regen = regenPerSecond(blocks);
  const phases = [];
  const startFrac = hp / maxHp;
  // Wipe timers (wipeTimer blocks): next is when the next one lands (null: not started yet). One that
  // starts below an HP fraction the fight already starts under runs from the start.
  const timers = blocks.filter((b) => b.kind === 'wipeTimer').map((b) => ({
    b, next: b.at != null ? b.at + b.delay : startFrac <= b.from ? b.delay : null,
  }));
  const triggers = boss ? [
    ...(boss.shield?.at || []).filter((f) => f < 1).map((f) => ({ f, kind: 'shield' })),
    ...(boss.lasers?.at || []).map((f) => ({ f, kind: 'laser' })),
    ...(boss.webs?.at || []).map((f) => ({ f, kind: 'web' })),
    ...(boss.split?.at || []).map((f) => ({ f, kind: 'split' })),
    ...(boss.pups ? [{ f: boss.pups.at, kind: 'pups' }] : []),
    ...(boss.outlaw ? Array.from({ length: boss.outlaw.steps - 1 }, (_, i) => ({ f: (i + 1) / boss.outlaw.steps, kind: 'outlaw' })) : []),
    ...timers.filter((x) => x.b.from != null).map((timer) => ({ f: timer.b.from, kind: 'timer', timer })),
    ...(boss.heads ? [{ f: boss.heads.from, kind: 'heads' }] : []),
  ].filter((x) => x.f < startFrac).sort((a, b) => b.f - a.f) : [];
  // Hitshields: hit down with the weapon, or (T4, or above TERMINATOR_MP) shot down with a Terminator,
  // during which there are no melee hits and the player does nothing else. Its fire rate and Ferocity
  // are the player's with the Terminator held (input.terminator: its item data, from the page; without
  // it, the build's own stats).
  const terminator = !!boss?.shield && (boss.tier === 4 || (input.magicalPower || 0) > TERMINATOR_MP);
  const termStats = terminator && input.terminator ? calculate({ ...input, weapon: { item: input.terminator } }).totals : base.totals;
  const termShot = shortbowTicks(termStats.ATTACK_SPEED || 0) / TICKS_PER_SECOND;
  // Soulcry cast on the katana just before the swap keeps its Ferocity on the Terminator (it lasts 4 s;
  // the Fandom wiki: "The extra Ferocity applies when switching to another weapon").
  const ability = WEAPON_ABILITIES[input.weapon?.item?.id];
  const soulcry = ability && input.weapon.abilityOn !== false && ability.families.some((f) => input.target?.families?.includes(f))
    ? ability.stats.FEROCITY || 0 : 0;
  const termFero = Math.min(FEROCITY_CAP, Math.max(0, (termStats.FEROCITY || 0) + (input.terminator ? soulcry : 0)));
  let shield = null;
  let shieldUntil = 0;
  // The boss's Ferocity strike events still on their way. They come off its health with their hit;
  // once a hit or strike crosses a phase threshold (GATES), the ones after it are absorbed: the boss
  // is shielded, immune, protected, split or gone by the time they land.
  let bossStrikes = [];
  let gateAt = 0;
  // cap (Voidgloom only): the damage that crosses it also stops at the line, so one hit can't jump
  // past the next phase ("the player's damage is capped at the amount of damage it would take to
  // activate the next phase", Apr 2024). Returns when the line is crossed: the hit's time, or the
  // strike's that crosses it.
  const absorbPast = (line, t, hitEv, cap) => {
    let at = hp + bossStrikes.reduce((sum, e) => sum + e.damage, 0); // after the hits alone
    let crossed = null;
    if (at <= line) {
      crossed = t;
      if (cap) {
        hitEv.damage -= line - at;
        out.damage.hits -= line - at;
        at = line;
      }
    }
    for (const e of bossStrikes) {
      if (crossed === null) {
        at -= e.damage;
        if (at <= line) {
          crossed = e.t;
          if (cap) {
            e.damage -= line - at;
            out.damage.ferocity -= line - at;
            at = line;
          }
        }
      } else {
        out.damage.ferocity -= e.damage;
        e.damage = 0;
      }
    }
    hp = Math.max(0, at);
    hpPct = hp / maxHp * 100;
    bossStrikes = [];
    return crossed ?? t;
  };
  const raiseShield = (t) => {
    const hits = boss.shield.hits;
    // By hand: each hit and each of its Ferocity strikes (landing one by one) takes a hit off; it
    // breaks at the one that takes the last (breakAt, once enough are on their way).
    if (!terminator) { shield = { hits, start: t, times: [], breakAt: null }; return; }
    // Shot by shot at the ground under the boss: 3 arrows, each explosion a hit, then its Ferocity
    // strikes one by one. Shooting stops once the strikes on their way break it before the next shot.
    const shots = [];
    const times = [];
    let at = t;
    let breakAt = Infinity;
    for (;;) {
      shots.push(at);
      for (let a = 0; a < TERMINATOR_ARROWS; a++) {
        times.push(at);
        const strikes = Math.floor(termFero / 100) + (random() * 100 < termFero % 100 ? 1 : 0);
        for (let k = 0; k < strikes; k++) times.push(at + FEROCITY_DELAY_S + k * FEROCITY_GAP_S);
      }
      times.sort((a, b) => a - b);
      if (times.length >= hits) breakAt = times[hits - 1];
      if (breakAt <= at + termShot) break;
      at += termShot;
    }
    shieldUntil = breakAt;
    // left: the hits left after each hit or strike, for the nametag.
    const left = times.slice(0, hits).map((x, i) => [x, hits - i - 1]);
    phases.push({ kind: 'shield', start: t, end: shieldUntil, shots, left });
    blocked.push([t, shieldUntil]);
    playerBusy.push([t, shieldUntil]);
  };
  const blocked = []; // [start, end) windows with no hits: laser immunity, glyphs, heads
  // The player's own pauses go one after another: a new one starts once any earlier one is over.
  const playerBusy = [];
  // Wipe mechanics as they land: { id, kind (its row), name, land, deadline, clutch }.
  const mechanics = [];
  const wipe = (b, land) => {
    const id = b.row + mechanics.filter((m) => m.kind === b.row).length;
    mechanics.push({ id, kind: b.row, name: b.name || b.label, land, deadline: land + b.wipe, clutch: skip.has(id) });
    return skip.has(id);
  };
  // How long the player spends dealing with one: fixed, random in [min, max], or reaching it and hitting it.
  const stopFor = ({ stop }) => (Array.isArray(stop) ? stop[0] + random() * (stop[1] - stop[0])
    : typeof stop === 'object' ? stop.reach + stop.hits * ticksPerHit / TICKS_PER_SECOND : stop);
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
  const despawnTick = despawnS ? despawnS * TICKS_PER_SECOND : Infinity;
  // Inferno Demonlord: the shield's attunement, the demons once split, fire pillars, and the
  // attunement the player is holding (a dagger swap or toggle costs DAGGER_SWAP_S).
  const derpy = input.target?.maxHp ? (base.targetMaxHp || 0) / input.target.maxHp : 1;
  let attune = 0;
  let attuneHits = 0;
  let demons = null; // { list: [{ name, attunes, at, hp }], active }
  let held = null;
  let hellion = null; // the open Hellion Shield phase (its detail names the attunement and dagger)
  const showHellion = (t, detail) => {
    if (hellion?.detail === detail) return;
    if (hellion) hellion.end = t;
    hellion = detail ? { kind: 'hellion', start: t, end: Infinity, detail } : null;
    if (hellion) phases.push(hellion);
  };
  // Demonsplit: one phase segment per damageable demon, so the indicator can name it.
  let splitPhase = null;
  const showSplit = (t, name) => {
    if (splitPhase) splitPhase.end = t;
    splitPhase = name ? { kind: 'split', start: t, end: Infinity, detail: name } : null;
    if (splitPhase) phases.push(splitPhase);
  };
  // Revenant Enrage: on a clock, and tanked, so only shown.
  if (boss?.enrage) {
    const { at, mad, enraged } = boss.enrage;
    phases.push({ kind: 'enrage', start: at, end: at + mad, detail: 'Mad' },
      { kind: 'enrage', start: at + mad, end: at + mad + enraged, detail: 'Enraged' });
  }
  // Natural regeneration: the boss heals between hits (bossMax a second × regen).
  const bossMax = base.targetMaxHp || 0;
  let regenAt = 0;
  const split = (t, f) => {
    // The boss's own HP stops at the threshold while its demons fight.
    hp = Math.max(hp, f * maxHp);
    hpPct = hp / maxHp * 100;
    const demonHp = boss.split.demonHp;
    demons = {
      active: 0,
      list: [{ name: 'Quazii', attunes: ['SPIRIT', 'CRYSTAL'] }, { name: 'Typhoeus', attunes: ['ASHEN', 'AURIC'] }]
        .map((d) => ({ ...d, at: 0, hits: 0, hp: demonHp * derpy, maxHp: demonHp * derpy })),
    };
    showSplit(t, 'Quazii');
  };
  // Sven Packmaster: pups arrive one by one while the boss is protected; it fights again once all
  // are dead. One phase segment per number killed, so the indicator can count them.
  let pups = null; // [{ at, hp, maxHp }]
  let pupPhase = null;
  const showPups = (t, detail) => {
    if (pupPhase) pupPhase.end = t;
    pupPhase = detail ? { kind: 'pups', start: t, end: Infinity, detail } : null;
    if (pupPhase) phases.push(pupPhase);
  };
  const callPups = (t, f) => {
    hp = Math.max(hp, f * maxHp);
    hpPct = hp / maxHp * 100;
    const { count, every, hpFrac } = boss.pups;
    pups = Array.from({ length: count }, (_, i) => ({ at: t + i * every, hp: maxHp * hpFrac, maxHp: maxHp * hpFrac }));
    showPups(t, `0 of ${count} pups killed`);
  };
  // Mage Outlaw (data/mechanics.js OUTLAW): crystal phases, with a random special phase each time
  // it loses another 1/7 of its health. Thresholds passed during a special phase wait for it to end.
  // The boss's picks use their own random sequence, so they don't change with the player's build.
  const bossRandom = rng(((opts.seed ?? 1) * 7919 + 13) >>> 0);
  const outlaw = boss?.outlaw ? { special: null, queued: 0, crystal: null } : null;
  const startCrystal = (t) => {
    outlaw.crystal = { kind: 'crystal', start: t, end: t + boss.outlaw.crystal };
    phases.push(outlaw.crystal);
  };
  const startShield = (t) => {
    const o = boss.outlaw;
    const [name, length] = o.shield.attacks[Math.floor(bossRandom() * o.shield.attacks.length)];
    outlaw.special = { end: t + length + o.shield.linger };
    phases.push({ kind: 'reflect', start: t, end: outlaw.special.end, detail: name });
    blocked.push([t, outlaw.special.end]); // the shield reflects damage, so the player doesn't hit
  };
  const startSpecial = (t) => {
    const o = boss.outlaw;
    if (outlaw.crystal) outlaw.crystal.end = Math.min(outlaw.crystal.end, t);
    outlaw.crystal = null;
    // Skulls, or a shield with one of its two attacks: three outcomes, equally likely.
    if (Math.floor(bossRandom() * 3) === 0) {
      // The boss is invulnerable until the player has killed a skull (o.skulls.kill seconds).
      outlaw.special = { end: t + o.skulls.window };
      phases.push({ kind: 'skulls', start: t, end: outlaw.special.end });
      blocked.push([t, t + o.skulls.kill]);
      playerBusy.push([t, t + o.skulls.kill]);
    } else startShield(t);
  };
  if (outlaw) startCrystal(0);
  const trigger = (kind, t, f, timer) => {
    if (kind === 'outlaw') {
      if (outlaw.special) outlaw.queued++;
      else startSpecial(t);
    } else
    // A Hitshield due while the beams are up starts once they end (wiki), with no glyphs meanwhile.
    if (kind === 'shield') raiseShield(phases.find((p) => p.kind === 'laser' && t >= p.start && t < p.end)?.end ?? t);
    else if (kind === 'split') split(t, f);
    else if (kind === 'pups') callPups(t, f);
    else if (kind === 'web') pause('web', t, WEB_SWAP_S + boss.webs.hits * sacShot);
    else if (kind === 'laser') {
      phases.push({ kind: 'laser', start: t, end: t + boss.lasers.immune });
      blocked.push([t, t + boss.lasers.immune]);
    } else if (kind === 'timer') timer.next = t + timer.b.delay;
    else if (kind === 'heads') nextHead = t;
  };

  for (let tick = 0, n = 1; tick < Math.min(endTick, despawnTick); n++) {
    const t = tick / TICKS_PER_SECOND;
    // Mage Outlaw: when a special phase ends, the next waiting one starts, else a crystal phase.
    while (outlaw?.special && t >= outlaw.special.end - 1e-9) {
      const end = outlaw.special.end;
      outlaw.special = null;
      if (outlaw.queued) {
        outlaw.queued--;
        startSpecial(end);
      } else startCrystal(end);
    }
    while (nextLeap !== null && t >= nextLeap) {
      pause('leap', nextLeap, LEAP_AIM_S);
      nextLeap += boss.leaps.every;
    }
    if (shield?.breakAt != null && t >= shield.breakAt) {
      phases.push({ kind: 'shield', start: shield.start, end: shield.breakAt });
      for (const x of timers) if (x.b.afterShield && x.next !== null && x.next < shield.breakAt) x.next = shield.breakAt + x.b.delay;
      shield = null;
    }
    // Wipe timers land: the player keeps hitting for hitFor, then deals with it (unless clutched).
    // One that waits for the Hitshield (afterShield) lands after it is down, plus its delay.
    for (const x of timers) {
      if (x.b.afterShield && x.next !== null && x.next < shieldUntil && t >= x.next) x.next = shieldUntil + x.b.delay;
      while (x.next !== null && t >= x.next && !(x.b.afterShield && shield)) {
        const stop = stopFor(x.b);
        if (!wipe(x.b, x.next)) pause(x.b.row, x.next + (x.b.hitFor || 0), stop, x.next);
        x.next += x.b.every;
      }
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
    // Inferno Demonlord: hit the damageable demon if split, else the boss; with the Hellion Shield,
    // use the dagger whose family takes its attunement (swapping or toggling first if needed).
    const demon = demons ? demons.list[demons.active] : null;
    const need = boss?.hellion ? (demon ? demon.attunes[demon.at] : HELLION_ORDER[attune]) : null;
    let w = 0;
    if (need) {
      const i = weapons.findIndex((x) => DAGGER_FAMILIES[daggerFamily(x.item.id)]?.attunes.includes(need));
      if (i >= 0) {
        w = i;
        if (held !== null && held !== need) {
          held = need;
          pause('swap', t, DAGGER_SWAP_S);
          n--;
          continue;
        }
        held = need;
      }
    }
    const matched = !need || DAGGER_FAMILIES[daggerFamily(weapons[w]?.item.id)]?.attunes.includes(need);
    if (boss?.hellion) {
      const att = need ? need[0] + need.slice(1).toLowerCase() : '';
      showHellion(t, `${att} · ${matched ? weapons[w].item.name : 'no matching dagger'}${demon ? ` · ${demon.name}` : ''}`);
    }
    // Sven's pups: hit the first one that has arrived; if none has yet, wait for the next.
    let pup = null;
    if (pups) {
      pup = pups.find((p) => p.hp > 0 && p.at <= t + 1e-9) || null;
      if (!pup) {
        const next = pups.find((p) => p.hp > 0);
        tick = Math.max(tick + 1, Math.ceil(next.at * TICKS_PER_SECOND - 1e-9));
        n--;
        continue;
      }
    }
    const add = demon || pup;
    side = add ? { maxHp: add.maxHp / derpy, pct: add.hp / add.maxHp * 100 } : null;

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
    // Golem pet Toss: every 5th hit, at most once per 5 s.
    const toss = input.pet?.id === 'GOLEM' && n % 5 === 0 && t - lastToss >= 5;
    if (toss) lastToss = t;
    const r = hitResult(n, stacks, w, toss);
    // The second dagger may swing at its own speed.
    const step = w && !bow ? meleeHitTicks(r.totals.ATTACK_SPEED || 0) : ticksPerHit;
    const bonuses = [...r.procs];
    const crit = random() * 100 < r.critChance;
    let dmg = crit ? r.crit : r.nonCrit;
    // Overload: a crit can be a Mega Critical Hit.
    if (crit && r.megaChance && random() * 100 < r.megaChance) {
      dmg = r.megaCrit;
      bonuses.push('Overload');
    }
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
      // The shield takes hits, not damage; hits until it breaks still count, even with strikes on their way.
      shield.times.push(t);
      for (let k = 0; k < strikes; k++) shield.times.push(t + FEROCITY_DELAY_S + k * FEROCITY_GAP_S);
      if (shield.times.length >= shield.hits) shield.breakAt = [...shield.times].sort((a, b) => a - b)[shield.hits - 1];
      record({ t, hit: 0, crit, ferocity: strikes, swipe: 0, bonuses: [], damage: 0, total, hp, shielded: true, sid: shield, tid: 'boss', tidStart: startHp }, 0);
      tick += ticksPerHit;
      continue;
    }

    const bolt = r.lightningPct && n % 3 === 0 ? Math.floor(dmg * r.lightningPct / 100) : 0;
    if (bolt) bonuses.push('Lightning');
    // Swipe: the hit × Swipe Strength / its Additive Multiplier, doubled the first time it hits the enemy.
    const swipe = swipeReady ? Math.floor(dmg * swipeMult / r.additiveMult) * (out.swipes ? 1 : 2) : 0;
    if (bolt) out.lightning++;
    if (swipe) out.swipes++;
    // Hellion Shield: an unmatched hit and every Ferocity strike lose 99%; enchant damage
    // (lightning, swipes) gets through in full.
    const shieldCut = (x) => Math.floor(x * (1 - HELLION_REDUCTION));
    const hitDmg = matched ? dmg : shieldCut(dmg);
    const feroDmg = need ? shieldCut(dmg) : dmg;
    out.damage.hits += hitDmg;
    out.damage.ferocity += feroDmg * strikes;
    out.damage.lightning += bolt;
    out.damage.swipes += swipe;
    const feroPart = feroDmg * strikes;
    const dealt = hitDmg + feroPart + bolt + swipe;
    total += dealt;
    if (demon) {
      demon.hp = Math.max(0, demon.hp - dealt);
      const other = demons.list[1 - demons.active];
      if (demon.hp <= 0) {
        // One demon down: the other is left, then the boss reforms.
        demons.list[demons.active] = null;
        if (other) {
          demons.active = 1 - demons.active;
          showSplit(t, other.name);
        } else {
          demons = null;
          showSplit(t, null);
        }
      } else if (need && matched && ++demon.hits >= HELLION_SWITCH_HITS) {
        // 8 matching hits: this demon's shield turns, and the other demon becomes the damageable one.
        demon.hits = 0;
        demon.at = 1 - demon.at;
        if (other) {
          demons.active = 1 - demons.active;
          showSplit(t, other.name);
        }
      }
      record({ t, hit: hitDmg, crit, ferocity: strikes, swipe, bonuses, damage: dealt, total, hp: demon.hp, maxHp: demon.maxHp, target: demon.name, tid: demon, tidStart: demon.maxHp }, feroPart);
      tick += step;
      continue;
    }
    if (pup) {
      pup.hp = Math.max(0, pup.hp - dealt);
      if (pup.hp <= 0) {
        const killed = pups.filter((p) => p.hp <= 0).length;
        if (killed === pups.length) {
          pups = null;
          showPups(t, null);
        } else showPups(t, `${killed} of ${pups.length} pups killed`);
      }
      record({ t, hit: hitDmg, crit, ferocity: strikes, swipe, bonuses, damage: dealt, total, hp: pup.hp, maxHp: pup.maxHp, target: 'Sven Pup', tid: pup, tidStart: pup.maxHp }, feroPart);
      tick += step;
      continue;
    }
    if (maxHp) {
      bossStrikes = bossStrikes.filter((e) => e.t > t);
      if (regen && !broodOn) hp = Math.min(maxHp, hp + regen * maxHp * (t - regenAt));
      regenAt = t;
      hp -= dealt; // below 0 is fine until the strikes are settled
    }
    if (need && matched && ++attuneHits >= HELLION_SWITCH_HITS) {
      attuneHits = 0;
      attune = (attune + 1) % HELLION_ORDER.length;
    }
    const struck = record({ t, hit: hitDmg, crit, ferocity: strikes, swipe, bonuses, damage: dealt, total, hp, maxHp,
      ...(broodOn ? { target: 'Conjoined Brood', tid: 'brood', tidStart: maxHp } : { tid: 'boss', tidStart: startHp }) }, feroPart);
    if (maxHp) {
      bossStrikes.push(...struck.slice(1));
      bossStrikes.sort((a, b) => a.t - b.t);
      // A phase starts at the hit or strike that crosses its line; later strikes are absorbed.
      const gate = !demons && !pups && triggers.find((x) => GATES.has(x.kind) && hp <= x.f * maxHp);
      gateAt = gate ? absorbPast(gate.f * maxHp, t, struck[0], gate.kind === 'shield' || gate.kind === 'laser') : t;
      hp = Math.max(0, hp);
      hpPct = hp / maxHp * 100;
    }
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
    if (maxHp && hp <= 0) {
      killedAt = t; // moved to the hit or strike that actually brings it to 0, below
      break;
    }
    while (!demons && !pups && triggers.length && hp <= triggers[0].f * maxHp) {
      const { kind, f, timer } = triggers.shift();
      trigger(kind, Math.max(t, gateAt), f, timer);
    }
    tick += step;
  }

  // Time order (strikes after later hits), then the running total and each target's HP along it. The
  // kill is the event that brings the last target to 0; anything after it never lands.
  events.sort((a, b) => a.t - b.t);
  const hpOf = new Map();
  const lastAt = new Map();
  const shieldHits = new Map();
  let running = 0;
  for (const e of events) {
    if (e.sid) {
      const left = (shieldHits.has(e.sid) ? shieldHits.get(e.sid) : e.sid.hits) - 1;
      shieldHits.set(e.sid, left);
      e.shieldLeft = Math.max(0, left);
      delete e.sid;
    }
    running += e.damage;
    e.total = running;
    let before = hpOf.has(e.tid) ? hpOf.get(e.tid) : e.tidStart;
    if (regen && e.tid === 'boss' && before > 0) before = Math.min(bossMax, before + regen * bossMax * (e.t - (lastAt.get(e.tid) ?? 0)));
    lastAt.set(e.tid, e.t);
    e.hp = Math.max(0, before - e.damage);
    hpOf.set(e.tid, e.hp);
  }
  const lastTid = broodOn ? 'brood' : 'boss';
  const fatal = killedAt === null ? -1 : events.findIndex((e) => e.tid === lastTid && e.hp <= 0);
  if (fatal >= 0) killedAt = events[fatal].t;

  const limit = mode === 'kill' ? SIM_MAX_SECONDS : duration;
  const despawned = killedAt === null && despawnS !== null && despawnS < limit;
  const seconds = killedAt ?? (despawned ? despawnS : limit);
  // Strikes still pending at the kill, the despawn or the end of the time never land.
  if (fatal >= 0) events.length = fatal + 1;
  else while (events.length && events.at(-1).t > seconds + 1e-9) events.pop();
  total = events.length ? events.at(-1).total : 0;
  const lastHp = [...events].reverse().find((e) => e.tid === lastTid);
  if (lastHp) hp = lastHp.hp;
  if (shield) phases.push({ kind: 'shield', start: shield.start, end: Math.min(shield.breakAt ?? seconds, seconds) });
  if (heads.length) phases.push({ kind: 'heads', start: heads[0], end: seconds });
  for (const p of phases) p.end = Math.min(p.end, seconds);
  for (let i = phases.length - 1; i >= 0; i--) if (phases[i].start >= seconds && phases[i].kind === 'enrage') phases.splice(i, 1); // never got to it
  if (despawned) notes.push(`The boss despawned after ${despawnS / 60} minutes: the Slayer quest failed.`);
  else if (mode === 'kill' && killedAt === null) notes.push(`The enemy was still alive after ${SIM_MAX_SECONDS / 60} minutes; the fight was stopped.`);
  if (bow && !SHORTBOWS.includes(weaponId)) notes.push('Bows are assumed fully drawn: one shot per second.');
  if (weaponId === 'TERMINATOR') notes.push('Terminator fires 3 arrows per shot; only one is counted.');
  if (crimson) notes.push('Dominus swipe timing is estimated: one swipe per stack gain while at 10 stacks.');
  if (terminator) notes.push(`Hitshields are shot down with a Terminator: ${TERMINATOR_ARROWS} explosive arrows into the ground under the boss every ${termShot} s, each explosion a hit plus its Ferocity strikes.`);
  if (boss?.shield) notes.push('Boss phases: Ferocity strikes are counted as Hitshield hits; a head every 6 s, looked at 0.5 s each once two are up.');
  for (const n of blockNotes(blocks)) notes.push(`Boss phases: ${n}.`);
  if (boss?.enrage) notes.push(`Boss phases: Enrage (Mad at ${boss.enrage.at} s, Enraged ${boss.enrage.mad} s later for ${boss.enrage.enraged} s) is tanked, so it costs no time.`);
  if (boss?.leaps) notes.push(`Boss phases: a Backstab leap every ${boss.leaps.every} s (assumed) costs ${LEAP_AIM_S * 1000} ms re-aiming${boss.webs ? `; Web of Lies costs ${WEB_SWAP_S} s to swap and re-engage plus ${boss.webs.hits} shortbow shots at the egg sacs` : ''}${boss.brood ? '; natural regeneration is not modelled' : ''}.`);
  if (boss?.split) {
    notes.push(`Boss phases: dagger swaps take ${DAGGER_SWAP_S * 1000} ms; fire pits and demon beams are dodged; despawn after 4 minutes is assumed.`);
    if (boss.hellion && weapons.length < 2) notes.push('Only one dagger: hits on the wrong attunement lose 99% of their damage.');
  }
  if (!boss && input.target?.boss) notes.push('Boss damage caps are not modelled.');

  return {
    mode, seconds, killedAt, despawned, maxHp: base.targetMaxHp || 0, startHp,
    endHp: hp, total, dps: seconds > 0 ? total / seconds : 0,
    hitsPerSecond: TICKS_PER_SECOND / ticksPerHit, ...out, events, phases, notes, mechanics,
    // Every phase this boss can have, whether or not this fight got to it (for the indicator).
    phaseKinds: phaseKinds(blocks, { weapons: weapons.length }),
  };
}
