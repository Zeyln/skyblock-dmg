// The simulation window's middle: a target that damage numbers pop off, and a graph of damage dealt
// over the fight with its boss phases as shaded time bands. Both follow the playback clock:
// createSimGraphic(...).hit(event) for every event replayed, .tick(clock) every frame.
import { h } from './dom.js';
import { mobSprite } from './data/mobSprites.js';

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
export function createSimGraphic(s, { labels, name, boss }) {
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
  const target = h('div', { class: 'sim-target' }, tag, h('div', { class: 'sim-dummy-wrap' }, dummy, face, pops));

  // ---------- Nametag: name and health above the mob, as in-game, changing with the phase ----------
  let last = null; // the latest replayed event
  let tagKey = '';
  let tagClock = 0;
  const seg = (text, color, bold) => h('span', { class: bold ? 'b' : null, style: `color:var(--tag-${color})` }, text);
  // In-game symbols drawn as pixel icons (style.css .ico-*), in a nametag colour.
  const icon = (name, color) => h('i', { class: `ico ico-${name}`, style: `color:var(--tag-${color})` });
  const tagName = (n) => n.replace(/ \([^)]*\)$/, '').replace(/ (I|II|III|IV|V)$/, '');
  const activeAt = (kind) => (s.phases || []).find((p) => p.kind === kind && tagClock >= p.start && tagClock < p.end);
  const ATTUNE = { Ashen: '7', Spirit: 'f', Auric: 'e', Crystal: 'b' };
  function renderTag() {
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
    // A status line above the name for phases that stop damage or change what's needed.
    const laser = activeAt('laser');
    const skulls = activeAt('skulls');
    const hellion = activeAt('hellion');
    let status = null;
    if (laser) status = seg('IMMUNE', 'c', true);
    else if (activeAt('reflect')) status = seg('SHIELD', 'b', true);
    else if (activeAt('pups')) status = seg('Protected', 'c');
    else if (activeAt('boom')) status = seg('Boom!', 'c', true);
    else if (skulls && tagClock < skulls.start + 1) status = seg('Invulnerable', '5');
    else if (hellion) {
      const att = hellion.detail.split(' · ')[0];
      status = seg(att.toUpperCase(), ATTUNE[att] || 'f', true);
    }
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
  const W = 600;
  const PLOT_H = 170;
  const M = { left: 52, right: 10, top: 8 };
  const H = M.top + PLOT_H + 22;
  const end = Math.max(0.1, s.killedAt ?? s.seconds);
  const yMax = Math.max(1, s.total || 1);
  const x = (t) => M.left + (W - M.left - M.right) * Math.min(1, t / end);
  const y = (v) => M.top + PLOT_H * (1 - v / yMax);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sim-chart', role: 'img', 'aria-label': `Damage dealt to ${name} over the fight` });
  // Recessive grid and axes: three value lines, time ticks along the bottom.
  for (const f of [0, 0.5, 1]) {
    root.append(svg('line', { x1: M.left, x2: W - M.right, y1: y(yMax * f), y2: y(yMax * f), class: 'grid' }));
    const label = svg('text', { x: M.left - 6, y: y(yMax * f) + 3, class: 'axis', 'text-anchor': 'end' });
    label.textContent = short(yMax * f);
    root.append(label);
  }
  // Sub-second steps too, so a very short fight still gets labels.
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((v) => end / v <= 6) || 240;
  for (let i = 0; i * step <= end + 1e-9; i++) {
    const t = i * step;
    const label = svg('text', { x: x(t), y: H - 4, class: 'axis', 'text-anchor': 'middle' });
    label.textContent = `${+t.toFixed(1)}s`;
    root.append(label);
  }

  // Phase bands: one color per kind of phase (fixed order, at most four), drawn up to the clock.
  // Hellion Shield lasts the whole Demonlord fight, so it isn't a band.
  const kinds = (s.phaseKinds || []).filter((k) => k !== 'hellion' && k !== 'clutch' && labels[k]).slice(0, 4);
  const bandLayer = svg('g');
  const bands = (s.phases || []).filter((p) => kinds.includes(p.kind)).map((p) => {
    const rect = svg('rect', { y: M.top, height: PLOT_H, x: x(p.start), width: 0, class: `band band-${kinds.indexOf(p.kind) + 1}` });
    bandLayer.append(rect);
    return { p, rect };
  });
  root.append(bandLayer);

  // The damage line (cumulative) grows as events are replayed.
  const line = svg('polyline', { points: `${x(0)},${y(0)}`, class: 'damage' });
  const cursor = svg('line', { y1: M.top, y2: M.top + PLOT_H, x1: x(0), x2: x(0), class: 'cursor' });
  root.append(line, cursor);
  const points = [[0, 0]];

  // Hover: the time, the damage so far, and the phases active then (only up to the clock).
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

  const legend = kinds.length ? h('div', { class: 'sim-legend' }, kinds.map((k, i) =>
    h('span', {}, h('i', { class: `band-${i + 1}` }), labels[k]))) : '';
  const graph = h('div', { class: 'sim-graph' },
    h('div', { class: 'sim-graph-head' }, h('span', {}, 'Damage dealt'), legend),
    h('div', { class: 'sim-chart-wrap' }, root, tip));

  const el = h('div', { class: 'sim-visual' }, target, graph);

  return {
    el,
    // One replayed event: its numbers and the line.
    hit(e) {
      show(e.target || name);
      if (!e.feroOnly && e.damage - (e.swipe || 0) > 0) {
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
    },
    // When playback ends: the line and cursor run to the end of the axis (a kill at 0 s, or one
    // shorter than the axis, would otherwise stop short of it).
    finish() {
      points.push([end, points.at(-1)[1]]);
      line.setAttribute('points', points.map(([t, v]) => `${x(t)},${y(v)}`).join(' '));
      this.tick(end);
    },
  };
}
