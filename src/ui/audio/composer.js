/**
 * composer.js
 * Decides what plays on every sixteenth: the chord, the melody, the arpeggio,
 * the bass line, the drums and the ambient texture. music.js calls step() a
 * little ahead of the audio clock; this file only chooses notes and hands them
 * to instruments.js.
 *
 * Two kinds of randomness. Composition material (a motif, an ostinato, a chord
 * loop) comes from the score's seed, so a seed always gives the same tune.
 * Performance (which note the melody wanders to, whether a ghost note plays)
 * comes from the rig's generator. Neither is a simulation stream: music must
 * never shift the economy, and Math.random is banned from src.
 */

import { INSTRUMENTS, DRUM_VOICES, playInst, playDrip, playPatter, playCrackle, playCricket } from './instruments.js';

export const LAYERS = ['pad', 'bass', 'lead', 'arp', 'drums', 'texture', 'machine', 'stings'];
export const MELODY_BASE = ['Off', 'Wander', 'Motif', 'Call & response', 'Ostinato', 'Sparse'];

/** The keys of a library table, without its `_note`. */
export const names = (table) => Object.keys(table).filter((k) => !k.startsWith('_'));
export const melodyModes = (L) => [...MELODY_BASE, ...names(L.themes).map((k) => 'Theme: ' + k)];
export const themeOf = (L, S) => (S.melody.startsWith('Theme: ') ? L.themes[S.melody.slice(7)] ?? null : null);

export const mod = (n, m) => ((n % m) + m) % m;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A theme's melody as notes by start step, plus its length in bars and steps. */
export function parseTheme(theme, meters) {
  const notes = [];
  let pos = 0;
  for (const tok of theme.melody.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [d, l] = tok.split('/');
    if (d !== 'r') notes.push({ pos, deg: +d, len: +l });
    pos += +l;
  }
  const bars = theme.chords.reduce((a, c) => a + c[1], 0);
  return { bars, steps: pos, expected: bars * meters[theme.meter].steps, byPos: new Map(notes.map((n) => [n.pos, n])) };
}

/** A bass line as notes by start step: { off, len }. */
export function parseLine(str) {
  const ev = new Map();
  for (let i = 0; i < str.length; i++) {
    if (str[i] < '0' || str[i] > '9') continue;
    let len = 1;
    while (str[i + len] === '-') len++;
    ev.set(i, { off: +str[i], len });
  }
  return ev;
}

// Where each chord (scale degree) likes to go next.
const NEXT = { 0: [3, 5, 4, 1, 2], 1: [4, 6, 0], 2: [5, 3], 3: [0, 4, 1, 6], 4: [0, 5, 3], 5: [3, 1, 4, 2], 6: [0, 2, 5] };
const CELLS = {
  4: [[4], [2, 2], [2, 2], [3, 1], [1, 1, 2], [2, 1, 1], [1, 3], [4], [2, 2]],
  6: [[6], [2, 2, 2], [4, 2], [2, 4], [3, 3], [2, 2, 2]],
};
const CHORD_TONE_DEGS = [-3, 0, 2, 4, 7, 9, 11];
const VEL = { X: 1, x: 0.7, o: 0.35 };
const withIndex = (m) => ({ ...m, byPos: new Map(m.notes.map((n) => [n.pos, n])) });

export function createComposer(r) {
  const { L } = r;
  const S = r.S;
  const themes = Object.fromEntries(names(L.themes).map((k) => [k, { ...L.themes[k], ...parseTheme(L.themes[k], L.meters) }]));
  const bassCache = {};

  const M = {
    pos: 0, bar: 0,
    chord: { deg: 0, tones: [0, 2, 4] }, pedal: false,
    melody: 7, arpIdx: 0, themeOrigin: 0, fill: false,
    motif: null, call: null, response: null, ost: null, loop: null,
    level: Object.fromEntries(LAYERS.map((l) => [l, 1])), section: null,
  };

  let crng = mulberry32(S.seed);
  const pickR = (arr) => arr[Math.floor(crng() * arr.length)];
  const { rand, pick } = r;

  const scale = () => L.scales[S.scale];
  const meter = () => L.meters[S.meter];
  const stepDur = () => 60 / S.bpm / 4;
  const lowRoot = () => S.root - (S.root > 6 ? 12 : 0);
  const leadBase = () => 60 + lowRoot() + S.register * 12 - (S.depth > 0.66 ? 12 : 0);
  const swingOff = (pos) => (pos % 2 ? S.swing * stepDur() * 0.66 : 0);
  const currentTheme = () => (S.melody.startsWith('Theme: ') ? themes[S.melody.slice(7)] ?? null : null);
  // Shift chord-relative ideas so they stay in one register whatever the chord.
  const chordShift = () => (M.chord.deg > 3 ? M.chord.deg - 7 : M.chord.deg);
  const degMidi = (deg, base) => base + Math.floor(deg / 7) * 12 + scale()[mod(deg, 7)];
  const nearestChordTone = (d) => CHORD_TONE_DEGS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));

  function isDiminished(deg) {
    const sc = scale();
    return mod(sc[mod(deg + 4, 7)] - sc[mod(deg, 7)], 12) === 6;
  }

  function markovNext(from, rnd) {
    for (let tries = 0; tries < 10; tries++) {
      const d = rnd() < 0.12 ? 0 : NEXT[from][Math.floor(rnd() * NEXT[from].length)];
      if (d !== from && (!isDiminished(d) || rnd() < S.tension)) return d;
    }
    return 0;
  }

  function chordName(deg, seventh) {
    const sc = scale();
    const iv = (n) => mod(sc[mod(deg + n, 7)] - sc[mod(deg, 7)], 12);
    const root = L.notes[mod(S.root + sc[mod(deg, 7)], 12)];
    if (S.voicing === 'Quartal') return root + ' quartal';
    if (S.voicing === 'Sus') return root + 'sus';
    const minor = iv(2) === 3, dim = iv(4) === 6;
    let name = root + (dim ? 'dim' : minor ? 'm' : '');
    if (seventh) name += iv(6) === 11 ? 'maj7' : '7';
    return name;
  }

  // ---- seeded material --------------------------------------------------

  function genMotif(bars) {
    const m = meter(), total = bars * m.steps;
    const notes = [];
    let pos = 0, deg = pickR([0, 2, 4, 4, 7]);
    while (pos < total) {
      const lastBeat = pos + m.beat >= total;
      const cell = lastBeat ? [total - pos] : pickR(CELLS[m.beat]);
      for (const len of cell) {
        if (pos >= total) break;
        if (!lastBeat && notes.length && crng() < 0.15) { pos += len; continue; }
        if (lastBeat) deg = nearestChordTone(deg);
        notes.push({ pos, deg, len });
        pos += len;
        deg += pickR([-2, -1, -1, -1, 1, 1, 1, 2, 0, 3, -3]);
        if (deg < -2) deg += 3;
        if (deg > 10) deg -= 3;
      }
    }
    return withIndex({ bars, notes });
  }

  // An answer to a phrase: same rhythm, mirrored contour, coming home at the end.
  function makeResponse(call) {
    const first = call.notes[0].deg;
    const notes = call.notes.map((n) => ({ ...n, deg: Math.max(-2, Math.min(10, 2 * first - n.deg)) }));
    const last = notes[notes.length - 1];
    last.deg = Math.abs(last.deg) < 4 ? 0 : 7;
    return withIndex({ bars: 1, notes });
  }

  function genOstinato() {
    const n = meter().steps / 2, seq = [];
    for (let i = 0; i < n; i++) seq.push(i === 0 ? 0 : crng() < 0.12 ? null : pickR([0, 1, 2, 3, 1, 2, 4]));
    return { seq };
  }

  function genLoop() {
    const len = S.chordBars === 1 ? 8 : 4, loop = [0];
    while (loop.length < len) loop.push(markovNext(loop[loop.length - 1], crng));
    if (loop[len - 1] === 0) loop[len - 1] = pickR([4, 3, 5]);
    return loop;
  }

  function reseed() {
    crng = mulberry32(S.seed);
    M.motif = genMotif(crng() < 0.5 ? 1 : 2);
    M.call = genMotif(1);
    M.response = makeResponse(M.call);
    M.ost = genOstinato();
    M.loop = genLoop();
  }

  // Regenerate the chord loop without disturbing the melody material.
  function reloop() {
    const keep = crng;
    crng = mulberry32(S.seed + 7);
    M.loop = genLoop();
    crng = keep;
  }

  function mutateMotif(m) {
    const n = pick(m.notes), roll = rand();
    if (roll < 0.6) n.deg += pick([-2, -1, 1, 2]);
    else if (roll < 0.8 && m.notes.length > 2) { const o = pick(m.notes); [n.deg, o.deg] = [o.deg, n.deg]; }
    else n.deg = pick([0, 2, 4]);
    n.deg = Math.max(-2, Math.min(10, n.deg));
  }

  function bassLine(name) {
    const pat = L.bassPatterns[name];
    if (!pat) return null;
    const spb = meter().steps, key = name + spb;
    return (bassCache[key] ??= parseLine(pat[spb]));
  }

  // ---- harmony ------------------------------------------------------------

  function harmonyAt(bar) {
    const th = currentTheme();
    if (th) {
      const b = mod(bar - M.themeOrigin, th.bars);
      let acc = 0;
      for (const [deg, len] of th.chords) {
        if (b < acc + len) return { start: b === acc, deg, bars: len };
        acc += len;
      }
    }
    const cb = S.chordBars;
    if (bar % cb) return { start: false };
    const idx = Math.floor(bar / cb);
    const p = L.progressions[S.progression];
    let deg;
    if (p === 'wander') deg = idx === 0 ? 0 : markovNext(M.chord.deg, r.rng);
    else if (p === 'loop') deg = M.loop[idx % M.loop.length];
    else deg = p[idx % p.length];
    return { start: true, deg, bars: cb };
  }

  function newChord(deg, t, dur) {
    const seventh = rand() < S.sevenths;
    let tones = [deg, deg + 2, deg + 4], stack;
    switch (S.voicing) {
      case 'Sus': { const sus = rand() < 0.5 ? deg + 1 : deg + 3; tones = [deg, sus, deg + 4]; stack = [deg, sus, deg + 4, deg + 7]; break; }
      case 'Quartal': stack = [deg, deg + 3, deg + 6, deg + 9]; break;
      case 'Open': stack = [deg, deg + 4, deg + 9].concat(seventh ? [deg + 6] : []); break;
      default: stack = tones.concat(seventh ? [deg + 6] : []);
    }
    if (seventh && S.voicing !== 'Quartal' && S.voicing !== 'Sus') tones.push(deg + 6);
    M.chord = { deg, tones };

    const padBase = 48 + lowRoot(), centre = 55 + lowRoot() - S.depth * 7;
    const rootMidi = degMidi(deg, padBase);
    let notes;
    if (S.voicing === 'Close' || S.voicing === 'Sus') {
      // each tone lands in the octave nearest the middle of the pad register
      notes = stack.map((d) => { let m = degMidi(d, padBase); while (m - centre > 6) m -= 12; while (centre - m > 6) m += 12; return m; });
    } else {
      // keep the stack's shape and put the root low
      let root = rootMidi;
      while (root > centre - 3) root -= 12;
      while (root < centre - 15) root += 12;
      notes = stack.map((d) => degMidi(d, padBase) - rootMidi + root);
    }
    if (S.tension > 0.5 && rand() < (S.tension - 0.5) * 1.6) notes.push(rootMidi + 13 - (rootMidi + 13 > centre + 12 ? 12 : 0)); // a flat-nine rub
    if (M.level.pad > 0) for (const m of notes) playInst(r, S.padInst, 'pad', m, t, dur, 1, rand(-0.5, 0.5));

    // Under tension the bass holds the tonic while the harmony moves: a pedal point.
    M.pedal = rand() < S.tension * 0.7;
    if (S.bassPattern === 'Hold' && M.level.bass > 0) playBass(0, t, dur, 1);

    const bits = [`${chordName(deg, seventh)}${M.pedal ? ' / ' + L.notes[S.root] : ''}`, S.scale.split(' ')[0], S.meter, `bar ${M.bar + 1}`];
    if (M.section) bits.push(M.section);
    r.onChord?.(bits, t);
  }

  function playBass(off, t, dur, vel) {
    const root = M.pedal ? 0 : M.chord.deg;
    const base = 36 + lowRoot();
    const shift = degMidi(root, base) > 45 ? -12 : 0;
    playInst(r, S.bassInst, 'bass', degMidi(root + off, base) + shift, t, dur, vel, 0);
  }

  // ---- per-step parts -----------------------------------------------------

  function onBar(bar, t) {
    if (S.arrangement !== 'Static' && bar % S.sectionBars === 0) {
      const sec = L.sections[Math.floor(bar / S.sectionBars) % L.sections.length];
      M.section = sec.name;
      for (const l of LAYERS) { const v = sec[l] ?? 1; r.G.arr[l].gain.setTargetAtTime(v, t, stepDur() * 3); M.level[l] = v; }
    }
    const every = S.arrangement === 'Static' ? 8 : S.sectionBars;
    M.fill = (bar + 1) % every === 0 && rand() < S.fills;
    const h = harmonyAt(bar);
    if (h.start) newChord(h.deg, t, h.bars * meter().steps * stepDur());
  }

  function leadNote(deg, t, dur, vel, semis = 0) {
    playInst(r, S.leadInst, 'lead', degMidi(deg, leadBase()) + semis, t, dur, vel * rand(0.8, 1), rand(-0.35, 0.35));
  }

  function playMelodyNote(deg, t, dur, vel, vary, semis = 0) {
    if (vary && rand() < S.variation * 0.3) {
      const roll = rand();
      if (roll < 0.25) return;                                // leave a gap
      else if (roll < 0.5) deg += pick([-1, 1]);              // neighbour note
      else if (roll < 0.7) deg += deg < 5 ? 7 : -7;           // octave leap
      else leadNote(deg + 1, t - stepDur() * 0.5, stepDur() * 0.5, vel * 0.6); // grace note
    }
    leadNote(deg, t + rand(0, 0.012), dur, vel, semis);
    if (S.harmony === 'Octaves') leadNote(deg, t, dur, vel * 0.5, -12);
    else if (S.harmony !== 'None') leadNote(deg + { '3rds below': -2, '3rds above': 2, '6ths below': -5 }[S.harmony], t, dur, vel * 0.55);
  }

  function moveMelody(strong) {
    M.melody += pick([-2, -1, -1, 0, 1, 1, 2, -3, 3]);
    if (strong) {
      // land on the nearest chord tone on strong beats so the tune agrees with the harmony
      let best = M.melody, bestDist = 99;
      for (const tone of M.chord.tones) for (let o = -14; o <= 14; o += 7) {
        const cand = mod(tone, 7) + Math.floor(M.melody / 7) * 7 + o;
        if (Math.abs(cand - M.melody) < bestDist) { best = cand; bestDist = Math.abs(cand - M.melody); }
      }
      M.melody = best;
    }
    if (M.melody < 0) M.melody += 3;
    if (M.melody > 11) M.melody -= 3;
  }

  function melodyStep(pos, bar, t, sd) {
    if (M.level.lead === 0 || S.melody === 'Off') return;
    const m = meter(), th = currentTheme();
    if (th) {
      const n = th.byPos.get(mod(bar - M.themeOrigin, th.bars) * m.steps + pos);
      if (n) playMelodyNote(n.deg, t, n.len * sd, n.len >= 4 ? 1 : 0.85, true);
      return;
    }
    switch (S.melody) {
      case 'Wander': {
        if (pos % 2) return;
        const strong = pos % m.strong === 0;
        const p = (0.06 + S.activity * 0.45) * (strong ? 1.4 : 0.7) * (1 - S.depth * 0.3);
        if (rand() >= p) return;
        moveMelody(strong);
        const semis = !strong && rand() < S.tension * 0.3 ? 1 : 0;
        playMelodyNote(M.melody, t, sd * pick([2, 3, 4]), rand(0.7, 1.1), false, semis);
        return;
      }
      case 'Motif':
      case 'Call & response': {
        const src = S.melody === 'Motif' ? M.motif : (bar % 2 ? M.response : M.call);
        const mpos = (bar % src.bars) * m.steps + pos;
        if (mpos === 0 && S.melody === 'Motif' && rand() < S.variation * 0.5) mutateMotif(M.motif);
        const n = src.byPos.get(mpos);
        if (n && (mpos === 0 || rand() < 0.35 + S.activity * 0.9)) {
          playMelodyNote(n.deg + chordShift(), t + swingOff(pos), n.len * sd, mpos % m.beat === 0 ? 1 : 0.8, true);
        }
        return;
      }
      case 'Ostinato': {
        if (pos % 2) return;
        const i = (pos / 2) % M.ost.seq.length, v = M.ost.seq[i];
        if (v == null || (i && rand() > 0.4 + S.activity * 0.8)) return;
        const tones = M.chord.tones;
        const deg = tones[v % tones.length] + 7 * Math.floor(v / tones.length) - (M.chord.deg > 3 ? 7 : 0);
        playMelodyNote(deg, t, 2 * sd, i === 0 ? 1 : 0.75, true);
        return;
      }
      case 'Sparse': {
        if (pos !== 0 && pos !== m.steps / 2) return;
        if (rand() > 0.25 + S.activity * 0.35) return;
        const deg = pick(M.chord.tones) - (M.chord.deg > 3 ? 7 : 0) + (rand() < 0.5 ? 7 : 0);
        playMelodyNote(deg, t, m.steps * sd * rand(1, 2), 0.9, false);
      }
    }
  }

  function arpStep(pos, t, sd) {
    if (M.level.arp === 0 || S.arpRate === 'Off') return;
    const m = meter();
    let every;
    if (S.arpRate === 'Auto') {
      // thickens with activity: beats, then eighths, then sixteenths
      const dens = (S.activity - 0.3) / 0.7;
      if (dens <= 0) return;
      every = dens > 0.7 ? 1 : dens > 0.35 ? 2 : m.beat;
    } else every = { Quarters: m.beat, '8ths': 2, '16ths': 1 }[S.arpRate];
    if (pos % every) return;

    const [a, b, c] = M.chord.tones;
    const up = [a, b, c, a + 7, b + 7, c + 7];
    const seq = {
      'Up': up, 'Down': [...up].reverse(), 'Up–down': [...up, ...up.slice(1, -1).reverse()],
      'Broken': [a, c, b, c, a + 7, c, b, c], 'Alberti': [a, c, b, c], 'Pulse': [a, a + 7], 'Random': up,
    }[S.arpPattern];
    const idx = M.arpIdx++;
    const deg = (S.arpPattern === 'Random' ? pick(seq) : seq[idx % seq.length]) - (M.chord.deg > 3 ? 7 : 0);
    playInst(r, S.arpInst, 'arp', degMidi(deg, leadBase() - 12), t + swingOff(pos), every * sd * 0.9,
      pos % m.beat === 0 ? 1 : 0.7, idx % 2 ? -0.35 : 0.35);
  }

  function bassStep(pos, t, sd) {
    if (M.level.bass === 0) return;
    const line = bassLine(S.bassPattern);
    const ev = line && line.get(pos);
    if (ev) playBass(ev.off, t + swingOff(pos), ev.len * sd * 0.92, pos === 0 ? 1 : 0.8);
  }

  function drumStep(pos, t) {
    const pat = L.drums[S.drums];
    if (!pat || M.level.drums === 0) return;
    const kit = L.kits[S.kit], spb = meter().steps;
    const level = 0.55 + S.activity * 0.5;
    const at = t + swingOff(pos) + rand(-0.004, 0.004);

    if (M.fill && pos >= spb / 2) {
      // a rising roll of toms into snare to mark the turn of a phrase
      if (rand() < 0.8) {
        const k = pos - spb / 2, voice = ['T', 'T', 't', 't', 's'][k % 5];
        DRUM_VOICES[voice](r, at, level * (0.5 + 0.5 * k / (spb / 2)), kit);
      }
      if (pos === spb / 2) DRUM_VOICES.k(r, at, level, kit);
      return;
    }
    for (const [track, str] of Object.entries(pat)) {
      if (!DRUM_VOICES[track]) continue;
      const ch = str[pos % str.length];
      let v = VEL[ch] || 0;
      if (ch === '?') v = rand() < 0.5 ? 0.6 : 0;
      if (ch === 'o' && rand() > 0.4 + S.activity * 0.6) v = 0;
      if (v) DRUM_VOICES[track](r, at, v * level, kit);
    }
  }

  function textureStep(pos, t, sd) {
    if (M.level.texture === 0) return;
    const tx = L.textures[S.texture] || {};
    if (tx.drips && rand() < (0.008 + S.depth * 0.045) * tx.drips) playDrip(r, t + rand(0, sd));
    if (tx.patter) for (let i = 0; i < 2; i++) if (rand() < tx.patter * 0.5) playPatter(r, t + rand(0, sd));
    if (tx.crackle) for (let i = 0; i < 3; i++) if (rand() < tx.crackle * 0.3) playCrackle(r, t + rand(0, sd));
    if (tx.crickets && pos % 2 === 0 && rand() < tx.crickets * 0.06) playCricket(r, t);
  }

  function machineStep(pos, t) {
    if (M.level.machine === 0) return;
    const m = meter();
    if ((pos === 0 || pos === m.steps / 2) && rand() < S.activity * 0.9) {
      r.h.tonalHit(t, 0.25 + S.activity * 0.35, 'sine', 95, 38, 0.35, r.bus.machine);
    }
    if (pos % m.beat === m.beat / 2 && rand() < S.activity * 0.45) {
      r.h.noiseHit(t + swingOff(pos), 0.2 + S.activity * 0.2, 'bandpass', rand(1400, 3600), 12, 0.14, rand(-0.7, 0.7), r.bus.machine);
    }
  }

  /** Play one sixteenth at audio time t, then advance the position. */
  function step(t) {
    if (M.pos >= meter().steps) { M.pos = 0; M.bar++; }
    const { pos, bar } = M, sd = stepDur();
    if (pos === 0) onBar(bar, t);
    melodyStep(pos, bar, t, sd);
    arpStep(pos, t, sd);
    bassStep(pos, t, sd);
    drumStep(pos, t);
    textureStep(pos, t, sd);
    machineStep(pos, t);
    M.pos++;
  }

  /** Start again from bar 0 at the next step, so new settings are heard at once. */
  function restart() {
    M.bar = -1; M.pos = Infinity; M.themeOrigin = 0; M.arpIdx = 0;
  }

  /** A theme chosen mid-play starts on the next bar. */
  function themeFromNextBar() { M.themeOrigin = M.bar + 1; }

  return { M, step, reseed, reloop, restart, themeFromNextBar, stepDur, currentTheme, lowRoot, degMidi, instruments: INSTRUMENTS };
}
