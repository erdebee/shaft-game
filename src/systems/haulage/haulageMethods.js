/**
 * haulageMethods.js
 * The `haulage` system: porters, and nothing but porters, move goods between
 * buildings' stores (systems/resources/stores.js).
 *
 * A porter works a ROUTE the player sets: a loop of stops, each naming a
 * building, an action (pick up or drop off), a good, and a quantity ('all',
 * or a number per visit). The porter walks the stairwell to the stop's level,
 * does what the stop says, and goes on to the next; after the last stop, the
 * first again. A pick-up takes what is there, up to the quantity and the room
 * in the porter's arms; a drop-off leaves what the building has room for and
 * carries the rest on. A stop at a building that is gone is skipped.
 *
 * A porter with no route goes back to their station and waits there. A porter
 * worn out (haulage.porterRestAt) walks back to the station to rest, and
 * picks the route up where they left it once rested (fatigue recovers while
 * standing — population/roster.js).
 *
 * A porter stands somewhere: in a room (`at`, an instance id) on a level.
 * Getting from one room to another is a TRIP: along the floor to the
 * stairwell, up or down it, and along the other floor into the room — or,
 * on the same level, just along the floor. The trip keeps each LEG and how
 * long it takes, which is what the view interpolates to draw the porter
 * walking (src/ui/view/interpolate.js). The view never writes back here.
 *
 * Floors are measured in slots from the stairhead: a room's middle is at
 * slot + slots / 2, and the stairhead is 0.
 *
 * At a stop, loading or unloading takes time (haulage.handleTicks, plus
 * haulage.handlePerTick units a tick): the goods change hands at once, and
 * the porter then stands at the room until the work is done. `handling`
 * says what they are doing, for the panel and the bubble over their head.
 *
 * The freight elevator and dumbwaiter carry nothing yet: lift cars come with
 * their own art, and until then every porter walks.
 *
 * Owns state.haulage and each porter's level, route position, load and
 * fatigue from walking.
 */

import { clamp } from '../../utils/math.js';
import { amount, put, take } from '../resources/stores.js';

export function tick(state, ctx) {
  arriveTrips(state, ctx);
  for (const porter of porters(state)) {
    if (porter.tripId === null) act(state, ctx, porter);
  }
}

/** Every porter, in hire order: the order they act in within a tick. */
export function porters(state) {
  return state.population.workers.filter((w) => w.job === 'porter');
}

/** The station a porter belongs to, if it still stands. */
export function stationOf(state, porter) {
  return state.buildings.find((b) => b.instanceId === porter.stationId) ?? null;
}

/** Units a porter is carrying, across all goods. */
export function load(porter) {
  let sum = 0;
  for (const qty of Object.values(porter.carrying ?? {})) sum += qty;
  return sum;
}

/**
 * What a porter is doing, for the panel: 'walking', 'loading', 'unloading',
 * 'resting', 'idle' (no route), or 'working' (at a stop).
 */
export function porterStatus(state, porter) {
  if (porter.tripId !== null) return 'walking';
  if (porter.handling) return porter.handling.action === 'pickup' ? 'loading' : 'unloading';
  if (porter.resting) return 'resting';
  if (!porter.route?.length) return 'idle';
  return 'working';
}

/**
 * Check a route before it is set. Each stop needs a standing building, an
 * action, a physical good, and 'all' or a positive quantity. Returns the
 * cleaned stops, or null if any stop is malformed.
 */
export function validRoute(state, ctx, stops) {
  if (!Array.isArray(stops)) return null;
  const out = [];
  for (const stop of stops) {
    if (!state.buildings.some((b) => b.instanceId === stop?.instanceId)) return null;
    if (stop.action !== 'pickup' && stop.action !== 'dropoff') return null;
    const good = ctx.catalog.stocks.byId[stop.goodId] || ctx.catalog.minerals.byId[stop.goodId] || ctx.catalog.components.byId[stop.goodId];
    if (!good) return null;
    if (stop.qty !== 'all' && !(Number.isFinite(stop.qty) && stop.qty > 0)) return null;
    out.push({ instanceId: stop.instanceId, action: stop.action, goodId: stop.goodId, qty: stop.qty });
  }
  return out;
}

/** Complete trips whose arrival tick has come. */
function arriveTrips(state, ctx) {
  const arrived = state.haulage.trips.filter((t) => t.arriveTick <= state.clock.tick);
  if (arrived.length === 0) return;
  const method = ctx.catalog.haulage.byId.stairwell;

  for (const trip of arrived) {
    const porter = state.population.workers.find((w) => w.id === trip.workerId);
    if (!porter) continue;
    const distance = Math.abs(trip.toLevel - trip.fromLevel);
    porter.fatigue = clamp(porter.fatigue + distance * (method?.fatiguePerLevel ?? 0), 0, 1);
    porter.levelsWalked += distance;
    porter.level = trip.toLevel;
    porter.at = trip.toId;
    porter.tripId = null;
  }
  state.haulage.trips = state.haulage.trips.filter((t) => t.arriveTick > state.clock.tick);
}

/** One porter's decision for this tick: rest, go home, walk on, or work a stop. */
function act(state, ctx, porter) {
  const cfg = ctx.config.haulage;
  const station = stationOf(state, porter);

  if (porter.handling) {
    if (state.clock.tick < porter.handling.untilTick) return;
    porter.handling = null;
  }

  if (porter.resting) {
    if (porter.fatigue > cfg.porterRestedAt) return;
    porter.resting = false;
  }
  if (porter.fatigue >= cfg.porterRestAt) {
    porter.resting = true;
    if (station && porter.at !== station.instanceId) walk(state, ctx, porter, station);
    return;
  }

  const route = porter.route ?? [];
  if (route.length === 0) {
    if (station && porter.at !== station.instanceId) walk(state, ctx, porter, station);
    return;
  }

  // Skip stops at buildings that are gone, but never loop forever on a route
  // whose every stop is gone.
  for (let tries = 0; tries < route.length; tries++) {
    const stop = route[porter.stop % route.length];
    const building = state.buildings.find((b) => b.instanceId === stop.instanceId);
    if (!building) {
      porter.stop = (porter.stop + 1) % route.length;
      continue;
    }
    if (porter.at !== building.instanceId) {
      walk(state, ctx, porter, building);
      return;
    }
    work(state, ctx, porter, stop, building);
    porter.stop = (porter.stop + 1) % route.length;
    return;
  }
}

/** Do what a stop says, at the building the porter is standing at. */
function work(state, ctx, porter, stop, building) {
  const def = ctx.catalog.buildings.byId[building.buildingId];
  porter.carrying ??= {};
  const limit = stop.qty === 'all' ? Infinity : stop.qty;
  let moved = 0;

  if (stop.action === 'pickup') {
    const space = ctx.config.haulage.porterCapacity - load(porter);
    const taken = take(building, stop.goodId, Math.min(limit, space));
    if (taken > 0) {
      porter.carrying[stop.goodId] = (porter.carrying[stop.goodId] ?? 0) + taken;
      moved = taken;
      ctx.emit('haulage:pickup', { workerId: porter.id, instanceId: building.instanceId, goodId: stop.goodId, qty: taken });
    }
  } else {
    const held = porter.carrying[stop.goodId] ?? 0;
    const given = put(building, def, ctx, stop.goodId, Math.min(limit, held));
    if (given > 0) {
      porter.carrying[stop.goodId] = held - given;
      moved = given;
      if (porter.carrying[stop.goodId] <= 1e-9) delete porter.carrying[stop.goodId];
      ctx.emit('haulage:dropoff', { workerId: porter.id, instanceId: building.instanceId, goodId: stop.goodId, qty: given });
    }
  }

  // Nothing to move is a glance, not a job: the porter goes straight on.
  if (moved > 0) {
    const cfg = ctx.config.haulage;
    const startTick = state.clock.tick;
    porter.handling = {
      instanceId: building.instanceId,
      action: stop.action,
      goodId: stop.goodId,
      qty: moved,
      startTick,
      untilTick: startTick + Math.max(1, Math.ceil(cfg.handleTicks + moved / cfg.handlePerTick)),
    };
  }
}

/** Where on its level's floor a room's middle is, in slots from the stairhead. */
export function floorPos(building) {
  return (building?.slot ?? 0) + (building?.slots ?? 1) / 2;
}

/**
 * Start a walk to a building: along this floor to the stairhead, up or down
 * the stairwell, and along that floor to the room — or straight along the
 * floor, if it is on this level. Only the stairs tire a porter.
 */
function walk(state, ctx, porter, target) {
  const method = ctx.catalog.haulage.byId.stairwell;
  const perSlot = ctx.config.haulage.floorTicksPerSlot;
  const perLevel = method?.ticksPerLevel ?? 2;
  const here = state.buildings.find((b) => b.instanceId === porter.at);
  const from = here ? floorPos(here) : 0;
  const to = floorPos(target);
  const fromId = here?.instanceId ?? null;

  const legs = [];
  const floor = (level, a, b, aId, bId) => {
    if (Math.abs(b - a) > 1e-9) legs.push({ kind: 'floor', level, from: a, to: b, fromId: aId, toId: bId, ticks: Math.abs(b - a) * perSlot });
  };
  if (target.level === porter.level) {
    floor(porter.level, from, to, fromId, target.instanceId);
  } else {
    floor(porter.level, from, 0, fromId, null);
    legs.push({ kind: 'stair', from: porter.level, to: target.level, ticks: Math.abs(target.level - porter.level) * perLevel });
    floor(target.level, 0, to, null, target.instanceId);
  }
  const span = legs.reduce((sum, leg) => sum + leg.ticks, 0);

  const trip = {
    id: `t${state.haulage.nextTripId}`,
    method: 'stairwell',
    workerId: porter.id,
    fromLevel: porter.level,
    toLevel: target.level,
    toId: target.instanceId,
    legs,
    cargo: { ...(porter.carrying ?? {}) },
    startTick: state.clock.tick,
    arriveTick: state.clock.tick + Math.max(1, Math.round(span)),
  };
  state.haulage.nextTripId += 1;
  state.haulage.trips.push(trip);
  porter.tripId = trip.id;
}

/** What a stop would move right now — for the route editor's preview. */
export function stopAvailable(state, stop) {
  const building = state.buildings.find((b) => b.instanceId === stop.instanceId);
  return building ? amount(building, stop.goodId) : 0;
}
