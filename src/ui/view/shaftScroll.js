/**
 * shaftScroll.js
 * The shaft's scrollbars, and the minimap that shows while it is scrolling.
 *
 * The shaft does not scroll natively — the viewBox pans (viewport.js) — so
 * these are drawn in the DOM over the host and drive the same viewport calls
 * the wheel and the drag do. They read the viewport; they never own it.
 *
 * The minimap is the whole shaft at once: every floor numbered, the depth
 * bands along its edge, the part on screen outlined, and a dot beside a floor
 * for each room on it in trouble — red for stalled, orange for a warning,
 * judged by the same function as the inspector's status lines
 * (buildingStatus.js). It is instrument chrome, not a panel: it appears while
 * the view moves, fades once it stops, and stays while the pointer is on it
 * — or while a porter's route or a network is open, which it then draws.
 *
 * Reads state. Never writes it.
 */

import { pan, panX, focusLevel, overflowsX } from './viewport.js';
import { SHAFT_WIDTH, BUILD_X, roomRect } from './interpolate.js';
import { severityOf } from '../buildingStatus.js';
import * as selection from '../selection.js';
import { segmentsOf } from '../routePlan.js';
import { readNetwork, colorOf } from '../networkStatus.js';
import { isHub } from '../../systems/infrastructure/networkGraph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Pixels a route chevron travels per second, and the spacing between them. */
const FLOW_SPEED = 18;
const CHEVRON_EVERY = 22;

/** How long the minimap lingers after the view stops moving, in ms. */
const LINGER_MS = 1200;

/** A floor shows at most this many dots; the rest are in its title. */
const MAX_DOTS = 5;

/** Below this many pixels per floor, only every fifth floor is numbered. */
const DENSE_ROW_PX = 13;

export function createShaftScroll(host, view, state, ctx) {
  const { viewport } = view;
  const levelCount = state.levels.length;

  const vbar = div(host, 'shaft-scroll shaft-scroll-y');
  const vthumb = div(vbar, 'shaft-thumb');
  const hbar = div(host, 'shaft-scroll shaft-scroll-x');
  const hthumb = div(hbar, 'shaft-thumb');

  const map = div(host, 'shaft-minimap');
  map.setAttribute('role', 'navigation');
  map.setAttribute('aria-label', 'Shaft overview');
  const bands = div(map, 'minimap-bands');
  const rows = div(map, 'minimap-rows');
  const window_ = div(map, 'minimap-window');
  const routeBox = div(map, 'minimap-route');
  const routeSvg = document.createElementNS(SVG_NS, 'svg');
  routeBox.appendChild(routeSvg);
  let routeKey = null;
  const networkBox = div(map, 'minimap-network');
  const networkSvg = document.createElementNS(SVG_NS, 'svg');
  networkBox.appendChild(networkSvg);
  let networkKey = null;

  for (const band of ctx.tables?.levels?.depthBands ?? []) {
    const to = Math.min(band.toLevel ?? levelCount, levelCount);
    if (band.fromLevel > levelCount) continue;
    const b = div(bands, 'minimap-band');
    b.dataset.band = band.id;
    b.style.top = pct((band.fromLevel - 1) / levelCount);
    b.style.height = pct((to - band.fromLevel + 1) / levelCount);
    b.title = band.name;
    div(b, 'minimap-band-label').textContent = band.short ?? band.name.split(' ')[0].toUpperCase();
  }

  const rowNodes = state.levels.map((level) => {
    const row = div(rows, 'minimap-row');
    row.dataset.level = String(level.index);
    if (level.index % 5 === 0 || level.index === 1) row.classList.add('major');
    div(row, 'minimap-num').textContent = String(level.index);
    return { row, dots: div(row, 'minimap-dots'), key: '' };
  });

  const scroll = {
    lastTop: null,
    lastLeft: null,
    movedAt: -Infinity,
    hover: false,
    dragging: false,
    shown: false,
    statusTick: null,
    update,
  };

  for (const el of [map, vbar, hbar]) {
    el.addEventListener('pointerdown', () => selection.stopFollowing());
    el.addEventListener('pointerenter', () => { scroll.hover = true; });
    el.addEventListener('pointerleave', () => { scroll.hover = false; });
    // The wheel over the chrome scrolls the shaft under it, as it would over
    // a native scrollbar.
    el.addEventListener('wheel', (event) => {
      event.preventDefault();
      selection.stopFollowing();
      pan(viewport, event.deltaY * 0.02);
      panX(viewport, event.deltaX / viewport.scale);
    }, { passive: false });
  }

  // The thumb drags; a press on the track beside it jumps there and keeps
  // dragging, so a long trip down the shaft is one gesture.
  track(vbar, (event, rect, start) => {
    const perPx = levelCount / rect.height;
    if (start.onThumb) viewport.topLevel = start.top + (event.clientY - start.y) * perPx;
    else viewport.topLevel = 1 + (event.clientY - rect.top) * perPx - viewport.visibleLevels / 2;
    pan(viewport, 0);
  }, vthumb);
  track(hbar, (event, rect, start) => {
    const perPx = SHAFT_WIDTH / rect.width;
    if (start.onThumb) viewport.left = start.left + (event.clientX - start.x) * perPx;
    else viewport.left = (event.clientX - rect.left) * perPx - viewport.viewWidth / 2;
    panX(viewport, 0);
  }, hthumb);
  // The minimap is a map: pointing at a floor takes the view there.
  track(map, (event, rect) => {
    focusLevel(viewport, 1 + ((event.clientY - rect.top) / rect.height) * levelCount);
  });

  return scroll;

  function track(el, move, thumb = null) {
    el.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const start = {
        x: event.clientX, y: event.clientY, top: viewport.topLevel, left: viewport.left,
        onThumb: thumb !== null && thumb.contains(event.target),
      };
      scroll.dragging = true;
      el.setPointerCapture(event.pointerId);
      move(event, el.getBoundingClientRect(), start);
      const onMove = (e) => move(e, el.getBoundingClientRect(), start);
      const onUp = () => {
        scroll.dragging = false;
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }

  /** Per frame: thumbs, the minimap's window, and whether it shows. */
  function update(currentState, currentCtx, tick) {
    const now = performance.now();
    const { topLevel, left, visibleLevels, viewWidth } = viewport;
    if (scroll.lastTop !== null && (topLevel !== scroll.lastTop || left !== scroll.lastLeft)) scroll.movedAt = now;
    scroll.lastTop = topLevel;
    scroll.lastLeft = left;

    const top = pct((topLevel - 1) / levelCount);
    const height = pct(Math.min(1, visibleLevels / levelCount));
    vthumb.style.top = top;
    vthumb.style.height = height;
    window_.style.top = top;
    window_.style.height = height;

    const wide = overflowsX(viewport);
    host.classList.toggle('overflow-x', wide);
    if (wide) {
      hthumb.style.left = pct(left / SHAFT_WIDTH);
      hthumb.style.width = pct(viewWidth / SHAFT_WIDTH);
    }

    const { editing } = selection.get();
    const porter = editing ? currentState.population.workers.find((w) => w.id === editing) : null;
    host.classList.toggle('route-open', !!porter);
    syncRoute(currentState, porter);

    const { network } = selection.get();
    host.classList.toggle('network-open', !!network && !porter);
    syncNetwork(currentState, currentCtx, porter ? null : network);

    const show = !!porter || !!network || scroll.hover || scroll.dragging || now - scroll.movedAt < LINGER_MS;
    if (show !== scroll.shown) {
      scroll.shown = show;
      host.classList.toggle('scrolling', show);
    }

    // Row height decides whether every floor can carry its number.
    const rowPx = (viewport.host?.height ?? 0) / levelCount;
    map.classList.toggle('dense', rowPx > 0 && rowPx < DENSE_ROW_PX);

    // Room status changes on a tick, never between frames, and walking every
    // building's problems is too much to pay sixty times a second.
    if (tick !== scroll.statusTick) {
      scroll.statusTick = tick;
      syncStatus(currentState, currentCtx);
    }
  }

  /**
   * The open route on the minimap, redrawn when the route, the rooms or the
   * minimap's size change. Drawn in the overlay's own pixels, so the numbers
   * and chevrons keep their size however tall the shaft is.
   */
  function syncRoute(currentState, porter) {
    const w = routeBox.clientWidth;
    const h = routeBox.clientHeight;
    const key = porter ? JSON.stringify([porter.route, view.builtSignature, w, h]) : '';
    if (key === routeKey) return;
    routeKey = key;
    routeSvg.replaceChildren();
    if (!porter || w <= 0 || h <= 0) return;
    routeSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    // Each stop goes where its room is, then moves to the nearest spot clear
    // of every stop already placed: sideways along its floor first, and off
    // the floor's line only when the row is full — a storehouse the route
    // calls at seven times has more stops than one row has room for.
    const pad = 7;
    const clear = 15;
    const at = new Map();
    const placed = [];
    const free = (x, y) => x >= pad && x <= w - pad && y >= pad && y <= h - pad
      && placed.every(([px, py]) => Math.hypot(px - x, py - y) >= clear);
    const offsets = [];
    for (let dy = -3 * clear; dy <= 3 * clear; dy++) {
      for (let dx = -w; dx <= w; dx++) offsets.push([dx, dy, dx * dx + 4 * dy * dy]);
    }
    offsets.sort((a, b) => a[2] - b[2]);
    porter.route.forEach((stop, i) => {
      const b = currentState.buildings.find((x) => x.instanceId === stop.instanceId);
      if (!b) return;
      const r = roomRect(b, currentState.buildings);
      const x0 = pad + ((r.x + r.width / 2 - BUILD_X) / (SHAFT_WIDTH - BUILD_X)) * (w - pad * 2);
      const y0 = ((b.level - 0.5) / levelCount) * h;
      const hit = offsets.find(([dx, dy]) => free(x0 + dx, y0 + dy));
      const spot = hit ? [x0 + hit[0], y0 + hit[1]] : [x0, y0];
      placed.push(spot);
      at.set(i, spot);
    });

    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const seg of segmentsOf(currentState, porter.route)) {
      const a = at.get(seg.i);
      const b = at.get(seg.to);
      if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) continue;
      const d = `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
      const g = svgEl(routeSvg, 'g', 'route-line');
      g.style.setProperty('--seg', seg.color);
      svgEl(g, 'path', 'route-line-under').setAttribute('d', d);
      svgEl(g, 'path', 'route-line-over').setAttribute('d', d);
      chevrons(g, d, Math.hypot(b[0] - a[0], b[1] - a[1]), calm);
    }
    porter.route.forEach((stop, i) => {
      const p = at.get(i);
      if (!p) return;
      const g = svgEl(routeSvg, 'g', `minimap-stop route-${stop.action}`);
      g.setAttribute('transform', `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})`);
      svgEl(g, 'circle').setAttribute('r', '5.5');
      const t = svgEl(g, 'text');
      t.setAttribute('y', '3');
      t.textContent = String(i + 1);
    });
  }

  /**
   * The open network on the minimap: what each live hub reaches as a bar
   * down the left, every link as a line between its rooms, every node as a
   * square (a hub filled), and what nothing reaches in red. The whole Shaft
   * at once, which the view itself cannot show.
   */
  function syncNetwork(currentState, currentCtx, networkId) {
    const w = networkBox.clientWidth;
    const h = networkBox.clientHeight;
    const net = networkId ? readNetwork(currentState, currentCtx, networkId) : null;
    const key = net ? JSON.stringify([
      networkId, w, h, view.builtSignature,
      net.links.map((l) => l.id),
      net.groups.map((g) => [g.key, g.live]),
      [...net.reach.keys()],
      net.gaps.map((g) => `${g.level}:${g.instance?.instanceId ?? ''}`),
    ]) : '';
    if (key === networkKey) return;
    networkKey = key;
    networkSvg.replaceChildren();
    if (!net || w <= 0 || h <= 0) return;
    networkSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    networkSvg.style.setProperty('--net', colorOf(networkId));

    const pad = 6;
    const bar = 5;
    const xOf = (b) => {
      const r = roomRect(b, currentState.buildings);
      return bar + pad + ((r.x + r.width / 2 - BUILD_X) / (SHAFT_WIDTH - BUILD_X)) * (w - bar - pad * 2);
    };
    const yOf = (level) => ((level - 0.5) / levelCount) * h;
    const row = h / levelCount;

    for (const gap of net.gaps) {
      const r = svgEl(networkSvg, 'rect', 'minimap-net-gap');
      r.setAttribute('x', '0');
      r.setAttribute('y', (yOf(gap.level) - row / 2).toFixed(1));
      r.setAttribute('width', String(w));
      r.setAttribute('height', row.toFixed(1));
    }
    for (const level of net.reach.keys()) {
      const r = svgEl(networkSvg, 'rect', 'minimap-net-reach');
      r.setAttribute('x', '0');
      r.setAttribute('y', (yOf(level) - row / 2).toFixed(1));
      r.setAttribute('width', String(bar));
      r.setAttribute('height', (row + 0.5).toFixed(1));
    }
    for (const link of net.links) {
      const line = svgEl(networkSvg, 'path', 'minimap-net-link');
      line.setAttribute('d', `M${xOf(link.a).toFixed(1)} ${yOf(link.a.level).toFixed(1)}L${xOf(link.b).toFixed(1)} ${yOf(link.b.level).toFixed(1)}`);
    }
    const live = new Set(net.groups.filter((g) => g.live).map((g) => g.key));
    for (const node of net.graph.nodes) {
      const hub = isHub(currentCtx, networkId, node.buildingId);
      const sq = svgEl(networkSvg, 'rect', `minimap-net-node${hub ? ' hub' : ''}`);
      sq.dataset.live = String(live.has(net.graph.component.get(node.instanceId)));
      sq.setAttribute('x', (xOf(node) - 3).toFixed(1));
      sq.setAttribute('y', (yOf(node.level) - 3).toFixed(1));
      sq.setAttribute('width', '6');
      sq.setAttribute('height', '6');
    }
    for (const gap of net.gaps) {
      if (!gap.instance) continue;
      const dot = svgEl(networkSvg, 'circle', 'minimap-net-gap-room');
      dot.setAttribute('cx', xOf(gap.instance).toFixed(1));
      dot.setAttribute('cy', yOf(gap.level).toFixed(1));
      dot.setAttribute('r', '3');
    }
  }

  function syncStatus(currentState, currentCtx) {
    const perLevel = new Map();
    for (const instance of currentState.buildings) {
      const def = currentCtx.catalog.buildings.byId[instance.buildingId];
      const severity = severityOf(instance, def, currentState, currentCtx);
      if (!severity) continue;
      if (!perLevel.has(instance.level)) perLevel.set(instance.level, { stalled: 0, warning: 0 });
      perLevel.get(instance.level)[severity] += 1;
    }

    for (const node of rowNodes) {
      const level = Number(node.row.dataset.level);
      const { stalled = 0, warning = 0 } = perLevel.get(level) ?? {};
      const key = `${stalled}.${warning}`;
      if (key === node.key) continue;
      node.key = key;

      // Stalled first: the row reads worst-to-least from the number outwards.
      const dots = [];
      for (let k = 0; k < stalled && dots.length < MAX_DOTS; k++) dots.push('stalled');
      for (let k = 0; k < warning && dots.length < MAX_DOTS; k++) dots.push('warning');
      node.dots.replaceChildren(...dots.map((kind) => {
        const dot = document.createElement('span');
        dot.className = `minimap-dot ${kind}`;
        return dot;
      }));

      const said = [
        stalled && `${stalled} stalled`,
        warning && `${warning} with a warning`,
      ].filter(Boolean).join(', ');
      node.row.title = said ? `Level ${level}: ${said}` : `Level ${level}`;
      node.row.classList.toggle('stalled', stalled > 0);
      node.row.classList.toggle('warning', stalled === 0 && warning > 0);
    }
  }
}

function div(parent, className) {
  const d = document.createElement('div');
  d.className = className;
  parent.appendChild(d);
  return d;
}

/**
 * Chevrons riding a path in its direction, evenly spaced and all moving at one
 * speed however long the leg. With reduced motion they stand still, spread
 * along the path, which still says which way it runs.
 */
function chevrons(parent, d, length, calm) {
  const count = Math.max(1, Math.round(length / CHEVRON_EVERY));
  const dur = Math.max(0.5, length / FLOW_SPEED);
  for (let k = 0; k < count; k++) {
    const c = svgEl(parent, 'path', 'route-chevron');
    c.setAttribute('d', 'M-3 -3L2 0L-3 3z');
    const motion = svgEl(c, 'animateMotion');
    motion.setAttribute('path', d);
    motion.setAttribute('rotate', 'auto');
    motion.setAttribute('calcMode', 'linear');
    if (calm) {
      // Frozen at its share of the way along.
      const at = ((k + 0.5) / count).toFixed(3);
      motion.setAttribute('keyPoints', `${at};${at}`);
      motion.setAttribute('keyTimes', '0;1');
      motion.setAttribute('dur', '1s');
      motion.setAttribute('fill', 'freeze');
    } else {
      motion.setAttribute('dur', `${dur.toFixed(2)}s`);
      motion.setAttribute('begin', `${(-(k / count) * dur).toFixed(2)}s`);
      motion.setAttribute('repeatCount', 'indefinite');
    }
  }
}

function svgEl(parent, tag, className = '') {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  parent.appendChild(node);
  return node;
}

function pct(fraction) {
  return `${(fraction * 100).toFixed(3)}%`;
}
