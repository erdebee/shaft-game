/**
 * figures.js
 * Porter and worker figures. Position only — every figure's coordinates come
 * from interpolate.js each frame, and nothing about a figure is stored in game
 * state (view principle 9).
 *
 * SVG nodes are POOLED rather than created and destroyed. A trip lasting 36
 * ticks would otherwise churn 2000+ nodes at 60fps, and node creation is the
 * expensive part of SVG. The pool grows to the high-water mark and then stops.
 *
 * Only `transform` is written per frame — never width, height, x or y — so the
 * browser can composite without relayout.
 */

import {
  tripPosition, stairWalk, levelCentreY, roomRect, workerSlot, visualJitter, LEVEL_HEIGHT,
} from './interpolate.js';
import { spriteFor, workerFigureCount } from './spriteMap.js';
import { isLevelVisible } from './viewport.js';
import { SPEEDS } from '../../core/clock.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Figure size in shaft units (sprite pixels). An adult is about 36 px tall in a
 * 96-px room (spec §4.2): chest-high to a counter, a head under a doorway. The
 * vector placeholder is drawn 1:2; a real figure carries its own measurements
 * in the manifest and ignores these.
 */
const FIGURE_W = 18;
const FIGURE_H = 36;

/**
 * Which role works in a building. The catalogue answers for most of them
 * (`jobs.worksIn`); the four staffed rooms it does not name are listed here,
 * and a room with several jobs cycles through them by figure index, so the
 * archive shows an archivist beside an investigator.
 */
const ROLE_FALLBACK = {
  'council-chamber': 'councillor',
  'common-hall': 'resident',
  'battery-bank': 'engineer',
  'seed-vault': 'grower',
  judicial: 'councillor',
  'shaft-exit': 'constable',
  auditorium: 'resident',
};

export function rolesForBuilding(def, ctx) {
  const jobs = ctx.catalog?.jobs?.all ?? [];
  const working = jobs.filter((j) => j.worksIn?.includes(def.id)).map((j) => j.id);
  if (working.length) return working;
  return [ROLE_FALLBACK[def.id] ?? 'resident'];
}

/**
 * Above this speed individual figures stop reading as people and start reading
 * as noise, so the layer thins out. A legibility rule that happens to also be
 * a performance rule.
 */
const FIGURE_SPEED_LIMIT = SPEEDS.FAST;

/**
 * Show and hide.
 *
 * NOT `node.hidden` — `hidden` is an HTMLElement property, so on an SVG
 * element it silently becomes a meaningless expando and the node stays
 * visible. Pooled figures would then linger at their last position forever.
 * `display` on the style attribute is honoured by SVG.
 */
function hide(node) {
  node.style.display = 'none';
}

function show(node) {
  node.style.display = '';
}

export function createFigureLayer(parent) {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'figure-layer');
  parent.appendChild(group);

  return { group, porters: [], workers: [], parent };
}

/**
 * Grow a pool of figure nodes to at least `count`, returning the pool.
 *
 * Each figure is a WRAPPER <g> holding a <use>, and the split is load-bearing:
 *
 *   the <g>   carries POSITION, written by JS as a transform attribute
 *   the <use> carries ANIMATION, written by CSS as a transform
 *
 * They cannot share a node. A CSS `transform` overrides an SVG `transform`
 * attribute, so an ambient keyframe on the positioned node replaces its
 * position — and because a keyframe that only defines 50% takes the attribute
 * value at 0% and 100%, the figure smoothly interpolates between where it
 * belongs and the SVG origin. The symptom is people sliding diagonally to the
 * top-left corner and back, once per animation cycle.
 *
 * Keep every CSS animation on the inner node and every JS position on the
 * wrapper, and the two can never fight.
 */
function ensurePool(layer, pool, count, symbolId, className) {
  while (pool.length < count) {
    const node = document.createElementNS(SVG_NS, 'g');
    node.setAttribute('class', className);

    const sprite = document.createElementNS(SVG_NS, 'use');
    sprite.setAttribute('href', `#sprite-${symbolId}`);
    sprite.setAttribute('class', 'figure-sprite');
    sprite.setAttribute('width', String(FIGURE_W));
    sprite.setAttribute('height', String(FIGURE_H));
    node.appendChild(sprite);

    hide(node);
    layer.group.appendChild(node);
    pool.push(node);
  }
  return pool;
}

// ---- Pixel figures ---------------------------------------------------------

/**
 * A pooled node for one pixel figure, built like an animated room part: a
 * window <svg> the size of one frame, holding a strip that CSS steps sideways.
 *
 *   the outer <g>    POSITION   (JS transform attribute)
 *   the flip <g>     FACING     (JS transform attribute)
 *   the strip <image> ANIMATION (CSS keyframes, see screens.css)
 *
 * The same three-node split as the vector figure above, for the same reason: a
 * CSS animation on a node whose transform attribute JS owns would drag the
 * figure towards the origin once per cycle.
 */
function ensureSpritePool(layer, pool, count, className) {
  while (pool.length < count) {
    const node = document.createElementNS(SVG_NS, 'g');
    node.setAttribute('class', className);

    const flip = document.createElementNS(SVG_NS, 'g');
    const window = document.createElementNS(SVG_NS, 'svg');
    window.setAttribute('class', 'figure-window');
    const strip = document.createElementNS(SVG_NS, 'image');
    strip.setAttribute('data-part', 'strip');
    strip.setAttribute('y', '0');

    window.appendChild(strip);
    flip.appendChild(window);
    node.appendChild(flip);
    hide(node);
    layer.group.appendChild(node);
    pool.push({ node, flip, window, strip, clip: null });
  }
  return pool;
}

/**
 * Point a pooled figure at one clip of one role. Attributes are only written
 * when the clip changes — per frame this is a no-op, which is the point.
 */
function setClip(entry, clip, key) {
  const id = `${key}:${clip.path}`;
  if (entry.clip === id) return;
  entry.clip = id;

  const { w, h, frames } = clip;
  entry.window.setAttribute('width', String(w));
  entry.window.setAttribute('height', String(h));
  entry.window.setAttribute('viewBox', `0 0 ${w} ${h}`);
  entry.strip.setAttribute('href', clip.href);
  entry.strip.setAttribute('width', String(w * frames));
  entry.strip.setAttribute('height', String(h));
  entry.strip.style.setProperty('--frames', String(frames));
  entry.strip.style.setProperty('--strip-width', String(w * frames));
  entry.strip.style.setProperty('--strip-duration', `${(clip.frameMs ?? 120) * frames}ms`);
  // A still is one cell: no steps to take, so the animation is switched off
  // rather than left running over a single frame.
  entry.strip.style.animationName = frames > 1 ? 'strip' : 'none';
}

/**
 * Place a figure so its feet land on `y` and its body centres on `x`, facing
 * east (`facing` 1) or west (-1). Mirroring happens inside the sprite box, so
 * the anchor column moves with it.
 */
function placeSprite(entry, clip, x, y, facing) {
  const anchor = facing < 0 ? clip.w - clip.cx : clip.cx;
  entry.node.setAttribute(
    'transform',
    `translate(${Math.round(x - anchor)} ${Math.round(y - clip.feet)})`,
  );
  entry.flip.setAttribute('transform', facing < 0 ? `translate(${clip.w} 0) scale(-1 1)` : '');
}

/**
 * Redraw every figure for this frame.
 * Called from shaftView.render, which is called from the engine's rAF loop.
 * Reads state; never writes it.
 */
export function renderFigures(layer, state, ctx, tick, alpha, viewport, art = null) {
  const figures = art?.figures;
  if (figures?.size) {
    renderSpritePorters(layer, state, tick, alpha, viewport, figures);
    renderSpriteWorkers(layer, state, ctx, viewport, art);
    return;
  }
  renderPorters(layer, state, ctx, tick, alpha, viewport);
  renderWorkers(layer, state, ctx, viewport, art);
}

/** Porters on the stairwell, walking their trip. */
function renderSpritePorters(layer, state, tick, alpha, viewport, figures) {
  const thinned = state.clock.speed > FIGURE_SPEED_LIMIT;
  const trips = thinned ? [] : state.haulage.trips.filter((t) => t.method === 'stairwell');
  const clips = figures.get('porter');
  const pool = ensureSpritePool(layer, layer.porters, trips.length, 'figure figure-porter');

  trips.forEach((trip, i) => {
    const entry = pool[i];
    const pos = tripPosition(trip, tick, alpha);
    if (!isLevelVisible(viewport, Math.round(pos.level))) {
      hide(entry.node);
      return;
    }
    show(entry.node);
    const clip = clips.walk ?? clips.still;
    setClip(entry, clip, 'porter');
    // Trips that start on the same tick share a position, so a stable offset
    // hashed from the trip id spreads them out. ALONG the stair, not across
    // it: a lateral offset would hang them over the drop, while a few steps
    // ahead or behind keeps every one of them on the treads.
    const step = stairWalk(pos.y + (visualJitter(trip.id) - 0.5) * 10, pos.descending);
    placeSprite(entry, clip, step.x, step.y, step.facing);
    entry.strip.style.setProperty('--phase', `${(visualJitter(`${trip.id}:p`) * -1.2).toFixed(2)}s`);
  });

  for (let i = trips.length; i < pool.length; i++) hide(pool[i].node);
}

/**
 * Workers inside buildings: the roles the catalogue says work there, standing
 * on the room's own floor row and playing their work loop if they have one.
 */
function renderSpriteWorkers(layer, state, ctx, viewport, art) {
  const placements = [];

  for (const instance of state.buildings) {
    if (!isLevelVisible(viewport, instance.level)) continue;
    if (instance.powered === false) continue; // dark building, nobody working

    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;

    const count = workerFigureCount(instance, def);
    if (count === 0) continue;

    const roles = rolesForBuilding(def, ctx);
    const rect = roomRect(instance, state.buildings);
    const room = art.rooms.get(def.id);
    const floorY = room?.floorY;

    for (let i = 0; i < count; i++) {
      const role = roles[i % roles.length];
      const clips = art.figures.get(role);
      if (!clips) continue;
      const spot = workerSlot(rect, i, count, floorY, room?.seats);
      placements.push({ ...spot, clips, key: `${instance.instanceId}:${i}`, role });
    }
  }

  const pool = ensureSpritePool(layer, layer.workers, placements.length, 'figure figure-worker');

  placements.forEach((spot, i) => {
    const entry = pool[i];
    show(entry.node);
    const clip = spot.clips.work ?? spot.clips.idle ?? spot.clips.still;
    setClip(entry, clip, spot.role);
    // Facing and loop phase are hashed from the placement, so a room reads as
    // a group of people rather than a rank, and never twitches between frames.
    placeSprite(entry, clip, spot.x, spot.y, visualJitter(`${spot.key}:face`) < 0.4 ? -1 : 1);
    entry.strip.style.setProperty('--phase', `${(visualJitter(spot.key) * -2.4).toFixed(2)}s`);
  });

  for (let i = placements.length; i < pool.length; i++) hide(pool[i].node);
}

function renderPorters(layer, state, ctx, tick, alpha, viewport) {
  const thinned = state.clock.speed > FIGURE_SPEED_LIMIT;

  // Trips on the stairwell get a figure; a trip inside an elevator is drawn as
  // the car itself, by shaftView, so it is skipped here.
  const trips = thinned
    ? []
    : state.haulage.trips.filter((t) => t.method === 'stairwell');

  const pool = ensurePool(layer, layer.porters, trips.length, 'porter', 'figure figure-porter');

  trips.forEach((trip, i) => {
    const node = pool[i];
    const pos = tripPosition(trip, tick, alpha);

    if (!isLevelVisible(viewport, Math.round(pos.level))) {
      hide(node);
      return;
    }

    show(node);
    // Trips that start on the same tick along the same route interpolate to
    // exactly the same point and would stack into one figure. A stable
    // per-trip offset spreads them along the stair instead — derived from the
    // trip id, so a porter never jitters between frames.
    const step = stairWalk(pos.y + (visualJitter(trip.id) - 0.5) * 10, pos.descending);

    // Figures are anchored at their feet, so subtract the sprite height.
    node.setAttribute(
      'transform',
      `translate(${Math.round(step.x - FIGURE_W / 2)} ${Math.round(step.y - FIGURE_H)})`,
    );
    node.setAttribute('data-facing', step.facing < 0 ? 'west' : 'east');
  });

  for (let i = trips.length; i < pool.length; i++) hide(pool[i]);
}

/**
 * Ambient workers inside buildings. Position is derived from the building's
 * slot and the figure's index — deterministic, so nobody twitches between
 * frames. Their idle animation is CSS, with a phase offset hashed from the
 * instance id so a row of workers is not in lockstep.
 */
function renderWorkers(layer, state, ctx, viewport, art) {
  const placements = [];

  for (const instance of state.buildings) {
    if (!isLevelVisible(viewport, instance.level)) continue;
    if (instance.powered === false) continue; // dark building, nobody working

    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;

    const count = workerFigureCount(instance, def);
    if (count === 0) continue;

    const rect = roomRect(instance, state.buildings);
    const room = art?.rooms.get(def.id);
    const floorY = room?.floorY;

    for (let i = 0; i < count; i++) {
      const spot = workerSlot(rect, i, count, floorY, room?.seats);
      placements.push({ ...spot, key: `${instance.instanceId}:${i}` });
    }
  }

  const pool = ensurePool(layer, layer.workers, placements.length, 'worker', 'figure figure-worker');

  placements.forEach((spot, i) => {
    const node = pool[i];
    show(node);
    node.setAttribute('transform', `translate(${spot.x - FIGURE_W / 2} ${spot.y - FIGURE_H})`);
    // Stable per-figure phase, so the row looks alive rather than mechanical.
    node.style.setProperty('--phase', `${(visualJitter(spot.key) * -2.4).toFixed(2)}s`);
  });

  for (let i = placements.length; i < pool.length; i++) hide(pool[i]);
}

/**
 * Elevator and dumbwaiter car positions. Cars are part of the building sprite
 * rather than free figures, so they are moved by transforming the sprite's
 * `car` part — the same trip interpolation, a different visual.
 */
export function renderCars(state, ctx, tick, alpha, nodesByInstance) {
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;

    const sprite = spriteFor(def);
    if (!sprite.parts.some((p) => p.kind === 'car')) continue;

    const node = nodesByInstance.get(instance.instanceId);
    const car = node?.querySelector('[data-part="car"]');
    if (!car) continue;

    const trip = state.haulage.trips.find(
      (t) => t.method === def.id || (def.id === 'freight-elevator' && t.method === 'freight-elevator'),
    );

    // Idle cars sit at the building's own level rather than snapping to zero.
    const targetY = trip
      ? tripPosition(trip, tick, alpha).y
      : levelCentreY(instance.level);

    const offset = targetY - levelCentreY(instance.level);
    car.setAttribute('transform', `translate(0 ${(offset / LEVEL_HEIGHT) * 100})`);
  }
}
