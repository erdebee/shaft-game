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
  tripPosition, stairWalk, roomRect, visualJitter, simTime, levelY, floorX, FLOOR_Y,
} from './interpolate.js';
import {
  laneOf, wanderAt, workClip, fillOrder, audienceSize, pupilCount,
} from './crew.js';
import { isLevelVisible } from './viewport.js';
import { SPEEDS } from '../../core/clock.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

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

/** Porters standing in their station — resting or waiting — up to three. */
function idlePorters(state, station) {
  let n = 0;
  for (const w of state.population.workers) {
    if (w.job === 'porter' && w.tripId === null && w.at === station.instanceId && !w.handling) n++;
  }
  return Math.min(n, 3);
}

/** How many ambient worker figures to draw for an instance. */
export function workerFigureCount(instance, buildingDef) {
  const staffed = Math.min(instance.staffing ?? 0, buildingDef.staffing ?? 0);
  // Cap at three, and never more than one per slot: past that the figures stop
  // reading as people and start reading as texture, and the information is
  // already in the staffing number.
  return Math.min(staffed, 3, instance.slots ?? 1);
}

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

/**
 * `held` is the group for people held in a cell. It sits under the cage bars
 * while this layer sits over them (shaftView), so a figure drawn there is
 * behind the bars and every other figure is in front. Nobody is held in the
 * simulation yet; when detainees exist, they are drawn into it.
 */
export function createFigureLayer(parent, held = null) {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'figure-layer');
  parent.appendChild(group);

  return { group, held, porters: [], workers: [], bubbles: [], parent };
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
 * They cannot share a node. A CSS `transform` overrides an SVG `transform`
 * attribute, so an ambient keyframe on the positioned node replaces its
 * position — and because a keyframe that only defines 50% takes the attribute
 * value at 0% and 100%, the figure smoothly interpolates between where it
 * belongs and the SVG origin. The symptom is people sliding diagonally to the
 * top-left corner and back, once per animation cycle. Keep every CSS
 * animation on the strip and every JS transform on the two <g>s.
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
export function renderFigures(layer, state, ctx, tick, alpha, viewport, art) {
  const rooms = roomPlaces(state, ctx, art);
  renderSpritePorters(layer, state, tick, alpha, viewport, art, rooms);
  renderSpriteWorkers(layer, state, ctx, simTime(tick, alpha), viewport, art);
}

/**
 * Where one porter is this frame, in shaft units — their feet — for the view
 * to follow them and mark them. Walking: on their trip. Otherwise: standing at
 * the room they are working or waiting in. Null if they are nowhere drawable.
 */
export function porterSpot(state, art, porter, tick, alpha) {
  const rooms = roomPlaces(state, null, art);
  const trip = porter.tripId !== null ? state.haulage.trips.find((t) => t.id === porter.tripId) : null;
  if (trip) {
    const xOf = (id, pos) => (id ? standX(rooms, trip.workerId, id) : null) ?? floorX(pos);
    const pos = tripPosition(trip, tick, alpha, xOf);
    if (pos.onFloor) return { x: pos.x, y: floorAt(rooms, pos.level, pos.x), level: pos.level };
    const step = stairWalk(pos.y, pos.descending);
    return { x: step.x, y: step.y, level: pos.level };
  }
  const at = porter.handling?.instanceId ?? porter.at;
  const place = rooms.get(at);
  if (!place) return null;
  return { x: standX(rooms, porter.id, at), y: place.rect.y + place.floorY, level: place.level };
}

/**
 * Every room's rectangle and floor row, by instance id, for this frame. A
 * porter walking a floor stands on the floor of whichever room it is passing,
 * and on the level's own floor row over the gaps and the stairhead.
 */
function roomPlaces(state, ctx, art) {
  const places = new Map();
  for (const b of state.buildings) {
    const rect = roomRect(b, state.buildings);
    const floorY = art.rooms.get(b.buildingId)?.floorY ?? FLOOR_Y;
    places.set(b.instanceId, { rect, floorY, level: b.level });
  }
  return places;
}

function floorAt(rooms, level, x) {
  for (const { rect, floorY, level: l } of rooms.values()) {
    if (l === level && x >= rect.x && x < rect.x + rect.width) return rect.y + floorY;
  }
  return levelY(level) + FLOOR_Y;
}

/**
 * Where a porter stands at a room: its middle, give or take a step hashed from
 * the porter, so two porters at one room do not stand in one body. The walk
 * ends at the same point, so arriving and standing never jump.
 */
function standX(rooms, porterId, instanceId) {
  const place = rooms.get(instanceId);
  if (!place) return null;
  const spread = Math.min(12, place.rect.width / 4);
  return place.rect.x + place.rect.width / 2 + (visualJitter(`${porterId}:stand`) - 0.5) * 2 * spread;
}

/**
 * Porters: walking their trip (along a floor, then the stairwell, then a floor),
 * or standing at a room loading and unloading. Porters waiting at their station
 * are drawn with the station's crew, in renderSpriteWorkers.
 */
function renderSpritePorters(layer, state, tick, alpha, viewport, art, rooms) {
  const thinned = state.clock.speed > FIGURE_SPEED_LIMIT;
  const clips = art.figures.get('porter');
  const placements = [];
  const bubbles = [];

  if (!thinned && clips) {
    for (const trip of state.haulage.trips) {
      if (trip.method !== 'stairwell') continue;
      const xOf = (id, pos) => (id ? standX(rooms, trip.workerId, id) : null) ?? floorX(pos);
      const pos = tripPosition(trip, tick, alpha, xOf);
      if (!isLevelVisible(viewport, Math.round(pos.level))) continue;
      const clip = clips.walk ?? clips.still;
      if (pos.onFloor) {
        placements.push({ clip, x: pos.x, y: floorAt(rooms, pos.level, pos.x), facing: pos.facing, key: trip.id });
      } else {
        // Trips that start on the same tick share a position, so a stable
        // offset hashed from the trip id spreads them out. ALONG the stair, not
        // across it: a lateral offset would hang them over the drop, while a
        // few steps ahead or behind keeps every one of them on the treads. The
        // offset fades out at the ends of the flight, where the porter steps
        // on or off the floor, so the hand-over never jumps.
        const ease = Math.sin(Math.PI * (pos.legProgress ?? 0.5));
        const step = stairWalk(pos.y + (visualJitter(trip.id) - 0.5) * 10 * ease, pos.descending);
        placements.push({ clip, x: step.x, y: step.y, facing: step.facing, key: trip.id });
      }
    }

    for (const porter of state.population.workers) {
      const job = porter.handling;
      if (porter.job !== 'porter' || porter.tripId !== null || !job) continue;
      const place = rooms.get(job.instanceId);
      if (!place || !isLevelVisible(viewport, place.level)) continue;
      const clip = clips.idle ?? clips.still;
      const x = standX(rooms, porter.id, job.instanceId);
      const y = place.rect.y + place.floorY;
      placements.push({ clip, x, y, facing: visualJitter(`${porter.id}:face`) < 0.5 ? -1 : 1, key: porter.id });

      const span = Math.max(1e-9, job.untilTick - job.startTick);
      const t = Math.min(1, Math.max(0, (simTime(tick, alpha) - job.startTick) / span));
      bubbles.push({ x, y: y - clip.height - 3, t, job, key: `${porter.id}:${job.startTick}` });
    }
  }

  const pool = ensureSpritePool(layer, layer.porters, placements.length, 'figure figure-porter');
  placements.forEach((spot, i) => {
    const entry = pool[i];
    show(entry.node);
    setClip(entry, spot.clip, 'porter');
    placeSprite(entry, spot.clip, spot.x, spot.y, spot.facing);
    entry.strip.style.setProperty('--phase', `${(visualJitter(`${spot.key}:p`) * -1.2).toFixed(2)}s`);
  });
  for (let i = placements.length; i < pool.length; i++) hide(pool[i].node);

  renderBubbles(layer, bubbles, art.icons);
}

// ---- Load bubbles ----------------------------------------------------------

/** Rise over a bubble's life, and when in it the bubble starts to fade. */
const BUBBLE_RISE = 10;
const BUBBLE_FADE_FROM = 0.65;

/**
 * The 5 x 5 sign beside a bubble's icon, as pixel rects: + for what a porter
 * takes on, − for what they put down.
 */
const SIGN_RECTS = {
  pickup: [[0, 2, 5, 1], [2, 0, 1, 5]],
  dropoff: [[0, 2, 5, 1]],
};

/**
 * A pooled bubble: a dark plate, a sign, and the good's icon — or, for a good
 * with no icon yet, a short text label in its place.
 */
function ensureBubblePool(layer, count) {
  const pool = layer.bubbles;
  while (pool.length < count) {
    const node = document.createElementNS(SVG_NS, 'g');
    node.setAttribute('class', 'load-bubble');
    const plate = document.createElementNS(SVG_NS, 'rect');
    plate.setAttribute('class', 'load-bubble-plate');
    plate.setAttribute('height', '20');
    plate.setAttribute('y', '-10');
    const sign = document.createElementNS(SVG_NS, 'g');
    const icon = document.createElementNS(SVG_NS, 'image');
    icon.setAttribute('width', '16');
    icon.setAttribute('height', '16');
    icon.setAttribute('y', '-8');
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'load-bubble-label');
    label.setAttribute('y', '3');
    node.append(plate, sign, icon, label);
    hide(node);
    layer.group.appendChild(node);
    pool.push({ node, plate, sign, icon, label, key: null });
  }
  return pool;
}

/** Set a bubble's contents. Only when the load it shows changes. */
function fillBubble(entry, job, icons) {
  const key = `${job.action}:${job.goodId}`;
  if (entry.key === key) return;
  entry.key = key;

  const icon = icons?.get(job.goodId);
  const inner = icon ? 16 : Math.max(12, job.goodId.length * 4);
  const width = 2 + 5 + 2 + inner + 2;
  entry.plate.setAttribute('x', String(-width / 2));
  entry.plate.setAttribute('width', String(width));

  entry.sign.replaceChildren();
  entry.sign.setAttribute('class', `load-bubble-sign ${job.action === 'pickup' ? 'plus' : 'minus'}`);
  entry.sign.setAttribute('transform', `translate(${-width / 2 + 2} -2)`);
  for (const [x, y, w, h] of SIGN_RECTS[job.action] ?? []) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(h));
    entry.sign.appendChild(r);
  }

  const left = -width / 2 + 9;
  if (icon) {
    entry.icon.setAttribute('href', icon.href);
    entry.icon.setAttribute('x', String(left));
    entry.icon.style.display = '';
    entry.label.style.display = 'none';
  } else {
    entry.icon.style.display = 'none';
    entry.label.style.display = '';
    entry.label.setAttribute('x', String(left));
    entry.label.textContent = job.goodId;
  }
}

/**
 * One bubble over each porter loading or unloading: it rises off their head
 * over the time the work takes and fades as it finishes. Its life is sim time,
 * so it freezes with the clock like everything else here.
 */
function renderBubbles(layer, bubbles, icons) {
  const pool = ensureBubblePool(layer, bubbles.length);
  bubbles.forEach((b, i) => {
    const entry = pool[i];
    show(entry.node);
    fillBubble(entry, b.job, icons);
    const rise = Math.round(b.t * BUBBLE_RISE);
    entry.node.setAttribute('transform', `translate(${Math.round(b.x)} ${Math.round(b.y - 10 - rise)})`);
    const fade = b.t < BUBBLE_FADE_FROM ? 1 : 1 - (b.t - BUBBLE_FADE_FROM) / (1 - BUBBLE_FADE_FROM);
    entry.node.style.opacity = fade.toFixed(2);
  });
  for (let i = bubbles.length; i < pool.length; i++) hide(pool[i].node);
}

/**
 * Everyone inside the buildings. A room that is dark or broken is empty.
 *
 * The crew are the roles the catalogue says work there. A room's staging in
 * the manifest (`figures.rooms`, see crew.js) can pin its first people to
 * posts, pick the clip a role works with there, and cap how many are drawn;
 * everyone not on a post works in their own lane and now and then walks to
 * another spot in it. The school adds its pupils and the auditorium its
 * audience, both while the room has staff to run it.
 */
function renderSpriteWorkers(layer, state, ctx, t, viewport, art) {
  const placements = [];
  const stages = art.stages ?? new Map();

  for (const instance of state.buildings) {
    if (!isLevelVisible(viewport, instance.level)) continue;
    if (instance.powered === false || instance.brokenDown === true) continue; // nobody working

    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;

    // A porter station shows the porters waiting in it, not a crew.
    const stage = def.porterStation ? null : stages.get(def.id);
    let count = def.porterStation ? idlePorters(state, instance) : workerFigureCount(instance, def);
    if (stage?.crew != null) count = Math.min(count, stage.crew);
    if (count === 0) continue;

    const roles = def.porterStation ? ['porter'] : rolesForBuilding(def, ctx);
    const rect = roomRect(instance, state.buildings);
    const floor = rect.y + (art.rooms.get(def.id)?.floorY ?? FLOOR_Y);
    const posts = stage?.posts ?? [];
    const key = instance.instanceId;

    // Posts take the first people; the lanes are shared by the rest.
    const wanderers = Math.max(0, count - posts.length);
    for (let i = 0; i < count; i++) {
      const post = posts[i];
      const role = post?.role ?? roles[i % roles.length];
      const clips = art.figures.get(role);
      if (!clips) continue;
      const working = post?.clip ? clips[post.clip] ?? workClip(clips, stage, role) : workClip(clips, stage, role);
      const who = `${key}:${i}`;

      if (post) {
        placements.push({ clip: working, x: rect.x + post.x, y: floor, facing: post.facing ?? 1, key: who, role });
        continue;
      }
      const lane = laneOf(rect, i - posts.length, wanderers);
      const at = wanderAt(who, lane, t);
      const clip = at.walking ? clips.walk ?? working : working;
      placements.push({ clip, x: at.x, y: floor, facing: at.facing, key: who, role });
    }

    if (stage?.pupils) {
      const { role, clip, at, seatY } = stage.pupils;
      const clips = art.figures.get(role);
      const n = pupilCount(at.length, state.population.cohorts?.children);
      for (const seat of clips?.[clip] ? fillOrder(`${key}:desk`, at, n) : []) {
        placements.push({ clip: clips[clip], x: rect.x + seat.x, y: seatY != null ? rect.y + seatY : floor, facing: 1, key: `${key}:p${seat.i}`, role });
      }
    }

    if (stage?.audience) {
      const { roles: seated, clip, at, seatY } = stage.audience;
      const n = audienceSize(at.length, state.population.labour);
      for (const seat of fillOrder(`${key}:seat`, at, n)) {
        const who = `${key}:a${seat.i}`;
        const role = seated[Math.floor(visualJitter(`${who}:role`) * seated.length)];
        const clips = art.figures.get(role);
        if (!clips?.[clip]) continue;
        // Seen from behind, a mirrored back is just another back: flip half
        // of them so a full row is not one person repeated.
        const facing = visualJitter(`${who}:face`) < 0.5 ? -1 : 1;
        placements.push({ clip: clips[clip], x: rect.x + seat.x, y: rect.y + seatY, facing, key: who, role });
      }
    }
  }

  const pool = ensureSpritePool(layer, layer.workers, placements.length, 'figure figure-worker');

  placements.forEach((spot, i) => {
    const entry = pool[i];
    show(entry.node);
    setClip(entry, spot.clip, spot.role);
    placeSprite(entry, spot.clip, spot.x, spot.y, spot.facing);
    // Loop phase is hashed from the person, so a room's workers are never in
    // lockstep and a figure never twitches between frames.
    entry.strip.style.setProperty('--phase', `${(visualJitter(spot.key) * -2.4).toFixed(2)}s`);
  });

  for (let i = placements.length; i < pool.length; i++) hide(pool[i].node);
}
