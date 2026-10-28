// Minecraft "§" formatting codes -> styled text.
// §0-§f set a colour (and reset styles, as in-game), §l bold, §o italic, §n underline,
// §m strikethrough, §k obfuscated, §r reset. Colours are CSS variables (--mc-0 … --mc-f in
// style.css) so each theme can use a readable version of the in-game palette.
import { h } from './dom.js';

export const MC_COLORS = Object.fromEntries([...'0123456789abcdef'].map((c) => [c, `var(--mc-${c})`]));

export const hasFormatting = (s) => /§[0-9a-fk-or]/i.test(s || '');
export const stripFormatting = (s) => String(s ?? '').replace(/§[0-9a-fk-or]/gi, '');

// "§4Sin§5seeker" -> [{ text: 'Sin', color: 'var(--mc-4)' }, { text: 'seeker', color: 'var(--mc-5)' }]
export function parseFormatting(s) {
  const segs = [];
  let style = {};
  const parts = String(s ?? '').split(/(§[0-9a-fk-or])/i);
  for (const part of parts) {
    if (!part) continue;
    const m = /^§([0-9a-fk-or])$/i.exec(part);
    if (!m) { segs.push({ text: part, ...style }); continue; }
    const c = m[1].toLowerCase();
    if (MC_COLORS[c]) style = { color: MC_COLORS[c] };
    else if (c === 'r') style = {};
    else if (c === 'l') style = { ...style, bold: true };
    else if (c === 'o') style = { ...style, italic: true };
    else if (c === 'n') style = { ...style, underline: true };
    else if (c === 'm') style = { ...style, strike: true };
    else if (c === 'k') style = { ...style, obfuscated: true };
  }
  return segs;
}

function segNode(seg, text, marked) {
  const deco = [seg.underline && 'underline', seg.strike && 'line-through'].filter(Boolean).join(' ');
  const css = [
    seg.color && `color:${seg.color}`, seg.bold && 'font-weight:700', seg.italic && 'font-style:italic',
    deco && `text-decoration:${deco}`,
  ].filter(Boolean).join(';');
  const span = h('span', { style: css || null, class: seg.obfuscated ? 'mc-obf' : null }, text);
  return marked ? h('mark', {}, span) : span;
}

// Render segments, highlighting the part that matches `query` (case-insensitive).
export function renderFormatted(segs, query = '') {
  const plain = segs.map((s) => s.text).join('');
  const q = query.trim().toLowerCase();
  const start = q ? plain.toLowerCase().indexOf(q) : -1;
  const end = start < 0 ? -1 : start + q.length;
  const out = [];
  let pos = 0;
  for (const seg of segs) {
    const a = pos;
    const b = pos + seg.text.length;
    pos = b;
    if (start < 0 || b <= start || a >= end) { out.push(segNode(seg, seg.text, false)); continue; }
    const s = Math.max(start, a) - a;
    const e = Math.min(end, b) - a;
    if (s > 0) out.push(segNode(seg, seg.text.slice(0, s), false));
    out.push(segNode(seg, seg.text.slice(s, e), true));
    if (e < seg.text.length) out.push(segNode(seg, seg.text.slice(e), false));
  }
  return out;
}
