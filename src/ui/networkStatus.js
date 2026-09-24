/**
 * networkStatus.js
 * What a network the player lays looks like from the panel: its groups of
 * linked-together nodes, whether each group has anything to hand out, what
 * each hub reaches, what nothing reaches, and the pages the networks are
 * laid from (a page's lines are drawn, and their sockets offered, together). One place for the
 * Infrastructure panel (screens/infrastructureScreen.js) and the overlay in
 * the shaft (view/networkLayer.js), so the two can never disagree about what
 * is connected.
 *
 * Reads state and the graph the simulation itself settles over
 * (systems/infrastructure/networkGraph.js). Never writes.
 */

import {
  graphOf, isHub, isUser, reachOf, levelsServedBy, downhillFrom, linksOf, networkDef, feederOf, teeOf,
} from '../systems/infrastructure/networkGraph.js';
import { residentsByLevel } from '../systems/population/housing.js';
import { isOutside } from '../systems/airQuality/airflow.js';
import { powerDemand, outputScale } from '../systems/buildings/buildingRegistry.js';

/** The networks in the order the panel lists them. */
export function networkIds(ctx) {
  return (ctx.catalog.networks?.all ?? []).map((n) => n.id);
}

/**
 * The Infrastructure panel's pages, each the lines one loop is laid from:
 * the power's high-voltage cables and low-voltage wires, the water's mains,
 * drains and feed lines, the air's two ducts. The shaft draws a page's lines
 * together and offers every socket on them.
 */
export const PAGES = [
  { id: 'power', name: 'Power', lines: ['power-grid', 'power-lines'] },
  { id: 'water', name: 'Water', lines: ['water-mains', 'sewer', 'water-feeds'] },
  { id: 'air', name: 'Air', lines: ['foul-ducts', 'fresh-ducts'] },
];

/** The page a network is laid from, or null. */
export function pageOf(networkId) {
  return PAGES.find((p) => p.lines.includes(networkId)) ?? null;
}

/** The lines drawn with a network: its page's, or just its own. */
export function linesWith(networkId) {
  return pageOf(networkId)?.lines ?? [networkId];
}

/** The CSS colour token for a network (styles/tokens.css). */
export function colorOf(networkId) {
  return `var(--net-${networkId})`;
}

/** What a node does on a network, in a word or two. */
export function roleOf(ctx, networkId, instance) {
  const def = ctx.catalog.buildings.byId[instance.buildingId];
  if (isHub(ctx, networkId, def.id)) {
    return { 'power-lines': 'junction', 'water-feeds': 'cistern', 'foul-ducts': 'fan', 'fresh-ducts': 'fan' }[networkId] ?? 'hub';
  }
  if (isUser(ctx, networkId, def.id)) return 'room';
  if (def.id === 'junction') return 'junction';
  if ((def.effects ?? []).some((e) => e.op === 'buffer.add' && e.target === 'water')) return networkId === 'sewer' ? 'drain' : 'cistern';
  if ((def.produces ?? []).some((p) => p.id === 'power')) return 'source';
  if ((def.produces ?? []).some((p) => p.id === 'water')) return 'source';
  if ((def.effects ?? []).some((e) => e.op === 'reclamation.enable')) return networkId === 'sewer' ? 'outfall' : 'source';
  if ((def.effects ?? []).some((e) => e.op === 'flow.setQuality')) return 'filter';
  if ((def.effects ?? []).some((e) => e.op === 'buffer.add' && e.target === 'power')) return 'store';
  if ((def.effects ?? []).some((e) => e.op === 'flow.scrub')) return 'scrubber';
  if (def.oxygenOutput && networkId !== 'water-mains' && networkId !== 'sewer') return 'garden';
  return 'node';
}

/**
 * The network, read for the panel:
 *   graph     the simulation's graph
 *   groups    [{ key, nodes, live }] — linked-together nodes, the group with
 *             something to hand out first
 *   links     the laid links, with both ends (a tap: its building, and
 *             `tee`, where it meets the link it taps)
 *   reach     Map level -> [hub] for hubs whose group is live
 *   gaps      [{ level, instance?, what }] — what nothing reaches
 */
export function readNetwork(state, ctx, networkId) {
  const graph = graphOf(state, ctx, networkId);
  const def = (i) => ctx.catalog.buildings.byId[i.buildingId];
  const liveOf = liveTest(state, ctx, networkId, graph);

  const groups = [...graph.members.entries()].map(([key, nodes]) => ({ key, nodes, live: liveOf(nodes) }));
  groups.sort((a, b) => Number(b.live) - Number(a.live) || b.nodes.length - a.nodes.length);
  const liveKeys = new Set(groups.filter((g) => g.live).map((g) => g.key));

  const reach = new Map();
  for (const node of graph.nodes) {
    if (!isHub(ctx, networkId, node.buildingId) || node.brokenDown || !reachOf(ctx, node)) continue;
    if (!liveKeys.has(graph.component.get(node.instanceId))) continue;
    for (const level of levelsServedBy(state, ctx, node)) {
      if (!reach.has(level)) reach.set(level, []);
      reach.get(level).push(node);
    }
  }

  const byId = new Map(state.buildings.map((b) => [b.instanceId, b]));
  // A tap has no building at its far end: `tee` is where it meets the run it taps.
  const links = linksOf(state, networkId).map((l) => ({
    ...l, a: byId.get(l.from), b: l.tap ? null : byId.get(l.to), tee: l.tap ? graph.byId.get(teeOf(l)) ?? null : null,
  }));

  return { graph, groups, links, reach, gaps: gapsOf(state, ctx, networkId, graph, reach, def) };
}

/** Whether a group of nodes has anything to hand out. */
function liveTest(state, ctx, networkId, graph) {
  const def = (i) => ctx.catalog.buildings.byId[i.buildingId];
  const power = state.resources.flows.power;
  const water = state.resources.flows.water;
  // Whether a hub's trunk group has something to hand out.
  const trunks = new Map();
  const feeds = (trunkId, hub) => {
    if (!trunks.has(trunkId)) {
      const trunk = graphOf(state, ctx, trunkId);
      const live = liveTest(state, ctx, trunkId, trunk);
      trunks.set(trunkId, { trunk, live: new Map([...trunk.members].map(([k, nodes]) => [k, live(nodes)])) });
    }
    const { trunk, live } = trunks.get(trunkId);
    return !trunk.enforced || !!live.get(trunk.component.get(hub.instanceId));
  };
  return (nodes) => nodes.some((n) => {
    const d = def(n);
    switch (networkId) {
      case 'power-grid':
        return (d.produces ?? []).some((p) => p.id === 'power') || (power.batteries?.[n.instanceId] ?? 0) > 0;
      case 'power-lines':
        // A junction's wires are live when its high-voltage side is.
        return isHub(ctx, networkId, d.id) && feeds('power-grid', n);
      case 'water-feeds':
        return isHub(ctx, networkId, d.id) && feeds('water-mains', n);
      case 'water-mains':
        // Only a pump moves water; a cistern holds what it was sent.
        return (d.produces ?? []).some((p) => p.id === 'water')
          || (water.cisterns?.[n.instanceId] ?? 0) > 0;
      case 'sewer':
        return (d.effects ?? []).some((e) => e.op === 'reclamation.enable');
      case 'foul-ducts':
      case 'fresh-ducts':
        // A group is live when air moves through it.
        return (state.resources.flows.air?.nodes?.[n.instanceId]?.flow ?? 0) > 0;
      default:
        return true;
    }
  });
}

/** What needs the network and is not reached by it. */
function gapsOf(state, ctx, networkId, graph, reach, def) {
  if (!graph.enforced) return [];
  const liveOf = liveTest(state, ctx, networkId, graph);
  const groupLive = (key) => liveOf(graph.members.get(key) ?? []);
  const residents = residentsByLevel(state, ctx);
  const gaps = [];
  switch (networkId) {
    case 'power-grid':
      // A junction with nothing feeding it lights nothing.
      for (const [key, nodes] of graph.members) {
        if (groupLive(key)) continue;
        for (const n of nodes) if (n.buildingId === 'junction') gaps.push({ level: n.level, instance: n, what: 'no high-voltage feed' });
      }
      break;
    case 'power-lines':
      for (const b of state.buildings) {
        if (!isUser(ctx, networkId, b.buildingId) || (graph.neighbours.get(b.instanceId) ?? []).length) continue;
        gaps.push({ level: b.level, instance: b, what: 'wired to no junction' });
      }
      break;
    case 'water-mains': {
      // A cistern no pump fills runs dry.
      for (const [key, nodes] of graph.members) {
        if (nodes.some((m) => (def(m).produces ?? []).some((p) => p.id === 'water'))) continue;
        for (const n of nodes) if (n.buildingId === 'cistern') gaps.push({ level: n.level, instance: n, what: 'no pump fills it' });
      }
      // A plant piped to no pump: what it recovers never gets back.
      for (const n of graph.nodes) {
        if (!(def(n).effects ?? []).some((e) => e.op === 'reclamation.enable')) continue;
        const members = graph.members.get(graph.component.get(n.instanceId)) ?? [];
        if (members.some((m) => (def(m).produces ?? []).some((p) => p.id === 'water'))) continue;
        gaps.push({ level: n.level, instance: n, what: 'piped to no pump — its water is wasted' });
      }
      break;
    }
    case 'water-feeds': {
      const mains = graphOf(state, ctx, 'water-mains');
      for (const b of state.buildings) {
        if (!isUser(ctx, networkId, b.buildingId)) continue;
        if (feederOf(graph, mains, ctx, b)) continue;
        gaps.push({ level: b.level, instance: b, what: def(b).housing > 0 ? 'no feed line: its residents go dry' : 'no feed line from a cistern' });
      }
      break;
    }
    case 'sewer': {
      // A cistern whose drains reach no reclamation plant dumps what its
      // area uses.
      const plants = graph.nodes.filter((n) => (def(n).effects ?? []).some((e) => e.op === 'reclamation.enable'));
      for (const n of graph.nodes) {
        if (!(def(n).effects ?? []).some((e) => e.op === 'buffer.add' && e.target === 'water')) continue;
        const down = downhillFrom(graph, n.instanceId);
        if (plants.some((p) => down.has(p.instanceId))) continue;
        gaps.push({ level: n.level, instance: n, what: 'drains to no reclamation plant' });
      }
      break;
    }
    case 'foul-ducts':
    case 'fresh-ducts': {
      // Where people live and no air flows past, bar a scrubber's or
      // garden's own level.
      const own = new Set(graph.nodes.filter((n) => !isHub(ctx, networkId, n.buildingId)).map((n) => n.level));
      residents.forEach((n, level) => {
        if (level < 1 || n < 1 || own.has(level)) return;
        if (airingOf(state, ctx, level) !== 'still') return;
        gaps.push({ level, what: `${Math.round(n)} residents, still air` });
      });
      break;
    }
    default:
  }
  return gaps.sort((a, b) => a.level - b.level);
}

/**
 * How well a level is aired by the loop: 'outside' for the surface, open to
 * the air; 'still' with nothing flowing past
 * it, 'weak' where the flow would take several ticks to change its air,
 * 'aired' otherwise.
 */
export function airingOf(state, ctx, level) {
  if (state.levels[level - 1] && isOutside(ctx, state.levels[level - 1])) return 'outside';
  const through = state.resources.flows.air?.through?.[level] ?? 0;
  const volume = ctx.tables?.levels?.levelTemplate?.airVolume ?? 100;
  if (through < volume * 0.01) return 'still';
  return through < volume * 0.25 ? 'weak' : 'aired';
}

/** A sentence on what a network is and how it is laid. */
export function describe(ctx, networkId) {
  return networkDef(ctx, networkId)?.description ?? '';
}
