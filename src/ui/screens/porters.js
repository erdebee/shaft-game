/**
 * porters.js
 * The Porters tab: every porter station in the shaft, each with its porters,
 * what each is doing, and the hiring. Each porter is put on one of the routes
 * (screens/routes.js) from a picker on their row, which can also start a new
 * route for them; the button beside it opens their route in the editor, on
 * the Routes tab, following them.
 *
 * Porters with no station — a roster the opening placed before any station
 * stood — are listed apart, so nobody hauling is out of reach.
 *
 * The lists are rebuilt when the stations, their porters, or the routes
 * change; per frame only the "doing" lines are refreshed.
 */

import * as selection from '../selection.js';
import { el, button } from '../components/dom.js';
import * as routeEditor from './routeEditor.js';

/** The picker's value for "start a new route for this porter". */
const NEW_ROUTE = '+new';

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();
  const host = el('section', 'card porters');
  root.appendChild(host);

  let signature = null;
  let stations = [];

  function build(currentState, currentCtx) {
    host.replaceChildren();
    const workers = currentState.population.workers;
    host.append(el('h2', '', 'Porters'), el('div', 'meter-label', `${workers.length} porter${workers.length === 1 ? '' : 's'} on the roster`));
    stations = [];

    const homes = currentState.buildings.filter((b) => currentCtx.catalog.buildings.byId[b.buildingId]?.porterStation);
    if (!homes.length) host.appendChild(el('div', 'meter-label', 'No porter station yet. Build one under Build › Infrastructure.'));
    for (const instance of homes) {
      const def = currentCtx.catalog.buildings.byId[instance.buildingId];
      const group = el('div', 'inspect-station');
      const head = el('h3', 'build-zone');
      const open = button(`${def.name} · level ${instance.level}`, `Open ${def.name} on level ${instance.level}`, () => selection.select({ instanceId: instance.instanceId, level: instance.level }), 'visitor-name');
      head.appendChild(open);
      const body = el('div');
      group.append(head, body);
      host.appendChild(group);
      stations.push({ root: body, key: { value: null }, instance, def });
    }

    const stray = workers.filter((w) => !homes.some((b) => b.instanceId === w.stationId));
    if (stray.length) {
      const group = el('div', 'inspect-station');
      group.appendChild(el('h3', 'build-zone', 'Without a station'));
      const body = el('div');
      group.appendChild(body);
      host.appendChild(group);
      body.rows = stray.map((w) => porterRow(body, currentState, w, dispatch));
      stations.push({ root: body, stray: true });
    }
  }

  return {
    update(currentState, currentCtx) {
      const sig = currentState.buildings
        .filter((b) => currentCtx.catalog.buildings.byId[b.buildingId]?.porterStation)
        .map((b) => b.instanceId)
        .concat(currentState.population.workers.map((w) => `${w.id}@${w.stationId}`))
        .concat(currentState.haulage.routes.map((r) => `${r.id}:${r.name}`))
        .join(',');
      if (sig !== signature) {
        signature = sig;
        build(currentState, currentCtx);
      }
      for (const s of stations) {
        if (s.stray) {
          for (const row of s.root.rows) refreshRow(currentState, currentCtx, row);
        } else {
          renderStation(s.root, s.key, currentState, currentCtx, s.instance, s.def, dispatch);
        }
      }
    },
  };
}

/** A station's porters, each with what they are doing, and the hiring. */
export function renderStation(root, key, state, ctx, instance, def, dispatch) {
  const living = state.population.workers.filter((w) => w.stationId === instance.instanceId);
  const beds = def.porterStation.porters;
  // The route pickers list every route, so a route made, renamed or taken
  // away rebuilds the rows.
  const sig = JSON.stringify([living.map((w) => w.id), state.haulage.routes.map((r) => [r.id, r.name])]);
  if (key.value !== sig) {
    key.value = sig;
    root.replaceChildren();
    const head = el('div', 'inspect-row');
    root.count = el('span', 'meter-label');
    head.append(root.count, button('Hire porter', 'Hire a porter from the labour pool', () => dispatch({ type: 'player:hirePorter', instanceId: instance.instanceId }), 'text-button'));
    root.appendChild(head);
    root.rows = living.map((w) => porterRow(root, state, w, dispatch));
  }
  root.count.textContent = `Porters ${living.length} of ${beds}`;
  for (const row of root.rows) refreshRow(state, ctx, row);
}

/** Per frame: what the porter is doing, and the route they are on. */
function refreshRow(state, ctx, { w, doing, pick, edit }) {
  doing.textContent = routeEditor.describe(state, ctx, w);
  const value = w.routeId ?? '';
  if (document.activeElement !== pick && pick.value !== value) pick.value = value;
  edit.disabled = w.routeId === null;
}

/**
 * One porter: their name, the route they are on (or a new one), the button
 * that opens it, dismissal (asked twice), and what they are doing.
 */
function porterRow(root, state, w, dispatch) {
  const row = el('div', 'porter-row');
  const name = el('span', 'porter-name', w.name);
  const doing = el('span', 'meter-label porter-doing');

  const pick = el('select', 'inspect-select porter-route');
  pick.setAttribute('aria-label', `${w.name}'s route`);
  pick.appendChild(new Option('No route', ''));
  for (const route of state.haulage.routes) pick.appendChild(new Option(route.name, route.id));
  pick.appendChild(new Option('New route…', NEW_ROUTE));
  pick.value = w.routeId ?? '';
  pick.addEventListener('change', () => {
    if (pick.value === NEW_ROUTE) {
      dispatch({ type: 'player:createRoute', workerId: w.id });
      if (w.routeId) selection.editRoute(w.routeId, { follow: w.id });
      return;
    }
    dispatch({ type: 'player:assignRoute', workerId: w.id, routeId: pick.value || null });
  });
  const edit = button('Edit', `Open ${w.name}'s route and follow them`, () => {
    if (w.routeId) selection.editRoute(w.routeId, { follow: w.id });
  }, 'text-button');

  let armed = false;
  const dismiss = button('Dismiss', `Dismiss ${w.name}`, () => {
    if (!armed) {
      armed = true;
      dismiss.textContent = 'Sure?';
      setTimeout(() => { armed = false; dismiss.textContent = 'Dismiss'; }, 3000);
      return;
    }
    dispatch({ type: 'player:dismissPorter', workerId: w.id });
  }, 'text-button danger');
  row.append(name, pick, edit, dismiss, doing);
  root.appendChild(row);
  return { w, doing, pick, edit };
}
