import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/engine.js';

const DAY = '2026-11-14';

test('the daily draw depends only on the date', () => {
  const a = G.dailyConfig(DAY), b = G.dailyConfig(DAY);
  assert.deepEqual(a, b);
  const days = new Set();
  for (let d = 1; d <= 20; d++) days.add(JSON.stringify(G.dailyConfig(`2026-12-${String(d).padStart(2, '0')}`).drops.map((x) => x.item)));
  assert.ok(days.size > 15, 'different days draw different items');
});

test('a daily draw has five different items in rarity order, with small starting supplies', () => {
  for (let d = 1; d <= 28; d++) {
    const cfg = G.dailyConfig(`2027-02-${String(d).padStart(2, '0')}`);
    const items = cfg.drops.map((x) => x.item);
    assert.equal(new Set(items).size, 5);
    assert.deepEqual(cfg.drops.map((x) => x.rarity), cfg.drops.map((x) => x.rarity).slice().sort((x, y) => x - y));
    assert.ok(Object.values(cfg.startItems).every((n) => n >= 0 && n <= 2));
    assert.ok(cfg.hue >= 0 && cfg.hue < 360);
  }
});

test('two daily runs on the same day play out the same for the same moves', () => {
  const play = () => {
    const s = G.newGame(Math.random, 'daily', DAY);
    const log = [];
    for (let k = 0; k < 40 && !s.over; k++) {
      const t = G.mergeTargets(s, s.board.findIndex((v, i) => v && G.mergeTargets(s, i).length));
      const from = s.board.findIndex((v, i) => v && G.mergeTargets(s, i).length);
      if (from >= 0) G.merge(s, from, G.mergeTargets(s, from)[0]);
      else G.place(s);
      log.push(s.board.join(''), s.next, t.length);
    }
    return log;
  };
  assert.deepEqual(play(), play());
});

test('the seed survives a save and reload', () => {
  const a = G.newGame(Math.random, 'daily', DAY);
  for (let k = 0; k < 5; k++) G.place(a);
  const b = G.migrate(JSON.parse(JSON.stringify(a)));
  for (let k = 0; k < 5; k++) { G.place(a); G.place(b); }
  assert.deepEqual(a.board, b.board);
  assert.equal(a.next, b.next);
});

test('different days start differently, and other modes stay unseeded', () => {
  const a = G.newGame(Math.random, 'daily', '2026-11-14');
  const b = G.newGame(Math.random, 'daily', '2026-11-15');
  for (let k = 0; k < 6; k++) { G.place(a); G.place(b); }
  assert.notDeepEqual(a.board, b.board);
  const c = G.newGame(Math.random, 'classic');
  assert.equal(c.rngState, undefined);
  assert.equal(c.daily, undefined);
});

test('a daily run uses the day\'s items, drops, and caps', () => {
  const s = G.newGame(Math.random, 'daily', DAY);
  const cfg = G.dailyConfig(DAY);
  assert.deepEqual(Object.keys(s.items).sort(), cfg.drops.map((d) => d.item).sort());
  assert.deepEqual(G.modeOf(s).drops, cfg.drops);
  for (const d of cfg.drops) assert.equal(G.capFor(s, d.item), d.cap);
  for (let i = 0; i < 200; i++) {
    const dropped = G.rollDrop({ ...s, items: {} }, Math.random).item;
    assert.ok(cfg.drops.some((d) => d.item === dropped));
  }
});

test('a daily save that lost its draw falls back to classic', () => {
  const s = G.newGame(Math.random, 'daily', DAY);
  delete s.daily;
  G.migrate(s);
  assert.equal(s.mode, 'classic');
});

/** Uses whichever item can free a stuck board. */
function rescue(s) {
  const swap = G.findHelpfulSwap(s), spin = G.findHelpfulSpin(s), beam = G.findHelpfulBeam(s), dance = G.findHelpfulDance(s);
  const kisser = s.board.findIndex((v, i) => v && G.kissTargets(s, i).length);
  return G.useRewind(s) || G.useHammer(s, 0) || (swap && G.useSwap(s, swap[0], swap[1])) || (spin && G.useSpin(s, spin[0], spin[1]))
    || G.useScorch(s) || G.useBloom(s) || (beam && G.useBeam(s, beam[0], beam[1], beam[2])) || G.useMonolith(s) || G.useShuffle(s)
    || (dance && G.useDance(s, dance[0], dance[1])) || (kisser >= 0 && G.useKiss(s, kisser, G.kissTargets(s, kisser)[0]))
    || G.useLove(s) || longDistance(s) || jewelry(s);
}

function longDistance(s) {
  for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) if (G.canLongMerge(s, a, b)) return G.useLongDistance(s, a, b);
  return null;
}

function jewelry(s) {
  const d = s.board.findIndex((v, i) => G.canJewelryDestroy(s, i));
  const u = s.board.findIndex((v, i) => i !== d && v && v < G.CONFIG.maxLevel);
  return d >= 0 && u >= 0 ? G.useJewelry(s, d, u) : null;
}

test('a greedy bot plays thirty days of daily runs to the end', () => {
  for (let d = 1; d <= 30; d++) {
    const s = G.newGame(Math.random, 'daily', `2027-03-${String(d).padStart(2, '0')}`);
    let guard = 0;
    while (!s.over && guard++ < 100000) {
      const from = s.board.findIndex((v, i) => v && G.mergeTargets(s, i).length);
      if (from >= 0) { G.merge(s, from, G.mergeTargets(s, from)[0]); continue; }
      if (G.isStuck(s)) assert.ok(rescue(s), 'a stuck run that is not over must have a rescue');
      else assert.ok(G.place(s));
    }
    assert.ok(s.over);
  }
});
