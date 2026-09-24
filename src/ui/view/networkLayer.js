/**
 * networkLayer.js
 * The open network, drawn on the shaft while the Infrastructure panel has it
 * open (selection.network).
 *
 *   - every link, as a conduit in the network's colour: along the ceiling of
 *     each room it joins to a riser beside the stairwell (a drain dashed,
 *     and marked with the way it runs)
 *   - every node outlined, hubs tagged — a junction with its priority
 *   - what each live hub reaches, as a bar beside the stairwell
 *   - what nothing reaches: its room outlined in red, or its level washed red
 *
 * A click on a node starts a link, a click on a second lays it and carries
 * on from there; clicking the first again, a click on empty rock, or Esc
 * stops. While a link is being laid, a dashed line follows the pointer to
 * the room under it, green where it can go and red where it cannot.
 *
 * UI, not world: nothing here is saved, and the only thing it writes is the
 * player:link command a click asks for.
 */

import { roomRect, levelY, ROOM_HEIGHT, BUILD_X, SHAFT_WIDTH } from './interpolate.js';
import * as selection from '../selection.js';
import { readNetwork, colorOf, roleOf } from '../networkStatus.js';
import { canLink, isNode, isHub, networkDef } from '../../systems/infrastructure/networkGraph.js';
import { priorityOf } from '../../systems/power/priorityLadder.js';
import { inStorehouses } from '../../systems/resources/stores.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The reach bars stand in the stairwell's right edge, staggered so they do not hide each other. */
const BAR_W = 4;
const BAR_STEP = 6;

/** The risers links run down, just inside the stairwell, left of the reach bars. */
const RISER_X = BUILD_X - 26;
const RISER_STEP = 7;

export function createNetworkLayer(view, root, dispatch, ctx) {
  const layer = svg(view.layers.networks, 'g', 'network-layer');
  const bars = svg(layer, 'g', 'net-bars');
  const washes = svg(layer, 'g', 'net-washes');
  const lines = svg(layer, 'g', 'net-lines');
  const outlines = svg(layer, 'g', 'net-outlines');
  const preview = svg(layer, 'path', 'net-preview');
  preview.style.display = 'none';

  const layerState = { key: null, state: null, hover: null };

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selection.get().linkFrom) selection.startLink(null);
  });

  // The preview line follows the pointer to the room under it.
  view.svg.addEventListener('pointermove', (event) => {
    const { network, linkFrom } = selection.get();
    if (!network || !linkFrom || !layerState.state) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const node = hit?.closest?.('.building');
    const id = node?.dataset.instance ?? null;
    if (id === layerState.hover) return;
    layerState.hover = id;
    drawPreview(layerState.state);
  });

  return { update, pick };

  function update(state, currentCtx) {
    layerState.state = state;
    const { network, linkFrom } = selection.get();
    layer.style.display = network ? '' : 'none';
    if (!network) {
      layerState.key = null;
      return;
    }
    const net = readNetwork(state, currentCtx, network);
    const key = JSON.stringify([
      network, linkFrom, view.builtSignature,
      net.links.map((l) => l.id),
      net.groups.map((g) => [g.key, g.live, g.nodes.length]),
      [...net.reach.keys()],
      net.gaps.map((g) => `${g.level}:${g.instance?.instanceId ?? ''}`),
      network === 'power-grid' ? state.buildings.map((b) => b.priority ?? '') : null,
    ]);
    if (key === layerState.key) return;
    layerState.key = key;
    draw(state, currentCtx, network, net, linkFrom);
    drawPreview(state);
  }

  function draw(state, currentCtx, network, net, linkFrom) {
    for (const g of [bars, washes, lines, outlines]) g.replaceChildren();
    layer.style.setProperty('--net', colorOf(network));
    const def = networkDef(currentCtx, network);

    // What nothing reaches: a level washed red, or a room outlined red.
    const washed = new Set();
    for (const gap of net.gaps) {
      if (gap.instance) {
        const r = roomRect(gap.instance, state.buildings);
        rect(outlines, 'net-gap-room', r.x + 1.5, r.y + 1.5, r.width - 3, r.height - 3);
      } else if (!washed.has(gap.level)) {
        washed.add(gap.level);
        rect(washes, 'net-gap-level', BUILD_X, levelY(gap.level), SHAFT_WIDTH - BUILD_X, ROOM_HEIGHT);
      }
    }

    // What each live hub reaches.
    const live = new Set(net.groups.filter((g) => g.live).map((g) => g.key));
    const hubs = net.graph.nodes.filter((n) => isHub(currentCtx, network, n.buildingId));
    hubs.forEach((hub, i) => {
      const reach = currentCtx.catalog.buildings.byId[hub.buildingId].serviceRadiusLevels ?? 0;
      const top = Math.max(1, hub.level - reach);
      const bottom = Math.min(state.levels.length, hub.level + reach);
      const x = BUILD_X - BAR_W - 2 - (i % 3) * BAR_STEP;
      const bar = rect(bars, 'net-reach', x, levelY(top) + 4, BAR_W, levelY(bottom) - levelY(top) + ROOM_HEIGHT - 8);
      bar.dataset.live = String(live.has(net.graph.component.get(hub.instanceId)) && !hub.brokenDown);
      const tick = rect(bars, 'net-reach-hub', x - 2, levelY(hub.level) + ROOM_HEIGHT / 2 - 2, BAR_W + 4, 4);
      tick.dataset.live = bar.dataset.live;
    });

    // The links, as conduits: along the ceiling of each room to a riser
    // beside the stairwell, and down the riser. Links are staggered across a
    // few risers so two that overlap stay tellable.
    net.links.forEach((link, i) => {
      const [top, bottom] = link.a.level <= link.b.level ? [link.a, link.b] : [link.b, link.a];
      const a = anchor(top, state);
      const b = anchor(bottom, state);
      const riser = RISER_X - (i % 3) * RISER_STEP;
      const d = `M${a.x} ${a.y}H${riser}V${b.y}H${b.x}`;
      svg(lines, 'path', 'net-line-under').setAttribute('d', d);
      const over = svg(lines, 'path', `net-line-over${def?.flowsDownhill ? ' net-line-drain' : ''}`);
      over.setAttribute('d', d);
      for (const end of [a, b]) {
        const dot = svg(lines, 'circle', 'net-joint');
        dot.setAttribute('cx', String(end.x));
        dot.setAttribute('cy', String(end.y));
        dot.setAttribute('r', '3.5');
      }
      if (def?.flowsDownhill && b.y - a.y > 40) {
        // A chevron on the riser, pointing the way it drains.
        const my = (a.y + b.y) / 2;
        const chevron = svg(lines, 'path', 'net-chevron');
        chevron.setAttribute('d', `M${riser - 5} ${my - 3}l5 6l5 -6`);
      }
    });

    // The nodes, outlined and tagged.
    for (const node of net.graph.nodes) {
      const r = roomRect(node, state.buildings);
      const outline = rect(outlines, 'net-node-outline', r.x + 1, r.y + 1, r.width - 2, r.height - 2);
      if (node.instanceId === linkFrom) outline.classList.add('net-from');
      const role = roleOf(currentCtx, network, node);
      const label = network === 'power-grid' && isHub(currentCtx, network, node.buildingId)
        ? `P${priorityOf(node, currentCtx)}`
        : role.toUpperCase().slice(0, 6);
      const tag = svg(outlines, 'g', 'net-tag');
      tag.setAttribute('transform', `translate(${r.x + 4} ${r.y + 4})`);
      const box = svg(tag, 'rect');
      box.setAttribute('width', String(6 + label.length * 5));
      box.setAttribute('height', '10');
      const text = svg(tag, 'text');
      text.setAttribute('x', '3');
      text.setAttribute('y', '7.5');
      text.textContent = label;
    }
  }

  /** The dashed line from the half-laid link's start to the room under the pointer. */
  function drawPreview(state) {
    const { network, linkFrom } = selection.get();
    const from = linkFrom ? state.buildings.find((b) => b.instanceId === linkFrom) : null;
    const to = layerState.hover ? state.buildings.find((b) => b.instanceId === layerState.hover) : null;
    if (!network || !from || !to || to === from) {
      preview.style.display = 'none';
      return;
    }
    const a = anchor(from, state);
    const b = anchor(to, state);
    preview.setAttribute('d', `M${a.x} ${a.y} L${b.x} ${b.y}`);
    const check = canLink(state, ctx, network, from.instanceId, to.instanceId);
    const afford = check.cost.every((c) => inStorehouses(state, ctx, c.id) >= c.qty);
    preview.dataset.ok = String(check.ok && afford);
    preview.style.display = '';
  }

  /**
   * A click in the shaft while a network is open. A node starts, finishes
   * or stops a link. Returns whether the click was used; anything else falls
   * through to the inspector, except while a link is half-laid, when it
   * stops the laying instead.
   */
  function pick(state, hit, node) {
    const { network, linkFrom } = selection.get();
    if (!network) return false;
    const building = node ? state.buildings.find((b) => b.instanceId === node.dataset.instance) : null;
    if (!building || !isNode(ctx, network, building.buildingId)) {
      if (!linkFrom) return false;
      selection.startLink(null);
      return true;
    }
    if (!linkFrom) {
      selection.startLink(building.instanceId);
      return true;
    }
    if (linkFrom === building.instanceId) {
      selection.startLink(null);
      return true;
    }
    const before = state.infrastructure.links.length;
    dispatch({ type: 'player:link', network, from: linkFrom, to: building.instanceId });
    // Laid: carry on from here, so a chain is a run of clicks. Refused: the
    // record says why, and the start stays where it was.
    if (state.infrastructure.links.length > before) selection.startLink(building.instanceId);
    layerState.key = null;
    return true;
  }
}

/** Where a link meets a room: near its ceiling, a little in from the left. */
function anchor(instance, state) {
  const r = roomRect(instance, state.buildings);
  return { x: r.x + Math.min(20, r.width / 3), y: r.y + 16 };
}

function rect(parent, className, x, y, width, height) {
  const node = svg(parent, 'rect', className);
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y));
  node.setAttribute('width', String(Math.max(0, width)));
  node.setAttribute('height', String(Math.max(0, height)));
  return node;
}

function svg(parent, tag, className = '') {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  parent.appendChild(node);
  return node;
}

