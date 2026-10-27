// Minecraft "§" formatting codes -> styled text.
// §0-§f set a colour (and reset styles, as in-game), §l bold, §o italic, §n underline,
// §m strikethrough, §k obfuscated, §r reset. Colours are the in-game palette, darkened where the
// original (white, yellow, aqua…) would be unreadable on the light theme.
import { h } from './dom.js';

export const MC_COLORS = {
  0: '#1d2233', 1: '#1f2fa8', 2: '#1e7a2e', 3: '#127c8a', 4: '#a8201a', 5: '#8c35b8', 6: '#c28a00', 7: '#7b7f8c',
  8: '#5c6070', 9: '#3d55e0', a: '#1e8f3a', b: '#1a9fb0', c: '#d33a3a', d: '#c4309f', e: '#b39200', f: '#7b7f8c',
};

export const hasFormatting = (s) => /§[0-9a-fk-or]/i.test(s || '');
export const stripFormatting = (s) => String(s ?? '').replace(/§[0-9a-fk-or]/gi, '');

// "§4Sin§5seeker" -> [{ text: 'Sin', color: '#a8201a' }, { text: 'seeker', color: '#8c35b8' }]
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
