import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/engine.js';

const _ = 0;

function fall(board, items = {}) {
  const s = G.newGame(() => 0, 'fall');
  s.board = board.slice();
  s.items = { scoot: 0, spin: 0, luxury: 0, scorch: 0, bloom: 0, ...items };
  return s;
}

test('fall starts with its own items', () => {
  const s = G.newGame(() => 0, 'fall');
  assert.equal(s.mode, 'fall');
  assert.deepEqual(Object.keys(s.items).sort(), ['bloom', 'luxury', 'scoot', 'scorch', 'spin']);
  assert.equal(s.items.hammer, undefined);
});

test('fall drops only fall items, scoot most often and bloom least', () => {
  const s = fall([], {});
  const counts = {};
  for (let i = 0; i < 20000; i++) {
    const d = G.rollDrop(s);
    counts[d.item] = (counts[d.item] || 0) + 1;
  }
  assert.deepEqual(Object.keys(counts).sort(), ['bloom', 'luxury', 'scoot', 'scorch', 'spin']);
  assert.ok(counts.scoot > counts.spin && counts.spin > counts.luxury && counts.luxury > counts.scorch && counts.scorch > counts.bloom);
  assert.equal(G.capOf('luxury', 'fall'), 2);
  assert.equal(G.capOf('scorch', 'fall'), 1);
});

test('scoot moves a block one tile into an empty neighbor only', () => {
  const s = fall([3, _, _, _, 2, _, _, _, _, _, _, _, _, _, _, _], { scoot: 2 });
  assert.deepEqual(G.scootTargets(s, 0).sort(), [1]);
  assert.equal(G.useScoot(s, 0, 2), null, 'two tiles away');
  assert.equal(G.useScoot(s, 0, 4), null, 'occupied');
  assert.ok(G.useScoot(s, 0, 1));
  assert.deepEqual(s.board.slice(0, 2), [0, 3]);
  assert.equal(s.items.scoot, 1);
});

test('spin turns a 2 by 2 square both ways', () => {
  const s = fall([1, 2, _, _, 4, 3, _, _, _, _, _, _, _, _, _, _], { spin: 2 });
  G.useSpin(s, 0, 'cw');
  assert.deepEqual([s.board[0], s.board[1], s.board[5], s.board[4]], [4, 1, 2, 3]);
  G.useSpin(s, 0, 'ccw');
  assert.deepEqual([s.board[0], s.board[1], s.board[5], s.board[4]], [1, 2, 3, 4]);
  assert.equal(s.items.spin, 0);
});

test('spin refuses squares off the board and spins that change nothing', () => {
  const s = fall([2, 2, _, _, 2, 2, _, _, _, _, _, _, _, _, _, _], { spin: 1 });
  assert.equal(G.useSpin(s, 3, 'cw'), null, 'right edge');
  assert.equal(G.useSpin(s, 0, 'cw'), null, 'all four the same');
  assert.equal(G.useSpin(s, 10, 'cw'), null, 'empty square');
  assert.equal(s.items.spin, 1);
});

test('luxury raises the next 3 placed blocks by one level, and two stack', () => {
  const s = fall(new Array(16).fill(0), { luxury: 2 });
  s.next = 1;
  G.useLuxury(s);
  assert.equal(G.nextLevel(s), 2);
  const levels = [];
  for (let k = 0; k < 4; k++) levels.push(G.place(s, () => 0).level);
  assert.deepEqual(levels, [2, 2, 2, 1]);
  G.useLuxury(s);
  assert.equal(G.useLuxury(s), null, 'none left');
  s.items.luxury = 1;
  G.useLuxury(s);
  assert.equal(G.boost(s), 2);
  assert.equal(G.place(s, () => 0).level, 3);
});

test('scorch removes every level 1 and 2 block and nothing else', () => {
  const s = fall([1, 2, 3, 1, 4, 2, _, _, _, _, _, _, _, _, _, 5], { scorch: 1 });
  const ev = G.useScorch(s);
  assert.deepEqual(ev.cells, [0, 1, 3, 5]);
  assert.deepEqual(s.board.filter(Boolean), [3, 4, 5]);
  assert.equal(G.useScorch(s), null);
});

test('bloom raises 3 random blocks by one level and scores them', () => {
  const s = fall([1, 2, 3, 4, _, _, _, _, _, _, _, _, _, _, _, 14], { bloom: 1 });
  const ev = G.useBloom(s, () => 0);
  assert.equal(ev.cells.length, 3);
  assert.deepEqual(s.board.slice(0, 4), [2, 3, 4, 4]);
  assert.equal(s.board[15], 14, 'max level is never raised');
  assert.equal(s.score, G.points(2) + G.points(3) + G.points(4));
});

test('a stuck fall board stays alive while spin, scorch, or bloom can help', () => {
  const checker = [1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1];
  const a = fall(checker, { spin: 1 });
  assert.deepEqual(G.rescueItems(a), ['spin']);
  const b = fall(checker, { scorch: 1 });
  assert.deepEqual(G.rescueItems(b), ['scorch']);
  const c = fall(checker, { scoot: 5, luxury: 2 });
  assert.equal(G.canRescue(c), false, 'scoot and luxury need an empty tile');
  const d = fall(checker.slice(0, 15).concat([0]), { scoot: 5 });
  d.next = 3;
  G.place(d, () => 0);
  assert.equal(d.over, true);
});

test('old saves become classic runs', () => {
  const s = G.newGame();
  delete s.mode;
  delete s.luxury;
  G.migrate(s);
  assert.equal(s.mode, 'classic');
  assert.deepEqual(s.luxury, []);
});

test('a greedy bot plays fall runs to the end', () => {
  for (let run = 0; run < 50; run++) {
    const s = G.newGame(Math.random, 'fall');
    let guard = 0;
    while (!s.over && guard++ < 100000) {
      let merged = false;
      for (let i = 0; i < 16 && !merged; i++) {
        const t = G.mergeTargets(s, i);
        if (t.length) merged = !!G.merge(s, i, t[0]);
      }
      if (merged) continue;
      if (G.isStuck(s)) {
        const spin = G.findHelpfulSpin(s);
        const rescued = (spin && G.useSpin(s, spin[0], spin[1])) || G.useScorch(s) || G.useBloom(s);
        assert.ok(rescued, 'a stuck run that is not over must have a rescue');
      } else {
        if (s.items.luxury > 0) G.useLuxury(s);
        assert.ok(G.place(s), 'place must succeed when the board has room');
      }
    }
    assert.ok(s.over);
  }
});
