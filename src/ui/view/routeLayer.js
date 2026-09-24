/**
 * routeLayer.js
 * The open porter's route, drawn in the shaft.
 *
 * The legs of the loop are drawn on the minimap (shaftScroll.js), not here:
 * in the shaft they crossed every room they passed. What the shaft carries is
 * where the stops are.
 *
 * Every stop is numbered on its room, at the top-right corner, with a ✕ beside
 * the number that takes the stop off the route. A click anywhere else on a
 * room asks where in the route to add it. A marker hangs over the porter
 * whose route is open, and while the player has asked to follow them
 * (selection.follow) the view keeps them centred.
 *
 * UI, not world: nothing here is saved, and the only thing it writes is the
 * player:setRoute command a click asks for.
 */

import { roomRect, LEVEL_HEIGHT } from './interpolate.js';
import { pan, panX, zoom } from './viewport.js';
import { porterSpot } from './figures.js';
import * as selection from '../selection.js';
import { button } from '../components/dom.js';
import { segmentColor, insertStop, removeStop, stopFor } from '../routePlan.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The zoom a followed porter is brought up to, as a multiple of the fit. */
const FOLLOW_ZOOM = 1.8;

/** How quickly the camera closes on a followed porter: ms to cover ~63%. */
const FOLLOW_EASE_MS = 140;

export function createRouteLayer(view, root, dispatch, ctx) {
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', 'route-layer');
  view.layers.routes.appendChild(layer);

  const markers = svg(layer, 'g', 'route-markers');
  const focus = svg(layer, 'g', 'porter-focus');
  const mark = svg(focus, 'path', 'porter-focus-mark');
  mark.setAttribute('d', 'M-4 -6h8l-4 5z');
  mark.dataset.part = 'bob';

  // The "where in the route?" question, asked beside the room clicked.
  const chooser = document.createElement('div');
  chooser.className = 'route-chooser';
  chooser.hidden = true;
  root.appendChild(chooser);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  const layerState = { key: null, followed: null, lastFrame: null, zoomTo: null };

  return { update, pick, close };

  function porterOf(state) {
    const { editing } = selection.get();
    return editing ? state.population.workers.find((w) => w.id === editing) ?? null : null;
  }

  /** Per frame: redraw the route when it changes, mark and follow the porter. */
  function update(state, currentCtx, tick, alpha) {
    const porter = porterOf(state);
    if (!porter) close();
    const key = porter ? JSON.stringify([porter.id, porter.route, view.builtSignature]) : '';
    if (key !== layerState.key) {
      layerState.key = key;
      draw(state, porter);
    }

    const spot = porter ? porterSpot(state, view.art, porter, tick, alpha) : null;
    focus.style.display = spot ? '' : 'none';
    if (spot) focus.setAttribute('transform', `translate(${spot.x.toFixed(1)} ${(spot.y - 30).toFixed(1)})`);

    const now = performance.now();
    const dt = layerState.lastFrame === null ? 16 : Math.min(100, now - layerState.lastFrame);
    layerState.lastFrame = now;
    follow(state, spot, dt);
  }

  /**
   * Keep the followed porter centred, easing rather than jumping, and zoom in
   * to them once when the follow starts.
   */
  function follow(state, spot, dt) {
    const { follow: id } = selection.get();
    if (id !== layerState.followed) {
      layerState.followed = id;
      layerState.zoomTo = id ? Math.max(view.viewport.zoomFactor, FOLLOW_ZOOM) : null;
    }
    if (!id || !spot) return;
    const vp = view.viewport;
    const k = 1 - Math.exp(-dt / FOLLOW_EASE_MS);
    const level = spot.y / LEVEL_HEIGHT + 1;
    if (layerState.zoomTo && vp.zoomFactor < layerState.zoomTo - 0.01) {
      zoom(vp, (layerState.zoomTo / vp.zoomFactor) ** k, level);
    }
    const top = level - vp.visibleLevels / 2;
    const left = spot.x - vp.viewWidth / 2;
    vp.topLevel += (top - vp.topLevel) * k;
    vp.left += (left - vp.left) * k;
    pan(vp, 0);
    panX(vp, 0);
  }

  function draw(state, porter) {
    markers.replaceChildren();
    if (!porter) return;

    const perRoom = new Map();
    porter.route.forEach((stop, i) => {
      const instance = state.buildings.find((b) => b.instanceId === stop.instanceId);
      if (!instance) return;
      const n = perRoom.get(instance.instanceId) ?? 0;
      perRoom.set(instance.instanceId, n + 1);
      const r = roomRect(instance, state.buildings);
      const marker = svg(markers, 'g', `route-marker route-${stop.action}`);
      marker.setAttribute('transform', `translate(${r.x + r.width - 26 - n * 25} ${r.y + 3})`);
      const box = svg(marker, 'rect');
      box.setAttribute('width', '12');
      box.setAttribute('height', '11');
      const text = svg(marker, 'text');
      text.setAttribute('x', '6');
      text.setAttribute('y', '8.5');
      text.textContent = String(i + 1);
      if (porter.route.length > 1) {
        const band = svg(marker, 'rect', 'route-marker-band');
        band.setAttribute('y', '11');
        band.setAttribute('width', '12');
        band.setAttribute('height', '2');
        band.style.fill = segmentColor(i);
      }
      const remove = svg(marker, 'g', 'route-marker-remove');
      remove.dataset.stop = String(i);
      remove.setAttribute('transform', 'translate(13 0)');
      const rbox = svg(remove, 'rect');
      rbox.setAttribute('width', '10');
      rbox.setAttribute('height', '11');
      const x = svg(remove, 'path');
      x.setAttribute('d', 'M3 3.5l4 4M7 3.5l-4 4');
      const title = svg(remove, 'title');
      title.textContent = `Remove stop ${i + 1} from the route`;
    });
  }

  /**
   * A click in the shaft while a route is open. A ✕ on a marker removes that
   * stop; a room asks where to add it. Returns whether the click was used.
   */
  function pick(state, hit, node, event) {
    const porter = porterOf(state);
    if (!porter) return false;
    const remove = hit?.closest?.('.route-marker-remove');
    if (remove) {
      close();
      dispatch({ type: 'player:setRoute', workerId: porter.id, stops: removeStop(porter.route, Number(remove.dataset.stop)) });
      return true;
    }
    if (!node) {
      close();
      return false;
    }
    const building = state.buildings.find((b) => b.instanceId === node.dataset.instance);
    if (!building) return false;
    if (porter.route.length === 0) {
      close();
      addAt(state, porter, building, 0);
      return true;
    }
    ask(state, porter, building, event);
    return true;
  }

  function addAt(state, porter, building, index) {
    dispatch({ type: 'player:setRoute', workerId: porter.id, stops: insertStop(porter.route, index, stopFor(state, ctx, building, porter.route)) });
  }

  /** Ask, beside the click, which position the room should take in the route. */
  function ask(state, porter, building, event) {
    const def = ctx.catalog.buildings.byId[building.buildingId];
    const already = porter.route.map((s, i) => (s.instanceId === building.instanceId ? i + 1 : null)).filter(Boolean);
    chooser.replaceChildren();

    const head = document.createElement('div');
    head.className = 'route-chooser-head';
    head.textContent = `Add ${def?.name ?? 'building'}, L${building.level}, as stop`;
    const shut = button('✕', 'Cancel', close, 'route-remove');
    head.appendChild(shut);
    chooser.appendChild(head);

    const places = document.createElement('div');
    places.className = 'route-chooser-places';
    for (let i = 0; i <= porter.route.length; i++) {
      const b = button(String(i + 1), i === porter.route.length ? `Add as stop ${i + 1}, the last` : `Add as stop ${i + 1}, before the current stop ${i + 1}`, () => {
        const current = porterOf(state);
        if (current) addAt(state, current, building, i);
        close();
      }, 'route-chooser-place');
      if (i < porter.route.length) b.style.setProperty('--seg', segmentColor(i));
      places.appendChild(b);
    }
    chooser.appendChild(places);
    if (already.length) {
      const note = document.createElement('div');
      note.className = 'meter-label';
      note.textContent = `Already stop ${already.join(', ')} — ✕ beside its number removes it.`;
      chooser.appendChild(note);
    }

    chooser.hidden = false;
    const host = root.getBoundingClientRect();
    const w = chooser.offsetWidth;
    const h = chooser.offsetHeight;
    const x = Math.min(Math.max(4, event.clientX - host.left + 8), host.width - w - 16);
    const y = Math.min(Math.max(4, event.clientY - host.top + 8), host.height - h - 4);
    chooser.style.left = `${x}px`;
    chooser.style.top = `${y}px`;
    chooser.querySelector('.route-chooser-place:last-child')?.focus();
  }

  function close() {
    if (!chooser.hidden) chooser.hidden = true;
  }
}

function svg(parent, tag, className = '') {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  parent.appendChild(node);
  return node;
}
