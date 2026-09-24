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
import {
  tileRoute, riserRoute, hangingPath, trunkCable, wire, clamp, plate, sagPath, sagOf, svg,
} from './conduits.js';
import { fanMode, SUCK } from '../../systems/airQuality/airflow.js';
import { createAirParticles } from './airParticles.js';
import { graphOf, hubFor } from '../../systems/infrastructure/networkGraph.js';
import { powerDemand } from '../../systems/buildings/buildingRegistry.js';
import * as selection from '../selection.js';
import { readNetwork, colorOf, roleOf } from '../networkStatus.js';
import { canLink, isNode, isHub, networkDef } from '../../systems/infrastructure/networkGraph.js';
import { priorityOf } from '../../systems/power/priorityLadder.js';
import { inStorehouses } from '../../systems/resources/stores.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The reach bars stand at the stairwell's left edge, staggered so they do not hide each other. */
const BAR_W = 4;
const BAR_STEP = 6;

/**
 * Each network's risers — the lanes its runs drop down, just inside the
 * stairwell, staggered so overlapping runs stay tellable — and how far below
 * a room's top its runs hang.
 */
const LANES = {
  'duct-network': { x: BUILD_X - 16, step: 28, y: 13 },
  'water-mains': { x: BUILD_X - 12, step: 20, y: 9 },
  sewer: { x: BUILD_X - 12, step: 20, y: 9 },
  'power-grid': { x: BUILD_X - 8, step: 11, y: 6 },
};

export function createNetworkLayer(view, root, dispatch, ctx) {
  const layer = svg(view.layers.networks, 'g', 'network-layer');
  const bars = svg(layer, 'g', 'net-bars');
  const washes = svg(layer, 'g', 'net-washes');
  const defs = svg(layer, 'defs');
  const lines = svg(layer, 'g', 'net-lines');
  const flows = svg(layer, 'g', 'net-flows');
  const outlines = svg(layer, 'g', 'net-outlines');
  const particles = createAirParticles(layer);
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
      particles.clear();
      layerState.key = null;
      return;
    }
    if (network === 'duct-network') particles.frame(view.ambient);
    const net = readNetwork(state, currentCtx, network);
    const key = JSON.stringify([
      network, linkFrom, view.builtSignature,
      net.links.map((l) => l.id),
      net.groups.map((g) => [g.key, g.live, g.nodes.length]),
      [...net.reach.keys()],
      net.gaps.map((g) => `${g.level}:${g.instance?.instanceId ?? ''}`),
      network === 'power-grid' ? state.buildings.map((b) => `${b.priority ?? ''}${b.powered === false ? 'x' : ''}`).join() : null,
      network === 'duct-network' ? [
        state.buildings.map((b) => b.fanMode ?? '').join(),
        Object.entries(state.resources.flows.air?.links ?? {}).map(([id, l]) => `${id}:${l.to}:${Math.round(l.flow)}`),
        (state.resources.flows.air?.paths ?? []).map((p) => `${p.from}>${p.to}:${Math.round(p.flow)}:${Math.round(p.blown.airQuality / 2)}:${Math.round(p.drawn.airQuality / 2)}`),
        (state.resources.flows.air?.levelIn ?? []).map(Math.round).join(),
        (state.resources.flows.air?.levelOut ?? []).map(Math.round).join(),
      ] : null,
    ]);
    if (key === layerState.key) return;
    layerState.key = key;
    draw(state, currentCtx, network, net, linkFrom);
    drawPreview(state);
  }

  function draw(state, currentCtx, network, net, linkFrom) {
    for (const g of [defs, bars, washes, lines, flows, outlines]) g.replaceChildren();
    particles.clear();
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
      const x = 3 + (i % 3) * BAR_STEP;
      const bar = rect(bars, 'net-reach', x, levelY(top) + 4, BAR_W, levelY(bottom) - levelY(top) + ROOM_HEIGHT - 8);
      bar.dataset.live = String(live.has(net.graph.component.get(hub.instanceId)) && !hub.brokenDown);
      const tick = rect(bars, 'net-reach-hub', x - 2, levelY(hub.level) + ROOM_HEIGHT / 2 - 2, BAR_W + 4, 4);
      tick.dataset.live = bar.dataset.live;
    });

    // The links, each network in its own material (conduits.js).
    const draw = {
      'power-grid': drawPower,
      'water-mains': (...a) => drawPipes(...a, 'main'),
      sewer: (...a) => drawPipes(...a, 'sewer'),
      'duct-network': drawDucts,
    }[network];
    draw?.(state, currentCtx, net, def);

    // The nodes, outlined and tagged.
    for (const node of net.graph.nodes) {
      const r = roomRect(node, state.buildings);
      const outline = rect(outlines, 'net-node-outline', r.x + 1, r.y + 1, r.width - 2, r.height - 2);
      if (node.instanceId === linkFrom) outline.classList.add('net-from');
      const role = roleOf(currentCtx, network, node);
      const hub = isHub(currentCtx, network, node.buildingId);
      const label = network === 'power-grid' && hub ? `P${priorityOf(node, currentCtx)}`
        : network === 'duct-network' && hub ? (fanMode(node) === SUCK ? 'SUCK ▲' : 'BLOW ▼')
          : role.toUpperCase().slice(0, 8);
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

  /** Where a network's run meets a room: the room's middle, near its ceiling. */
  function port(network, instance, state) {
    const r = roomRect(instance, state.buildings);
    return { x: Math.round(r.x + r.width / 2), y: r.y + LANES[network].y };
  }

  function laneOf(network, i) {
    return LANES[network].x - (i % 3) * LANES[network].step;
  }

  /** Ducts and pipes: tiles along each link's route, joints at the corners. */
  function drawPipes(state, currentCtx, net, def, kind) {
    const network = net.graph.networkId;
    const tiles = tilesOf(kind);
    net.links.forEach((link, i) => {
      const route = riserRoute(port(network, link.a, state), port(network, link.b, state), laneOf(network, i));
      tileRoute(lines, defs, tiles, route);
      if (def?.flowsDownhill && route.length > 2) {
        // A chevron on the riser, pointing the way it drains.
        const x = route[1].x;
        const my = (route[1].y + route[2].y) / 2;
        const chevron = svg(flows, 'path', 'net-chevron');
        chevron.setAttribute('d', `M${x - 5} ${my - 3}l5 6l5 -6`);
      }
    });
  }

  /**
   * The air ducts, and the air moving through the rooms: particles from
   * every blowing fan to the sucking fans it feeds, blue where the air is
   * clean and brown where it has picked up the Shaft's dirt (airParticles.js).
   * Each duct carries a plate with the air it moves; each sucking fan, the
   * pollution its streams bring back to it a tick; and every room on a
   * ventilated level, the air blown onto or drawn off it.
   */
  function drawDucts(state, currentCtx, net) {
    const network = 'duct-network';
    const tiles = tilesOf('duct');
    const air = state.resources.flows.air ?? { links: {}, paths: [], levelIn: [], levelOut: [] };
    net.links.forEach((link, i) => {
      const route = riserRoute(port(network, link.a, state), port(network, link.b, state), laneOf(network, i));
      tileRoute(lines, defs, tiles, route);
      const flow = air.links?.[link.id];
      if (!flow || flow.flow < 0.5) return;
      const mid = midpoint(route);
      plate(flows, mid.x, mid.y, `${Math.round(flow.flow)}`, 'airflow-plate');
    });
    particles.build(state, air.paths);

    const pickup = new Map();
    for (const p of air.paths ?? []) pickup.set(p.to, (pickup.get(p.to) ?? 0) + p.pickup);
    for (const [id, dirt] of pickup) {
      const fan = state.buildings.find((b) => b.instanceId === id);
      if (!fan) continue;
      const r = roomRect(fan, state.buildings);
      plate(flows, r.x + r.width / 2, r.y + 30, `+${dirt.toFixed(1)} pollution`, 'airflow-pickup');
    }
    for (const b of state.buildings) {
      const blown = air.levelIn?.[b.level] ?? 0;
      const drawn = air.levelOut?.[b.level] ?? 0;
      if (blown < 0.5 && drawn < 0.5) continue;
      const r = roomRect(b, state.buildings);
      const text = blown >= drawn ? `▼${Math.round(blown)}` : `▲${Math.round(drawn)}`;
      plate(flows, r.x + r.width - 16, r.y + ROOM_HEIGHT - 12, text, blown >= drawn ? 'airflow-in' : 'airflow-out');
    }
  }

  /**
   * The grid: a thick trunk cable along every link, and from every junction
   * thin wires hanging out to each room it feeds — dropping down the
   * junction's own wall to each level, then strung room to room along the
   * ceiling. A wire to a dark room is dark.
   */
  function drawPower(state, currentCtx, net) {
    const network = 'power-grid';
    net.links.forEach((link, i) => {
      trunkCable(lines, hangingPath(riserRoute(port(network, link.a, state), port(network, link.b, state), laneOf(network, i))));
    });
    if (!net.graph.enforced) return;

    const live = new Set(net.groups.filter((g) => g.live).map((g) => g.key));
    const graph = graphOf(state, currentCtx, network);
    const hubAt = new Map();
    const fed = new Map(); // junction -> Map(level -> [room])
    for (const b of state.buildings) {
      const d = currentCtx.catalog.buildings.byId[b.buildingId];
      if (!d || isNode(currentCtx, network, b.buildingId)) continue;
      if (!(d.powerDraw > 0) && powerDemand(b, d, currentCtx, state) <= 0) continue;
      if (!hubAt.has(b.level)) {
        hubAt.set(b.level, hubFor(graph, currentCtx, b.level, { usable: (h) => !h.brokenDown, live: (k) => live.has(k) }));
      }
      const hub = hubAt.get(b.level);
      if (!hub || typeof hub === 'string') continue;
      if (!fed.has(hub)) fed.set(hub, new Map());
      const levels = fed.get(hub);
      if (!levels.has(b.level)) levels.set(b.level, []);
      levels.get(b.level).push(b);
    }

    for (const [hub, levels] of fed) {
      const from = port(network, hub, state);
      const ceiling = (level) => levelY(level) + LANES[network].y + 4;
      // The drop: straight down (and up) the junction's wall.
      const ys = [from.y, ...[...levels.keys()].map(ceiling)];
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      if (bottom > top) wire(flows, `M${from.x} ${top}V${bottom}`, true);
      for (const [level, rooms] of levels) {
        const y = ceiling(level);
        clamp(flows, from.x, y);
        // Strung outward both ways, room to room, each span sagging.
        for (const side of [-1, 1]) {
          const along = rooms
            .map((b) => ({ b, x: port(network, b, state).x }))
            .filter(({ x }) => (side < 0 ? x < from.x : x >= from.x))
            .sort((p, q) => side * (p.x - q.x));
          let at = { x: from.x, y };
          for (const { b, x } of along) {
            if (Math.abs(x - at.x) < 1) { clamp(flows, x, y); continue; }
            const to = { x, y };
            wire(flows, sagPath(at, to, sagOf(x - at.x)), b.powered !== false);
            clamp(flows, x, y);
            at = to;
          }
        }
      }
    }
  }

  function tilesOf(kind) {
    return {
      v: view.art.conduit?.(`${kind}-v`) ?? null,
      h: view.art.conduit?.(`${kind}-h`) ?? null,
      joint: view.art.conduit?.(`${kind}-joint`) ?? null,
    };
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

/** Half way along a route, by length. */
function midpoint(route) {
  const segs = [];
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const len = Math.abs(route[i].x - route[i - 1].x) + Math.abs(route[i].y - route[i - 1].y);
    segs.push(len);
    total += len;
  }
  let left = total / 2;
  for (let i = 1; i < route.length; i++) {
    if (left <= segs[i - 1]) {
      const f = segs[i - 1] ? left / segs[i - 1] : 0;
      return { x: route[i - 1].x + (route[i].x - route[i - 1].x) * f, y: route[i - 1].y + (route[i].y - route[i - 1].y) * f };
    }
    left -= segs[i - 1];
  }
  return route[route.length - 1];
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


