/**
 * airParticles.js
 * The air moving through the rooms, drawn as particles: out of every blowing
 * duct fan, along its level, down or up through the rooms of every level
 * between, and along the sucking fan's level into the sucker — the half of
 * the loop where the air does its work, picking up what the Shaft breathes
 * out. Each particle takes its own line, so a stream is a curtain.
 *
 * Each particle is coloured by how clean its air is at that point: blue as
 * it leaves the blower, browning as it crosses dirty levels, and arriving as
 * dirty as the air the sucker actually draws (state.resources.flows.air
 * paths, settled by systems/airQuality/airflow.js). Between the two ends the
 * colour follows the purity of each level it passes, so a stream through the
 * Works turns brown there and not before. How many particles a stream has
 * follows how much air it moves.
 *
 * Positions are a pure function of the view's ambient clock, which stops
 * while the game is paused — nothing here is state, and nothing is saved.
 */

import { roomRect, levelY, ROOM_HEIGHT, BUILD_X, visualJitter } from './interpolate.js';
import { svg } from './conduits.js';

/** A particle's size, in shaft units. */
const SIZE = 6;

/** Purity at and below which air is drawn fully brown; above CLEAN, fully blue. */
const DIRTY = 65;
const CLEAN = 97;

/** How strongly a stream takes on the air of each level it crosses. */
const PICKUP_PER_LEVEL = 0.35;

export function createAirParticles(parent) {
  const group = svg(parent, 'g', 'air-particles');
  let streams = [];
  let colours = null;
  const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  return { build, frame, clear };

  function clear() {
    group.replaceChildren();
    streams = [];
  }

  /**
   * Lay out one stream per blower-to-sucker path. Each particle takes its
   * own line down (or up) through the rooms, so a stream is a curtain of air
   * drifting through the levels it crosses rather than a single thread.
   */
  function build(state, paths) {
    clear();
    colours ??= readColours();
    const byId = new Map(state.buildings.map((b) => [b.instanceId, b]));
    for (const path of paths ?? []) {
      const from = byId.get(path.from);
      const to = byId.get(path.to);
      if (!from || !to || path.flow < 0.5) continue;
      const count = Math.max(6, Math.min(60, Math.round(path.flow / 3)));
      const width = builtWidth(state, from.level, to.level);
      const particles = [];
      for (let k = 0; k < count; k++) {
        const key = `${path.from}>${path.to}#${k}`;
        const lane = BUILD_X + 14 + visualJitter(`${key}lane`) * width;
        const route = routeOf(state, from, to, lane);
        const dot = svg(group, 'rect', 'air-particle');
        dot.setAttribute('width', String(SIZE));
        dot.setAttribute('height', String(SIZE));
        particles.push({
          dot,
          route,
          profile: profileOf(state, route, from.level, to.level, path),
          phase: k / count + visualJitter(`${key}phase`) / count,
          speed: (40 + path.flow * 0.25) * (0.8 + visualJitter(`${key}speed`) * 0.4),
          dx: (visualJitter(`${key}x`) - 0.5) * 10,
          dy: (visualJitter(`${key}y`) - 0.5) * 50,
          fill: null,
        });
      }
      streams.push({ particles });
    }
  }

  /** Move every particle to where the clock puts it, and colour it. */
  function frame(ambientMs) {
    const seconds = calm ? 0 : ambientMs / 1000;
    for (const { particles } of streams) {
      for (const p of particles) {
        const { route } = p;
        const along = ((seconds * p.speed + p.phase * route.length) % route.length + route.length) % route.length;
        const at = pointAt(route, along);
        p.dot.setAttribute('x', (at.x + p.dx * (1 - at.spread) - SIZE / 2).toFixed(1));
        p.dot.setAttribute('y', (at.y + p.dy * at.spread - SIZE / 2).toFixed(1));
        const fill = colourOf(qualityAt(p.profile, along / route.length));
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
  const points = from.level === to.level
    ? [start, end]
    : [start, { x: lane, y: start.y }, { x: lane, y: end.y }, end];
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
        // Squeezed into the stairwell, spread out through the rooms.
        spread: vertical ? 0 : 1,
      };
    }
  }
  return { ...route.points[0], spread: 1 };
}

/**
 * The purity of a stream's air along its route, as [share of the way, purity]
 * samples: blown out as clean as the blower's air, taking on each level it
 * crosses, and — corrected so the sum comes out right — arriving exactly as
 * dirty as what the sucker draws.
 */
function profileOf(state, route, fromLevel, toLevel, path) {
  const purity = (level) => state.levels[level - 1]?.airQuality ?? 100;
  const samples = [[0, path.blown.airQuality]];
  let q = path.blown.airQuality;
  const firstRun = route.segments[0].len / route.length;
  q += (purity(fromLevel) - q) * PICKUP_PER_LEVEL;
  samples.push([firstRun, q]);
  if (fromLevel !== toLevel) {
    const vertical = route.segments[1];
    const step = fromLevel < toLevel ? 1 : -1;
    for (let level = fromLevel + step; level !== toLevel + step; level += step) {
      q += (purity(level) - q) * PICKUP_PER_LEVEL;
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
