// Plays many runs with a scripted player and reports how often levels and item drops arrive.
// Usage: node tests/balance-sim.js [runs] [classic|fall|space|valentines]
import * as G from '../js/engine.js';

const RUNS = Number(process.argv[2] || 300);
const MODE = process.argv[3] || 'classic';
const N = G.CONFIG.size;
const CELLS = N * N;

// Cells in a snake from the top-left corner. The bot keeps big blocks early in this order.
const SNAKE = [];
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) SNAKE.push(r * N + (r % 2 ? N - 1 - c : c));
const rank = new Array(CELLS);
SNAKE.forEach((cell, i) => { rank[cell] = i; });

function bestMerge(s) {
  let best = null;
  for (let i = 0; i < CELLS; i++) {
    for (const to of G.mergeTargets(s, i)) {
      // Merge toward the corner, low levels first so small blocks do not clog the board.
      const lv = s.board[i];
      const score = rank[to] * 2 - rank[i] + lv * 0.5;
      if (!best || score < best.score) best = { from: i, to, score };
    }
  }
  return best;
}

function playRun(rng) {
  const s = G.newGame(rng, MODE);
  const stat = { placements: 0, merges: 0, xp: 0, gained: {}, used: {}, bonus: 0 };
  const use = (k) => { stat.used[k] = (stat.used[k] || 0) + 1; };
  let guard = 0;
  while (!s.over && guard++ < 200000) {
    const m = bestMerge(s);
    if (m) {
      const ev = G.merge(s, m.from, m.to, rng);
      stat.merges++;
      stat.xp += ev.xp;
      if (ev.levelUp) {
        if (ev.levelUp.item) stat.gained[ev.levelUp.item] = (stat.gained[ev.levelUp.item] || 0) + 1;
        else stat.bonus++;
      }
      continue;
    }
    if (G.isStuck(s)) {
      if (s.items.rewind > 0 && G.useRewind(s)) { use('rewind'); continue; }
      let victim = 0;
      for (let i = 0; i < CELLS; i++) if (rank[i] > rank[victim]) victim = i;
      if (G.useHammer(s, victim)) { use('hammer'); continue; }
      const pair = G.findHelpfulSwap(s);
      if (pair && G.useSwap(s, pair[0], pair[1])) { use('swap'); continue; }
      const spin = G.findHelpfulSpin(s);
      if (spin && G.useSpin(s, spin[0], spin[1])) { use('spin'); continue; }
      if (G.useScorch(s)) { use('scorch'); continue; }
      if (G.useBloom(s, rng)) { use('bloom'); continue; }
      const beam = G.findHelpfulBeam(s);
      if (beam && G.useBeam(s, beam[0], beam[1], beam[2])) { use('beam'); continue; }
      if (G.useMonolith(s, rng)) { use('monolith'); continue; }
      if (G.useShuffle(s, rng)) { use('shuffle'); continue; }
      const dance = G.findHelpfulDance(s);
      if (dance && G.useDance(s, dance[0], dance[1])) { use('dance'); continue; }
      if (s.items.longDistance > 0) {
        const pair = [];
        for (let a = 0; a < CELLS && !pair.length; a++) for (let b = 0; b < CELLS; b++) if (G.canLongMerge(s, a, b)) { pair.push(a, b); break; }
        if (pair.length && G.useLongDistance(s, pair[0], pair[1])) { use('longDistance'); continue; }
      }
      if (G.useLove(s, rng)) { use('love'); continue; }
      const kisser = s.board.findIndex((v, i) => v && G.kissTargets(s, i).length);
      if (s.items.kiss > 0 && kisser >= 0 && G.useKiss(s, kisser, G.kissTargets(s, kisser)[0])) { use('kiss'); continue; }
      if (G.useJewelry(s)) { use('jewelry'); continue; }
    }
    if (s.items.gravity > 0 && G.emptyCells(s).length < 4 && G.useGravity(s, 'up')) { use('gravity'); continue; }
    if (s.items.luxury > 0 && G.useLuxury(s)) use('luxury');
    const empty = G.emptyCells(s);
    // With one tile left and nothing to merge, a bad placement can leave the board stuck. Use an item first.
    if (empty.length === 1) {
      const e = empty[0];
      const fits = G.neighbors(e).some((n) => s.board[n] === s.next);
      if (!fits && s.items.seed > 0) {
        const lv = G.neighbors(e).map((n) => s.board[n]).find((v) => G.CONFIG.seedLevels.includes(v));
        if (lv) { G.useSeed(s, lv, rng); use('seed'); continue; }
      }
      if (!fits && s.items.hammer > 0) {
        let victim = 0;
        for (let i = 0; i < CELLS; i++) if (rank[i] > rank[victim] || s.board[victim] === 0) victim = i;
        G.useHammer(s, victim);
        use('hammer');
        continue;
      }
    }
    if (s.items.blueprint > 0 && empty.length <= 3) {
      const spot = empty.find((e) => G.neighbors(e).some((n) => s.board[n] === s.next));
      if (spot !== undefined) { G.useBlueprint(s, spot, rng); use('blueprint'); stat.placements++; continue; }
    }
    G.place(s, rng);
    stat.placements++;
  }
  return { ...stat, plv: s.plv, highest: s.highest, score: s.score };
}

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(playRun(mulberry(1000 + i)));

const avg = (f) => runs.reduce((n, r) => n + f(r), 0) / runs.length;
const pct = (f, p) => { const v = runs.map(f).sort((a, b) => a - b); return v[Math.floor((v.length - 1) * p)]; };
const byHighest = {};
for (const r of runs) byHighest[r.highest] = (byHighest[r.highest] || 0) + 1;

console.log(`mode: ${MODE}, runs: ${RUNS}`);
console.log(`highest block: ${Object.entries(byHighest).map(([k, v]) => `Lv${k} x${v}`).join(', ')}`);
console.log(`placements per run: median ${pct((r) => r.placements, 0.5)}, p90 ${pct((r) => r.placements, 0.9)}`);
console.log(`XP per placement: ${(avg((r) => r.xp) / avg((r) => r.placements)).toFixed(2)}`);
console.log(`player level reached: median ${pct((r) => r.plv, 0.5)}, p90 ${pct((r) => r.plv, 0.9)}, max ${pct((r) => r.plv, 1)}`);
for (const k of Object.keys(G.MODES[MODE].startItems)) {
  console.log(`  ${k}: gained ${avg((r) => r.gained[k] || 0).toFixed(1)}, used ${avg((r) => r.used[k] || 0).toFixed(1)} per run`);
}
console.log(`full-bag bonuses per run: ${avg((r) => r.bonus).toFixed(2)}`);

// Placements needed to reach each player level, from the XP curve and the measured XP rate.
const rate = avg((r) => r.xp) / avg((r) => r.placements);
let total = 0;
const marks = [];
for (let lv = 1; lv <= 40; lv++) {
  total += G.xpNeeded(lv);
  if ([1, 2, 5, 10, 15, 20, 30, 40].includes(lv)) marks.push(`Lv${lv + 1} at ~${Math.round(total / rate)} placements`);
}
console.log(marks.join(', '));
