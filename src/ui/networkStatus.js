/**
 * networkStatus.js
 * What a network the player lays looks like from the panel: its groups of
 * linked-together nodes, whether each group has anything to hand out, what
 * each hub reaches, and what nothing reaches. One place for the
 * Infrastructure panel (screens/infrastructureScreen.js) and the overlay in
 * the shaft (view/networkLayer.js), so the two can never disagree about what
 * is connected.
 *
 * Reads state and the graph the simulation itself settles over
 * (systems/infrastructure/networkGraph.js). Never writes.
 */

import {
  graphOf, isHub, levelsServedBy, downhillFrom, linksOf, networkDef,
} from '../systems/infrastructure/networkGraph.js';
import { residentsByLevel } from '../systems/population/housing.js';
import { powerDemand, outputScale } from '../systems/buildings/buildingRegistry.js';

/** The networks in the order the panel lists them. */
export function networkIds(ctx) {
  return (ctx.catalog.networks?.all ?? []).map((n) => n.id);
}

/** The CSS colour token for a network (styles/tokens.css). */
export function colorOf(networkId) {
  return `var(--net-${networkId})`;
}

/** What a node does on a network, in a word or two. */
export function roleOf(ctx, networkId, instance) {
  const def = ctx.catalog.buildings.byId[instance.buildingId];
  if (isHub(ctx, networkId, def.id)) {
    return { 'power-grid': 'junction', 'water-mains': 'cistern', sewer: 'drain', 'duct-network': 'vent', 'oxygen-ducts': 'vent' }[networkId] ?? 'hub';
  }
  if ((def.produces ?? []).some((p) => p.id === 'power')) return 'source';
  if ((def.produces ?? []).some((p) => p.id === 'water')) return 'source';
  if ((def.effects ?? []).some((e) => e.op === 'reclamation.enable')) return networkId === 'sewer' ? 'outfall' : 'source';
  if ((def.effects ?? []).some((e) => e.op === 'flow.setQuality')) return 'filter';
  if ((def.effects ?? []).some((e) => e.op === 'buffer.add' && e.target === 'power')) return 'store';
  if ((def.effects ?? []).some((e) => e.op === 'flow.scrub')) return 'scrubber';
  if (def.oxygenOutput) return 'source';
  return 'node';
}

/**
 * The network, read for the panel:
 *   graph     the simulation's graph
 *   groups    [{ key, nodes, live }] — linked-together nodes, the group with
 *             something to hand out first
 *   links     the laid links, with both ends
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
    if (!isHub(ctx, networkId, node.buildingId) || node.brokenDown) continue;
    if (!liveKeys.has(graph.component.get(node.instanceId))) continue;
    for (const level of levelsServedBy(state, ctx, node)) {
      if (!reach.has(level)) reach.set(level, []);
      reach.get(level).push(node);
    }
  }

  const byId = new Map(state.buildings.map((b) => [b.instanceId, b]));
  const links = linksOf(state, networkId).map((l) => ({ ...l, a: byId.get(l.from), b: byId.get(l.to) }));

  return { graph, groups, links, reach, gaps: gapsOf(state, ctx, networkId, graph, reach, def) };
}

/** Whether a group of nodes has anything to hand out. */
function liveTest(state, ctx, networkId, graph) {
  const def = (i) => ctx.catalog.buildings.byId[i.buildingId];
  const power = state.resources.flows.power;
  const water = state.resources.flows.water;
  return (nodes) => nodes.some((n) => {
    const d = def(n);
    switch (networkId) {
      case 'power-grid':
        return (d.produces ?? []).some((p) => p.id === 'power') || (power.batteries?.[n.instanceId] ?? 0) > 0;
      case 'water-mains':
        return (d.produces ?? []).some((p) => p.id === 'water')
          || (d.effects ?? []).some((e) => e.op === 'reclamation.enable')
          || (water.cisterns?.[n.instanceId] ?? 0) > 0;
      case 'sewer':
        return (d.effects ?? []).some((e) => e.op === 'reclamation.enable');
      case 'duct-network':
        return (d.effects ?? []).some((e) => e.op === 'flow.scrub');
      case 'oxygen-ducts':
        return (d.oxygenOutput ?? 0) > 0;
      default:
        return true;
    }
  });
}

/** What needs the network and is not reached by it. */
function gapsOf(state, ctx, networkId, graph, reach, def) {
  if (!graph.enforced) return [];
  const residents = residentsByLevel(state, ctx);
  const gaps = [];
  switch (networkId) {
    case 'power-grid':
      for (const b of state.buildings) {
        if (reach.has(b.level)) continue;
        if (powerDemand(b, def(b), ctx, state) <= 0 && !(def(b).powerDraw > 0)) continue;
        gaps.push({ level: b.level, instance: b, what: 'no junction in reach' });
      }
      break;
    case 'water-mains':
      for (const b of state.buildings) {
        if (reach.has(b.level) || !(def(b).consumes ?? []).some((c) => c.id === 'water')) continue;
        gaps.push({ level: b.level, instance: b, what: 'no cistern in reach' });
      }
      residents.forEach((n, level) => {
        if (level >= 1 && n >= 1 && !reach.has(level)) gaps.push({ level, what: `${Math.round(n)} residents, no cistern in reach` });
      });
      break;
    case 'sewer': {
      // A cistern whose drains reach no reclamation plant dumps what its
      // area uses.
      const plants = graph.nodes.filter((n) => (def(n).effects ?? []).some((e) => e.op === 'reclamation.enable'));
      for (const n of graph.nodes) {
        if (!isHub(ctx, networkId, n.buildingId)) continue;
        const down = downhillFrom(graph, n.instanceId);
        if (plants.some((p) => down.has(p.instanceId))) continue;
        gaps.push({ level: n.level, instance: n, what: 'drains to no reclamation plant' });
      }
      break;
    }
    case 'duct-network':
    case 'oxygen-ducts': {
      // Fans only move air while they run.
      const running = new Map();
      for (const [level, hubs] of reach) {
        const on = hubs.filter((h) => outputScale(h, def(h), ctx) > 0);
        if (on.length) running.set(level, on);
      }
      const sources = new Set(graph.nodes.filter((n) => !isHub(ctx, networkId, n.buildingId)).map((n) => n.level));
      residents.forEach((n, level) => {
        if (level < 1 || n < 1 || running.has(level) || sources.has(level)) return;
        gaps.push({ level, what: `${Math.round(n)} residents, no fan in reach` });
      });
      break;
    }
    default:
  }
  return gaps.sort((a, b) => a.level - b.level);
}

/** A sentence on what a network is and how it is laid. */
export function describe(ctx, networkId) {
  return networkDef(ctx, networkId)?.description ?? '';
}
