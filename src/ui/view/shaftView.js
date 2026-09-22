/**
 * shaftView.js
 * The vertical cross-section — the "ant farm" cutaway of the settlement.
 *
 * Depth is the primary spatial idea, so this is a column, not a grid. All
 * geometry is in shaft units and mapped to the screen by viewBox, so the same
 * code serves a phone showing eight levels and a monitor showing forty. No
 * pixel dimension appears anywhere in this file.
 *
 * Structure is built once and mutated; only figures and animated parts are
 * touched per frame. That split is what keeps 60fps affordable: the expensive
 * work (creating nodes) happens on placement, not on every frame.
 *
 * Reads state. Never writes it. Player interaction dispatches commands.
 */

import {
  viewBoxOf, visibleRange, createViewport, pan, zoom, levelAtClientY, fitToElement,
} from './viewport.js';
import { levelY, slotRect, LEVEL_HEIGHT, SHAFT_WIDTH, STAIR_X, ELEVATOR_X } from './interpolate.js';
import { spriteFor } from './spriteMap.js';
import { createFigureLayer, renderFigures, renderCars } from './figures.js';
import { SPEEDS } from '../../core/clock.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Inline the sprite sheet into the document.
 *
 * It has to be inline: a <use href="external.svg#id"> does not inherit the
 * page's CSS custom properties, so tokens.css could not colour it, and "no raw
 * hex outside tokens.css" is a project rule.
 */
export async function loadSprites(path = './resources/assets/sprites/buildings.svg') {
  if (document.getElementById('sprite-sheet')) return;
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Sprite sheet not found: ${path}`);

  const host = document.createElement('div');
  host.id = 'sprite-sheet';
  host.hidden = true;
  host.innerHTML = await res.text();
  document.body.prepend(host);
}

export function createShaftView(root, state, ctx) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'shaft');
  // No width/height attributes on purpose — CSS sizes the element and the
  // viewBox does the scaling, which is what makes this resolution-independent.
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Cross-section of the Shaft');

  const layers = {
    structure: group(svg, 'layer-structure'),
    buildings: group(svg, 'layer-buildings'),
    networks: group(svg, 'layer-networks'),
  };

  const viewport = createViewport({ levelCount: state.levels.length });
  const figureLayer = createFigureLayer(svg);

  const view = {
    svg,
    layers,
    viewport,
    figureLayer,
    levelNodes: new Map(),
    buildingNodes: new Map(),
    builtSignature: null,
    /**
     * Player zoom, relative to whatever the element's aspect ratio fits.
     * 1 is an exact fit, so the drawing fills its box with no letterbox at
     * any window size. A level is much wider than it is tall, so that lands
     * around seven levels on a landscape window; seeing more of the shaft at
     * once is the wheel's job, not the default's.
     */
    zoomBias: 1,
    render,
  };

  buildStructure(view, state);
  attachInteraction(view, state, ctx);
  root.appendChild(svg);

  // Fit to the HOST, never to the svg: the svg's own width now derives from
  // the viewBox's intrinsic aspect ratio, so measuring it here would feed the
  // fit back into its own input and oscillate.
  fitToElement(view.viewport, root.getBoundingClientRect(), view.zoomBias);
  if (typeof ResizeObserver !== 'undefined') {
    view.resizeObserver = new ResizeObserver(([entry]) => {
      fitToElement(view.viewport, entry.contentRect, view.zoomBias);
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
    svg.classList.toggle('paused', currentState.clock.speed === SPEEDS.PAUSED);

    syncBuildings(view, currentState, currentCtx);
    syncLevels(view, currentState);
    renderCars(currentState, currentCtx, tick, alpha, view.buildingNodes);
    renderFigures(view.figureLayer, currentState, currentCtx, tick, alpha, view.viewport);
  }
}

function group(parent, className) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', className);
  parent.appendChild(g);
  return g;
}

/** Levels, the stairwell and the elevator shaft. Built once. */
function buildStructure(view, state) {
  const { first, last } = { first: 1, last: state.levels.length };

  for (let i = first; i <= last; i++) {
    const y = levelY(i);

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'level');
    g.dataset.level = String(i);

    rect(g, 'level-floor', 0, y + LEVEL_HEIGHT - 0.6, SHAFT_WIDTH, 0.6);
    rect(g, 'level-rock', 0, y, SHAFT_WIDTH, LEVEL_HEIGHT);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'level-label');
    label.setAttribute('x', '2');
    label.setAttribute('y', String(y + LEVEL_HEIGHT / 2 + 1));
    label.textContent = String(i);
    g.appendChild(label);

    view.layers.structure.appendChild(g);
    view.levelNodes.set(i, g);
  }

  // The stairwell and the elevator shaft run the full height as single spines.
  // The stairwell is wide enough to contain a figure at full switchback plus
  // its lane offset (see figures.js), so nobody appears to walk through rock.
  const height = state.levels.length * LEVEL_HEIGHT;
  rect(view.layers.structure, 'stairwell', STAIR_X - 5.5, 0, 11, height);
  rect(view.layers.structure, 'liftshaft-bore', ELEVATOR_X - 4, 0, 8, height);
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
  const signature = state.buildings.map((b) => b.instanceId).join(',');
  if (signature !== view.builtSignature) {
    view.builtSignature = signature;

    const seen = new Set();
    for (const instance of state.buildings) {
      seen.add(instance.instanceId);
      if (!view.buildingNodes.has(instance.instanceId)) {
        view.buildingNodes.set(instance.instanceId, createBuildingNode(view, state, ctx, instance));
      }
    }
    for (const [id, node] of view.buildingNodes) {
      if (!seen.has(id)) {
        node.remove();
        view.buildingNodes.delete(id);
      }
    }
  }

  // Per-frame state that shows on the sprite: power and condition.
  for (const instance of state.buildings) {
    const node = view.buildingNodes.get(instance.instanceId);
    if (!node) continue;
    node.classList.toggle('unpowered', instance.powered === false);
    node.classList.toggle('broken', instance.brokenDown === true);
    if (!view.viewport) continue;
  }
}

function createBuildingNode(view, state, ctx, instance) {
  const def = ctx.catalog.buildings.byId[instance.buildingId];
  const sprite = spriteFor(def);
  const level = state.levels.find((l) => l.index === instance.level);
  const r = slotRect(instance.slot ?? 0, instance.slots ?? 1, level?.buildSlots ?? 10, instance.level);

  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', `building zone-${def.zone}`);
  g.dataset.instance = instance.instanceId;
  g.dataset.building = def.id;

  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#sprite-${sprite.symbol}`);
  use.setAttribute('x', String(r.x));
  use.setAttribute('y', String(r.y));
  use.setAttribute('width', String(r.width));
  use.setAttribute('height', String(r.height));
  g.appendChild(use);

  // Real DOM nodes mean accessibility and hit-testing come free — one of the
  // reasons this view is SVG rather than canvas.
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = `${def.name}, level ${instance.level}`;
  g.appendChild(title);

  view.layers.buildings.appendChild(g);
  return g;
}

/** Level classes that change: sealed, and air quality banding. */
function syncLevels(view, state) {
  const { first, last } = visibleRange(view.viewport);
  for (let i = first; i <= last; i++) {
    const node = view.levelNodes.get(i);
    if (!node) continue;
    const level = state.levels[i - 1];
    if (!level) continue;

    node.classList.toggle('sealed', level.sealed === true);
    node.dataset.air = airBand(level.airQuality);
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
      const factor = event.deltaY > 0 ? 1.15 : 0.87;
      const anchor = levelAtClientY(view.viewport, event.clientY, svg.getBoundingClientRect());
      const before = view.viewport.visibleLevels;
      zoom(view.viewport, factor, anchor);
      // Track zoom as a ratio of the fitted baseline, so the next resize
      // preserves the player's zoom instead of snapping back to fit.
      if (view.viewport.visibleLevels !== before) {
        view.zoomBias *= view.viewport.visibleLevels / before;
      }
    } else {
      pan(view.viewport, event.deltaY * 0.02);
    }
  }, { passive: false });

  let dragging = null;
  svg.addEventListener('pointerdown', (event) => {
    dragging = { y: event.clientY, top: view.viewport.topLevel };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const perPixel = view.viewport.visibleLevels / rect.height;
    view.viewport.topLevel = dragging.top - (event.clientY - dragging.y) * perPixel;
    pan(view.viewport, 0);
  });
  svg.addEventListener('pointerup', () => { dragging = null; });
  svg.addEventListener('pointercancel', () => { dragging = null; });
}
