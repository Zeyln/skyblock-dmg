// The grass-block logo (theme switch) as pixel art that turns like a raster image: instead of
// rotating the element, which tilts and smooths its pixels, it shows pre-rendered frames of the
// block at every 15° of a full turn. Each frame resamples the original 11 x 11 pixel block onto
// the same axis-aligned pixel grid (nearest neighbour), so the turning block stays made of square
// pixels. The two halves are separate paths filled from --logo-a / --logo-b (style.css), so their
// colours can still fade while it turns.
const N = 11;               // block size in pixels (2 CSS px each -> 22 px)
const PAD = 2;              // room around it for the corners while turning (frame 15 x 15)
const SIZE = N + PAD * 2;
const STEP = 15;            // degrees per frame
const FRAMES = 360 / STEP;
const SPLIT = 5;            // rows 0-4 are the top half (--logo-a), the rest the bottom (--logo-b)

// The block's shape: a square with two-step pixel corners, like the site's small elements.
function inBlock(x, y) {
  if (x < 0 || y < 0 || x >= N || y >= N) return false;
  const cx = Math.min(x, N - 1 - x);
  const cy = Math.min(y, N - 1 - y);
  return !((cy === 0 && cx < 2) || (cy === 1 && cx < 1));
}

// One frame: for every pixel of the frame, take the block pixel it lands on when turned back by
// the frame's angle. Horizontal runs of each half become one path each.
function frame(i) {
  const a = (i * STEP * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const c = N / 2;
  const paths = { a: '', b: '' };
  for (let y = 0; y < SIZE; y++) {
    let run = null;
    let start = 0;
    for (let x = 0; x <= SIZE; x++) {
      let half = null;
      if (x < SIZE) {
        const px = x - PAD + 0.5 - c;
        const py = y - PAD + 0.5 - c;
        const sx = Math.floor(cos * px + sin * py + c);
        const sy = Math.floor(-sin * px + cos * py + c);
        if (inBlock(sx, sy)) half = sy < SPLIT ? 'a' : 'b';
      }
      if (half !== run) {
        if (run) paths[run] += `M${start - PAD} ${y - PAD}h${x - start}v1h-${x - start}z`;
        run = half;
        start = x;
      }
    }
  }
  return paths;
}
const frames = Array.from({ length: FRAMES }, (_, i) => frame(i));

// Build the logo inside the button, showing the block upright (light) or flipped (dark).
const SVG = 'http://www.w3.org/2000/svg';
export function initLogo(button, flipped) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${SIZE} ${SIZE}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  const a = document.createElementNS(SVG, 'path');
  const b = document.createElementNS(SVG, 'path');
  a.setAttribute('class', 'logo-a');
  b.setAttribute('class', 'logo-b');
  svg.append(a, b);
  button.replaceChildren(svg);

  let angle = flipped ? 180 : 0;
  let raf = 0;
  const show = (deg) => {
    const f = frames[Math.round(deg / STEP) % FRAMES];
    a.setAttribute('d', f.a);
    b.setAttribute('d', f.b);
  };
  show(angle);

  // Turn forwards (always the same way round) until the block is upright or flipped, over `ms`,
  // easing in and out. Clicking again mid-turn carries on from the current angle.
  return function turn(toFlipped, ms = 500) {
    cancelAnimationFrame(raf);
    const from = angle;
    const end = from + ((((toFlipped ? 180 : 0) - from) % 360) + 360) % 360;
    if (ms <= 0 || end === from) { angle = end % 360; show(angle); return; }
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;   // ease in-out
      angle = from + (end - from) * e;
      show(angle);
      if (t < 1) raf = requestAnimationFrame(tick);
      else angle = end % 360;
    };
    raf = requestAnimationFrame(tick);
  };
}
