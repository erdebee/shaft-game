/**
 * routes.js
 * The Routes tab: every route the player has defined, and a button to define
 * another. Each route shows its name, how many stops it has, the porters on
 * it — with a picker that puts another porter on — and the goods it moves:
 * what it picks up and what it drops off, as icons that open the resource
 * card. Its name opens it in the route editor (routeEditor.js); while a route
 * is open this tab is the editor.
 *
 * View shows a route in the shaft and on the minimap without leaving the
 * list (selection.viewRoute), so the player can go down the routes one by
 * one: View on another route shows that one instead, View on the one shown
 * (now Hide) puts it away, and so does any click in the shaft.
 *
 * A route is deleted asked twice, like a porter dismissed; its porters are
 * left with no route and go home to their station.
 *
 * The list is rebuilt when a route or who walks it changes; nothing on it
 * moves between frames.
 */

import * as selection from '../selection.js';
import { el, button } from '../components/dom.js';
import { porters, portersOn } from '../../systems/haulage/haulageMethods.js';
import { goodsOf } from '../routePlan.js';
import { goodIcon } from './inspect.js';
import * as routeEditor from './routeEditor.js';

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();
  const host = el('section', 'card routes');
  root.appendChild(host);

  let editor = null;
  let signature = null;

  function build(currentState, currentCtx) {
    host.replaceChildren();
    const { routes } = currentState.haulage;
    const head = el('div', 'build-head');
    const create = button('New route', 'Define a new, empty route and open it', () => {
      dispatch({ type: 'player:createRoute' });
      const made = currentState.haulage.routes.at(-1);
      if (made) selection.editRoute(made.id);
    }, 'text-button');
    head.append(el('h2', '', 'Routes'), create);
    const idle = porters(currentState).filter((w) => w.routeId === null).length;
    const summary = `${routes.length} route${routes.length === 1 ? '' : 's'}${idle ? ` · ${idle} porter${idle === 1 ? '' : 's'} on no route` : ''}`;
    host.append(head, el('div', 'meter-label', summary));
    if (!routes.length) host.appendChild(el('div', 'meter-label', 'No routes yet. A porter with no route waits at their station.'));

    const list = el('ul', 'route-overview');
    const { viewing } = selection.get();
    for (const route of routes) list.appendChild(routeRow(currentState, currentCtx, route, dispatch, route.id === viewing));
    host.appendChild(list);
  }

  return {
    update(currentState, currentCtx) {
      const { editing } = selection.get();
      if (editing) {
        if (editor?.routeId !== editing) {
          editor?.destroy?.();
          editor = { routeId: editing, ...routeEditor.mount(host, currentState, currentCtx, dispatch, editing) };
          signature = null;
        }
        editor.update();
        return;
      }
      if (editor) {
        editor.destroy?.();
        editor = null;
      }

      const sig = JSON.stringify([
        currentState.haulage.routes,
        porters(currentState).map((w) => [w.id, w.routeId]),
        selection.get().viewing,
      ]);
      if (sig !== signature) {
        signature = sig;
        build(currentState, currentCtx);
      }
    },
  };
}

/** One route: name, stops, porters (and assigning another), goods, view, edit and delete. */
function routeRow(state, ctx, route, dispatch, shown) {
  const item = el('li', shown ? 'route-card viewing' : 'route-card');

  const top = el('div', 'route-card-head');
  const name = button(route.name, `Open ${route.name} in the route editor`, () => selection.editRoute(route.id), 'visitor-name route-card-name');
  const count = el('span', 'meter-label', `${route.stops.length} stop${route.stops.length === 1 ? '' : 's'}`);
  let armed = false;
  const remove = button('Delete', `Delete ${route.name}`, () => {
    if (!armed) {
      armed = true;
      remove.textContent = 'Sure?';
      setTimeout(() => { armed = false; remove.textContent = 'Delete'; }, 3000);
      return;
    }
    dispatch({ type: 'player:deleteRoute', routeId: route.id });
  }, 'text-button danger');
  const look = button(shown ? 'Hide' : 'View', shown ? `Stop showing ${route.name} in the Shaft` : `Show ${route.name} in the Shaft and on the minimap`, () => selection.viewRoute(route.id), 'text-button');
  look.setAttribute('aria-pressed', String(shown));
  top.append(name, count, look, button('Edit', `Open ${route.name} in the route editor`, () => selection.editRoute(route.id), 'text-button'), remove);

  const crew = el('div', 'route-card-crew');
  const on = portersOn(state, route.id);
  crew.appendChild(el('span', 'meter-label', on.length ? 'Porters' : 'No porters'));
  for (const w of on) {
    const chip = el('span', 'route-chip');
    chip.append(
      button(w.name, `Open ${route.name} and follow ${w.name}`, () => selection.editRoute(route.id, { follow: w.id }), 'visitor-name'),
      button('✕', `Take ${w.name} off ${route.name}`, () => dispatch({ type: 'player:assignRoute', workerId: w.id, routeId: null }), 'route-remove'),
    );
    crew.appendChild(chip);
  }
  crew.appendChild(routeEditor.assignPicker(state, route.id, dispatch));

  const goods = el('div', 'visitor-goods route-card-goods');
  const all = goodsOf(route);
  const takes = all.filter((g) => g.pickups).map((g) => g.goodId);
  const brings = all.filter((g) => g.dropoffs).map((g) => g.goodId);
  if (takes.length) goods.append(el('span', 'meter-label', 'picks up'), ...takes.map((id) => goodIcon(ctx, id)));
  if (brings.length) goods.append(el('span', 'meter-label', 'drops off'), ...brings.map((id) => goodIcon(ctx, id)));
  if (!all.length) goods.appendChild(el('span', 'meter-label', 'Moves nothing yet'));

  item.append(top, crew, goods);
  return item;
}
