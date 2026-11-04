// Game time and real time. The simulation steps server ticks (20 a second at full speed); a slow or
// unsteady server (TPS below 20, varying) and lag spikes (the server frozen for a moment) stretch game
// time against the real clock. On the player's side, ping delays each reaction (by a varying amount,
// jitter) and stutter (the client freezing) stops clicks for a moment while the server runs on.

// Which clock each timed mechanic runs on. Hit rate (invulnerability ticks, shortbow shot ticks) is
// server ticks (forum, attack speed threads). The rest is an assumption, as plugin servers usually
// work: cooldowns are timestamps (real time), repeating and delayed tasks are scheduled in ticks.
// Switch an entry here to move that mechanic to the other clock.
export const CLOCKS = {
  hitRate: 'tick', // melee invulnerability ticks, bow draw and shortbow shot ticks (forum: confirmed)
  abilityCooldown: 'real', // item ability cooldowns (assumed)
  manaReset: 'real', // a climbing mana cost resetting (Jerry-chine Gun) (assumed)
  dominusGain: 'real', // Crimson Armor's stack gain cooldown (assumed)
  petCooldown: 'real', // pet ability cooldowns (Golem's Toss) (assumed)
  ferocity: 'tick', // Ferocity strikes after the hit (assumed)
  damageOverTime: 'tick', // ability DoTs, Fire Aspect (assumed)
  manaRegen: 'tick', // mana back each second (assumed)
  bossTimers: 'tick', // boss phases, wipe timers, slayer despawn (forum: likely, from one report)
};
// The player's own actions (swaps, aiming, reaching a mechanic) take real time, plus a ping round trip:
// the player sees the event half a ping late, and the reaction reaches the server half a ping later.

export const FULL_TPS = 20;
// How unevenly a person clicks: each gap between clicks is off the average by this much (standard
// deviation, a fraction of the gap; assumed, kept within half and one and a half gaps).
export const CLICK_SPREAD = 0.12;
const TICK = 1 / FULL_TPS;

/**
 * The two instability sliders (0–100) as server and connection settings. Server: the average TPS falls
 * (to 8 at 100, about a bad Crimson Isle lobby: "1 second of server time can feel like up to 3"), it
 * wanders from second to second, and lag spikes (freezes) come more often and last longer (forum: dungeon
 * freezes of "multiple seconds"). Client: the ping varies more (jitter around the base ping, a setting
 * of its own), and the client stutters.
 */
export function fromInstability(server = 0, client = 0, ping = 0) {
  const s = Math.min(100, Math.max(0, server || 0)) / 100;
  const c = Math.min(100, Math.max(0, client || 0)) / 100;
  return {
    tps: FULL_TPS - 12 * s * s, // average
    tpsVar: 4 * s, // how far it wanders (standard deviation)
    lagEvery: s ? 6 / (s * s) : 0, // seconds between lag spikes, on average
    lagMs: s ? 300 + 2700 * s : 0, // each one's length, on average
    ping: Math.max(0, ping || 0), // round trip, ms (its own setting)
    jitter: 120 * c * c, // its standard deviation, ms
    stutterEvery: c ? 10 / (c * c) : 0,
    stutterMs: c ? 100 + 400 * c : 0,
  };
}

// Seeded RNG (mulberry32), separate from the fight's so the clock doesn't change its rolls.
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
const gauss = (random) => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

/**
 * opts: { serverInstability, clientInstability, ping } (the sliders, 0–100, and the base ping in ms), or the settings:
 * { tps, tpsVar, lagEvery, lagMs, ping, jitter, stutterEvery, stutterMs } (TPS, seconds and ms); seed.
 * horizon: the game seconds the fight can last (the clock is laid out up to it, full speed after).
 *
 * real(g): the real time at game time g (seconds); game(r): the game time at real time r.
 */
export function makeClock(opts = {}, horizon = 600) {
  const set = opts.serverInstability != null || opts.clientInstability != null
    ? fromInstability(opts.serverInstability, opts.clientInstability, opts.ping) : opts;
  const random = rng(((opts.seed ?? 1) * 2654435761) ^ 0x5bd1e995);
  const ticks = Math.ceil(Math.max(0, horizon) * FULL_TPS) + 1;

  // Each tick's real length: 1 / that second's TPS (an AR(1) walk around the average, so it drifts
  // rather than jumping), plus any lag spike that freezes the server before the next tick.
  const mean = Math.min(FULL_TPS, Math.max(1, set.tps || FULL_TPS));
  const sd = Math.max(0, set.tpsVar || 0);
  const every = Math.max(0, set.lagEvery || 0);
  const lag = Math.max(0, set.lagMs || 0) / 1000;
  const steady = mean === FULL_TPS && !sd;
  const base = new Float64Array(ticks); // running part
  const frozen = new Float64Array(ticks); // lag spike after it
  const freezes = [];
  let drift = 0;
  let tps = mean;
  let untilSpike = every && lag ? -Math.log(1 - random()) * every : Infinity; // real seconds of running
  for (let i = 0; i < ticks; i++) {
    if (sd && i % FULL_TPS === 0) {
      drift = 0.7 * drift + Math.sqrt(1 - 0.49) * sd * gauss(random);
      tps = Math.min(FULL_TPS, Math.max(1, mean + drift));
    }
    base[i] = steady ? TICK : 1 / tps;
    untilSpike -= base[i];
    if (untilSpike <= 0) {
      const d = lag * (0.5 + random());
      frozen[i] = d;
      freezes.push({ g: (i + 1) * TICK, d });
      untilSpike = -Math.log(1 - random()) * every;
    }
  }
  const plain = steady && !freezes.length;
  // prefix[i]: real time at game tick i.
  const prefix = new Float64Array(ticks + 1);
  for (let i = 0; i < ticks; i++) prefix[i + 1] = prefix[i] + base[i] + frozen[i];
  const end = prefix[ticks];
  const real = (g) => {
    if (!Number.isFinite(g)) return g;
    const x = g * FULL_TPS;
    if (x >= ticks) return end + (x - ticks) * TICK;
    if (x <= 0) return x * TICK;
    const i = Math.floor(x + 1e-9);
    const f = x - i;
    return f < 1e-9 ? prefix[i] : prefix[i] + f * base[i];
  };
  const game = (r) => {
    if (!Number.isFinite(r)) return r;
    if (r >= end) return ticks * TICK + (r - end); // past the laid-out ticks: full speed
    if (r <= 0) return r;
    let lo = 0;
    let hi = ticks;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (prefix[mid] <= r) lo = mid; else hi = mid;
    }
    const into = r - prefix[lo];
    // Running, then (if a spike follows the tick) frozen at the next tick.
    return into >= base[lo] ? (lo + 1) * TICK : (lo + into / base[lo]) * TICK;
  };

  // The connection: a round trip per reaction (ping ± jitter, never below 0), and stutter windows on
  // the real clock in which the client sends nothing.
  const ping = Math.max(0, set.ping || 0) / 1000;
  const jitter = Math.max(0, set.jitter || 0) / 1000;
  const rtt = () => (jitter ? Math.max(0, ping + jitter * gauss(random)) : ping);
  const stutters = [];
  const sEvery = Math.max(0, set.stutterEvery || 0);
  const sLen = Math.max(0, set.stutterMs || 0) / 1000;
  if (sEvery && sLen) {
    for (let r = -Math.log(1 - random()) * sEvery; r < end; r += sLen + -Math.log(1 - random()) * sEvery) {
      const d = sLen * (0.5 + random());
      stutters.push([r, r + d]);
    }
  }

  // Human reaction time: noticing something the player didn't know was coming (opts.reactionMs).
  const reaction = Math.max(0, opts.reactionMs || 0) / 1000;
  const toReal = plain ? (g) => g : real;
  const toGame = plain ? (r) => r : game;

  // Clicks (opts.cps; none: a click in every tick, the old ideal). Left clicks (melee) come at the
  // player's clicks per second, each gap off the average by a little (CLICK_SPREAD: a person doesn't
  // click like a metronome, and perfectly even clicks would line up with some cooldowns and not others);
  // right clicks (casts, shortbow shots) too when spammed, or every 4 client ticks when held (rightClick:
  // 'hold'; Minecraft repeats a held use every 4 ticks, evenly). A click reaches the server half a round
  // trip later and is handled on the next tick, so an action that's ready waits for the first tick with
  // a click waiting. None are sent while the client stutters.
  const cps = opts.cps > 0 ? opts.cps : 0;
  const clickSeries = (every, spread, side) => {
    const r = rng(((opts.seed ?? 1) * 2246822519 + (side === 'left' ? 17 : 29)) >>> 0);
    const sent = [r() * every]; // send times (real seconds), laid out as far as asked
    const at = (n) => {
      while (sent.length <= n) sent.push(sent[sent.length - 1] + (spread ? every * Math.min(1.5, Math.max(0.5, 1 + spread * gauss(r))) : every));
      return sent[n];
    };
    // The first click sent after real time x.
    const from = (x) => {
      while (sent[sent.length - 1] <= x) at(sent.length);
      let lo = -1;
      let hi = sent.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (sent[mid] > x) hi = mid; else lo = mid;
      }
      return hi;
    };
    return { at, from };
  };
  const series = cps ? {
    left: clickSeries(1 / cps, CLICK_SPREAD, 'left'),
    right: opts.rightClick === 'hold' ? clickSeries(4 * TICK, 0, 'right') : clickSeries(1 / cps, CLICK_SPREAD, 'right'),
  } : null;
  const jitterOf = (side, n) => {
    if (!jitter) return 0;
    const r = rng(((opts.seed ?? 1) * 40503 + n * 2246822519 + (side === 'left' ? 7 : 13)) >>> 0);
    return jitter * gauss(r);
  };
  const stuttering = (r) => stutters.some(([a, b]) => r >= a && r < b);
  const memo = new Map();
  // The first tick at or after game tick k at which a `side` click is handled.
  const clickTick = (k, side) => {
    if (!series) return k;
    const key = `${side}${k}`;
    if (memo.has(key)) return memo.get(key);
    const clicks = series[side];
    const after = toReal((k - 1) * TICK); // a click handled at tick k arrived after the tick before it
    const maxWay = ping / 2 + 2 * jitter;
    let best = Infinity;
    for (let n = clicks.from(after - maxWay), i = 0; i < 400; n++, i++) {
      const sent = clicks.at(n);
      if (sent - maxWay > best) break;
      if (stuttering(sent)) continue;
      const arrives = sent + Math.max(0, ping + jitterOf(side, n)) / 2;
      if (arrives > after + 1e-9 && arrives < best) best = arrives;
    }
    const tick = Math.max(k, Math.ceil(toGame(best) * FULL_TPS - 1e-6));
    memo.set(key, tick);
    return tick;
  };

  return {
    settings: { tps: mean, tpsVar: sd, lagEvery: every, lagMs: lag * 1000, ping: ping * 1000, jitter: jitter * 1000,
      stutterEvery: sEvery, stutterMs: sLen * 1000, cps, rightClick: series ? opts.rightClick || 'spam' : null, reactionMs: reaction * 1000 },
    tps: mean, rtt: ping, freezes, stutters, plain, clicks: !!series, reaction,
    real: toReal,
    game: toGame,
    clickTick,
    // Game time `secs` after game time g, on the given clock ('tick' or 'real').
    after: (g, secs, clock) => (clock === 'real' && !plain ? game(real(g) + secs) : g + secs),
    // When the player's reaction to something at game time g ends: a reaction time (noticing it), `human`
    // real seconds (doing it), a ping round trip, then `ticks` game seconds of in-game work (shots, hits).
    action: (g, human, ticks = 0) => (plain && !ping && !reaction ? g + (human + ticks)
      : (plain ? g + rtt() + reaction + human : game(real(g) + rtt() + reaction + human)) + ticks),
  };
}
