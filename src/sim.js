import { calculate } from './calc.js';
import {
  TICKS_PER_SECOND, FEROCITY_CAP, meleeHitTicks, shortbowTicks, BOW_DRAW_TICKS, SHORTBOWS,
  FABLED_MAX_BONUS, DOMINUS_GAIN_S, DOMINUS_MAX, DOMINUS_SWIPE_MULT, HEAD_LOOK_S, HEAD_BATCH, TERMINATOR_MP, TERMINATOR_ARROWS,
  LEAP_AIM_S, WEB_SWAP_S, HELLION_ORDER, HELLION_SWITCH_HITS, HELLION_REDUCTION,
  DAGGER_FAMILIES, daggerFamily, FEROCITY_DELAY_S, FEROCITY_GAP_S, WEAPON_ABILITIES, enemyBlocks,
} from './data/mechanics.js';
import { phaseKinds, despawnSeconds, regenPerSecond, blockNotes, hpLines, scheduledPhases } from './bossMechanics.js';
import { DUNGEON_HIT_MANA, EYE_BEAM } from './data/abilities.js';
import { makeClock, CLOCKS } from './clock.js';

// Hits keep coming until the enemy dies; this stops "until dead" fights against huge HP pools.
export const SIM_MAX_SECONDS = 600;
// Flaming Fist: each melee hit fires three fists of 10,000 fire damage, 1,000 a tick over 10 ticks (wiki,
// Flaming Fist, Nov 2026); two of the three stay where they spawn (a bug the wiki lists), so one reaches the
// target. Each hit's fist burns on its own, so they overlap.
export const FLAMING_FIST = { perTick: 1000, ticks: 10 };
// Static Charge (Thunder Armor, Thunderbolt Necklace): a charge every 30 s, at most 2, each +15% on the
// next hit (NEU lore); full at the start (assumed).
export const STATIC_CHARGE = { every: 30, max: 2, pct: 15 };

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
  // Game time (ticks) against real time: tickspeed, lag spikes and ping (clock.js). Everything below runs in
  // game seconds; real-time cooldowns and the player's actions go through the clock, and the results are
  // turned into real time at the end.
  const clock = makeClock(opts, mode === 'kill' ? SIM_MAX_SECONDS : duration);
  const toTick = (g) => (clock.plain ? Math.round(g * TICKS_PER_SECOND) : Math.ceil(g * TICKS_PER_SECOND - 1e-6));
  const notes = [];

  // The player's health stays where it starts until a health system exists (god mode or not).
  const playerHpPct = Math.min(100, Math.max(1, opts.playerHpPct ?? 100));
  const player = { ...input.player, hpPct: playerHpPct, fullHealth: playerHpPct >= 100, lowHealth: playerHpPct < 20 };

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

  // The weapon's right-click ability (input.weapon.attack: 'left' melee only, 'right' casts only, 'both'
  // casts whenever it's ready and affordable, with melee hits between): its hit, mana cost and cooldown.
  const attack = input.weapon?.attack || 'left';
  const spell = attack !== 'left' ? calculate({ ...input, damageType: 'magic', player: { ...player, hitNumber: 1 } }).ability : null;
  const casting = !!spell;
  const swinging = !casting || attack === 'both';
  // As fast as the game allows: once the cooldown is up (at least a tick apart). One that deals damage
  // over time is recast once the last has run out; its ticks land each second from the cast.
  const castEvery = casting ? Math.max(1, Math.round(spell.cooldown * TICKS_PER_SECOND), spell.over * TICKS_PER_SECOND) : 0;
  // Mana: full at the start, the regen (calc.js) back at each whole second; in dungeons a melee or bow hit
  // gives 5 + 1% of max, and Mana Steal its % on every hit.
  const maxMana = base.maxMana;
  let mana = maxMana;
  let manaSec = 0;
  let lowestMana = mana;
  // The windows spent waiting on mana: the cast's cooldown was up but its mana wasn't there yet.
  const manaWaits = [];
  let starvedFrom = null;
  const manaTo = (t) => {
    const secs = Math.floor(t + 1e-9) - manaSec;
    if (secs > 0) {
      mana = Math.min(maxMana, mana + secs * base.manaRegen);
      manaSec += secs;
    }
  };
  const hitMana = (base.inDungeon ? DUNGEON_HIT_MANA.flat + maxMana * DUNGEON_HIT_MANA.pct / 100 : 0) + maxMana * (base.manaSteal || 0) / 100;
  // The first click: the player sees the boss half a ping after it spawns, and the click reaches the
  // server half a ping later, so the first hit or cast lands a round trip in (ping 0: at the spawn).
  const firstTick = clock.rtt || clock.reaction ? Math.ceil(clock.action(0, 0) * TICKS_PER_SECOND - 1e-6) : 0;
  // Clicks (clock.js): melee hits wait for a left click, casts and shortbow shots for a right click; a
  // drawn bow fires on release, at its own pace.
  const swingSide = !bow ? 'left' : SHORTBOWS.includes(input.weapon?.item?.id) ? 'right' : null;
  const onClick = (k, side) => (side ? clock.clickTick(k, side) : k);
  // A right-click shot ready at game time g fires at the first tick with a click waiting (none modelled: at g).
  const shotAt = (g) => (clock.clicks ? onClick(Math.ceil(g * TICKS_PER_SECOND - 1e-6), 'right') / TICKS_PER_SECOND : g);
  // n shots at most gap game seconds apart, the first ready at g: when the last one's cooldown ends.
  const rightShots = (g, n, gap) => { for (let i = 0; i < n; i++) g = shotAt(g) + gap; return g; };
  let nextSwing = firstTick;
  let nextCast = firstTick;
  const dots = []; // ticks of damage over time still to land
  // Fire Aspect's burn on the boss: { dmg, until, next } (ticks). Each second it deals pct% of dmg, the
  // strongest hit since it was lit; a melee hit lights or refreshes it.
  const fireFx = !bow ? base.fire : null;
  let fire = null;
  // Rekindled Ember Armor: more burning damage, on Fire Aspect's burn and the Flaming Fist's.
  const burnMult = base.burnMult || 1;
  // Flaming Fist: the fists burning at each coming tick (tick -> count), and the next such tick.
  const fistOn = !bow && !!base.flamingFist;
  const fistAt = new Map();
  let fistNext = Infinity;
  const nextFist = () => (fistAt.size ? Math.min(...fistAt.keys()) : Infinity);
  let fistCount = 0;
  // Blazing Aura (Blaze or Frozen Blaze Armor): from the start, a tick each second on the target.
  const aura = base.auras?.[0] || null;
  let auraNext = aura ? TICKS_PER_SECOND : Infinity;
  // Static Charge: charges held, and the tick the next one comes.
  let charges = base.staticCharge ? STATIC_CHARGE.max : 0;
  let nextCharge = STATIC_CHARGE.every * TICKS_PER_SECOND;
  // Charges (Reaving Strike): casts held, and the tick the next comes back (one at a time, while short).
  const chargeDef = spell?.charges || null;
  let chargesLeft = chargeDef ? chargeDef.max : 0;
  let chargeAt = Infinity;
  const refill = (tick) => {
    while (chargeDef && tick >= chargeAt) {
      chargesLeft++;
      chargeAt = chargesLeft < chargeDef.max ? chargeAt + chargeDef.every * TICKS_PER_SECOND : Infinity;
    }
  };
  // Precursor Eye's Eye Beam: on from the first tick, a tick of damage each second while the mana lasts.
  // Short of mana it goes off, and comes back on (from its first second) once there's enough.
  const eyeOn = (input.armor || []).some((p) => (p?.item?.id || '').replace(/^STARRED_/, '') === 'PRECURSOR_EYE');
  const eye = eyeOn ? calculate({ ...input, damageType: 'eyebeam', player: { ...player, hitNumber: 1 } }).ability : null;
  let eyeNext = eye ? firstTick : Infinity;
  let eyeSec = 0;
  // Last Breath stacks by hit number, so hit results are told apart up to its last stack.
  const hitKeyCap = (input.weapon?.item?.id || '').replace(/^STARRED_/, '') === 'LAST_BREATH' ? 6 : 4;
  // A cost that climbs with each cast (Jerry-chine Gun) until manaReset passes without one.
  let streak = 0;
  let lastCast = -Infinity;
  const resetTick = () => (clock.plain ? lastCast + (spell.manaReset || 0) * TICKS_PER_SECOND
    : toTick(clock.after(lastCast / TICKS_PER_SECOND, spell.manaReset || 0, CLOCKS.manaReset)));
  const costAt = (tick) => spell.manaCost + (spell.manaStep && tick < resetTick() ? spell.manaStep * streak : 0);
  // When the next cast can go off: its cooldown is up and there's the mana (regen comes each whole second).
  // A climbing cost may be cheaper to wait out until it resets.
  const castReady = () => {
    if (chargeDef) return chargesLeft > 0 ? nextCast : Math.max(nextCast, chargeAt);
    const cost = costAt(nextCast);
    if (mana >= cost - 1e-9) return nextCast;
    const enough = (c) => (manaSec + Math.ceil((c - mana) / base.manaRegen - 1e-9)) * TICKS_PER_SECOND;
    let at = enough(cost);
    if (spell.manaStep && streak && at >= resetTick()) at = Math.max(resetTick(), enough(spell.manaCost));
    return Math.max(nextCast, at);
  };
  // The next tick something is due (never before now).
  const wake = (tick) => Math.max(tick, Math.min(swinging ? onClick(Math.max(nextSwing, tick), swingSide) : Infinity,
    casting ? onClick(Math.max(castReady(), tick), 'right') : Infinity,
    casting && nextCast > tick ? nextCast : Infinity, dots.length ? dots[0] : Infinity, fire ? fire.next : Infinity,
    fistNext, auraNext, eyeNext));

  // Weapons the player swaps between: the main one, and a second Blaze Slayer dagger (input.weapon2).
  const weapons = [input.weapon, input.weapon2].filter((w) => w?.item);
  // The target being hit, when it isn't the boss itself (a demon): its max HP before Mayor Derpy and its HP %.
  let side = null;
  // The single-hit result for a hit's state; most hits share one, so cache them.
  const cache = new Map();
  // magic: the weapon's ability instead (a cast or a tick of its damage over time), which counts no hits.
  const hitResult = (n, stacks, w = 0, toss = false, magic = false) => {
    const tenth = !magic && n % 10 === 0;
    const fourth = !magic && n % 4 === 0;
    const third = !magic && n % 3 === 0; // Primordial Armor
    const pct = side ? Math.round(side.pct * 10) / 10 : maxHp ? Math.round(hpPct * 10) / 10 : hpPct;
    const key = `${Math.min(n, hitKeyCap)}|${pct}|${stacks}|${tenth}|${fourth}|${third}|${broodOn}|${w}|${side?.maxHp}|${toss}|${magic}`;
    let r = cache.get(key);
    if (!r) {
      const targetMax = side ? { maxHp: side.maxHp } : broodOn ? { maxHp: input.target.maxHp * broodB.hpMult } : {};
      r = calculate({
        ...input,
        ...(magic ? { damageType: 'magic' } : {}),
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

  const out = { hits: 0, crits: 0, ferocity: 0, lightning: 0, swipes: 0, casts: 0, dotTicks: 0, fireTicks: 0, fistTicks: 0, auraTicks: 0,
    eyeTicks: 0, discharges: 0, damage: { hits: 0, ferocity: 0, lightning: 0, swipes: 0, ability: 0, fire: 0, fist: 0, aura: 0, eye: 0 } };
  // The player's stats over the fight, as [low, high] by stat: those of every hit and Terminator shot.
  const statRanges = {};
  const trackStats = (totals) => {
    for (const [k, v] of Object.entries(totals)) {
      if (typeof v !== 'number') continue;
      const r = statRanges[k] || (statRanges[k] = [v, v]);
      r[0] = Math.min(r[0], v);
      r[1] = Math.max(r[1], v);
    }
  };
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
      events.push({ t: ev.t + FEROCITY_DELAY_S + k * FEROCITY_GAP_S, feroOnly: true, w: ev.w, hit: 0, crit: false, ferocity: 1, swipe: 0,
        bonuses: [], damage: feroPart / ev.ferocity, maxHp: ev.maxHp, target: ev.target, tid: ev.tid, tidStart: ev.tidStart,
        shielded: ev.shielded, sid: ev.sid });
    }
    return events.slice(from - 1); // the hit, then its strikes
  };
  const endTick = Math.round(clock.game(mode === 'kill' ? SIM_MAX_SECONDS : duration) * TICKS_PER_SECOND);
  let total = 0;
  let stacks = 0;
  let lastStackTick = -Infinity;
  let killedAt = null;
  let lastToss = -Infinity;

  // Boss phases, from the enemy's mechanic blocks (data/bosses.js, bossMechanics.js): each is
  // { kind, start, end } in seconds, for the indicator. HP thresholds trigger in order as the boss's
  // HP falls past them.
  const blocks = maxHp ? enemyBlocks(input.target?.enemy) : [];
  const despawnS = despawnSeconds(blocks);
  const blk = (kind) => blocks.find((b) => b.kind === kind) || null;
  const shieldB = blk('hitshield');
  const splitB = blk('demonsplit');
  const pupsB = blk('callThePups');
  const outlawB = blk('outlawSpecials');
  const headsB = blk('nukekubiHeads');
  const backstabB = blk('backstab');
  const broodB = blk('conjoinedBrood');
  const hellionB = blk('hellionShield');
  const swapS = blk('daggerSwaps')?.seconds || 0;
  const regen = regenPerSecond(blocks);
  const phases = [];
  const startFrac = hp / maxHp;
  // Wipe timers (wipeTimer blocks): next is when the next one lands (null: not started yet). One that
  // starts below an HP fraction the fight already starts under runs from the start.
  const timers = blocks.filter((b) => b.kind === 'wipeTimer').map((b) => ({
    b, next: b.at != null ? b.at + b.delay : startFrac <= b.from ? b.delay : null,
  }));
  // The HP lines the mechanics act at (each definition's lines), highest first.
  const triggers = hpLines(blocks).filter((x) => x.f < startFrac).sort((a, b) => b.f - a.f);
  // Hitshields: hit down with the weapon, or (T4, or above TERMINATOR_MP) shot down with a Terminator,
  // during which there are no melee hits and the player does nothing else. Its fire rate and Ferocity
  // are the player's with the Terminator held (input.terminator: its item data, from the page; without
  // it, the build's own stats).
  const terminator = !!shieldB && (!!shieldB.terminator || (input.magicalPower || 0) > TERMINATOR_MP);
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
  // once a hit or strike crosses a phase line (a gate), the ones after it are absorbed: the boss
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
        out.damage[hitEv.ability ? 'ability' : 'hits'] -= line - at;
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
    const hits = shieldB.hits;
    // By hand: each hit and each of its Ferocity strikes (landing one by one) takes a hit off; it
    // breaks at the one that takes the last (breakAt, once enough are on their way).
    if (!terminator) { shield = { hits, start: t, times: [], breakAt: null }; return; }
    // Shot by shot at the ground under the boss: 3 arrows, each explosion a hit, then its Ferocity
    // strikes one by one. Shooting stops once the strikes on their way break it before the next shot.
    const shots = [];
    const times = [];
    let at = clock.action(t, 0); // the player sees the shield, then starts shooting
    let breakAt = Infinity;
    let rolled = 0; // Ferocity strikes from the explosions
    trackStats({ ...termStats, FEROCITY: termFero });
    for (;;) {
      at = shotAt(at); // each shot waits for a right click
      shots.push(at);
      for (let a = 0; a < TERMINATOR_ARROWS; a++) {
        times.push(at);
        const strikes = Math.floor(termFero / 100) + (random() * 100 < termFero % 100 ? 1 : 0);
        rolled += strikes;
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
    phases.push({ kind: 'shield', start: t, end: shieldUntil, shots, left, strikes: rolled });
    blocked.push([t, shieldUntil]);
    playerBusy.push([t, shieldUntil]);
  };
  const blocked = []; // [start, end) windows with no hits: laser immunity, glyphs, heads
  const immune = []; // [start, end) windows the boss takes no damage in (damage over time is lost)
  // The player's own pauses go one after another: a new one starts once any earlier one is over.
  const playerBusy = [];
  // Client stutter (clock.js): no clicks reach the server until half a ping after the client is back.
  // The server runs on meanwhile, so damage over time and Ferocity strikes still land.
  // (With clicks modelled, stutter just means no clicks; clock.js handles it.)
  if (!clock.clicks) for (const [a, b] of clock.stutters) blocked.push([clock.game(a), clock.game(b + clock.rtt / 2)]);
  // Wipe mechanics as they land: { id, kind (its row), name, land, deadline, clutch }.
  const mechanics = [];
  const wipe = (b, land) => {
    const id = b.row + mechanics.filter((m) => m.kind === b.row).length;
    mechanics.push({ id, kind: b.row, name: b.name || b.label, land, deadline: land + b.wipe, clutch: skip.has(id) });
    return skip.has(id);
  };
  // How long the player spends dealing with one: fixed, random in [min, max], or reaching it and hitting it.
  // human: real seconds (moving, aiming); ticks: game seconds of in-game work (hits on it).
  const stopFor = ({ stop }) => (Array.isArray(stop) ? { human: stop[0] + random() * (stop[1] - stop[0]), ticks: 0 }
    : typeof stop === 'object' ? { human: stop.reach, ticks: stop.hits * ticksPerHit / TICKS_PER_SECOND } : { human: stop, ticks: 0 });
  // A player action: human real seconds (plus the ping round trip, clock.js), then ticks of in-game work.
  // shots: { n, gap }, right-click shots in place of ticks, each waiting for a click.
  const pause = (kind, start, human, phaseStart = start, ticks = 0, shots = null) => {
    for (const [s, e] of playerBusy) if (start >= s && start < e) start = e;
    const end = shots && clock.clicks ? rightShots(clock.action(start, human), shots.n, shots.gap) : clock.action(start, human, ticks);
    playerBusy.push([start, end]);
    blocked.push([start, end]);
    const phase = { kind, start: phaseStart, end };
    phases.push(phase);
    return phase;
  };
  let nextHead = null;
  let heads = []; // spawn times of heads still alive
  if (shieldB?.at.includes(1) && startFrac >= 1) raiseShield(0);
  // Backstab leaps: the player re-aims for a moment after each.
  let nextLeap = backstabB ? backstabB.every : null;
  // Web of Lies: swap to a shortbow and shoot the egg sacs (Piercing hits them all), no melee meanwhile.
  const sacShot = shortbowTicks(base.totals.ATTACK_SPEED || 0) / TICKS_PER_SECOND;
  const despawnTick = despawnS ? despawnS * TICKS_PER_SECOND : Infinity;
  // Inferno Demonlord: the shield's attunement, the demons once split, fire pillars, and the
  // attunement the player is holding (a dagger swap or toggle costs swapS).
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
  // Phases on a fixed clock (Revenant Enrage).
  const scheduled = scheduledPhases(blocks);
  phases.push(...scheduled);
  // Natural regeneration: the boss heals between hits (bossMax a second × regen).
  const bossMax = base.targetMaxHp || 0;
  let regenAt = 0;
  const split = (t, f) => {
    // The boss's own HP stops at the threshold while its demons fight.
    hp = Math.max(hp, f * maxHp);
    hpPct = hp / maxHp * 100;
    const demonHp = splitB.demonHp;
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
    const { count, every, hpFrac } = pupsB;
    pups = Array.from({ length: count }, (_, i) => ({ at: t + i * every, hp: maxHp * hpFrac, maxHp: maxHp * hpFrac }));
    showPups(t, `0 of ${count} pups killed`);
  };
  // Mage Outlaw (data/mechanics.js OUTLAW): crystal phases, with a random special phase each time
  // it loses another 1/7 of its health. Thresholds passed during a special phase wait for it to end.
  // The boss's picks use their own random sequence, so they don't change with the player's build.
  const bossRandom = rng(((opts.seed ?? 1) * 7919 + 13) >>> 0);
  const outlaw = outlawB ? { special: null, queued: 0, crystal: null } : null;
  const startCrystal = (t) => {
    outlaw.crystal = { kind: 'crystal', start: t, end: t + outlawB.crystal };
    phases.push(outlaw.crystal);
  };
  const startShield = (t) => {
    const o = outlawB;
    const [name, length] = o.shield.attacks[Math.floor(bossRandom() * o.shield.attacks.length)];
    outlaw.special = { end: t + length + o.shield.linger };
    phases.push({ kind: 'reflect', start: t, end: outlaw.special.end, detail: name });
    blocked.push([t, outlaw.special.end]); // the shield reflects damage, so the player doesn't hit
    immune.push([t, outlaw.special.end]);
  };
  const startSpecial = (t) => {
    const o = outlawB;
    if (outlaw.crystal) outlaw.crystal.end = Math.min(outlaw.crystal.end, t);
    outlaw.crystal = null;
    // Skulls, or a shield with one of its two attacks: three outcomes, equally likely.
    if (Math.floor(bossRandom() * 3) === 0) {
      // The boss is invulnerable until the player has killed a skull (o.skulls.kill seconds).
      outlaw.special = { end: t + o.skulls.window };
      phases.push({ kind: 'skulls', start: t, end: outlaw.special.end });
      blocked.push([t, t + o.skulls.kill]);
      immune.push([t, t + o.skulls.kill]);
      playerBusy.push([t, t + o.skulls.kill]);
    } else startShield(t);
  };
  if (outlaw) startCrystal(0);
  // What each mechanic does when the boss's health falls past one of its lines, by block kind.
  const ON_LINE = {
    outlawSpecials: (t) => {
      if (outlaw.special) outlaw.queued++;
      else startSpecial(t);
    },
    // A Hitshield due while the beams are up starts once they end (wiki), with no glyphs meanwhile.
    hitshield: (t) => raiseShield(phases.find((p) => p.kind === 'laser' && t >= p.start && t < p.end)?.end ?? t),
    demonsplit: split,
    callThePups: callPups,
    webOfLies: (t, f, b) => { pause('web', t, WEB_SWAP_S, t, b.hits * sacShot, { n: b.hits, gap: sacShot }).shots = b.hits; },
    beams: (t, f, b) => {
      phases.push({ kind: 'laser', start: t, end: t + b.immune });
      blocked.push([t, t + b.immune]);
      immune.push([t, t + b.immune]);
    },
    wipeTimer: (t, f, b) => { timers.find((x) => x.b === b).next = t + b.delay; },
    nukekubiHeads: (t) => { nextHead = t; },
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
      nextLeap += backstabB.every;
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
        if (!wipe(x.b, x.next)) {
          const p = pause(x.b.row, x.next + (x.b.hitFor || 0), stop.human, x.next, stop.ticks);
          if (x.b.stop?.hits) p.hits = x.b.stop.hits; // hits on it (a Fire Pillar)
        }
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
      nextHead += headsB.every;
    }
    // What happens now: a tick of damage over time lands (it isn't the player's action), a cast goes
    // off, or a melee hit; with nothing due yet, wait for the next.
    manaTo(t);
    if (casting) {
      const short = mana < costAt(tick) - 1e-9;
      if (starvedFrom === null && tick >= nextCast && short) starvedFrom = t;
      else if (starvedFrom !== null && !short) {
        manaWaits.push([starvedFrom, t]);
        starvedFrom = null;
      }
    }
    const action = dots.length && dots[0] <= tick ? 'dot'
      : fire && fire.next <= tick ? 'fire'
      : fistNext <= tick ? 'fist'
      : auraNext <= tick ? 'aura'
      : eyeNext <= tick ? 'eye'
      : casting && tick >= castReady() && tick >= onClick(tick, 'right') ? 'cast'
        : swinging && tick >= nextSwing && tick >= onClick(tick, swingSide) ? 'swing' : null;
    if (!action) {
      tick = Math.max(tick + 1, wake(tick));
      n--;
      continue;
    }
    // A Fire Aspect, Flaming Fist or Blazing Aura tick: the burn moves on to its next second (or runs out).
    // None lands while the boss can't be hurt by it: behind a Hitshield, split into demons, or with pups
    // to kill first.
    let burn = 0;
    const periodic = action === 'fire' || action === 'fist' || action === 'aura' || action === 'eye';
    if (action === 'fire') {
      burn = fire.dmg;
      fire.next += TICKS_PER_SECOND;
      if (fire.next > fire.until) fire = null;
    } else if (action === 'fist') {
      fistCount = fistAt.get(fistNext);
      fistAt.delete(fistNext);
      fistNext = nextFist();
    } else if (action === 'aura') auraNext += TICKS_PER_SECOND;
    else if (action === 'eye') eyeNext += TICKS_PER_SECOND;
    if (periodic && (shield || demons || pups?.some((p) => p.hp > 0))) {
      n--;
      continue;
    }
    const swing = action === 'swing';
    // Inferno Demonlord: hit the damageable demon if split, else the boss; with the Hellion Shield,
    // use the dagger whose family takes its attunement (swapping or toggling first if needed).
    const demon = demons ? demons.list[demons.active] : null;
    const need = hellionB ? (demon ? demon.attunes[demon.at] : HELLION_ORDER[attune]) : null;
    let w = 0;
    if (need && swing) {
      const i = weapons.findIndex((x) => DAGGER_FAMILIES[daggerFamily(x.item.id)]?.attunes.includes(need));
      if (i >= 0) {
        w = i;
        if (held !== null && held !== need) {
          held = need;
          pause('swap', t, swapS);
          n--;
          continue;
        }
        held = need;
      }
    }
    // An ability isn't a dagger strike, so the Hellion Shield takes its 99%.
    const matched = !need || (swing && DAGGER_FAMILIES[daggerFamily(weapons[w]?.item.id)]?.attunes.includes(need));
    if (hellionB && swing) {
      const att = need ? need[0] + need.slice(1).toLowerCase() : '';
      showHellion(t, `${att} · ${matched ? weapons[w].item.name : 'no matching dagger'}${demon ? ` · ${demon.name}` : ''}`);
    }
    // Sven's pups: hit the first one that has arrived; if none has yet, wait for the next.
    let pup = null;
    if (pups) {
      pup = pups.find((p) => p.hp > 0 && p.at <= t + 1e-9) || null;
      if (!pup) {
        if (action === 'dot') { // the boss is protected meanwhile
          dots.shift();
          n--;
          continue;
        }
        const next = pups.find((p) => p.hp > 0);
        tick = Math.max(tick + 1, Math.ceil(next.at * TICKS_PER_SECOND - 1e-9));
        n--;
        continue;
      }
    }
    const add = demon || pup;
    side = add ? { maxHp: add.maxHp / derpy, pct: add.hp / add.maxHp * 100 } : null;

    // (The tolerance keeps float sums like 57.85 + 0.2 from leaving a window open forever.)
    if (action === 'dot' || periodic) {
      // Damage over time keeps going while the player is busy, but not while the boss is immune.
      if (immune.some(([a, b]) => t >= a && t < b - 1e-9)) {
        if (action === 'dot') dots.shift();
        n--;
        continue;
      }
    } else {
      const wait = blocked.find(([a, b]) => t >= a && t < b - 1e-9);
      if (wait) {
        tick = Math.max(tick + 1, Math.ceil(wait[1] * TICKS_PER_SECOND - 1e-9));
        n--;
        continue;
      }
    }
    if (!swing) n--; // hit numbers count melee hits

    let r;
    let dmg;
    let crit = false;
    let strikes = 0;
    let swipeReady = false;
    let step = ticksPerHit;
    let hitMult = 1; // Static Charge's discharge, on the hit itself
    const bonuses = [];
    if (swing) {
      // Dominus: a melee hit gains a stack if the last one was long enough ago; at 10 stacks it swipes.
      if (dominusEvery && (clock.plain ? tick - lastStackTick >= dominusEvery * TICKS_PER_SECOND
        : tick >= toTick(clock.after(lastStackTick / TICKS_PER_SECOND, dominusEvery, CLOCKS.dominusGain)))) {
        swipeReady = stacks === DOMINUS_MAX;
        stacks = Math.min(DOMINUS_MAX, stacks + 1);
        lastStackTick = tick;
      }
      // Golem pet Toss: every 5th hit, at most once per 5 s.
      const toss = input.pet?.id === 'GOLEM' && n % 5 === 0 && (CLOCKS.petCooldown === 'real' ? clock.real(t) - clock.real(lastToss) : t - lastToss) >= 5;
      if (toss) lastToss = t;
      r = hitResult(n, stacks, w, toss);
      trackStats(r.totals);
      // The second dagger may swing at its own speed.
      step = w && !bow ? meleeHitTicks(r.totals.ATTACK_SPEED || 0) : ticksPerHit;
      bonuses.push(...r.procs);
      crit = random() * 100 < r.critChance;
      dmg = crit ? r.crit : r.nonCrit;
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
      if (shieldB?.feroDivisor && !shield) fero /= shieldB.feroDivisor;
      strikes = Math.floor(fero / 100) + (random() * 100 < fero % 100 ? 1 : 0);
      // Static Charge: charges come every 30 s (at most 2); a hit discharges them all.
      if (base.staticCharge) {
        while (tick >= nextCharge) {
          charges = Math.min(STATIC_CHARGE.max, charges + 1);
          nextCharge += STATIC_CHARGE.every * TICKS_PER_SECOND;
        }
        if (charges) {
          hitMult = 1 + charges * STATIC_CHARGE.pct / 100;
          charges = 0;
          out.discharges++;
          bonuses.push('Static Charge');
        }
      }
      out.hits++;
      if (crit) out.crits++;
      out.ferocity += strikes;
      nextSwing = tick + step;
      if (hitMana) mana = Math.min(maxMana, mana + hitMana);
    } else if (action === 'fire') {
      r = base;
      dmg = Math.floor(burn * fireFx.pct / 100 * burnMult);
      out.fireTicks++;
    } else if (action === 'fist') {
      r = base;
      dmg = Math.floor(FLAMING_FIST.perTick * fistCount * burnMult);
      out.fistTicks++;
    } else if (action === 'aura') {
      r = base;
      const auraMax = side ? side.maxHp : maxHp;
      dmg = Math.floor(Math.min(aura.cap, aura.flat + aura.pct / 100 * auraMax));
      out.auraTicks++;
    } else if (action === 'eye') {
      r = base;
      manaTo(t);
      const k = Math.min(EYE_BEAM.ramp.seconds, eyeSec);
      const cost = eye.manaCost * (1 + EYE_BEAM.ramp.costPct / 100 * k);
      if (mana < cost - 1e-9) {
        eyeSec = 0; // out of mana: off, back on from its first second
        dmg = 0;
      } else {
        mana -= cost;
        lowestMana = Math.min(lowestMana, mana);
        dmg = Math.floor(eye.hit * (1 + EYE_BEAM.ramp.pct / 100 * k));
        eyeSec++;
        out.eyeTicks++;
      }
    } else {
      // Magic Damage: no crits, Ferocity, lightning or swipes. A melee-hit ability (Reaving Strike, roses)
      // rolls a crit for each of its hits, still without Ferocity, lightning or swipes.
      r = hitResult(n, spell.meleeHit ? stacks : 0, 0, false, true);
      trackStats(r.totals);
      if (spell.meleeHit) {
        dmg = 0;
        for (let k = 0; k < spell.count; k++) {
          const c = random() * 100 < r.critChance;
          if (c) crit = true;
          dmg += c ? r.ability.crit : r.ability.nonCrit;
        }
      } else dmg = r.nonCrit;
      if (action === 'cast') {
        mana -= costAt(tick);
        streak = spell.manaStep && tick < resetTick() ? streak + 1 : 1;
        lastCast = tick;
        lowestMana = Math.min(lowestMana, mana);
        nextCast = clock.plain ? tick + castEvery : Math.max(tick + 1, tick + (spell.over || 0) * TICKS_PER_SECOND,
          toTick(clock.after(t, spell.cooldown, CLOCKS.abilityCooldown)));
        if (chargeDef) {
          refill(tick);
          chargesLeft--;
          if (chargeAt === Infinity) chargeAt = tick + chargeDef.every * TICKS_PER_SECOND;
          nextCast = tick + 1;
        }
        for (let k = 1; k < spell.over; k++) dots.push(tick + k * TICKS_PER_SECOND);
        out.casts++;
      } else {
        dots.shift();
        out.dotTicks++;
      }
    }
    // A cast or a tick of its damage over time, for the indicator and results.
    const mark = swing ? {} : periodic ? { fire: dmg, src: action } : { ability: spell.name, [action]: true };
    if (casting) mark.mana = mana;

    if (shield) {
      // The shield takes hits, not damage; hits until it breaks still count, even with strikes on their way.
      shield.times.push(t);
      for (let k = 0; k < strikes; k++) shield.times.push(t + FEROCITY_DELAY_S + k * FEROCITY_GAP_S);
      if (shield.times.length >= shield.hits) shield.breakAt = [...shield.times].sort((a, b) => a - b)[shield.hits - 1];
      record({ t, w, hit: 0, crit, ferocity: strikes, swipe: 0, bonuses: [], damage: 0, total, hp, shielded: true, sid: shield, tid: 'boss', tidStart: startHp, ...mark }, 0);
      if (swing) nextSwing = tick + ticksPerHit;
      tick = wake(tick);
      continue;
    }

    const bolt = swing && r.lightningPct && n % 3 === 0 ? Math.floor(dmg * r.lightningPct / 100) : 0;
    if (bolt) bonuses.push('Lightning');
    // Swipe: the hit × Swipe Strength / its Additive Multiplier, doubled the first time it hits the enemy.
    const swipe = swipeReady ? Math.floor(dmg * swipeMult / r.additiveMult) * (out.swipes ? 1 : 2) : 0;
    if (bolt) out.lightning++;
    if (swipe) out.swipes++;
    // Hellion Shield: an unmatched hit and every Ferocity strike lose 99%; enchant damage
    // (lightning, swipes) gets through in full.
    const shieldCut = (x) => Math.floor(x * (1 - HELLION_REDUCTION));
    const hitDmg = Math.floor((matched || periodic ? dmg : shieldCut(dmg)) * hitMult + 1e-6); // burns and the aura get through too
    const feroDmg = need ? shieldCut(dmg) : dmg;
    out.damage[swing ? 'hits' : periodic ? action : 'ability'] += hitDmg;
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
      record({ t, w, hit: hitDmg, crit, ferocity: strikes, swipe, bonuses, damage: dealt, total, hp: demon.hp, maxHp: demon.maxHp, target: demon.name, tid: demon, tidStart: demon.maxHp, ...mark }, feroPart);
      tick = wake(tick);
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
      record({ t, w, hit: hitDmg, crit, ferocity: strikes, swipe, bonuses, damage: dealt, total, hp: pup.hp, maxHp: pup.maxHp, target: 'Sven Pup', tid: pup, tidStart: pup.maxHp, ...mark }, feroPart);
      tick = wake(tick);
      continue;
    }
    if (maxHp) {
      bossStrikes = bossStrikes.filter((e) => e.t > t);
      if (regen && !broodOn) hp = Math.min(maxHp, hp + regen * maxHp * (t - regenAt));
      regenAt = t;
      hp -= dealt; // below 0 is fine until the strikes are settled
    }
    // A melee hit on the boss lights Fire Aspect's burn, or refreshes it (keeping the stronger hit).
    if (swing && fireFx && hitDmg > 0) {
      const until = tick + fireFx.seconds * TICKS_PER_SECOND;
      if (fire) Object.assign(fire, { dmg: Math.max(fire.dmg, hitDmg), until });
      else fire = { dmg: hitDmg, until, next: tick + TICKS_PER_SECOND };
    }
    if (swing && fistOn && hitDmg > 0) {
      for (let k = 1; k <= FLAMING_FIST.ticks; k++) fistAt.set(tick + k, (fistAt.get(tick + k) || 0) + 1);
      fistNext = nextFist();
    }
    if (need && matched && ++attuneHits >= HELLION_SWITCH_HITS) {
      attuneHits = 0;
      attune = (attune + 1) % HELLION_ORDER.length;
    }
    const struck = record({ t, w, hit: periodic ? 0 : hitDmg, crit, ferocity: strikes, swipe, bonuses, damage: dealt, total, hp, maxHp,
      ...(broodOn ? { target: 'Conjoined Brood', tid: 'brood', tidStart: maxHp } : { tid: 'boss', tidStart: startHp }), ...mark }, feroPart);
    if (maxHp) {
      bossStrikes.push(...struck.slice(1));
      bossStrikes.sort((a, b) => a.t - b.t);
      // A phase starts at the hit or strike that crosses its line; later strikes are absorbed.
      const gate = !demons && !pups && triggers.find((x) => x.gate && hp <= x.f * maxHp);
      gateAt = gate ? absorbPast(gate.f * maxHp, t, struck[0], gate.cap) : t;
      hp = Math.max(0, hp);
      hpPct = hp / maxHp * 100;
    }
    if (maxHp && hp <= 0 && broodB && !broodOn) {
      // Till Death Do Us Part: the Conjoined Brood takes over with more health and only its passives.
      broodOn = true;
      maxHp *= broodB.hpMult;
      hp = maxHp;
      hpPct = 100;
      triggers.length = 0;
      phases.push({ kind: 'brood', start: t, end: Infinity });
      if (swing) nextSwing = tick + ticksPerHit;
      tick = wake(tick);
      continue;
    }
    if (maxHp && hp <= 0) {
      killedAt = t; // moved to the hit or strike that actually brings it to 0, below
      break;
    }
    while (!demons && !pups && triggers.length && hp <= triggers[0].f * maxHp) {
      const { f, b } = triggers.shift();
      ON_LINE[b.kind](Math.max(t, gateAt), f, b);
    }
    tick = wake(tick);
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

  const limit = clock.game(mode === 'kill' ? SIM_MAX_SECONDS : duration);
  const despawned = killedAt === null && despawnS !== null && despawnS < limit;
  const seconds = killedAt ?? (despawned ? despawnS : limit);
  // Strikes still pending at the kill, the despawn or the end of the time never land.
  if (fatal >= 0) events.length = fatal + 1;
  else while (events.length && events.at(-1).t > seconds + 1e-9) events.pop();
  total = events.length ? events.at(-1).total : 0;
  const lastHp = [...events].reverse().find((e) => e.tid === lastTid);
  if (lastHp) hp = lastHp.hp;
  if (shield) phases.push({ kind: 'shield', start: shield.start, end: Math.min(shield.breakAt ?? seconds, seconds) });
  // The waits on mana within the fight.
  if (casting) {
    if (starvedFrom !== null) manaWaits.push([starvedFrom, seconds]);
    for (const w of manaWaits) w[1] = Math.min(w[1], seconds);
    for (let i = manaWaits.length - 1; i >= 0; i--) if (manaWaits[i][0] >= seconds) manaWaits.splice(i, 1);
  }
  if (heads.length) phases.push({ kind: 'heads', start: heads[0], end: seconds });
  for (const p of phases) p.end = Math.min(p.end, seconds);
  for (let i = phases.length - 1; i >= 0; i--) if (phases[i].start >= seconds && scheduled.includes(phases[i])) phases.splice(i, 1); // never got to it
  // Into real time (clock.js): every event, phase, mechanic and wait on mana.
  let fightSeconds = seconds;
  let killReal = killedAt;
  if (!clock.plain) {
    const R = clock.real;
    for (const e of events) e.t = R(e.t);
    for (const p of phases) {
      p.start = R(p.start);
      p.end = R(p.end);
      if (p.shots) p.shots = p.shots.map(R);
      if (p.left) p.left = p.left.map(([x, k]) => [R(x), k]);
    }
    for (const m of mechanics) {
      m.land = R(m.land);
      m.deadline = R(m.deadline);
    }
    for (const w of manaWaits) w.splice(0, 2, R(w[0]), R(w[1]));
    killReal = killedAt === null ? null : R(killedAt);
    fightSeconds = R(seconds);
  }
  if (!clock.plain || clock.rtt || clock.stutters.length || clock.clicks || clock.reaction) {
    const c = clock.settings;
    const inFight = (list) => list.filter((x) => x <= fightSeconds).length;
    const server = [c.tps < 20 || c.tpsVar ? `${+c.tps.toFixed(1)} TPS on average${c.tpsVar ? ` (±${+c.tpsVar.toFixed(1)})` : ''}` : '',
      clock.freezes.length ? `${inFight(clock.freezes.map((f) => clock.real(f.g)))} lag spikes of about ${Math.round(c.lagMs)} ms` : ''].filter(Boolean);
    const client = [c.ping ? `${Math.round(c.ping)} ms ping${c.jitter ? ` (±${Math.round(c.jitter)})` : ''}` : '',
      clock.stutters.length ? `${inFight(clock.stutters.map(([a]) => a))} stutters of about ${Math.round(c.stutterMs)} ms` : '',
      c.cps ? `${c.cps} clicks a second (right click ${c.rightClick === 'hold' ? 'held: every 4 ticks' : 'spammed'})` : '',
      c.reactionMs ? `${Math.round(c.reactionMs)} ms reaction time` : ''].filter(Boolean);
    notes.push(`Connection: ${[server.length ? `server ${server.join(', ')}` : '', client.length ? `client ${client.join(', ')}` : ''].filter(Boolean).join('; ')}. Hit rate, Ferocity, damage over time, mana regen and boss timers run on server ticks; ability and other cooldowns in real time (assumed); your reactions take real time plus a ping round trip.`);
  }
  if (despawned) notes.push(`The boss despawned after ${despawnS / 60} minutes: the Slayer quest failed.`);
  else if (mode === 'kill' && killedAt === null) notes.push(`The enemy was still alive after ${SIM_MAX_SECONDS / 60} minutes; the fight was stopped.`);
  if (bow && !SHORTBOWS.includes(weaponId)) notes.push('Bows are assumed fully drawn: one shot per second.');
  if (weaponId === 'TERMINATOR') notes.push('Terminator fires 3 arrows per shot; only one is counted.');
  if (crimson) notes.push('Dominus swipe timing is estimated: one swipe per stack gain while at 10 stacks.');
  if (fireFx) notes.push(`${fireFx.label}: ${fireFx.pct}% of the igniting hit each second for ${fireFx.seconds} s; later hits refresh it and raise it if stronger.`);
  if (burnMult !== 1 && (fireFx || fistOn)) notes.push(`Rekindle: burning damage ×${+burnMult.toFixed(2)}.`);
  if (fistOn) notes.push(`Flaming Fist: each melee hit sends one fist (the other two stay put, a known bug) dealing ${FLAMING_FIST.perTick.toLocaleString('en-US')} fire damage a tick for ${FLAMING_FIST.ticks} ticks; fists from later hits overlap.`);
  if (aura) notes.push(`${aura.name}: ${aura.flat ? `${aura.flat} + ` : ''}${aura.pct}% of the target's max Health each second, at most ${aura.cap}.`);
  if (eye) notes.push(`Eye Beam (Precursor Eye): on from the start, ${Math.round(eye.hit).toLocaleString('en-US')} a second rising +${EYE_BEAM.ramp.pct}% each second for ${EYE_BEAM.ramp.seconds} s (taken as linear), ${Math.round(eye.manaCost)} mana a second rising +${EYE_BEAM.ramp.costPct}%; out of mana it goes off and starts over once there's enough.`);
  if (base.staticCharge) notes.push(`Static Charge: a charge every ${STATIC_CHARGE.every} s (at most ${STATIC_CHARGE.max}, full at the start), each +${STATIC_CHARGE.pct}% on the next hit.`);
  if (terminator) notes.push(`Hitshields are shot down with a Terminator: ${TERMINATOR_ARROWS} explosive arrows into the ground under the boss every ${termShot} s, each explosion a hit plus its Ferocity strikes.`);
  for (const n of blockNotes(blocks, { weapons: weapons.length })) notes.push(`Boss phases: ${n}.`);
  if (casting) {
    if (spell.manaStep) notes.push(`${spell.name}: each cast costs ${Math.round(spell.manaStep)} more mana than the last, back to ${Math.round(spell.manaCost)} after ${spell.manaReset} s without one.`);
    if (spell.meleeHit) {
      notes.push(`${spell.name}: ${spell.count > 1 ? `${spell.count} hits of ` : ''}${spell.pct}% of a melee hit${spell.missingBonus > 1 ? ` (×${+spell.missingBonus.toFixed(2)} for your missing health)` : ''}, each rolling its own crit, without Ferocity; ${chargeDef ? `${chargeDef.max} charges, one back every ${chargeDef.every} s` : `every ${castEvery / TICKS_PER_SECOND} s`}.`);
    } else notes.push(`${spell.name}: ${Math.round(spell.manaCost)} mana a cast, at most every ${castEvery / TICKS_PER_SECOND} s; ${Math.round(maxMana)} max mana, +${Math.round(base.manaRegen)} a second.`);
    if (spell.over) notes.push(`${spell.name} deals its damage over ${spell.over} s and is recast once it runs out.`);
  }
  if (!blocks.length && input.target?.boss) notes.push('Boss damage caps are not modelled.');

  return {
    mode, seconds: fightSeconds, killedAt: killReal, despawned, maxHp: base.targetMaxHp || 0, startHp,
    endHp: hp, total, dps: fightSeconds > 0 ? total / fightSeconds : 0,
    hitsPerSecond: clock.tps / ticksPerHit, ...out, events, phases, notes, mechanics, statRanges,
    // The ability, if cast: its name, and the mana pool and its lowest point.
    attack: casting ? attack : 'left', spellName: spell?.name || null, maxMana, lowestMana: casting || eye ? lowestMana : null,
    manaWaits: casting ? manaWaits : null,
    manaWaitSeconds: casting ? manaWaits.reduce((sum, [a, b]) => sum + b - a, 0) : null,
    // The weapons by event w (the main one, then a second dagger), and the Terminator if one was used.
    weaponNames: weapons.map((x) => x.item.name), terminatorName: terminator ? input.terminator?.name || 'Terminator' : null,
    // Every phase this boss can have, whether or not this fight got to it (for the indicator).
    phaseKinds: phaseKinds(blocks, { weapons: weapons.length }),
  };
}
