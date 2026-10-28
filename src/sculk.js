// Sculk strips for the dark theme: draws a few long, random-looking pixel-art strips of sculk
// once and hands them to style.css as CSS variables (--sculk-1 … --sculk-4), where they grow
// over the top edge of every panel, plus separate sparkle strips (--sparks-1 … --sparks-3) that
// blink and move. The CSS only shows them in the dark theme.

const W = 640;          // strip width in pixels (2 CSS px each -> 1280 px, wider than any panel)
const H = 14;           // strip height in pixels
const VARIANTS = 4;     // different strips, so neighbouring panels don't match

const BODY = '#0b3139';
const DARK = '#072429';
const LIGHT = '#11545c';
const HALO = '#1b8f98';
const GLOW = '#47eef2';

// Small seeded PRNG (mulberry32): the strips look the same on every visit.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strip(seed) {
  const r = rng(seed);
  // Drip depth per column: overlapping triangular bumps of random width and length, so drips
  // cluster into uneven tendrils instead of a regular comb.
  const depth = new Array(W).fill(0);
  for (let i = 0; i < W / 5; i++) {
    const c = r() * W;
    const w = 1 + r() * 5;
    const d = r() * r() * 9;
    for (let x = Math.floor(c - w); x <= Math.ceil(c + w); x++) {
      const k = 1 - Math.abs(x - c) / w;
      if (k > 0) depth[(x + W) % W] = Math.max(depth[(x + W) % W], d * k);
    }
  }
  const cells = new Map();
  const put = (x, y, fill, opacity) => addCell(cells, x, y, fill, opacity);
  for (let x = 0; x < W; x++) {
    // Solid growth: a two-pixel crust plus this column's drip.
    const solid = 2 + Math.round(depth[x]);
    for (let y = 0; y < solid; y++) {
      const roll = r();
      put(x, y, y > 0 && roll < 0.06 ? DARK : roll > 0.94 ? LIGHT : BODY);
    }
    // Feathering: loose spores below the drip, sparser and fainter further down.
    for (let y = solid; y < H; y++) {
      const fade = 1 - (y - solid + 1) / (H - solid + 1);
      if (r() < 0.45 * fade * fade) put(x, y, BODY, Math.max(0.25, fade).toFixed(2));
    }
  }
  return toUrl(cells, H);
}

// Sculk-sensor sparkles, on their own layer above the sculk (style.css): a bright pixel with a
// dim halo every 25-60 pixels, near the crust. Each sparkle animates on its own (SVG <animate>,
// which keeps running inside a CSS background image): it fades in, glows and fades out with its
// own random period (5-12 s) and phase, and while invisible jumps to the next of three nearby spots.
// `animated: false` draws the same sparkles at their first spot, for reduced motion.
const SPARK_H = 3;
const SPARK = `<path fill="${HALO}" d="M-1 0h1v1h-1zM1 0h1v1H1zM0 1h1v1H0z"/><path fill="${GLOW}" d="M0 0h1v1H0z"/>`;
function sparkles(seed, animated) {
  const r = rng(seed);
  const spot = (x) => `${Math.min(W - 1, Math.max(0, x + Math.round((r() - 0.5) * 30)))} ${Math.floor(r() * 2)}`;
  let out = '';
  for (let x = Math.floor(r() * 30); x < W; x += 25 + Math.floor(r() * 35)) {
    const spots = [spot(x), spot(x), spot(x)];
    const period = (5 + r() * 7).toFixed(2);       // one blink, seconds
    const begin = `-${(r() * period * 3).toFixed(2)}s`;
    if (!animated) { out += `<g transform="translate(${spots[0]})">${SPARK}</g>`; continue; }
    // Opacity: dark -> fade in -> glow -> fade out -> dark, every period. Position: three spots,
    // switching every period, exactly when the sparkle is dark (both start at `begin`).
    out += `<g opacity="0">`
      + `<animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.2;0.55;0.8;1" dur="${period}s" begin="${begin}" repeatCount="indefinite"/>`
      + `<animateTransform attributeName="transform" type="translate" values="${spots.join(';')}" keyTimes="0;0.3333;0.6667" calcMode="discrete" dur="${(period * 3).toFixed(2)}s" begin="${begin}" repeatCount="indefinite"/>`
      + `${SPARK}</g>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${SPARK_H}" shape-rendering="crispEdges">${out}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// Pixels are collected per colour/opacity ("fill|opacity" -> path data) and drawn as one path each.
function addCell(cells, x, y, fill, opacity = 1) {
  const key = `${fill}|${opacity}`;
  cells.set(key, (cells.get(key) || '') + `M${x} ${y}h1v1h-1z`);
}
function toUrl(cells, height) {
  const paths = [...cells].map(([key, d]) => {
    const [fill, opacity] = key.split('|');
    return `<path fill="${fill}"${opacity === '1' ? '' : ` fill-opacity="${opacity}"`} d="${d}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" shape-rendering="crispEdges">${paths}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const root = document.documentElement.style;
for (let i = 1; i <= VARIANTS; i++) root.setProperty(`--sculk-${i}`, strip(i * 7919));
for (let i = 1; i <= 3; i++) {
  root.setProperty(`--sparks-${i}`, sparkles(i * 104729, true));
  root.setProperty(`--sparks-still-${i}`, sparkles(i * 104729, false));
}
