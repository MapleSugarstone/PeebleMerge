// Short synthesized sound effects. Every sound is built from one voice() call or a few of them.

let ac = null;
let out = null;
let musicGain = null;
let muted = false;
const VOLUME = 1.5;
const MUSIC_VOLUME = 1;
// Slider settings from 0 to 1. The default of 0.8 plays at the base volume and 1 plays 1.5 times louder.
let sfxVol = 0.8;
let musicVol = 0.8;
const curve = (v) => 1.5 * v * v;
// Effects start this many seconds after the call. Scheduling at the current time loses the first few milliseconds.
const LEAD = 0.03;

let offline = null;
let base = 0;

function open(context) {
  ac = context;
  // A limiter keeps several overlapping sounds from clipping.
  const limit = ac.createDynamicsCompressor();
  limit.threshold.value = -3;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.attack.value = 0.002;
  limit.release.value = 0.12;
  limit.connect(ac.destination);
  out = ac.createGain();
  out.connect(limit);
  musicGain = ac.createGain();
  musicGain.connect(limit);
  applyGains(true);
  // Older mobile browsers only start audio after something plays inside a touch handler.
  const silent = ac.createBufferSource();
  silent.buffer = ac.createBuffer(1, 1, 22050);
  silent.connect(ac.destination);
  silent.start(0);
}

/** True while something should be audible. */
function wantRunning() {
  return !muted && (sfxVol > 0 || musicVol > 0) && !document.hidden;
}

// Phones give a page the "playback" audio session by default, which pauses the player's own music and videos.
// The "ambient" session mixes with them and follows the ringer switch. Browsers without the API keep their default.
function takeAmbientSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'ambient';
  } catch { /* the browser keeps its default session */ }
}

// A running context holds the device's audio session even at zero gain, so it is suspended whenever nothing should play.
function applySession() {
  if (!ac || ac.state === 'closed') return;
  if (wantRunning()) {
    if (ac.state !== 'running') ac.resume().catch(() => {});
  } else if (ac.state !== 'suspended') {
    ac.suspend().catch(() => {});
  }
}

/** Creates or resumes the audio context while sound is wanted. Call it from a touch or click handler. */
export function unlock() {
  if (!ac) {
    if (!wantRunning()) return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    takeAmbientSession();
    try { open(new Ctx()); } catch { return null; }
    document.addEventListener('visibilitychange', applySession);
  }
  applySession();
  return ac;
}

export function isMuted() { return muted; }

// Slider moves glide over about 30 ms so the gain change does not crackle.
function applyGains(now = false) {
  if (!out) return;
  const fx = muted ? 0 : VOLUME * curve(sfxVol);
  const mu = muted ? 0 : MUSIC_VOLUME * curve(musicVol);
  if (now) {
    out.gain.value = fx;
    musicGain.gain.value = mu;
    return;
  }
  const t = ac.currentTime;
  out.gain.setTargetAtTime(fx, t, 0.03);
  musicGain.gain.setTargetAtTime(mu, t, 0.03);
}

export function setMuted(m) {
  muted = m;
  applyGains();
  applySession();
}

/** Sets the effects volume from 0 to 1. */
export function setSfxVolume(v) {
  sfxVol = Math.max(0, Math.min(1, v));
  applyGains();
  applySession();
}

/** Sets the music volume from 0 to 1. */
export function setMusicVolume(v) {
  musicVol = Math.max(0, Math.min(1, v));
  applyGains();
  applySession();
}

/** The audio context and the node music connects to, or null without audio. */
export function musicBus() {
  const a = unlock();
  return a ? { ctx: a, out: musicGain } : null;
}

function target() {
  if (offline) return { a: offline.a, dest: offline.dest, t: base };
  if (muted || sfxVol === 0) return null;
  const a = unlock();
  if (!a) return null;
  return { a, dest: out, t: a.currentTime + LEAD };
}

const noiseBufs = new WeakMap();
function noiseBuf(a) {
  let b = noiseBufs.get(a);
  if (!b) {
    b = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = b.getChannelData(0);
    let s = 7;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    noiseBufs.set(a, b);
  }
  return b;
}

/** A path of points as automation values, gliding geometrically between them. */
function path(pts, n = 48) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (pts.length === 1) { c[i] = pts[0]; continue; }
    const p = (i / (n - 1)) * (pts.length - 1);
    const k = Math.min(pts.length - 2, Math.floor(p));
    const u = p - k;
    c[i] = pts[k] * Math.pow(pts[k + 1] / pts[k], u);
  }
  return c;
}

function lfo(a, t, end, rate, depth, into) {
  const l = a.createOscillator();
  l.frequency.setValueAtTime(rate[0], t);
  if (rate[1]) l.frequency.linearRampToValueAtTime(rate[1], end);
  const g = a.createGain();
  g.gain.value = depth;
  l.connect(g);
  for (const p of into) g.connect(p);
  l.start(t);
  l.stop(end + 0.05);
}

/**
 * One synth voice.
 * w: oscillator type, or 'noise' for noise through a band-pass whose center follows f.
 * f: pitch path in Hz. dur: seconds. vol: peak gain. at: delay. a: attack.
 * vib: [rate Hz, depth cents, end rate]. trem: [rate Hz, depth 0 to 1, end rate].
 * fm: [modulator ratio, start index, end index]. lp: [cutoff path, Q]. q: band-pass Q for noise.
 * wide: detune of a second oscillator in cents. pan: -1 to 1.
 */
function voice(v) {
  const o = target();
  if (!o) return;
  const a = o.a;
  const t = o.t + (v.at || 0);
  const end = t + v.dur;
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(v.vol * (v.wide ? 0.65 : 1), t + (v.a ?? 0.004));
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  if (v.pan && a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, v.pan));
    p.connect(o.dest);
    env.connect(p);
  } else env.connect(o.dest);
  let into = env;
  if (v.trem) {
    const tg = a.createGain();
    tg.gain.value = 1 - v.trem[1] / 2;
    lfo(a, t, end, [v.trem[0], v.trem[2]], v.trem[1] / 2, [tg.gain]);
    tg.connect(into);
    into = tg;
  }
  if (v.w === 'noise' || v.lp) {
    const fl = a.createBiquadFilter();
    fl.type = v.w === 'noise' ? 'bandpass' : 'lowpass';
    fl.Q.value = v.w === 'noise' ? v.q ?? 1 : v.lp[1];
    fl.frequency.setValueCurveAtTime(path(v.w === 'noise' ? v.f : v.lp[0]), t, v.dur);
    fl.connect(into);
    into = fl;
  }
  if (v.w === 'noise') {
    const s = a.createBufferSource();
    s.buffer = noiseBuf(a);
    s.loop = true;
    s.connect(into);
    s.start(t, Math.random() * 1.5);
    s.stop(end + 0.05);
    return;
  }
  const pitch = path(v.f);
  const oscs = (v.wide ? [0, v.wide] : [0]).map((dt) => {
    const s = a.createOscillator();
    s.type = v.w;
    s.frequency.setValueCurveAtTime(pitch, t, v.dur);
    s.detune.value = dt;
    s.connect(into);
    s.start(t);
    s.stop(end + 0.05);
    return s;
  });
  if (v.vib) lfo(a, t, end, [v.vib[0], v.vib[2]], v.vib[1], oscs.map((s) => s.detune));
  if (v.fm) {
    const [ratio, i0, i1 = i0] = v.fm;
    const m = a.createOscillator();
    m.frequency.setValueCurveAtTime(pitch.map((x) => x * ratio), t, v.dur);
    const mg = a.createGain();
    mg.gain.setValueCurveAtTime(pitch.map((x, i) => x * (i0 + ((i1 - i0) * i) / (pitch.length - 1))), t, v.dur);
    m.connect(mg);
    for (const s of oscs) mg.connect(s.frequency);
    m.start(t);
    m.stop(end + 0.05);
  }
}

/** Nudges a value up or down by up to `amt` of itself, so repeated sounds are never identical. */
const jit = (x, amt = 0.04) => x * (1 + (Math.random() * 2 - 1) * amt);

// Block levels climb a major pentatonic scale from middle C, so every merge sounds in tune with the last.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
export const note = (level) => 261.63 * Math.pow(2, PENTA[Math.max(0, Math.min(PENTA.length - 1, level - 1))] / 12);

/** A soft bell: a sine that swells in over a few milliseconds with a faint harmonic that fades first. */
function chime(f, at = 0, vol = 0.06, dur = 0.7) {
  voice({ w: 'sine', f: [f, f * 1.001], dur, vol, at, a: 0.02, fm: [2, 0.35, 0] });
}

export const SFX = ['place', 'merge', 'select', 'deselect', 'toolOn', 'toolOff', 'smash', 'rewind', 'blueprint', 'swap', 'scoot', 'spin', 'luxury', 'scorch', 'bloom', 'shuffle', 'teleport', 'beam', 'tick', 'gravity', 'monolith', 'revert', 'seed', 'levelUp', 'max', 'over', 'best', 'newRun'];

/** Plays a named effect. `level` is the block level for place, merge, and seed, and the rarity index for levelUp. */
export function sfx(name, level = 1) {
  switch (name) {
    // A low, round settle. Higher blocks land a little lower.
    case 'place': {
      const f = jit(330 * Math.pow(2, -(level - 1) / 24), 0.02);
      voice({ w: 'sine', f: [f * 1.06, f], dur: 0.2, vol: 0.052, a: 0.018 });
      break;
    }
    // A bell on the new block's note. Level 6 and up adds a quiet note two scale steps up, and level 9 and up a faint octave.
    case 'merge': {
      const f = note(level);
      chime(f, 0, 0.07, 0.7 + level * 0.03);
      if (level >= 6) chime(note(level + 2), 0.12, 0.03, 0.7);
      if (level >= 9) voice({ w: 'sine', f: [f * 2], dur: 0.9, vol: 0.015, at: 0.05, a: 0.15 });
      break;
    }
    case 'select': voice({ w: 'sine', f: [620, 660], dur: 0.08, vol: 0.022, a: 0.012 }); break;
    case 'deselect': voice({ w: 'sine', f: [560, 520], dur: 0.08, vol: 0.02, a: 0.012 }); break;
    case 'toolOn':
      chime(note(5), 0, 0.03, 0.15);
      chime(note(7), 0.06, 0.03, 0.2);
      break;
    case 'toolOff':
      chime(note(7), 0, 0.03, 0.15);
      chime(note(5), 0.06, 0.03, 0.2);
      break;
    // A soft thump with a brush of air after it.
    case 'smash':
      voice({ w: 'sine', f: [150, 85], dur: 0.25, vol: 0.085, a: 0.012 });
      voice({ w: 'noise', f: [900, 420], dur: 0.3, vol: 0.035, q: 0.7, a: 0.04 });
      break;
    // A breath drawn in over a tone sliding down.
    case 'rewind':
      voice({ w: 'noise', f: [600, 1500], dur: 0.32, vol: 0.03, a: 0.2, q: 1 });
      voice({ w: 'sine', f: [660, 520], dur: 0.32, vol: 0.035, a: 0.05 });
      break;
    // Two quiet notes that play over the place sound.
    case 'blueprint':
      chime(note(8), 0.08, 0.035, 0.45);
      chime(note(10), 0.2, 0.035, 0.6);
      break;
    // Two notes passing each other, one rising and one falling.
    case 'swap':
      voice({ w: 'sine', f: [note(6), note(9)], dur: 0.3, vol: 0.04, a: 0.04 });
      voice({ w: 'sine', f: [note(9), note(6)], dur: 0.3, vol: 0.035, a: 0.04 });
      break;
    // A short soft slide.
    case 'scoot':
      voice({ w: 'sine', f: [note(5), note(6)], dur: 0.16, vol: 0.04, a: 0.03 });
      break;
    // Four notes turning around the scale.
    case 'spin':
      [5, 7, 6, 8].forEach((lv, i) => chime(note(lv), i * 0.06, 0.028, 0.3));
      break;
    // A bright rising pair with a held shimmer.
    case 'luxury':
      chime(note(9), 0, 0.04, 0.4);
      chime(note(11), 0.1, 0.04, 0.8);
      voice({ w: 'sine', f: [note(13)], dur: 0.9, vol: 0.012, at: 0.15, a: 0.2 });
      break;
    // A low soft rush of air.
    case 'scorch':
      voice({ w: 'noise', f: [500, 1400, 600], dur: 0.6, vol: 0.05, a: 0.15, q: 0.8 });
      voice({ w: 'sine', f: [120, 80], dur: 0.4, vol: 0.06, a: 0.03 });
      break;
    // Three bells opening upward.
    case 'bloom':
      [note(7), note(9), note(11)].forEach((f, i) => chime(f, i * 0.12, 0.045, 0.7));
      break;
    // A quick scatter of notes across the scale.
    case 'shuffle':
      [9, 6, 11, 7, 10, 8].forEach((lv, i) => chime(note(lv), i * 0.045, 0.024, 0.25));
      break;
    // A shimmer that drops out, then reappears higher.
    case 'teleport':
      voice({ w: 'sine', f: [note(9), note(6)], dur: 0.14, vol: 0.035, a: 0.02 });
      chime(note(11), 0.16, 0.04, 0.5);
      break;
    // A soft whoosh as the tape settles.
    case 'beam':
      voice({ w: 'noise', f: [900, 1600], dur: 0.18, vol: 0.025, a: 0.06, q: 1.2 });
      chime(note(8), 0.08, 0.03, 0.35);
      break;
    // One faint click per tile that passes while Beam is dragged.
    case 'tick':
      voice({ w: 'sine', f: [880], dur: 0.04, vol: 0.012, a: 0.004 });
      break;
    // A low falling glide as everything drops.
    case 'gravity':
      voice({ w: 'sine', f: [440, 180], dur: 0.35, vol: 0.05, a: 0.03 });
      break;
    // A deep tone with a slow high shimmer over it.
    case 'monolith':
      voice({ w: 'sine', f: [98, 100], dur: 1.2, vol: 0.09, a: 0.08 });
      voice({ w: 'sine', f: [note(11)], dur: 1.1, vol: 0.02, at: 0.15, a: 0.3, vib: [5, 15] });
      voice({ w: 'sine', f: [note(13)], dur: 1, vol: 0.014, at: 0.3, a: 0.3 });
      break;
    // The lift wears off: two soft notes stepping down.
    case 'revert':
      chime(note(8), 0, 0.03, 0.3);
      chime(note(6), 0.1, 0.03, 0.45);
      break;
    // A slow rise, then one bell.
    case 'seed':
      voice({ w: 'sine', f: [300, 480], dur: 0.4, vol: 0.04, a: 0.08 });
      chime(note(9), 0.22, 0.035, 0.6);
      break;
    // Three notes up the scale. Rarer drops add a fourth note and hold the last one longer.
    case 'levelUp': {
      const rare = Math.max(0, level);
      const notes = [note(6), note(8), note(10)];
      if (rare >= 2) notes.push(note(11));
      notes.forEach((f, i) => chime(f, i * 0.11, 0.045, i === notes.length - 1 ? 1 + rare * 0.25 : 0.45));
      if (rare >= 3) chime(note(13), notes.length * 0.11, 0.025, 1.6);
      break;
    }
    // The top block: the scale run up in one breath, landing on a held chord.
    case 'max':
      [1, 3, 5, 6, 8, 10].forEach((lv, i) => chime(note(lv + 3), 0.2 + i * 0.08, 0.035, 0.45));
      [note(11), note(13), note(14)].forEach((f) => chime(f, 0.7, 0.03, 1.8));
      break;
    // The run is over: three bells walking down.
    case 'over':
      [note(8), note(7), note(6)].forEach((f, i) => chime(f, 0.25 + i * 0.26, 0.05, i === 2 ? 1.5 : 0.7));
      break;
    // A new best score: a climb with a held finish.
    case 'best':
      [note(6), note(7), note(8), note(9)].forEach((f, i) => chime(f, 0.25 + i * 0.11, 0.045, 0.5));
      chime(note(11), 0.72, 0.045, 1.5);
      break;
    case 'newRun':
      chime(note(6), 0, 0.04, 0.5);
      chime(note(8), 0.12, 0.04, 0.8);
      break;
  }
}

/** Renders `play` offline and returns its peak and loudness, for checking levels without listening. */
export async function measure(play, dur = 1.5) {
  const sr = 44100;
  const a = new OfflineAudioContext(1, Math.ceil(sr * (dur + 0.2)), sr);
  const g = a.createGain();
  g.gain.value = VOLUME;
  g.connect(a.destination);
  offline = { a, dest: g };
  base = 0.05;
  try { play(); } finally { offline = null; base = 0; }
  const d = (await a.startRendering()).getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const win = Math.round(sr * 0.05);
  const wins = [];
  for (let i = 0; i + win <= d.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += d[j] * d[j];
    wins.push(s / win);
  }
  const top = Math.max(...wins, 1e-12);
  const live = wins.filter((w) => w > top * 1e-4);
  const level = Math.sqrt(live.reduce((n, w) => n + w, 0) / Math.max(1, live.length));
  return { peak: +peak.toFixed(3), level: +level.toFixed(4) };
}
