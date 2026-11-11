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
  startItems: { hammer: 3, rewind: 3, blueprint: 3, seed: 1 },
  // A merge gives XP equal to the new block's level. Level n needs min(base + step * (n - 1), max) XP.
  xp: { base: 60, step: 25, max: 400 },
  rarities: ['common', 'uncommon', 'rare', 'epic'],
  // Each level-up drops one item. Items at their cap are left out of the roll.
  drops: [
    { item: 'rewind', rarity: 0, weight: 50, cap: 6 },
    { item: 'hammer', rarity: 1, weight: 28, cap: 5 },
    { item: 'blueprint', rarity: 2, weight: 16, cap: 5 },
    { item: 'seed', rarity: 3, weight: 6, cap: 3 },
  ],
  // Points awarded instead of an item when every item is at its cap.
  fullBonus: 2000,
};

export function xpNeeded(plv) {
  const x = CONFIG.xp;
  return Math.min(x.base + x.step * (plv - 1), x.max);
}

export function capOf(item) {
  const d = CONFIG.drops.find((d) => d.item === item);
  return d ? d.cap : Infinity;
}

export function rollDrop(s, rng = Math.random) {
  const pool = CONFIG.drops.filter((d) => s.items[d.item] < d.cap);
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
    s.items[d.item]++;
    return { plv: s.plv, item: d.item, rarity: d.rarity };
  }
  s.score += CONFIG.fullBonus;
  return { plv: s.plv, item: null, bonus: CONFIG.fullBonus };
}

const CELLS = CONFIG.size * CONFIG.size;

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

export function newGame(rng = Math.random) {
  return {
    board: new Array(CELLS).fill(0),
    next: rollLevel(rng),
    score: 0,
    highest: 0,
    items: { ...CONFIG.startItems },
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
  s.history.push({ board: s.board.slice(), next: s.next, score: s.score, highest: s.highest });
  if (s.history.length > CONFIG.undoDepth) s.history.shift();
}

function addBlock(s, cell, level) {
  s.board[cell] = level;
  const gained = points(level);
  s.score += gained;
  if (level > s.highest) s.highest = level;
  return gained;
}

/** True when the board is full and no blocks can merge. */
export function isStuck(s) {
  return emptyCells(s).length === 0 && !hasMerge(s);
}

/** True when an item can free a stuck board: a hammer, or a rewind with history to undo. */
export function canRescue(s) {
  return s.items.hammer > 0 || (s.items.rewind > 0 && s.history.length > 0);
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
  const level = s.next;
  const gained = addBlock(s, target, level);
  s.next = rollLevel(rng);
  checkOver(s);
  return { type: 'place', cell: target, level, points: gained };
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
  if (s.items.blueprint <= 0) return null;
  const ev = place(s, rng, cell);
  if (ev) s.items.blueprint--;
  return ev;
}

export function useSeed(s, level, rng = Math.random) {
  if (s.over || s.items.seed <= 0 || !CONFIG.seedLevels.includes(level)) return null;
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
  if (s.over || s.items.hammer <= 0 || s.board[cell] === 0) return null;
  const level = s.board[cell];
  s.board[cell] = 0;
  s.items.hammer--;
  s.history = [];
  return { type: 'hammer', cell, level };
}

export function useRewind(s) {
  if (s.over || s.items.rewind <= 0 || !s.history.length) return null;
  const snap = s.history.pop();
  s.board = snap.board;
  s.next = snap.next;
  s.score = snap.score;
  s.highest = snap.highest;
  s.items.rewind--;
  return { type: 'rewind' };
}

export function endRun(s) {
  if (s.over) return;
  s.over = true;
  s.ended = 'retry';
}

/** Fills fields that saves from older versions lack. */
export function migrate(s) {
  s.items = { ...CONFIG.startItems, ...s.items };
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
