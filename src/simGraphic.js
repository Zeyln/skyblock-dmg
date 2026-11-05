// The simulation window's middle: a target that damage numbers pop off, and a graph of damage dealt
// over the fight with its boss phases as shaded time bands. Both follow the playback clock:
// createSimGraphic(...).hit(event) for every event replayed, .tick(clock) every frame.
import { h } from './dom.js';
import { mobSprite } from './data/mobSprites.js';
import { PHASE_ROWS, nametagStatus } from './bossMechanics.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  return el;
};
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
const short = (n) => Number(n).toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });

// Crits show like the in-game damage indicator: ✧ and digits cycling white, yellow, gold, red.
const CRIT_COLORS = ['var(--mc-f)', 'var(--mc-e)', 'var(--mc-6)', 'var(--mc-c)'];
const MAX_POPS = 40;

// A target made of pixels (original art): a straw dummy on a post.
function targetArt() {
  const px = [
    // [x, y, w, h, class]
    [6, 1, 4, 4, 'head'], [4, 5, 8, 6, 'body'], [2, 6, 2, 2, 'arm'], [12, 6, 2, 2, 'arm'],
    [7, 11, 2, 4, 'post'], [5, 15, 6, 1, 'base'], [7, 7, 2, 2, 'mark'],
  ];
  const root = svg('svg', { viewBox: '0 0 16 16', class: 'sim-dummy', 'shape-rendering': 'crispEdges', 'aria-hidden': 'true' });
  for (const [x, y, w, hh, cls] of px) root.append(svg('rect', { x, y, width: w, height: hh, class: cls }));
  return root;
}

/**
 * s: the simulation result. labels: phase kind -> name. name: the enemy's name. boss: whether it's a boss.
 */
export function createSimGraphic(s, opts) {
  const { labels, name, boss } = opts;
  // ---------- Target and damage numbers ----------
  const pops = h('div', { class: 'sim-pops', 'aria-hidden': 'true' });
  // The enemy's picture (wiki render or head sprite) when there is one, else the dummy; it follows
  // whatever is being hit.
  const dummy = targetArt();
  const face = h('img', { class: 'sim-face', alt: '', draggable: 'false', hidden: true });
  let showing = null;
  const show = (who) => {
    if (who === showing) return;
    showing = who;
    const pic = mobSprite(who); // the wiki's full-body render, or its head sprite
    face.hidden = !pic;
    dummy.style.display = pic ? 'none' : '';
    if (pic) {
      face.src = pic.src;
      face.classList.toggle('head', pic.head);
    }
  };
  show(name);
  const tag = h('div', { class: 'sim-nametag', 'aria-hidden': 'true' });
  const wrap = h('div', { class: 'sim-dummy-wrap' }, dummy, face, pops, tag);
  const target = h('div', { class: 'sim-target' }, wrap);
  // The nametag's bottom edge goes just above the top of the picture as first shown, once (it never
  // moves after, whatever is hit or however many lines it has). The picture is scaled to fit and sits
  // at the bottom of its area, so its top is found from its natural size. Hidden until placed.
  let placed = false;
  const placeTag = () => {
    if (placed || !wrap.isConnected || !wrap.clientHeight) return;
    const area = wrap.getBoundingClientRect();
    let top;
    if (!face.hidden) {
      if (!face.complete) return; // placed on load
      const box = face.getBoundingClientRect();
      const scale = face.naturalWidth ? Math.min(box.width / face.naturalWidth, box.height / face.naturalHeight) : 0;
      top = scale ? box.bottom - face.naturalHeight * scale - area.top : 0;
    } else top = dummy.getBoundingClientRect().top - area.top;
    const k = wrap.clientHeight / area.height; // measured sizes are scaled while the window animates in
    tag.style.bottom = `${Math.round((area.height - top) * k + 4)}px`;
    tag.classList.add('placed');
    placed = true;
  };
  face.addEventListener('load', placeTag);
  face.addEventListener('error', placeTag);
  // Also each frame from the start until laid out (the window may still be opening), for up to ~10 s.
  let tries = 600;
  const tryPlace = () => { placeTag(); if (!placed && --tries > 0) requestAnimationFrame(tryPlace); };
  requestAnimationFrame(tryPlace);

  // ---------- Nametag: name and health above the mob, as in-game, changing with the phase ----------
  let last = null; // the latest replayed event
  let tagKey = '';
  let tagClock = 0;
  const seg = (text, color, bold) => h('span', { class: bold ? 'b' : null, style: `color:var(--tag-${color})` }, text);
  // In-game symbols drawn as pixel icons (style.css .ico-*), in a nametag colour.
  const icon = (name, color) => h('i', { class: `ico ico-${name}`, style: `color:var(--tag-${color})` });
  const tagName = (n) => n.replace(/ \([^)]*\)$/, '').replace(/ (I|II|III|IV|V)$/, '');
  const activeAt = (kind) => (s.phases || []).find((p) => p.kind === kind && tagClock >= p.start && tagClock < p.end);
  function renderTag() {
    placeTag();
    const who = last?.target || name;
    const isBoss = boss && !last?.target;
    const hp = last ? last.hp : s.startHp;
    const max = last?.maxHp || s.maxHp;
    // Health: compact for bosses, current/max otherwise; during a Hitshield, the hits left instead.
    let health = !max ? [] : isBoss ? [seg(short(hp).toUpperCase(), 'a'), icon('heart', 'c')]
      : [seg(fmt(hp), 'a'), seg('/', 'f'), seg(fmt(max), 'a'), icon('heart', 'c')];
    // During a Hitshield the plate counts the hits left instead of health: hit by hand, from the hits
    // replayed; shot down with a Terminator, from its shots so far.
    const shield = activeAt('shield');
    if (shield) {
      const shot = shield.left?.filter(([st]) => st <= tagClock).at(-1);
      const left = shield.left ? (shot ? shot[1] : shield.left[0][1] + 1)
        : last?.shielded && last.shieldLeft != null ? last.shieldLeft : null;
      health = [seg(left != null ? `${left} Hits` : 'Hitshield', 'd', true)];
    }
    // A status line above the name for phases that stop damage or change what's needed (each
    // mechanic's row says what, bossMechanics.js).
    const st = nametagStatus(s.phaseKinds || [], s.phases || [], tagClock);
    const status = st ? seg(...st) : null;
    const key = [who, health.map((x) => x.textContent).join(''), status?.textContent].join('|');
    if (key === tagKey) return;
    tagKey = key;
    tag.replaceChildren(status ? h('div', {}, status) : '',
      h('div', {}, isBoss ? [icon('skull', 'c'), ' '] : '', seg(tagName(who), 'c'), health.length ? ' ' : '', ...health));
  }
  renderTag();
  const pop = (text, cls, crit) => {
    while (pops.childElementCount >= MAX_POPS) pops.firstElementChild.remove();
    const el = h('span', { class: `sim-pop ${cls}`, style: `left:${10 + Math.random() * 80}%;top:${15 + Math.random() * 45}%` });
    if (crit) {
      el.append(h('i', { class: 'ico ico-crit', style: 'color:var(--mc-f)' }));
      [...text].forEach((ch, i) => el.append(h('span', { style: `color:${CRIT_COLORS[i % CRIT_COLORS.length]}` }, ch)));
      el.append(h('i', { class: 'ico ico-crit', style: 'color:var(--mc-f)' }));
    } else el.textContent = text;
    el.addEventListener('animationend', () => el.remove());
    pops.append(el);
  };

  // ---------- Graph ----------
  // The width is always 600 units; the plot's height follows the shape of the box the graph is given
  // (fitPlot, below), so text keeps its size and nothing stretches. 170 until it's measured.
  const W = 600;
  const M = { left: 52, right: 10, top: 8, bottom: 22 };
  let PLOT_H = 170;
  let H = M.top + PLOT_H + M.bottom;
  // focus: this run was picked from the results among several, so its line is highlighted (green).
  // others: the other runs' damage curves when several were simulated ([t, damage] each, simResults.js
  // runRecord), drawn faint behind this run's line; the axes fit every run.
  const others = opts.others || [];
  const ownEnd = Math.max(0.1, s.killedAt ?? s.seconds);
  const end = Math.max(ownEnd, ...others.map((c) => c.at(-1)[0]));
  const yMax = Math.max(1, s.total || 1, ...others.map((c) => c.at(-1)[1]));
  const x = (t) => M.left + (W - M.left - M.right) * Math.min(1, t / end);
  const y = (v) => M.top + PLOT_H * (1 - v / yMax);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sim-chart', role: 'img', 'aria-label': `Damage dealt to ${name} over the fight` });
  // Recessive grid and axes: three value lines, time ticks along the bottom.
  const gridRows = [0, 0.5, 1].map((f) => {
    const line = svg('line', { x1: M.left, x2: W - M.right, y1: y(yMax * f), y2: y(yMax * f), class: 'grid' });
    const label = svg('text', { x: M.left - 6, y: y(yMax * f) + 3, class: 'axis', 'text-anchor': 'end' });
    label.textContent = short(yMax * f);
    root.append(line, label);
    return { f, line, label };
  });
  const timeLabels = [];
  // Sub-second steps too, so a very short fight still gets labels.
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((v) => end / v <= 6) || 240;
  for (let i = 0; i * step <= end + 1e-9; i++) {
    const t = i * step;
    const label = svg('text', { x: x(t), y: H - 4, class: 'axis', 'text-anchor': 'middle' });
    label.textContent = `${+t.toFixed(1)}s`;
    root.append(label);
    timeLabels.push(label);
  }

  // Phase bands: one color per kind of phase (fixed order, at most four), drawn up to the clock.
  // Hellion Shield lasts the whole Demonlord fight, so it isn't a band.
  const kinds = (s.phaseKinds || []).filter((k) => PHASE_ROWS[k]?.band !== false && labels[k]).slice(0, 4);
  // What only shows up to the clock (the other runs, and the bands of several runs): clipped by reveal.
  const reveal = svg('rect', { x: 0, y: 0, width: x(0), height: H });
  const clipId = `sim-reveal-${Math.random().toString(36).slice(2)}`;
  const clip = svg('clipPath', { id: clipId });
  clip.append(reveal);
  const defs = svg('defs');
  defs.append(clip);
  root.append(defs);
  const bandLayer = svg('g');
  // runPhases: every run's phases ([kind, start, end] each, simResults.js runRecord) when several were
  // simulated. Each occurrence of a phase (its kind's 1st, 2nd, … in every run) is then one band from the
  // earliest start to the latest end: solid where every run is in it (latest start to earliest end), and
  // diagonal stripes in the phase's color where only some are. With one run, its phases are solid bands growing
  // with the clock.
  const runPhases = opts.runPhases || [];
  let bands = [];
  if (runPhases.length > 1) {
    bandLayer.setAttribute('clip-path', `url(#${clipId})`);
    const rect = (a, b, cls, fill) => bandLayer.append(svg('rect', {
      x: x(a), y: M.top, width: Math.max(0, x(b) - x(a)), height: PLOT_H, class: cls, ...(fill ? { fill } : {}) }));
    kinds.forEach((k, ki) => {
      // The stripe pattern in this kind's color: thick diagonal stripes, all leaning one way (///).
      const pid = `${clipId}-stripe-${ki}`;
      const pattern = svg('pattern', { id: pid, width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
      pattern.append(svg('rect', { x: 0, y: 0, width: 3.5, height: 8, style: `fill:var(--phase-${ki + 1})` }));
      defs.append(pattern);
      const perRun = runPhases.map((ps) => ps.filter(([kind]) => kind === k).map(([, a, b]) => [a, b]));
      const most = Math.max(0, ...perRun.map((l) => l.length));
      for (let o = 0; o < most; o++) {
        const occ = perRun.map((l) => l[o]).filter(Boolean);
        const s0 = Math.min(...occ.map((p) => p[0]));
        const s1 = Math.max(...occ.map((p) => p[0]));
        const e1 = Math.min(...occ.map((p) => p[1]));
        const e0 = Math.max(...occ.map((p) => p[1]));
        if (!(e0 > s0)) continue;
        // Every run in it somewhere: solid there, stripes either side. Otherwise stripes throughout.
        if (occ.length === runPhases.length && e1 > s1) {
          if (s1 > s0) rect(s0, s1, 'band-edge', `url(#${pid})`);
          rect(s1, e1, `band band-${ki + 1}`);
          if (e0 > e1) rect(e1, e0, 'band-edge', `url(#${pid})`);
        } else rect(s0, e0, 'band-edge', `url(#${pid})`);
      }
    });
  } else {
    bands = (s.phases || []).filter((p) => kinds.includes(p.kind)).map((p) => {
      const rect = svg('rect', { y: M.top, height: PLOT_H, x: x(p.start), width: 0, class: `band band-${kinds.indexOf(p.kind) + 1}` });
      bandLayer.append(rect);
      return { p, rect };
    });
  }
  root.append(bandLayer);

  // The other runs: whole lines, faint (each one fainter the more there are, so where they bunch up
  // shows), revealed up to the clock with this run's playback.
  const opacity = Math.max(0.05, Math.min(0.35, 1.5 / Math.sqrt(others.length || 1)));
  const curvePoints = (c) => c.map(([t, v]) => `${x(t)},${y(v)}`).join(' ');
  const otherLines = others.map((c) => ({ c, el: svg('polyline', { points: curvePoints(c), class: 'damage other', 'stroke-opacity': opacity }) }));
  if (others.length) {
    const group = svg('g', { 'clip-path': `url(#${clipId})` });
    group.append(...otherLines.map((o) => o.el));
    root.append(group);
  }
  // The damage line (cumulative) grows as events are replayed. Among several runs it looks like the others
  // unless it was picked on the results (focus).
  const line = svg('polyline', { points: `${x(0)},${y(0)}`, class: opts.focus ? 'damage focus' : others.length ? 'damage other' : 'damage',
    'stroke-opacity': !opts.focus && others.length ? opacity : null });
  const cursor = svg('line', { y1: M.top, y2: M.top + PLOT_H, x1: x(0), x2: x(0), class: 'cursor' });
  root.append(line, cursor);
  const points = [[0, 0]];
  // This run's line runs on to its own end once the clock gets there (other runs may still be going).
  let lineDone = false;
  const endLine = () => {
    if (lineDone) return;
    lineDone = true;
    points.push([ownEnd, points.at(-1)[1]]);
    line.setAttribute('points', points.map(([t, v]) => `${x(t)},${y(v)}`).join(' '));
  };

  // Hover: the time, the damage so far (this run), and the phases active then (only up to the clock).
  const tip = h('div', { class: 'sim-tip', hidden: true });
  const hover = svg('rect', { x: M.left, y: M.top, width: W - M.left - M.right, height: PLOT_H, fill: 'transparent' });
  root.append(hover);
  let clock = 0;
  const damageAt = (t) => {
    let v = 0;
    for (const [pt, pv] of points) { if (pt > t) break; v = pv; }
    return v;
  };
  hover.addEventListener('pointermove', (ev) => {
    const box = root.getBoundingClientRect();
    const sx = (ev.clientX - box.left) / box.width * W;
    const t = Math.max(0, Math.min(clock, (sx - M.left) / (W - M.left - M.right) * end));
    const active = (s.phases || []).filter((p) => p.start <= t && p.end > t && labels[p.kind]).map((p) => p.detail ? `${labels[p.kind]} (${p.detail})` : labels[p.kind]);
    tip.replaceChildren(h('b', {}, `${t.toFixed(1)} s`), h('span', {}, `${fmt(damageAt(t))} damage`),
      ...active.map((a) => h('span', { class: 'muted' }, a)));
    tip.hidden = false;
    tip.style.left = `${Math.min(100, Math.max(0, (sx / W) * 100))}%`;
  });
  hover.addEventListener('pointerleave', () => { tip.hidden = true; });

  // A new plot height: everything placed by y (and the overall height) moves; x never changes.
  const fitPlot = (plotH) => {
    PLOT_H = plotH;
    H = M.top + PLOT_H + M.bottom;
    root.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const { f, line: g, label } of gridRows) {
      g.setAttribute('y1', y(yMax * f));
      g.setAttribute('y2', y(yMax * f));
      label.setAttribute('y', y(yMax * f) + 3);
    }
    for (const label of timeLabels) label.setAttribute('y', H - 4);
    for (const r of bandLayer.querySelectorAll('rect')) r.setAttribute('height', PLOT_H);
    reveal.setAttribute('height', H);
    for (const o of otherLines) o.el.setAttribute('points', curvePoints(o.c));
    line.setAttribute('points', curvePoints(points));
    cursor.setAttribute('y2', M.top + PLOT_H);
    hover.setAttribute('height', PLOT_H);
  };

  // Swatches drawn like the bands (the same color and opacity on the same background): solid, plus a
  // striped half when several runs are shown.
  const legend = kinds.length ? h('div', { class: 'sim-legend' }, kinds.map((k, i) =>
    h('span', {}, h('i', { class: 'swatch', style: `--c:var(--phase-${i + 1})` },
      h('b', { class: 'solid' }), runPhases.length > 1 ? h('b', { class: 'stripes' }) : ''), labels[k]))) : '';
  const chartWrap = h('div', { class: 'sim-chart-wrap' }, root, tip);
  // When a layout gives the graph a box of its own shape (style.css), the plot takes that shape. Where the
  // box follows the graph (the original layout), this measures the graph's own shape and changes nothing.
  new ResizeObserver(() => {
    const w = chartWrap.clientWidth;
    const hgt = chartWrap.clientHeight;
    if (!w || !hgt) return;
    const plotH = Math.round(Math.max(110, Math.min(700, W * hgt / w - M.top - M.bottom)));
    if (Math.abs(plotH - PLOT_H) >= 2) fitPlot(plotH);
  }).observe(chartWrap);
  const graph = h('div', { class: 'sim-graph' },
    h('div', { class: 'sim-graph-head' }, h('span', {}, !others.length ? 'Damage dealt' : opts.focus ? `Damage dealt · the picked run, with the other ${others.length}` : `Damage dealt · ${others.length + 1} runs`), legend),
    chartWrap);

  const el = h('div', { class: 'sim-visual' }, target, graph);

  return {
    el,
    // One replayed event: its numbers and the line.
    hit(e) {
      show(e.target || name);
      if (e.fire) pop(fmt(e.fire), 'fire');
      else if (!e.feroOnly && e.damage - (e.swipe || 0) > 0) {
        const lightning = e.bonuses?.includes('Lightning') ? Math.max(0, e.damage - e.hit - (e.swipe || 0)) : 0;
        pop(fmt(e.hit), 'hit', e.crit);
        if (lightning) pop(fmt(lightning), 'lightning');
      }
      if (e.feroOnly && e.damage) pop(fmt(e.damage), 'ferocity');
      if (e.swipe) pop(fmt(e.swipe), 'swipe');
      points.push([e.t, e.total]);
      line.setAttribute('points', points.map(([t, v]) => `${x(t)},${y(v)}`).join(' '));
      last = e;
    },
    // Every frame: bands and the cursor up to the clock.
    tick(t) {
      clock = Math.min(t, end);
      tagClock = clock;
      renderTag();
      for (const { p, rect } of bands) {
        const to = Math.min(p.end, clock);
        rect.setAttribute('width', Math.max(0, x(to) - x(p.start)));
      }
      cursor.setAttribute('x1', x(clock));
      cursor.setAttribute('x2', x(clock));
      reveal.setAttribute('width', x(clock));
      if (clock >= ownEnd) endLine();
    },
    // When playback ends: the line and cursor run to the end of the axis (a kill at 0 s, or one
    // shorter than the axis, would otherwise stop short of it).
    finish() {
      endLine();
      this.tick(end);
      reveal.setAttribute('width', W); // every other run in full
    },
  };
}
