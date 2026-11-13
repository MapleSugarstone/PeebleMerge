import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/engine.js';

function seq(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function game(board, extra = {}) {
  const s = G.newGame(() => 0);
  s.board = board.slice();
  return Object.assign(s, extra);
}

const _ = 0;

test('points double per level', () => {
  assert.equal(G.points(1), 200);
  assert.equal(G.points(12), 409600);
});

test('spawn levels follow weights', () => {
  assert.equal(G.rollLevel(() => 0), 1);
  assert.equal(G.rollLevel(() => 0.59), 1);
  assert.equal(G.rollLevel(() => 0.6), 2);
  assert.equal(G.rollLevel(() => 0.95), 3);
  const counts = [0, 0, 0, 0];
  for (let i = 0; i < 20000; i++) counts[G.rollLevel()]++;
  assert.ok(Math.abs(counts[1] / 20000 - 0.6) < 0.02);
  assert.ok(Math.abs(counts[3] / 20000 - 0.1) < 0.02);
});

test('place puts the next block on a random empty tile and scores it', () => {
  const s = game([1, 2, _, _, _, _, _, _, _, _, _, _, _, _, _, _], { next: 3 });
  const ev = G.place(s, seq(0.5, 0));
  assert.equal(ev.cell, 9);
  assert.equal(s.board[9], 3);
  assert.equal(s.score, 800);
  assert.equal(s.next, 1);
});

test('merge needs orthogonal neighbors of the same level', () => {
  const s = game([2, 2, _, _, _, 2, _, _, _, _, _, _, _, _, _, _]);
  assert.ok(G.canMerge(s, 0, 1));
  assert.ok(!G.canMerge(s, 0, 5), 'diagonal');
  assert.ok(!G.canMerge(s, 0, 0));
  const ev = G.merge(s, 0, 1);
  assert.equal(ev.cell, 1);
  assert.deepEqual(s.board.slice(0, 2), [0, 3]);
  assert.equal(s.score, 800);
});

test('neighbors do not wrap across rows', () => {
  assert.deepEqual(G.neighbors(3).sort((a, b) => a - b), [2, 7]);
  assert.deepEqual(G.neighbors(4).sort((a, b) => a - b), [0, 5, 8]);
});

test('max level blocks do not merge', () => {
  const m = G.CONFIG.maxLevel;
  const s = game([m, m, _, _, _, _, _, _, _, _, _, _, _, _, _, _]);
  assert.ok(!G.canMerge(s, 0, 1));
});

const CHECKER = [1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, _];

test('a stuck board with a hammer keeps the run going', () => {
  const s = game(CHECKER, { next: 3 });
  s.items = { hammer: 1, rewind: 0, blueprint: 2, seed: 1 };
  G.place(s, () => 0);
  assert.ok(G.isStuck(s));
  assert.equal(s.over, false);
  assert.ok(G.useHammer(s, 0));
  assert.equal(G.isStuck(s), false);
});

test('a stuck board with a rewind and history keeps the run going', () => {
  const s = game(CHECKER, { next: 3 });
  s.items = { hammer: 0, rewind: 1, blueprint: 0, seed: 0 };
  G.place(s, () => 0);
  assert.equal(s.over, false);
  assert.ok(G.useRewind(s));
  assert.equal(s.board[15], 0);
});

test('a stuck board ends the run when no hammer or usable rewind is left', () => {
  const s = game(CHECKER, { next: 3 });
  s.items = { hammer: 0, rewind: 0, blueprint: 3, seed: 1 };
  G.place(s, () => 0);
  assert.equal(s.over, true);
  assert.equal(s.ended, 'stuck');
});

test('a rewind with nothing to undo is not a rescue', () => {
  const s = game(CHECKER.map((v) => v || 3));
  s.items = { hammer: 0, rewind: 3, blueprint: 0, seed: 0 };
  s.history = [];
  assert.ok(G.isStuck(s));
  assert.equal(G.canRescue(s), false);
});

test('a full board with a merge available keeps going', () => {
  const s = game([1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, _], { next: 2 });
  G.place(s, () => 0);
  assert.equal(s.over, false);
  assert.equal(G.place(s, () => 0), null);
});

test('rewind restores board, score, and next block, up to three in a row', () => {
  const s = G.newGame(seq(0));
  const states = [];
  for (let k = 0; k < 4; k++) {
    states.push(JSON.stringify([s.board, s.score, s.next]));
    G.place(s, seq(0.1 * k, 0.7));
  }
  s.items.rewind = 10;
  for (let k = 3; k >= 1; k--) {
    assert.ok(G.useRewind(s));
    assert.equal(JSON.stringify([s.board, s.score, s.next]), states[k]);
  }
  assert.equal(G.useRewind(s), null, 'fourth rewind in a row');
  assert.equal(s.items.rewind, 7);
});

test('rewind undoes a merge', () => {
  const s = game([2, 2, _, _, _, _, _, _, _, _, _, _, _, _, _, _]);
  G.merge(s, 0, 1);
  G.useRewind(s);
  assert.deepEqual(s.board.slice(0, 2), [2, 2]);
  assert.equal(s.score, 0);
});

test('hammer destroys a block, spends one, and clears rewind history', () => {
  const s = G.newGame(() => 0);
  G.place(s, () => 0);
  const ev = G.useHammer(s, 0);
  assert.equal(ev.level, 1);
  assert.equal(s.board[0], 0);
  assert.equal(s.items.hammer, G.MODES.classic.startItems.hammer - 1);
  assert.equal(G.useRewind(s), null);
  assert.equal(G.useHammer(s, 0), null, 'empty tile');
});

test('blueprint places the next block on the chosen tile', () => {
  const s = G.newGame(() => 0);
  s.next = 3;
  const ev = G.useBlueprint(s, 10);
  assert.equal(ev.cell, 10);
  assert.equal(s.board[10], 3);
  assert.equal(s.items.blueprint, G.MODES.classic.startItems.blueprint - 1);
  assert.equal(G.useBlueprint(s, 10), null, 'occupied tile');
  assert.equal(s.items.blueprint, G.MODES.classic.startItems.blueprint - 1);
});

test('seed places a chosen level 1 to 5 without changing the next block', () => {
  const s = G.newGame(() => 0);
  const next = s.next;
  assert.equal(G.useSeed(s, 6), null);
  const ev = G.useSeed(s, 5, () => 0);
  assert.equal(s.board[ev.cell], 5);
  assert.equal(s.next, next);
  assert.equal(s.score, G.points(5));
  assert.equal(s.items.seed, G.MODES.classic.startItems.seed - 1);
});

test('items do nothing after the run is over', () => {
  const s = G.newGame(() => 0);
  G.place(s, () => 0);
  G.endRun(s);
  assert.equal(s.ended, 'retry');
  assert.equal(G.place(s), null);
  assert.equal(G.useHammer(s, 0), null);
  assert.equal(G.useRewind(s), null);
});

test('merges give XP equal to the new level', () => {
  const s = game([2, 2, _, _, _, _, _, _, _, _, _, _, _, _, _, _]);
  const ev = G.merge(s, 0, 1);
  assert.equal(ev.xp, 3);
  assert.equal(s.xp, 3);
  assert.equal(s.plv, 1);
  assert.equal(ev.levelUp, null);
});

test('XP needed grows by step and stops at the max', () => {
  assert.equal(G.xpNeeded(1), 50);
  assert.equal(G.xpNeeded(2), 72);
  assert.equal(G.xpNeeded(100), 360);
});

test('a level-up drops one item, carries extra XP over, and respects caps', () => {
  const s = game([4, 4, _, _, _, _, _, _, _, _, _, _, _, _, _, _], { xp: 48 });
  s.items = { hammer: 5, rewind: 6, blueprint: 5, swap: 4, seed: 0 };
  const ev = G.merge(s, 0, 1, () => 0);
  assert.equal(s.plv, 2);
  assert.equal(s.xp, 3);
  assert.deepEqual(ev.levelUp, { plv: 2, item: 'seed', rarity: 3 });
  assert.equal(s.items.seed, 1);
});

test('rarity weights pick commons most often', () => {
  const s = G.newGame();
  s.items = { hammer: 0, rewind: 0, blueprint: 0, swap: 0, seed: 0 };
  const counts = {};
  for (let i = 0; i < 20000; i++) {
    const d = G.rollDrop(s);
    counts[d.item] = (counts[d.item] || 0) + 1;
  }
  assert.ok(Math.abs(counts.rewind / 20000 - 0.46) < 0.02);
  assert.ok(Math.abs(counts.swap / 20000 - 0.1) < 0.015);
  assert.ok(Math.abs(counts.seed / 20000 - 0.06) < 0.01);
});

test('every item at its cap gives bonus points instead', () => {
  const s = game([4, 4, _, _, _, _, _, _, _, _, _, _, _, _, _, _], { xp: 49 });
  s.items = { hammer: 5, rewind: 6, blueprint: 5, swap: 4, seed: 3 };
  const ev = G.merge(s, 0, 1);
  assert.equal(ev.levelUp.item, null);
  assert.equal(s.score, G.points(5) + G.CONFIG.fullBonus);
});

test('swap trades two tiles, moves a block to an empty tile, and can be rewound', () => {
  const s = game([1, 2, _, _, _, _, _, _, _, _, _, _, _, _, _, 5]);
  s.items.swap = 2;
  assert.ok(G.useSwap(s, 0, 15));
  assert.equal(s.board[0], 5);
  assert.equal(s.board[15], 1);
  assert.ok(G.useSwap(s, 1, 2));
  assert.deepEqual(s.board.slice(0, 3), [5, 0, 2]);
  assert.equal(s.items.swap, 0);
  assert.equal(G.useSwap(s, 0, 1), null, 'none left');
  G.useRewind(s);
  assert.deepEqual(s.board.slice(0, 3), [5, 2, 0]);
});

test('swap needs a block in the first tile', () => {
  const s = game([_, 2, _, _, _, _, _, _, _, _, _, _, _, _, _, _]);
  assert.equal(G.useSwap(s, 0, 1), null);
  assert.equal(G.useSwap(s, 1, 1), null);
});

test('a swap that can make a merge rescues a stuck board', () => {
  const s = game(CHECKER, { next: 3 });
  s.items = { hammer: 0, rewind: 0, blueprint: 0, swap: 1, seed: 0 };
  G.place(s, () => 0);
  assert.ok(G.isStuck(s));
  assert.equal(s.over, false);
  assert.deepEqual(G.rescueItems(s), ['swap']);
  const [a, b] = G.findHelpfulSwap(s);
  G.useSwap(s, a, b);
  assert.ok(G.hasMerge(s));
});

test('a swap that cannot make a merge is not a rescue', () => {
  // Only the max-level blocks repeat, and those never merge.
  const s = game([14, 1, 14, 2, 3, 14, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  s.items = { hammer: 0, rewind: 0, blueprint: 0, swap: 1, seed: 0 };
  assert.ok(G.isStuck(s));
  assert.equal(G.findHelpfulSwap(s), null);
  assert.equal(G.canRescue(s), false);
});

test('rewind does not take back XP', () => {
  const s = game([2, 2, _, _, _, _, _, _, _, _, _, _, _, _, _, _]);
  G.merge(s, 0, 1);
  G.useRewind(s);
  assert.equal(s.xp, 3);
});

test('migrate fills level fields on old saves', () => {
  const s = G.newGame();
  delete s.plv;
  delete s.xp;
  G.migrate(s);
  assert.equal(s.plv, 1);
  assert.equal(s.xp, 0);
});

test('a greedy bot plays legal runs to the end', () => {
  for (let run = 0; run < 50; run++) {
    const s = G.newGame();
    let guard = 0;
    while (!s.over && guard++ < 100000) {
      let merged = false;
      for (let i = 0; i < 16 && !merged; i++) {
        const t = G.mergeTargets(s, i);
        if (t.length) merged = !!G.merge(s, i, t[0]);
      }
      if (merged) continue;
      if (G.isStuck(s)) {
        const pair = G.findHelpfulSwap(s);
        const rescued = G.useHammer(s, 0) || G.useRewind(s) || (pair && G.useSwap(s, pair[0], pair[1]));
        assert.ok(rescued, 'a stuck run that is not over must have a rescue');
      }
      else assert.ok(G.place(s), 'place must succeed when the board has room');
    }
    assert.ok(s.over);
    assert.ok(s.board.every((v) => v >= 1 && v <= G.CONFIG.maxLevel));
  }
});
