/**
 * airParticles.js
 * The air moving round its loop, drawn as particles.
 *
 *   through the rooms  out of every blowing duct fan, along its level, down
 *                      or up through the rooms of every level between, and
 *                      along the sucking fan's level into the sucker — the
 *                      streams the air actually takes through the Shaft
 *                      (airflow.js streamsOf), which never cross. Each
 *                      particle takes its own line, so a stream is a curtain
 *   through the ducts  from the sucker back along every duct to the
 *                      blowers, through the scrubbers and gardens on the way
 *
 * Each particle is coloured by how clean its air is at that point: in the
 * rooms, blue as it leaves the blower, browning as it crosses dirty levels,
 * and arriving as dirty as the air the sucker actually draws
 * (state.resources.flows.air paths, settled by systems/airQuality/
 * airflow.js); in a duct, as clean as the air in that duct — brown on the
 * way to a scrubber, blue after it. How many particles there are follows how
 * much air moves.
 *
 * A particle is not pinned to its line: it chases a point that runs along
 * it, on a loose spring, so it carries its speed round corners, overshoots
 * and swings back, and drifts a little side to side. That is the only state
 * here, and it is the view's — never saved. Time is the view's ambient
 * clock, which stops while the game is paused, so the particles do too.
 */

import { roomRect, levelY, ROOM_HEIGHT, BUILD_X, visualJitter } from './interpolate.js';
import { svg } from './conduits.js';

/** A particle's size, in shaft units. */
const SIZE = 3;

/** Purity at and below which air is drawn fully brown; above CLEAN, fully blue. */
const DIRTY = 65;
const CLEAN = 97;

/**
 * The spring a particle chases its point on: its natural frequency (rad/s)
 * and damping ratio. Under-damped, so it overshoots a corner and swings back.
 */
const OMEGA = 7;
const ZETA = 0.28;

/** How fast air moves, in shaft units a second, for a given flow. */
const speedFor = (flow) => 64 + flow * 0.4;

export function createAirParticles(parent) {
  const group = svg(parent, 'g', 'air-particles');
  let streams = [];
  /** Where each particle is and how fast it is going, by key, kept across rebuilds. */
  let motion = new Map();
  let colours = null;
  let lastMs = null;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  return { build, frame, clear };

  function clear() {
    group.replaceChildren();
    streams = [];
  }

  /**
   * Lay out the streams: one through the rooms per blower-to-sucker path,
   * and one along every duct that moves air.
   *
   * @param ducts [{ key, points, flow, airQuality }] — each duct's route,
   *   upstream first, as the network layer draws it
   */
  function build(state, paths, ducts = []) {
    clear();
    colours ??= readColours();
    const kept = new Map();
    const byId = new Map(state.buildings.map((b) => [b.instanceId, b]));

    for (const path of paths ?? []) {
      const from = byId.get(path.from);
      const to = byId.get(path.to);
      if (!from || !to || path.flow < 0.5) continue;
      const count = Math.max(12, Math.min(120, Math.round(path.flow / 1.5)));
      const width = builtWidth(state, from.level, to.level);
      const particles = [];
      for (let k = 0; k < count; k++) {
        const key = `${path.from}>${path.to}#${k}`;
        const route = routeOf(state, from, to, BUILD_X + 14 + visualJitter(`${key}lane`) * width);
        const profile = profileOf(state, route, from.level, to.level, path);
        particles.push(particle(key, kept, {
          route,
          quality: (t) => qualityAt(profile, t),
          phase: (k + visualJitter(`${key}phase`)) / count,
          speed: speedFor(path.flow) * (0.8 + visualJitter(`${key}speed`) * 0.4),
          dx: (visualJitter(`${key}x`) - 0.5) * 10,
          dy: (visualJitter(`${key}y`) - 0.5) * 50,
          sway: 7,
        }));
      }
      streams.push(particles);
    }

    for (const duct of ducts) {
      if (duct.flow < 0.5 || duct.points.length < 2) continue;
      const route = routeFrom(duct.points);
      const count = Math.max(8, Math.min(120, Math.round(route.length / 12)));
      const particles = [];
      for (let k = 0; k < count; k++) {
        const key = `duct:${duct.key}#${k}`;
        particles.push(particle(key, kept, {
          route,
          quality: () => duct.airQuality,
          phase: (k + visualJitter(`${key}phase`)) / count,
          speed: speedFor(duct.flow) * (0.85 + visualJitter(`${key}speed`) * 0.3),
          // Inside the duct: it is 24 across, the particles keep off its walls.
          dx: (visualJitter(`${key}x`) - 0.5) * 12,
          dy: (visualJitter(`${key}y`) - 0.5) * 12,
          sway: 2.5,
          ducted: true,
        }));
      }
      streams.push(particles);
    }
    motion = kept;
  }

  /** A particle, carrying on from where it was if it was already moving. */
  function particle(key, kept, spec) {
    const dot = svg(group, 'rect', 'air-particle');
    dot.setAttribute('width', String(SIZE));
    dot.setAttribute('height', String(SIZE));
    const m = motion.get(key) ?? { x: null, y: null, vx: 0, vy: 0, along: null };
    kept.set(key, m);
    return { ...spec, key, dot, m, fill: null, wobble: visualJitter(`${key}w`) * Math.PI * 2 };
  }

  /** Move every particle towards where the clock puts its point, and colour it. */
  function frame(ambientMs) {
    const seconds = calm ? 0 : ambientMs / 1000;
    const dt = lastMs === null ? 0 : Math.max(0, Math.min(0.1, (ambientMs - lastMs) / 1000));
    lastMs = ambientMs;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    const k = OMEGA * OMEGA;
    const c = 2 * ZETA * OMEGA;

    for (const particles of streams) {
      for (const p of particles) {
        const { route, m } = p;
        const along = ((seconds * p.speed + p.phase * route.length) % route.length + route.length) % route.length;
        const at = pointAt(route, along);
        // A slow drift across the line, so no two particles run parallel.
        const sway = Math.sin(seconds * 1.7 + p.wobble) * p.sway;
        const across = p.ducted ? 1 : 1 - at.spread;
        const tx = at.x + (p.dx + (at.vertical ? sway : 0)) * (at.vertical ? 1 : across * 0.3);
        const ty = at.y + (p.dy + (at.vertical ? 0 : sway)) * (at.vertical ? (p.ducted ? 0.3 : 0.1) : (p.ducted ? 1 : at.spread));

        // Back at the start of its loop, or new: it appears where it should be.
        const wrapped = m.along !== null && along < m.along - route.length / 2;
        if (m.x === null || wrapped || calm) {
          m.x = tx; m.y = ty; m.vx = 0; m.vy = 0;
        } else {
          for (let i = 0; i < steps; i++) {
            m.vx += (k * (tx - m.x) - c * m.vx) * h;
            m.vy += (k * (ty - m.y) - c * m.vy) * h;
            m.x += m.vx * h;
            m.y += m.vy * h;
          }
        }
        m.along = along;

        p.dot.setAttribute('x', (m.x - SIZE / 2).toFixed(1));
        p.dot.setAttribute('y', (m.y - SIZE / 2).toFixed(1));
        const fill = colourOf(p.quality(along / route.length));
        if (fill !== p.fill) {
          p.fill = fill;
          p.dot.setAttribute('fill', fill);
        }
      }
    }
  }

  function colourOf(purity) {
    const t = Math.max(0, Math.min(1, (purity - DIRTY) / (CLEAN - DIRTY)));
    // Quantised, so a particle's fill only changes when it visibly would.
    const step = Math.round(t * 12) / 12;
    const [a, b] = [colours.dirty, colours.fresh];
    const mix = a.map((v, i) => Math.round(v + (b[i] - v) * step));
    return `rgb(${mix.join(',')})`;
  }
}

/**
 * From the blower's room, along its level to the particle's own line, down
 * or up through the rooms of every level between, and along the sucker's
 * level into its room. `spread` is how far the particles fan out across a
 * room's height there: wide along a level, narrow on the way between.
 */
function routeOf(state, from, to, lane) {
  const a = roomRect(from, state.buildings);
  const b = roomRect(to, state.buildings);
  const start = { x: a.x + a.width / 2, y: a.y + ROOM_HEIGHT / 2 };
  const end = { x: b.x + b.width / 2, y: b.y + ROOM_HEIGHT / 2 };
  return routeFrom(from.level === to.level
    ? [start, end]
    : [start, { x: lane, y: start.y }, { x: lane, y: end.y }, end]);
}

/** A route through a list of points: its segments and its length. */
function routeFrom(points) {
  const segments = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    segments.push({ from: points[i - 1], to: points[i], start: length, len });
    length += len;
  }
  return { points, segments, length: Math.max(1, length) };
}

/** How far across the Shaft rooms stand, between two levels: where the air can go. */
function builtWidth(state, a, b) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  let right = BUILD_X + 200;
  for (const x of state.buildings) {
    if (x.level < lo || x.level > hi) continue;
    const r = roomRect(x, state.buildings);
    right = Math.max(right, r.x + r.width);
  }
  return right - BUILD_X - 28;
}

function pointAt(route, along) {
  for (const s of route.segments) {
    if (along <= s.start + s.len || s === route.segments[route.segments.length - 1]) {
      const f = s.len > 0 ? Math.min(1, (along - s.start) / s.len) : 0;
      const vertical = s.from.x === s.to.x;
      return {
        x: s.from.x + (s.to.x - s.from.x) * f,
        y: s.from.y + (s.to.y - s.from.y) * f,
        // Squeezed onto its line between levels, spread out through the rooms.
        spread: vertical ? 0 : 1,
        vertical,
      };
    }
  }
  return { ...route.points[0], spread: 1, vertical: false };
}

/**
 * The purity of a stream's air along its route, as [share of the way, purity]
 * samples: blown out as clean as the blower's air, as clean as each level it
 * crosses, and arriving exactly as dirty as what the sucker draws.
 */
function profileOf(state, route, fromLevel, toLevel, path) {
  const purity = (level) => state.levels[level - 1]?.airQuality ?? 100;
  const samples = [[0, path.blown.airQuality]];
  let q = path.blown.airQuality;
  // Every level the air crosses mixes it into its own and hands that on
  // (airflow.js shaftFlow), so along the way it is as clean as the level.
  const firstRun = route.segments[0].len / route.length;
  q = purity(fromLevel);
  samples.push([firstRun, q]);
  if (fromLevel !== toLevel) {
    const vertical = route.segments[1];
    const step = fromLevel < toLevel ? 1 : -1;
    for (let level = fromLevel + step; level !== toLevel + step; level += step) {
      q = purity(level);
      const y = levelY(level) + ROOM_HEIGHT / 2;
      const f = Math.abs(y - vertical.from.y) / Math.max(1, vertical.len);
      samples.push([(vertical.start + f * vertical.len) / route.length, q]);
    }
  }
  samples.push([1, q]);
  // The ends are the simulation's; what lies between is the levels' shape.
  const miss = path.drawn.airQuality - q;
  return samples.map(([t, v]) => [t, v + miss * t]);
}

function qualityAt(profile, t) {
  for (let i = 1; i < profile.length; i++) {
    const [t1, q1] = profile[i];
    if (t <= t1) {
      const [t0, q0] = profile[i - 1];
      return t1 > t0 ? q0 + ((q1 - q0) * (t - t0)) / (t1 - t0) : q1;
    }
  }
  return profile[profile.length - 1][1];
}

/** The two ends of the scale, from the stylesheet's tokens. */
function readColours() {
  const css = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
  const rgb = (name, fallback) => {
    const hex = css?.getPropertyValue(name).trim() || fallback;
    const h = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  return { fresh: rgb('--air-fresh', '#5b93bd'), dirty: rgb('--air-dirty', '#7a5a38') };
}
