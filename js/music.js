// Calm background music for the garden, generated and synthesized with the Web Audio API at run time.
// Every pitch above the bass stays in C major pentatonic, the scale of the merge chimes, so any chime fits.

const PENT = [0, 2, 4, 7, 9];
// Gain at the module's output, before the game's own gain.
const LEVEL = 1.2;
const FADE_IN = 2.5;
const FADE_OUT = 1;
const TICK_MS = 250;
// Seconds for the played intensity to move about two thirds of the way to a new setting.
const SMOOTH = 6;
const PAD = [55, 72];
const BASS = [40, 52];
const MEL = [2, 8];
const ALTO = [-2, 4];
const HALO = [72, 79];
const DROP = [72, 81];

// need: always voiced. may: added for color. stable: where a phrase may end. avoid: never on a strong or long note.
const CHORDS = {
  I: { root: 0, need: [4, 7, 2], may: [9, 0], stable: [0, 4, 7], avoid: [] },
  ii: { root: 2, need: [9, 0, 2], may: [4, 7], stable: [2, 9, 0], avoid: [] },
  iii: { root: 4, need: [7, 2, 4], may: [9], stable: [4, 7, 2], avoid: [0] },
  IV: { root: 5, need: [9, 0, 4], may: [7], stable: [9, 0, 4], avoid: [] },
  V: { root: 7, need: [7, 2, 9], may: [0, 4], stable: [7, 2, 9], avoid: [] },
  vi: { root: 9, need: [0, 4, 9], may: [7, 2], stable: [9, 0, 4], avoid: [] },
};

const MOVES = {
  I: [['IV', 4], ['vi', 3], ['ii', 1.5], ['V', 1], ['iii', 1]],
  ii: [['V', 2], ['IV', 2], ['vi', 1.5], ['I', 1]],
  iii: [['vi', 3], ['IV', 2.5], ['ii', 1]],
  IV: [['I', 4], ['vi', 2], ['ii', 1.5], ['V', 1.5], ['iii', 1]],
  V: [['I', 3], ['vi', 2.5], ['IV', 1.5]],
  vi: [['IV', 4], ['I', 2], ['ii', 1.5], ['iii', 1], ['V', 1]],
};

const NEXT = {
  open: [['pads', 2], ['drift', 2]],
  pads: [['tune', 4], ['drift', 2], ['still', 0.8]],
  drift: [['tune', 4], ['pads', 1], ['still', 0.8]],
  tune: [['pads', 2.5], ['drift', 2.5], ['tune', 1.2], ['still', 0.6]],
  still: [['tune', 2.5], ['drift', 1.5], ['pads', 1]],
};

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
const pcOf = (n) => ((n % 12) + 12) % 12;
/** The MIDI note of a pentatonic degree, counted from middle C. */
const degNote = (d) => 60 + 12 * Math.floor(d / 5) + PENT[((d % 5) + 5) % 5];
const noteDeg = (n) => 5 * Math.floor((n - 60) / 12) + PENT.indexOf(pcOf(n));

function rand(seed) {
  let s = seed >>> 0;
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    f,
    range: (a, b) => a + (b - a) * f(),
    int: (a, b) => a + Math.floor(f() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(f() * arr.length)],
    chance: (p) => f() < p,
    weighted(pairs) {
      let tot = 0;
      for (const [, w] of pairs) tot += w;
      let x = f() * tot;
      for (const [v, w] of pairs) { x -= w; if (x < 0) return v; }
      return pairs[pairs.length - 1][0];
    },
  };
}

// ---------------------------------------------------------------- composition

function newSong(seed) {
  return { r: rand(seed), mv: null, left: 0, kind: 'open', chord: null, voice: null, bass: 48, deg: 5, halo: 76 };
}

function makeMotif(r) {
  const n = r.int(3, 5);
  const steps = [];
  for (let i = 1; i < n; i++) steps.push(r.weighted([[1, 4], [-1, 4], [2, 1.2], [-2, 1.2], [3, 0.25], [-3, 0.25], [0, 0.5]]));
  const rhythm = [];
  let t = r.weighted([[0, 3], [0.5, 1], [1, 1.5]]);
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const d = last ? r.pick([2, 3]) : r.weighted([[1, 4], [1.5, 1.5], [0.5, 1], [2, 2]]);
    rhythm.push([t, d]);
    t += d + (!last && r.chance(0.15) ? 0.5 : 0);
  }
  return { steps, rhythm };
}

/** Starts a movement: a few minutes with one home chord, meter, tempo, motif, and pad color. */
function newMovement(s) {
  const r = s.r;
  const old = s.mv ? s.mv.center : null;
  const meter = r.chance(0.3) ? 3 : 4;
  s.mv = {
    center: r.weighted([['I', 4], ['vi', 3], ['IV', 1.5], ['ii', 1]].filter(([c]) => c !== old)),
    meter,
    bpm: r.int(60, 72),
    bars: meter === 4 && r.chance(0.2) ? 1 : 2,
    motif: makeMotif(r),
    cut: Math.round(r.range(750, 1300)),
    det: r.range(3, 7),
    voices: r.chance(0.5) ? 4 : 3,
    wave: r.int(0, 2),
    pedal: r.range(0, 0.35),
  };
  s.left = r.int(5, 8);
}

function step(r, from, home) {
  return r.weighted(MOVES[from].map(([c, w]) => [c, c === home ? w * 1.5 : w]));
}

function subsets(arr, k) {
  if (k <= 0) return [[]];
  if (k >= arr.length) return [arr.slice()];
  const out = [];
  const rec = (i, cur) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let j = i; j < arr.length; j++) { cur.push(arr[j]); rec(j + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

/** The pad notes for a chord: close to the last voicing, with no seconds in the low register. */
function voicing(r, ch, prev, count) {
  const c = CHORDS[ch];
  const extra = c.may.filter((x) => !c.need.includes(x));
  let best = null;
  let bestCost = Infinity;
  for (const sub of subsets(extra, count - c.need.length)) {
    const opts = [...c.need, ...sub].map((pc) => {
      const o = [];
      for (let n = PAD[0]; n <= PAD[1]; n++) if (pcOf(n) === pc) o.push(n);
      return o;
    });
    const walk = (i, cur) => {
      if (i < opts.length) {
        for (const n of opts[i]) { cur.push(n); walk(i + 1, cur); cur.pop(); }
        return;
      }
      const v = cur.slice().sort((a, b) => a - b);
      let cost = r.f() * 1.5;
      for (let j = 1; j < v.length; j++) {
        const gap = v[j] - v[j - 1];
        if (gap === 0) return;
        if (gap <= 2) cost += v[j - 1] < 62 ? 8 : 2;
      }
      if (v[v.length - 1] - v[0] > 15) cost += 6;
      if (prev) {
        for (const n of v) cost += Math.min(...prev.map((p) => Math.abs(p - n))) * 0.5;
        // An unchanged voicing over a new bass sounds static, so it costs extra and one voice usually moves.
        if (v.length === prev.length && v.every((n, j) => n === prev[j])) cost += 2;
      }
      cost += Math.abs((v[0] + v[v.length - 1]) / 2 - 63) * 0.25;
      if (cost < bestCost) { bestCost = cost; best = v; }
    };
    walk(0, []);
  }
  return best;
}

function nearest(pc, prev, lo, hi) {
  let best = lo;
  let bd = Infinity;
  for (let n = lo; n <= hi; n++) {
    if (pcOf(n) !== pc) continue;
    const d = Math.abs(n - prev) + (n < 43 ? 1.5 : 0);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function padLayer(s, chords, cl, ev, count, slow) {
  const r = s.r;
  let open = new Map();
  chords.forEach((ch, i) => {
    const v = voicing(r, ch, s.voice, count);
    const next = new Map();
    v.forEach((n, j) => {
      const held = open.get(n);
      if (held) { held.d += cl; next.set(n, held); return; }
      const e = { v: 'pad', n, t: i * cl, d: cl, g: count > 3 ? 0.87 : 1, a: slow ? r.range(2.4, 3.2) : r.range(1.4, 2.4), det: s.mv.det, pan: j === 0 ? 0 : j % 2 ? 1 : -1 };
      ev.push(e);
      next.set(n, e);
    });
    open = next;
    s.voice = v;
  });
}

function bassLayer(s, chords, cl, bar, ev, pedal) {
  const r = s.r;
  let last = null;
  chords.forEach((ch, i) => {
    const root = pedal ? CHORDS[s.mv.center].root : CHORDS[ch].root;
    const n = nearest(root, s.bass, BASS[0], BASS[1]);
    if (last && last.n === n) last.d += cl;
    else { last = { v: 'bass', n, t: i * cl, d: cl, g: 1, a: 0.6 }; ev.push(last); }
    s.bass = n;
    if (!pedal && cl >= 2 * bar && r.chance(0.4)) {
      const up = CHORDS[ch].root === 4 || n + 7 > 57 ? n + 12 : n + 7;
      ev.push({ v: 'bass', n: up, t: i * cl + bar, d: cl - bar - 0.5, g: 0.5, a: 0.5, lay: 0.5 });
    }
  });
}

/** Turns the motif into one phrase: notes as degree offsets with onsets and lengths in beats. */
function phraseOf(r, m, kind) {
  let steps = m.steps.slice();
  let rh = m.rhythm.map((x) => x.slice());
  if (kind === 'invert') steps = steps.map((x) => -x);
  else if (kind === 'retro') steps = steps.slice().reverse().map((x) => -x);
  else if (kind === 'vary') { const i = r.int(0, steps.length - 1); steps[i] += r.chance(0.5) ? 1 : -1; }
  else if (kind === 'augment') rh = rh.map(([t, d]) => [t * 1.5, d * 1.5]);
  else if (kind === 'tail' && steps.length >= 3) {
    steps = steps.slice(1);
    const t0 = rh[1][0];
    rh = rh.slice(1).map(([t, d]) => [t - t0, d]);
  } else if (kind === 'extend') {
    const last = rh[rh.length - 1];
    last[1] = 1;
    let t = last[0] + 1;
    const extra = r.int(1, 2);
    for (let k = 0; k < extra; k++) {
      steps.push(r.weighted([[-1, 3], [1, 2], [-2, 1]]));
      const d = k === extra - 1 ? r.pick([2, 3]) : 1;
      rh.push([t, d]);
      t += d;
    }
  }
  const out = [];
  let rel = 0;
  rh.forEach(([t, d], i) => {
    if (i > 0) rel += steps[i - 1];
    out.push({ rel, t, d });
  });
  return out;
}

/** Places a phrase in a register and on the chords, so strong and long notes sit on chord tones. */
function place(r, raw, t0, chordAt, cl, lo, hi, prev, bar, end) {
  const out = [];
  for (const x of raw) {
    const t = t0 + x.t;
    if (t > end - 0.75) break;
    out.push({ rel: x.rel, t, d: Math.min(x.d, end - t) });
  }
  if (out.length < 2) return [];
  const rels = out.map((x) => x.rel);
  const mn = Math.min(...rels);
  const mx = Math.max(...rels);
  const c0 = CHORDS[chordAt(out[0].t)];
  let start = null;
  let bc = Infinity;
  for (let d = lo - mn; d <= hi - mx; d++) {
    const pc = pcOf(degNote(d));
    if (c0.avoid.includes(pc)) continue;
    let cost = Math.abs(d - prev) * 0.5 + Math.abs(d + (mn + mx) / 2 - (lo + hi) / 2) * 0.4 + r.f() * 1.2;
    if (!c0.stable.includes(pc)) cost += 1;
    if (cost < bc) { bc = cost; start = d; }
  }
  if (start === null) start = Math.round((lo + hi) / 2 - (mn + mx) / 2);
  const L = out[out.length - 1];
  L.d = Math.max(L.d, Math.min(3, end - L.t));
  out.forEach((x, i) => {
    let deg = Math.max(lo, Math.min(hi, start + x.rel));
    const ch = CHORDS[chordAt(x.t)];
    const last = i === out.length - 1;
    const strong = x.t % bar === 0 || (bar === 4 && x.t % 2 === 0) || x.d >= 2;
    const ok = (dg) => {
      const pc = pcOf(degNote(dg));
      return last ? ch.stable.includes(pc) : !(strong && ch.avoid.includes(pc));
    };
    if (!ok(deg)) {
      for (const k of [-1, 1, -2, 2]) {
        const dg = deg + k;
        if (dg >= lo && dg <= hi && ok(dg)) { deg = dg; break; }
      }
    }
    x.deg = deg;
    if (CHORDS[chordAt(x.t + x.d - 0.01)].avoid.includes(pcOf(degNote(deg)))) {
      x.d = Math.max(0.5, (Math.floor(x.t / cl) + 1) * cl - x.t);
    }
  });
  return out;
}

function tuneLayer(s, chordAt, cl, beats, bar, ev) {
  const r = s.r;
  const mv = s.mv;
  const m = mv.motif;
  if (r.chance(0.3)) {
    const i = r.int(0, m.steps.length - 1);
    m.steps[i] = Math.max(-3, Math.min(3, m.steps[i] + (r.chance(0.5) ? 1 : -1)));
  }
  const half = beats / 2;
  const starts = r.chance(0.8) ? [0, half] : [r.chance(0.5) ? 0 : half];
  const onsets = [];
  starts.forEach((t0, p) => {
    const kind = p === 0 && t0 === 0
      ? r.weighted([['plain', 3], ['vary', 2], ['augment', 1], ['invert', 1]])
      : r.weighted([['vary', 2], ['invert', 2], ['retro', 1.5], ['tail', 1.5], ['extend', 1.5], ['plain', 1]]);
    const alto = p === 1 && r.chance(0.25);
    const [lo, hi] = alto ? ALTO : MEL;
    const notes = place(r, phraseOf(r, m, kind), t0, chordAt, cl, lo, hi, alto ? s.deg - 4 : s.deg, bar, t0 + half - Math.max(1.5, bar / 2));
    if (!alto && notes.length) s.deg = notes[notes.length - 1].deg;
    const n = notes.length;
    notes.forEach((x, i) => {
      ev.push({
        v: alto ? 'alto' : 'mel',
        n: degNote(x.deg),
        t: x.t,
        d: x.d,
        g: (0.82 + 0.18 * Math.sin((Math.PI * i) / Math.max(1, n - 1))) * r.range(0.93, 1.04),
        a: x.d >= 1.5 ? r.range(0.22, 0.32) : 0.14,
        w: mv.wave,
        pan: alto ? -1 : 0,
      });
      onsets.push(x.t);
    });
  });
  return onsets;
}

/** Broken chords. Each position is [beat in the bar, intensity it needs above `lay`], and `gain` scales every note. */
function arpLayer(s, chords, cl, bar, ev, lay, lo, hi, pos, gain) {
  const r = s.r;
  const shape = r.pick([[0, 1, 2, 3], [3, 2, 1, 0], [0, 1, 2, 3, 2, 1], [0, 2, 1, 3]]);
  const perChord = Math.round(cl / bar);
  chords.forEach((ch, i) => {
    const c = CHORDS[ch];
    const tones = [];
    for (let n = lo; n <= hi; n++) {
      const pc = pcOf(n);
      if ((c.need.includes(pc) || c.may.includes(pc)) && !c.avoid.includes(pc)) tones.push(n);
    }
    const w0 = r.int(0, Math.max(0, tones.length - 4));
    const win = tones.slice(w0, w0 + 4);
    for (let b = 0; b < perChord; b++) {
      const gb = i * perChord + b;
      pos.forEach(([p, extra], j) => {
        const n = win[shape[(gb + j) % shape.length] % win.length];
        ev.push({ v: 'arp', n, t: i * cl + b * bar + p, d: 2, g: gain * (p === 0 ? 1 : 0.8) * r.range(0.85, 1), lay: lay + extra, pan: (gb + j) % 2 ? 1 : -1 });
      });
    }
  });
}

function haloLayer(s, chords, cl, ev, lay) {
  let last = null;
  chords.forEach((ch, i) => {
    const c = CHORDS[ch];
    let n = null;
    for (let k = HALO[0]; k <= HALO[1]; k++) if (c.stable.includes(pcOf(k)) && (n === null || Math.abs(k - s.halo) < Math.abs(n - s.halo))) n = k;
    if (last && last.n === n) { last.d += cl; return; }
    last = { v: 'halo', n, t: i * cl, d: cl, g: 1, a: 2.5, lay };
    ev.push(last);
    s.halo = n;
  });
}

/** Soft high droplets on chord tones, sometimes a pair stepping down. `busy` keeps them clear of the tune. */
function dropLayer(s, chordAt, beats, ev, count, lay, busy) {
  const r = s.r;
  for (let k = 0; k < count; k++) {
    const t = r.int(0, Math.max(0, Math.floor(beats * 2) - 6)) / 2;
    if (busy && busy.some((x) => Math.abs(x - t) < 1.5)) continue;
    const c = CHORDS[chordAt(t)];
    const opts = [];
    for (let n = DROP[0]; n <= DROP[1]; n++) {
      const pc = pcOf(n);
      if ((c.stable.includes(pc) || c.may.includes(pc)) && !c.avoid.includes(pc)) opts.push(n);
    }
    const n = r.pick(opts);
    const g = r.range(0.6, 1);
    const l = k === 0 ? lay : lay + 0.3;
    const pan = r.pick([-1, 0, 1]);
    ev.push({ v: 'drop', n, t, d: 3, g, lay: l, pan });
    const low = degNote(noteDeg(n) - 1);
    if (r.chance(0.35) && low >= DROP[0] && !c.avoid.includes(pcOf(low))) {
      ev.push({ v: 'drop', n: low, t: t + r.pick([0.5, 1]), d: 3, g: g * 0.7, lay: l, pan: -pan });
    }
  }
}

function airLayer(s, beats, ev, p) {
  const r = s.r;
  if (r.chance(p)) ev.push({ v: 'air', n: 0, t: r.int(0, Math.floor(beats / 2)), d: r.range(8, 14), g: r.range(0.6, 1) });
}

/** Generates the next section of the piece as events timed in beats. */
function nextSection(s) {
  const r = s.r;
  let kind;
  if (!s.mv) { newMovement(s); kind = 'open'; }
  else if (s.left <= 0) { newMovement(s); kind = r.chance(0.5) ? 'still' : 'pads'; s.chord = null; }
  else kind = r.weighted(NEXT[s.kind]);
  s.left--;
  s.kind = kind;
  const mv = s.mv;
  const bar = mv.meter;
  const cl = bar * mv.bars;
  const short = cl < 6;
  const count = kind === 'tune' ? (short ? 8 : 4)
    : kind === 'still' || kind === 'open' ? (short ? 3 : 2)
    : short ? r.int(5, 7) : r.int(3, 4);
  const chords = [];
  for (let i = 0; i < count; i++) {
    const prev = i ? chords[i - 1] : s.chord;
    chords.push(prev === null ? mv.center : step(r, prev, mv.center));
  }
  if (kind === 'tune' && chords[count - 2] !== mv.center && r.chance(0.5)) chords[count - 1] = mv.center;
  s.chord = chords[count - 1];
  const beats = count * cl;
  const chordAt = (t) => chords[Math.max(0, Math.min(count - 1, Math.floor(t / cl)))];
  const ev = [{ v: 'cut', t: 0, d: 0, f: Math.round(mv.cut * r.range(0.85, 1.15)) }];
  const quiet = kind === 'still' || kind === 'open';
  padLayer(s, chords, cl, ev, quiet ? 3 : mv.voices, quiet);
  bassLayer(s, chords, cl, bar, ev, kind !== 'tune' && r.chance(mv.pedal));
  const four = bar === 4;
  if (kind === 'open') {
    dropLayer(s, chordAt, beats, ev, 1, 0.3);
  } else if (kind === 'still') {
    dropLayer(s, chordAt, beats, ev, r.int(0, 1), 0.2);
    airLayer(s, beats, ev, 0.4);
  } else if (kind === 'pads') {
    dropLayer(s, chordAt, beats, ev, r.int(1, 3), 0);
    arpLayer(s, chords, cl, bar, ev, 0.35, 60, 76, four ? [[0, 0], [2, 0.2], [3, 0.45]] : [[0, 0], [2, 0.2], [1, 0.45]], 0.9);
    haloLayer(s, chords, cl, ev, 0.6);
    airLayer(s, beats, ev, 0.3);
  } else if (kind === 'drift') {
    arpLayer(s, chords, cl, bar, ev, 0, 60, 76, four ? [[0, 0], [2, 0], [3, 0.5]] : [[0, 0], [2, 0], [1, 0.5]], 1);
    haloLayer(s, chords, cl, ev, 0.6);
    dropLayer(s, chordAt, beats, ev, r.int(0, 1), 0.4);
    airLayer(s, beats, ev, 0.25);
  } else {
    const onsets = tuneLayer(s, chordAt, cl, beats, bar, ev);
    arpLayer(s, chords, cl, bar, ev, 0.55, 55, 67, four ? [[0, 0], [2, 0.3]] : [[0, 0]], 0.6);
    haloLayer(s, chords, cl, ev, 0.7);
    dropLayer(s, chordAt, beats, ev, r.int(0, 1), 0.3, onsets);
    airLayer(s, beats, ev, 0.15);
  }
  ev.sort((a, b) => a.t - b.t);
  return { beats, bpm: mv.bpm, kind, ev, chords, center: mv.center, meter: bar };
}

/** Appends the next section to a queue as events with start times and lengths in seconds. Returns its end. */
function queueSection(q, s, start, seen) {
  const sec = nextSection(s);
  const spb = 60 / sec.bpm;
  if (seen) seen({ at: start, secs: sec.beats * spb, kind: sec.kind, bpm: sec.bpm, meter: sec.meter, center: sec.center, chords: sec.chords });
  for (const e of sec.ev) q.push({ ...e, at: start + e.t * spb, dur: e.d * spb });
  return start + sec.beats * spb;
}

// ---------------------------------------------------------------- voices

function buildRig(ac, dest) {
  const nodes = [];
  const gain = (v) => { const g = ac.createGain(); g.gain.value = v; nodes.push(g); return g; };
  // Web Audio reads a low-pass Q in dB, so -3 gives the flat response with no peak at the cutoff.
  const filter = (type, f, q) => {
    const b = ac.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    nodes.push(b);
    return b;
  };
  const panner = (x) => {
    if (!ac.createStereoPanner) return gain(1);
    const p = ac.createStereoPanner();
    p.pan.value = x;
    nodes.push(p);
    return p;
  };
  const master = gain(0);
  master.connect(dest);

  // A ping-pong echo whose repeats darken, for space around the tune and the droplets.
  const echo = gain(1);
  const dl = ac.createDelay(2);
  const dr = ac.createDelay(2);
  nodes.push(dl, dr);
  dl.delayTime.value = 0.62;
  dr.delayTime.value = 0.86;
  const fl = filter('lowpass', 1700, -3);
  const fr = filter('lowpass', 1400, -3);
  const fbl = gain(0.36);
  const fbr = gain(0.36);
  const pl = panner(-0.6);
  const pr = panner(0.6);
  const wet = gain(0.5);
  echo.connect(dl);
  dl.connect(fl);
  fl.connect(pl);
  fl.connect(fbl);
  fbl.connect(dr);
  dr.connect(fr);
  fr.connect(pr);
  fr.connect(fbr);
  fbr.connect(dl);
  pl.connect(wet);
  pr.connect(wet);
  wet.connect(master);

  const bus = (send, head, sides) => {
    const inp = gain(1);
    let o = inp;
    if (head) { inp.connect(head); o = head; }
    o.connect(master);
    if (send) { const sg = gain(send); o.connect(sg); sg.connect(echo); }
    const b = { C: inp, L: inp, R: inp };
    for (const k of sides) { b[k] = panner(k === 'L' ? -0.45 : 0.45); b[k].connect(inp); }
    return b;
  };
  const padLP = filter('lowpass', 1000, -3);
  const pad = bus(0.14, padLP, ['L', 'R']);
  const bass = bus(0, null, []);
  const lead = bus(0.32, null, ['L']);
  const bell = bus(0.45, null, ['L', 'R']);
  const air = bus(0.15, null, []);

  const vib = ac.createOscillator();
  vib.frequency.value = 4.6;
  nodes.push(vib);
  vib.start();

  const wave = (amps) => {
    const re = new Float32Array(amps.length + 1);
    const im = new Float32Array(amps.length + 1);
    amps.forEach((a, i) => { im[i + 1] = a; });
    return ac.createPeriodicWave(re, im);
  };
  const sr = ac.sampleRate;
  const noise = ac.createBuffer(1, Math.round(sr * 3), sr);
  const nd = noise.getChannelData(0);
  let x = 99991;
  for (let i = 0; i < nd.length; i++) { x = (x * 16807) % 2147483647; nd[i] = (x / 2147483647) * 2 - 1; }

  return {
    ac, master, padLP, pad, bass, lead, bell, air, vib, noise,
    waves: {
      warm: wave([1, 0.5, 0.25, 0.14, 0.08, 0.05, 0.03]),
      round: wave([1, 0.4, 0.15, 0.05]),
      lead: [wave([1, 0.2, 0.07, 0.025]), wave([1, 0.06, 0.14, 0.02, 0.02]), wave([1, 0.32, 0.12, 0.05, 0.02])],
      glass: wave([1, 0.07, 0.015]),
    },
    lfos: [vib],
    nodes,
    live: new Set(),
    made: 0,
  };
}

/** Rises to `peak` over `a`, holds until `hold` after the start, then fades 60 dB over `rel`. Returns the stop time. */
function sustain(p, at, a, hold, rel, peak) {
  const v = Math.max(peak, 1e-5);
  const top = at + a;
  const rs = Math.max(top, at + hold);
  p.setValueAtTime(0, at);
  p.linearRampToValueAtTime(v, top);
  if (rs > top) p.setValueAtTime(v, rs);
  p.exponentialRampToValueAtTime(v * 0.001, rs + rel);
  p.linearRampToValueAtTime(0, rs + rel + 0.02);
  return rs + rel + 0.03;
}

function own(rig, src, done) {
  rig.live.add(src);
  src.onended = () => { rig.live.delete(src); done(); };
}

function side(b, pan) {
  return pan < 0 ? b.L : pan > 0 ? b.R : b.C;
}

/** One pitched note. `ring` makes it decay from the peak instead of holding; `vib` is [delay s, cents]. */
function tone(rig, o) {
  const ac = rig.ac;
  const env = ac.createGain();
  env.gain.value = 0;
  env.connect(o.dest);
  const end = sustain(env.gain, o.at, o.a, o.ring ? o.a : o.hold, o.rel, o.peak);
  const f = mtof(o.n);
  const oscs = o.det.map((c) => {
    const s = ac.createOscillator();
    s.setPeriodicWave(o.wave);
    s.frequency.value = f;
    s.detune.value = c;
    s.connect(env);
    s.start(o.at);
    s.stop(end);
    return s;
  });
  let vg = null;
  if (o.vib) {
    vg = ac.createGain();
    vg.gain.value = 0;
    vg.gain.setValueAtTime(0, o.at + o.vib[0]);
    vg.gain.linearRampToValueAtTime(o.vib[1], o.at + o.vib[0] + 0.8);
    rig.vib.connect(vg);
    for (const s of oscs) vg.connect(s.detune);
  }
  rig.made += oscs.length + 1 + (vg ? 1 : 0);
  for (const s of oscs.slice(1)) own(rig, s, () => {});
  own(rig, oscs[0], () => {
    for (const s of oscs) s.disconnect();
    env.disconnect();
    if (vg) { try { rig.vib.disconnect(vg); } catch { /* already gone */ } vg.disconnect(); }
  });
}

function breeze(rig, at, dur, peak) {
  const ac = rig.ac;
  const src = ac.createBufferSource();
  src.buffer = rig.noise;
  src.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(380, at);
  bp.frequency.linearRampToValueAtTime(720, at + dur * 0.5);
  bp.frequency.linearRampToValueAtTime(420, at + dur);
  // A band-pass alone leaks hiss above 5 kHz.
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1100;
  lp.Q.value = -3;
  const env = ac.createGain();
  env.gain.value = 0;
  const end = sustain(env.gain, at, dur * 0.45, dur * 0.5, dur * 0.7, peak);
  src.connect(bp);
  bp.connect(lp);
  lp.connect(env);
  env.connect(rig.air.C);
  src.start(at, (at * 0.731) % 2);
  src.stop(end);
  rig.made += 4;
  own(rig, src, () => { src.disconnect(); bp.disconnect(); lp.disconnect(); env.disconnect(); });
}

function play(rig, e, at, dur) {
  const w = rig.waves;
  switch (e.v) {
    case 'cut': rig.padLP.frequency.setTargetAtTime(e.f, at, 4); return;
    case 'pad': return tone(rig, { n: e.n, at, a: e.a, hold: dur, rel: 3.5, peak: 0.0131 * e.g, wave: w.warm, det: [-e.det, e.det], dest: side(rig.pad, e.pan) });
    case 'bass': return tone(rig, { n: e.n, at, a: e.a, hold: dur, rel: 2.2, peak: 0.015 * e.g, wave: w.round, det: [0], dest: rig.bass.C });
    case 'mel': return tone(rig, { n: e.n, at, a: e.a, hold: dur, rel: 1.1, peak: 0.022 * e.g, wave: w.lead[e.w], det: [0], dest: rig.lead.C, vib: dur > 0.9 ? [0.35, 7] : null });
    case 'alto': return tone(rig, { n: e.n, at, a: e.a, hold: dur, rel: 1.3, peak: 0.024 * e.g, wave: w.lead[e.w], det: [0], dest: rig.lead.L, vib: dur > 0.9 ? [0.4, 5] : null });
    case 'arp': return tone(rig, { n: e.n, at, a: 0.09, ring: true, rel: 2.2, peak: 0.022 * e.g, wave: w.lead[0], det: [0], dest: side(rig.bell, e.pan) });
    case 'drop': return tone(rig, { n: e.n, at, a: 0.07, ring: true, rel: 3, peak: 0.017 * e.g, wave: w.glass, det: [0], dest: side(rig.bell, e.pan) });
    case 'halo': return tone(rig, { n: e.n, at, a: e.a, hold: dur, rel: 3, peak: 0.006 * e.g, wave: w.glass, det: [0], dest: rig.bell.C });
    case 'air': return breeze(rig, at, dur, 0.04 * e.g);
  }
}

function teardown(rig) {
  for (const src of rig.live) { try { src.stop(); } catch { /* never started */ } }
  for (const o of rig.lfos) { try { o.stop(); } catch { /* already stopped */ } }
  for (const n of rig.nodes) { try { n.disconnect(); } catch { /* already disconnected */ } }
}

/** Ramps a gain from wherever it is now. A ramp alone would start from the last event, which may be long past. */
function fade(p, now, v, secs) {
  const cur = p.value;
  p.cancelScheduledValues(now);
  p.setValueAtTime(cur, now);
  p.linearRampToValueAtTime(v, now + secs);
}

// ---------------------------------------------------------------- live playback

const SUSTAINED = new Set(['pad', 'bass', 'halo', 'air']);
let player = null;
let song = null;
let target = 0;

function lookahead() {
  try { return typeof document !== 'undefined' && document.hidden ? 4 : 2; } catch { return 2; }
}

/** Hands queued events that start before `horizon` to Web Audio. A late long note starts now; a late short one is dropped. */
function pump(p, now, horizon, level, keep) {
  const q = p.q;
  while (p.qi < q.length && q[p.qi].at < horizon) {
    const e = q[p.qi++];
    if ((e.lay || 0) > level(e.at)) continue;
    if (keep && !keep(e)) continue;
    let at = e.at;
    let dur = e.dur;
    if (at < now + 0.02) {
      if (e.v === 'cut') at = now;
      else if (!SUSTAINED.has(e.v) || at + dur < now + 1) continue;
      else { dur -= now + 0.05 - at; at = now + 0.05; }
    }
    play(p.rig, e, at, dur);
  }
  if (p.qi > 200) { q.splice(0, p.qi); p.qi = 0; }
}

function tick(p) {
  const ac = p.ac;
  if (ac.state === 'closed') { finish(p); return; }
  const now = ac.currentTime;
  const dt = Math.min(10, Math.max(0, now - p.last));
  p.last = now;
  p.level += (target - p.level) * (1 - Math.exp(-dt / SMOOTH));
  const horizon = now + lookahead();
  if (p.end < now) p.end = now + 0.1;
  while (p.end < horizon + 1) p.end = queueSection(p.q, song, p.end);
  pump(p, now, horizon, () => p.level);
}

function finish(p) {
  if (p.timer !== null) clearInterval(p.timer);
  if (p.cleanup !== null) clearTimeout(p.cleanup);
  p.timer = null;
  p.cleanup = null;
  p.q.length = 0;
  p.qi = 0;
  teardown(p.rig);
  if (player === p) player = null;
}

function fadeOut(p) {
  p.stopping = true;
  if (p.timer !== null) clearInterval(p.timer);
  p.timer = null;
  fade(p.rig.master.gain, p.ac.currentTime, 0, FADE_OUT);
  p.cleanup = setTimeout(() => { p.cleanup = null; finish(p); }, FADE_OUT * 1000 + 150);
}

/** Starts the music on an existing AudioContext into `out`, fading in. Does nothing while it already plays. */
export function startMusic(ctx, out) {
  if (!ctx || !out || ctx.state === 'closed') return;
  const p0 = player;
  if (p0 && p0.ac === ctx && p0.out === out) {
    if (!p0.stopping) return;
    clearTimeout(p0.cleanup);
    p0.cleanup = null;
    p0.stopping = false;
    fade(p0.rig.master.gain, ctx.currentTime, LEVEL, FADE_IN * 0.5);
    p0.timer = setInterval(() => tick(p0), TICK_MS);
    tick(p0);
    return;
  }
  if (p0 && !p0.stopping) fadeOut(p0);
  if (!song) song = newSong((Math.random() * 4294967296) >>> 0);
  const now = ctx.currentTime;
  const rig = buildRig(ctx, out);
  rig.master.gain.setValueAtTime(0, now);
  rig.master.gain.linearRampToValueAtTime(LEVEL, now + FADE_IN);
  const p = { ac: ctx, out, rig, q: [], qi: 0, end: now + 0.1, last: now, level: target, stopping: false, timer: null, cleanup: null };
  player = p;
  p.timer = setInterval(() => tick(p), TICK_MS);
  tick(p);
}

/** Fades the music out over a second, then stops every node and timer it made. */
export function stopMusic() {
  if (player && !player.stopping) fadeOut(player);
}

/** Sets how busy the music is, from 0 (sparse) to 1 (a few more layers, still calm). */
export function setIntensity(x) {
  const v = Number(x);
  if (Number.isFinite(v)) target = Math.max(0, Math.min(1, v));
}

/**
 * Renders `seconds` of music offline with the live generator and resolves to the AudioBuffer.
 * opts: seed, intensity (a number or a function of time in seconds), sampleRate, voices (names to keep), onNote(event), onSection(section), and stats (gets fixedNodes and noteNodes).
 */
export function renderOffline(seconds, opts = {}) {
  const sr = opts.sampleRate || 44100;
  const ac = new OfflineAudioContext(2, Math.max(1, Math.ceil(sr * seconds)), sr);
  const rig = buildRig(ac, ac.destination);
  rig.master.gain.setValueAtTime(0, 0);
  rig.master.gain.linearRampToValueAtTime(LEVEL, FADE_IN);
  const lvl = typeof opts.intensity === 'function' ? opts.intensity : () => opts.intensity || 0;
  const s = newSong(opts.seed ?? 1);
  const p = { rig, q: [], qi: 0 };
  let end = 0.1;
  const keep = (e) => {
    if (e.at >= seconds || (opts.voices && !opts.voices.includes(e.v))) return false;
    if (opts.onNote && e.v !== 'cut') opts.onNote({ v: e.v, n: e.n, at: e.at, dur: e.dur, lay: e.lay || 0 });
    return true;
  };
  const fill = (now, horizon) => {
    while (end < horizon + 1) end = queueSection(p.q, s, end, opts.onSection);
    pump(p, now, horizon, lvl, keep);
  };
  // Suspending once a second hands notes over the way the live scheduler does, so finished notes leave the graph.
  if (ac.suspend) {
    fill(0, 2);
    for (let t = 1; t < seconds - 0.1; t++) ac.suspend(t).then(() => { fill(t, t + 2); ac.resume(); });
  } else fill(0, seconds);
  return ac.startRendering().then((buf) => {
    if (opts.stats) { opts.stats.fixedNodes = rig.nodes.length; opts.stats.noteNodes = rig.made; }
    return buf;
  });
}
