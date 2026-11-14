// Game rules with no DOM access, so tests can run them in Node.

export const CONFIG = {
  size: 4,
  maxLevel: 14,
  // Index is the block level. Index 0 is unused.
  spawnWeights: [0, 60, 30, 10],
  diagonal: false,
  undoDepth: 3,
  pointsBase: 100,
  seedLevels: [1, 2, 3, 4, 5],
  luxuryPlacements: 3,
  bloomCount: 3,
  // Monolith lifts last for this many placements and merges.
  monolithMoves: 3,
  // Monolith lifts this share of the blocks, each by 1 up to this many levels.
  monolithShare: 0.75,
  monolithMaxLift: 3,
  // A merge gives XP equal to the new block's level. Level n needs min(base + step * (n - 1), max) XP.
  xp: { base: 50, step: 22, max: 360 },
  rarities: ['common', 'uncommon', 'rare', 'epic'],
  // Points awarded instead of an item when every item is at its cap.
  fullBonus: 2000,
};

// Each mode has its own items. A level-up drops one of them, and items at their cap are left out of the roll.
export const MODES = {
  classic: {
    startItems: { rewind: 3, hammer: 3, blueprint: 3, swap: 1, seed: 1 },
    drops: [
      { item: 'rewind', rarity: 0, weight: 46, cap: 6 },
      { item: 'hammer', rarity: 1, weight: 26, cap: 5 },
      { item: 'blueprint', rarity: 2, weight: 12, cap: 5 },
      { item: 'swap', rarity: 2, weight: 10, cap: 4 },
      { item: 'seed', rarity: 3, weight: 6, cap: 3 },
    ],
  },
  fall: {
    startItems: { scoot: 3, spin: 2, luxury: 1, scorch: 0, bloom: 0 },
    drops: [
      { item: 'scoot', rarity: 0, weight: 45, cap: 6 },
      { item: 'spin', rarity: 1, weight: 26, cap: 5 },
      { item: 'luxury', rarity: 1, weight: 17, cap: 2 },
      { item: 'scorch', rarity: 2, weight: 8, cap: 1 },
      { item: 'bloom', rarity: 3, weight: 4, cap: 1 },
    ],
  },
  space: {
    startItems: { shuffle: 2, teleport: 2, beam: 2, gravity: 1, monolith: 0 },
    drops: [
      { item: 'shuffle', rarity: 0, weight: 40, cap: 5 },
      { item: 'beam', rarity: 1, weight: 26, cap: 4 },
      { item: 'teleport', rarity: 1, weight: 18, cap: 3 },
      { item: 'gravity', rarity: 2, weight: 11, cap: 3 },
      { item: 'monolith', rarity: 3, weight: 5, cap: 1 },
    ],
  },
  valentines: {
    startItems: { dance: 3, kiss: 2, longDistance: 1, jewelry: 0, love: 0 },
    drops: [
      { item: 'dance', rarity: 0, weight: 40, cap: 6 },
      { item: 'kiss', rarity: 1, weight: 28, cap: 6 },
      { item: 'longDistance', rarity: 2, weight: 16, cap: 2 },
      { item: 'jewelry', rarity: 2, weight: 11, cap: 1 },
      { item: 'love', rarity: 3, weight: 5, cap: 1 },
    ],
  },
  // A Daily run carries the day's draw in `state.daily`, so this entry only marks the mode as known.
  daily: { startItems: {}, drops: [] },
};

const CELLS = CONFIG.size * CONFIG.size;

export const modeOf = (s) => (s.mode === 'daily' && s.daily ? s.daily : MODES[s.mode] || MODES.classic);

// Seeded randomness. A run with `rngState` draws every random number from it and saves the state with the run,
// so the same moves on the same day always give the same results.

/** A 32-bit hash of a string (FNV-1a). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (const ch of str) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** One step of a 32-bit generator: returns the next state and a number in [0, 1). */
function stepRng(state) {
  const next = (state + 0x6d2b79f5) >>> 0;
  let x = next;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return [next, ((x ^ (x >>> 14)) >>> 0) / 4294967296];
}

/** The random source for a run: its saved seed when it has one, otherwise Math.random. */
export function rngFor(s) {
  if (typeof s?.rngState !== 'number') return Math.random;
  return () => {
    const [next, value] = stepRng(s.rngState);
    s.rngState = next;
    return value;
  };
}

/** Today's date on the player's clock, as YYYY-MM-DD. */
export function todayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAILY_ITEMS = 5;
const RARITY_WEIGHT = [42, 26, 12, 5];

/** The day's draw: five items from every mode with their usual rarity and cap, and a hue for the colors. */
export function dailyConfig(date) {
  let state = hashString('peeble-daily-items:' + date);
  const rand = () => { const [next, value] = stepRng(state); state = next; return value; };
  const pool = [];
  for (const [m, def] of Object.entries(MODES)) {
    for (const d of def.drops) pool.push({ ...d, start: def.startItems[d.item] ?? 0, from: m });
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, DAILY_ITEMS).sort((a, b) => a.rarity - b.rarity);
  return {
    date,
    hue: Math.floor(rand() * 360),
    drops: picked.map((d) => ({ item: d.item, rarity: d.rarity, weight: RARITY_WEIGHT[d.rarity], cap: d.cap })),
    startItems: Object.fromEntries(picked.map((d) => [d.item, Math.min(d.start, 2)])),
  };
}

export function capFor(s, item) {
  const d = modeOf(s).drops.find((x) => x.item === item);
  return d ? d.cap : Infinity;
}

export function xpNeeded(plv) {
  const x = CONFIG.xp;
  return Math.min(x.base + x.step * (plv - 1), x.max);
}

export function capOf(item, mode = 'classic') {
  const d = (MODES[mode] || MODES.classic).drops.find((x) => x.item === item);
  return d ? d.cap : Infinity;
}

export function rollDrop(s, rng = rngFor(s)) {
  const pool = modeOf(s).drops.filter((d) => (s.items[d.item] ?? 0) < d.cap);
  if (!pool.length) return null;
  let r = rng() * pool.reduce((n, d) => n + d.weight, 0);
  for (const d of pool) {
    r -= d.weight;
    if (r < 0) return d;
  }
  return pool[pool.length - 1];
}

// XP and player level are left out of rewind snapshots, so a merge and rewind loop cannot repeat a level-up.
function gainXp(s, amount, rng) {
  s.xp += amount;
  const need = xpNeeded(s.plv);
  if (s.xp < need) return null;
  s.xp -= need;
  s.plv++;
  const d = rollDrop(s, rng);
  if (d) {
    s.items[d.item] = (s.items[d.item] ?? 0) + 1;
    return { plv: s.plv, item: d.item, rarity: d.rarity };
  }
  s.score += CONFIG.fullBonus;
  return { plv: s.plv, item: null, bonus: CONFIG.fullBonus };
}

export function points(level) {
  return CONFIG.pointsBase * 2 ** level;
}

export function rollLevel(rng = Math.random) {
  const w = CONFIG.spawnWeights;
  let total = 0;
  for (let i = 1; i < w.length; i++) total += w[i];
  let r = rng() * total;
  for (let i = 1; i < w.length; i++) {
    r -= w[i];
    if (r < 0) return i;
  }
  return w.length - 1;
}

export function newGame(rng = Math.random, mode = 'classic', date = todayKey()) {
  const m = MODES[mode] ? mode : 'classic';
  const daily = m === 'daily' ? dailyConfig(date) : undefined;
  const s = {
    mode: m,
    daily,
    rngState: daily ? hashString('peeble-daily-board:' + date) : undefined,
    board: new Array(CELLS).fill(0),
    next: 0,
    score: 0,
    highest: 0,
    items: { ...(daily ? daily.startItems : MODES[m].startItems) },
    luxury: [],
    // How many levels Monolith has lifted each tile, and how many moves the lift has left.
    lift: new Array(CELLS).fill(0),
    monolith: 0,
    plv: 1,
    xp: 0,
    history: [],
    over: false,
    ended: null,
  };
  if (!daily) { delete s.daily; delete s.rngState; }
  s.next = rollLevel(daily ? rngFor(s) : rng);
  return s;
}

export function neighbors(i) {
  const n = CONFIG.size;
  const r = Math.floor(i / n);
  const c = i % n;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (!CONFIG.diagonal && dr !== 0 && dc !== 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
    }
  }
  return out;
}

export function emptyCells(s) {
  const out = [];
  for (let i = 0; i < CELLS; i++) if (s.board[i] === 0) out.push(i);
  return out;
}

export function canMerge(s, from, to) {
  if (s.over || from === to) return false;
  const lv = s.board[from];
  if (lv === 0 || lv >= CONFIG.maxLevel || s.board[to] !== lv) return false;
  return neighbors(from).includes(to);
}

export function mergeTargets(s, from) {
  return neighbors(from).filter((to) => canMerge(s, from, to));
}

export function hasMerge(s) {
  for (let i = 0; i < CELLS; i++) if (mergeTargets(s, i).length) return true;
  return false;
}

function snapshot(s) {
  s.history.push({ board: s.board.slice(), next: s.next, score: s.score, highest: s.highest, luxury: s.luxury.slice(), lift: s.lift.slice(), monolith: s.monolith });
  if (s.history.length > CONFIG.undoDepth) s.history.shift();
}

/** Moves a tile's block and its Monolith lift together. */
function moveTile(s, from, to) {
  s.board[to] = s.board[from];
  s.lift[to] = s.lift[from];
  s.board[from] = 0;
  s.lift[from] = 0;
}

function clearTile(s, cell) {
  s.board[cell] = 0;
  s.lift[cell] = 0;
}

/** Counts down a Monolith lift after a placement or merge, and drops lifted tiles back when it runs out. */
function tickMonolith(s) {
  if (!(s.monolith > 0)) return null;
  s.monolith--;
  if (s.monolith > 0) return null;
  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    if (s.lift[i] > 0) {
      s.board[i] = Math.max(1, s.board[i] - s.lift[i]);
      s.lift[i] = 0;
      cells.push(i);
    }
  }
  return cells;
}

function addBlock(s, cell, level) {
  s.board[cell] = level;
  const gained = points(level);
  s.score += gained;
  if (level > s.highest) s.highest = level;
  return gained;
}

/** How many levels Luxury adds to the next placed block. */
export const boost = (s) => s.luxury.length;

/** The level the next Place will drop, after any Luxury boost. */
export const nextLevel = (s) => Math.min(s.next + boost(s), CONFIG.maxLevel);

/** True when the board is full and no blocks can merge. */
export function isStuck(s) {
  return emptyCells(s).length === 0 && !hasMerge(s);
}

/** A pair of tiles whose swap leaves a merge on the board, or null. */
export function findHelpfulSwap(s) {
  const b = s.board;
  for (let i = 0; i < CELLS; i++) {
    for (let j = i + 1; j < CELLS; j++) {
      if (b[i] === b[j]) continue;
      [b[i], b[j]] = [b[j], b[i]];
      const helps = hasMerge(s);
      [b[i], b[j]] = [b[j], b[i]];
      if (helps) return [i, j];
    }
  }
  return null;
}

/** Top-left cells of every 2 by 2 square on the board. */
export function spinCorners() {
  const n = CONFIG.size;
  const out = [];
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) out.push(r * n + c);
  return out;
}

/** The four cells of a square in clockwise order from its top-left corner. */
export function spinRing(corner) {
  const n = CONFIG.size;
  return [corner, corner + 1, corner + n + 1, corner + n];
}

function rotated(board, corner, dir) {
  // Also turns the Monolith lift array, which has the same shape as the board.
  const ring = spinRing(corner);
  const out = board.slice();
  const step = dir === 'cw' ? 1 : 3;
  ring.forEach((cell, k) => { out[ring[(k + step) % 4]] = board[cell]; });
  return out;
}

/** A square and direction whose spin leaves a merge on the board, or null. */
export function findHelpfulSpin(s) {
  for (const corner of spinCorners()) {
    for (const dir of ['cw', 'ccw']) {
      if (hasMerge({ ...s, board: rotated(s.board, corner, dir) })) return [corner, dir];
    }
  }
  return null;
}

const scorchCells = (s) => s.board.flatMap((v, i) => (v === 1 || v === 2 ? [i] : []));
const bloomCells = (s) => s.board.flatMap((v, i) => (v > 0 && v < CONFIG.maxLevel ? [i] : []));

/** True when some block has an empty tile next to it. */
export function canScoot(s) {
  return s.board.some((v, i) => v > 0 && neighbors(i).some((j) => s.board[j] === 0));
}

export function scootTargets(s, from) {
  return s.board[from] ? neighbors(from).filter((j) => s.board[j] === 0) : [];
}

/** The items that can free a stuck board right now. */
export function rescueItems(s) {
  const it = s.items;
  const out = [];
  if (it.rewind > 0 && s.history.length > 0) out.push('rewind');
  if (it.hammer > 0) out.push('hammer');
  if (it.swap > 0 && findHelpfulSwap(s)) out.push('swap');
  if (it.spin > 0 && findHelpfulSpin(s)) out.push('spin');
  if (it.scorch > 0 && scorchCells(s).length) out.push('scorch');
  if (it.bloom > 0 && bloomCells(s).length) out.push('bloom');
  if (it.shuffle > 0 && hasPair(s)) out.push('shuffle');
  if (it.beam > 0 && findHelpfulBeam(s)) out.push('beam');
  if (it.monolith > 0 && !(s.monolith > 0) && bloomCells(s).length) out.push('monolith');
  if (it.dance > 0 && findHelpfulDance(s)) out.push('dance');
  if (it.kiss > 0 && canKiss(s)) out.push('kiss');
  if (it.longDistance > 0 && hasPair(s)) out.push('longDistance');
  if (it.jewelry > 0 && jewelryHelps(s)) out.push('jewelry');
  if (it.love > 0 && hasPair(s)) out.push('love');
  return out;
}

export function canRescue(s) {
  return rescueItems(s).length > 0;
}

function checkOver(s) {
  if (isStuck(s) && !canRescue(s)) {
    s.over = true;
    s.ended = 'stuck';
  }
}

// Places the upcoming block. Without a cell it goes to a random empty tile.
export function place(s, rng = rngFor(s), cell = null) {
  if (s.over) return null;
  const empty = emptyCells(s);
  if (!empty.length) return null;
  if (cell !== null && s.board[cell] !== 0) return null;
  const target = cell ?? empty[Math.floor(rng() * empty.length)];
  snapshot(s);
  const level = nextLevel(s);
  const boosted = level - s.next;
  s.luxury = s.luxury.map((n) => n - 1).filter((n) => n > 0);
  const gained = addBlock(s, target, level);
  s.lift[target] = 0;
  s.next = rollLevel(rng);
  const reverted = tickMonolith(s);
  checkOver(s);
  return { type: 'place', cell: target, level, boosted, points: gained, reverted };
}

export function merge(s, from, to, rng = rngFor(s)) {
  if (!canMerge(s, from, to)) return null;
  snapshot(s);
  const level = s.board[to] + 1;
  clearTile(s, from);
  // A block made from a lifted tile keeps its new level.
  s.lift[to] = 0;
  const gained = addBlock(s, to, level);
  const levelUp = gainXp(s, level, rng);
  const reverted = tickMonolith(s);
  checkOver(s);
  return { type: 'merge', from, cell: to, level, points: gained, xp: level, levelUp, reverted };
}

export function useBlueprint(s, cell, rng = rngFor(s)) {
  if (!(s.items.blueprint > 0)) return null;
  const ev = place(s, rng, cell);
  if (ev) s.items.blueprint--;
  return ev;
}

export function useSeed(s, level, rng = rngFor(s)) {
  if (s.over || !(s.items.seed > 0) || !CONFIG.seedLevels.includes(level)) return null;
  const empty = emptyCells(s);
  if (!empty.length) return null;
  snapshot(s);
  const target = empty[Math.floor(rng() * empty.length)];
  const gained = addBlock(s, target, level);
  s.lift[target] = 0;
  s.items.seed--;
  checkOver(s);
  return { type: 'place', cell: target, level, points: gained };
}

export function useHammer(s, cell) {
  if (s.over || !(s.items.hammer > 0) || s.board[cell] === 0) return null;
  const level = s.board[cell];
  clearTile(s, cell);
  s.items.hammer--;
  s.history = [];
  return { type: 'hammer', cell, level };
}

/** Trades the contents of two tiles. The first must hold a block, and the second may be empty. */
export function useSwap(s, a, b) {
  if (s.over || !(s.items.swap > 0) || a === b || s.board[a] === 0) return null;
  snapshot(s);
  [s.board[a], s.board[b]] = [s.board[b], s.board[a]];
  [s.lift[a], s.lift[b]] = [s.lift[b], s.lift[a]];
  s.items.swap--;
  checkOver(s);
  return { type: 'swap', a, b };
}

export function useRewind(s) {
  if (s.over || !(s.items.rewind > 0) || !s.history.length) return null;
  const snap = s.history.pop();
  s.board = snap.board;
  s.next = snap.next;
  s.score = snap.score;
  s.highest = snap.highest;
  s.luxury = snap.luxury ?? [];
  s.lift = snap.lift ?? new Array(CELLS).fill(0);
  s.monolith = snap.monolith ?? 0;
  s.items.rewind--;
  return { type: 'rewind' };
}

/** Moves a block one tile up, down, left, or right into an empty tile. */
export function useScoot(s, from, to) {
  if (s.over || !(s.items.scoot > 0) || !scootTargets(s, from).includes(to)) return null;
  snapshot(s);
  moveTile(s, from, to);
  s.items.scoot--;
  checkOver(s);
  return { type: 'scoot', a: from, b: to };
}

/** Turns the 2 by 2 square at `corner` clockwise ('cw') or counterclockwise ('ccw'). */
export function useSpin(s, corner, dir) {
  if (s.over || !(s.items.spin > 0) || !spinCorners().includes(corner) || (dir !== 'cw' && dir !== 'ccw')) return null;
  const board = rotated(s.board, corner, dir);
  if (board.every((v, i) => v === s.board[i])) return null;
  snapshot(s);
  s.board = board;
  s.lift = rotated(s.lift, corner, dir);
  s.items.spin--;
  checkOver(s);
  return { type: 'spin', cells: spinRing(corner), dir };
}

/** The next few placed blocks come in one level higher. Using another while one is active adds another level. */
export function useLuxury(s) {
  if (s.over || !(s.items.luxury > 0)) return null;
  s.items.luxury--;
  s.luxury.push(CONFIG.luxuryPlacements);
  return { type: 'luxury', stacks: s.luxury.length };
}

/** Removes every level 1 and level 2 block. */
export function useScorch(s) {
  const cells = scorchCells(s);
  if (s.over || !(s.items.scorch > 0) || !cells.length) return null;
  snapshot(s);
  const levels = cells.map((i) => s.board[i]);
  for (const i of cells) clearTile(s, i);
  s.items.scorch--;
  return { type: 'scorch', cells, levels };
}

/** Raises a few random blocks by one level each. */
export function useBloom(s, rng = rngFor(s)) {
  const pool = bloomCells(s);
  if (s.over || !(s.items.bloom > 0) || !pool.length) return null;
  snapshot(s);
  const cells = [];
  let gained = 0;
  while (cells.length < CONFIG.bloomCount && pool.length) {
    const cell = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    gained += addBlock(s, cell, s.board[cell] + 1);
    cells.push(cell);
  }
  s.items.bloom--;
  checkOver(s);
  return { type: 'bloom', cells, points: gained };
}

// Space items.

/** True when two blocks below the max level share a level, so some arrangement of the board could merge them. */
function hasPair(s) {
  const seen = new Set();
  for (const v of s.board) {
    if (v > 0 && v < CONFIG.maxLevel) {
      if (seen.has(v)) return true;
      seen.add(v);
    }
  }
  return false;
}

/** A random order of every tile: entry `from` is the tile that `from` moves to. */
function randomOrder(rng) {
  const p = Array.from({ length: CELLS }, (_, i) => i);
  for (let i = CELLS - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

/** Moves every tile to the place `order` gives it, and returns the moves of the blocks. */
function rearrange(s, order) {
  const board = new Array(CELLS).fill(0), lift = new Array(CELLS).fill(0);
  const moves = [];
  order.forEach((to, from) => {
    board[to] = s.board[from];
    lift[to] = s.lift[from];
    if (s.board[from]) moves.push({ from, to });
  });
  s.board = board;
  s.lift = lift;
  return moves;
}

/** Rearranges every tile on the board at random. */
export function useShuffle(s, rng = rngFor(s)) {
  if (s.over || !(s.items.shuffle > 0) || !s.board.some(Boolean)) return null;
  let order = null;
  // A shuffle that lands every block back on its own tile is drawn again.
  for (let attempt = 0; attempt < 12; attempt++) {
    const p = randomOrder(rng);
    if (p.some((to, from) => s.board[from] !== s.board[to])) { order = p; break; }
  }
  if (!order) return null;
  snapshot(s);
  const moves = rearrange(s, order);
  s.items.shuffle--;
  checkOver(s);
  return { type: 'shuffle', moves };
}

/** Moves a block to any empty tile. */
export function useTeleport(s, from, to) {
  if (s.over || !(s.items.teleport > 0) || from === to || !s.board[from] || s.board[to]) return null;
  snapshot(s);
  moveTile(s, from, to);
  s.items.teleport--;
  checkOver(s);
  return { type: 'teleport', a: from, b: to };
}

/** The cells of row or column `index`, in order from left or top. */
export function beamLine(axis, index) {
  const n = CONFIG.size;
  return Array.from({ length: n }, (_, k) => (axis === 'row' ? index * n + k : k * n + index));
}

function cycled(arr, line, shift) {
  const n = line.length;
  const out = arr.slice();
  line.forEach((cell, k) => { out[line[(k + shift) % n]] = arr[cell]; });
  return out;
}

/** Cycles a row or column by `shift` tiles toward the right or bottom. Tiles that leave one end come back at the other. */
export function useBeam(s, axis, index, shift) {
  const n = CONFIG.size;
  const k = ((Math.round(shift) % n) + n) % n;
  if (s.over || !(s.items.beam > 0) || !k || (axis !== 'row' && axis !== 'col') || !(index >= 0 && index < n)) return null;
  const line = beamLine(axis, index);
  const board = cycled(s.board, line, k);
  if (board.every((v, i) => v === s.board[i])) return null;
  snapshot(s);
  s.board = board;
  s.lift = cycled(s.lift, line, k);
  s.items.beam--;
  checkOver(s);
  return { type: 'beam', axis, index, shift: k, cells: line };
}

/** A row or column and shift that leaves a merge on the board, or null. */
export function findHelpfulBeam(s) {
  const n = CONFIG.size;
  for (const axis of ['row', 'col']) {
    for (let index = 0; index < n; index++) {
      const line = beamLine(axis, index);
      for (let k = 1; k < n; k++) {
        if (hasMerge({ ...s, board: cycled(s.board, line, k) })) return [axis, index, k];
      }
    }
  }
  return null;
}

/** Lines of cells ordered from the edge the tiles fall toward. */
function fallLines(dir) {
  const n = CONFIG.size;
  const lines = [];
  for (let a = 0; a < n; a++) {
    const line = Array.from({ length: n }, (_, k) => {
      if (dir === 'left') return a * n + k;
      if (dir === 'right') return a * n + (n - 1 - k);
      if (dir === 'up') return k * n + a;
      return (n - 1 - k) * n + a;
    });
    lines.push(line);
  }
  return lines;
}

/** One pass of falling: every tile slides toward the edge, and two equal tiles that meet merge once. */
function fallPass(board, lift, dir) {
  const nb = new Array(CELLS).fill(0), nl = new Array(CELLS).fill(0);
  const moves = [], merged = [];
  for (const line of fallLines(dir)) {
    const tiles = line.filter((i) => board[i]);
    let k = 0;
    for (let j = 0; j < tiles.length; k++) {
      const a = tiles[j], b = tiles[j + 1], dest = line[k];
      if (b !== undefined && board[a] === board[b] && board[a] < CONFIG.maxLevel) {
        nb[dest] = board[a] + 1;
        moves.push({ from: a, to: dest }, { from: b, to: dest });
        merged.push(dest);
        j += 2;
      } else {
        nb[dest] = board[a];
        nl[dest] = lift[a];
        if (a !== dest) moves.push({ from: a, to: dest });
        j++;
      }
    }
  }
  const changed = nb.some((v, i) => v !== board[i]);
  return { board: nb, lift: nl, moves, merged, changed };
}

/** True when pulling toward `dir` would move or merge any tile. */
export function canFall(s, dir) {
  return fallPass(s.board, s.lift, dir).changed;
}

/**
 * Drops every tile toward `dir` ('up', 'down', 'left', 'right'). Tiles merge as they meet, pass after pass,
 * until nothing moves. Each pass is returned so the board can show the tiles settling.
 */
export function useGravity(s, dir) {
  if (s.over || !(s.items.gravity > 0) || !['up', 'down', 'left', 'right'].includes(dir)) return null;
  let pass = fallPass(s.board, s.lift, dir);
  if (!pass.changed) return null;
  snapshot(s);
  const frames = [];
  let gained = 0;
  for (let guard = 0; pass.changed && guard < 32; guard++) {
    s.board = pass.board;
    s.lift = pass.lift;
    for (const cell of pass.merged) gained += addBlock(s, cell, s.board[cell]);
    frames.push({ board: s.board.slice(), moves: pass.moves, merged: pass.merged });
    pass = fallPass(s.board, s.lift, dir);
  }
  s.items.gravity--;
  checkOver(s);
  return { type: 'gravity', dir, frames, points: gained };
}

/** Lifts most of the blocks a random 1 to 3 levels for the next few moves. A block merged from a lifted tile keeps its level. */
export function useMonolith(s, rng = rngFor(s)) {
  const pool = bloomCells(s);
  if (s.over || !(s.items.monolith > 0) || s.monolith > 0 || !pool.length) return null;
  const filled = s.board.filter(Boolean).length;
  const count = Math.min(pool.length, Math.ceil(filled * CONFIG.monolithShare));
  snapshot(s);
  const cells = [];
  while (cells.length < count) {
    const cell = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const lift = Math.min(1 + Math.floor(rng() * CONFIG.monolithMaxLift), CONFIG.maxLevel - s.board[cell]);
    s.board[cell] += lift;
    s.lift[cell] = lift;
    cells.push(cell);
  }
  s.monolith = CONFIG.monolithMoves;
  s.items.monolith--;
  checkOver(s);
  return { type: 'monolith', cells };
}

// Valentines items.

const adjacent = (a, b) => neighbors(a).includes(b);

/** Trades two tiles that share an edge. The first must hold a block, and the second may be empty. */
export function useDance(s, a, b) {
  if (s.over || !(s.items.dance > 0) || !s.board[a] || !adjacent(a, b) || s.board[a] === s.board[b]) return null;
  snapshot(s);
  [s.board[a], s.board[b]] = [s.board[b], s.board[a]];
  [s.lift[a], s.lift[b]] = [s.lift[b], s.lift[a]];
  s.items.dance--;
  checkOver(s);
  return { type: 'dance', a, b };
}

/** The tiles the block on `from` can dance with. */
export function danceTargets(s, from) {
  const lv = s.board[from];
  return lv ? neighbors(from).filter((j) => s.board[j] !== lv) : [];
}

/** Two tiles that share an edge whose swap leaves a merge on the board, or null. The first holds a block. */
export function findHelpfulDance(s) {
  const b = s.board;
  for (let i = 0; i < CELLS; i++) {
    for (const j of neighbors(i)) {
      if (j < i || b[i] === b[j]) continue;
      [b[i], b[j]] = [b[j], b[i]];
      const helps = hasMerge(s);
      [b[i], b[j]] = [b[j], b[i]];
      if (helps) return b[i] ? [i, j] : [j, i];
    }
  }
  return null;
}

/** The tiles strictly between two tiles of one row or column, nearest `from` first, or null when they share neither. */
function between(from, to) {
  const n = CONFIG.size;
  const r1 = Math.floor(from / n), c1 = from % n, r2 = Math.floor(to / n), c2 = to % n;
  if (from === to || (r1 !== r2 && c1 !== c2)) return null;
  const step = r1 === r2 ? Math.sign(c2 - c1) : n * Math.sign(r2 - r1);
  const out = [];
  for (let i = from + step; i !== to; i += step) out.push(i);
  return out;
}

/** Where a block kissing another block stops and the block it breaks on the way, or null when it cannot move. */
export function kissPath(board, from, to) {
  const path = board[from] && board[to] ? between(from, to) : null;
  if (!path) return null;
  let end = from, broken = null;
  for (const cell of path) {
    if (board[cell]) {
      if (broken !== null) break;
      broken = cell;
    }
    end = cell;
  }
  return end === from ? null : { end, broken };
}

/** The blocks that the block on `from` can kiss. */
export function kissTargets(s, from) {
  return Array.from({ length: CELLS }, (_, i) => i).filter((to) => kissPath(s.board, from, to));
}

export function canKiss(s) {
  return s.board.some((v, i) => v && kissTargets(s, i).length);
}

/** Flies a block along its row or column toward another block. It breaks at most one block on the way and stops as close as it gets. */
export function useKiss(s, from, to) {
  const k = !s.over && s.items.kiss > 0 ? kissPath(s.board, from, to) : null;
  if (!k) return null;
  snapshot(s);
  const brokenLevel = k.broken === null ? 0 : s.board[k.broken];
  if (k.broken !== null) clearTile(s, k.broken);
  moveTile(s, from, k.end);
  s.items.kiss--;
  checkOver(s);
  return { type: 'kiss', a: from, b: k.end, target: to, broken: k.broken, brokenLevel };
}

/** True when Long Distance can merge these two blocks: they match, sit below the max, and do not share an edge. */
export function canLongMerge(s, from, to) {
  const lv = s.board[from];
  return !s.over && from !== to && lv > 0 && lv < CONFIG.maxLevel && s.board[to] === lv && !adjacent(from, to);
}

/** The blocks that Long Distance can merge the block on `from` into. */
export function longTargets(s, from) {
  return Array.from({ length: CELLS }, (_, i) => i).filter((to) => canLongMerge(s, from, to));
}

/** Merges two matching blocks from anywhere on the board. The new block lands on `to`. */
export function useLongDistance(s, from, to) {
  if (!(s.items.longDistance > 0) || !canLongMerge(s, from, to)) return null;
  snapshot(s);
  const level = s.board[to] + 1;
  clearTile(s, from);
  s.lift[to] = 0;
  const gained = addBlock(s, to, level);
  s.items.longDistance--;
  checkOver(s);
  return { type: 'longDistance', from, cell: to, level, points: gained };
}

/** The board after Jewelry raises every level 1 and level 2 block. */
function jeweled(board) {
  return board.map((v) => (v === 1 || v === 2 ? v + 1 : v));
}

/** True when Jewelry would leave a merge on the board. */
function jewelryHelps(s) {
  return scorchCells(s).length > 0 && hasMerge({ ...s, board: jeweled(s.board) });
}

/** Raises every level 1 and level 2 block by one level. */
export function useJewelry(s) {
  const cells = scorchCells(s);
  if (s.over || !(s.items.jewelry > 0) || !cells.length) return null;
  snapshot(s);
  let gained = 0;
  for (const i of cells) gained += addBlock(s, i, s.board[i] + 1);
  s.items.jewelry--;
  checkOver(s);
  return { type: 'jewelry', cells, points: gained };
}

/** Merges every pair of matching blocks once, then rearranges every tile at random. A third matching block stays as it is. */
export function useLove(s, rng = rngFor(s)) {
  if (s.over || !(s.items.love > 0) || !hasPair(s)) return null;
  const byLevel = new Map();
  s.board.forEach((v, i) => { if (v > 0 && v < CONFIG.maxLevel) byLevel.set(v, [...(byLevel.get(v) || []), i]); });
  snapshot(s);
  const merges = [];
  let gained = 0;
  for (const [lv, cells] of byLevel) {
    for (let k = 0; k + 1 < cells.length; k += 2) {
      const from = cells[k], to = cells[k + 1];
      clearTile(s, from);
      s.lift[to] = 0;
      gained += addBlock(s, to, lv + 1);
      merges.push({ from, to, level: lv + 1 });
    }
  }
  const board = s.board.slice();
  const moves = rearrange(s, randomOrder(rng));
  s.items.love--;
  checkOver(s);
  return { type: 'love', merges, merged: board, moves, points: gained };
}

export function endRun(s) {
  if (s.over) return;
  s.over = true;
  s.ended = 'retry';
}

/** Fills fields that saves from older versions lack. */
export function migrate(s) {
  if (!MODES[s.mode] || (s.mode === 'daily' && !s.daily)) s.mode = 'classic';
  s.items = { ...modeOf(s).startItems, ...s.items };
  if (!Array.isArray(s.luxury)) s.luxury = [];
  if (!Array.isArray(s.lift) || s.lift.length !== CELLS) s.lift = new Array(CELLS).fill(0);
  if (typeof s.monolith !== 'number') s.monolith = 0;
  if (!Number.isInteger(s.plv) || s.plv < 1) s.plv = 1;
  if (typeof s.xp !== 'number' || s.xp < 0) s.xp = 0;
  return s;
}

export function isValidState(s) {
  return (
    s && Array.isArray(s.board) && s.board.length === CELLS &&
    s.board.every((v) => Number.isInteger(v) && v >= 0 && v <= CONFIG.maxLevel) &&
    Number.isInteger(s.next) && typeof s.score === 'number' &&
    s.items && Array.isArray(s.history)
  );
}
