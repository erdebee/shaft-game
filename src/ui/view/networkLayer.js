/**
 * networkLayer.js
 * The open network, drawn on the shaft while the Infrastructure panel has it
 * open (selection.network).
 *
 *   - every link, as a conduit in the network's colour: along the ceiling of
 *     each room it joins to a riser beside the stairwell (a drain dashed,
 *     and marked with the way it runs)
 *   - every node outlined, hubs tagged — a junction with its priority
 *   - on the air, every room's oxygen and pollution
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
  tileRoute, riserRoute, hangingPath, trunkCable, wire, clamp, sagPath, sagOf, svg,
} from './conduits.js';
import { fanMode, SUCK, AIR_LINES, FOUL, FRESH } from '../../systems/airQuality/airflow.js';
import { createAirParticles } from './airParticles.js';
import { graphOf, hubFor } from '../../systems/infrastructure/networkGraph.js';
import { powerDemand } from '../../systems/buildings/buildingRegistry.js';
import * as selection from '../selection.js';
import { readNetwork, colorOf, roleOf } from '../networkStatus.js';
import { canLink, isNode, isHub, networkDef } from '../../systems/infrastructure/networkGraph.js';
import { priorityOf } from '../../systems/power/priorityLadder.js';
import { inStorehouses } from '../../systems/resources/stores.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Each network's risers — the lanes its runs drop down, staggered so
 * overlapping runs stay tellable — and how far below a room's top its runs
 * hang. The foul air comes up the right-hand wall of the Shaft and the fresh
 * air goes down the stairwell on the left, so the two halves of the loop
 * never cross; the water, sewage and power share the stairwell.
 */
const LANES = {
  [FOUL]: { x: SHAFT_WIDTH - 14, step: 26, y: 13, lanes: 2 },
  [FRESH]: { x: BUILD_X - 16, step: 26, y: 38, lanes: 2 },
  'water-mains': { x: BUILD_X - 12, step: 20, y: 9 },
  sewer: { x: BUILD_X - 12, step: 20, y: 9 },
  'power-grid': { x: BUILD_X - 8, step: 11, y: 6 },
};

export function createNetworkLayer(view, root, dispatch, ctx) {
  const layer = svg(view.layers.networks, 'g', 'network-layer');
  const washes = svg(layer, 'g', 'net-washes');
  const defs = svg(layer, 'defs');
  const lines = svg(layer, 'g', 'net-lines');
  const flows = svg(layer, 'g', 'net-flows');
  const outlines = svg(layer, 'g', 'net-outlines');
  const particles = createAirParticles(layer);
  const preview = svg(layer, 'path', 'net-preview');
  preview.style.display = 'none';

  const layerState = { key: null, state: null, hover: null, gauges: [] };

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
    const air = AIR_LINES.includes(network);
    if (air) particles.frame(view.ambient);
    const net = readNetwork(state, currentCtx, network);
    // The other air line is drawn too: the two are one loop.
    const other = air ? readNetwork(state, currentCtx, network === FOUL ? FRESH : FOUL) : null;
    const key = JSON.stringify([
      network, linkFrom, view.builtSignature,
      net.links.map((l) => l.id),
      net.groups.map((g) => [g.key, g.live, g.nodes.length]),
      [...net.reach.keys()],
      net.gaps.map((g) => `${g.level}:${g.instance?.instanceId ?? ''}`),
      network === 'power-grid' ? state.buildings.map((b) => `${b.priority ?? ''}${b.powered === false ? 'x' : ''}`).join() : null,
      air ? [
        other.links.map((l) => l.id),
        state.buildings.map((b) => b.fanMode ?? '').join(),
        // Streams are redrawn when they change by a visible amount; the air
        // along them is read every frame.
        Object.entries(state.resources.flows.air?.links ?? {}).map(([id, l]) => `${id}:${l.to}:${Math.round(l.flow / 4)}:${Math.round(l.airQuality / 3)}`),
        (state.resources.flows.air?.paths ?? []).map((p) => `${p.from}>${p.to}:${Math.round(p.flow / 4)}:${Math.round(p.blown.airQuality / 3)}:${Math.round(p.drawn.airQuality / 3)}`),
      ] : null,
    ]);
    if (key === layerState.key) {
      if (air) updateGauges(state, currentCtx);
      return;
    }
    layerState.key = key;
    draw(state, currentCtx, network, net, linkFrom, other);
    drawPreview(state);
  }

  function draw(state, currentCtx, network, net, linkFrom, other) {
    for (const g of [defs, washes, lines, flows, outlines]) g.replaceChildren();
    particles.clear();
    layerState.gauges = [];
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

    // The links, each network in its own material (conduits.js).
    const draw = {
      'power-grid': drawPower,
      'water-mains': (st, c, n, d) => drawPipes(st, c, n, d, 'main'),
      sewer: (st, c, n, d) => drawPipes(st, c, n, d, 'sewer'),
      [FOUL]: drawDucts,
      [FRESH]: drawDucts,
    }[network];
    draw?.(state, currentCtx, net, def, other);

    // The nodes, outlined and tagged.
    for (const node of net.graph.nodes) {
      const r = roomRect(node, state.buildings);
      const outline = rect(outlines, 'net-node-outline', r.x + 1, r.y + 1, r.width - 2, r.height - 2);
      if (node.instanceId === linkFrom) outline.classList.add('net-from');
      const role = roleOf(currentCtx, network, node);
      const hub = isHub(currentCtx, network, node.buildingId);
      const label = network === 'power-grid' && hub ? `P${priorityOf(node, currentCtx)}`
        : AIR_LINES.includes(network) && hub ? (fanMode(node) === SUCK ? 'SUCK ▲' : 'BLOW ▼')
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
    return LANES[network].x - (i % (LANES[network].lanes ?? 3)) * LANES[network].step;
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
   * The air ducts, and the air moving round the loop: particles along every
   * duct, and through the Shaft from every blowing fan to the sucking fans
   * its air goes to, blue where the air is clean and brown where it has
   * picked up the Shaft's dirt (airParticles.js). Every room carries a gauge
   * with the two numbers the loop is for: the oxygen in its air and the
   * pollution (refreshed every frame by updateGauges, not redrawn).
   */
  function drawDucts(state, currentCtx, net, def, other) {
    const air = state.resources.flows.air ?? { links: {}, paths: [] };
    const ducts = [];
    // The line that is open is drawn over the other.
    for (const line of [other, net].filter(Boolean)) {
      const network = line.graph.networkId;
      const tiles = tilesOf(network === FRESH ? 'fresh-duct' : 'duct');
      line.links.forEach((link, i) => {
        const route = riserRoute(port(network, link.a, state), port(network, link.b, state), laneOf(network, i));
        tileRoute(lines, defs, tiles, route);
        const flow = air.links?.[link.id];
        if (!flow || flow.flow < 0.5) return;
        // The air in the duct runs with it: from its upstream end.
        const [up, down] = flow.to === link.a.instanceId ? [link.b, link.a] : [link.a, link.b];
        const points = riserRoute(port(network, up, state), port(network, down, state), laneOf(network, i));
        ducts.push({ key: link.id, points, flow: flow.flow, airQuality: flow.airQuality });
      });
    }
    particles.build(state, air.paths, ducts);

    for (const b of state.buildings) {
      const r = roomRect(b, state.buildings);
      const g = svg(flows, 'g', 'air-gauge');
      g.setAttribute('transform', `translate(${r.x + r.width - 38} ${r.y + ROOM_HEIGHT - 26})`);
      const box = svg(g, 'rect');
      box.setAttribute('width', '34');
      box.setAttribute('height', '21');
      const oxygen = svg(g, 'text', 'air-gauge-oxygen');
      oxygen.setAttribute('x', '3');
      oxygen.setAttribute('y', '8.5');
      const pollution = svg(g, 'text', 'air-gauge-pollution');
      pollution.setAttribute('x', '3');
      pollution.setAttribute('y', '18');
      layerState.gauges.push({ level: b.level, oxygen, pollution, shown: null });
    }
    updateGauges(state, currentCtx);
  }

  /** Each room's oxygen and pollution, banded like the rest of the air readouts. */
  function updateGauges(state, currentCtx) {
    const { qualityWarnThreshold: warn, qualityCriticalThreshold: critical } = currentCtx.config.air;
    const band = (q) => (q < critical ? 'critical' : q < warn ? 'warn' : 'ok');
    for (const gauge of layerState.gauges) {
      const level = state.levels[gauge.level - 1];
      if (!level) continue;
      const o2 = Math.round(level.oxygen ?? 100);
      const purity = Math.round(level.airQuality ?? 100);
      const shown = `${o2}|${purity}`;
      if (shown === gauge.shown) continue;
      gauge.shown = shown;
      gauge.oxygen.textContent = `O₂  ${o2}%`;
      gauge.oxygen.dataset.band = band(o2);
      gauge.pollution.textContent = `POL ${100 - purity}%`;
      gauge.pollution.dataset.band = band(purity);
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


