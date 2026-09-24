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
 * the view moves, fades once it stops, and stays while the pointer is on it.
 *
 * Reads state. Never writes it.
 */

import { pan, panX, focusLevel, overflowsX } from './viewport.js';
import { SHAFT_WIDTH } from './interpolate.js';
import { severityOf } from '../buildingStatus.js';

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
    el.addEventListener('pointerenter', () => { scroll.hover = true; });
    el.addEventListener('pointerleave', () => { scroll.hover = false; });
    // The wheel over the chrome scrolls the shaft under it, as it would over
    // a native scrollbar.
    el.addEventListener('wheel', (event) => {
      event.preventDefault();
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

    const show = scroll.hover || scroll.dragging || now - scroll.movedAt < LINGER_MS;
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

function pct(fraction) {
  return `${(fraction * 100).toFixed(3)}%`;
}
