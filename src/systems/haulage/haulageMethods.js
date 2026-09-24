/**
 * haulageMethods.js
 * The `haulage` system: porters, and nothing but porters, move goods between
 * buildings' stores (systems/resources/stores.js).
 *
 * A porter works a ROUTE the player defines: a named loop of stops, kept in
 * state.haulage.routes and shared — any number of porters may be assigned to
 * one, each walking it from their own place in the loop. Each stop names a
 * building and the GOODS handled there: one or more, each with an action (pick
 * up or drop off), a good, and a quantity ('all', or a number per visit, 0
 * included). A drop-off may also carry a SHARE: the fraction, 0 to 1, of what
 * the porter holds of that good on arrival that they leave there — so a route
 * can split one load between several rooms. The porter walks the stairwell to
 * the stop's level, handles its goods one after another — every drop-off
 * before any pick-up, so what they leave makes room for what they take — and
 * goes on to the next stop; after the last stop, the first again. A pick-up
 * takes what is there, up to the quantity and the room in the porter's arms;
 * a drop-off leaves its share (all, if it has none), up to the quantity and
 * what the building has room for, and carries the rest on. A stop at a
 * building that is gone is skipped.
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
 * Owns state.haulage (trips and routes) and each porter's level, route
 * position (the stop, and the good within it), load and fatigue from walking.
 */

import { clamp } from '../../utils/math.js';
import { put, take } from '../resources/stores.js';

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

/** The route a porter is assigned to, or null. */
export function routeOf(state, porter) {
  if (porter?.routeId == null) return null;
  return state.haulage.routes.find((r) => r.id === porter.routeId) ?? null;
}

/** The stops a porter walks: their route's, or none. */
export function stopsOf(state, porter) {
  return routeOf(state, porter)?.stops ?? [];
}

/** The porters assigned to a route, in hire order. */
export function portersOn(state, routeId) {
  return porters(state).filter((w) => w.routeId === routeId);
}

/**
 * What a porter is doing, for the panel: 'walking', 'loading', 'unloading',
 * 'resting', 'idle' (no route), or 'working' (at a stop).
 */
export function porterStatus(state, porter) {
  if (porter.tripId !== null) return 'walking';
  if (porter.handling) return porter.handling.action === 'pickup' ? 'loading' : 'unloading';
  if (porter.resting) return 'resting';
  if (!stopsOf(state, porter).length) return 'idle';
  return 'working';
}

/**
 * Check a route before it is set. Each stop needs a standing building and at
 * least one good; each good an action, a physical good, and 'all' or a
 * quantity of 0 or more; a drop-off's share, if it has one, is a fraction from
 * 0 to 1. A stop in the older one-good form — its action, good and quantity
 * on the stop itself — is taken as a stop with that one good. A stop's goods
 * are kept in the order they are handled (handlingOrder), so every view of a
 * route lists them the way the porter works them. Returns the cleaned stops,
 * or null if any stop is malformed.
 */
export function validRoute(state, ctx, stops) {
  if (!Array.isArray(stops)) return null;
  const out = [];
  for (const stop of stops) {
    if (!state.buildings.some((b) => b.instanceId === stop?.instanceId)) return null;
    const goods = Array.isArray(stop.goods) ? stop.goods : [stop];
    if (goods.length === 0) return null;
    const clean = [];
    for (const item of goods) {
      const good = validItem(ctx, item);
      if (!good) return null;
      clean.push(good);
    }
    out.push({ instanceId: stop.instanceId, goods: handlingOrder({ goods: clean }) });
  }
  return out;
}

/** One good at a stop, cleaned, or null if it is malformed. */
function validItem(ctx, item) {
  if (item?.action !== 'pickup' && item?.action !== 'dropoff') return null;
  const good = ctx.catalog.stocks.byId[item.goodId] || ctx.catalog.minerals.byId[item.goodId] || ctx.catalog.components.byId[item.goodId];
  if (!good) return null;
  if (item.qty !== 'all' && !(Number.isFinite(item.qty) && item.qty >= 0)) return null;
  const clean = { action: item.action, goodId: item.goodId, qty: item.qty };
  if (item.share !== undefined) {
    if (item.action !== 'dropoff' || !(Number.isFinite(item.share) && item.share >= 0 && item.share <= 1)) return null;
    clean.share = item.share;
  }
  return clean;
}

/** A stop's goods in the order they are handled: drop-offs, then pick-ups. */
export function handlingOrder(stop) {
  return [...stop.goods.filter((g) => g.action === 'dropoff'), ...stop.goods.filter((g) => g.action === 'pickup')];
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

  const route = stopsOf(state, porter);
  if (route.length === 0) {
    if (station && porter.at !== station.instanceId) walk(state, ctx, porter, station);
    return;
  }

  // Skip stops at buildings that are gone, and go straight on from a stop
  // whose goods are all handled, but never loop forever on a route whose
  // every stop is gone.
  for (let tries = 0; tries <= route.length; tries++) {
    const stop = route[porter.stop % route.length];
    const building = state.buildings.find((b) => b.instanceId === stop.instanceId);
    if (building && porter.at !== building.instanceId) {
      walk(state, ctx, porter, building);
      return;
    }
    if (building) {
      // One good at a time: each one moved takes its own handling time, and
      // the next is picked up when that is done.
      const goods = handlingOrder(stop);
      while ((porter.item ?? 0) < goods.length) {
        const moved = work(state, ctx, porter, goods[porter.item ?? 0], building);
        porter.item = (porter.item ?? 0) + 1;
        if (moved) return;
      }
    }
    porter.item = 0;
    porter.stop = (porter.stop + 1) % route.length;
  }
}

/**
 * Do what one good at a stop says, at the building the porter is standing
 * at. Returns how much changed hands.
 */
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
    const given = put(building, def, ctx, stop.goodId, Math.min(limit, held * (stop.share ?? 1)));
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
  return moved;
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
