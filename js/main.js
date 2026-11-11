import * as G from './engine.js';
import { sfx, unlock, setMuted, isMuted, musicBus, setSfxVolume, setMusicVolume } from './audio.js';
import { startMusic, stopMusic, setIntensity } from './music.js';

const RUN_KEY = 'peeble.run.v1';
const STATS_KEY = 'peeble.stats.v1';
const MUTE_KEY = 'peeble.muted.v1';

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

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const fmt = (n) => n.toLocaleString('en-US');
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`);

let stats = { bestScore: 0, bestLevel: 0, runs: 0, seen: [], ...(load(STATS_KEY) || {}) };
let state = load(RUN_KEY);
if (!G.isValidState(state)) state = G.newGame();
G.migrate(state);

let mode = null;      // null | 'hammer' | 'blueprint' | 'seed'
let selected = null;  // index of the selected block
let press = null;     // active pointer on the board

const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const wrapEl = $('board-wrap');
const scoreEl = $('score');
const bestEl = $('best');
const nextEl = $('next-tile');
const placeBtn = $('place-btn');
const placeLabel = placeBtn.querySelector('.place-label');
const toolsEl = $('tools');
const seedPicker = $('seed-picker');
const overlay = $('overlay');
const sheet = $('sheet');
const plvEl = $('plv');
const xpFill = $('xp-fill');
const xpText = $('xp-text');
const toast = $('drop-toast');

const ITEM_NAMES = { hammer: 'Hammer', rewind: 'Rewind', blueprint: 'Blueprint', seed: 'Seed' };
const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic'];

for (const btn of toolsEl.querySelectorAll('.tool')) {
  const d = G.CONFIG.drops.find((x) => x.item === btn.dataset.tool);
  if (d) {
    btn.dataset.rarity = d.rarity;
    btn.title += `. ${RARITY_NAMES[d.rarity]}, max ${d.cap}.`;
  }
}
// Buttons run from most common to rarest, so the order follows CONFIG.drops.
[...toolsEl.querySelectorAll('.tool')]
  .sort((a, b) => Number(a.dataset.rarity) - Number(b.dataset.rarity))
  .forEach((btn) => toolsEl.appendChild(btn));

const cellCount = G.CONFIG.size * G.CONFIG.size;
const cells = [];
for (let i = 0; i < cellCount; i++) {
  const c = document.createElement('div');
  c.className = 'cell';
  c.dataset.i = i;
  boardEl.appendChild(c);
  cells.push(c);
}

// Icon sets have one SVG per level in assets/blocks/<theme>/<level>.svg.
const THEMES = [
  { id: 'garden', name: 'Garden', icons: 14 },
  { id: 'fruit', name: 'Fruit', icons: 14 },
  { id: 'animals', name: 'Animals', icons: 14 },
  { id: 'sweets', name: 'Sweets', icons: 14 },
  { id: 'numbers', name: 'Numbers', icons: 0 },
];
const THEME_KEY = 'peeble.theme.v1';
let theme = THEMES.find((t) => t.id === load(THEME_KEY)) || THEMES[0];

function setTheme(id) {
  theme = THEMES.find((t) => t.id === id) || THEMES[0];
  store(THEME_KEY, theme.id);
  document.body.classList.toggle('themed', theme.icons > 0);
  for (let lv = 1; lv <= theme.icons; lv++) new Image().src = iconUrl(lv);
  buildSeedPicker();
}

const iconUrl = (level) => `assets/blocks/${theme.id}/${level}.svg`;

function buildSeedPicker() {
  seedPicker.replaceChildren();
  for (const lv of G.CONFIG.seedLevels) {
    const b = document.createElement('button');
    b.className = 'seed-option';
    b.dataset.level = lv;
    b.setAttribute('aria-label', `Level ${lv}`);
    b.appendChild(blockEl(lv));
    seedPicker.appendChild(b);
  }
}

function blockEl(level) {
  const b = document.createElement('div');
  b.className = 'block' + (level >= G.CONFIG.maxLevel ? ' max' : '');
  const [c, t] = COLORS[level] || ['#333333', '#ffffff'];
  b.style.setProperty('--c', c);
  b.style.setProperty('--t', t);
  if (level <= theme.icons) {
    b.innerHTML = `<img class="icon" src="${iconUrl(level)}" alt="Level ${level}" draggable="false"><span class="corner">${level}</span>`;
  } else {
    b.innerHTML = `<span class="block-inner"><span class="lv">Lv</span><span class="num">${level}</span></span>`;
  }
  return b;
}

setTheme(theme.id);

function render(ev = null) {
  const targets = selected !== null ? G.mergeTargets(state, selected) : [];
  for (let i = 0; i < cellCount; i++) {
    const c = cells[i];
    const lv = state.board[i];
    c.replaceChildren();
    c.className = 'cell';
    if (lv) c.appendChild(blockEl(lv));
    if (i === selected) c.classList.add('selected');
    if (targets.includes(i)) c.classList.add('target');
    if (mode === 'blueprint' && !lv) c.classList.add('can-place');
    if (mode === 'hammer' && lv) c.classList.add('hammer-target');
  }

  if (ev && ev.cell !== undefined && ev.type !== 'hammer') {
    const b = cells[ev.cell].firstChild;
    if (b) b.classList.add(ev.type === 'merge' ? 'merge-pop' : 'pop');
    if (ev.points) floatPoints(ev.cell, ev.points);
  }

  scoreEl.textContent = fmt(state.score);
  bestEl.textContent = fmt(Math.max(stats.bestScore, state.score));
  nextEl.replaceChildren(blockEl(state.next));

  const empty = G.emptyCells(state).length;
  const filled = cellCount - empty;
  setIntensity(filled / cellCount);
  const it = state.items;
  const avail = {
    hammer: it.hammer > 0 && filled > 0,
    rewind: it.rewind > 0 && state.history.length > 0,
    blueprint: it.blueprint > 0 && empty > 0,
    seed: it.seed > 0 && empty > 0,
  };
  const stuck = !state.over && G.isStuck(state);
  for (const btn of toolsEl.querySelectorAll('.tool')) {
    const t = btn.dataset.tool;
    btn.disabled = state.over || !avail[t];
    btn.classList.toggle('active', mode === t);
    btn.classList.toggle('rescue', stuck && avail[t] && mode !== t);
    const badge = btn.querySelector('.badge');
    badge.textContent = it[t];
    badge.classList.toggle('full', it[t] >= G.capOf(t));
  }

  const need = G.xpNeeded(state.plv);
  plvEl.textContent = state.plv;
  xpFill.style.width = Math.min(100, (state.xp / need) * 100) + '%';
  xpText.textContent = `${state.xp} / ${need}`;
  if (mode && (state.over || !avail[mode])) mode = null;
  seedPicker.hidden = mode !== 'seed';

  placeLabel.textContent = state.over ? 'New run' : 'Place';
  nextEl.hidden = state.over;
  placeBtn.disabled = !state.over && empty === 0;
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

function playFor(ev, via) {
  if (ev.type === 'place') sfx('place', ev.level);
  else if (ev.type === 'merge') sfx(ev.level >= G.CONFIG.maxLevel ? 'max' : 'merge', ev.level);
  else if (ev.type === 'hammer') sfx('smash');
  else if (ev.type === 'rewind') sfx('rewind');
  if (via === 'blueprint' || via === 'seed') sfx(via);
}

function act(ev, via = null) {
  if (!ev) { render(); return; }
  playFor(ev, via);
  selected = null;
  if (ev.type === 'place' || ev.type === 'merge') {
    if (!stats.seen.includes(ev.level)) stats.seen.push(ev.level);
    stats.bestLevel = Math.max(stats.bestLevel, ev.level);
    store(STATS_KEY, stats);
  }
  if (ev.type === 'merge' && navigator.vibrate) navigator.vibrate(12);
  store(RUN_KEY, state);
  render(ev);
  if (ev.levelUp) showLevelUp(ev.levelUp);
  if (ev.type === 'hammer') {
    const ghost = blockEl(ev.level);
    ghost.classList.add('smash');
    ghost.addEventListener('animationend', () => ghost.remove());
    cells[ev.cell].appendChild(ghost);
  }
  if (state.over) finishRun();
}

let toastTimer = null;
function showLevelUp(lu) {
  plvEl.classList.remove('bump');
  void plvEl.offsetWidth;
  plvEl.classList.add('bump');
  const icon = lu.item ? toolsEl.querySelector(`[data-tool="${lu.item}"] svg`).outerHTML : '';
  toast.innerHTML = lu.item
    ? `<div class="toast-level">Level ${lu.plv}</div>
       <div class="toast-item">${icon}<span>${ITEM_NAMES[lu.item]} +1</span></div>
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
  if (lu.item) {
    const btn = toolsEl.querySelector(`[data-tool="${lu.item}"]`);
    btn.classList.remove('gain');
    void btn.offsetWidth;
    btn.classList.add('gain');
  }
  setTimeout(() => sfx('levelUp', lu.item ? lu.rarity : 0), 250);
}

function finishRun() {
  let isBest = false;
  if (!state.recorded) {
    isBest = state.score > stats.bestScore;
    stats.bestScore = Math.max(stats.bestScore, state.score);
    stats.runs++;
    state.recorded = true;
    store(STATS_KEY, stats);
    store(RUN_KEY, state);
    sfx(isBest ? 'best' : 'over');
  }
  render();
  showGameOver(isBest);
}

function newRun() {
  state = G.newGame();
  mode = null;
  selected = null;
  store(RUN_KEY, state);
  closeSheet();
  render();
  sfx('newRun');
}

// Board input: tap to select or apply a tool, drag to merge.

function cellAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const c = el && el.closest('.cell');
  return c && boardEl.contains(c) ? Number(c.dataset.i) : null;
}

boardEl.addEventListener('pointerdown', (e) => {
  if (state.over || press) return;
  const i = cellAt(e.clientX, e.clientY);
  if (i === null) return;
  press = { id: e.pointerId, cell: i, x: e.clientX, y: e.clientY, dragging: false, ghost: null, hover: null };
  boardEl.setPointerCapture(e.pointerId);
});

boardEl.addEventListener('pointermove', (e) => {
  if (!press || e.pointerId !== press.id) return;
  if (!press.dragging) {
    if (mode || state.board[press.cell] === 0) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10) return;
    startDrag();
  }
  moveGhost(e.clientX, e.clientY);
});

boardEl.addEventListener('pointerup', (e) => {
  if (!press || e.pointerId !== press.id) return;
  const p = press;
  press = null;
  const to = cellAt(e.clientX, e.clientY);
  if (p.dragging) {
    p.ghost.remove();
    if (to !== null && G.canMerge(state, p.cell, to)) {
      act(G.merge(state, p.cell, to));
    } else {
      selected = null;
      sfx('deselect');
      render();
    }
    return;
  }
  if (to === p.cell) tap(to);
});

boardEl.addEventListener('pointercancel', () => {
  if (!press) return;
  if (press.ghost) press.ghost.remove();
  press = null;
  selected = null;
  render();
});

function startDrag() {
  press.dragging = true;
  if (selected !== press.cell) sfx('select');
  selected = press.cell;
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
  const hover = over !== null && G.canMerge(state, press.cell, over) ? over : null;
  if (hover === press.hover) return;
  if (press.hover !== null) cells[press.hover].classList.remove('drop-hover');
  if (hover !== null) cells[hover].classList.add('drop-hover');
  press.hover = hover;
}

function tap(i) {
  const lv = state.board[i];
  if (mode === 'hammer') {
    if (lv) { mode = null; act(G.useHammer(state, i)); }
    return;
  }
  if (mode === 'blueprint') {
    if (!lv) { mode = null; act(G.useBlueprint(state, i), 'blueprint'); }
    return;
  }
  if (mode === 'seed') { mode = null; sfx('toolOff'); }
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
  if (state.over) { newRun(); return; }
  mode = null;
  act(G.place(state));
});

toolsEl.addEventListener('click', (e) => {
  const b = e.target.closest('.tool');
  if (!b || b.disabled) return;
  const t = b.dataset.tool;
  selected = null;
  if (t === 'rewind') {
    mode = null;
    act(G.useRewind(state));
    return;
  }
  mode = mode === t ? null : t;
  sfx(mode ? 'toolOn' : 'toolOff');
  render();
});

seedPicker.addEventListener('click', (e) => {
  const b = e.target.closest('.seed-option');
  if (!b) return;
  mode = null;
  act(G.useSeed(state, Number(b.dataset.level)), 'seed');
});

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
  syncMusic();
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
  else { setMusicVolume(v); syncMusic(); }
}

// Browsers only allow audio to start inside a user gesture.
document.addEventListener('pointerdown', () => {
  if (!unlock()) return;
  if (!audioReady) { audioReady = true; syncMusic(); }
}, { capture: true, passive: true });
document.addEventListener('visibilitychange', syncMusic);

document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!overlay.hidden && overlay.dataset.dismiss === '1') closeSheet();
  else if (mode || selected !== null) { mode = null; selected = null; render(); }
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
  else if (a === 'new') newRun();
  else if (a === 'confirm-end') showConfirmEnd();
  else if (a === 'theme') {
    setTheme(btn.dataset.theme);
    render();
    for (const b of sheet.querySelectorAll('.theme-btn')) b.classList.toggle('active', b === btn);
    sfx('select');
  }
  else if (a === 'end') { closeSheet(); G.endRun(state); store(RUN_KEY, state); finishRun(); }
});

function tileHtml(level) {
  return `<span class="next-tile" style="display:inline-block;width:40px;height:40px">${blockEl(level).outerHTML}</span>`;
}

function showGameOver(isBest) {
  const title = state.ended === 'retry' ? 'Run ended' : 'No moves left';
  openSheet(`
    <h2>${title}</h2>
    <div class="result-row"><span>Score</span><strong>${fmt(state.score)}</strong></div>
    <div class="result-row"><span>Highest block</span>${state.highest ? tileHtml(state.highest) : '<strong>-</strong>'}</div>
    <div class="result-row"><span>Level reached</span><strong>${state.plv}</strong></div>
    <div class="result-row"><span>Best score</span><strong>${fmt(stats.bestScore)}</strong></div>
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
  const themeBtns = THEMES.map((t) => {
    const preview = t.icons
      ? [1, 7, 14].map((lv) => `<img src="assets/blocks/${t.id}/${lv}.svg" alt="" draggable="false">`).join('')
      : '<span class="theme-nums">1 2 3</span>';
    return `<button class="theme-btn${t.id === theme.id ? ' active' : ''}" data-action="theme" data-theme="${t.id}">
      <span class="theme-preview">${preview}</span><span>${t.name}</span></button>`;
  }).join('');
  openSheet(`
    <h2>Sound</h2>
    <div class="volumes">${volumeRow('music', 'Music')}${volumeRow('sfx', 'Effects')}</div>
    <h2>Blocks</h2>
    <div class="themes">${themeBtns}</div>
    <h2>How to play</h2>
    <ul>
      <li>Press Place to drop the next block on a random empty tile.</li>
      <li>Drag a block onto a matching block above, below, or beside it to merge them.</li>
      <li>Bigger blocks are worth more points.</li>
      <li>The run ends when the board is full, nothing can merge, and you have no Hammer or Rewind to use.</li>
    </ul>
    <h2>Items</h2>
    <ul>
      <li>Hammer removes a block.</li>
      <li>Rewind undoes your last move, up to ${G.CONFIG.undoDepth} times in a row.</li>
      <li>Blueprint lets you pick where the next block goes.</li>
      <li>Seed places a block of level 1 to 5 that you choose.</li>
    </ul>
    <h2>Levels</h2>
    <ul>
      <li>Each merge fills the level bar.</li>
      <li>Each new level gives you a random item.</li>
      <li>The colored line under an item shows how rare it is.</li>
      <li>You can hold up to ${andList(G.CONFIG.drops.map((d) => `${d.cap} ${ITEM_NAMES[d.item].toLowerCase()}s`))}.</li>
      <li>Your level starts over each run.</li>
    </ul>
    <h2>Collection</h2>
    <div class="collection">${slots.join('')}</div>
    <div class="result-row"><span>Best score</span><strong>${fmt(stats.bestScore)}</strong></div>
    <div class="result-row"><span>Runs played</span><strong>${fmt(stats.runs)}</strong></div>
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

render();
if (state.over && !state.recorded) finishRun();
