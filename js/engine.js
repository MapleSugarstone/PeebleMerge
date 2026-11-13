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
};

const CELLS = CONFIG.size * CONFIG.size;

export const modeOf = (s) => MODES[s.mode] || MODES.classic;

export function xpNeeded(plv) {
  const x = CONFIG.xp;
  return Math.min(x.base + x.step * (plv - 1), x.max);
}

export function capOf(item, mode = 'classic') {
  const d = (MODES[mode] || MODES.classic).drops.find((x) => x.item === item);
  return d ? d.cap : Infinity;
}

export function rollDrop(s, rng = Math.random) {
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

export function newGame(rng = Math.random, mode = 'classic') {
  const m = MODES[mode] ? mode : 'classic';
  return {
    mode: m,
    board: new Array(CELLS).fill(0),
    next: rollLevel(rng),
    score: 0,
    highest: 0,
    items: { ...MODES[m].startItems },
    luxury: [],
    plv: 1,
    xp: 0,
    history: [],
    over: false,
    ended: null,
  };
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
  s.history.push({ board: s.board.slice(), next: s.next, score: s.score, highest: s.highest, luxury: s.luxury.slice() });
  if (s.history.length > CONFIG.undoDepth) s.history.shift();
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
export function place(s, rng = Math.random, cell = null) {
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
  s.next = rollLevel(rng);
  checkOver(s);
  return { type: 'place', cell: target, level, boosted, points: gained };
}

export function merge(s, from, to, rng = Math.random) {
  if (!canMerge(s, from, to)) return null;
  snapshot(s);
  const level = s.board[to] + 1;
  s.board[from] = 0;
  const gained = addBlock(s, to, level);
  const levelUp = gainXp(s, level, rng);
  checkOver(s);
  return { type: 'merge', from, cell: to, level, points: gained, xp: level, levelUp };
}

export function useBlueprint(s, cell, rng = Math.random) {
  if (!(s.items.blueprint > 0)) return null;
  const ev = place(s, rng, cell);
  if (ev) s.items.blueprint--;
  return ev;
}

export function useSeed(s, level, rng = Math.random) {
  if (s.over || !(s.items.seed > 0) || !CONFIG.seedLevels.includes(level)) return null;
  const empty = emptyCells(s);
  if (!empty.length) return null;
  snapshot(s);
  const target = empty[Math.floor(rng() * empty.length)];
  const gained = addBlock(s, target, level);
  s.items.seed--;
  checkOver(s);
  return { type: 'place', cell: target, level, points: gained };
}

export function useHammer(s, cell) {
  if (s.over || !(s.items.hammer > 0) || s.board[cell] === 0) return null;
  const level = s.board[cell];
  s.board[cell] = 0;
  s.items.hammer--;
  s.history = [];
  return { type: 'hammer', cell, level };
}

/** Trades the contents of two tiles. The first must hold a block, and the second may be empty. */
export function useSwap(s, a, b) {
  if (s.over || !(s.items.swap > 0) || a === b || s.board[a] === 0) return null;
  snapshot(s);
  [s.board[a], s.board[b]] = [s.board[b], s.board[a]];
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
  s.items.rewind--;
  return { type: 'rewind' };
}

/** Moves a block one tile up, down, left, or right into an empty tile. */
export function useScoot(s, from, to) {
  if (s.over || !(s.items.scoot > 0) || !scootTargets(s, from).includes(to)) return null;
  snapshot(s);
  s.board[to] = s.board[from];
  s.board[from] = 0;
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
  for (const i of cells) s.board[i] = 0;
  s.items.scorch--;
  return { type: 'scorch', cells, levels };
}

/** Raises a few random blocks by one level each. */
export function useBloom(s, rng = Math.random) {
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

export function endRun(s) {
  if (s.over) return;
  s.over = true;
  s.ended = 'retry';
}

/** Fills fields that saves from older versions lack. */
export function migrate(s) {
  if (!MODES[s.mode]) s.mode = 'classic';
  s.items = { ...MODES[s.mode].startItems, ...s.items };
  if (!Array.isArray(s.luxury)) s.luxury = [];
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
