import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/engine.js';

const _ = 0;

function val(board, items = {}) {
  const s = G.newGame(() => 0, 'valentines');
  s.board = board.slice();
  s.items = { dance: 0, kiss: 0, longDistance: 0, jewelry: 0, love: 0, ...items };
  return s;
}

const checker = [1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1];

test('valentines starts with its own items and drops them by rarity', () => {
  const s = G.newGame(() => 0, 'valentines');
  assert.deepEqual(Object.keys(s.items).sort(), ['dance', 'jewelry', 'kiss', 'longDistance', 'love']);
  const counts = {};
  for (let i = 0; i < 20000; i++) {
    const d = G.rollDrop(val([], {}), Math.random);
    counts[d.item] = (counts[d.item] || 0) + 1;
  }
  assert.ok(counts.dance > counts.kiss && counts.kiss > counts.longDistance && counts.longDistance > counts.jewelry && counts.jewelry > counts.love);
  assert.deepEqual(['dance', 'kiss', 'longDistance', 'jewelry', 'love'].map((k) => G.capOf(k, 'valentines')), [6, 6, 2, 1, 1]);
});

test('dance swaps two tiles that share an edge only', () => {
  const s = val([3, 2, _, _, 4, _, _, _, _, _, _, _, _, _, _, _], { dance: 3 });
  assert.equal(G.useDance(s, 0, 2), null, 'not touching');
  assert.equal(G.useDance(s, 0, 5), null, 'diagonal');
  assert.equal(G.useDance(s, 2, 3), null, 'no block');
  assert.ok(G.useDance(s, 0, 1));
  assert.deepEqual(s.board.slice(0, 2), [2, 3]);
  assert.ok(G.useDance(s, 4, 8), 'an empty tile counts');
  assert.equal(s.board[8], 4);
  assert.equal(s.items.dance, 1);
});

test('kiss flies to the tile next to the target block', () => {
  const s = val([2, _, _, 5, _, _, _, _, _, _, _, _, _, _, _, _], { kiss: 2 });
  const ev = G.useKiss(s, 0, 3);
  assert.deepEqual(s.board.slice(0, 4), [0, 0, 2, 5]);
  assert.equal(ev.b, 2);
  assert.equal(ev.broken, null);
  assert.equal(G.useKiss(s, 2, 3), null, 'already next to it');
  assert.equal(G.useKiss(s, 2, 1), null, 'the target must be a block');
});

test('kiss breaks the first block in the way and stops before a second', () => {
  const s = val([1, 3, _, 5, 4, _, _, _, 6, _, _, _, 2, _, _, _], { kiss: 2 });
  const ev = G.useKiss(s, 0, 3);
  assert.deepEqual(s.board.slice(0, 4), [0, 0, 1, 5]);
  assert.equal(ev.broken, 1);
  assert.equal(ev.brokenLevel, 3);
  // The 2 at the bottom of column 0 kisses the 4 above it and breaks the 6 between them.
  const ev2 = G.useKiss(s, 12, 4);
  assert.equal(ev2.broken, 8);
  assert.equal(s.board[8], 2, 'stops on the broken tile');
  assert.equal(s.board[4], 4);
  assert.equal(s.items.kiss, 0);
});

test('kiss with two blocks in the way breaks one and stops before the other', () => {
  const s = val([1, 3, 4, 5, _, _, _, _, _, _, _, _, _, _, _, _], { kiss: 1 });
  G.useKiss(s, 0, 3);
  assert.deepEqual(s.board.slice(0, 4), [0, 1, 4, 5]);
});

test('long distance merges matching blocks that do not touch', () => {
  const s = val([3, _, _, 3, 3, _, _, _, _, _, _, _, _, _, _, 14], { longDistance: 2 });
  assert.equal(G.useLongDistance(s, 0, 4), null, 'touching blocks merge without an item');
  const ev = G.useLongDistance(s, 0, 3);
  assert.equal(s.board[0], 0);
  assert.equal(s.board[3], 4);
  assert.equal(ev.points, G.points(4));
  assert.equal(s.xp, 0, 'items give no XP');
  assert.equal(G.useLongDistance(s, 4, 3), null, 'levels differ');
  assert.equal(s.items.longDistance, 1);
});

test('jewelry raises every level 1 and level 2 block once', () => {
  const s = val([1, 2, 3, 1, 2, _, _, _, _, _, _, _, _, _, _, 14], { jewelry: 2 });
  const ev = G.useJewelry(s);
  assert.deepEqual(s.board.slice(0, 5), [2, 3, 3, 2, 3], 'a 1 that becomes a 2 does not rise again');
  assert.equal(s.board[15], 14);
  assert.deepEqual(ev.cells, [0, 1, 3, 4]);
  assert.equal(ev.points, 2 * G.points(2) + 2 * G.points(3));
  assert.equal(s.xp, 0, 'items give no XP');
  assert.equal(s.items.jewelry, 1);
  assert.equal(G.useJewelry(val([3, 4, 14], { jewelry: 1 })), null, 'no level 1 or 2 block');
});

test('love merges each pair once and then rearranges the board', () => {
  const s = val([1, 1, 1, 2, 2, 7, _, _, _, _, _, _, _, _, _, 14], { love: 1 });
  const ev = G.useLove(s, Math.random);
  assert.equal(ev.merges.length, 2, 'one pair of 1s and one pair of 2s');
  assert.deepEqual(s.board.filter(Boolean).sort((a, b) => a - b), [1, 2, 3, 7, 14]);
  assert.equal(ev.points, G.points(2) + G.points(3));
  assert.equal(ev.moves.length, 5);
  assert.equal(s.items.love, 0);
  assert.equal(G.useLove(val([1, 2, 3], { love: 1 })), null, 'no pair');
});

test('a stuck valentines board stays alive while any of its items can help', () => {
  for (const item of ['dance', 'kiss', 'longDistance', 'love']) {
    assert.deepEqual(G.rescueItems(val(checker, { [item]: 1 })), [item]);
  }
  // Raising 1s and 2s together keeps a checkerboard of them stuck. A 2 next to a 3 becomes a pair.
  assert.deepEqual(G.rescueItems(val(checker, { jewelry: 1 })), []);
  assert.deepEqual(G.rescueItems(val([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 4, 5, 6, 7], { jewelry: 1 })), ['jewelry']);
  assert.equal(G.rescueItems(val([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14, 14], { longDistance: 1, love: 1 })).length, 0, 'no pair below the max');
});

/** Uses whichever Valentines item can free a stuck board. */
function rescue(s) {
  const dance = G.findHelpfulDance(s);
  const from = s.board.findIndex((v, i) => v && G.kissTargets(s, i).length);
  return (dance && G.useDance(s, dance[0], dance[1]))
    || (from >= 0 && G.useKiss(s, from, G.kissTargets(s, from)[0]))
    || G.useLove(s)
    || longDistance(s)
    || G.useJewelry(s);
}

function longDistance(s) {
  for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) if (G.canLongMerge(s, a, b)) return G.useLongDistance(s, a, b);
  return null;
}

test('a greedy bot plays valentines runs to the end', () => {
  for (let run = 0; run < 40; run++) {
    const s = G.newGame(Math.random, 'valentines');
    let guard = 0;
    while (!s.over && guard++ < 100000) {
      const from = s.board.findIndex((v, i) => v && G.mergeTargets(s, i).length);
      if (from >= 0) { G.merge(s, from, G.mergeTargets(s, from)[0]); continue; }
      if (G.isStuck(s)) assert.ok(rescue(s), 'a stuck run that is not over must have a rescue');
      else assert.ok(G.place(s));
    }
    assert.ok(s.over);
    assert.ok(s.board.every((v) => v >= 1 && v <= G.CONFIG.maxLevel));
  }
});
