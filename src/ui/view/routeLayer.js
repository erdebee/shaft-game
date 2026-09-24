/**
 * routeLayer.js
 * The open route, drawn in the shaft.
 *
 * The legs of the loop are drawn here exactly as on the minimap
 * (shaftScroll.js, both through routeLines.js): straight lines from stop to
 * stop, in each leg's colour, with chevrons flowing the way the porter walks.
 *
 * Every stop is a tag on its room, at the top-right corner, one under another
 * when a room is called at more than once: its number, a line for each good
 * it handles — "Loads: 10%" or "Unloads: 100%", and the good's icon — and a ✕
 * that takes the stop off the route. A pick-up's percentage is of the most it could take
 * (routePlan.pickupMax), a drop-off's of what the porter carries. The legs
 * run between the numbers. A click anywhere else on a
 * room asks where in the route to add it. A marker hangs over the porter
 * being followed — or, if nobody is, the first porter on the route — and
 * while the player has asked to follow them (selection.follow) the view keeps
 * them centred.
 *
 * UI, not world: nothing here is saved, and the only thing it writes is the
 * player:setRoute command a click asks for.
 */

import { roomRect, LEVEL_HEIGHT } from './interpolate.js';
import { pan, panX, zoom, focusLevel } from './viewport.js';
import { porterSpot } from './figures.js';
import * as selection from '../selection.js';
import { button } from '../components/dom.js';
import { segmentColor, segmentsOf, insertStop, removeStop, stopFor, stopAction, itemShare, pickupMax } from '../routePlan.js';
import { drawLeg } from './routeLines.js';
import { nameOf } from '../../systems/resources/stores.js';
import { portersOn } from '../../systems/haulage/haulageMethods.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The zoom a followed porter is brought up to, as a multiple of the fit. */
const FOLLOW_ZOOM = 1.8;

/** How quickly the camera closes on a followed porter: ms to cover ~63%. */
const FOLLOW_EASE_MS = 140;

/** A stop's tag: one line's height, the gap under it, the number box and the icon. */
const TAG_H = 13;
const TAG_GAP = 3;
const NUM_W = 12;
const ICON = 11;

/** Chevrons on a leg in the shaft: spacing and speed in shaft units, and a cap. */
const CHEVRON_EVERY = 56;
const FLOW_SPEED = 48;
const MOST_CHEVRONS = 24;

export function createRouteLayer(view, root, dispatch, ctx) {
  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', 'route-layer');
  view.layers.routes.appendChild(layer);

  const legs = svg(layer, 'g', 'route-legs');
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

  const layerState = { key: null, followed: null, lastFrame: null, zoomTo: null, viewed: null };

  return { update, pick, close };

  /** The route drawn: the one being edited, or else the one viewed. */
  function routeOf(state) {
    const shown = selection.shownRoute();
    return shown ? state.haulage.routes.find((r) => r.id === shown) ?? null : null;
  }

  /** The porter the marker hangs over: the one followed, or the route's first. */
  function porterOf(state, route) {
    if (!route) return null;
    const { follow } = selection.get();
    const followed = follow ? state.population.workers.find((w) => w.id === follow) : null;
    return followed ?? portersOn(state, route.id)[0] ?? null;
  }

  /** Per frame: redraw the route when it changes, mark and follow the porter. */
  function update(state, currentCtx, tick, alpha) {
    const route = routeOf(state);
    if (!route) close();
    const editable = !!route && selection.get().editing === route.id;
    const key = route ? JSON.stringify([route.id, route.stops, editable, view.builtSignature]) : '';
    if (key !== layerState.key) {
      layerState.key = key;
      draw(state, route, editable);
    }
    const { viewing } = selection.get();
    if (viewing !== layerState.viewed) {
      layerState.viewed = viewing;
      if (viewing && route?.id === viewing) bringIntoView(state, route);
    }
    const porter = porterOf(state, route);

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

  /**
   * A route just picked to view is brought into the shaft: all of it, when
   * its stops fit in the view at once, or else from its first stop.
   */
  function bringIntoView(state, route) {
    const levels = route.stops
      .map((stop) => state.buildings.find((b) => b.instanceId === stop.instanceId)?.level)
      .filter((level) => level !== undefined);
    if (!levels.length) return;
    const vp = view.viewport;
    const low = Math.min(...levels);
    const high = Math.max(...levels);
    focusLevel(vp, high - low + 1 <= vp.visibleLevels ? (low + high + 1) / 2 : levels[0] + 0.5);
  }

  function draw(state, route, editable) {
    legs.replaceChildren();
    markers.replaceChildren();
    if (!route) return;

    // How far down its room the next tag goes, per room.
    const below = new Map();
    const at = new Map();
    route.stops.forEach((stop, i) => {
      const instance = state.buildings.find((b) => b.instanceId === stop.instanceId);
      if (!instance) return;
      const r = roomRect(instance, state.buildings);
      const tag = stopTag(state, route, stop, instance, i, editable);
      // Right-aligned in the room; a tag wider than its room starts at the
      // room's left edge and runs over the right one rather than off the left.
      const x = Math.max(r.x + 2, r.x + r.width - 3 - tag.width);
      const y = r.y + 3 + (below.get(instance.instanceId) ?? 0);
      below.set(instance.instanceId, y - r.y - 3 + tag.height + TAG_GAP);
      tag.node.setAttribute('transform', `translate(${x.toFixed(1)} ${y})`);
      at.set(i, [x + NUM_W / 2, y + tag.height / 2]);
    });

    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const seg of segmentsOf(state, route.stops)) {
      const a = at.get(seg.i);
      const b = at.get(seg.to);
      if (a && b) drawLeg(legs, a, b, seg.color, { every: CHEVRON_EVERY, speed: FLOW_SPEED, calm, most: MOST_CHEVRONS });
    }
  }

  /**
   * One stop's tag, drawn at the origin: the number in the stop's colour
   * (pick-up, drop-off, or both), with the leg's colour under it; then a line
   * for each good — "Loads: 10%" or "Unloads: 100%" and the good's icon (or
   * its first letters, if it has none yet); and, while the route is being
   * edited rather than only viewed, the ✕ on the first line.
   */
  function stopTag(state, route, stop, instance, i, editable) {
    const lines = stop.goods.length;
    const height = lines * TAG_H;
    const node = svg(markers, 'g', `route-marker route-${stopAction(stop)}`);
    const back = svg(node, 'rect', 'route-tag');
    back.setAttribute('height', String(height));

    const box = svg(node, 'rect', 'route-tag-num');
    box.setAttribute('width', String(NUM_W));
    box.setAttribute('height', String(height));
    if (stopAction(stop) === 'mixed') {
      // Both ways: the lower half in the drop-off colour.
      const half = svg(node, 'rect', 'route-tag-num-half');
      half.setAttribute('y', String(height / 2));
      half.setAttribute('width', String(NUM_W));
      half.setAttribute('height', String(height / 2));
    }
    const num = svg(node, 'text');
    num.setAttribute('x', String(NUM_W / 2));
    num.setAttribute('y', String(height / 2 + 3));
    num.textContent = String(i + 1);
    if (route.stops.length > 1) {
      const band = svg(node, 'rect', 'route-marker-band');
      band.setAttribute('y', String(height - 2));
      band.setAttribute('width', String(NUM_W));
      band.setAttribute('height', '2');
      band.style.fill = segmentColor(i);
    }

    let widest = 0;
    const said = [];
    stop.goods.forEach((item, k) => {
      const pickup = item.action === 'pickup';
      const top = k * TAG_H;
      // A little is never shown as nothing: 2 of 600 reads 1%, not 0%.
      const share = itemShare(ctx, instance, item);
      const pct = share > 0 ? Math.max(1, Math.round(share * 100)) : 0;
      const label = svg(node, 'text', 'route-tag-text');
      label.setAttribute('x', String(NUM_W + 3));
      label.setAttribute('y', String(top + 9.5));
      label.textContent = `${pickup ? 'Loads' : 'Unloads'}: ${pct}%`;
      const textWidth = label.getComputedTextLength?.() || label.textContent.length * 4.3;
      let x = NUM_W + 3 + textWidth + 2;

      const icon = view.art.icons?.get(item.goodId);
      if (icon) {
        const img = svg(node, 'image', 'route-tag-icon');
        img.setAttribute('href', icon.href);
        img.setAttribute('x', String(x));
        img.setAttribute('y', String(top + (TAG_H - ICON) / 2));
        img.setAttribute('width', String(ICON));
        img.setAttribute('height', String(ICON));
        x += ICON + 2;
      } else {
        const short = svg(node, 'text', 'route-tag-text');
        short.setAttribute('x', String(x));
        short.setAttribute('y', String(top + 9.5));
        short.textContent = nameOf(ctx, item.goodId).slice(0, 3);
        x += (short.getComputedTextLength?.() || 13) + 2;
      }
      widest = Math.max(widest, x);

      const max = pickupMax(ctx, instance, item.goodId);
      const amount = pickup
        ? (item.qty === 'all' ? `all it can, up to ${max}` : `${item.qty} of at most ${max}`)
        : `${pct}% of what the porter carries`;
      said.push(`${pickup ? 'pick up' : 'drop off'} ${nameOf(ctx, item.goodId).toLowerCase()} — ${amount}`);
    });

    if (editable) {
      const remove = svg(node, 'g', 'route-marker-remove');
      remove.dataset.stop = String(i);
      remove.setAttribute('transform', `translate(${widest.toFixed(1)} 0)`);
      const rbox = svg(remove, 'rect');
      rbox.setAttribute('width', '10');
      rbox.setAttribute('height', String(TAG_H));
      const cross = svg(remove, 'path');
      cross.setAttribute('d', 'M3 4.5l4 4M7 4.5l-4 4');
      const title = svg(remove, 'title');
      title.textContent = `Remove stop ${i + 1} from the route`;
      widest += 10;
    }

    back.setAttribute('width', widest.toFixed(1));
    svg(node, 'title').textContent = `Stop ${i + 1}: ${said.join('; ')}`;
    return { node, width: widest, height };
  }

  /**
   * A click in the shaft while a route is open. A ✕ on a marker removes that
   * stop; a room asks where to add it. Returns whether the click was used.
   */
  function pick(state, hit, node, event) {
    const route = routeOf(state);
    if (!route) return false;
    const remove = hit?.closest?.('.route-marker-remove');
    if (remove) {
      close();
      dispatch({ type: 'player:setRoute', routeId: route.id, stops: removeStop(route.stops, Number(remove.dataset.stop)) });
      return true;
    }
    if (!node) {
      close();
      return false;
    }
    const building = state.buildings.find((b) => b.instanceId === node.dataset.instance);
    if (!building) return false;
    if (route.stops.length === 0) {
      close();
      addAt(state, route, building, 0);
      return true;
    }
    ask(state, route, building, event);
    return true;
  }

  function addAt(state, route, building, index) {
    dispatch({ type: 'player:setRoute', routeId: route.id, stops: insertStop(route.stops, index, stopFor(state, ctx, building, route.stops)) });
  }

  /** Ask, beside the click, which position the room should take in the route. */
  function ask(state, route, building, event) {
    const def = ctx.catalog.buildings.byId[building.buildingId];
    const already = route.stops.map((s, i) => (s.instanceId === building.instanceId ? i + 1 : null)).filter(Boolean);
    chooser.replaceChildren();

    const head = document.createElement('div');
    head.className = 'route-chooser-head';
    head.textContent = `Add ${def?.name ?? 'building'}, L${building.level}, as stop`;
    const shut = button('✕', 'Cancel', close, 'route-remove');
    head.appendChild(shut);
    chooser.appendChild(head);

    const places = document.createElement('div');
    places.className = 'route-chooser-places';
    for (let i = 0; i <= route.stops.length; i++) {
      const b = button(String(i + 1), i === route.stops.length ? `Add as stop ${i + 1}, the last` : `Add as stop ${i + 1}, before the current stop ${i + 1}`, () => {
        const current = routeOf(state);
        if (current) addAt(state, current, building, i);
        close();
      }, 'route-chooser-place');
      if (i < route.stops.length) b.style.setProperty('--seg', segmentColor(i));
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
