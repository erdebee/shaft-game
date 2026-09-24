/**
 * porters.js
 * The Porters tab: every porter station in the shaft, each with its porters,
 * what each is doing, and the hiring. A porter's Route button opens the route
 * editor here (routeEditor.js); while a route is open this tab is the editor.
 *
 * Porters with no station — a roster the opening placed before any station
 * stood — are listed apart, so nobody hauling is out of reach.
 *
 * The lists are rebuilt when the stations or their porters change; per frame
 * only the "doing" lines are refreshed.
 */

import * as selection from '../selection.js';
import { el, button } from '../components/dom.js';
import * as routeEditor from './routeEditor.js';

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();
  const host = el('section', 'card porters');
  root.appendChild(host);

  let editor = null;
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
      body.rows = stray.map((w) => porterRow(body, w, dispatch));
      stations.push({ root: body, stray: true });
    }
  }

  return {
    update(currentState, currentCtx) {
      const { editing } = selection.get();
      if (editing) {
        if (editor?.workerId !== editing) {
          editor?.destroy?.();
          editor = { workerId: editing, ...routeEditor.mount(host, currentState, currentCtx, dispatch, editing) };
          signature = null;
        }
        editor.update();
        return;
      }
      if (editor) {
        editor.destroy?.();
        editor = null;
      }

      const sig = currentState.buildings
        .filter((b) => currentCtx.catalog.buildings.byId[b.buildingId]?.porterStation)
        .map((b) => b.instanceId)
        .concat(currentState.population.workers.map((w) => `${w.id}@${w.stationId}`))
        .join(',');
      if (sig !== signature) {
        signature = sig;
        build(currentState, currentCtx);
      }
      for (const s of stations) {
        if (s.stray) {
          for (const { w, doing } of s.root.rows) doing.textContent = routeEditor.describe(currentState, currentCtx, w);
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
  const sig = living.map((w) => w.id).join(',');
  if (key.value !== sig) {
    key.value = sig;
    root.replaceChildren();
    const head = el('div', 'inspect-row');
    root.count = el('span', 'meter-label');
    head.append(root.count, button('Hire porter', 'Hire a porter from the labour pool', () => dispatch({ type: 'player:hirePorter', instanceId: instance.instanceId }), 'text-button'));
    root.appendChild(head);
    root.rows = living.map((w) => porterRow(root, w, dispatch));
  }
  root.count.textContent = `Porters ${living.length} of ${beds}`;
  for (const { w, doing } of root.rows) doing.textContent = routeEditor.describe(state, ctx, w);
}

/** One porter: their name, their route, dismissal (asked twice), and what they are doing. */
function porterRow(root, w, dispatch) {
  const row = el('div', 'porter-row');
  const name = el('span', 'porter-name', w.name);
  const doing = el('span', 'meter-label porter-doing');
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
  row.append(name, button('Route', `Edit ${w.name}'s route`, () => selection.editRoute(w.id, { follow: true }), 'text-button'), dismiss, doing);
  root.appendChild(row);
  return { w, doing };
}
