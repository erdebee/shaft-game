/**
 * instruments.js
 * The voices of the score, every one synthesised live with the Web Audio API:
 * pads, leads, basses, drum kits and the ambient one-shots (drips, rain,
 * crackle, crickets). Nothing is sampled.
 *
 * Every play function takes the rig (music.js) first: its AudioContext, its
 * node graph `G`, its layer buses, the live settings `S`, and the helpers
 * createVoiceKit builds once per context. A note is { midi, t, dur, level,
 * dest, pan, role }, where role is the part playing it: a pad swells slowly,
 * the same instrument as a lead speaks at once.
 *
 * Presentation only. Nothing here touches simulation state.
 */

/** The loudness each part plays at before an instrument's trim. */
export const ROLE_LEVEL = { pad: 0.055, lead: 0.15, arp: 0.09, bass: 0.32, stings: 0.18 };

const VOWELS = {
  ah: [[800, 6, 1], [1150, 8, 0.6], [2900, 10, 0.2]],
  oh: [[450, 6, 1], [800, 8, 0.5], [2830, 10, 0.15]],
  oo: [[325, 6, 1], [700, 8, 0.3], [2530, 10, 0.1]],
};

export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

/** Builds the graph helpers bound to one rig. */
export function createVoiceKit(r) {
  const { ctx } = r;
  const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const filter = (type, freq, q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
  const panner = (v) => { const p = ctx.createStereoPanner(); p.pan.value = v; return p; };

  const pulses = {};
  function pulseWave(duty) {
    if (pulses[duty]) return pulses[duty];
    const N = 48, re = new Float32Array(N), im = new Float32Array(N);
    for (let k = 1; k < N; k++) re[k] = 2 * Math.sin(Math.PI * k * duty) / (Math.PI * k);
    return (pulses[duty] = ctx.createPeriodicWave(re, im));
  }

  // Hook an oscillator's pitch to the tape-wobble LFO, and let go of it when it ends.
  function wobbled(o) {
    r.G.wobble.connect(o.detune);
    o.addEventListener('ended', () => { try { r.G.wobble.disconnect(o.detune); } catch { /* already gone */ } });
    return o;
  }

  function osc(type, hz, t, end, wob = true) {
    const o = ctx.createOscillator();
    if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
    o.frequency.value = hz;
    if (wob) wobbled(o);
    o.start(t); o.stop(end + 0.05);
    return o;
  }

  // Sustained envelope: attack, hold to the note's end, release. Returns when it is silent.
  function envGate(g, t, a, level, dur, rel) {
    const hold = Math.max(a, dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + a);
    g.gain.setValueAtTime(level, t + hold);
    g.gain.linearRampToValueAtTime(0, t + hold + rel);
    return t + hold + rel;
  }

  // Struck envelope: a quick attack, then an exponential decay.
  function envPerc(g, t, level, decay, a = 0.004) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
    return t + a + decay;
  }

  const out = (node, n) => node.connect(panner(n.pan || 0)).connect(n.dest);

  function noiseHit(t, v, type, hz, q, decay, pan = 0, dest = r.G.drumIn, attack = 0.001) {
    const s = ctx.createBufferSource(); s.buffer = r.G.white;
    const g = gain(0); envPerc(g, t, v, decay, attack);
    s.connect(filter(type, hz, q)).connect(g).connect(panner(pan)).connect(dest);
    s.start(t, r.rand(0, 2.5), decay + attack + 0.05);
  }

  function tonalHit(t, v, wave, f0, f1, decay, dest = r.G.drumIn, pan = 0) {
    const o = ctx.createOscillator(); o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + Math.min(0.12, decay));
    const g = gain(0); envPerc(g, t, v, decay, 0.002);
    o.connect(g).connect(panner(pan)).connect(dest);
    o.start(t); o.stop(t + decay + 0.05);
  }

  // Two-operator FM. Ratio 1 with a small index reads as an electric piano, higher ratios as bells.
  function fmVoice(n, { ratio, index, decay, idxDecay = 0.4, tine = 0, attack = 0.006 }) {
    const hz = mtof(n.midi), end = n.t + decay;
    const car = osc('sine', hz, n.t, end);
    const m = osc('sine', hz * ratio, n.t, end, false);
    const ig = gain(0);
    ig.gain.setValueAtTime(hz * index, n.t);
    ig.gain.exponentialRampToValueAtTime(hz * index * 0.03 + 0.01, n.t + decay * idxDecay);
    m.connect(ig).connect(car.frequency);
    if (tine) {
      const m2 = osc('sine', hz * 14, n.t, n.t + 0.3, false);
      const g2 = gain(0);
      g2.gain.setValueAtTime(hz * tine, n.t);
      g2.gain.exponentialRampToValueAtTime(1, n.t + 0.08);
      m2.connect(g2).connect(car.frequency);
    }
    const g = gain(0);
    envPerc(g, n.t, n.level, decay, attack);
    car.connect(g); out(g, n);
  }

  return { gain, filter, panner, pulseWave, wobbled, osc, envGate, envPerc, out, noiseHit, tonalHit, fmVoice };
}

const padCutoff = (S) => (250 + S.warmth ** 1.5 * 3200) * (1 - S.depth * 0.55);
const tim = (n, S) => n.timbre ?? S.timbre;

/**
 * roles: which parts may use an instrument. trim: loudness correction per role,
 * measured by rendering each instrument offline, so swapping one for another
 * keeps the mix level. octave: shifts every note (the music box sits high).
 */
export const INSTRUMENTS = {
  'Saw strings': { roles: ['pad', 'lead'], trim: { pad: 1, lead: 0.6 }, play(r, n) {
    const { gain, filter, osc, envGate, out } = r.h, S = r.S;
    const pad = n.role === 'pad';
    const a = pad ? Math.min(2.5, n.dur * 0.4) : 0.12, rel = pad ? 2.5 : 0.6;
    const g = gain(0);
    const end = envGate(g, n.t, a, n.level, n.dur, rel);
    const f = filter('lowpass', 100, 0.5 + S.tension * 4);
    const cut = padCutoff(S) * (pad ? 1 : 1.4);
    f.frequency.setValueAtTime(cut * 0.4, n.t);
    f.frequency.linearRampToValueAtTime(cut, n.t + a);
    f.frequency.linearRampToValueAtTime(cut * 0.5, end);
    const det = 6 + S.tension * 14;
    for (const d of [-det, det]) { const o = osc('sawtooth', mtof(n.midi), n.t, end); o.detune.value = d; o.connect(f); }
    f.connect(g); out(g, n);
  } },

  'Warm organ': { roles: ['pad', 'lead'], trim: { pad: 0.6, lead: 0.55 }, play(r, n) {
    const { gain, osc, envGate, out } = r.h;
    const pad = n.role === 'pad';
    const a = pad ? Math.min(1.2, n.dur * 0.3) : 0.02, rel = pad ? 1.5 : 0.2;
    const g = gain(0);
    const end = envGate(g, n.t, a, n.level, n.dur, rel);
    const hz = mtof(n.midi), bright = 0.4 + r.S.warmth * 0.8;
    for (const [h, v] of [[1, 1], [2, 0.55], [3, 0.3 * bright], [4, 0.18 * bright], [6, 0.08 * bright]]) {
      osc('sine', hz * h, n.t, end).connect(gain(v)).connect(g);
    }
    out(g, n);
  } },

  'Choir': { roles: ['pad'], trim: { pad: 1.8 }, play(r, n) {
    const { gain, filter, osc, envGate, out } = r.h, S = r.S;
    const a = Math.min(1.8, n.dur * 0.35);
    const g = gain(0);
    const end = envGate(g, n.t, a, n.level, n.dur, 2);
    const src = gain(1), hz = mtof(n.midi);
    for (const d of [-9, 0, 9]) { const o = osc('sawtooth', hz, n.t, end); o.detune.value = d; o.connect(src); }
    const vowel = VOWELS[S.warmth > 0.6 ? 'ah' : S.depth > 0.6 ? 'oo' : 'oh'];
    for (const [f, q, v] of vowel) src.connect(filter('bandpass', f, q)).connect(gain(v)).connect(g);
    out(g, n);
  } },

  'Glass pad': { roles: ['pad'], trim: { pad: 0.9 }, play(r, n) {
    const { gain, osc, envGate, out } = r.h;
    const a = Math.min(2, n.dur * 0.4);
    const g = gain(0);
    const end = envGate(g, n.t, a, n.level, n.dur, 2.5);
    const hz = mtof(n.midi);
    const car = osc('sine', hz, n.t, end);
    osc('sine', hz * 2, n.t, end, false).connect(gain(hz * (0.3 + r.S.warmth * 0.8))).connect(car.frequency);
    car.connect(g);
    osc('sine', hz * 2.003, n.t, end).connect(gain(0.2)).connect(g);
    out(g, n);
  } },

  'Pulse pad': { roles: ['pad', 'lead'], trim: { pad: 0.5, lead: 0.5 }, play(r, n) {
    const { gain, filter, osc, envGate, out, pulseWave } = r.h;
    const pad = n.role === 'pad';
    const a = pad ? Math.min(1.5, n.dur * 0.3) : 0.01, rel = pad ? 1.8 : 0.15;
    const g = gain(0);
    const end = envGate(g, n.t, a, n.level, n.dur, rel);
    const f = filter('lowpass', padCutoff(r.S) * (pad ? 1.2 : 1.8), 1.2);
    for (const [duty, det] of [[0.3, -7], [0.42, 7]]) {
      const o = osc(pulseWave(duty), mtof(n.midi), n.t, end); o.detune.value = det; o.connect(f);
    }
    f.connect(g); out(g, n);
  } },

  'E-piano': { roles: ['lead', 'arp'], trim: { lead: 1, arp: 0.4 }, play: (r, n) =>
    r.h.fmVoice(n, { ratio: 1, index: (0.8 + tim(n, r.S) * 1.6) * (0.6 + r.S.warmth * 0.8), decay: 1.4 + tim(n, r.S) * 1.2, tine: 0.4 }) },

  'Bell': { roles: ['lead', 'arp'], trim: { lead: 0.85, arp: 0.35 }, play: (r, n) =>
    r.h.fmVoice(n, { ratio: 3.5, index: 1.5 + tim(n, r.S) * 2.5, decay: 2.6 + tim(n, r.S) * 2, idxDecay: 0.6 }) },

  'Music box': { roles: ['lead', 'arp'], trim: { lead: 1, arp: 0.5 }, octave: 1, play: (r, n) =>
    r.h.fmVoice(n, { ratio: 4, index: 0.6, decay: 1.3, idxDecay: 0.2, attack: 0.002 }) },

  'Marimba': { roles: ['lead', 'arp'], trim: { lead: 1.3, arp: 0.8 }, play(r, n) {
    const { gain, osc, envPerc, out } = r.h;
    const hz = mtof(n.midi), d = 0.35 + Math.max(0, 1 - n.midi / 100) * 0.4;
    const mix = gain(1);
    const g1 = gain(0); envPerc(g1, n.t, n.level, d, 0.002);
    osc('sine', hz, n.t, n.t + d).connect(g1).connect(mix);
    const g2 = gain(0); envPerc(g2, n.t, n.level * 0.35 * (0.5 + r.S.warmth), 0.06, 0.001);
    osc('sine', hz * 3.93, n.t, n.t + 0.1, false).connect(g2).connect(mix);
    out(mix, n);
  } },

  'Kalimba': { roles: ['lead', 'arp'], trim: { lead: 1, arp: 0.55 }, play(r, n) {
    const { gain, osc, envPerc, out } = r.h;
    const hz = mtof(n.midi);
    const mix = gain(1);
    const o1 = osc('sine', hz, n.t, n.t + 1.3);
    o1.frequency.setValueAtTime(hz * 1.012, n.t);
    o1.frequency.exponentialRampToValueAtTime(hz, n.t + 0.03);
    const g1 = gain(0); envPerc(g1, n.t, n.level, 1.2, 0.002); o1.connect(g1).connect(mix);
    const g2 = gain(0); envPerc(g2, n.t, n.level * 0.3, 0.04, 0.001);
    osc('sine', hz * 5.4, n.t, n.t + 0.08, false).connect(g2).connect(mix);
    const g3 = gain(0); envPerc(g3, n.t, n.level * 0.15, 0.3, 0.002);
    osc('sine', hz * 2, n.t, n.t + 0.35).connect(g3).connect(mix);
    out(mix, n);
  } },

  'Nylon pluck': { roles: ['lead', 'arp'], trim: { lead: 1.1, arp: 0.5 }, play(r, n) {
    const { gain, filter, osc, envPerc, out } = r.h;
    const hz = mtof(n.midi), d = 1.1;
    const f = filter('lowpass', 100, 1.5);
    f.frequency.setValueAtTime(900 + r.S.warmth * 3000, n.t);
    f.frequency.exponentialRampToValueAtTime(250, n.t + 0.5);
    osc('sawtooth', hz, n.t, n.t + d).connect(gain(0.5)).connect(f);
    const o2 = osc('triangle', hz, n.t, n.t + d); o2.detune.value = 4; o2.connect(f);
    const g = gain(0); envPerc(g, n.t, n.level, d, 0.002);
    f.connect(g); out(g, n);
  } },

  'Soft pluck': { roles: ['arp', 'lead'], trim: { arp: 1, lead: 1.6 }, play(r, n) {
    const { gain, filter, osc, envPerc, out } = r.h;
    const o = osc('triangle', mtof(n.midi), n.t, n.t + 0.45);
    const f = filter('lowpass', 100, 2);
    f.frequency.setValueAtTime(600 + r.S.warmth * 3500, n.t);
    f.frequency.exponentialRampToValueAtTime(250, n.t + 0.25);
    const g = gain(0); envPerc(g, n.t, n.level, 0.4);
    o.connect(f).connect(g); out(g, n);
  } },

  'Flute': { roles: ['lead'], trim: { lead: 0.7 }, play(r, n) {
    const { gain, filter, osc, envGate, out } = r.h, ctx = r.ctx;
    const hz = mtof(n.midi);
    const g = gain(0);
    const end = envGate(g, n.t, 0.06, n.level, Math.max(n.dur, 0.12), 0.22);
    const o = osc('sine', hz, n.t, end);
    const o2 = osc('triangle', hz * 2, n.t, end);
    o.connect(g); o2.connect(gain(0.08)).connect(g);
    // vibrato that blooms after the attack
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2;
    const vd = gain(0);
    vd.gain.setValueAtTime(0, n.t); vd.gain.linearRampToValueAtTime(14, n.t + 0.45);
    vib.connect(vd); vd.connect(o.detune); vd.connect(o2.detune);
    vib.start(n.t); vib.stop(end);
    // breath: a puff at the start, then a thin sustain
    const s = ctx.createBufferSource(); s.buffer = r.G.white; s.loop = true;
    const ng = gain(0);
    ng.gain.setValueAtTime(0, n.t);
    ng.gain.linearRampToValueAtTime(n.level * 0.35, n.t + 0.03);
    ng.gain.linearRampToValueAtTime(n.level * 0.08, n.t + 0.2);
    ng.gain.linearRampToValueAtTime(0, end);
    s.connect(filter('bandpass', hz * 2, 1.2)).connect(ng);
    s.start(n.t, r.rand(0, 2)); s.stop(end);
    const mix = gain(1); g.connect(mix); ng.connect(mix);
    out(mix, n);
  } },

  'Chip square': { roles: ['lead', 'arp'], trim: { lead: 0.6, arp: 1.2 }, play(r, n) {
    const { gain, osc, envGate, envPerc, out, pulseWave } = r.h;
    const hz = mtof(n.midi), perc = n.role === 'arp';
    const g = gain(0);
    const end = perc ? envPerc(g, n.t, n.level, 0.18, 0.002) : envGate(g, n.t, 0.005, n.level, Math.max(n.dur * 0.9, 0.06), 0.04);
    const o = osc(pulseWave(0.25), hz, n.t, end);
    if (!perc && n.dur > 0.3) {
      const vib = r.ctx.createOscillator(); vib.frequency.value = 6;
      const vd = gain(0);
      vd.gain.setValueAtTime(0, n.t + 0.2); vd.gain.linearRampToValueAtTime(20, n.t + 0.4);
      vib.connect(vd).connect(o.detune); vib.start(n.t); vib.stop(end);
    }
    o.connect(g); out(g, n);
  } },

  'Sub': { roles: ['bass'], trim: { bass: 1 }, play(r, n) {
    const { gain, filter, osc, envGate, out } = r.h, S = r.S;
    const long = n.dur > 1, hz = mtof(n.midi);
    const g = gain(0);
    const end = envGate(g, n.t, long ? 0.4 : 0.015, n.level, n.dur, long ? 1.5 : 0.1);
    const f = filter('lowpass', 380 + S.warmth * 400 - S.depth * 150);
    osc('sine', hz, n.t, end).connect(f);
    osc('triangle', hz * 2, n.t, end).connect(gain(0.3)).connect(f);
    f.connect(g); out(g, n);
  } },

  'Round synth': { roles: ['bass'], trim: { bass: 0.75 }, play(r, n) {
    const { gain, filter, osc, envGate, out } = r.h, S = r.S;
    const long = n.dur > 1, hz = mtof(n.midi);
    const a = long ? 0.2 : 0.006;
    const g = gain(0);
    const end = envGate(g, n.t, a, n.level, n.dur, long ? 0.9 : 0.12);
    const f = filter('lowpass', 100, 3.5);
    f.frequency.setValueAtTime(250 + S.warmth * 1100, n.t);
    f.frequency.setTargetAtTime(110 + S.warmth * 250, n.t + a, long ? 0.6 : 0.12);
    for (const d of [-6, 6]) { const o = osc('sawtooth', hz, n.t, end); o.detune.value = d; o.connect(f); }
    f.connect(g); out(g, n);
  } },

  'Plucked upright': { roles: ['bass'], trim: { bass: 1.8 }, play(r, n) {
    const { gain, filter, osc, envPerc, out } = r.h;
    const hz = mtof(n.midi), d = Math.min(1.5, n.dur + 0.35);
    const o1 = osc('triangle', hz, n.t, n.t + d);
    o1.frequency.setValueAtTime(hz * 1.02, n.t);
    o1.frequency.exponentialRampToValueAtTime(hz, n.t + 0.05);
    const f = filter('lowpass', 450 + r.S.warmth * 600, 1);
    o1.connect(f);
    osc('sine', hz, n.t, n.t + d).connect(gain(0.6)).connect(f);
    const g = gain(0); envPerc(g, n.t, n.level, d, 0.003);
    f.connect(g); out(g, n);
  } },

  'Chip bass': { roles: ['bass'], trim: { bass: 1 }, play(r, n) {
    const { gain, osc, envGate, out } = r.h;
    const g = gain(0);
    const end = envGate(g, n.t, 0.003, n.level, Math.max(0.05, n.dur * 0.9), 0.03);
    osc('triangle', mtof(n.midi), n.t, end).connect(g);
    out(g, n);
  } },
};

export const instrumentsFor = (role) => Object.keys(INSTRUMENTS).filter((k) => INSTRUMENTS[k].roles.includes(role));

export function playInst(r, name, role, midi, t, dur, vel = 1, pan = 0, extra = {}) {
  const inst = INSTRUMENTS[name];
  if (!inst) return;
  const trim = inst.trim[role === 'stings' ? 'lead' : role] ?? 1;
  inst.play(r, { midi: midi + (inst.octave || 0) * 12, t, dur, level: ROLE_LEVEL[role] * vel * trim, dest: r.bus[role], pan, role, ...extra });
}

/** Drum voices, keyed by the track letters the library's patterns use. */
export const DRUM_VOICES = {
  k(r, t, v, kit) {
    const p = kit.kick;
    r.h.tonalHit(t, v * (p.wave === 'sine' ? 1 : 0.35), p.wave, p.f0, p.f1, p.decay);
    if (p.click) r.h.noiseHit(t, v * p.click, 'highpass', 3000, 0.5, 0.01);
    r.pump(t);
  },
  s(r, t, v, kit) {
    const p = kit.snare;
    r.h.tonalHit(t, v * 0.45, 'triangle', p.tone, p.tone * 0.8, p.toneDecay);
    r.h.noiseHit(t, v * p.nLvl, 'bandpass', p.nHz, p.nQ, p.nDecay, 0.05);
  },
  r(r, t, v, kit) {
    r.h.tonalHit(t, v * 0.4, 'sine', kit.rim.hz, kit.rim.hz * 0.95, kit.rim.decay, r.G.drumIn, -0.2);
    r.h.noiseHit(t, v * 0.3, 'bandpass', kit.rim.hz * 1.5, 4, 0.02, -0.2);
  },
  h(r, t, v, kit) { r.h.noiseHit(t, v * kit.hat.lvl, 'highpass', kit.hat.hz, 0.7, kit.hat.decay, r.rand(0.1, 0.35)); },
  o(r, t, v, kit) { r.h.noiseHit(t, v * kit.hat.lvl, 'highpass', kit.hat.hz, 0.7, kit.hat.open, 0.25); },
  sh(r, t, v, kit) { r.h.noiseHit(t, v * kit.shaker.lvl, 'bandpass', kit.shaker.hz, 1.5, kit.shaker.decay, -0.3, r.G.drumIn, 0.015); },
  t(r, t, v, kit) { r.h.tonalHit(t, v * 0.8, kit.tom.wave, kit.tom.lo, kit.tom.lo * 0.75, kit.tom.decay, r.G.drumIn, -0.3); },
  T(r, t, v, kit) { r.h.tonalHit(t, v * 0.7, kit.tom.wave, kit.tom.hi, kit.tom.hi * 0.75, kit.tom.decay, r.G.drumIn, 0.3); },
};

// ---- ambient one-shots --------------------------------------------------

export function playDrip(r, t) {
  const { gain, panner, envPerc } = r.h;
  const hz = r.rand(1100, 2300) * (1 - r.S.depth * 0.45);
  const o = r.ctx.createOscillator();
  o.frequency.setValueAtTime(hz, t);
  o.frequency.exponentialRampToValueAtTime(hz * 0.55, t + 0.07);
  const g = gain(0); envPerc(g, t, 0.18, 0.16, 0.002);
  o.connect(g).connect(panner(r.rand(-0.9, 0.9))).connect(r.bus.texture);
  o.start(t); o.stop(t + 0.2);
}

export function playPatter(r, t) {
  const { gain, panner, envPerc } = r.h;
  const o = r.ctx.createOscillator(); o.frequency.value = r.rand(3000, 6000);
  const g = gain(0); envPerc(g, t, r.rand(0.02, 0.07), 0.03, 0.001);
  o.connect(g).connect(panner(r.rand(-1, 1))).connect(r.bus.texture);
  o.start(t); o.stop(t + 0.05);
}

export function playCrackle(r, t) {
  r.h.noiseHit(t, r.rand(0.05, 0.6) ** 2, 'highpass', 1500, 0.7, r.rand(0.001, 0.004), r.rand(-0.6, 0.6), r.bus.texture);
}

export function playCricket(r, t) {
  const { gain, panner, envPerc } = r.h;
  const hz = r.rand(4200, 4800), pan = r.rand(-0.8, 0.8);
  for (let i = 0; i < 3; i++) {
    const o = r.ctx.createOscillator(); o.frequency.value = hz;
    const g = gain(0); envPerc(g, t + i * 0.045, 0.05, 0.025, 0.003);
    o.connect(g).connect(panner(pan)).connect(r.bus.texture);
    o.start(t + i * 0.045); o.stop(t + i * 0.045 + 0.04);
  }
}
