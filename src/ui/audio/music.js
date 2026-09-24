/**
 * music.js
 * The game's score: a generative piece played live through the Web Audio API.
 * A score file (resources/assets/audio/scores/*.json) is a set of choices over
 * the music library (audio/music-library.json): key, mode, instruments,
 * patterns, mix. tools/music-lab.html runs this same engine with a control for
 * every setting, and its Settings JSON is a score, ready to drop in.
 *
 *   const music = createMusic(await loadMusic());
 *   await music.start();   // from a click or key press: browsers refuse audio before one
 *
 * The node graph: each layer (pad, bass, lead, ...) has a volume, an
 * arrangement gain and a sidechain duck, then meets the others at a saturation
 * stage, a compressor and the master volume, with shared reverb and echo sends.
 *
 * Presentation only. It reads no simulation state and draws no simulation
 * stream; audio time comes from the AudioContext, never the game clock. The
 * settings `depth`, `activity` and `tension` are the handles for letting the
 * game steer the music later.
 */

import { createVoiceKit, playInst, mtof } from './instruments.js';
import { createComposer, LAYERS, mulberry32, themeOf } from './composer.js';

const ASSET_ROOT = './resources/assets/';
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Fetch the music library and one score through the media manifest. */
export async function loadMusic(root = ASSET_ROOT, scoreId = 'background') {
  const res = await fetch(`${root}manifest.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Asset manifest not found: ${root}manifest.json`);
  const audio = (await res.json()).audio ?? [];
  const lib = audio.find((a) => a.kind === 'music-library');
  const score = audio.find((a) => a.kind === 'score' && a.id === scoreId);
  if (!lib || !score) throw new Error(`The asset manifest lists no music library or no score "${scoreId}"`);
  const get = async (entry) => {
    const r = await fetch(root + entry.path, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Music file not found: ${entry.path}`);
    return r.json();
  };
  const [library, scoreData] = await Promise.all([get(lib), get(score)]);
  return { library, score: scoreData };
}

/**
 * A score merged over the library's defaults, so a score may be partial. Also
 * reads the lab's first-round JSON, which called the lead layer "keys".
 */
export function resolveScore(library, score) {
  const d = clone(library.defaults);
  delete d._note;
  const inc = clone(score ?? {});
  if (inc.vol && inc.vol.keys != null && inc.vol.lead == null) inc.vol.lead = inc.vol.keys;
  const out = { ...d, ...inc, vol: { ...d.vol, ...(inc.vol ?? {}) }, mute: { ...(inc.mute ?? {}) } };
  delete out.vol.keys;
  const theme = themeOf(library, out);
  if (theme) out.meter = theme.meter; // a theme brings its own meter
  return out;
}

/** Short phrases for game events. Degrees are scale steps; `semis` are raw semitones. */
const STINGS = {
  'New day':        { inst: 'Bell', degs: [0, 2, 4, 7, 9], gap: 0.11, timbre: 0.8 },
  'Room built':     { inst: 'Marimba', degs: [4, 7], gap: 0.09 },
  'Porter arrives': { inst: 'Kalimba', degs: [0, 4, 2], gap: 0.1 },
  'Discovery':      { inst: 'Music box', degs: [0, 2, 4, 6, 7, 9, 11, 14], gap: 0.07, base: 60 },
  'Night falls':    { inst: 'E-piano', degs: [7, 4, 2, -1], gap: 0.28, base: 60, timbre: 0.3 },
  'Shortage':       { inst: 'Bell', semis: [7, 6, 1], gap: 0.22, base: 48, vel: 1.3, timbre: 0.9 },
};

function makeImpulse(ctx, rnd, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.exp(-6.9 * i / len);
  }
  return buf;
}

function makeNoise(ctx, rnd, seconds, pink) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd() * 2 - 1;
    if (!pink) { d[i] = w; continue; }
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
  }
  return buf;
}

function driveCurve(amount) {
  const k = 1 + amount * 10, n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

export function createMusic({ library, score }) {
  const S = resolveScore(library, score);
  // Performance randomness varies from session to session so the piece is not
  // the same every boot; composition material stays tied to the score's seed.
  const perf = mulberry32((Date.now() ^ Math.imul(S.seed, 2654435761)) >>> 0);
  const r = {
    L: library, S, ctx: null, G: {}, bus: {}, h: null,
    rng: perf,
    rand: (a = 0, b = 1) => a + perf() * (b - a),
    pick: (arr) => arr[Math.floor(perf() * arr.length)],
    pump: () => {},
    onChord: null,
  };
  const comp = createComposer(r);
  comp.reseed();
  let timer = null, next = 0, lastDrive = -1;

  function build() {
    const ctx = (r.ctx = new AudioContext());
    const G = r.G, bus = r.bus;
    const h = (r.h = createVoiceKit(r));
    const { gain, filter } = h;
    const loop = (buf, offset) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, offset); return s; };

    // master chain: mix -> saturation -> compressor -> master -> analyser -> out
    G.mix = gain();
    G.shaper = ctx.createWaveShaper(); G.shaper.oversample = '2x';
    G.postDrive = gain();
    G.comp = ctx.createDynamicsCompressor();
    G.comp.threshold.value = -18; G.comp.ratio.value = 3; G.comp.attack.value = 0.02; G.comp.release.value = 0.3;
    G.master = gain(S.vol.master);
    G.analyser = ctx.createAnalyser(); G.analyser.fftSize = 2048; G.analyser.smoothingTimeConstant = 0.85;
    G.mix.connect(G.shaper).connect(G.postDrive).connect(G.comp).connect(G.master).connect(G.analyser).connect(ctx.destination);

    // reverb
    G.revIn = gain();
    G.revTone = filter('lowpass', 6000);
    G.rev = ctx.createConvolver(); G.rev.buffer = makeImpulse(ctx, perf, 5);
    G.revOut = gain(0.5);
    G.revIn.connect(G.revTone).connect(G.rev).connect(G.revOut).connect(G.mix);

    // tape-style echo, a dotted eighth
    G.dlyIn = gain();
    G.dly = ctx.createDelay(3);
    G.dlyTone = filter('lowpass', 2200);
    G.dlyFb = gain(0.4);
    G.dlyOut = gain(0.5);
    G.dlyIn.connect(G.dly).connect(G.dlyTone).connect(G.dlyFb).connect(G.dly);
    G.dlyTone.connect(G.dlyOut).connect(G.mix);
    G.dlyOut.connect(G.revIn);

    // Per layer: volume -> arrangement -> sidechain duck -> mix, plus reverb and echo sends.
    const revSend = { pad: 0.5, bass: 0.1, lead: 0.6, arp: 0.4, drums: 0.15, texture: 0.8, machine: 0.3, stings: 0.6 };
    const dlySend = { lead: 0.25, arp: 0.45, stings: 0.3 };
    G.arr = {}; G.duck = {};
    for (const l of LAYERS) {
      bus[l] = gain(0);
      G.arr[l] = gain(1);
      G.duck[l] = gain(1);
      bus[l].connect(G.arr[l]).connect(G.duck[l]).connect(G.mix);
      G.duck[l].connect(gain(revSend[l])).connect(G.revIn);
      if (dlySend[l]) G.duck[l].connect(gain(dlySend[l])).connect(G.dlyIn);
    }

    // drums pass through a kit-dependent tone filter
    G.drumIn = filter('lowpass', 12000);
    G.drumIn.connect(bus.drums);

    // wobble: a slow wow plus a fast flutter, summed into one node that drives oscillator detune
    G.wobble = gain(1);
    G.wow = ctx.createOscillator(); G.wow.frequency.value = 0.45;
    G.wowDepth = gain(0);
    G.flutter = ctx.createOscillator(); G.flutter.frequency.value = 6.3;
    G.flutterDepth = gain(0);
    G.wow.connect(G.wowDepth).connect(G.wobble);
    G.flutter.connect(G.flutterDepth).connect(G.wobble);
    G.wow.start(); G.flutter.start();

    G.pink = makeNoise(ctx, perf, 6, true);
    G.white = makeNoise(ctx, perf, 3, false);

    // texture beds: wind, rain, tape/vinyl hiss
    G.windBp = filter('bandpass', 600, 1.4);
    G.windGain = gain(0);
    G.windLfo = ctx.createOscillator(); G.windLfo.frequency.value = 0.06;
    G.windLfoDepth = gain(250);
    G.windLfo.connect(G.windLfoDepth).connect(G.windBp.frequency);
    loop(G.pink, 0).connect(G.windBp).connect(G.windGain).connect(bus.texture);
    G.windLfo.start();
    G.rainLp = filter('lowpass', 6000);
    G.rainGain = gain(0);
    loop(G.white, 1).connect(filter('highpass', 500)).connect(G.rainLp).connect(G.rainGain).connect(bus.texture);
    G.hissGain = gain(0);
    loop(G.pink, 3).connect(filter('highpass', 5000)).connect(G.hissGain).connect(bus.texture);

    // machinery: a hum tuned to the key, so the silo drones in tune with the score
    G.hum1 = ctx.createOscillator(); G.hum1.type = 'sawtooth';
    G.hum2 = ctx.createOscillator(); G.hum2.type = 'sawtooth';
    G.humLp = filter('lowpass', 160);
    G.humGain = gain(0);
    G.hum1.connect(G.humLp); G.hum2.connect(gain(0.4)).connect(G.humLp);
    G.humLp.connect(G.humGain).connect(bus.machine);
    G.hum1.start(); G.hum2.start();

    // Sidechain pump: the kick briefly ducks the sustained layers, the classic lo-fi breathing.
    r.pump = (t) => {
      if (!S.pump) return;
      for (const l of ['pad', 'arp', 'texture']) {
        const d = G.duck[l].gain;
        d.cancelScheduledValues(t);
        d.setValueAtTime(1 - S.pump * 0.75, t);
        d.linearRampToValueAtTime(1, t + Math.min(0.35, comp.stepDur() * 3.5));
      }
    };

    applyParams(true);
  }

  // Push the current settings onto every continuous parameter, smoothly.
  function applyParams(instant = false) {
    const { ctx, G, bus } = r;
    if (!ctx) return;
    const now = ctx.currentTime, tc = instant ? 0.001 : 0.15;
    const to = (param, v, t = tc) => param.setTargetAtTime(v, now, t);
    const M = comp.M;

    for (const l of LAYERS) to(bus[l].gain, S.mute[l] ? 0 : S.vol[l]);
    to(G.master.gain, S.vol.master);
    if (S.arrangement === 'Static') {
      for (const l of LAYERS) { to(G.arr[l].gain, 1, 0.5); M.level[l] = 1; }
      M.section = null;
    }

    to(G.revOut.gain, S.space * (0.6 + S.depth * 0.9));
    to(G.revTone.frequency, 2500 + (1 - S.depth) * 6000);
    to(G.dly.delayTime, comp.stepDur() * 3, 0.3);
    to(G.dlyFb.gain, 0.2 + S.space * 0.4);
    to(G.dlyOut.gain, 0.2 + S.space * 0.5);

    to(G.wowDepth.gain, S.wobble * 22);
    to(G.flutterDepth.gain, S.wobble * 4);

    if (Math.abs(S.drive - lastDrive) > 0.02) { G.shaper.curve = driveCurve(S.drive); lastDrive = S.drive; }
    to(G.postDrive.gain, 1 / (1 + S.drive * 1.3));

    const tx = library.textures[S.texture] ?? {};
    const windCenter = 900 - S.depth * 650;
    to(G.windBp.frequency, windCenter, 1);
    to(G.windLfoDepth.gain, windCenter * 0.5, 1);
    to(G.windGain.gain, (0.12 + S.depth * 0.45) * (tx.wind ?? 0), 1);
    to(G.rainGain.gain, 0.25 * (tx.rain ?? 0), 1);
    to(G.rainLp.frequency, 6500 - S.depth * 3500, 1);
    to(G.hissGain.gain, S.drive * 0.05 + S.wobble * 0.012 + (tx.crackle ?? 0) * 0.05);

    to(G.drumIn.frequency, library.kits[S.kit].lowpass);

    const humHz = mtof(24 + S.root + (S.root > 6 ? 0 : 12));
    to(G.hum1.frequency, humHz, 0.5);
    to(G.hum2.frequency, humHz * 2 * 1.003, 0.5);
    to(G.humLp.frequency, 110 + S.activity * 220);
    to(G.humGain.gain, S.activity * 0.3, 0.6);
  }

  function tick() {
    const now = r.ctx.currentTime;
    // A throttled timer (a background tab) falls behind: skip ahead rather than
    // cram every missed step into one burst.
    if (next < now) next = now + 0.05;
    while (next < now + 0.2) {
      comp.step(next);
      next += comp.stepDur();
    }
  }

  const api = {
    /** The live settings. Change a field, then call update(field). */
    settings: S,
    library,
    get started() { return r.ctx !== null; },
    get playing() { return r.ctx !== null && r.ctx.state === 'running'; },
    get analyser() { return r.G.analyser ?? null; },
    /** Called with the parts of a label ([chord, mode, meter, bar, section?]) as each chord sounds. */
    onChord: null,
    stings: Object.keys(STINGS),

    /** Start or resume. The first call must come from a user gesture. */
    async start() {
      if (!r.ctx) {
        build();
        next = r.ctx.currentTime + 0.1;
        timer = setInterval(tick, 25);
      }
      if (r.ctx.state !== 'running') await r.ctx.resume();
    },

    async pause() {
      if (r.ctx && r.ctx.state === 'running') await r.ctx.suspend();
    },

    /** Apply a change to one setting, with the knock-on effects some settings have. */
    update(key) {
      const before = S.meter;
      if (key === 'melody' && comp.currentTheme()) comp.themeFromNextBar();
      if (key === 'drums') {
        const d = library.drums[S.drums];
        if (d && !comp.currentTheme()) S.meter = d.meter; // a pattern brings its meter
      }
      const theme = comp.currentTheme();
      if (theme && S.meter !== theme.meter) S.meter = theme.meter;
      if (['seed', 'meter', 'drums', 'melody'].includes(key) || S.meter !== before) comp.reseed();
      if (key === 'chordBars' || key === 'scale') comp.reloop();
      applyParams();
    },

    /** Replace every setting with a score, starting it on a fresh bar at once. */
    load(score) {
      const resolved = resolveScore(library, score);
      for (const k of Object.keys(S)) delete S[k];
      Object.assign(S, resolved);
      comp.restart();
      comp.reseed();
      applyParams();
    },

    sting(name) {
      const s = STINGS[name];
      if (!s || !api.playing) return;
      const t = r.ctx.currentTime + 0.03, base = (s.base ?? 72) + comp.lowRoot();
      const pitches = s.semis ? s.semis.map((x) => base + x) : s.degs.map((d) => comp.degMidi(d, base));
      pitches.forEach((m, i) => playInst(r, s.inst, 'stings', m, t + i * s.gap, 0.4, s.vel ?? 1, s.semis ? 0 : r.rand(-0.3, 0.3), { timbre: s.timbre }));
    },

    /** Stop for good and free the audio device. */
    async close() {
      clearInterval(timer);
      timer = null;
      if (r.ctx) await r.ctx.close();
    },
  };

  r.onChord = (bits, t) => {
    if (!api.onChord) return;
    setTimeout(() => { if (api.playing) api.onChord(bits); }, Math.max(0, (t - r.ctx.currentTime) * 1000));
  };

  return api;
}
