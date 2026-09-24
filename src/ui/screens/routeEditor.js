/**
 * routeEditor.js
 * A route, as a column of stops the player edits in place, under its name
 * and the porters walking it.
 *
 * Each stop names its building by floor and then by building on that floor,
 * and lists the goods handled there — as many as the player adds, each with
 * its action, the good and how much, on a slider. They are listed the way the
 * porter works them: every drop-off first, then the pick-ups.
 * A pick-up's slider runs from nothing to the most it could ever be — the
 * smaller of what the building can hold of that good and what the porter can
 * carry — with the top end meaning "all of it". A drop-off's slider is a
 * percentage of what the porter is carrying of that good when they arrive,
 * so one load can be split between several rooms. Each porter on the route
 * is listed at the top with what they are doing and what they carry; more can
 * be put on it from there. Between
 * the stops runs the route itself — a line in the colour that leg has in the
 * shaft and on the minimap (routePlan.segmentColor), flowing the way the
 * porter walks it — and on every gap, and above the first stop, a + that
 * opens a new stop in that place. The last line runs back to the first stop,
 * because a route is a loop.
 *
 * While the editor is open, a click on a building in the shaft offers to add
 * it at a position of the player's choosing (view/routeLayer.js).
 *
 * Every change goes through player:setRoute (and a new name through
 * player:renameRoute), so a route is part of the command log like everything
 * else. A stop being picked — a floor chosen but
 * no building yet — is the editor's own, and reaches the route only once it
 * names a building.
 */

import * as selection from '../selection.js';
import { el, button } from '../components/dom.js';
import { amount, capacity, nameOf } from '../../systems/resources/stores.js';
import { porterStatus, load, porters, portersOn, stopsOf } from '../../systems/haulage/haulageMethods.js';
import {
  segmentColor, insertStop, removeStop, stopFor, itemFor, stopAction, goodsFor, builtLevels, buildingsOn, pickupMax,
} from '../routePlan.js';

export function mount(host, state, ctx, dispatch, routeId) {
  host.replaceChildren();
  const route = () => state.haulage.routes.find((r) => r.id === routeId);
  const carryCap = ctx.config.haulage.porterCapacity;

  const head = el('div', 'build-head');
  const name = el('input', 'route-name');
  name.type = 'text';
  name.maxLength = 40;
  name.setAttribute('aria-label', 'Route name');
  name.value = route()?.name ?? '';
  const rename = () => {
    const current = route();
    if (!current) return;
    if (name.value.trim() && name.value.trim() !== current.name) dispatch({ type: 'player:renameRoute', routeId, name: name.value });
    name.value = route().name;
  };
  name.addEventListener('change', rename);
  name.addEventListener('keydown', (event) => { if (event.key === 'Enter') name.blur(); });
  head.append(name, button('Done', 'Finish editing the route', () => selection.editRoute(null), 'text-button'));
  const status = el('div', 'inspect-status');
  const crew = el('div', 'route-crew');
  host.append(head, status, crew);
  const hint = el('div', 'meter-label', 'Click a building in the Shaft to add it, or + to add a stop in that place.');
  const list = el('ol', 'route-list');
  const clearAll = button('Clear route', 'Remove every stop', () => setStops([]), 'text-button danger');
  host.append(hint, list, clearAll);

  let crewKey = null;
  /** Per porter on the route: the line saying what they are doing. */
  let crewRefs = [];

  let signature = null;
  /** Per stop row: what changes between rebuilds (the next stop, what is held). */
  let rowRefs = [];
  /**
   * A stop being picked: `insert` a new one before `index`, or re-point the
   * stop at `index` to a building on `level`.
   */
  let draft = null;

  function setStops(stops) {
    dispatch({ type: 'player:setRoute', routeId, stops });
    draft = null;
    signature = null;
  }

  function setDraft(next) {
    draft = next;
    signature = null;
  }

  /**
   * The porters on the route: each a button that follows them in the shaft,
   * what they are doing, and a ✕ that takes them off it; then a picker that
   * puts another porter on.
   */
  function crewRows() {
    crew.replaceChildren();
    crewRefs = [];
    for (const w of portersOn(state, routeId)) {
      const row = el('div', 'porter-row route-crew-row');
      const who = button(w.name, `Follow ${w.name} in the Shaft`, () => selection.followPorter(w.id), 'visitor-name');
      const doing = el('span', 'meter-label porter-doing');
      row.append(who, button('✕', `Take ${w.name} off this route`, () => dispatch({ type: 'player:assignRoute', workerId: w.id, routeId: null }), 'route-remove'), doing);
      crew.appendChild(row);
      crewRefs.push({ w, doing });
    }
    if (!crewRefs.length) crew.appendChild(el('div', 'meter-label', 'No porter walks this route yet.'));
    crew.appendChild(assignPicker(state, routeId, dispatch));
  }

  function rows() {
    const current = route();
    list.replaceChildren();
    rowRefs = [];
    if (!current) return;
    const stops = current.stops;

    list.appendChild(gap(null, 0));
    stops.forEach((stop, i) => {
      if (draft?.insert && draft.index === i) list.appendChild(draftRow(current));
      list.appendChild(row(current, stop, i));
      const last = i === stops.length - 1;
      list.appendChild(gap(stops.length > 1 ? segmentColor(i) : null, i + 1, last && stops.length > 1 ? 'back to stop 1' : ''));
    });
    if (draft?.insert && draft.index >= stops.length) list.append(draftRow(current));
    if (stops.length === 0 && !draft) list.appendChild(el('li', 'meter-label', 'No stops: porters on this route wait at their station.'));
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
      if (here.length === 1) setStops(insertStop(current.stops, draft.index, stopFor(state, ctx, here[0], current.stops)));
      else setDraft({ ...draft, level });
    }, (building) => setStops(insertStop(current.stops, draft.index, stopFor(state, ctx, building, current.stops))));
    item.append(num, pick, el('span', 'meter-label route-held', 'Choose a floor, then a building.'));
    return item;
  }

  function row(current, stop, i) {
    const building = state.buildings.find((b) => b.instanceId === stop.instanceId);
    const item = el('li', 'route-stop');
    if (current.stops.length > 1) item.style.setProperty('--seg', segmentColor(i));

    const num = el('span', 'route-num');
    num.append(el('span', `route-n route-${stopAction(stop)}`, String(i + 1)), button('✕', `Remove stop ${i + 1}`, () => setStops(removeStop(current.stops, i)), 'route-remove'));

    const commit = (next) => {
      const stops = [...current.stops];
      stops[i] = next;
      setStops(stops);
    };
    // Re-pointing a stop at another building keeps the goods that building
    // deals in, and guesses afresh when it deals in none of them.
    const repoint = (target) => {
      const kept = stop.goods.filter((g) => goodsFor(ctx, target).includes(g.goodId));
      commit(kept.length ? { instanceId: target.instanceId, goods: kept } : stopFor(state, ctx, target, current.stops));
    };
    const editingHere = draft && !draft.insert && draft.index === i;
    const level = editingHere ? draft.level : building?.level ?? null;
    const pick = placePicker(level, editingHere ? null : building, (lvl) => {
      if (lvl === building?.level) return setDraft(null);
      const here = buildingsOn(state, lvl);
      if (here.length === 1) repoint(here[0]);
      else setDraft({ insert: false, index: i, level: lvl });
    }, repoint);

    const move = (d) => {
      const stops = [...current.stops];
      const j = i + d;
      if (j < 0 || j >= stops.length) return;
      [stops[i], stops[j]] = [stops[j], stops[i]];
      setStops(stops);
    };
    const controls = el('span', 'route-controls');
    controls.append(button('▲', 'Move stop earlier', () => move(-1)), button('▼', 'Move stop later', () => move(1)));
    item.append(num, pick, controls);

    const withGood = (k, next) => commit({ instanceId: stop.instanceId, goods: stop.goods.map((g, n) => (n === k ? next : g)) });
    stop.goods.forEach((good, k) => item.appendChild(goodLine(item, current, stop, i, good, k, building, withGood)));

    // Another good for the stop: one it does not handle yet, if the building
    // deals in any.
    const next = building ? itemFor(state, ctx, building, current.stops, stop.goods.map((g) => g.goodId)) : null;
    const add = button('+ Add a good', next ? `Handle another good at stop ${i + 1}` : 'Every good this building deals in is on this stop', () => {
      if (next) commit({ instanceId: stop.instanceId, goods: [...stop.goods, next] });
    }, 'text-button route-add-good');
    add.disabled = !next;
    item.appendChild(add);
    if (!building) item.appendChild(el('span', 'meter-label route-held', 'this building is gone'));
    return item;
  }

  /**
   * One good at a stop: its action and the good, a ✕ that takes it off the
   * stop while the stop has another, how much, and how much the building
   * holds of it now.
   */
  function goodLine(row, current, stop, i, good, k, building, withGood) {
    const line = el('div', 'route-good');
    const action = el('select', 'inspect-select');
    action.append(new Option('pick up', 'pickup'), new Option('drop off', 'dropoff'));
    action.value = good.action;
    action.setAttribute('aria-label', 'Action');

    // The goods the building deals in, less the ones the stop's other lines handle.
    const others = stop.goods.filter((_, m) => m !== k).map((g) => g.goodId);
    const which = el('select', 'inspect-select');
    for (const id of goodsFor(ctx, building, good.goodId)) {
      if (!others.includes(id)) which.appendChild(new Option(nameOf(ctx, id).toLowerCase(), id));
    }
    which.value = good.goodId;
    which.setAttribute('aria-label', 'Good');

    // A new action starts from its whole: pick up all, drop off everything
    // carried. A new good keeps the amount.
    const change = () => withGood(k, action.value === good.action
      ? { ...good, goodId: which.value }
      : { action: action.value, goodId: which.value, qty: 'all' });
    action.addEventListener('change', change);
    which.addEventListener('change', change);

    const what = el('span', 'route-what');
    what.append(action, which);
    if (stop.goods.length > 1) {
      what.appendChild(button('✕', `Stop handling ${nameOf(ctx, good.goodId).toLowerCase()} at stop ${i + 1}`, () => {
        setStops(current.stops.map((s, n) => (n === i ? { instanceId: s.instanceId, goods: s.goods.filter((_, m) => m !== k) } : s)));
      }, 'route-remove'));
    }
    const howMuch = amountControl(good, building, (patch) => withGood(k, { action: good.action, goodId: good.goodId, ...patch }));
    const held = el('span', 'meter-label route-held');
    line.append(what, howMuch, held);
    if (building) rowRefs.push({ item: row, i, held, building, goodId: good.goodId });
    return line;
  }

  /**
   * How much one good at a stop moves, as a slider. A pick-up: 0 up to the
   * most it could ever take here, the top meaning all. A drop-off: the percentage of what
   * the porter carries of the good on arrival. The readout follows the thumb;
   * the route changes when it is let go.
   */
  function amountControl(good, building, onCommit) {
    const wrap = el('label', 'route-amount');
    const slider = el('input', 'route-slider');
    slider.type = 'range';
    const readout = el('span', 'route-amount-value');
    let show;
    let patch;
    if (good.action === 'dropoff') {
      slider.min = '0';
      slider.max = '100';
      slider.step = '5';
      slider.value = String(Math.round((good.share ?? 1) * 100));
      slider.setAttribute('aria-label', 'Share of what the porter carries to leave here');
      show = () => { readout.textContent = `leave ${slider.value}% of load`; };
      patch = () => (slider.value === '100' ? { qty: 'all' } : { qty: 'all', share: Number(slider.value) / 100 });
    } else {
      const def = building && ctx.catalog.buildings.byId[building.buildingId];
      const held = def ? capacity(building, def, ctx, good.goodId) : 0;
      const max = pickupMax(ctx, building, good.goodId);
      slider.min = '0';
      slider.max = String(max);
      slider.step = '1';
      slider.value = String(good.qty === 'all' ? max : Math.min(good.qty, max));
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
      const current = route();
      if (!current) {
        status.textContent = 'This route has been taken away.';
        crew.replaceChildren();
        list.replaceChildren();
        return;
      }
      if (document.activeElement !== name && name.value !== current.name) name.value = current.name;
      const on = portersOn(state, routeId);
      const onKey = JSON.stringify([on.map((w) => w.id), porters(state).map((w) => [w.id, w.routeId])]);
      if (onKey !== crewKey) {
        crewKey = onKey;
        crewRows();
      }
      for (const { w, doing } of crewRefs) doing.textContent = describe(state, ctx, w);
      // A select the player has open, or a slider being dragged, would be lost
      // under a rebuild, so the list is rebuilt only when the route itself
      // changes. Which stop is next, and what is held, are set in place.
      const key = JSON.stringify([current.stops, state.buildings.length, draft]);
      if (key !== signature) {
        signature = key;
        rows();
      }
      // Every porter on the route marks the stop they are heading for.
      const next = new Set(on.map((w) => w.stop % Math.max(1, current.stops.length)));
      for (const ref of rowRefs) {
        ref.item.classList.toggle('next', next.has(ref.i));
        if (ref.building) ref.held.textContent = `here ${Math.round(amount(ref.building, ref.goodId))}`;
      }
      status.textContent = `${current.stops.length} stop${current.stops.length === 1 ? '' : 's'} · ${on.length} porter${on.length === 1 ? '' : 's'} · each carries up to ${carryCap}`;
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
    case 'idle': return `Waiting at the station — ${porter.routeId ? 'the route has no stops' : 'no route'}${hands}`;
    default: return `At level ${porter.level}, stop ${porter.stop + 1} of ${stopsOf(state, porter).length}${hands} · load ${Math.round(load(porter))}/${ctx.config.haulage.porterCapacity}`;
  }
}

/**
 * A picker that puts a porter on a route: every porter not already on it,
 * each saying which route they would leave.
 */
export function assignPicker(state, routeId, dispatch) {
  const pick = el('select', 'inspect-select route-assign');
  pick.setAttribute('aria-label', 'Put a porter on this route');
  pick.appendChild(new Option('Assign a porter…', ''));
  const others = porters(state).filter((w) => w.routeId !== routeId);
  for (const w of others) {
    const from = state.haulage.routes.find((r) => r.id === w.routeId);
    pick.appendChild(new Option(from ? `${w.name} (from ${from.name})` : w.name, w.id));
  }
  pick.disabled = others.length === 0;
  pick.addEventListener('change', () => {
    if (pick.value) dispatch({ type: 'player:assignRoute', workerId: pick.value, routeId });
    pick.value = '';
  });
  return pick;
}
