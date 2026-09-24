/**
 * networkLayer.js
 * The open network, drawn on the shaft while the Infrastructure panel has it
 * open (selection.network) — with the other lines on its page, since each
 * page is one loop: the power's high-voltage cables and low-voltage wires,
 * the water's mains, drains and feed lines, the air's two ducts.
 *
 *   - every SOCKET those lines have, on the rooms that carry them
 *     (catalog/infrastructure/networks.json): a generator's high-voltage
 *     outputs, a junction's input and its row of low-voltage outlets, a
 *     cistern's fresh-water, sewage and feed sleeves, the one outlet or
 *     sleeve each room has. A socket with something plugged in shows the plug
 *   - every link, from socket to socket in its own material: the trunks
 *     (cables, pipes, drains, ducts) up to the ceiling, along to their
 *     network's riser and down it, with what moves in them (air, water,
 *     sewage) drawn as particles running the way it flows; the low-voltage
 *     wires and the double feed lines hanging from their hub down its wall
 *     and across the ceiling to the room
 *   - a junction's priority, on the room
 *   - on the air, every room's oxygen and pollution
 *   - what nothing reaches: its room outlined in red, or its level washed red
 *
 * Picking out: a click on a line — or on a used socket — lights it, here
 * and on the minimap, and puts a ✕ on its sockets; a click on one of those
 * takes it out. A click anywhere else, a right-click, or Esc lets it go.
 *
 * Laying: a click on a free socket starts a link, and a click on a joint of
 * a pipe, drain or duct starts one from that run, to tee a room into it. While it is being laid a
 * ghost of it — the cable, wire, pipe or duct it would be, half-seen —
 * follows the pointer, and snaps to a socket it would fit: every such socket
 * is lit, the rest dimmed. A click on one (or on a room with one free) lays
 * it. On a pipe, drain or duct it also snaps to a run of its line: a click
 * there tees it in, and the branch is drawn meeting the run at a joint. A
 * fan's one duct sleeve serves both air lines, and is drawn once. A hub with
 * another free socket of the kind carries on from there, so a junction's
 * rooms are plugged in a click each, and so does a run being teed into.
 * Only a right-click or Esc stops laying: a click that lays nothing leaves
 * the link in hand.
 *
 * UI, not world: nothing here is saved, and the only things it writes are
 * the player:link and player:unlink commands a click asks for.
 */

import { roomRect, levelY, ROOM_HEIGHT, BUILD_X, SHAFT_WIDTH } from './interpolate.js';
import { fittedScale } from './viewport.js';
import {
  tileRoute, hangingPath, trunkCable, wire, feedPipe, clamp, svg,
} from './conduits.js';
import { AIR_LINES, FOUL, FRESH, isOutside } from '../../systems/airQuality/airflow.js';
import { createAirParticles } from './airParticles.js';
import * as selection from '../selection.js';
import { readNetwork, colorOf, linesWith } from '../networkStatus.js';
import {
  canLink, canTap, isHub, networkDef, socketsOf, socketUse, endSocket,
} from '../../systems/infrastructure/networkGraph.js';
import { priorityOf } from '../../systems/power/priorityLadder.js';
import { inStorehouses } from '../../systems/resources/stores.js';

/**
 * Each line's sockets: the row they sit in, how far below a room's top, and
 * — for a trunk — the one straight riser its runs drop down. The clean
 * halves run down the far left of the stairwell, clear of the floor signs:
 * the fresh air outermost, the water beside it. The dirty halves come up the
 * right, just short of the minimap so it never hides them: the foul air
 * outermost, the sewage beside it (their x is set from the minimap, see
 * riserOf). The power trunk runs down the stairwell's inner wall. The wires
 * and feed lines have no riser: they hang from their hub.
 */
const LANES = {
  'power-grid': { x: BUILD_X - 6, y: 8, besideX: -12 },
  'power-lines': { y: 22 },
  'water-mains': { x: 42, y: 9 },
  sewer: { fromRight: 42, y: 27 },
  'water-feeds': { y: 45 },
  [FOUL]: { fromRight: 15, y: 11 },
  [FRESH]: { x: 15, y: 30 },
};

/** How big each kind of socket is drawn, and how far apart they sit. */
const SOCKET = {
  hv: { size: 10, step: 12 },
  lv: { size: 7, step: 9 },
  'main-fresh': { size: 10, step: 13 },
  'main-sewage': { size: 10, step: 13 },
  feed: { size: 9, step: 11 },
  'duct-foul': { size: 9, step: 12 },
  'duct-fresh': { size: 9, step: 12 },
};

/** How far below its in an in-line building's out sits (or its in below its out): clear of a pipe's width. */
const IN_LINE_DROP = 26;

/** How wide each line's run is to the pointer: about as wide as it is drawn. */
const HIT_WIDTH = {
  'power-grid': 12, 'power-lines': 8, 'water-mains': 20, sewer: 20, 'water-feeds': 10, [FOUL]: 26, [FRESH]: 26,
};

/** Lines that hang from a hub rather than running to a riser. */
const HANGING = new Set(['power-lines', 'water-feeds']);

export function createNetworkLayer(view, root, dispatch, ctx) {
  const layer = svg(view.layers.networks, 'g', 'network-layer');
  const washes = svg(layer, 'g', 'net-washes');
  const defs = svg(layer, 'defs');
  const lines = svg(layer, 'g', 'net-lines');
  const flows = svg(layer, 'g', 'net-flows');
  const outlines = svg(layer, 'g', 'net-outlines');
  const particles = createAirParticles(layer);
  const glow = svg(layer, 'g', 'net-glow');
  const hits = svg(layer, 'g', 'net-hits');
  const joints = svg(layer, 'g', 'net-joints');
  const sockets = svg(layer, 'g', 'net-sockets');
  const ghost = svg(layer, 'g', 'net-ghost');
  ghost.style.display = 'none';

  const layerState = {
    key: null, state: null, gauges: [], right: SHAFT_WIDTH,
    spots: new Map(),   // `${network}|${instanceId}` -> [{ socket, index, x, y, link, lines }]
    routes: new Map(),  // link id -> its route as drawn, for tees to meet
    paths: new Map(),   // link id -> its path as drawn, for the highlight
    teeLevels: new Map(), // tap link id -> the level its tee sits on
    pointer: null,      // the last pointer position, in shaft units
  };

  // Where the minimap starts, in shaft units at the fitted scale: the dirty
  // lines run just short of it. Re-read whenever the host or the minimap
  // changes size (it widens while a network is open).
  const host = view.svg.parentElement;
  const measure = () => {
    const map = host?.querySelector('.shaft-minimap');
    const width = host?.clientWidth ?? 0;
    if (!map || width <= 0) return;
    const at = map.offsetLeft / fittedScale({ width });
    layerState.right = Math.round(Math.min(SHAFT_WIDTH, at) - 4);
    layerState.measured = true;
  };
  if (host && typeof ResizeObserver !== 'undefined') {
    const watch = new ResizeObserver(measure);
    watch.observe(host);
    const map = host.querySelector('.shaft-minimap');
    if (map) watch.observe(map);
  }

  // Esc, or a right-click, drops the link in hand and lets a picked line go.
  const letGo = () => {
    const { linkFrom, highlight } = selection.get();
    if (!linkFrom && !highlight) return false;
    selection.startLink(null);
    selection.highlightLink(null);
    ghost.style.display = 'none';
    return true;
  };
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') letGo();
  });
  view.svg.addEventListener('contextmenu', (event) => {
    if (selection.get().network && letGo()) event.preventDefault();
  });

  // The ghost follows the pointer.
  view.svg.addEventListener('pointermove', (event) => {
    const { network, linkFrom } = selection.get();
    if (!network || !linkFrom || !layerState.state) return;
    const matrix = layer.getScreenCTM?.();
    if (!matrix) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    layerState.pointer = { x: p.x, y: p.y };
    drawGhost(layerState.state, document.elementFromPoint(event.clientX, event.clientY));
  });

  return { update, pick };

  function update(state, currentCtx) {
    layerState.state = state;
    const { network, linkFrom, highlight } = selection.get();
    layer.style.display = network ? '' : 'none';
    layer.dataset.linking = String(!!linkFrom);
    if (!network) {
      particles.forget();
      layerState.key = null;
      return;
    }
    if (!layerState.measured) measure();
    const page = linesWith(network);
    const air = page.some((l) => AIR_LINES.includes(l));
    const piped = page.includes('water-mains');
    if (air || piped) particles.frame(view.ambient);
    const nets = page.map((id) => readNetwork(state, currentCtx, id));
    const key = JSON.stringify([
      network, linkFrom, highlight, view.builtSignature, layerState.right,
      nets.map((net) => [
        net.links.map((l) => `${l.id}:${l.fromSocket ?? ''}:${l.toSocket ?? ''}`),
        net.groups.map((g) => [g.key, g.live, g.nodes.length]),
        net.gaps.map((g) => `${g.level}:${g.instance?.instanceId ?? ''}`),
      ]),
      page.includes('power-grid') ? state.buildings.map((b) => `${b.priority ?? ''}${b.powered === false ? 'x' : ''}`).join() : null,
      // Whether the next link can be paid for moves with the stores.
      linkFrom ? (networkDef(currentCtx, linkFrom.network)?.linkCost ?? []).map((c) => Math.floor(inStorehouses(state, currentCtx, c.id))) : null,
      air ? [
        state.buildings.map((b) => b.fanMode ?? '').join(),
        // Streams are redrawn when they change by a visible amount; the air
        // along them is read every frame.
        Object.entries(state.resources.flows.air?.links ?? {}).map(([id, l]) => `${id}:${l.to}:${Math.round(l.flow / 4)}:${Math.round(l.airQuality / 3)}`),
        (state.resources.flows.air?.paths ?? []).map((p) => `${p.from}>${p.to}:${Math.round(p.flow / 4)}:${Math.round(p.blown.airQuality / 3)}:${Math.round(p.drawn.airQuality / 3)}`),
      ] : null,
      piped ? [
        Object.entries(state.resources.flows.water?.pipes ?? {}).map(([id, p]) => `${id}:${p.to}:${Math.round(p.flow / 4)}`),
        state.buildings.map((b) => ((b.waterShare ?? 1) > 0.5 ? '' : 'x')).join(),
      ] : null,
    ]);
    if (key === layerState.key) {
      if (air) updateGauges(state, currentCtx);
      return;
    }
    layerState.key = key;
    draw(state, currentCtx, network, nets, linkFrom, highlight);
    drawGhost(state, null);
  }

  function draw(state, currentCtx, network, nets, linkFrom, highlight) {
    for (const g of [defs, washes, lines, flows, outlines, glow, hits, joints, sockets]) g.replaceChildren();
    particles.clear();
    layerState.gauges = [];
    layerState.routes = new Map();
    layerState.paths = new Map();
    layerState.teeLevels = new Map(nets.flatMap((net) => net.links.filter((l) => l.tee).map((l) => [l.id, l.tee.level])));
    layer.style.setProperty('--net', colorOf(network));
    placeSockets(state, currentCtx, nets);

    // What nothing reaches: a level washed red, or a room outlined red.
    const washed = new Set();
    const ringed = new Set();
    for (const gap of nets.flatMap((net) => net.gaps)) {
      if (gap.instance) {
        if (ringed.has(gap.instance.instanceId)) continue;
        ringed.add(gap.instance.instanceId);
        const r = roomRect(gap.instance, state.buildings);
        rect(outlines, 'net-gap-room', r.x + 1.5, r.y + 1.5, r.width - 3, r.height - 3);
      } else if (!washed.has(gap.level)) {
        washed.add(gap.level);
        rect(washes, 'net-gap-level', BUILD_X, levelY(gap.level), SHAFT_WIDTH - BUILD_X, ROOM_HEIGHT);
      }
    }

    // The links, each line in its own material, the open line drawn last.
    const ordered = [...nets].sort((a, b) => Number(a.graph.networkId === network) - Number(b.graph.networkId === network));
    const streams = [];
    for (const net of ordered) {
      const id = net.graph.networkId;
      if (id === 'power-grid') drawCables(state, net);
      else if (id === 'power-lines') drawWires(state, net);
      else if (id === 'water-feeds') drawFeeds(state, net);
      else streams.push(...drawTrunk(state, net));
    }
    if (nets.some((n) => AIR_LINES.includes(n.graph.networkId))) {
      particles.build(state, state.resources.flows.air?.paths ?? [], streams);
      drawGauges(state, currentCtx);
    } else if (streams.length) {
      particles.build(state, [], streams);
    }

    // A junction's priority. A fan's direction needs no label: its particles show it.
    for (const net of nets) {
      if (net.graph.networkId !== 'power-lines') continue;
      for (const node of net.graph.nodes) {
        if (isHub(currentCtx, 'power-lines', node.buildingId)) tag(state, node, `P${priorityOf(node, currentCtx)}`);
      }
    }

    // The line picked out, lit along its whole run.
    const picked = highlight ? layerState.paths.get(highlight) : null;
    if (picked) {
      const path = svg(glow, 'path', 'net-highlight');
      path.setAttribute('d', picked.d);
      path.style.setProperty('--net', colorOf(picked.network));
      path.style.strokeWidth = String(HIT_WIDTH[picked.network] + 4);
    }

    drawSockets(state, currentCtx, linkFrom, highlight);
  }

  /**
   * What makes a line clickable: its run, as wide as the line is drawn, and
   * on a line that can be teed, every joint — each knee and tee on it.
   */
  function catchLine(link, network, route, d) {
    layerState.routes.set(link.id, route);
    layerState.paths.set(link.id, { d, network });
    const hit = svg(hits, 'path', 'net-pipe-hit');
    hit.setAttribute('d', d);
    hit.style.strokeWidth = String(HIT_WIDTH[network]);
    hit.dataset.link = link.id;
    hit.dataset.network = network;
    if (!networkDef(ctx, network)?.taps) return;
    const knees = route.slice(1, -1);
    if (link.tap) knees.push(route.at(-1));
    for (const p of knees) {
      const knee = circle(joints, 'net-joint-hit', p.x, p.y, HIT_WIDTH[network] / 2 + 3);
      knee.dataset.link = link.id;
      knee.dataset.network = network;
      knee.dataset.x = String(p.x);
      knee.dataset.y = String(p.y);
    }
  }

  // --- sockets ---------------------------------------------------------------

  /**
   * Where every socket on the page's lines sits, and what is plugged into
   * it: laid out along its line's row near the top of the room, left to
   * right, wrapping to a second row when the room is full. The n-th link in
   * a kind of socket sits in the n-th socket of that kind. A pooled socket —
   * a fan's one duct, on both air lines — is placed once: its place on the
   * second line is a twin of the first, not drawn, and `lines` lists every
   * line it serves.
   */
  function placeSockets(state, currentCtx, nets) {
    layerState.spots = new Map();
    const pooled = new Map();
    for (const net of nets) {
      const network = net.graph.networkId;
      const style = networkDef(currentCtx, network)?.socketStyle ?? 'hv';
      const { size, step } = SOCKET[style] ?? SOCKET.hv;
      for (const node of net.graph.nodes) {
        const kinds = socketsOf(currentCtx, network, node.buildingId);
        if (!kinds.length) continue;
        const r = roomRect(node, state.buildings);
        const perRow = Math.max(1, Math.floor((r.width - 6) / step));
        const use = socketUse(state, currentCtx, network, node);
        const spots = [];
        let k = 0;
        for (const socket of kinds) {
          const plugged = use.get(socket.id) ?? [];
          for (let index = 0; index < socket.count; index++) {
            const spot = { network, style, size, socket, index, instance: node, link: plugged[index] ?? null, lines: [network] };
            const poolKey = socket.pool ? `${node.instanceId}|${socket.pool}|${socket.id}|${index}` : null;
            const first = poolKey ? pooled.get(poolKey) : null;
            if (first) {
              Object.assign(spot, { x: first.x, y: first.y, twin: true });
              first.lines.push(network);
            } else if (socket.row == null) {
              spot.x = r.x + 4 + size / 2 + (k % perRow) * step;
              spot.y = r.y + LANES[network].y + Math.floor(k / perRow) * step;
              k++;
            }
            if (poolKey && !first) pooled.set(poolKey, spot);
            spots.push(spot);
          }
        }
        stackInLine(state, network, node, r, spots.filter((s) => s.socket.row != null));
        layerState.spots.set(`${network}|${node.instanceId}`, spots);
      }
    }
  }

  /**
   * An in-line building's in and out — a pump, a battery — one above the
   * other at the room's left, far enough apart that their two runs never
   * touch. The one whose run goes higher sits on top, so a pump fed from
   * below and feeding up never doubles back; when both runs go the same way
   * each drops down its own lane of the riser, the one that would otherwise
   * cross the other's run taking the lane further out.
   */
  function stackInLine(state, network, node, r, inline) {
    if (!inline.length) return;
    const farLevel = (spot) => {
      if (!spot.link) return null;
      if (spot.link.tap) return layerState.teeLevels.get(spot.link.id) ?? null;
      const other = state.buildings.find((b) => b.instanceId === (spot.link.from === node.instanceId ? spot.link.to : spot.link.from));
      return other?.level ?? null;
    };
    const order = [...inline].sort((a, b) => {
      const fa = farLevel(a);
      const fb = farLevel(b);
      if (fa != null && fb != null && fa !== fb) return fa - fb;
      return a.socket.row - b.socket.row;
    });
    order.forEach((spot, i) => {
      spot.x = r.x + 4 + spot.size / 2;
      spot.y = r.y + LANES[network].y + i * IN_LINE_DROP;
    });
    // Lanes: the riser itself (further from the rooms) and one beside it.
    if (LANES[network].x == null || order.length < 2) return;
    const [top, bottom] = order;
    const riser = riserOf(network);
    const beside = riser + (LANES[network].besideX ?? 18);
    const [far, near] = riser < beside ? [riser, beside] : [beside, riser];
    const up = (spot) => farLevel(spot) != null && farLevel(spot) < node.level;
    const down = (spot) => farLevel(spot) != null && farLevel(spot) > node.level;
    if (up(top) && up(bottom)) { bottom.lane = far; top.lane = near; }
    else if (down(top) && down(bottom)) { top.lane = far; bottom.lane = near; }
  }

  /** The socket a link's end is plugged into, as drawn. */
  function spotOfEnd(link, instance) {
    const spots = layerState.spots.get(`${link.network}|${instance.instanceId}`) ?? [];
    return spots.find((s) => s.link?.id === link.id)
      ?? spots.find((s) => s.socket.id === endSocket(ctx, link, instance))
      ?? null;
  }

  /** The first free socket of a kind on a room, where the next link into it goes. */
  function freeSpot(network, instanceId, socketId) {
    return (layerState.spots.get(`${network}|${instanceId}`) ?? []).find((s) => s.socket.id === socketId && !s.link) ?? null;
  }

  /**
   * Every socket, drawn in its own shape: a high-voltage outlet, a row of
   * low-voltage ones, a large pipe sleeve (fresh or sewage), a double feed
   * sleeve, a duct collar. While a link is being laid, the one it starts
   * from is marked, the free ones it would fit lit, the rest dimmed.
   */
  function drawSockets(state, currentCtx, linkFrom, highlight) {
    for (const spots of layerState.spots.values()) {
      for (const spot of spots) {
        if (spot.twin) continue;
        const g = svg(sockets, 'g', `net-socket net-socket-${spot.style}`);
        g.setAttribute('transform', `translate(${spot.x} ${spot.y})`);
        g.dataset.network = spot.link?.network ?? spot.network;
        g.dataset.lines = spot.lines.join(' ');
        g.dataset.instance = spot.instance.instanceId;
        g.dataset.socket = spot.socket.id;
        g.dataset.used = String(!!spot.link);
        if (spot.link) g.dataset.link = spot.link.id;
        g.style.setProperty('--net', colorOf(spot.network));
        if (linkFrom) g.dataset.state = socketState(state, currentCtx, linkFrom, spot);
        socketShape(g, spot);
        // The picked-out line's sockets offer to take it out.
        if (spot.link && spot.link.id === highlight) {
          g.dataset.remove = 'true';
          const x = svg(g, 'g', 'net-socket-remove');
          x.setAttribute('transform', `translate(${spot.size / 2 + 1} ${-spot.size / 2 - 1})`);
          circle(x, 'net-socket-remove-disc', 0, 0, 4.5);
          svg(x, 'path', 'net-socket-remove-cross').setAttribute('d', 'M-2 -2L2 2M2 -2L-2 2');
        }
        if (spot.socket.row != null) {
          const mark = svg(g, 'text', 'net-socket-mark');
          mark.setAttribute('x', String(spot.size / 2 + 2));
          mark.setAttribute('y', '2.5');
          mark.textContent = spot.socket.dir === 'in' ? 'IN' : 'OUT';
        }
        const title = svg(g, 'title');
        const def = networkDef(currentCtx, spot.link?.network ?? spot.network);
        title.textContent = spot.link
          ? (spot.link.id === highlight ? `${spot.socket.label}: click to take the ${def.link} out` : `${spot.socket.label}: ${def.link} plugged in — click to pick it out`)
          : `${spot.socket.label}: free — click to lay a ${def.link}`;
      }
    }
  }

  /** How a socket looks while a link is being laid from `linkFrom`. */
  function socketState(state, currentCtx, linkFrom, spot) {
    const lines = spot.lines.filter((l) => linesOf(linkFrom).includes(l));
    if (!lines.length) return 'off';
    if (linkFrom.tap) {
      if (spot.link || spot !== freeSpot(spot.network, spot.instance.instanceId, spot.socket.id)) return 'off';
      return tappable(state, currentCtx, { instanceId: spot.instance.instanceId, socket: spot.socket.id }, linkFrom.network, linkFrom.tap).ok ? 'fit' : 'off';
    }
    if (spot.instance.instanceId === linkFrom.instanceId) {
      return spot.socket.id === linkFrom.socket && spot === freeSpot(spot.network, spot.instance.instanceId, spot.socket.id) ? 'from' : 'off';
    }
    if (spot.link || spot !== freeSpot(spot.network, spot.instance.instanceId, spot.socket.id)) return 'off';
    return layable(state, currentCtx, linkFrom, spot.instance.instanceId, spot.socket.id, lines).ok ? 'fit' : 'off';
  }

  /**
   * Whether a link from `linkFrom` to a room's socket can be laid and paid
   * for, on the first of `lines` that takes it. Returns canLink's answer and
   * the `network` it is for.
   */
  function layable(state, currentCtx, linkFrom, toId, toSocket, lines = linesOf(linkFrom)) {
    let answer = null;
    for (const network of lines) {
      const check = canLink(state, currentCtx, network, linkFrom.instanceId, toId, { fromSocket: linkFrom.socket, toSocket });
      const afford = check.cost.every((c) => inStorehouses(state, currentCtx, c.id) >= c.qty);
      answer = { ...check, network, ok: check.ok && afford, reason: check.ok && !afford ? 'cost' : check.reason };
      if (answer.ok) break;
    }
    return answer ?? { ok: false, reason: 'no-network', cost: [], network: null };
  }

  /** Whether a line from `linkFrom` can be teed into a link, and paid for. */
  function tappable(state, currentCtx, linkFrom, network, linkId) {
    const check = canTap(state, currentCtx, network, linkFrom.instanceId, linkId, { fromSocket: linkFrom.socket });
    const afford = check.cost.every((c) => inStorehouses(state, currentCtx, c.id) >= c.qty);
    return { ...check, network, ok: check.ok && afford, reason: check.ok && !afford ? 'cost' : check.reason };
  }

  function socketShape(g, { style, size, link }) {
    const h = size / 2;
    // A wider, invisible target, so a small socket is easy to hit.
    rect(g, 'net-socket-hit', -h - 2, -h - 2, size + 4, size + 4);
    switch (style) {
      case 'hv': {
        rect(g, 'net-socket-plate', -h, -h, size, size);
        if (link) { circle(g, 'net-socket-plug', 0, 0, h - 1.5); break; }
        circle(g, 'net-socket-face', 0, 0, h - 1.5);
        for (const [x, y] of [[-1.8, -1], [1.8, -1], [0, 2]]) circle(g, 'net-socket-pin', x, y, 0.9);
        break;
      }
      case 'lv': {
        rect(g, 'net-socket-plate', -h, -h, size, size);
        if (link) { rect(g, 'net-socket-plug', -h + 1.2, -h + 1.2, size - 2.4, size - 2.4); break; }
        rect(g, 'net-socket-pin', -1.8, -1.5, 1, 3);
        rect(g, 'net-socket-pin', 0.8, -1.5, 1, 3);
        break;
      }
      case 'main-fresh':
      case 'main-sewage': {
        circle(g, 'net-socket-flange', 0, 0, h);
        for (let a = 0; a < 4; a++) {
          const t = (a * Math.PI) / 2 + Math.PI / 4;
          circle(g, 'net-socket-bolt', Math.cos(t) * (h - 1.3), Math.sin(t) * (h - 1.3), 0.7);
        }
        circle(g, link ? 'net-socket-plug' : 'net-socket-bore', 0, 0, h - 2.8);
        break;
      }
      case 'feed': {
        rect(g, 'net-socket-plate', -h, -h + 1.5, size, size - 3);
        circle(g, link ? 'net-socket-plug net-feed-fresh' : 'net-socket-bore net-feed-fresh', -2.1, 0, 1.7);
        circle(g, link ? 'net-socket-plug net-feed-sewage' : 'net-socket-bore net-feed-sewage', 2.1, 0, 1.7);
        break;
      }
      default: { // a duct collar
        rect(g, 'net-socket-flange', -h, -h, size, size);
        rect(g, link ? 'net-socket-plug' : 'net-socket-bore', -h + 2, -h + 2, size - 4, size - 4);
      }
    }
  }

  // --- links -------------------------------------------------------------------

  /** A network's riser: every one of its trunks drops down the same one. */
  function riserOf(network) {
    const lane = LANES[network];
    return lane.x ?? layerState.right - lane.fromRight;
  }

  /**
   * A trunk's route from socket to socket: up out of the socket to its
   * row's tray, along the ceiling to the riser, down it, and along and into
   * the other socket. On one level it runs straight along. `b` may be a bare
   * point (the ghost's free end), which the route runs straight into.
   */
  function trunkRoute(network, a, b) {
    const up = { x: a.x, y: trayOf(a) };
    const down = b.size ? { x: b.x, y: trayOf(b) } : { x: b.x, y: b.y };
    const riser = a.lane ?? b.lane ?? riserOf(network);
    const middle = up.y === down.y ? [] : [{ x: riser, y: up.y }, { x: riser, y: down.y }];
    return dedupe([{ x: a.x, y: a.y }, up, ...middle, down, { x: b.x, y: b.y }]);
  }

  /**
   * Where a line from socket `a` meets the run `hostId` it tees into: on the
   * line's riser at the height `a`'s line runs along its ceiling, or the
   * nearest point of the run to that — so branches meet the main run on the
   * riser, and a chain of tees stacks up it.
   */
  function teePoint(network, a, hostId) {
    const route = layerState.routes.get(hostId);
    if (!route) return null;
    return nearestOn(route, { x: riserOf(network), y: trayOf(a) });
  }

  /** A tee's branch: up out of its socket to its tray, along to the run, and onto it. */
  function tapRoute(a, point) {
    const tray = trayOf(a);
    return dedupe([{ x: a.x, y: a.y }, { x: a.x, y: tray }, { x: point.x, y: tray }, { x: point.x, y: point.y }]);
  }

  /**
   * A hanging line's route, from the hub's socket: straight down (or up) the
   * hub's wall to the room's tray, strung across the ceiling to above its
   * socket, and down into it.
   */
  function hangRoute(hub, room) {
    const tray = room.size ? trayOf(room) : room.y;
    return dedupe([{ x: hub.x, y: hub.y }, { x: hub.x, y: tray }, { x: room.x, y: tray }, { x: room.x, y: room.y }]);
  }

  /** Both ends of a link, as drawn, or null when one is not on the page. */
  function endsOf(link) {
    const a = spotOfEnd(link, link.a);
    const b = link.tap ? null : spotOfEnd(link, link.b);
    return a && b ? [a, b] : null;
  }

  /** A trunk link's route as drawn: socket to socket, or a tee's branch onto the run it taps. */
  function linkRoute(network, link) {
    if (link.tap) {
      const a = spotOfEnd(link, link.a);
      const point = a && teePoint(network, a, link.tap);
      return point ? tapRoute(a, point) : null;
    }
    const ends = endsOf(link);
    return ends ? trunkRoute(network, ...ends) : null;
  }

  /**
   * The mains, the drains and the ducts: tiles along each link's route and
   * joints at the corners, and what moves in them — clean water up the
   * mains from the pumps, sewage down the drains to the reclamation plant
   * (flows.water.pipes, systems/water/greywaterLoop.js), air along the ducts
   * (flows.air.links, systems/airQuality/airflow.js). Returns the particle
   * streams.
   */
  function drawTrunk(state, net) {
    const network = net.graph.networkId;
    const air = AIR_LINES.includes(network);
    const tiles = tilesOf({ 'water-mains': 'main', sewer: 'sewer', [FOUL]: 'duct', [FRESH]: 'fresh-duct' }[network]);
    const flowsOf = air ? state.resources.flows.air?.links ?? {} : state.resources.flows.water?.pipes ?? {};
    const streams = [];
    // In the order laid, so a run is drawn before any tee into it.
    for (const link of net.links) {
      const route = linkRoute(network, link);
      if (!route) continue;
      tileRoute(lines, defs, tiles, route);
      catchLine(link, network, route, straightPath(route));
      const flow = flowsOf[link.id];
      if (!flow || flow.flow < 0.5) continue;
      // What moves runs with it: from its upstream end.
      streams.push({
        key: link.id,
        points: flow.to === link.a.instanceId ? [...route].reverse() : route,
        flow: flow.flow,
        airQuality: air ? flow.airQuality : network === 'sewer' ? 0 : 100,
        ...(air ? {} : { across: 7 }),
      });
    }
    return streams;
  }

  /** The high-voltage trunks: a thick black cable, sagging where it hangs across a room. */
  function drawCables(state, net) {
    for (const link of net.links) {
      const ends = endsOf(link);
      if (!ends) continue;
      const route = trunkRoute('power-grid', ...ends);
      const d = hangingPath(route);
      trunkCable(lines, d);
      catchLine(link, 'power-grid', route, d);
    }
  }

  /** The hub end of a hanging link first. */
  function hubFirst(ends, link) {
    return isHub(ctx, link.network, link.a.buildingId) ? ends : [ends[1], ends[0]];
  }

  /** A junction's low-voltage wires, each to the room it lights: dark where the room is. */
  function drawWires(state, net) {
    for (const link of net.links) {
      const ends = endsOf(link);
      if (!ends) continue;
      const [hub, room] = hubFirst(ends, link);
      const route = hangRoute(hub, room);
      const d = hangingPath(route);
      wire(flows, d, room.instance.powered !== false);
      catchLine(link, 'power-lines', route, d);
      clamp(flows, room.x, trayOf(room));
    }
  }

  /**
   * A cistern's feed lines: a double pipe to each room, the water in and
   * the used water back, side by side. Dark where the room is going short.
   */
  function drawFeeds(state, net) {
    for (const link of net.links) {
      const ends = endsOf(link);
      if (!ends) continue;
      const [hub, room] = hubFirst(ends, link);
      const route = hangRoute(hub, room);
      const d = hangingPath(route);
      catchLine(link, 'water-feeds', route, d);
      const lit = (room.instance.waterShare ?? 1) > 0.5;
      for (const [network, shift] of [['sewer', 1.4], ['water-mains', -1.4]]) {
        const g = svg(flows, 'g');
        g.setAttribute('transform', `translate(${shift} ${shift})`);
        feedPipe(g, d, network, lit);
      }
      clamp(flows, room.x, trayOf(room));
    }
  }

  function tilesOf(kind) {
    return {
      v: view.art.conduit?.(`${kind}-v`) ?? null,
      h: view.art.conduit?.(`${kind}-h`) ?? null,
      joint: view.art.conduit?.(`${kind}-joint`) ?? null,
    };
  }

  /** A label on a room: a junction's priority. Bottom right, clear of the sockets and the shortage plate. */
  function tag(state, node, label) {
    const r = roomRect(node, state.buildings);
    const width = 6 + label.length * 5;
    const g = svg(outlines, 'g', 'net-tag');
    g.setAttribute('transform', `translate(${r.x + r.width - 4 - width} ${r.y + ROOM_HEIGHT - 16})`);
    const box = svg(g, 'rect');
    box.setAttribute('width', String(width));
    box.setAttribute('height', '10');
    const text = svg(g, 'text');
    text.setAttribute('x', '3');
    text.setAttribute('y', '7.5');
    text.textContent = label;
  }

  // --- the air's gauges -------------------------------------------------------

  /** Every room carries a gauge with the two numbers the loop is for: its oxygen and its pollution. */
  function drawGauges(state, currentCtx) {
    for (const b of state.buildings) {
      // The surface is outside the Shaft's air.
      if (!state.levels[b.level - 1] || isOutside(currentCtx, state.levels[b.level - 1])) continue;
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

  // --- laying ------------------------------------------------------------------

  /** The lines a link in hand can be laid on: a pooled sleeve's every line, or its own. */
  function linesOf(linkFrom) {
    return linkFrom.lines ?? [linkFrom.network];
  }

  /**
   * Where the half-laid link would go from the element under the pointer: a
   * free socket it fits, a room with one, or — from a socket — a run it can
   * tee into; anything else leaves it hanging at the pointer. Returns
   * { network, check, spot } for a socket (from a joint, the socket's room
   * tees into the run in hand), { network, check, tap, point } for a tee,
   * or null.
   */
  function targetUnder(state, linkFrom, hit) {
    const miss = { network: null, spot: null, check: { ok: false } };
    const plug = hit?.closest?.('.net-socket');
    if (plug) {
      const lines = plug.dataset.lines.split(' ').filter((l) => linesOf(linkFrom).includes(l));
      if (!lines.length || plug.dataset.used === 'true') return miss;
      const spot = freeSpot(lines[0], plug.dataset.instance, plug.dataset.socket);
      if (!spot || spot.instance.instanceId === linkFrom.instanceId) return null;
      if (linkFrom.tap) {
        const check = tappable(state, ctx, { instanceId: spot.instance.instanceId, socket: spot.socket.id }, linkFrom.network, linkFrom.tap);
        return { network: linkFrom.network, spot, check };
      }
      const check = layable(state, ctx, linkFrom, spot.instance.instanceId, spot.socket.id, lines);
      return { network: check.network, spot, check };
    }
    const pipe = hit?.closest?.('.net-pipe-hit, .net-joint-hit');
    if (pipe) {
      const network = pipe.dataset.network;
      if (linkFrom.tap || !linesOf(linkFrom).includes(network)) return miss;
      const from = freeSpot(network, linkFrom.instanceId, linkFrom.socket);
      const point = from && teePoint(network, from, pipe.dataset.link);
      if (!point) return miss;
      return { network, tap: pipe.dataset.link, point, check: tappable(state, ctx, linkFrom, network, pipe.dataset.link) };
    }
    const room = hit?.closest?.('.building');
    const id = room?.dataset.instance;
    if (!id || id === linkFrom.instanceId) return null;
    if (linkFrom.tap) {
      const check = tappable(state, ctx, { instanceId: id, socket: null }, linkFrom.network, linkFrom.tap);
      const spot = check.fromSocket ? freeSpot(linkFrom.network, id, check.fromSocket) : null;
      return spot ? { network: linkFrom.network, spot, check } : miss;
    }
    const check = layable(state, ctx, linkFrom, id, null);
    const spot = check.toSocket ? freeSpot(check.network, id, check.toSocket) : null;
    return spot ? { network: check.network, spot, check } : miss;
  }

  /**
   * The ghost of the link being laid: the cable, wire, pipe or duct it would
   * be, half-seen, from its socket to the one under the pointer or to the
   * tee it would make on a run — or, teeing from a joint, from the socket
   * under the pointer to the run — lit where it can go, red where it cannot,
   * or hanging free at the pointer.
   */
  function drawGhost(state, hit) {
    ghost.replaceChildren();
    const { linkFrom } = selection.get();
    const from = linkFrom && !linkFrom.tap ? freeSpot(linkFrom.network, linkFrom.instanceId, linkFrom.socket) : null;
    if (!linkFrom || (!from && !linkFrom.tap) || !layerState.pointer) {
      ghost.style.display = 'none';
      return;
    }
    const target = hit ? targetUnder(state, linkFrom, hit) : null;
    const network = target?.network ?? linkFrom.network;
    const pointer = layerState.pointer;
    let route;
    if (linkFrom.tap) {
      const point = target?.spot && teePoint(network, target.spot, linkFrom.tap);
      route = point ? tapRoute(target.spot, point)
        : dedupe([{ x: linkFrom.x, y: linkFrom.y }, { x: linkFrom.x, y: pointer.y }, pointer]);
    } else {
      const to = target?.spot ?? pointer;
      route = target?.tap ? tapRoute(from, target.point)
        : HANGING.has(network) ? (isHub(ctx, network, from.instance.buildingId) ? hangRoute(from, to) : hangRoute(to, from))
          : trunkRoute(network, from, to);
    }
    const d = network === 'power-grid' || HANGING.has(network) ? hangingPath(route) : straightPath(route);
    ghost.dataset.style = networkDef(ctx, network)?.socketStyle ?? from?.style ?? 'hv';
    ghost.dataset.ok = target ? String(target.check.ok) : 'free';
    ghost.style.setProperty('--net', colorOf(network));
    svg(ghost, 'path', 'net-ghost-edge').setAttribute('d', d);
    svg(ghost, 'path', 'net-ghost-core').setAttribute('d', d);
    const at = target?.spot ?? target?.point;
    if (at) {
      const ring = circle(ghost, 'net-ghost-ring', at.x, at.y, (target.spot?.size ?? 8) / 2 + 2.5);
      ring.dataset.ok = String(target.check.ok);
    }
    ghost.style.display = '';
  }

  /**
   * Lay the half-laid link where `target` says — a room's socket, or a tee
   * on a run; from a joint, the room's socket teed into the run — and carry
   * on: from a hub with another free socket of the kind, or from the run.
   */
  function lay(state, linkFrom, target) {
    if (!target?.network) return;
    const before = state.infrastructure.links.length;
    if (linkFrom.tap) {
      dispatch({ type: 'player:link', network: target.network, from: target.spot.instance.instanceId, fromSocket: target.spot.socket.id, tap: linkFrom.tap });
    } else {
      dispatch({
        type: 'player:link', network: target.network, from: linkFrom.instanceId, fromSocket: linkFrom.socket,
        ...(target.tap ? { tap: target.tap } : { to: target.spot.instance.instanceId, toSocket: target.spot.socket.id }),
      });
    }
    // Refused: the record says why, and the link stays in hand.
    if (state.infrastructure.links.length === before) return;
    layerState.key = null;
    ghost.style.display = 'none';
    if (linkFrom.tap) return;
    const spots = layerState.spots.get(`${target.network}|${linkFrom.instanceId}`) ?? [];
    const left = spots.filter((s) => s.socket.id === linkFrom.socket && !s.link).length - 1;
    selection.startLink(left > 0 && isHub(ctx, target.network, state.buildings.find((b) => b.instanceId === linkFrom.instanceId)?.buildingId)
      ? { ...linkFrom }
      : null);
  }

  /**
   * A click in the shaft while a network is open. Returns whether it was
   * used; anything else falls through to the inspector.
   *
   *   laying     a socket, room or run it can go to lays it; nothing else
   *              stops it — only a right-click or Esc does
   *   a socket   free: starts a link. Used: picks its line out — or, if its
   *              line is the one picked out, takes it out
   *   a joint    on a pipe, drain or duct: starts a link from that run, to
   *              tee a room into it
   *   a line     picks it out
   *   elsewhere  lets a picked-out line go
   */
  function pick(state, hit, node) {
    const { network, linkFrom, highlight } = selection.get();
    if (!network) return false;
    if (linkFrom) {
      const target = targetUnder(state, linkFrom, hit?.closest?.('.net-socket, .net-pipe-hit, .net-joint-hit') ?? node);
      if (target?.check.ok) lay(state, linkFrom, target);
      return true;
    }
    const plug = hit?.closest?.('.net-socket');
    if (plug) {
      const { network: line, instance, socket, used, link } = plug.dataset;
      if (used === 'true') {
        if (link === highlight) {
          dispatch({ type: 'player:unlink', linkId: link });
          selection.highlightLink(null);
          layerState.key = null;
        } else {
          selection.highlightLink(link);
        }
        return true;
      }
      const lines = plug.dataset.lines.split(' ');
      selection.startLink({ instanceId: instance, network: line, socket, ...(lines.length > 1 ? { lines } : {}) });
      return true;
    }
    const knee = hit?.closest?.('.net-joint-hit');
    if (knee) {
      selection.startLink({ network: knee.dataset.network, tap: knee.dataset.link, x: Number(knee.dataset.x), y: Number(knee.dataset.y) });
      return true;
    }
    const pipe = hit?.closest?.('.net-pipe-hit');
    if (pipe) {
      selection.highlightLink(pipe.dataset.link);
      return true;
    }
    if (highlight) {
      selection.highlightLink(null);
      return true;
    }
    return false;
  }
}

/** Sleeves whose line leaves them level: the pipes, drains, feed lines and ducts. */
const FLUSH = new Set(['main-fresh', 'main-sewage', 'feed', 'duct-foul', 'duct-fresh']);

/**
 * The height a line runs along the ceiling from its socket: level with a
 * pipe's or duct's sleeve, a little above an outlet for a cable or wire.
 */
function trayOf(spot) {
  return FLUSH.has(spot.style) ? spot.y : spot.y - spot.size / 2 - 3;
}

/** A route as one path of straight runs. */
function straightPath(route) {
  return route.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('');
}

/** The point on a route nearest to `p`. */
function nearestOn(route, p) {
  let best = route[0];
  let bestD = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    const q = { x: Math.round(a.x + t * dx), y: Math.round(a.y + t * dy) };
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/** A route without its repeated points. */
function dedupe(route) {
  return route.filter((p, i) => i === 0 || p.x !== route[i - 1].x || p.y !== route[i - 1].y);
}

function rect(parent, className, x, y, width, height) {
  const node = svg(parent, 'rect', className);
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y));
  node.setAttribute('width', String(Math.max(0, width)));
  node.setAttribute('height', String(Math.max(0, height)));
  return node;
}

function circle(parent, className, cx, cy, r) {
  const node = svg(parent, 'circle', className);
  node.setAttribute('cx', cx.toFixed(2));
  node.setAttribute('cy', cy.toFixed(2));
  node.setAttribute('r', String(Math.max(0, r)));
  return node;
}
