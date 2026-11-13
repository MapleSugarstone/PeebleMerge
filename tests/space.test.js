import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/engine.js';

const _ = 0;

function space(board, items = {}) {
  const s = G.newGame(() => 0, 'space');
  s.board = board.slice();
  s.items = { shuffle: 0, teleport: 0, beam: 0, gravity: 0, monolith: 0, ...items };
  return s;
}

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('space starts with its own items and drops only them', () => {
  const s = G.newGame(() => 0, 'space');
  assert.deepEqual(Object.keys(s.items).sort(), ['beam', 'gravity', 'monolith', 'shuffle', 'teleport']);
  const counts = {};
  for (let i = 0; i < 20000; i++) {
    const d = G.rollDrop(space([], {}));
    counts[d.item] = (counts[d.item] || 0) + 1;
  }
  assert.ok(counts.shuffle > counts.beam && counts.beam > counts.teleport && counts.teleport > counts.gravity && counts.gravity > counts.monolith);
  assert.equal(G.capOf('teleport', 'space'), 3);
});

test('shuffle keeps every block and moves at least one', () => {
  const s = space([1, 2, 3, _, 4, _, _, _, _, _, _, _, _, _, _, 5], { shuffle: 1 });
  const before = s.board.filter(Boolean).sort();
  const ev = G.useShuffle(s);
  assert.deepEqual(s.board.filter(Boolean).sort(), before);
  assert.equal(ev.moves.length, 5);
  assert.ok(ev.moves.some((m) => m.from !== m.to));
  assert.equal(s.items.shuffle, 0);
});

test('teleport moves a block to any empty tile only', () => {
  const s = space([3, 2, _, _, _, _, _, _, _, _, _, _, _, _, _, _], { teleport: 2 });
  assert.equal(G.useTeleport(s, 0, 1), null, 'occupied');
  assert.equal(G.useTeleport(s, 5, 6), null, 'nothing to move');
  assert.ok(G.useTeleport(s, 0, 15));
  assert.equal(s.board[0], 0);
  assert.equal(s.board[15], 3);
});

test('beam cycles a row or column and wraps around', () => {
  const s = space([1, 2, 3, 4, 5, _, _, _, 6, _, _, _, 7, _, _, _], { beam: 3 });
  G.useBeam(s, 'row', 0, 1);
  assert.deepEqual(s.board.slice(0, 4), [4, 1, 2, 3]);
  G.useBeam(s, 'row', 0, -1);
  assert.deepEqual(s.board.slice(0, 4), [1, 2, 3, 4]);
  G.useBeam(s, 'col', 0, 2);
  assert.deepEqual([s.board[0], s.board[4], s.board[8], s.board[12]], [6, 7, 1, 5]);
  assert.equal(s.items.beam, 0);
});

test('beam refuses a full turn or a line that would not change', () => {
  const s = space([2, 2, 2, 2, _, _, _, _, _, _, _, _, _, _, _, _], { beam: 1 });
  assert.equal(G.useBeam(s, 'row', 1, 4), null, 'whole loop');
  assert.equal(G.useBeam(s, 'row', 0, 1), null, 'all the same');
  assert.equal(G.useBeam(s, 'row', 2, 1), null, 'empty row');
  assert.equal(s.items.beam, 1);
});

test('gravity drops tiles and keeps merging until the board settles', () => {
  // Column 0 from top: 1, 1, 2, 3. Falling down: 1+1 -> 2, then 2+2 -> 3, then 3+3 -> 4.
  const s = space([1, _, _, _, 1, _, _, _, 2, _, _, _, 3, _, _, _], { gravity: 1 });
  const ev = G.useGravity(s, 'down');
  assert.deepEqual([s.board[0], s.board[4], s.board[8], s.board[12]], [0, 0, 0, 4]);
  assert.ok(ev.frames.length >= 2);
  assert.equal(s.items.gravity, 0);
  assert.equal(s.score, G.points(2) + G.points(3) + G.points(4));
});

test('gravity slides without merging when nothing matches, and refuses when nothing moves', () => {
  const s = space([_, 1, _, 2, _, _, _, _, _, _, _, _, _, _, _, _], { gravity: 2 });
  G.useGravity(s, 'left');
  assert.deepEqual(s.board.slice(0, 4), [1, 2, 0, 0]);
  assert.equal(G.useGravity(s, 'left'), null);
  assert.equal(s.items.gravity, 1);
});

test('monolith lifts half the blocks for three moves, then drops them back', () => {
  const s = space([1, 2, 3, 4, _, _, _, _, _, _, _, _, _, _, _, _], { monolith: 1 });
  s.next = 1;
  const before = s.board.slice(0, 4);
  const ev = G.useMonolith(s, seq(0, 0.9));
  assert.equal(ev.cells.length, 2);
  const lifted = ev.cells.map((c) => s.board[c] - before[c]);
  assert.ok(lifted.every((d) => d === 1 || d === 2));
  assert.equal(G.CONFIG.monolithMoves, 3);
  assert.equal(s.monolith, 3);
  assert.equal(G.useMonolith(s), null, 'one at a time');
  G.place(s, () => 0.99);
  G.place(s, () => 0.99);
  assert.equal(s.monolith, 1);
  assert.notDeepEqual(s.board.slice(0, 4), before, 'still lifted after two moves');
  const ev2 = G.place(s, () => 0.99);
  assert.equal(s.monolith, 0);
  assert.deepEqual(ev2.reverted.sort(), ev.cells.slice().sort());
  assert.deepEqual(s.board.slice(0, 4), before);
});

test('a block merged from a lifted tile keeps its level', () => {
  const s = space([3, 5, _, _, _, _, _, _, _, _, _, _, _, _, _, _], { monolith: 1 });
  // Lift only tile 0 by 2, from level 3 to 5.
  s.board[0] = 5;
  s.lift[0] = 2;
  s.monolith = 2;
  G.merge(s, 0, 1);
  assert.equal(s.board[1], 6);
  G.place(s, () => 0);
  assert.equal(s.board[1], 6, 'no lift left to drop');
});

test('moving a lifted tile carries its lift', () => {
  const s = space([4, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _], { teleport: 1 });
  s.lift[0] = 1;
  s.monolith = 1;
  G.useTeleport(s, 0, 9);
  assert.equal(s.lift[9], 1);
  assert.equal(s.lift[0], 0);
  G.place(s, () => 0);
  assert.equal(s.board[9], 3);
});

test('a stuck space board stays alive while shuffle, beam, or monolith can help', () => {
  const checker = [1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1];
  assert.deepEqual(G.rescueItems(space(checker, { beam: 1 })), ['beam']);
  assert.deepEqual(G.rescueItems(space(checker, { shuffle: 1 })), ['shuffle']);
  assert.deepEqual(G.rescueItems(space(checker, { monolith: 1 })), ['monolith']);
  assert.equal(G.canRescue(space(checker, { teleport: 3, gravity: 2 })), false, 'both need room to move');
});

test('a greedy bot plays space runs to the end', () => {
  for (let run = 0; run < 40; run++) {
    const s = G.newGame(Math.random, 'space');
    let guard = 0;
    while (!s.over && guard++ < 100000) {
      let merged = false;
      for (let i = 0; i < 16 && !merged; i++) {
        const t = G.mergeTargets(s, i);
        if (t.length) merged = !!G.merge(s, i, t[0]);
      }
      if (merged) continue;
      if (G.isStuck(s)) {
        const beam = G.findHelpfulBeam(s);
        const rescued = (beam && G.useBeam(s, beam[0], beam[1], beam[2])) || G.useMonolith(s) || G.useShuffle(s);
        assert.ok(rescued, 'a stuck run that is not over must have a rescue');
      } else {
        if (s.items.gravity > 0 && G.emptyCells(s).length < 4) G.useGravity(s, 'down');
        if (!s.over && G.emptyCells(s).length) assert.ok(G.place(s));
      }
    }
    assert.ok(s.over);
    assert.ok(s.board.every((v) => v >= 1 && v <= G.CONFIG.maxLevel));
  }
});
