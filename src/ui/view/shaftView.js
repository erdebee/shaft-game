/**
 * shaftView.js
 * The vertical cross-section — the "ant farm" cutaway of the settlement.
 *
 * Depth is the primary spatial idea, so this is a column, not a grid. All
 * geometry is in shaft units — 1:1 with sprite pixels — and mapped to the
 * screen by viewBox at a zoom that fills the host's width (viewport.js).
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
import { createShaftScroll } from './shaftScroll.js';
import { createRouteLayer } from './routeLayer.js';
import { createPlaceLayer } from './placeLayer.js';
import { createNetworkLayer } from './networkLayer.js';
import { shortages, inputsOf, nameOf } from '../../systems/resources/stores.js';
import { SPEEDS } from '../../core/clock.js';
import * as selection from '../selection.js';
import { breathable } from '../../core/selectors.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Shortage-popover geometry, in shaft units — which are sprite pixels, so
 * these are the icon's real size and nothing here scales (spec §2).
 *
 * The widest plate a 64-unit room can carry is three icons: 3 + 16 + 2 + 16 +
 * 2 + 16 + 3 = 58. That is where the cap on a one-slot room comes from, and
 * why a fourth shortage folds into a counter rather than making the plate
 * wider than the room it belongs to.
 *
 * Under each icon, a bar: a 1-unit edge one shade darker than the fill,
 * around a 14×2 channel. The edge never blinks — only the fill does — so an
 * empty bin's bar still has a shape at the bottom of the blink.
 */
const ICON = 16;
const SLOT_PITCH = 18;
const PLATE_PAD = 3;
const BAR_GAP = 1;
const BAR_H = 4;
const BAR_INNER = ICON - 2;
const PLATE_H = PLATE_PAD + ICON + BAR_GAP + BAR_H + PLATE_PAD;
const MAX_SLOTS = 4;

/**
 * @param art       the result of roomArt.loadRoomArt()
 * @param dispatch  sends a player command; used only by the open route's
 *                  clicks (routeLayer.js) and the open network's
 *                  (networkLayer.js)
 */
export function createShaftView(root, state, ctx, art, dispatch = () => {}) {
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
  };

  const viewport = createViewport({ levelCount: state.levels.length });

  // Cell bars sit BETWEEN the figures: over the people held behind them, under
  // everyone else. A guard or a porter walking along the Exit's floor passes
  // in front of the cage, so its cut cannot share the layer the stair rail is
  // in, which is over every figure.
  layers.held = group(svg, 'layer-held');
  layers.cages = group(svg, 'layer-cages');
  const figureLayer = createFigureLayer(svg, layers.held);

  // Drawn AFTER the figures: the stair rail a porter holds, the table a cook
  // stands at. It is a copy of pixels the room render already contains
  // (tools/cutForeground.mjs), so a room without a cut simply has nothing here.
  layers.foreground = group(svg, 'layer-foreground');

  // The open network (networkLayer.js): its ducts, pipes and cables run in
  // front of the rooms and the stair rail — they are hung on the Shaft's
  // walls, and the player is laying them.
  layers.networks = group(svg, 'layer-networks');

  // The open porter's route (routeLayer.js): over the rooms, the people and
  // the stair rail, because it is a drawing ON the shaft, not part of it.
  layers.routes = group(svg, 'layer-routes');

  // The building being put down (placeLayer.js): a ghost over everything in
  // the world, because it is the player's hand, not part of the shaft.
  layers.placing = group(svg, 'layer-placing');

  // Above even that: the shortage popovers. They are the one thing in this
  // view that is not part of the world, and a handrail drawn over a person is
  // correct while a handrail drawn over a room's alarm is not.
  layers.popovers = group(svg, 'layer-popovers');

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
  view.scroll = createShaftScroll(root, view, state, ctx);
  view.routes = createRouteLayer(view, root, dispatch, ctx);
  view.place = createPlaceLayer(view, root, dispatch);
  view.networks = createNetworkLayer(view, root, dispatch, ctx);

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
    // First, because following a porter moves the viewport this frame.
    view.routes.update(currentState, currentCtx, tick, alpha);
    view.place.update(currentState, currentCtx);
    svg.setAttribute('viewBox', viewBoxOf(view.viewport));

    // Ambient CSS loops stop with the simulation, so nobody keeps working
    // while the game is paused.
    const paused = currentState.clock.speed === SPEEDS.PAUSED;
    svg.classList.toggle('paused', paused);

    const now = performance.now();
    if (!paused && view.lastFrame !== null) view.ambient += Math.min(now - view.lastFrame, 100);
    view.lastFrame = now;

    syncBuildings(view, currentState, currentCtx, tick);
    syncSelection(view, currentState);
    syncSeams(view, currentState);
    syncLevels(view, currentState);
    view.networks.update(currentState, currentCtx);
    renderFigures(view.figureLayer, currentState, currentCtx, tick, alpha, view.viewport, view.art);
    view.scroll.update(currentState, currentCtx, tick);
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
function syncBuildings(view, state, ctx, tick) {
  const signature = state.buildings.map((b) => `${b.instanceId}@${b.level}.${b.slot}`).join(',');
  if (signature !== view.builtSignature) {
    view.builtSignature = signature;
    // A building that has just appeared has no popover state yet, so the
    // once-a-tick gate below has to run on this frame whatever the tick says.
    view.popoverTick = null;

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
      node.popover?.setAttribute('transform', `translate(${r.x} ${r.y})`);
    }
    for (const [id, node] of view.buildingNodes) {
      if (!seen.has(id)) {
        node.remove();
        node.foreground?.remove();
        node.popover?.remove();
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
    // Waiting for a porter with nowhere to put its produce. The other half of
    // waiting — short of an input — is the popover's job, and says which good.
    node.classList.toggle('blocked', instance.blocked === true && instance.starved !== true);
  }

  // Shortages change on a tick, never between frames, so this runs once per
  // tick instead of sixty times a second. It walks every building's recipes
  // and bins, which is far too much to pay for a viewBox update.
  if (tick !== view.popoverTick) {
    view.popoverTick = tick;
    for (const instance of state.buildings) {
      const node = view.buildingNodes.get(instance.instanceId);
      if (node?.popover) syncPopover(view, node, instance, ctx);
    }
  }
}

/**
 * Fill in one room's shortage popover: an icon per good it has run out of or
 * is running low on, worst first (stores.shortages).
 *
 * Hidden while the room is dark or wrecked, for the same reason the waiting
 * badge was: a building with no power is not short of coal in any sense the
 * player can act on, and saying so competes with the one thing they should
 * fix. Light first, then supply.
 */
function syncPopover(view, node, instance, ctx) {
  const pop = node.popover;
  const dead = instance.powered === false || instance.brokenDown === true;
  const list = dead ? [] : shortages(instance, ctx.catalog.buildings.byId[instance.buildingId], ctx);

  // A low bar's length is part of what is drawn, so it is part of the key —
  // in whole units, or the key would change every tick a bin moves at all.
  const key = list.map((s) => `${s.id}.${s.band}.${barWidth(s)}`).join(',');
  if (key === pop.key) return;
  pop.key = key;

  pop.classList.toggle('shown', list.length > 0);
  if (list.length === 0) return;

  // More shortages than the room is wide enough to show: the last slot counts
  // the rest instead of drawing one. The list is worst first, so what gets
  // folded away is always the least urgent.
  const over = list.length > pop.slots.length;
  const shown = over ? list.slice(0, pop.slots.length - 1) : list;
  const worst = list.some((s) => s.band === 'out') ? 'out' : 'low';

  pop.slots.forEach((slot, k) => {
    const entry = shown[k];
    const counter = over && k === pop.slots.length - 1;
    slot.g.classList.toggle('empty', !entry && !counter);
    slot.g.classList.toggle('counting', counter);
    if (counter) slot.text.textContent = `+${list.length - shown.length}`;
    // What the resource card (resourceTip.js) opens on when this is hovered.
    if (entry) slot.g.dataset.resource = entry.id;
    else delete slot.g.dataset.resource;
    if (!entry) return;
    const icon = view.art.icons?.get(entry.id);
    // A good with no icon yet still has to show: an empty slot would read as
    // "nothing wrong" rather than "art missing".
    slot.g.classList.toggle('untitled', !icon);
    if (icon) slot.image.setAttribute('href', icon.href);
    slot.text.textContent = icon ? '' : entry.id.slice(0, 2).toUpperCase();
    slot.mark.setAttribute('class', `stock-mark stock-${entry.band}`);
    slot.mark.setAttribute('width', String(barWidth(entry)));
    slot.edge.setAttribute('class', `stock-edge stock-${entry.band}`);
    // Only an empty bin blinks, and it is the attribute rather than the class
    // that says so, because that is what the pause and reduced-motion rules
    // select on (screens.css, Animation).
    if (entry.band === 'out') slot.mark.dataset.part = 'alarm';
    else delete slot.mark.dataset.part;
  });

  const count = pop.slots.filter((_, k) => shown[k] || (over && k === pop.slots.length - 1)).length;
  const width = PLATE_PAD * 2 + count * ICON + (count - 1) * (SLOT_PITCH - ICON);
  // The plate never takes a pointer, so a <title> on it would never be
  // hovered. The label is what a screen reader gets instead.
  pop.setAttribute('aria-label', list
    .map((e) => `${nameOf(ctx, e.id)}: ${e.band === 'out' ? 'none left' : 'running low'}`)
    .join(', '));

  pop.face.setAttribute('width', String(width));
  pop.lip.setAttribute('width', String(width));
  pop.plate.setAttribute('class', `stock-plate stock-${worst}`);
}

/**
 * How long a slot's bar is drawn, in whole units of the 14-unit channel. An
 * empty bin's bar is full length, because it is the alarm and has to be seen;
 * a low bin's is the share it still holds — at least one unit, so "nearly
 * gone" never draws as nothing.
 */
function barWidth(entry) {
  if (entry.band !== 'low') return BAR_INNER;
  return Math.max(1, Math.min(BAR_INNER, Math.round((entry.level ?? 0) * BAR_INNER)));
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

  if (art?.fg) g.foreground = foregroundNode(view, def, art.fg, width, art.fgFor === 'held' ? view.layers.cages : view.layers.foreground);

  // Real DOM nodes mean accessibility and hit-testing come free — one of the
  // reasons this view is SVG rather than canvas.
  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = `${def.name}, level ${instance.level}`;
  g.appendChild(title);

  // Bottom-right badge: a stack, when the store is full and nobody has come
  // to collect. There is no longer a matching badge for the other half of
  // waiting — being short of an input — because the popover says that, and
  // says WHICH good, in the same corner. A bare `!` next to the icons would
  // be the same sentence twice.
  const badge = document.createElementNS(SVG_NS, 'g');
  badge.setAttribute('class', 'badge badge-blocked');
  badge.setAttribute('transform', `translate(${width - 13} ${ROOM_HEIGHT - 13})`);
  const box = document.createElementNS(SVG_NS, 'rect');
  box.setAttribute('width', '10');
  box.setAttribute('height', '10');
  const glyph = document.createElementNS(SVG_NS, 'text');
  glyph.setAttribute('x', '5');
  glyph.setAttribute('y', '8.5');
  glyph.textContent = '\u2261';
  badge.append(box, glyph);
  g.appendChild(badge);

  // Only rooms that take something in can be short of anything. A storehouse,
  // a stairwell or a dig face never can, and gets no nodes at all.
  if (canRunShort(def, ctx)) {
    g.popover = popoverNode(view, width);
    g.popover.dataset.instance = instance.instanceId;
  }

  view.layers.buildings.appendChild(g);
  return g;
}

/** Whether this kind of building has anything it could run short OF. */
function canRunShort(def, ctx) {
  return inputsOf(def, ctx).size > 0 || (def.consumes ?? []).some((c) => c.id === 'water');
}

/**
 * A room's shortage popover: a plate along the top of the room carrying one
 * resource icon per good it is out of or running low on.
 *
 * A plate, not a tooltip. The player has to see it without pointing at
 * anything — noticing a building in trouble while looking somewhere else is
 * the entire job — so it is drawn, always, on the room itself. It is styled
 * like the rest of the game's chrome (principles §10): a recessed face with a
 * lit top edge, an instrument bolted to the room rather than a floating card.
 *
 * Left-aligned, and only because of how the shaft is read: rooms are stacked
 * in a column against the stairwell, so a plate at each room's left edge
 * lines up into a column of its own that the eye can run down. Anchoring it
 * to the right instead strands it 380 units away on a six-slot auditorium and
 * nowhere near the last one on a one-slot room.
 *
 * Every slot is built now and hidden by class later. Rooms come and go rarely
 * and shortages change constantly, so the cheap thing to do per tick is
 * toggle a class, never to make or destroy a node.
 */
function popoverNode(view, width) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'stock-popover');
  g.setAttribute('role', 'img');

  const plate = document.createElementNS(SVG_NS, 'g');
  plate.setAttribute('class', 'stock-plate');
  plate.setAttribute('transform', `translate(${PLATE_PAD} ${PLATE_PAD})`);
  g.appendChild(plate);

  const face = rect(plate, 'stock-face', 0, 0, 0, PLATE_H);
  const lip = rect(plate, 'stock-lip', 0, 0, 0, 1);

  const slots = [];
  const count = Math.max(1, Math.min(MAX_SLOTS, Math.floor((width - PLATE_PAD * 2) / SLOT_PITCH)));
  for (let k = 0; k < count; k++) {
    const slot = document.createElementNS(SVG_NS, 'g');
    slot.setAttribute('class', 'stock-slot empty');
    slot.setAttribute('transform', `translate(${PLATE_PAD + k * SLOT_PITCH} ${PLATE_PAD})`);
    const img = image(slot, 'stock-icon', '', 0, 0, ICON, ICON);
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', 'stock-text');
    text.setAttribute('x', String(ICON / 2));
    text.setAttribute('y', String(ICON / 2 + 4));
    slot.appendChild(text);
    const edge = rect(slot, 'stock-edge', 0, ICON + BAR_GAP, ICON, BAR_H);
    rect(slot, 'stock-track', 1, ICON + BAR_GAP + 1, BAR_INNER, BAR_H - 2);
    const mark = rect(slot, 'stock-mark', 1, ICON + BAR_GAP + 1, BAR_INNER, BAR_H - 2);
    plate.appendChild(slot);
    slots.push({ g: slot, image: img, text, edge, mark });
  }

  g.plate = plate;
  g.face = face;
  g.lip = lip;
  g.slots = slots;
  g.key = null;
  view.layers.popovers.appendChild(g);
  return g;
}

/**
 * A room's foreground: the same four state renders, cut down to what stands in
 * front of a person. It is a sibling of the building rather than a child
 * because it belongs to a different layer — after the figures, or for cell
 * bars after only the held ones — and syncBuildings moves and classes the two
 * together.
 */
function foregroundNode(view, def, fg, width, layer) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', `building building-foreground zone-${def.zone}`);
  for (const state of ['on', 'off', 'broken', 'dim']) {
    if (fg[state]) image(g, `room room-${state}`, fg[state], 0, 0, width, ROOM_HEIGHT);
  }
  layer.appendChild(g);
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
    nodes.air.dataset.air = airBand(breathable(level));
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
    selection.stopFollowing();
    view.place.cancelScroll();
    if (event.ctrlKey || event.metaKey) {
      // Continuous: a trackpad pinch arrives as a stream of small ctrl-wheel
      // deltas, a mouse wheel as a few large ones, and both should feel the
      // same. The viewport keeps the zoom across resizes.
      const anchor = levelAtClientY(view.viewport, event.clientY, svg.getBoundingClientRect(), true);
      zoom(view.viewport, Math.exp(-event.deltaY * 0.01), anchor);
    } else if (event.shiftKey && !event.deltaX) {
      // A mouse has no sideways wheel; shift turns the one it has.
      panX(view.viewport, event.deltaY / view.viewport.scale);
    } else {
      pan(view.viewport, event.deltaY * 0.02);
      panX(view.viewport, event.deltaX / view.viewport.scale);
    }
  }, { passive: false });

  let dragging = null;
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    view.place.cancelScroll();
    dragging = { x: event.clientX, y: event.clientY, top: view.viewport.topLevel, left: view.viewport.left };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    if (Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) > 4) selection.stopFollowing();
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
    // A room's shortage plate sits in a layer above the rooms, and its icons
    // take the pointer (for the resource card), so a click on one has to be
    // traced back to the room it belongs to.
    // While a building is being put down, a click is where it goes.
    if (selection.get().placing && view.place.pick(state, ctx, event)) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const plate = hit?.closest?.('.stock-popover');
    const node = hit?.closest?.('.building') ?? (plate ? view.buildingNodes.get(plate.dataset.instance) : null);
    // While a route is open, a room is a stop to add and a marker's ✕ a stop
    // to remove (routeLayer.js), not something to inspect.
    if (selection.get().editing && view.routes.pick(state, hit, node, event)) return;
    // While a network is open in the Infrastructure panel, a node is an end
    // of a link to lay (networkLayer.js).
    if (selection.get().network && view.networks.pick(state, hit, node)) return;
    const level = levelAtClientY(view.viewport, event.clientY, svg.getBoundingClientRect());
    if (node) selection.select({ instanceId: node.dataset.instance, level: Number(node.dataset.level) });
    else if (level >= 1 && level <= state.levels.length) selection.select({ level });
  });
  svg.addEventListener('pointercancel', () => { dragging = null; });
}
