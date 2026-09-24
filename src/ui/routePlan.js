/**
 * routePlan.js
 * What the route UI needs to know about a porter's route, shared by the route
 * editor (screens/routeEditor.js), the inspector's list of porters calling at
 * a building (screens/inspect.js), the route drawn in the shaft
 * (view/shaftView.js) and on the minimap (view/shaftScroll.js).
 *
 * A route is a loop, so it is drawn as SEGMENTS: stop i to stop i + 1, and the
 * last back to the first. Each segment has its own colour, the same colour in
 * the panel, in the shaft and on the minimap, so one leg of the loop can be
 * followed from one to the other.
 *
 * Pure: reads state, returns plain values. Changing a route is a
 * player:setRoute command, which the callers dispatch.
 */

import { amount, capacity, inputsOf, outputsOf, isStorage } from '../systems/resources/stores.js';

/** How many distinct segment colours there are (tokens.css, --route-N). */
export const ROUTE_COLORS = 8;

/** The colour of segment i: the leg from stop i to the stop after it. */
export function segmentColor(i) {
  return `var(--route-${(i % ROUTE_COLORS) + 1})`;
}

/**
 * The legs of a route, between standing buildings. A stop whose building is
 * gone is skipped, as the porter skips it. A route of one stop has no legs.
 */
export function segmentsOf(state, route) {
  const standing = [];
  route.forEach((stop, i) => {
    const building = state.buildings.find((b) => b.instanceId === stop.instanceId);
    if (building) standing.push({ i, building });
  });
  if (standing.length < 2) return [];
  return standing.map((from, k) => {
    const to = standing[(k + 1) % standing.length];
    return { i: from.i, to: to.i, from: from.building, target: to.building, color: segmentColor(from.i), back: k === standing.length - 1 };
  });
}

/** The route with a stop inserted before position `index` (0 = first). */
export function insertStop(route, index, stop) {
  const next = [...route];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, stop);
  return next;
}

export function removeStop(route, index) {
  return route.filter((_, k) => k !== index);
}

/**
 * Every porter whose route calls at a building, and what they do there: the
 * goods they bring (drop off) and the goods they take away (pick up).
 */
export function visitorsOf(state, instanceId) {
  const out = [];
  for (const porter of state.population.workers) {
    if (porter.job !== 'porter' || !porter.route?.length) continue;
    const here = porter.route.map((stop, i) => ({ ...stop, i })).filter((s) => s.instanceId === instanceId);
    if (!here.length) continue;
    const goods = (action) => [...new Set(here.filter((s) => s.action === action).map((s) => s.goodId))];
    out.push({ porter, stops: here.map((s) => s.i), brings: goods('dropoff'), takes: goods('pickup') });
  }
  return out;
}

/**
 * The stop a building most likely means. A building with goods to collect:
 * pick up the one it holds most of. Otherwise one that needs goods: drop off
 * the one it is shortest of. A depot or storehouse: drop off what the route
 * already picks up elsewhere, or else pick up what it holds most of.
 *
 * Never null: a building with nothing to move gets a pick-up of the first good
 * it could hold, which the player then changes.
 */
export function stopFor(state, ctx, building, route) {
  const def = ctx.catalog.buildings.byId[building.buildingId];
  const base = { instanceId: building.instanceId, qty: 'all' };
  const most = (ids) => [...ids].sort((a, b) => amount(building, b) - amount(building, a))[0];

  if (isStorage(def)) {
    const carried = route.filter((s) => s.action === 'pickup' && s.instanceId !== building.instanceId).map((s) => s.goodId);
    if (carried.length) return { ...base, action: 'dropoff', goodId: carried.at(-1) };
    const held = Object.keys(building.stock ?? {});
    if (held.length) return { ...base, action: 'pickup', goodId: most(held) };
  } else {
    const outputs = outputsOf(def, ctx);
    if (outputs.size) return { ...base, action: 'pickup', goodId: most(outputs) };
    const inputs = [...inputsOf(def, ctx), ...Object.keys(def.storeCapacity ?? {})];
    if (inputs.length) {
      const fill = (id) => amount(building, id) / Math.max(1e-9, capacity(building, def, ctx, id));
      return { ...base, action: 'dropoff', goodId: inputs.sort((a, b) => fill(a) - fill(b))[0] };
    }
  }
  return { ...base, action: 'pickup', goodId: goodsFor(ctx, building)[0] ?? ctx.catalog.stocks.ids[0] };
}

/** Goods worth offering for a stop at this building, `current` first if given. */
export function goodsFor(ctx, building, current = null) {
  const ids = new Set(current ? [current] : []);
  const def = building && ctx.catalog.buildings.byId[building.buildingId];
  if (def) {
    if (isStorage(def)) {
      for (const id of [...ctx.catalog.stocks.ids, ...ctx.catalog.components.ids, ...ctx.catalog.minerals.ids]) ids.add(id);
    } else {
      for (const id of inputsOf(def, ctx)) ids.add(id);
      for (const id of outputsOf(def, ctx)) ids.add(id);
      for (const id of Object.keys(def.storeCapacity ?? {})) ids.add(id);
    }
  }
  return [...ids];
}

/** Levels that have a building on them, top first. */
export function builtLevels(state) {
  return [...new Set(state.buildings.map((b) => b.level))].sort((a, b) => a - b);
}

/** The buildings on a level, left to right. */
export function buildingsOn(state, level) {
  return state.buildings.filter((b) => b.level === level).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}
