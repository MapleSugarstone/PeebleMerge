// The deploy workflow replaces every ?v=dev with the commit, so a new deploy never mixes with cached old files.
import * as G from './engine.js?v=dev';
import { ICONS } from './icons.js?v=dev';
import { sfx, unlock, setMuted, isMuted, musicBus, setSfxVolume, setMusicVolume } from './audio.js?v=dev';
import { startMusic, stopMusic, setIntensity } from './music.js?v=dev';

const RUN_KEY = 'peeble.run.v1';
const STATS_KEY = 'peeble.stats.v1';
const MUTE_KEY = 'peeble.muted.v1';
const THEME_KEY = 'peeble.theme.v2';

// [background, text] per level. Index 0 is unused.
const COLORS = [
  null,
  ['#d3ecb6', '#2c3a28'],
  ['#8fd17f', '#1f3a1a'],
  ['#f6d860', '#4a3b00'],
  ['#f7a75c', '#4a2600'],
  ['#ef7c6c', '#ffffff'],
  ['#e2619c', '#ffffff'],
  ['#b26ad8', '#ffffff'],
  ['#7b80e2', '#ffffff'],
  ['#4aa3e2', '#ffffff'],
  ['#2fb3aa', '#ffffff'],
  ['#2f8f60', '#ffffff'],
  ['#c99a1e', '#ffffff'],
  ['#c8463b', '#ffffff'],
  ['#5b3f8c', '#ffffff'],
];

// How each item is used: 'now' acts on press, the rest need a tap on the board or a choice in the picker.
const ITEMS = {
  rewind: { name: 'Rewind', use: 'now', tip: 'Undo your last move', rule: `Rewind undoes your last move, up to ${G.CONFIG.undoDepth} times in a row.` },
  hammer: { name: 'Hammer', use: 'block', tip: 'Remove a block', rule: 'Hammer removes a block.' },
  blueprint: { name: 'Blueprint', use: 'empty', tip: 'Pick where the next block goes', rule: 'Blueprint lets you pick where the next block goes.' },
  swap: { name: 'Swap', use: 'pair', tip: 'Trade the places of two tiles', rule: 'Swap trades the places of two tiles.' },
  seed: { name: 'Seed', use: 'picker', tip: 'Place a level 1 to 5 block', rule: 'Seed places a block of level 1 to 5 that you choose.' },
  scoot: { name: 'Scoot', use: 'pair', tip: 'Move a block one tile into an empty space', rule: 'Scoot moves a block one tile into an empty space next to it.' },
  spin: { name: 'Spin', use: 'square', tip: 'Turn a square of 4 tiles', rule: 'Spin turns a square of 4 tiles clockwise or counterclockwise.' },
  luxury: { name: 'Luxury', use: 'now', tip: `Your next ${G.CONFIG.luxuryPlacements} blocks come in one level higher`, rule: `Luxury makes your next ${G.CONFIG.luxuryPlacements} blocks one level higher, and using two adds two levels.` },
  scorch: { name: 'Scorch', use: 'confirm', tip: 'Remove every level 1 and 2 block', rule: 'Scorch removes every level 1 and level 2 block.' },
  bloom: { name: 'Bloom', use: 'now', tip: `Raise ${G.CONFIG.bloomCount} random blocks by one level`, rule: `Bloom raises ${G.CONFIG.bloomCount} random blocks by one level.` },
  shuffle: { name: 'Shuffle', use: 'now', tip: 'Shuffle the whole board', rule: 'Shuffle moves every tile to a random spot.' },
  teleport: { name: 'Teleport', use: 'pair', tip: 'Move a block to any empty tile', rule: 'Teleport moves a block to any empty tile.' },
  beam: { name: 'Beam', use: 'drag', tip: 'Drag a row or column to cycle it', rule: 'Beam lets you drag a row or column like tape, and tiles that leave one end come back at the other.' },
  gravity: { name: 'Gravity', use: 'direction', tip: 'Pull every tile one way', rule: 'Gravity pulls every tile one way, and matching tiles merge as they land.' },
  monolith: { name: 'Monolith', use: 'now', tip: `Lift ${G.CONFIG.monolithShare * 100}% of the blocks 1 to ${G.CONFIG.monolithMaxLift} levels for ${G.CONFIG.monolithMoves} moves`, rule: `Monolith lifts ${G.CONFIG.monolithShare * 100}% of the blocks 1 to ${G.CONFIG.monolithMaxLift} levels for your next ${G.CONFIG.monolithMoves} moves, and blocks you merge from them keep their level.` },
};
const MODE_INFO = {
  classic: { name: 'Classic', color: '#e6f1d8', theme: 'garden' },
  fall: { name: 'Fall', color: '#fbe9d4', theme: 'autumn' },
  space: { name: 'Space', color: '#1b1840', theme: 'space' },
  daily: { name: 'Daily', color: '#eef0f6', theme: 'toys' },
};
const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic'];

// Icon sets have one SVG per level in assets/blocks/<theme>/<level>.svg.
const THEMES = [
  { id: 'garden', name: 'Garden', icons: 14 },
  { id: 'autumn', name: 'Autumn', icons: 14 },
  { id: 'fruit', name: 'Fruit', icons: 14 },
  { id: 'animals', name: 'Animals', icons: 14 },
  { id: 'sweets', name: 'Sweets', icons: 14 },
  { id: 'sea', name: 'Sea', icons: 14 },
  { id: 'space', name: 'Space', icons: 14 },
  // The toy set belongs to Daily alone.
  { id: 'toys', name: 'Toys', icons: 14, only: 'daily' },
  { id: 'numbers', name: 'Numbers', icons: 0 },
];

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const fmt = (n) => n.toLocaleString('en-US');
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`);

// Stats from before modes existed belong to Classic.
const savedStats = load(STATS_KEY) || {};
const stats = { bestLevel: 0, seen: [], ...savedStats };
stats.modes = savedStats.modes || { classic: { bestScore: savedStats.bestScore || 0, runs: savedStats.runs || 0 } };
for (const m of Object.keys(G.MODES)) stats.modes[m] ||= { bestScore: 0, runs: 0 };
delete stats.bestScore;
delete stats.runs;
// Daily keeps one record per day, so its best and runs start over each morning.
function modeStats() {
  const ms = stats.modes[state.mode];
  if (state.mode === 'daily' && state.daily && ms.date !== state.daily.date) Object.assign(ms, { date: state.daily.date, bestScore: 0, runs: 0 });
  return ms;
}
const todaysBest = () => (stats.modes.daily?.date === G.todayKey() ? stats.modes.daily.bestScore : 0);
const bestLabel = () => (state.mode === 'daily' ? "Today's best" : `${MODE_INFO[state.mode].name} best`);
const runsLabel = () => (state.mode === 'daily' ? "Today's runs" : `${MODE_INFO[state.mode].name} runs`);

const themePrefs = load(THEME_KEY) || { classic: load('peeble.theme.v1') || MODE_INFO.classic.theme };

// Each mode keeps its own run, so switching modes never loses progress.
const RUNS_KEY = 'peeble.runs.v1';
const CURRENT_KEY = 'peeble.mode.v1';
const runs = load(RUNS_KEY) || {};
const oldRun = load(RUN_KEY);
if (G.isValidState(oldRun)) {
  G.migrate(oldRun);
  runs[oldRun.mode] ||= oldRun;
}
for (const m of Object.keys(runs)) if (!G.MODES[m] || !G.isValidState(runs[m])) delete runs[m];
for (const r of Object.values(runs)) G.migrate(r);
const savedMode = load(CURRENT_KEY);
let state = runs[savedMode] || (oldRun && runs[oldRun.mode]) || Object.values(runs)[0] || null;
const firstVisit = !state;
if (firstVisit) state = G.newGame();

function saveRun() {
  runs[state.mode] = state;
  store(RUNS_KEY, runs);
  store(CURRENT_KEY, state.mode);
  try { localStorage.removeItem(RUN_KEY); } catch { /* storage unavailable */ }
}

// A Daily run counts only on its own day. Yesterday's unfinished one gives way to today's.
const inProgress = (id) => runs[id] && !runs[id].over && (id !== 'daily' || runs[id].daily?.date === G.todayKey());

/** Continues a mode's saved run, or starts a new one there when it has none in progress. */
function chooseMode(id) {
  if (id === state.mode && !state.over && runs[id] === state) { closeSheet(); return; }
  if (id !== state.mode && inProgress(id)) {
    saveRun();
    state = runs[id];
    selected = null;
    applyMode();
    saveRun();
    closeSheet();
    render();
    sfx('toolOn');
    return;
  }
  newRun(id);
}

let mode = null;        // the item being aimed, or null
let pick = null;        // the first tile picked for Swap or Scoot
let spinCorner = null;  // the square picked for Spin
let selected = null;    // the block selected for a tap merge
let press = null;       // active pointer on the board

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const wrapEl = $('board-wrap');
const scoreEl = $('score');
const bestEl = $('best');
const nextEl = $('next-tile');
const placeBtn = $('place-btn');
const placeLabel = placeBtn.querySelector('.place-label');
const toolsEl = $('tools');
const picker = $('picker');
const overlay = $('overlay');
const sheet = $('sheet');
const plvEl = $('plv');
const xpFill = $('xp-fill');
const xpText = $('xp-text');
const toast = $('drop-toast');

const cellCount = G.CONFIG.size * G.CONFIG.size;
const cells = [];
for (let i = 0; i < cellCount; i++) {
  const c = document.createElement('div');
  c.className = 'cell';
  c.dataset.i = i;
  boardEl.appendChild(c);
  cells.push(c);
}

// Spin handles sit on the corners shared by four tiles.
const spinLayer = document.createElement('div');
spinLayer.className = 'spin-layer';
spinLayer.hidden = true;
for (const corner of G.spinCorners()) {
  const h = document.createElement('button');
  h.className = 'spin-handle';
  h.dataset.corner = corner;
  h.setAttribute('aria-label', `Square at tile ${corner + 1}`);
  spinLayer.appendChild(h);
}
// A picked square gets one outline and two arrows wrapped around opposite corners. Each arrow traces the way
// the blocks will move and is itself the button: clockwise around the top-left, counterclockwise around the bottom-right.
const spinArt = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
spinArt.classList.add('spin-art');
spinArt.innerHTML = ['cw', 'ccw'].map((dir) =>
  `<g class="spin-arc" data-dir="${dir}" role="button" aria-label="Turn ${dir === 'cw' ? 'clockwise' : 'counterclockwise'}">` +
  '<path class="arc-hit"/><path class="arc-edge"/><path class="arc-edge-head"/><path class="arc-line"/><path class="arc-head"/></g>').join('');
spinLayer.appendChild(spinArt);
wrapEl.appendChild(spinLayer);

// Gravity's four pull buttons sit on the middle of each board edge.
const PULLS = { up: 'pullUp', down: 'pullDown', left: 'pullLeft', right: 'pullRight' };
const pullButtons = Object.entries(PULLS).map(([dir, icon]) => {
  const b = document.createElement('button');
  b.className = 'pull-btn';
  b.dataset.dir = dir;
  b.hidden = true;
  b.setAttribute('aria-label', `Pull ${dir}`);
  b.innerHTML = ICONS[icon];
  b.addEventListener('click', () => doGravity(dir));
  wrapEl.appendChild(b);
  return b;
});

function renderPullButtons() {
  const on = mode === 'gravity' && !state.over;
  for (const b of pullButtons) {
    b.hidden = !on;
    if (on) b.disabled = !G.canFall(state, b.dataset.dir);
  }
}

// While Monolith's lift lasts, a chip on the board counts the moves it has left.
const monolithChip = document.createElement('div');
monolithChip.className = 'monolith-chip';
monolithChip.hidden = true;
wrapEl.appendChild(monolithChip);

function renderMonolithChip() {
  const left = state.monolith || 0;
  monolithChip.hidden = !left;
  if (left) monolithChip.innerHTML = `${ICONS.monolith}<span>${left}</span>`;
}

// Gravity shows each settling pass in turn, and board input waits until it finishes.
let busy = false;

const pt = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

/** Draws one corner arrow as a curve from p0 to p2 bent toward the corner c, with its head at p2. */
function drawArc(dir, p0, c, p2) {
  const g = spinArt.querySelector(`.spin-arc[data-dir="${dir}"]`);
  const len = Math.hypot(p2[0] - c[0], p2[1] - c[1]);
  const t = [(p2[0] - c[0]) / len, (p2[1] - c[1]) / len];
  const nrm = [-t[1], t[0]];
  const at = (k, s) => [p2[0] + t[0] * k + nrm[0] * s, p2[1] + t[1] * k + nrm[1] * s];
  const curve = `M${pt(p0)} Q${pt(c)} ${pt(p2)}`;
  // The line stops inside the head, behind its base, so no seam shows where they meet.
  const head = `M${pt(at(12, 0))} L${pt(at(-6, 11))} L${pt(at(-6, -11))}Z`;
  for (const cls of ['arc-hit', 'arc-edge', 'arc-line']) g.querySelector(`.${cls}`).setAttribute('d', curve);
  for (const cls of ['arc-edge-head', 'arc-head']) g.querySelector(`.${cls}`).setAttribute('d', head);
}

let theme = THEMES[0];
const iconUrl = (level) => `assets/blocks/${theme.id}/${level}.svg`;

/** The block sets a mode may use: Daily uses only its own set, and other modes never see it. */
const themesFor = (m) => THEMES.filter((t) => (m === 'daily' ? t.only === 'daily' : !t.only));

function setTheme(id) {
  const allowed = themesFor(state.mode);
  theme = allowed.find((t) => t.id === id) || allowed.find((t) => t.id === MODE_INFO[state.mode].theme) || allowed[0];
  themePrefs[state.mode] = theme.id;
  store(THEME_KEY, themePrefs);
  document.body.classList.toggle('themed', theme.icons > 0);
  for (let lv = 1; lv <= theme.icons; lv++) new Image().src = iconUrl(lv);
  pickerKey = null;
}

function blockEl(level) {
  const b = document.createElement('div');
  b.className = 'block' + (level >= G.CONFIG.maxLevel ? ' max' : '');
  const [c, t] = COLORS[level] || ['#333333', '#ffffff'];
  b.style.setProperty('--c', c);
  b.style.setProperty('--t', t);
  b.setAttribute('role', 'img');
  b.setAttribute('aria-label', `Level ${level}`);
  if (level <= theme.icons) {
    // An empty alt keeps the browser from drawing fallback text while a new image decodes.
    b.innerHTML = `<img class="icon" src="${iconUrl(level)}" alt="" draggable="false"><span class="corner">${level}</span>`;
  } else {
    b.innerHTML = `<span class="block-inner"><span class="lv">Lv</span><span class="num">${level}</span></span>`;
  }
  return b;
}

const PALETTE_VARS = ['--bg', '--panel', '--ink', '--muted', '--accent', '--accent-light', '--accent-dark', '--soft', '--board', '--cell'];

/** A light color theme built around one hue, for the day's Daily run. */
function dailyPalette(h) {
  return {
    '--bg': `hsl(${h} 45% 90%)`, '--panel': `hsl(${h} 60% 97%)`, '--ink': `hsl(${h} 35% 18%)`, '--muted': `hsl(${h} 15% 40%)`,
    '--accent': `hsl(${h} 55% 42%)`, '--accent-light': `hsl(${h} 60% 68%)`, '--accent-dark': `hsl(${h} 55% 28%)`,
    '--soft': `hsl(${h} 35% 92%)`, '--board': `hsl(${h} 32% 62%)`, '--cell': `hsl(${h} 38% 80%)`,
  };
}

/** Builds the item buttons, the colors, and the block set for the current mode. */
function applyMode() {
  const root = document.documentElement;
  root.dataset.mode = state.mode;
  const palette = state.mode === 'daily' && state.daily ? dailyPalette(state.daily.hue) : null;
  for (const v of PALETTE_VARS) {
    if (palette) root.style.setProperty(v, palette[v]);
    else root.style.removeProperty(v);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette ? palette['--bg'] : MODE_INFO[state.mode].color);
  toolsEl.replaceChildren();
  for (const d of G.modeOf(state).drops) {
    const item = ITEMS[d.item];
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = d.item;
    b.dataset.rarity = d.rarity;
    b.title = `${item.tip}. ${RARITY_NAMES[d.rarity]}, max ${d.cap}.`;
    b.innerHTML = `${ICONS[d.item]}<span class="tool-name">${item.name}</span><span class="badge">0</span>`;
    toolsEl.appendChild(b);
  }
  setTheme(themePrefs[state.mode] || MODE_INFO[state.mode].theme);
  clearAim();
}

function clearAim() {
  mode = null;
  pick = null;
  spinCorner = null;
  stopBeamDemo();
}

const cellKeys = new Array(cellCount).fill(null);
let nextKey = null;
let pickerKey = null;

/** Which items can be used on the board as it stands. */
function usable() {
  const empty = G.emptyCells(state).length;
  const filled = cellCount - empty;
  const it = state.items;
  const has = (k) => it[k] > 0;
  return {
    rewind: has('rewind') && state.history.length > 0,
    hammer: has('hammer') && filled > 0,
    blueprint: has('blueprint') && empty > 0,
    swap: has('swap') && filled > 0,
    seed: has('seed') && empty > 0,
    scoot: has('scoot') && G.canScoot(state),
    spin: has('spin') && filled > 0,
    luxury: has('luxury'),
    scorch: has('scorch') && state.board.some((v) => v === 1 || v === 2),
    bloom: has('bloom') && state.board.some((v) => v > 0 && v < G.CONFIG.maxLevel),
    shuffle: has('shuffle') && filled > 0,
    teleport: has('teleport') && filled > 0 && empty > 0,
    beam: has('beam') && filled > 0,
    gravity: has('gravity') && ['up', 'down', 'left', 'right'].some((d) => G.canFall(state, d)),
    monolith: has('monolith') && !(state.monolith > 0) && state.board.some((v) => v > 0 && v < G.CONFIG.maxLevel),
  };
}

function render(ev = null) {
  const avail = usable();
  if (mode && (state.over || !avail[mode])) clearAim();
  const targets = selected !== null ? G.mergeTargets(state, selected) : [];
  const scootTo = mode === 'scoot' && pick !== null ? G.scootTargets(state, pick) : [];
  const ring = spinCorner !== null ? G.spinRing(spinCorner) : [];
  for (let i = 0; i < cellCount; i++) {
    const c = cells[i];
    const lv = state.board[i];
    // Only a tile whose block changed gets a new element, so unchanged icons never reload.
    const key = lv ? `${theme.id}:${lv}` : '';
    if (cellKeys[i] !== key) {
      c.replaceChildren();
      if (lv) c.appendChild(blockEl(lv));
      cellKeys[i] = key;
    }
    c.className = 'cell';
    if (i === selected || i === pick) c.classList.add('selected');
    if (targets.includes(i)) c.classList.add('target');
    if (mode === 'blueprint' && !lv) c.classList.add('can-place');
    if (mode === 'hammer' && lv) c.classList.add('hammer-target');
    if (mode === 'scorch' && (lv === 1 || lv === 2)) c.classList.add('hammer-target');
    if (mode === 'swap' && i !== pick && lv) c.classList.add('swap-target');
    if (mode === 'swap' && pick !== null && !lv) c.classList.add('can-place');
    if (mode === 'scoot' && pick === null && G.scootTargets(state, i).length) c.classList.add('scoot-target');
    if (scootTo.includes(i)) c.classList.add('can-place');
    if (ring.includes(i)) c.classList.add('spin-sel');
    if (mode === 'teleport' && pick === null && lv) c.classList.add('swap-target');
    if (mode === 'teleport' && pick !== null && !lv) c.classList.add('can-place');
    if (state.lift?.[i] > 0) c.classList.add('lifted');
  }
  renderMonolithChip();
  renderPullButtons();

  if (ev) animate(ev);

  scoreEl.textContent = fmt(state.score);
  bestEl.textContent = fmt(Math.max(modeStats().bestScore, state.score));
  const lift = G.boost(state);
  const nk = `${theme.id}:${G.nextLevel(state)}:${lift}`;
  if (nextKey !== nk) {
    nextEl.replaceChildren(blockEl(G.nextLevel(state)));
    if (lift) nextEl.insertAdjacentHTML('beforeend', `<span class="boost">+${lift}</span>`);
    nextKey = nk;
  }

  const empty = G.emptyCells(state).length;
  setIntensity((cellCount - empty) / cellCount);
  const rescuers = !state.over && G.isStuck(state) ? G.rescueItems(state) : [];
  for (const btn of toolsEl.querySelectorAll('.tool')) {
    const t = btn.dataset.tool;
    const n = state.items[t] ?? 0;
    btn.disabled = state.over || !avail[t];
    btn.classList.toggle('active', mode === t);
    btn.classList.toggle('rescue', rescuers.includes(t) && mode !== t);
    const badge = btn.querySelector('.badge');
    badge.textContent = n;
    badge.classList.toggle('full', n >= G.capFor(state, t));
  }

  const need = G.xpNeeded(state.plv);
  plvEl.textContent = state.plv;
  xpFill.style.width = Math.min(100, (state.xp / need) * 100) + '%';
  xpText.textContent = `${state.xp} / ${need}`;

  renderPicker();
  renderSpinLayer();

  placeLabel.textContent = state.over ? 'New run' : 'Place';
  nextEl.hidden = state.over;
  placeBtn.disabled = !state.over && empty === 0;
}

function renderPicker() {
  const key = mode === 'seed' ? `seed:${theme.id}` : '';
  if (key === pickerKey) return;
  pickerKey = key;
  picker.replaceChildren();
  picker.hidden = !key;
  if (key) {
    for (const lv of G.CONFIG.seedLevels) {
      const b = document.createElement('button');
      b.className = 'pick-option';
      b.dataset.level = lv;
      b.setAttribute('aria-label', `Level ${lv}`);
      b.appendChild(blockEl(lv));
      picker.appendChild(b);
    }
  }
}

function renderSpinLayer() {
  spinLayer.hidden = mode !== 'spin';
  if (spinLayer.hidden) return;
  const n = G.CONFIG.size;
  const picked = spinCorner !== null;
  // Handles show only until a square is picked. After that the square is locked in and only its arrows show.
  for (const h of spinLayer.querySelectorAll('.spin-handle')) {
    const corner = Number(h.dataset.corner);
    const a = cells[corner], b = cells[corner + n + 1];
    h.hidden = picked;
    h.style.left = (a.offsetLeft + a.offsetWidth + b.offsetLeft) / 2 + 'px';
    h.style.top = (a.offsetTop + a.offsetHeight + b.offsetTop) / 2 + 'px';
  }
  spinArt.style.display = picked ? '' : 'none';
  if (!picked) return;
  const tl = cells[spinCorner], br = cells[spinCorner + n + 1];
  const x0 = tl.offsetLeft, y0 = tl.offsetTop;
  const x1 = br.offsetLeft + br.offsetWidth, y1 = br.offsetTop + br.offsetHeight;
  const w = x1 - x0, h = y1 - y0, m = 11;
  drawArc('cw', [x0 - m, y0 + 0.4 * h], [x0 - m, y0 - m], [x0 + 0.4 * w, y0 - m]);
  drawArc('ccw', [x1 - 0.4 * w, y1 + m], [x1 + m, y1 + m], [x1 + m, y1 - 0.4 * h]);
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(0.35, 0.1, 0.25, 1)';

// Lifts a moving block above every other block until its last animation ends.
function raise(el, anim) {
  el.classList.add('moving');
  anim.finished.catch(() => {}).then(() => { if (!el.getAnimations().length) el.classList.remove('moving'); });
}

/** Slides the block now in `cell` from where it was in `from`. */
function slide(cell, from, ms = 240) {
  const el = cells[cell].firstChild;
  if (!el || reduceMotion.matches) return;
  const dx = cells[from].offsetLeft - cells[cell].offsetLeft;
  const dy = cells[from].offsetTop - cells[cell].offsetTop;
  raise(el, el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing: EASE }));
}

/** Where a block in `cell` sits after turning `deg` degrees around the square at `corner`, as an offset from its tile. */
function arcOffset(cell, corner, deg) {
  const n = G.CONFIG.size;
  const tl = cells[corner], br = cells[corner + n + 1];
  const cx = (tl.offsetLeft + br.offsetLeft + br.offsetWidth) / 2;
  const cy = (tl.offsetTop + br.offsetTop + br.offsetHeight) / 2;
  const vx = cells[cell].offsetLeft + cells[cell].offsetWidth / 2 - cx;
  const vy = cells[cell].offsetTop + cells[cell].offsetHeight / 2 - cy;
  const a = (deg * Math.PI) / 180;
  return [vx * Math.cos(a) - vy * Math.sin(a) - vx, vx * Math.sin(a) + vy * Math.cos(a) - vy];
}

/**
 * Carries the blocks of a 2 by 2 square around its center to their tiles while each block stays upright.
 * `fromDeg` is where the blocks start relative to their tiles: -90 or 90 for a full turn, less after a drag.
 */
function turn(ring, dir, ms = 420, fromDeg = null) {
  if (reduceMotion.matches) return;
  const start = fromDeg ?? (dir === 'cw' ? -90 : 90);
  const duration = Math.max(140, (ms * Math.abs(start)) / 90);
  const STEPS = 12;
  for (const i of ring) {
    const el = cells[i].firstChild;
    if (!el) continue;
    const frames = Array.from({ length: STEPS + 1 }, (_, k) => {
      const [x, y] = arcOffset(i, ring[0], start * (1 - k / STEPS));
      return { transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` };
    });
    raise(el, el.animate(frames, { duration, easing: EASE }));
  }
}

/** Swells a block that just went up a level, with a soft glow, then settles it. Bloom's lifts also show their points. */
function grow(cell, delay, withPoints = true) {
  const el = cells[cell].firstChild;
  if (withPoints) {
    const pts = G.points(state.board[cell]);
    setTimeout(() => floatPoints(cell, pts), delay);
  }
  if (!el || reduceMotion.matches) return;
  const rest = { transform: 'scale(1)', filter: 'brightness(1) drop-shadow(0 0 0 rgba(255, 255, 255, 0))' };
  const peak = { transform: 'scale(1.22)', filter: 'brightness(1.18) drop-shadow(0 0 10px rgba(255, 255, 255, 0.95))', offset: 0.4 };
  raise(el, el.animate([rest, peak, rest], { duration: 480, delay, easing: 'ease-out', fill: 'backwards' }));
}

/** Briefly shrinks a block that just dropped back from a Monolith lift. */
function sink(cell) {
  const el = cells[cell].firstChild;
  if (!el || reduceMotion.matches) return;
  el.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.8)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 360, easing: 'ease-out' });
}

/** Fades a block out of one tile and into another. */
function warp(from, to, level) {
  if (reduceMotion.matches) return;
  const ghost = blockEl(level);
  ghost.classList.add('warp-out');
  ghost.addEventListener('animationend', () => ghost.remove());
  cells[from].appendChild(ghost);
  const el = cells[to].firstChild;
  if (el) raise(el, el.animate([{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], { duration: 320, delay: 120, easing: 'ease-out', fill: 'backwards' }));
}

function animate(ev) {
  const pop = (i, cls = 'pop') => cells[i].firstChild?.classList.add(cls);
  if (ev.reverted) ev.reverted.forEach(sink);
  if (ev.type === 'swap') { pop(ev.a); pop(ev.b); return; }
  if (ev.type === 'scoot') { if (!ev.dragged) slide(ev.b, ev.a); return; }
  if (ev.type === 'spin') { turn(ev.cells, ev.dir, 420, ev.fromDeg); return; }
  // The three tiles grow one after another, in time with Bloom's three rising bells.
  if (ev.type === 'bloom') { ev.cells.forEach((i, k) => grow(i, k * 120)); return; }
  if (ev.type === 'monolith') { ev.cells.forEach((i, k) => grow(i, k * 50, false)); return; }
  if (ev.type === 'shuffle') { ev.moves.forEach((m) => slide(m.to, m.from, 420)); return; }
  if (ev.type === 'teleport') {
    if (ev.dragged) pop(ev.b);
    else warp(ev.a, ev.b, state.board[ev.b]);
    return;
  }
  if (ev.type === 'hammer' || ev.type === 'scorch') {
    const list = ev.type === 'hammer' ? [[ev.cell, ev.level]] : ev.cells.map((c, k) => [c, ev.levels[k]]);
    for (const [cell, level] of list) {
      const ghost = blockEl(level);
      ghost.classList.add('smash');
      ghost.addEventListener('animationend', () => ghost.remove());
      cells[cell].appendChild(ghost);
    }
    return;
  }
  if (ev.cell !== undefined) {
    pop(ev.cell, ev.type === 'merge' ? 'merge-pop' : 'pop');
    if (ev.points) floatPoints(ev.cell, ev.points);
  }
}

function floatPoints(cell, pts) {
  const c = cells[cell];
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = '+' + fmt(pts);
  el.style.left = c.offsetLeft + c.offsetWidth / 2 + 'px';
  el.style.top = c.offsetTop + c.offsetHeight / 2 + 'px';
  el.addEventListener('animationend', () => el.remove());
  wrapEl.appendChild(el);
}

const SOUNDS = {
  hammer: 'smash', rewind: 'rewind', swap: 'swap', scoot: 'scoot', spin: 'spin', luxury: 'luxury', scorch: 'scorch', bloom: 'bloom',
  shuffle: 'shuffle', teleport: 'teleport', beam: 'beam', gravity: 'gravity', monolith: 'monolith',
};

function playFor(ev, via) {
  if (ev.type === 'place') sfx('place', ev.level);
  else if (ev.type === 'merge') sfx(ev.level >= G.CONFIG.maxLevel ? 'max' : 'merge', ev.level);
  else if (SOUNDS[ev.type]) sfx(SOUNDS[ev.type]);
  if (via === 'blueprint' || via === 'seed') sfx(via);
  if (ev.reverted) setTimeout(() => sfx('revert'), 200);
}

/** Draws a board's blocks without touching tile highlights, for showing Gravity's passes one at a time. */
function paintBlocks(board) {
  for (let i = 0; i < cellCount; i++) {
    const lv = board[i];
    const key = lv ? `${theme.id}:${lv}` : '';
    if (cellKeys[i] === key) continue;
    cells[i].replaceChildren();
    if (lv) cells[i].appendChild(blockEl(lv));
    cellKeys[i] = key;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shows each Gravity pass: tiles slide to where they land, then merged tiles pop and chime. */
async function playGravity(ev) {
  const step = reduceMotion.matches ? 0 : 170;
  for (const frame of ev.frames) {
    paintBlocks(frame.board);
    for (const cell of new Set(frame.moves.map((m) => m.to))) {
      const sources = frame.moves.filter((m) => m.to === cell && m.from !== cell);
      // A merged tile slides in from the partner that traveled farther.
      const from = sources.sort((a, b) => Math.abs(b.from - cell) - Math.abs(a.from - cell))[0];
      if (from) slide(cell, from.from, step - 20);
    }
    if (frame.merged.length) {
      const top = Math.max(...frame.merged.map((c) => frame.board[c]));
      setTimeout(() => {
        for (const cell of frame.merged) {
          cells[cell].firstChild?.classList.add('merge-pop');
          floatPoints(cell, G.points(frame.board[cell]));
        }
        sfx('merge', top);
      }, step - 20);
    }
    await wait(step);
  }
}

function act(ev, via = null) {
  if (!ev) { render(); return; }
  playFor(ev, via);
  selected = null;
  const made = ev.type === 'place' || ev.type === 'merge' ? [ev.level]
    : ev.type === 'bloom' ? ev.cells.map((i) => state.board[i])
    : ev.type === 'gravity' ? ev.frames.flatMap((f) => f.merged.map((c) => f.board[c]))
    : [];
  if (made.length) {
    for (const lv of made) if (!stats.seen.includes(lv)) stats.seen.push(lv);
    stats.bestLevel = Math.max(stats.bestLevel, ...made);
    store(STATS_KEY, stats);
  }
  if (ev.type === 'merge' && navigator.vibrate) navigator.vibrate(12);
  saveRun();
  if (ev.type === 'gravity') {
    busy = true;
    render();
    // render() drew the settled board, so the passes are replayed over it from the start.
    cellKeys.fill(null);
    playGravity(ev).then(() => {
      busy = false;
      render();
      if (state.over) finishRun();
    });
    return;
  }
  render(ev);
  if (ev.levelUp) showLevelUp(ev.levelUp);
  if (state.over) finishRun();
}

function doGravity(dir) {
  if (busy) return;
  clearAim();
  act(G.useGravity(state, dir));
}

let toastTimer = null;
function showLevelUp(lu) {
  plvEl.classList.remove('bump');
  void plvEl.offsetWidth;
  plvEl.classList.add('bump');
  toast.innerHTML = lu.item
    ? `<div class="toast-level">Level ${lu.plv}</div>
       <div class="toast-item">${ICONS[lu.item]}<span>${ITEMS[lu.item].name} +1</span></div>
       <div class="toast-rarity">${RARITY_NAMES[lu.rarity]}</div>`
    : `<div class="toast-level">Level ${lu.plv}</div>
       <div class="toast-item"><span>+${fmt(lu.bonus)}</span></div>
       <div class="toast-rarity">Items full</div>`;
  if (lu.item) toast.dataset.rarity = lu.rarity;
  else delete toast.dataset.rarity;
  // Restart the animation when level-ups come close together.
  toast.hidden = true;
  void toast.offsetWidth;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2300);
  const btn = lu.item && toolsEl.querySelector(`[data-tool="${lu.item}"]`);
  if (btn) {
    btn.classList.remove('gain');
    void btn.offsetWidth;
    btn.classList.add('gain');
  }
  setTimeout(() => sfx('levelUp', lu.item ? lu.rarity : 0), 250);
}

function finishRun() {
  let isBest = false;
  if (!state.recorded) {
    const ms = modeStats();
    isBest = state.score > ms.bestScore;
    ms.bestScore = Math.max(ms.bestScore, state.score);
    ms.runs++;
    state.recorded = true;
    store(STATS_KEY, stats);
    saveRun();
    sfx(isBest ? 'best' : 'over');
  }
  render();
  showGameOver(isBest);
}

function newRun(modeId) {
  state = G.newGame(Math.random, modeId);
  selected = null;
  applyMode();
  saveRun();
  closeSheet();
  render();
  sfx('newRun');
}

// Board input: tap to select or aim an item, drag to merge. Scoot and Spin can also be dragged.

// A spin drag must sweep this far around the square before letting go turns it.
const SPIN_DRAG_DEG = 30;

function cellAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const c = el && el.closest('.cell');
  return c && boardEl.contains(c) ? Number(c.dataset.i) : null;
}

/** The center of a 2 by 2 square on screen. */
function squareCenter(corner) {
  const n = G.CONFIG.size;
  const a = cells[corner].getBoundingClientRect(), b = cells[corner + n + 1].getBoundingClientRect();
  return { corner, cx: (a.left + b.right) / 2, cy: (a.top + b.bottom) / 2 };
}

/** The 2 by 2 square whose center is closest to a point on screen. */
function squareAt(x, y) {
  let best = null;
  for (const corner of G.spinCorners()) {
    const sq = squareCenter(corner);
    sq.d = Math.hypot(x - sq.cx, y - sq.cy);
    if (!best || sq.d < best.d) best = sq;
  }
  return best;
}

boardEl.addEventListener('pointerdown', (e) => {
  if (state.over || press || busy) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i === null) return;
  stopBeamDemo();
  press = { id: e.pointerId, cell: i, x: e.clientX, y: e.clientY, dragging: false, ghost: null, hover: null };
  boardEl.setPointerCapture(e.pointerId);
});

boardEl.addEventListener('pointermove', (e) => {
  if (!press || e.pointerId !== press.id) return;
  if (!press.dragging) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10) return;
    if (mode === 'spin') startSpinDrag();
    else if (mode === 'beam') startBeamDrag(e.clientX, e.clientY);
    else if (mode === 'scoot' && G.scootTargets(state, press.cell).length) startDrag('scoot');
    else if (mode === 'teleport' && state.board[press.cell]) startDrag('teleport');
    else if (!mode && state.board[press.cell]) startDrag('merge');
    else return;
  }
  if (press.kind === 'spin') moveSpin(e.clientX, e.clientY);
  else if (press.kind === 'beam') moveBeam(e.clientX, e.clientY);
  else moveGhost(e.clientX, e.clientY);
});

boardEl.addEventListener('pointerup', (e) => {
  if (!press || e.pointerId !== press.id) return;
  const p = press;
  press = null;
  const to = cellAt(e.clientX, e.clientY);
  if (p.dragging && p.kind === 'spin') { endSpin(p.spin); return; }
  if (p.dragging && p.kind === 'beam') { endBeam(p.beam); return; }
  if (p.dragging) {
    p.ghost.remove();
    if (p.kind === 'scoot' || p.kind === 'teleport') {
      const ok = to !== null && (p.kind === 'scoot' ? G.scootTargets(state, p.cell).includes(to) : !state.board[to]);
      if (ok) {
        clearAim();
        const ev = p.kind === 'scoot' ? G.useScoot(state, p.cell, to) : G.useTeleport(state, p.cell, to);
        if (ev) ev.dragged = true;
        act(ev);
      } else {
        pick = null;
        sfx('deselect');
        render();
      }
      return;
    }
    if (to !== null && G.canMerge(state, p.cell, to)) {
      act(G.merge(state, p.cell, to));
    } else {
      selected = null;
      sfx('deselect');
      render();
    }
    return;
  }
  // In Gravity mode a swipe across the board pulls the way it went.
  if (mode === 'gravity') {
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (Math.hypot(dx, dy) >= 30) {
      doGravity(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }
    return;
  }
  if (to === p.cell) tap(to, e.clientX, e.clientY);
});

boardEl.addEventListener('pointercancel', () => {
  if (!press) return;
  if (press.ghost) press.ghost.remove();
  if (press.spin) { spinLayer.classList.remove('dragging'); poseSpin(press.spin, 0); }
  if (press.beam) dropBeam(press.beam);
  press = null;
  selected = null;
  if (mode === 'scoot') pick = null;
  render();
});

function startDrag(kind) {
  press.dragging = true;
  press.kind = kind;
  const usesPick = kind === 'scoot' || kind === 'teleport';
  const was = usesPick ? pick : selected;
  if (was !== press.cell) sfx('select');
  if (usesPick) pick = press.cell;
  else selected = press.cell;
  render();
  const c = cells[press.cell];
  c.classList.add('dragging');
  const rect = c.getBoundingClientRect();
  const g = blockEl(state.board[press.cell]);
  g.classList.add('ghost');
  g.style.width = rect.width + 'px';
  g.style.height = rect.height + 'px';
  document.body.appendChild(g);
  press.ghost = g;
}

function moveGhost(x, y) {
  press.ghost.style.left = x + 'px';
  press.ghost.style.top = y + 'px';
  const over = cellAt(x, y);
  const ok = over !== null && (press.kind === 'scoot' ? G.scootTargets(state, press.cell).includes(over)
    : press.kind === 'teleport' ? !state.board[over]
    : G.canMerge(state, press.cell, over));
  const hover = ok ? over : null;
  if (hover === press.hover) return;
  if (press.hover !== null) cells[press.hover].classList.remove('drop-hover');
  if (hover !== null) cells[hover].classList.add('drop-hover');
  press.hover = hover;
}

function startSpinDrag() {
  press.dragging = true;
  press.kind = 'spin';
  // Once a square is picked it stays picked. Before that, a drag picks the square nearest the finger.
  const sq = spinCorner !== null ? squareCenter(spinCorner) : squareAt(press.x, press.y);
  if (spinCorner !== sq.corner) sfx('select');
  spinCorner = sq.corner;
  render();
  spinLayer.classList.add('dragging');
  press.spin = { corner: sq.corner, cx: sq.cx, cy: sq.cy, last: Math.atan2(press.y - sq.cy, press.x - sq.cx), deg: 0 };
}

function moveSpin(x, y) {
  const s = press.spin;
  const a = Math.atan2(y - s.cy, x - s.cx);
  let d = a - s.last;
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  s.last = a;
  s.deg = Math.max(-90, Math.min(90, s.deg + (d * 180) / Math.PI));
  poseSpin(s, s.deg);
  for (const g of spinArt.querySelectorAll('.spin-arc')) {
    g.classList.toggle('hot', Math.abs(s.deg) >= SPIN_DRAG_DEG && (g.dataset.dir === 'cw') === s.deg > 0);
  }
}

/** Holds the square's blocks part way around their turn while the finger drags. */
function poseSpin(s, deg) {
  for (const i of G.spinRing(s.corner)) {
    const el = cells[i].firstChild;
    if (!el) continue;
    el.classList.toggle('moving', deg !== 0);
    if (!deg) { el.style.transform = ''; continue; }
    const [x, y] = arcOffset(i, s.corner, deg);
    el.style.transform = `translate(${x}px, ${y}px)`;
  }
}

function endSpin(s) {
  spinLayer.classList.remove('dragging');
  for (const g of spinArt.querySelectorAll('.spin-arc')) g.classList.remove('hot');
  poseSpin(s, 0);
  if (Math.abs(s.deg) >= SPIN_DRAG_DEG) {
    clearAim();
    const ev = G.useSpin(state, s.corner, s.deg > 0 ? 'cw' : 'ccw');
    // The blocks are already part way around, so the turn finishes from where the finger left them.
    if (ev) ev.fromDeg = s.deg > 0 ? s.deg - 90 : s.deg + 90;
    act(ev);
    return;
  }
  if (s.deg) turn(G.spinRing(s.corner), null, 260, s.deg);
  render();
}

// Beam: the dragged row or column becomes a looping strip of tape. Three copies of the line sit end to end
// inside a clipped window, so tiles leaving one end are already coming in at the other.

/** Lifts a row or column off the board into a looping strip, hiding the real blocks underneath. */
function buildBeamStrip(axis, index) {
  const n = G.CONFIG.size;
  const line = G.beamLine(axis, index);
  const first = cells[line[0]], last = cells[line[n - 1]];
  const pitch = axis === 'row' ? cells[line[1]].offsetLeft - first.offsetLeft : cells[line[1]].offsetTop - first.offsetTop;
  const strip = document.createElement('div');
  strip.className = 'beam-strip';
  strip.style.left = first.offsetLeft + 'px';
  strip.style.top = first.offsetTop + 'px';
  strip.style.width = last.offsetLeft + last.offsetWidth - first.offsetLeft + 'px';
  strip.style.height = last.offsetTop + last.offsetHeight - first.offsetTop + 'px';
  const track = document.createElement('div');
  track.className = 'beam-track';
  for (let copy = -1; copy <= 1; copy++) {
    line.forEach((cell, k) => {
      if (!state.board[cell]) return;
      const b = blockEl(state.board[cell]);
      const at = (k + copy * n) * pitch;
      b.style.left = (axis === 'row' ? at : 0) + 'px';
      b.style.top = (axis === 'row' ? 0 : at) + 'px';
      b.style.width = first.offsetWidth + 'px';
      b.style.height = first.offsetHeight + 'px';
      track.appendChild(b);
    });
  }
  strip.appendChild(track);
  boardEl.appendChild(strip);
  for (const cell of line) if (cells[cell].firstChild) cells[cell].firstChild.style.visibility = 'hidden';
  return { axis, index, line, pitch, strip, track };
}

function startBeamDrag(x, y) {
  stopBeamDemo();
  const n = G.CONFIG.size;
  const axis = Math.abs(x - press.x) >= Math.abs(y - press.y) ? 'row' : 'col';
  const index = axis === 'row' ? Math.floor(press.cell / n) : press.cell % n;
  press.dragging = true;
  press.kind = 'beam';
  press.beam = { ...buildBeamStrip(axis, index), start: axis === 'row' ? press.x : press.y, offset: 0, steps: 0 };
  sfx('select');
}

// Beam demo: when Beam is picked, a row and then a column slide part way and back with a fingertip on them,
// so a new player sees that lines drag and that tiles loop around.

let beamDemo = null;
const BEAM_DEMO_KEY = 'peeble.beamDemoSeen.v1';

function stopBeamDemo() {
  if (beamDemo) beamDemo.cancel();
  beamDemo = null;
}

/** The row or column with the most blocks, so the demo has something to show. */
function busiestLine(axis) {
  const n = G.CONFIG.size;
  let best = null, most = 0;
  for (let index = 0; index < n; index++) {
    const count = G.beamLine(axis, index).filter((c) => state.board[c]).length;
    if (count > most) { most = count; best = index; }
  }
  return best;
}

function demoBeam() {
  stopBeamDemo();
  if (reduceMotion.matches) return;
  const plan = ['row', 'col'].map((axis) => [axis, busiestLine(axis)]).filter(([, index]) => index !== null);
  if (!plan.length) return;
  const live = [];
  let cancelled = false;
  beamDemo = {
    cancel() {
      cancelled = true;
      for (const part of live) { part.anims.forEach((a) => a.cancel()); dropBeam(part.b); part.dot.remove(); }
      live.length = 0;
    },
  };
  (async () => {
    await wait(250);
    for (const [axis, index] of plan) {
      if (cancelled || mode !== 'beam') return;
      const b = buildBeamStrip(axis, index);
      const mid = cells[b.line[1]];
      const dot = document.createElement('div');
      dot.className = 'beam-hint-dot';
      dot.style.left = mid.offsetLeft + mid.offsetWidth / 2 + 'px';
      dot.style.top = mid.offsetTop + mid.offsetHeight / 2 + 'px';
      boardEl.appendChild(dot);
      const prop = axis === 'row' ? 'translateX' : 'translateY';
      const at = (px) => `${prop}(${px}px)`;
      const far = b.pitch * 0.8;
      const path = [0, 0, far, 0, 0];
      const offsets = [0, 0.12, 0.5, 0.88, 1];
      const track = b.track.animate(path.map((px, k) => ({ transform: at(px), offset: offsets[k] })), { duration: 1300, easing: 'ease-in-out' });
      const finger = dot.animate(path.map((px, k) => ({ transform: at(px), opacity: k === 0 || k === 4 ? 0 : 1, offset: offsets[k] })), { duration: 1300, easing: 'ease-in-out' });
      const part = { b, dot, anims: [track, finger] };
      live.push(part);
      await track.finished.catch(() => {});
      if (cancelled) return;
      dropBeam(b);
      dot.remove();
      live.splice(live.indexOf(part), 1);
      await wait(200);
    }
    beamDemo = null;
  })();
}

const wrapLoop = (d, length) => ((d % length) + length) % length;

function placeTrack(b, d) {
  const shift = wrapLoop(d, b.pitch * b.line.length);
  b.track.style.transform = b.axis === 'row' ? `translateX(${shift}px)` : `translateY(${shift}px)`;
}

function moveBeam(x, y) {
  const b = press.beam;
  b.offset = (b.axis === 'row' ? x : y) - b.start;
  placeTrack(b, b.offset);
  // A soft tick each time a tile passes a slot, like a slot machine reel.
  const steps = Math.round(b.offset / b.pitch);
  if (steps !== b.steps) { b.steps = steps; sfx('tick'); }
}

function dropBeam(b) {
  b.strip.remove();
  for (const cell of b.line) if (cells[cell].firstChild) cells[cell].firstChild.style.visibility = '';
}

function endBeam(b) {
  const shift = Math.round(b.offset / b.pitch);
  const settle = () => {
    dropBeam(b);
    const n = G.CONFIG.size;
    if (((shift % n) + n) % n === 0) { render(); return; }
    clearAim();
    act(G.useBeam(state, b.axis, b.index, shift));
  };
  if (reduceMotion.matches) { settle(); return; }
  // The tape eases to the nearest slot before the board takes the new order.
  const from = wrapLoop(b.offset, b.pitch * b.line.length);
  const to = from + (shift * b.pitch - b.offset);
  const prop = b.axis === 'row' ? 'translateX' : 'translateY';
  b.track.animate([{ transform: `${prop}(${from}px)` }, { transform: `${prop}(${to}px)` }], { duration: 120, easing: 'ease-out', fill: 'forwards' })
    .finished.then(settle, settle);
}

/** Picks the first tile of a two-tap item, or clears it when the same tile is tapped again. */
function pickFirst(i, ok) {
  if (pick === i) { pick = null; sfx('deselect'); }
  else if (ok) { pick = i; sfx('select'); }
  render();
}

function tap(i, x, y) {
  const lv = state.board[i];
  const n = G.CONFIG.size;
  switch (mode) {
    case 'hammer':
      if (lv) { clearAim(); act(G.useHammer(state, i)); }
      return;
    case 'blueprint':
      if (!lv) { clearAim(); act(G.useBlueprint(state, i), 'blueprint'); }
      return;
    case 'scorch':
      if (lv === 1 || lv === 2) { clearAim(); act(G.useScorch(state)); }
      return;
    case 'swap':
      if (pick === null || pick === i) pickFirst(i, lv > 0);
      else { const from = pick; clearAim(); act(G.useSwap(state, from, i)); }
      return;
    case 'scoot':
      if (pick !== null && G.scootTargets(state, pick).includes(i)) {
        const from = pick;
        clearAim();
        act(G.useScoot(state, from, i));
      } else {
        pickFirst(i, G.scootTargets(state, i).length > 0);
      }
      return;
    case 'teleport':
      if (pick !== null && pick !== i && !lv) {
        const from = pick;
        clearAim();
        act(G.useTeleport(state, from, i));
      } else {
        pickFirst(i, lv > 0);
      }
      return;
    case 'beam':
    case 'gravity':
      // Beam is dragged and Gravity is swiped or picked with its arrows, so a plain tap does nothing.
      return;
    case 'spin': {
      // A picked square stays picked until Spin is used or turned off.
      if (spinCorner !== null) return;
      spinCorner = x !== undefined
        ? squareAt(x, y).corner
        : Math.min(Math.floor(i / n), n - 2) * n + Math.min(i % n, n - 2);
      sfx('select');
      render();
      return;
    }
    case 'seed':
      clearAim();
      sfx('toolOff');
      break;
    default:
      break;
  }
  if (!lv) {
    if (selected !== null) sfx('deselect');
    selected = null;
    render();
    return;
  }
  if (selected !== null && G.canMerge(state, selected, i)) {
    act(G.merge(state, selected, i));
    return;
  }
  selected = selected === i ? null : i;
  sfx(selected === null ? 'deselect' : 'select');
  render();
}

// Controls

placeBtn.addEventListener('click', () => {
  if (busy) return;
  if (state.over) { showModePicker(true); return; }
  clearAim();
  act(G.place(state));
});

toolsEl.addEventListener('click', (e) => {
  const b = e.target.closest('.tool');
  if (!b || b.disabled || busy) return;
  const t = b.dataset.tool;
  selected = null;
  if (ITEMS[t].use === 'now') {
    clearAim();
    if (t === 'rewind') act(G.useRewind(state));
    else if (t === 'luxury') act(G.useLuxury(state));
    else if (t === 'bloom') act(G.useBloom(state));
    else if (t === 'shuffle') act(G.useShuffle(state));
    else if (t === 'monolith') act(G.useMonolith(state));
    return;
  }
  const on = mode !== t;
  clearAim();
  if (on) mode = t;
  sfx(on ? 'toolOn' : 'toolOff');
  render();
  // The demo plays by itself only the first time Beam is picked on this device.
  if (mode === 'beam' && !load(BEAM_DEMO_KEY)) {
    store(BEAM_DEMO_KEY, true);
    demoBeam();
  }
});

picker.addEventListener('click', (e) => {
  const lv = e.target.closest('.pick-option');
  if (lv) { clearAim(); act(G.useSeed(state, Number(lv.dataset.level)), 'seed'); }
});

spinLayer.addEventListener('click', (e) => {
  const arrow = e.target.closest('.spin-arc');
  if (arrow && spinCorner !== null) {
    const corner = spinCorner;
    clearAim();
    act(G.useSpin(state, corner, arrow.dataset.dir));
    return;
  }
  const h = e.target.closest('.spin-handle');
  if (!h || spinCorner !== null) return;
  spinCorner = Number(h.dataset.corner);
  sfx('select');
  render();
});

window.addEventListener('resize', renderSpinLayer);

$('menu-btn').addEventListener('click', showMenu);

const soundBtn = $('sound-btn');
function showMute() {
  soundBtn.classList.toggle('muted', isMuted());
  soundBtn.setAttribute('aria-label', isMuted() ? 'Sound off' : 'Sound on');
}
setMuted(load(MUTE_KEY) === true);
showMute();
soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  store(MUTE_KEY, isMuted());
  showMute();
  wake();
  sfx('toolOn');
});

const VOLUME_KEY = 'peeble.volume.v1';
// Saves from before the sliders kept only a music on or off flag.
const vol = { sfx: 0.8, music: load('peeble.music.v1') === false ? 0 : 0.8, ...(load(VOLUME_KEY) || {}) };
setSfxVolume(vol.sfx);
setMusicVolume(vol.music);
let audioReady = false;

// Music plays only while its volume is above zero, sound is unmuted, and the page is visible, so it costs no CPU otherwise.
function syncMusic() {
  if (!audioReady) return;
  if (vol.music > 0 && !isMuted() && !document.hidden) {
    const bus = musicBus();
    if (bus) startMusic(bus.ctx, bus.out);
  } else {
    stopMusic();
  }
}

function setVolume(kind, v) {
  vol[kind] = v;
  store(VOLUME_KEY, vol);
  if (kind === 'sfx') setSfxVolume(v);
  else setMusicVolume(v);
  wake();
}

// Browsers only start audio after a user gesture, and unlock() creates nothing while sound is muted or off.
function wake() {
  if (unlock()) audioReady = true;
  syncMusic();
}
document.addEventListener('pointerdown', wake, { capture: true, passive: true });
document.addEventListener('visibilitychange', syncMusic);

document.addEventListener('contextmenu', (e) => e.preventDefault());
// Some desktop and older mobile browsers still zoom or select on a double click.
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!overlay.hidden && overlay.dataset.dismiss === '1') closeSheet();
  else if (mode || selected !== null) { clearAim(); selected = null; render(); }
});

// Sheets

overlay.addEventListener('input', (e) => {
  const r = e.target.closest('[data-volume]');
  if (!r) return;
  setVolume(r.dataset.volume, r.value / 100);
  r.nextElementSibling.textContent = `${r.value}%`;
});
// A chime on release lets the player hear the new effects level.
overlay.addEventListener('change', (e) => {
  if (e.target.closest('[data-volume="sfx"]')) sfx('merge', 5);
});

const volumeRow = (kind, label) => {
  const pct = Math.round(vol[kind] * 100);
  return `<div class="volume-row"><span>${label}</span>
    <input type="range" min="0" max="100" step="1" value="${pct}" data-volume="${kind}" aria-label="${label} volume">
    <output>${pct}%</output></div>`;
};

function openSheet(html, dismissable = true) {
  sheet.innerHTML = html;
  overlay.dataset.dismiss = dismissable ? '1' : '0';
  overlay.hidden = false;
}

function closeSheet() {
  overlay.hidden = true;
  sheet.replaceChildren();
}

overlay.addEventListener('click', (e) => {
  if (e.target === overlay && overlay.dataset.dismiss === '1') { closeSheet(); return; }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  if (a === 'close') closeSheet();
  else if (a === 'new') showModePicker(true);
  else if (a === 'mode') chooseMode(btn.dataset.mode);
  else if (a === 'confirm-end') showConfirmEnd();
  else if (a === 'theme') {
    setTheme(btn.dataset.theme);
    render();
    for (const b of sheet.querySelectorAll('.theme-btn')) b.classList.toggle('active', b === btn);
    sfx('select');
  }
  else if (a === 'end') { closeSheet(); G.endRun(state); saveRun(); finishRun(); }
});

function tileHtml(level) {
  return `<span class="next-tile" style="display:inline-block;width:40px;height:40px">${blockEl(level).outerHTML}</span>`;
}

/** One card per mode, saying what tapping it does: keep playing, continue a saved run, or start a new one. */
function modeCards() {
  const today = G.dailyConfig(G.todayKey());
  return Object.entries(MODE_INFO).map(([id, info]) => {
    const drops = id === 'daily' ? today.drops : G.MODES[id].drops;
    const icons = drops.map((d) => `<span class="mode-icon" data-rarity="${d.rarity}" title="${ITEMS[d.item].name}">${ICONS[d.item]}</span>`).join('');
    const best = id === 'daily' ? todaysBest() : stats.modes[id].bestScore;
    const tint = id === 'daily' ? ` style="background: hsl(${today.hue} 45% 90%); border-color: hsl(${today.hue} 32% 62%); color: hsl(${today.hue} 35% 18%)"` : '';
    const here = id === state.mode && !firstShow;
    const status = here && !state.over ? 'Playing'
      : inProgress(id) && !here ? `Continue · ${fmt(runs[id].score)}`
      : 'New run';
    return `<button class="mode-card${here && !state.over ? ' current' : ''}" data-action="mode" data-mode="${id}"${tint}>
      <span class="mode-name">${info.name}</span>
      <span class="mode-icons">${icons}</span>
      <span class="mode-status">${status}</span>
      <span class="mode-best">${best ? `${id === 'daily' ? 'Today' : 'Best'} ${fmt(best)}` : '&nbsp;'}</span>
    </button>`;
  }).join('');
}

let firstShow = false;

function showModePicker(dismissable) {
  firstShow = !dismissable;
  const cards = modeCards();
  firstShow = false;
  openSheet(`
    <h2>${dismissable ? 'Pick a mode' : 'New run'}</h2>
    <div class="modes">${cards}</div>
    ${dismissable ? '<div class="sheet-actions"><button class="btn" data-action="close">Back</button></div>' : ''}`, dismissable);
}

function showGameOver(isBest) {
  const title = state.ended === 'retry' ? 'Run ended' : 'No moves left';
  openSheet(`
    <h2>${title}</h2>
    <div class="result-row"><span>Score</span><strong>${fmt(state.score)}</strong></div>
    <div class="result-row"><span>Highest block</span>${state.highest ? tileHtml(state.highest) : '<strong>-</strong>'}</div>
    <div class="result-row"><span>Level reached</span><strong>${state.plv}</strong></div>
    <div class="result-row"><span>${bestLabel()}</span><strong>${fmt(modeStats().bestScore)}</strong></div>
    ${isBest ? '<p class="new-best">New best score</p>' : ''}
    <div class="sheet-actions">
      <button class="btn primary" data-action="new">New run</button>
      <button class="btn" data-action="close">View board</button>
    </div>`, false);
}

function showMenu() {
  const slots = [];
  for (let lv = 1; lv <= G.CONFIG.maxLevel; lv++) {
    slots.push(`<div class="slot">${stats.seen.includes(lv) ? blockEl(lv).outerHTML : ''}</div>`);
  }
  const themeBtns = themesFor(state.mode).map((t) => {
    const preview = t.icons
      ? [1, 7, 14].map((lv) => `<img src="assets/blocks/${t.id}/${lv}.svg" alt="" draggable="false">`).join('')
      : '<span class="theme-nums">1 2 3</span>';
    return `<button class="theme-btn${t.id === theme.id ? ' active' : ''}" data-action="theme" data-theme="${t.id}">
      <span class="theme-preview">${preview}</span><span>${t.name}</span></button>`;
  }).join('');
  const drops = G.modeOf(state).drops;
  const ms = modeStats();
  openSheet(`
    <h2>Mode</h2>
    <div class="modes">${modeCards()}</div>
    <h2>Sound</h2>
    <div class="volumes">${volumeRow('music', 'Music')}${volumeRow('sfx', 'Effects')}</div>
    <h2>Blocks</h2>
    <div class="themes">${themeBtns}</div>
    <h2>How to play</h2>
    <ul>
      <li>Press Place to drop the next block on a random empty tile.</li>
      <li>Drag a block onto a matching block above, below, or beside it to merge them.</li>
      <li>Bigger blocks are worth more points.</li>
      <li>The run ends when the board is full, nothing can merge, and no item can help.</li>
    </ul>
    <h2>${MODE_INFO[state.mode].name} items</h2>
    <ul>${drops.map((d) => `<li>${ITEMS[d.item].rule}</li>`).join('')}</ul>
    <h2>Levels</h2>
    <ul>
      <li>Each merge fills the level bar.</li>
      <li>Each new level gives you a random item.</li>
      <li>The colored line under an item shows how rare it is.</li>
      <li>You can hold up to ${andList(drops.map((d) => `${d.cap} ${ITEMS[d.item].name.toLowerCase()}`))}.</li>
      <li>Your level starts over each run.</li>
    </ul>
    <h2>Collection</h2>
    <div class="collection">${slots.join('')}</div>
    <div class="result-row"><span>${bestLabel()}</span><strong>${fmt(ms.bestScore)}</strong></div>
    <div class="result-row"><span>${runsLabel()}</span><strong>${fmt(ms.runs)}</strong></div>
    <div class="sheet-actions">
      ${state.over ? '<button class="btn primary" data-action="new">New run</button>' : '<button class="btn danger" data-action="confirm-end">End run</button>'}
      <button class="btn" data-action="close">Close</button>
    </div>`);
}

function showConfirmEnd() {
  openSheet(`
    <h2>End this run?</h2>
    <div class="result-row"><span>Score</span><strong>${fmt(state.score)}</strong></div>
    <div class="sheet-actions">
      <button class="btn danger" data-action="end">End run</button>
      <button class="btn" data-action="close">Keep playing</button>
    </div>`);
}

applyMode();
render();
if (firstVisit) showModePicker(false);
else if (state.over && !state.recorded) finishRun();
