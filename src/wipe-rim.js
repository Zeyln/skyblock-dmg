// Rim of the theme wipe (style.css): a dissolving, feathered edge ahead of the incoming page,
// like the spores below the sculk: solid next to the page, then scattered pixels that thin out
// the further they reach. Handed to style.css as CSS variables:
//   --wipe-rim-up    solid at the bottom, dissolving upwards (going dark)
//   --wipe-rim-down  the same, flipped (going light)
const W = 128;      // tile width in pixels (4 CSS px each -> 512 px, repeated sideways)
const H = 20;       // tile height in pixels (80 CSS px, --wipe-rim-h in style.css)

// Small seeded PRNG (mulberry32), so the edge looks the same every time.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Row 0 is the far (dissolved) side, row H-1 touches the incoming page. Each pixel is filled
// with a chance that falls off with distance from the page.
const r = rng(5150);
const rows = [];
for (let y = 0; y < H; y++) {
  const near = (y + 1) / H;               // 1 at the page, ~0 at the far side
  const chance = near ** 1.8;             // feathered: dense near the page, sparse far away
  const cols = [];
  for (let x = 0; x < W; x++) if (r() < chance) cols.push(x);
  rows.push(cols);
}

function toUrl(flip) {
  let d = '';
  rows.forEach((cols, y) => {
    const row = flip ? H - 1 - y : y;
    for (const x of cols) d += `M${x} ${row}h1v1h-1z`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><path d="${d}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const root = document.documentElement.style;
root.setProperty('--wipe-rim-up', toUrl(false));
root.setProperty('--wipe-rim-down', toUrl(true));
