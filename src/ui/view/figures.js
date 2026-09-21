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
  tripPosition, levelCentreY, slotRect, workerSlot, visualJitter, LEVEL_HEIGHT,
} from './interpolate.js';
import { spriteFor, workerFigureCount } from './spriteMap.js';
import { isLevelVisible } from './viewport.js';
import { SPEEDS } from '../../core/clock.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Figure size in shaft units. A level is 10 tall, so a figure is a third of a
 * storey — small enough to read as a person in a room rather than filling it.
 */
const FIGURE_W = 1.7;
const FIGURE_H = 3.4;

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

/**
 * Redraw every figure for this frame.
 * Called from shaftView.render, which is called from the engine's rAF loop.
 * Reads state; never writes it.
 */
export function renderFigures(layer, state, ctx, tick, alpha, viewport) {
  renderPorters(layer, state, ctx, tick, alpha, viewport);
  renderWorkers(layer, state, ctx, viewport);
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
    // per-trip offset spreads them across the stairwell's width instead —
    // derived from the trip id, so a porter never jitters between frames.
    const lane = (visualJitter(trip.id) - 0.5) * 3.4;

    // Figures are anchored at their feet, so subtract the sprite height.
    node.setAttribute(
      'transform',
      `translate(${pos.x + lane - FIGURE_W / 2} ${pos.y - FIGURE_H})`,
    );
    node.setAttribute('data-descending', pos.descending ? 'true' : 'false');
  });

  for (let i = trips.length; i < pool.length; i++) hide(pool[i]);
}

/**
 * Ambient workers inside buildings. Position is derived from the building's
 * slot and the figure's index — deterministic, so nobody twitches between
 * frames. Their idle animation is CSS, with a phase offset hashed from the
 * instance id so a row of workers is not in lockstep.
 */
function renderWorkers(layer, state, ctx, viewport) {
  const placements = [];

  for (const instance of state.buildings) {
    if (!isLevelVisible(viewport, instance.level)) continue;
    if (instance.powered === false) continue; // dark building, nobody working

    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;

    const count = workerFigureCount(instance, def);
    if (count === 0) continue;

    const level = state.levels.find((l) => l.index === instance.level);
    const rect = slotRect(instance.slot ?? 0, instance.slots ?? 1, level?.buildSlots ?? 8, instance.level);

    for (let i = 0; i < count; i++) {
      const spot = workerSlot(rect, i, count);
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
