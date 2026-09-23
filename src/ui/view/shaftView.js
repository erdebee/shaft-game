/**
 * shaftView.js
 * The vertical cross-section — the "ant farm" cutaway of the settlement.
 *
 * Depth is the primary spatial idea, so this is a column, not a grid. All
 * geometry is in shaft units — 1:1 with sprite pixels — and mapped to the
 * screen by viewBox at a whole-number zoom (viewport.js).
 *
 * Rooms are the approved pixel renders from the asset manifest (roomArt.js),
 * one <image> per state with CSS choosing which shows. A building with no
 * render yet draws as a plain block, so a new catalog entry is still visible.
 *
 * Structure is built once and mutated; only figures and animated parts are
 * touched per frame. That split is what keeps 60fps affordable: the expensive
 * work (creating nodes) happens on placement, not on every frame.
 *
 * Reads state. Never writes it. Player interaction dispatches commands.
 */

import {
  viewBoxOf, visibleRange, createViewport, pan, panX, zoom, levelAtClientY, fitToElement,
} from './viewport.js';
import {
  levelY, roomRect, visualJitter, LEVEL_HEIGHT, ROOM_HEIGHT, SHAFT_WIDTH, STAIR_WIDTH, BUILD_X, SEAM,
} from './interpolate.js';
import { imageEdge, seamImage, roomState, createFlicker } from './roomArt.js';
import { createFigureLayer, renderFigures } from './figures.js';
import { SPEEDS } from '../../core/clock.js';
import * as selection from '../selection.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param art  the result of roomArt.loadRoomArt()
 */
export function createShaftView(root, state, ctx, art) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'shaft');
  // No width/height attributes on purpose — CSS sizes the element and the
  // viewBox does the scaling, which is what makes this resolution-independent.
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Cross-section of the Shaft');

  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);

  const layers = {
    structure: group(svg, 'layer-structure'),
    buildings: group(svg, 'layer-buildings'),
    seams: group(svg, 'layer-seams'),
    overlays: group(svg, 'layer-overlays'),
    networks: group(svg, 'layer-networks'),
  };

  const viewport = createViewport({ levelCount: state.levels.length });
  const figureLayer = createFigureLayer(svg);

  // The one layer that draws AFTER the figures: the stair rail a porter holds,
  // the bars a prisoner stands behind, the table a cook stands at. It is a
  // copy of pixels the room render already contains (tools/cutForeground.mjs),
  // so a room without a cut simply has nothing here.
  layers.foreground = group(svg, 'layer-foreground');

  const view = {
    svg,
    defs,
    art,
    layers,
    viewport,
    figureLayer,
    levelNodes: new Map(),
    buildingNodes: new Map(),
    builtSignature: null,
    seamSignature: null,
    /** Ambient time (ms) for the light flicker; it stops while paused. */
    ambient: 0,
    lastFrame: null,
    render,
  };

  buildStructure(view, state, ctx);
  attachInteraction(view, state, ctx);
  root.appendChild(svg);

  // Fit to the HOST, never to the svg: the svg's own width now derives from
  // the viewBox's intrinsic aspect ratio, so measuring it here would feed the
  // fit back into its own input and oscillate.
  fitToElement(view.viewport, root.getBoundingClientRect());
  if (typeof ResizeObserver !== 'undefined') {
    view.resizeObserver = new ResizeObserver(([entry]) => {
      fitToElement(view.viewport, entry.contentRect);
    });
    view.resizeObserver.observe(root);
  }

  return view;

  /**
   * Per-frame update. Deliberately cheap: a viewBox string, a handful of
   * class toggles, and the figure transforms.
   */
  function render(currentState, currentCtx, tick, alpha) {
    svg.setAttribute('viewBox', viewBoxOf(view.viewport));

    // Ambient CSS loops stop with the simulation, so nobody keeps working
    // while the game is paused.
    const paused = currentState.clock.speed === SPEEDS.PAUSED;
    svg.classList.toggle('paused', paused);

    const now = performance.now();
    if (!paused && view.lastFrame !== null) view.ambient += Math.min(now - view.lastFrame, 100);
    view.lastFrame = now;

    syncBuildings(view, currentState, currentCtx);
    syncSelection(view, currentState);
    syncSeams(view, currentState);
    syncLevels(view, currentState);
    renderFigures(view.figureLayer, currentState, currentCtx, tick, alpha, view.viewport, view.art);
  }
}

/**
 * Outline what the player has picked: the selected building, or the whole
 * selected level when it is a level they are building on.
 */
function syncSelection(view, state) {
  const { instanceId, level } = selection.get();
  if (!view.levelMarker) {
    view.levelMarker = document.createElementNS(SVG_NS, 'rect');
    view.levelMarker.setAttribute('class', 'level-selected');
    view.buildingMarker = document.createElementNS(SVG_NS, 'rect');
    view.buildingMarker.setAttribute('class', 'building-selected');
    view.layers.overlays.append(view.levelMarker, view.buildingMarker);
  }

  // A demolished selection leaves nothing to outline.
  const instance = instanceId ? state.buildings.find((b) => b.instanceId === instanceId) : null;
  view.buildingMarker.style.display = instance ? '' : 'none';
  if (instance) {
    const r = roomRect(instance, state.buildings);
    view.buildingMarker.setAttribute('x', String(r.x + 0.5));
    view.buildingMarker.setAttribute('y', String(r.y + 0.5));
    view.buildingMarker.setAttribute('width', String(r.width - 1));
    view.buildingMarker.setAttribute('height', String(r.height - 1));
  }

  const showLevel = !instanceId && level !== null;
  view.levelMarker.style.display = showLevel ? '' : 'none';
  if (showLevel) {
    view.levelMarker.setAttribute('x', String(BUILD_X));
    view.levelMarker.setAttribute('y', String(levelY(level)));
    view.levelMarker.setAttribute('width', String(SHAFT_WIDTH - BUILD_X));
    view.levelMarker.setAttribute('height', String(LEVEL_HEIGHT));
  }
}

function group(parent, className) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', className);
  parent.appendChild(g);
  return g;
}

/**
 * Levels and the stairwell. Built once.
 *
 * Rock and stairwell are tiled with <pattern>s whose tiles are one level tall,
 * so they line up with the levels by construction.
 */
function buildStructure(view, state, ctx) {
  const height = state.levels.length * LEVEL_HEIGHT;
  const bands = ctx.tables?.levels?.depthBands ?? [];
  const rockPattern = new Map();

  for (const level of state.levels) {
    const i = level.index;
    const y = levelY(i);
    const band = bands.find((b) => i >= b.fromLevel && (b.toLevel === null || i <= b.toLevel))?.id;

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'level');
    g.dataset.level = String(i);

    const rock = rect(g, 'level-rock', BUILD_X, y, SHAFT_WIDTH - BUILD_X, LEVEL_HEIGHT);
    const rockHref = band && view.art.rock(band);
    if (rockHref) {
      if (!rockPattern.has(band)) rockPattern.set(band, tilePattern(view, `rock-${band}`, rockHref, 64, LEVEL_HEIGHT));
      rock.style.fill = `url(#${rockPattern.get(band)})`; // inline: the stylesheet's flat fill beats an attribute
    }
    rect(g, 'level-floor', BUILD_X, y + ROOM_HEIGHT, SHAFT_WIDTH - BUILD_X, LEVEL_HEIGHT - ROOM_HEIGHT);
    rect(g, 'level-floor-edge', BUILD_X, y + ROOM_HEIGHT, SHAFT_WIDTH - BUILD_X, 1);
    view.layers.structure.appendChild(g);

    // Air and sealing show as a wash over the whole level, rooms included.
    const air = rect(view.layers.overlays, 'level-air', BUILD_X, y, SHAFT_WIDTH - BUILD_X, ROOM_HEIGHT);
    view.levelNodes.set(i, { node: g, air });
  }

  // The stairwell runs the full height as one spine, its levels numbered on
  // each tile's sign plate in the floor-digit font.
  const stair = view.art.stairwell;
  const well = rect(view.layers.structure, 'stairwell', 0, 0, STAIR_WIDTH, height);
  if (stair) {
    well.style.fill = `url(#${tilePattern(view, 'stairwell', stair.href, stair.width, stair.height)})`;
    for (const level of state.levels) floorNumber(view, level.index, stair.signPlate);
  }

  // The rail, tiled from the same spine so it lines up with the stairs by
  // construction, over the porters climbing them.
  if (stair?.fg) {
    const rail = rect(view.layers.foreground, 'stairwell-fg', 0, 0, STAIR_WIDTH, height);
    rail.style.fill = `url(#${tilePattern(view, 'stairwell-fg', stair.fg, stair.width, stair.height)})`;
  }
}

function tilePattern(view, id, href, width, height) {
  const p = document.createElementNS(SVG_NS, 'pattern');
  p.setAttribute('id', `tile-${id}`);
  p.setAttribute('patternUnits', 'userSpaceOnUse');
  p.setAttribute('width', String(width));
  p.setAttribute('height', String(height));
  const img = image(p, 'tile', href, 0, 0, width, height);
  img.removeAttribute('class');
  view.defs.appendChild(p);
  return `tile-${id}`;
}

/** The level number, centred on the stairwell's sign plate, one rect per lit pixel. */
function floorNumber(view, level, plate) {
  const { font } = view.art;
  if (!font || !plate) return;
  const [x0, y0, x1, y1] = plate;
  const digits = String(level);
  const step = font.width + font.spacing;
  const width = digits.length * step - font.spacing;
  const tx = Math.floor((x0 + x1 + 1 - width) / 2);
  const ty = levelY(level) + Math.floor((y0 + y1 + 1 - font.height) / 2);

  const path = [];
  [...digits].forEach((d, j) => font.glyphs[d]?.forEach((row, r) => [...row].forEach((bit, c) => {
    if (bit === '1') path.push(`M${tx + j * step + c} ${ty + r}h1v1h-1z`);
  })));

  const node = document.createElementNS(SVG_NS, 'path');
  node.setAttribute('class', 'level-number');
  node.setAttribute('d', path.join(''));
  view.layers.structure.appendChild(node);
}

function image(parent, className, href, x, y, width, height) {
  const img = document.createElementNS(SVG_NS, 'image');
  img.setAttribute('class', className);
  img.setAttribute('href', href);
  img.setAttribute('x', String(x));
  img.setAttribute('y', String(y));
  img.setAttribute('width', String(width));
  img.setAttribute('height', String(height));
  parent.appendChild(img);
  return img;
}

function rect(parent, className, x, y, width, height) {
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('class', className);
  r.setAttribute('x', String(x));
  r.setAttribute('y', String(y));
  r.setAttribute('width', String(width));
  r.setAttribute('height', String(height));
  parent.appendChild(r);
  return r;
}

/**
 * Create nodes for newly placed buildings and remove demolished ones.
 * Keyed off a signature so the common case — nothing changed — costs one
 * string comparison rather than a diff.
 */
function syncBuildings(view, state, ctx) {
  const signature = state.buildings.map((b) => `${b.instanceId}@${b.level}.${b.slot}`).join(',');
  if (signature !== view.builtSignature) {
    view.builtSignature = signature;

    const seen = new Set();
    for (const instance of state.buildings) {
      seen.add(instance.instanceId);
      if (!view.buildingNodes.has(instance.instanceId)) {
        view.buildingNodes.set(instance.instanceId, createBuildingNode(view, ctx, instance));
      }
      // A room's x depends on the rooms to its left (roomRect), so every
      // placement or demolition re-seats the whole row.
      const r = roomRect(instance, state.buildings);
      const node = view.buildingNodes.get(instance.instanceId);
      node.setAttribute('transform', `translate(${r.x} ${r.y})`);
      node.foreground?.setAttribute('transform', `translate(${r.x} ${r.y})`);
    }
    for (const [id, node] of view.buildingNodes) {
      if (!seen.has(id)) {
        node.remove();
        node.foreground?.remove();
        view.buildingNodes.delete(id);
      }
    }
  }

  // Per-frame state that shows on the sprite: power, condition and flicker.
  // CSS picks the matching render from these classes.
  const calm = reducedMotion();
  for (const instance of state.buildings) {
    const node = view.buildingNodes.get(instance.instanceId);
    if (!node) continue;
    // The foreground carries the same classes, because it holds its own render
    // of each state and the same stylesheet rules choose between them.
    const dipped = node.flicker ? !calm && node.flicker(view.ambient) : false;
    for (const target of node.foreground ? [node, node.foreground] : [node]) {
      target.classList.toggle('unpowered', instance.powered === false);
      target.classList.toggle('broken', instance.brokenDown === true);
      if (node.flicker) target.classList.toggle('flicker', dipped);
    }
  }
}

function createBuildingNode(view, ctx, instance) {
  const def = ctx.catalog.buildings.byId[instance.buildingId];
  const art = view.art.rooms.get(def.id);
  const width = 64 * (instance.slots ?? def.slots ?? 1);

  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', `building zone-${def.zone}`);
  g.dataset.instance = instance.instanceId;
  g.dataset.level = String(instance.level);
  g.dataset.building = def.id;

  if (art) {
    image(g, 'room room-on', art.on, 0, 0, width, ROOM_HEIGHT);
    image(g, 'room room-off', art.off, 0, 0, width, ROOM_HEIGHT);
    image(g, 'room room-broken', art.broken, 0, 0, width, ROOM_HEIGHT);
    if (art.dim) {
      image(g, 'room room-dim', art.dim, 0, 0, width, ROOM_HEIGHT);
      g.flicker = createFlicker(instance.instanceId);
    }
    if (art.anim) {
      // The strip slides under a room-sized window, one frame per step. It is
      // an ambient loop, so it pauses with the clock like every [data-part].
      const win = document.createElementNS(SVG_NS, 'svg');
      win.setAttribute('class', 'room room-anim');
      win.setAttribute('width', String(width));
      win.setAttribute('height', String(ROOM_HEIGHT));
      win.setAttribute('viewBox', `0 0 ${width} ${ROOM_HEIGHT}`);
      const strip = image(win, 'room-strip', art.anim.href, 0, 0, width * art.anim.frames, ROOM_HEIGHT);
      strip.dataset.part = 'strip';
      strip.style.setProperty('--strip-width', String(width * art.anim.frames));
      strip.style.setProperty('--frames', String(art.anim.frames));
      strip.style.setProperty('--strip-duration', `${art.anim.frames * art.anim.frameMs}ms`);
      strip.style.animationDelay = `${(-visualJitter(instance.instanceId) * art.anim.frames * art.anim.frameMs).toFixed(0)}ms`;
      g.appendChild(win);
    }
  } else {
    const block = document.createElementNS(SVG_NS, 'rect');
    block.setAttribute('class', 'room-missing');
    block.setAttribute('width', String(width));
    block.setAttribute('height', String(ROOM_HEIGHT));
    g.appendChild(block);
  }

  if (art?.fg) g.foreground = foregroundNode(view, def, art.fg, width);

  // Real DOM nodes mean accessibility and hit-testing come free — one of the
  // reasons this view is SVG rather than canvas.
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = `${def.name}, level ${instance.level}`;
  g.appendChild(title);

  view.layers.buildings.appendChild(g);
  return g;
}

/**
 * A room's foreground: the same four state renders, cut down to what stands in
 * front of a person. It is a sibling of the building rather than a child
 * because it belongs to a different layer — the one after the figures — and
 * syncBuildings moves and classes the two together.
 */
function foregroundNode(view, def, fg, width) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', `building building-foreground zone-${def.zone}`);
  for (const state of ['on', 'off', 'broken', 'dim']) {
    if (fg[state]) image(g, `room room-${state}`, fg[state], 0, 0, width, ROOM_HEIGHT);
  }
  view.layers.foreground.appendChild(g);
  return g;
}

/**
 * The seams between neighbouring rooms, and between the stairwell and the
 * first room. Each fades the two edges it sits between, so it is redrawn when
 * a neighbour is placed, removed or changes state; a flicker does not count.
 */
function syncSeams(view, state) {
  const rows = new Map();
  for (const b of state.buildings) {
    if (!rows.has(b.level)) rows.set(b.level, []);
    rows.get(b.level).push(b);
  }

  const seams = [];
  for (const row of rows.values()) {
    row.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    row.forEach((b, k) => {
      const art = view.art.rooms.get(b.buildingId);
      if (!art) return;
      const r = roomRect(b, state.buildings);
      const prev = row[k - 1];
      const prevArt = prev && view.art.rooms.get(prev.buildingId);
      let left = null;
      if (prevArt && (prev.slot ?? 0) + (prev.slots ?? 1) === (b.slot ?? 0)) {
        left = [prevArt[roomState(prev)], -1];
      } else if ((b.slot ?? 0) === 0 && view.art.stairwell) {
        left = [view.art.stairwell.href, STAIR_WIDTH - 1];
      }
      const right = [art[roomState(b)], 0];
      seams.push({ x: r.x - SEAM, y: r.y, left: left ?? right, right });
    });
  }

  const signature = seams.map((m) => `${m.x},${m.y},${m.left},${m.right}`).join('|');
  if (signature === view.seamSignature) return;
  view.seamSignature = signature;

  Promise.all(seams.map((m) => Promise.all([imageEdge(...m.left), imageEdge(...m.right)]))).then((edges) => {
    if (view.seamSignature !== signature) return; // superseded while loading
    const layer = view.layers.seams;
    layer.replaceChildren();
    seams.forEach((m, k) => {
      const [L, R] = edges[k];
      if (!L || !R) return;
      image(layer, 'seam', seamImage(L, R, m.x), m.x, m.y, SEAM, ROOM_HEIGHT);
    });
  });
}

function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Level classes that change: sealed, and air quality banding. */
function syncLevels(view, state) {
  const { first, last } = visibleRange(view.viewport);
  for (let i = first; i <= last; i++) {
    const nodes = view.levelNodes.get(i);
    if (!nodes) continue;
    const level = state.levels[i - 1];
    if (!level) continue;

    nodes.node.classList.toggle('sealed', level.sealed === true);
    nodes.air.dataset.air = airBand(level.airQuality);
  }
}

function airBand(quality) {
  if (quality >= 70) return 'good';
  if (quality >= 40) return 'poor';
  return 'critical';
}

/**
 * Pan and zoom. Wheel and drag now; the same viewport calls are what touch
 * gestures would drive when mobile support lands, which is why zoom() takes an
 * anchor level rather than assuming the centre.
 */
function attachInteraction(view, state, ctx) {
  const { svg } = view;

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      // One whole zoom step per wheel gesture burst; the viewport keeps the
      // chosen scale across resizes.
      const now = performance.now();
      if (now - (view.lastZoom ?? 0) < 180) return;
      view.lastZoom = now;
      const anchor = levelAtClientY(view.viewport, event.clientY, svg.getBoundingClientRect());
      zoom(view.viewport, event.deltaY > 0 ? -1 : 1, anchor);
    } else {
      pan(view.viewport, event.deltaY * 0.02);
      panX(view.viewport, event.deltaX / view.viewport.scale);
    }
  }, { passive: false });

  let dragging = null;
  svg.addEventListener('pointerdown', (event) => {
    dragging = { x: event.clientX, y: event.clientY, top: view.viewport.topLevel, left: view.viewport.left };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const perPixel = view.viewport.visibleLevels / rect.height;
    view.viewport.topLevel = dragging.top - (event.clientY - dragging.y) * perPixel;
    view.viewport.left = dragging.left - (event.clientX - dragging.x) / view.viewport.scale;
    pan(view.viewport, 0);
    panX(view.viewport, 0);
  });
  svg.addEventListener('pointerup', (event) => {
    // A press that barely moved is a click: pick what is under it. Anything
    // further was a drag, and a drag only pans.
    const moved = dragging && Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y);
    dragging = null;
    if (moved === null || moved > 4) return;
    // Pointer capture retargets pointerup to the svg itself, so what was
    // clicked has to be found at the pointer, not read off the event.
    const node = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.building');
    const level = levelAtClientY(view.viewport, event.clientY, svg.getBoundingClientRect());
    if (node) selection.select({ instanceId: node.dataset.instance, level: Number(node.dataset.level) });
    else if (level >= 1 && level <= state.levels.length) selection.select({ level });
  });
  svg.addEventListener('pointercancel', () => { dragging = null; });
}
