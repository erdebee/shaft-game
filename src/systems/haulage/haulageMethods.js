/**
 * haulageMethods.js
 * Vertical movement of stock resources between levels, by assigned porters.
 * Three methods, defined in catalog/infrastructure/haulage.json: the stairwell
 * (slow, free, fatiguing), the freight elevator (fast, costs power per trip,
 * breaks down) and the dumbwaiter (medium, small loads only).
 *
 * Distance in levels equals labour time, so placement is permanent policy: a
 * hydroponics bay twenty levels from the canteen burns porter-hours every day,
 * forever.
 *
 * Emits trips rather than moving goods instantaneously. A trip is a record with
 * a route and a tick window — which is what makes haul latency real, and what
 * the view layer interpolates to animate a porter between levels. See
 * src/ui/view/interpolate.js; the view never writes back here.
 *
 * SLICE SCOPE: one route (a producer to its consumer) proves the trip layer
 * end to end. General queue resolution against per-method capacity comes with
 * the resources system.
 */

import { clamp } from '../../utils/math.js';
import { idleWorker } from '../population/roster.js';

export function tick(state, ctx) {
  arriveTrips(state, ctx);
  dispatchTrips(state, ctx);
}

/**
 * Complete trips whose arrival tick has come: deliver the cargo, free the
 * porter, and charge the fatigue for the distance actually walked.
 */
function arriveTrips(state, ctx) {
  const arrived = state.haulage.trips.filter((t) => t.arriveTick <= state.clock.tick);
  if (arrived.length === 0) return;

  for (const trip of arrived) {
    state.resources.stocks[trip.cargo.id] =
      (state.resources.stocks[trip.cargo.id] ?? 0) + trip.cargo.qty;

    const worker = state.population.workers.find((w) => w.id === trip.workerId);
    if (worker) {
      const method = ctx.catalog.haulage.byId[trip.method];
      const distance = Math.abs(trip.toLevel - trip.fromLevel);
      worker.fatigue = clamp(worker.fatigue + distance * (method?.fatiguePerLevel ?? 0), 0, 1);
      worker.levelsWalked += distance;
      worker.level = trip.toLevel;
      worker.tripId = null;
    }

    ctx.emit('haulage:arrived', {
      tripId: trip.id,
      cargo: trip.cargo,
      toLevel: trip.toLevel,
      workerId: trip.workerId,
    });
  }

  state.haulage.trips = state.haulage.trips.filter((t) => t.arriveTick > state.clock.tick);
}

/**
 * Start new trips for any outstanding route demand, while porters are free.
 * A route is only served when its source has cargo to move, so an empty
 * hydroponics bay produces no porters — the stairwell going quiet is itself
 * information.
 */
function dispatchTrips(state, ctx) {
  for (const route of routesFor(state, ctx)) {
    const stock = state.resources.stocks[route.cargoId] ?? 0;
    if (stock < route.qty) continue;

    const worker = idleWorker(state, 'porter');
    if (!worker) return; // no porters free; the rest of the routes wait

    const method = pickMethod(state, ctx, route);
    if (!method) continue;

    // Cargo leaves the source stock now and reappears on arrival. Goods in
    // transit are genuinely unavailable, which is the point of modelling trips.
    state.resources.stocks[route.cargoId] = stock - route.qty;

    const distance = Math.abs(route.toLevel - route.fromLevel);
    const ticks = Math.max(1, Math.round(distance * method.ticksPerLevel));

    const trip = {
      id: `t${state.haulage.nextTripId}`,
      method: method.id,
      workerId: worker.id,
      fromLevel: route.fromLevel,
      toLevel: route.toLevel,
      cargo: { id: route.cargoId, qty: route.qty },
      startTick: state.clock.tick,
      arriveTick: state.clock.tick + ticks,
    };
    state.haulage.nextTripId += 1;
    state.haulage.trips.push(trip);
    worker.tripId = trip.id;

    ctx.emit('haulage:departed', { tripId: trip.id, ...route, method: method.id });
  }
}

/**
 * Routes to serve this tick. Derived from placed buildings: anything that
 * produces a haulable stock feeds the nearest building that consumes it.
 *
 * Recomputed each tick rather than cached, so demolishing a canteen stops the
 * porters without any bookkeeping.
 */
export function routesFor(state, ctx) {
  const routes = [];

  for (const source of state.buildings) {
    const sourceDef = ctx.catalog.buildings.byId[source.buildingId];
    if (!sourceDef || source.powered === false) continue;

    for (const produced of sourceDef.produces ?? []) {
      const stockDef = ctx.catalog.stocks.byId[produced.id];
      if (!stockDef?.haulable) continue;

      const sink = nearestConsumer(state, ctx, produced.id, source.level);
      if (!sink || sink.level === source.level) continue;

      routes.push({
        cargoId: produced.id,
        qty: Math.max(1, Math.round(produced.qty)),
        fromLevel: source.level,
        toLevel: sink.level,
      });
    }
  }

  // Sorted so dispatch order never depends on placement order.
  return routes.sort(
    (a, b) => a.cargoId.localeCompare(b.cargoId) || a.fromLevel - b.fromLevel || a.toLevel - b.toLevel,
  );
}

function nearestConsumer(state, ctx, resourceId, fromLevel) {
  const candidates = state.buildings
    .filter((b) => {
      const def = ctx.catalog.buildings.byId[b.buildingId];
      return (def?.consumes ?? []).some((c) => c.id === resourceId);
    })
    .sort(
      (a, b) =>
        Math.abs(a.level - fromLevel) - Math.abs(b.level - fromLevel) ||
        a.instanceId.localeCompare(b.instanceId),
    );
  return candidates[0] ?? null;
}

/**
 * The best available method for a route. Mechanised methods need their
 * building placed and the grid up; the stairwell always works, which is why
 * it is the floor rather than an option.
 */
export function pickMethod(state, ctx, route) {
  const preference = ['freight-elevator', 'dumbwaiter', 'stairwell'];

  for (const id of preference) {
    const method = ctx.catalog.haulage.byId[id];
    if (!method) continue;
    if (route.qty > method.capacityPerTrip) continue;

    if (method.requiresBuilding) {
      const machines = state.buildings.filter(
        (b) => b.buildingId === method.requiresBuilding && b.powered !== false && !b.brokenDown,
      );
      if (machines.length === 0) continue;

      // One car per machine. This is what 'limited-cars' means, and it is what
      // sends the overflow down the stairwell — which is why a Shaft with a
      // single elevator still has people walking.
      if (method.concurrentTrips !== null) {
        const inUse = state.haulage.trips.filter((t) => t.method === id).length;
        if (inUse >= machines.length * method.concurrentTrips) continue;
      }
    }
    return method;
  }
  return ctx.catalog.haulage.byId['stairwell'] ?? null;
}

/** Effective throughput of a method over a distance, in units per tick. */
export function throughput(methodId, fromLevel, toLevel, ctx) {
  const method = ctx.catalog.haulage.byId[methodId];
  if (!method) return 0;
  const distance = Math.max(1, Math.abs(toLevel - fromLevel));
  const ticks = Math.max(1, distance * method.ticksPerLevel);
  return method.capacityPerTrip / ticks;
}
