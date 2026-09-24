/**
 * routeEditor.js
 * A porter's route, as a column of stops the player edits in place.
 *
 * Each stop names its building by floor and then by building on that floor,
 * and says what to do there: the action, the good and how much, on a slider.
 * A pick-up's slider runs from nothing to the most it could ever be — the
 * smaller of what the building can hold of that good and what the porter can
 * carry — with the top end meaning "all of it". A drop-off's slider is a
 * percentage of what the porter is carrying of that good when they arrive,
 * so one load can be split between several rooms. The porter's load against
 * what they can carry is shown at the top. Between
 * the stops runs the route itself — a line in the colour that leg has in the
 * shaft and on the minimap (routePlan.segmentColor), flowing the way the
 * porter walks it — and on every gap, and above the first stop, a + that
 * opens a new stop in that place. The last line runs back to the first stop,
 * because a route is a loop.
 *
 * While the editor is open, a click on a building in the shaft offers to add
 * it at a position of the player's choosing (view/routeLayer.js).
 *
 * Every change goes through player:setRoute, so a route is part of the
 * command log like everything else. A stop being picked — a floor chosen but
 * no building yet — is the editor's own, and reaches the route only once it
 * names a building.
 */

import * as selection from '../selection.js';
import { el, button } from '../components/dom.js';
import { amount, capacity, nameOf } from '../../systems/resources/stores.js';
import { render as renderMeter } from '../components/resourceMeter.js';
import { porterStatus, load } from '../../systems/haulage/haulageMethods.js';
import {
  segmentColor, insertStop, removeStop, stopFor, goodsFor, builtLevels, buildingsOn,
} from '../routePlan.js';

export function mount(host, state, ctx, dispatch, workerId) {
  host.replaceChildren();
  const porter = () => state.population.workers.find((w) => w.id === workerId);
  const who = porter();

  const head = el('div', 'build-head');
  head.append(el('h2', '', `Route · ${who?.name ?? 'porter'}`), button('Done', 'Finish editing the route', () => selection.editRoute(null), 'text-button'));
  const status = el('div', 'inspect-status');
  host.append(head, status);
  const carryCap = ctx.config.haulage.porterCapacity;
  const loadMeter = renderMeter(host, { label: `Carrying · can carry up to ${carryCap}` });
  const hint = el('div', 'meter-label', 'Click a building in the Shaft to add it, or + to add a stop in that place.');
  const list = el('ol', 'route-list');
  const clearAll = button('Clear route', 'Remove every stop', () => setStops([]), 'text-button danger');
  host.append(hint, list, clearAll);

  let signature = null;
  /** Per stop row: what changes between rebuilds (the next stop, what is held). */
  let rowRefs = [];
  /**
   * A stop being picked: `insert` a new one before `index`, or re-point the
   * stop at `index` to a building on `level`.
   */
  let draft = null;

  function setStops(stops) {
    dispatch({ type: 'player:setRoute', workerId, stops });
    draft = null;
    signature = null;
  }

  function setDraft(next) {
    draft = next;
    signature = null;
  }

  function rows() {
    const current = porter();
    list.replaceChildren();
    rowRefs = [];
    if (!current) return;
    const route = current.route;

    list.appendChild(gap(null, 0));
    route.forEach((stop, i) => {
      if (draft?.insert && draft.index === i) list.appendChild(draftRow(current));
      list.appendChild(row(current, stop, i));
      const last = i === route.length - 1;
      list.appendChild(gap(route.length > 1 ? segmentColor(i) : null, i + 1, last && route.length > 1 ? 'back to stop 1' : ''));
    });
    if (draft?.insert && draft.index >= route.length) list.append(draftRow(current));
    if (route.length === 0 && !draft) list.appendChild(el('li', 'meter-label', 'No stops: this porter waits at the station.'));
  }

  /** The line between two stops, and the + that opens a stop in that gap. */
  function gap(color, index, note = '') {
    const item = el('li', 'route-gap');
    if (color) {
      const flow = el('span', 'route-flow');
      flow.dataset.part = 'flow';
      flow.style.setProperty('--seg', color);
      item.appendChild(flow);
    }
    item.appendChild(button('+', `Add a stop at position ${index + 1}`, () => setDraft({ insert: true, index, level: null }), 'route-add'));
    if (note) item.appendChild(el('span', 'meter-label route-back', note));
    return item;
  }

  /** A new stop, before it has a building: floor first, then which building. */
  function draftRow(current) {
    const item = el('li', 'route-stop route-draft');
    const num = el('span', 'route-num');
    num.append(el('span', 'route-n', String(draft.index + 1)), button('✕', 'Cancel this stop', () => setDraft(null), 'route-remove'));
    const pick = placePicker(draft.level, null, (level) => {
      const here = buildingsOn(state, level);
      if (here.length === 1) setStops(insertStop(current.route, draft.index, stopFor(state, ctx, here[0], current.route)));
      else setDraft({ ...draft, level });
    }, (building) => setStops(insertStop(current.route, draft.index, stopFor(state, ctx, building, current.route))));
    item.append(num, pick, el('span', 'meter-label route-held', 'Choose a floor, then a building.'));
    return item;
  }

  function row(current, stop, i) {
    const building = state.buildings.find((b) => b.instanceId === stop.instanceId);
    const item = el('li', 'route-stop');
    if (current.route.length > 1) item.style.setProperty('--seg', segmentColor(i));

    const num = el('span', 'route-num');
    num.append(el('span', `route-n route-${stop.action}`, String(i + 1)), button('✕', `Remove stop ${i + 1}`, () => setStops(removeStop(current.route, i)), 'route-remove'));

    // Re-pointing a stop at another building keeps what it does there when
    // that building deals in the same good, and guesses afresh when not.
    const repoint = (target) => {
      const keep = goodsFor(ctx, target).includes(stop.goodId);
      const next = keep ? { ...stop, instanceId: target.instanceId } : stopFor(state, ctx, target, current.route);
      const stops = [...current.route];
      stops[i] = next;
      setStops(stops);
    };
    const editingHere = draft && !draft.insert && draft.index === i;
    const level = editingHere ? draft.level : building?.level ?? null;
    const pick = placePicker(level, editingHere ? null : building, (lvl) => {
      if (lvl === building?.level) return setDraft(null);
      const here = buildingsOn(state, lvl);
      if (here.length === 1) repoint(here[0]);
      else setDraft({ insert: false, index: i, level: lvl });
    }, repoint);

    const action = el('select', 'inspect-select');
    action.append(new Option('pick up', 'pickup'), new Option('drop off', 'dropoff'));
    action.value = stop.action;
    action.setAttribute('aria-label', 'Action');

    const good = el('select', 'inspect-select');
    for (const id of goodsFor(ctx, building, stop.goodId)) good.appendChild(new Option(nameOf(ctx, id).toLowerCase(), id));
    good.value = stop.goodId;
    good.setAttribute('aria-label', 'Good');

    const commit = (next) => {
      const stops = [...current.route];
      stops[i] = next;
      setStops(stops);
    };
    // A new action starts from its whole: pick up all, drop off everything
    // carried. A new good keeps the amount.
    const change = () => commit(action.value === stop.action
      ? { ...stop, goodId: good.value }
      : { instanceId: stop.instanceId, action: action.value, goodId: good.value, qty: 'all' });
    action.addEventListener('change', change);
    good.addEventListener('change', change);
    const howMuch = amountControl(stop, building, (patch) => {
      const next = { instanceId: stop.instanceId, action: stop.action, goodId: stop.goodId, ...patch };
      commit(next);
    });

    const move = (d) => {
      const stops = [...current.route];
      const j = i + d;
      if (j < 0 || j >= stops.length) return;
      [stops[i], stops[j]] = [stops[j], stops[i]];
      setStops(stops);
    };
    const controls = el('span', 'route-controls');
    controls.append(button('▲', 'Move stop earlier', () => move(-1)), button('▼', 'Move stop later', () => move(1)));

    const what = el('span', 'route-what');
    what.append(action, good);
    const held = el('span', 'meter-label route-held', building ? '' : 'this building is gone');
    item.append(num, pick, controls, what, howMuch, held);
    rowRefs.push({ item, i, held, building, goodId: stop.goodId });
    return item;
  }

  /**
   * How much a stop moves, as a slider. A pick-up: 0 up to the most it could
   * ever take here, the top meaning all. A drop-off: the percentage of what
   * the porter carries of the good on arrival. The readout follows the thumb;
   * the route changes when it is let go.
   */
  function amountControl(stop, building, onCommit) {
    const wrap = el('label', 'route-amount');
    const slider = el('input', 'route-slider');
    slider.type = 'range';
    const readout = el('span', 'route-amount-value');
    let show;
    let patch;
    if (stop.action === 'dropoff') {
      slider.min = '0';
      slider.max = '100';
      slider.step = '5';
      slider.value = String(Math.round((stop.share ?? 1) * 100));
      slider.setAttribute('aria-label', 'Share of what the porter carries to leave here');
      show = () => { readout.textContent = `leave ${slider.value}% of load`; };
      patch = () => (slider.value === '100' ? { qty: 'all' } : { qty: 'all', share: Number(slider.value) / 100 });
    } else {
      const def = building && ctx.catalog.buildings.byId[building.buildingId];
      const held = def ? capacity(building, def, ctx, stop.goodId) : 0;
      const max = Math.max(1, Math.round(held > 0 ? Math.min(held, carryCap) : carryCap));
      slider.min = '0';
      slider.max = String(max);
      slider.step = '1';
      slider.value = String(stop.qty === 'all' ? max : Math.min(stop.qty, max));
      slider.setAttribute('aria-label', 'How much to pick up per visit');
      wrap.title = `At most ${max}: the smaller of what this building holds of it (${Math.round(held)}) and what the porter can carry (${carryCap})`;
      show = () => { readout.textContent = Number(slider.value) >= max ? `take all · up to ${max}` : `take ${slider.value} of ${max}`; };
      patch = () => (Number(slider.value) >= max ? { qty: 'all' } : { qty: Number(slider.value) });
    }
    show();
    slider.addEventListener('input', show);
    slider.addEventListener('change', () => onCommit(patch()));
    wrap.append(slider, readout);
    return wrap;
  }

  /**
   * Floor, then building on that floor. `building` is the one chosen, or
   * null while the floor is picked but the building is not.
   */
  function placePicker(level, building, onLevel, onBuilding) {
    const pick = el('span', 'route-pick');
    const floor = el('select', 'inspect-select route-floor');
    floor.setAttribute('aria-label', 'Floor');
    if (level === null) floor.appendChild(new Option('Floor…', ''));
    for (const l of builtLevels(state)) floor.appendChild(new Option(`L${l}`, String(l)));
    floor.value = level === null ? '' : String(level);
    floor.addEventListener('change', () => { if (floor.value) onLevel(Number(floor.value)); });

    const room = el('select', 'inspect-select route-room');
    room.setAttribute('aria-label', 'Building');
    const here = level === null ? [] : buildingsOn(state, level);
    if (!building) room.appendChild(new Option(level === null ? '—' : 'Building…', ''));
    const named = new Map();
    for (const b of here) {
      const name = ctx.catalog.buildings.byId[b.buildingId]?.name ?? b.buildingId;
      const n = (named.get(name) ?? 0) + 1;
      named.set(name, n);
      room.appendChild(new Option(n > 1 ? `${name} ${n}` : name, b.instanceId));
    }
    room.disabled = here.length === 0;
    room.value = building?.instanceId ?? '';
    room.addEventListener('change', () => {
      const target = state.buildings.find((b) => b.instanceId === room.value);
      if (target && target !== building) onBuilding(target);
    });
    pick.append(floor, room);
    return pick;
  }

  return {
    update() {
      const current = porter();
      if (!current) {
        status.textContent = 'This porter is gone.';
        list.replaceChildren();
        return;
      }
      // A select the player has open, or a slider being dragged, would be lost
      // under a rebuild, so the list is rebuilt only when the route itself
      // changes. Which stop is next, and what is held, are set in place.
      const key = JSON.stringify([current.route, state.buildings.length, draft]);
      if (key !== signature) {
        signature = key;
        rows();
      }
      const next = current.stop % Math.max(1, current.route.length);
      for (const ref of rowRefs) {
        ref.item.classList.toggle('next', ref.i === next);
        if (ref.building) ref.held.textContent = `here ${Math.round(amount(ref.building, ref.goodId))}`;
      }
      status.textContent = describe(state, ctx, current);
      const carried = load(current);
      loadMeter.update(carried, carryCap, carried >= carryCap - 1e-9 ? 'warn' : 'ok', `${Math.round(carried)} / ${carryCap}`);
    },
    destroy() {},
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
