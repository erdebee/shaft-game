/**
 * routeEditor.js
 * A porter's route, as a list of stops the player edits in place. While it is
 * open, clicking a building in the shaft adds that building as the next stop,
 * with a sensible guess at what to do there: pick up what it makes (the good
 * it holds most of), or drop off what it lacks most. Every stop's action,
 * good and quantity can then be changed, and stops moved or removed.
 *
 * Every change goes through player:setRoute, so a route is part of the
 * command log like everything else.
 */

import * as selection from '../selection.js';
import { el, button } from '../components/dom.js';
import { amount, capacity, inputsOf, outputsOf, isStorage } from '../../systems/resources/stores.js';
import { porterStatus, load } from '../../systems/haulage/haulageMethods.js';

export function mount(host, state, ctx, dispatch, workerId) {
  host.replaceChildren();
  const porter = () => state.population.workers.find((w) => w.id === workerId);
  const who = porter();

  const head = el('div', 'build-head');
  head.append(el('h2', '', `Route · ${who?.name ?? 'porter'}`), button('Done', 'Finish editing the route', () => selection.editRoute(null), 'text-button'));
  const status = el('div', 'inspect-status');
  const hint = el('div', 'meter-label', 'Click a building in the Shaft to add it as the next stop.');
  const list = el('ol', 'route-list');
  const clearAll = button('Clear route', 'Remove every stop', () => setStops([]), 'text-button danger');
  host.append(head, status, hint, list, clearAll);

  let signature = null;

  function setStops(stops) {
    dispatch({ type: 'player:setRoute', workerId, stops });
    signature = null;
  }

  // A click on a building while editing adds a stop rather than inspecting it.
  const unsubscribe = selection.subscribe(({ instanceId, editing }) => {
    if (editing !== workerId || !instanceId) return;
    const current = porter();
    if (!current) return;
    const building = state.buildings.find((b) => b.instanceId === instanceId);
    const stop = building && guessStop(state, ctx, building, current.route);
    if (stop) setStops([...current.route, stop]);
  });

  function rows() {
    const current = porter();
    list.replaceChildren();
    if (!current) return;
    current.route.forEach((stop, i) => list.appendChild(row(current, stop, i)));
    if (current.route.length === 0) list.appendChild(el('li', 'meter-label', 'No stops: this porter waits at the station.'));
  }

  function row(current, stop, i) {
    const building = state.buildings.find((b) => b.instanceId === stop.instanceId);
    const def = building && ctx.catalog.buildings.byId[building.buildingId];
    const item = el('li', 'route-stop');
    if (i === current.stop % Math.max(1, current.route.length)) item.classList.add('next');

    const where = el('span', 'route-where', building ? `L${building.level} ${def.name}` : '(gone)');
    const action = el('select', 'inspect-select');
    action.append(new Option('pick up', 'pickup'), new Option('drop off', 'dropoff'));
    action.value = stop.action;

    const good = el('select', 'inspect-select');
    for (const id of goodsFor(ctx, building, def, stop.goodId)) good.appendChild(new Option(id, id));
    good.value = stop.goodId;

    const qty = el('input', 'route-qty');
    qty.type = 'text';
    qty.inputMode = 'numeric';
    qty.value = stop.qty === 'all' ? 'all' : String(stop.qty);
    qty.title = '"all", or how many per visit';
    qty.setAttribute('aria-label', 'Quantity per visit');

    const change = () => {
      const n = Number(qty.value);
      const next = { ...stop, action: action.value, goodId: good.value, qty: qty.value.trim() === 'all' || !(n > 0) ? 'all' : n };
      const stops = [...current.route];
      stops[i] = next;
      setStops(stops);
    };
    action.addEventListener('change', change);
    good.addEventListener('change', change);
    qty.addEventListener('change', change);

    const move = (d) => {
      const stops = [...current.route];
      const j = i + d;
      if (j < 0 || j >= stops.length) return;
      [stops[i], stops[j]] = [stops[j], stops[i]];
      setStops(stops);
    };
    const controls = el('span', 'route-controls');
    controls.append(
      button('▲', 'Move stop earlier', () => move(-1)),
      button('▼', 'Move stop later', () => move(1)),
      button('✕', 'Remove stop', () => setStops(current.route.filter((_, k) => k !== i))),
    );

    const held = building ? ` · here ${Math.round(amount(building, stop.goodId))}` : '';
    item.append(where, controls, action, good, qty, el('span', 'meter-label route-held', held));
    return item;
  }

  return {
    update() {
      const current = porter();
      if (!current) {
        status.textContent = 'This porter is gone.';
        list.replaceChildren();
        return;
      }
      const key = JSON.stringify([current.route, current.stop % Math.max(1, current.route.length), state.buildings.length]);
      if (key !== signature) {
        signature = key;
        rows();
      }
      status.textContent = describe(state, ctx, current);
    },
    destroy() {
      unsubscribe();
    },
  };
}

/** One line on what a porter is doing right now. */
export function describe(state, ctx, porter) {
  const carrying = Object.entries(porter.carrying ?? {}).map(([id, q]) => `${Math.round(q)} ${id}`).join(', ');
  const hands = carrying ? ` · carrying ${carrying}` : '';
  const trip = state.haulage.trips.find((t) => t.id === porter.tripId);
  switch (porterStatus(state, porter)) {
    case 'walking': return `Walking to level ${trip?.toLevel ?? '?'}${hands}`;
    case 'loading': return `Loading ${Math.round(porter.handling.qty)} ${porter.handling.goodId}${hands}`;
    case 'unloading': return `Unloading ${Math.round(porter.handling.qty)} ${porter.handling.goodId}${hands}`;
    case 'resting': return `Resting (worn out ${Math.round(porter.fatigue * 100)}%)${hands}`;
    case 'idle': return `Waiting at the station — no route${hands}`;
    default: return `At level ${porter.level}, stop ${porter.stop + 1} of ${porter.route.length}${hands} · load ${Math.round(load(porter))}/${ctx.config.haulage.porterCapacity}`;
  }
}

/**
 * The stop a click on a building most likely means. A building with goods to
 * collect: pick up the one it holds most of. Otherwise one that needs goods:
 * drop off the one it is shortest of. A depot or storehouse: drop off what the
 * route already picks up elsewhere, or else pick up what it holds most of.
 */
function guessStop(state, ctx, building, route) {
  const def = ctx.catalog.buildings.byId[building.buildingId];
  const base = { instanceId: building.instanceId, qty: 'all' };
  const most = (ids) => [...ids].sort((a, b) => amount(building, b) - amount(building, a))[0];

  if (isStorage(def)) {
    const carried = route.filter((s) => s.action === 'pickup' && s.instanceId !== building.instanceId).map((s) => s.goodId);
    if (carried.length) return { ...base, action: 'dropoff', goodId: carried.at(-1) };
    const held = Object.keys(building.stock ?? {});
    return held.length ? { ...base, action: 'pickup', goodId: most(held) } : null;
  }
  const outputs = outputsOf(def, ctx);
  if (outputs.size) return { ...base, action: 'pickup', goodId: most(outputs) };
  const inputs = [...inputsOf(def, ctx), ...Object.keys(def.storeCapacity ?? {})];
  if (inputs.length) {
    const fill = (id) => amount(building, id) / Math.max(1e-9, capacity(building, def, ctx, id));
    return { ...base, action: 'dropoff', goodId: inputs.sort((a, b) => fill(a) - fill(b))[0] };
  }
  return null;
}

/** Goods worth offering for a stop at this building. */
function goodsFor(ctx, building, def, current) {
  const ids = new Set([current]);
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
