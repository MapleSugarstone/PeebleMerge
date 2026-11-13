// Renders every icon large and checks its geometry. Open tools/icon-audit.html through the local server.
import { ICONS } from '../js/icons.js';

const VIEW = 24;
const STAGE = 240;
const K = STAGE / VIEW;
const RAY = 20; // raster pixels per icon unit for the free-space check
const TOL = { margin: 0.5, center: 0.6, stacked: 0.3, rays: 0.3, centroid: 0.15 };
const NS = 'http://www.w3.org/2000/svg';

// Old icons the checks must keep flagging.
const KNOWN_BAD = {
  'old hammer': '<svg viewBox="0 0 24 24"><path d="M5 4h9l2 2-2 2H5z" fill="currentColor"/><path d="M9 8v12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
  'hammer with a handle that stops at the head': '<svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="16" height="6.5" rx="2" fill="currentColor"/><rect x="10.6" y="10" width="2.8" height="11" rx="1.4" fill="currentColor"/></svg>',
  'old blueprint':'<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M3.5 12h17M12 3.5v17" stroke="currentColor" stroke-width="1.4"/><circle cx="16.5" cy="16.5" r="2.6" fill="currentColor"/></svg>',
};

const BLOCK_SETS = ['garden', 'autumn', 'fruit', 'animals', 'sweets', 'sea'];

const shapesOf = (root) => [...root.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon')];

/** Inline icons from index.html, with one variant per class so state icons (sound on and off) are checked apart. */
async function inlineIcons() {
  const html = await (await fetch('../index.html', { cache: 'no-store' })).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  doc.querySelectorAll('svg').forEach((s, i) => {
    const owner = s.closest('button');
    const base = `index.html ${owner?.id || owner?.getAttribute('aria-label') || i}`;
    const classes = [...new Set(shapesOf(s).map((e) => e.getAttribute('class')).filter(Boolean))];
    if (!classes.length) { out.push([base, s.outerHTML]); return; }
    for (const keep of classes) {
      const clone = s.cloneNode(true);
      shapesOf(clone).forEach((e) => { const c = e.getAttribute('class'); if (c && c !== keep) e.remove(); });
      out.push([`${base} (${keep})`, clone.outerHTML]);
    }
  });
  return out;
}

function toSvgEl(markup) {
  const doc = new DOMParser().parseFromString(markup.replace('<svg', `<svg xmlns="${NS}"`), 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

/** The painted box of a shape: its geometry box grown by half the stroke width. */
function paintBox(el) {
  const b = el.getBBox();
  const cs = getComputedStyle(el);
  const sw = cs.stroke && cs.stroke !== 'none' ? parseFloat(cs.strokeWidth) / 2 : 0;
  return { x: b.x - sw, y: b.y - sw, w: b.width + 2 * sw, h: b.height + 2 * sw, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}

const union = (boxes) => {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Draws the icon without some shapes and returns its alpha mask. */
async function maskWithout(svgEl, skipIndexes) {
  const clone = svgEl.cloneNode(true);
  const all = shapesOf(clone);
  for (const i of skipIndexes) all[i].remove();
  clone.setAttribute('width', VIEW * RAY);
  clone.setAttribute('height', VIEW * RAY);
  clone.setAttribute('style', 'color:#000');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = VIEW * RAY;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  return (x, y) => x >= 0 && y >= 0 && x < c.width && y < c.height && d[(y * c.width + x) * 4 + 3] > 100;
}

/** Casts rays from a point and returns where each first meets ink, or null if it leaves the canvas. */
function cast(solid, cx, cy, angle) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  for (let t = 1; t < VIEW * RAY * 1.5; t++) {
    const x = Math.round(cx * RAY + dx * t), y = Math.round(cy * RAY + dy * t);
    if (x < 0 || y < 0 || x >= VIEW * RAY || y >= VIEW * RAY) return null;
    if (solid(x, y)) return { x: x / RAY, y: y / RAY, d: t / RAY };
  }
  return null;
}

async function audit(name, markup, host) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<h3>${name}</h3><div class="stage"></div><div class="chips"></div><ul></ul>`;
  host.appendChild(card);
  const stage = card.querySelector('.stage');
  const icon = toSvgEl(markup);
  stage.appendChild(icon);
  for (const tone of ['light', 'green', 'orange']) {
    const chip = document.createElement('div');
    chip.className = `chip ${tone}`;
    chip.appendChild(toSvgEl(markup));
    card.querySelector('.chips').appendChild(chip);
  }

  const results = [];
  const note = (level, text) => results.push({ level, text });
  const shapes = shapesOf(icon);
  const boxes = shapes.map(paintBox);
  const all = union(boxes);

  // 1. Everything stays inside the canvas with a margin.
  const edge = Math.min(all.x, all.y, VIEW - all.x - all.w, VIEW - all.y - all.h);
  if (edge < 0) note('fail', `Paint leaves the canvas by ${(-edge).toFixed(2)} units.`);
  else if (edge < TOL.margin) note('warn', `Paint comes within ${edge.toFixed(2)} units of the canvas edge.`);
  else note('pass', `Margin ${edge.toFixed(2)} units.`);

  // 2. The painted area is centered on the canvas.
  const dx = all.x + all.w / 2 - VIEW / 2, dy = all.y + all.h / 2 - VIEW / 2;
  if (Math.abs(dx) > TOL.center || Math.abs(dy) > TOL.center) note('warn', `Painted area is off center by x ${dx.toFixed(2)}, y ${dy.toFixed(2)}.`);
  else note('pass', `Centered within ${Math.max(Math.abs(dx), Math.abs(dy)).toFixed(2)} units.`);

  // 3. A shape stacked on another (a handle under a head, a base under a crown) shares its center line.
  for (let i = 0; i < shapes.length; i++) {
    for (let j = 0; j < shapes.length; j++) {
      if (i === j) continue;
      const a = boxes[i], b = boxes[j];
      const insideX = a.w < b.w && a.x >= b.x - 0.1 && a.x + a.w <= b.x + b.w + 0.1;
      const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
      if (insideX && gapY > -1.5 && gapY < 1.5) {
        const off = (a.x + a.w / 2) - (b.x + b.w / 2);
        if (Math.abs(off) > TOL.stacked) note('warn', `Shape ${i + 1} sits ${off.toFixed(2)} units off the center line of shape ${j + 1} it is stacked on.`);
      }
      const insideY = a.h < b.h && a.y >= b.y - 0.1 && a.y + a.h <= b.y + b.h + 0.1;
      const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w));
      if (insideY && gapX > -1.5 && gapX < 1.5) {
        const off = (a.y + a.h / 2) - (b.y + b.h / 2);
        if (Math.abs(off) > TOL.stacked) note('warn', `Shape ${i + 1} sits ${off.toFixed(2)} units off the middle of shape ${j + 1} beside it.`);
      }
    }
  }

  // 4. A small shape enclosed by others sits in the middle of its free space.
  // Shapes of about the same size form a repeated group (petals, a 2x2 grid), so they are not each other's walls.
  const similar = (a, b) => Math.abs(a.w - b.w) <= 0.25 * Math.max(a.w, b.w) && Math.abs(a.h - b.h) <= 0.25 * Math.max(a.h, b.h);
  for (let i = 0; i < shapes.length; i++) {
    const b = boxes[i];
    if (b.w * b.h > VIEW * VIEW * 0.2 || shapes.length < 2) continue;
    const skip = boxes.map((o, j) => (j === i || similar(o, b) ? j : -1)).filter((j) => j >= 0);
    const solid = await maskWithout(icon, skip);
    const axis = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((a) => cast(solid, b.cx, b.cy, a));
    const ring = Array.from({ length: 24 }, (_, k) => cast(solid, b.cx, b.cy, (k / 24) * Math.PI * 2));
    const hits = ring.filter(Boolean);
    if (axis.some((h) => !h) || hits.length < ring.length) continue;
    const rx = (axis[0].d - axis[2].d) / 2, ry = (axis[1].d - axis[3].d) / 2;
    const gx = hits.reduce((n, h) => n + h.x, 0) / hits.length - b.cx;
    const gy = hits.reduce((n, h) => n + h.y, 0) / hits.length - b.cy;
    const offX = Math.abs(rx) > TOL.rays && Math.abs(gx) > TOL.centroid && Math.sign(rx) === Math.sign(gx);
    const offY = Math.abs(ry) > TOL.rays && Math.abs(gy) > TOL.centroid && Math.sign(ry) === Math.sign(gy);
    if (offX || offY) note('warn', `Shape ${i + 1} sits off the middle of the space around it by x ${rx.toFixed(2)}, y ${ry.toFixed(2)}.`);
    else note('pass', `Shape ${i + 1} is centered in the space around it.`);
  }

  // 5. A rounded end that joins another shape runs into it by at least its corner radius, so no notch shows at the joint.
  const radiusOf = (el) => {
    if (el.tagName === 'rect') return parseFloat(el.getAttribute('rx') || el.getAttribute('ry') || 0);
    const cs = getComputedStyle(el);
    return cs.stroke !== 'none' && cs.strokeLinecap === 'round' ? parseFloat(cs.strokeWidth) / 2 : 0;
  };
  for (let i = 0; i < shapes.length; i++) {
    const r = radiusOf(shapes[i]);
    if (!r) continue;
    for (let j = 0; j < shapes.length; j++) {
      if (i === j) continue;
      const a = boxes[i], b = boxes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      const depth = Math.min(ox, oy);
      if (ox > -0.1 && oy > -0.1 && depth < r - 0.05) {
        note('warn', `Shape ${i + 1} has a rounded end that only reaches ${Math.max(0, depth).toFixed(2)} units into shape ${j + 1}. Run it in by at least ${r.toFixed(2)}.`);
      }
    }
  }

  // Overlays: canvas center, painted area, and each shape.
  const over = document.createElementNS(NS, 'svg');
  over.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);
  const draw = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); over.appendChild(e); };
  draw('path', { d: `M12 0v24M0 12h24`, stroke: '#e0403a', 'stroke-width': 0.06 });
  draw('rect', { x: all.x, y: all.y, width: all.w, height: all.h, fill: 'none', stroke: '#2f6fd6', 'stroke-width': 0.08 });
  boxes.forEach((b) => draw('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'none', stroke: '#999', 'stroke-width': 0.05, 'stroke-dasharray': '0.3 0.3' }));
  stage.appendChild(over);

  const worst = results.some((r) => r.level === 'fail') ? 'fail' : results.some((r) => r.level === 'warn') ? 'warn' : 'pass';
  card.classList.add(worst);
  card.querySelector('ul').innerHTML = results.map((r) => `<li class="${r.level}">${r.text}</li>`).join('');
  return { name, status: worst, notes: results.filter((r) => r.level !== 'pass').map((r) => r.text) };
}

const icons = [...Object.entries(ICONS), ...(await inlineIcons())];
const report = [];
for (const [name, markup] of icons) report.push(await audit(name, markup, document.getElementById('icons')));
const bad = [];
for (const [name, markup] of Object.entries(KNOWN_BAD)) bad.push(await audit(name, markup, document.getElementById('bad')));

const blocks = document.getElementById('blocks');
for (const set of BLOCK_SETS) {
  blocks.insertAdjacentHTML('beforeend', `<div class="set-name">${set}</div><div class="blocks">${
    Array.from({ length: 14 }, (_, i) => `<img src="../assets/blocks/${set}/${i + 1}.svg" alt="${set} ${i + 1}" onerror="this.style.outline='2px solid red'">`).join('')}</div>`);
}

const flagged = report.filter((r) => r.status !== 'pass');
const missed = bad.filter((r) => r.status === 'pass');
document.getElementById('summary').textContent =
  `${report.length} icons checked, ${flagged.length} flagged. ` +
  (missed.length ? `The checks missed ${missed.length} known-bad sample(s), so the audit itself needs fixing.` : 'Every known-bad sample was caught.');
window.auditResults = { report, bad, flagged: flagged.map((r) => ({ name: r.name, notes: r.notes })), missed: missed.map((r) => r.name) };
