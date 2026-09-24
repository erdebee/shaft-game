/**
 * greywaterLoop.js
 * The `water` system: the mains and the sewer the player pipes together.
 *
 *   deep pump ─pipe─ cistern ─pipe─ cistern …        (water mains)
 *   reclamation ─pipe─┘    │ supplies every room and resident within reach
 *   cistern ─drain─ cistern ─drain─ reclamation plant (sewer, downhill only)
 *
 * A room or a level's residents draw from the nearest cistern that reaches
 * them — except a room that is itself on the mains (the cultivation rooms),
 * which draws only through its pipes and drains only through its drains. Each piped-together component of the mains is settled on its own:
 * what its reclamation plants recovered is used first, being already up here;
 * its pumps lift the rest, plus what its cisterns have room for — and the
 * aquifer yields what it yields, however many pumps are sunk into it, shared
 * between components in turn. Only when a component's cisterns are dry does
 * anyone on it go short, and then it is RATIONED: people drink first, and a
 * building gets a share of what is left and works that much slower
 * (`waterShare`, read by outputScale next tick).
 *
 * What is used comes back dirty. It drains from the cistern that supplied it,
 * downhill along the sewer, to a reclamation plant — next tick's reclaimed
 * water, at a loss. Sewage no drain can carry away is dumped on the level it
 * was made on (`spilled`), where the air system smells it.
 *
 * Reclaimed water is only as clean as the purifiers on its mains make it.
 *
 * Owns state.resources.flows.water and each instance's `waterShare`.
 */

import { approach, clamp } from '../../utils/math.js';
import { workScale, outputScale } from '../buildings/buildingRegistry.js';
import { residentsByLevel } from '../population/housing.js';
import { cohortFactor } from '../population/demography.js';
import { graphOf, hubFor, downhillFrom, isHub, VIRTUAL } from '../infrastructure/networkGraph.js';

const MAINS = 'water-mains';
const SEWER = 'sewer';

export function initialWater() {
  return {
    generation: 0,
    demand: 0,
    brownedOut: [],
    stored: null, // null until the first tick fills the cisterns
    capacity: 0,
    greywater: 0,
    quality: 100,
    peopleShare: 1,
    buildingShare: 1,
    liftLevels: 0,
    // This tick's supply split by where it came from, and what reached
    // people: kept for the water card (ui/components/resourceTip.js), which
    // cannot tell a pump from the reclamation plant by `generation` alone.
    pumped: 0,
    reclaimed: 0,
    toPeople: 0,
    cisterns: {},  // by cistern instanceId: water held
    sewage: {},    // by reclamation plant instanceId: greywater waiting for it
    lift: {},      // by pump instanceId: levels it lifts, for its power draw
    spilled: [],   // by level: sewage dumped there this tick
    dryLevels: [], // levels with residents no cistern reaches
    unserved: [],  // buildings needing water that no cistern reaches
  };
}

/** Water a cistern holds when full. */
export function cisternCapacity(def) {
  return (def?.effects ?? []).find((e) => e.op === 'buffer.add' && e.target === 'water')?.value ?? 0;
}

export function tick(state, ctx) {
  const water = state.resources.flows.water;
  const cfg = ctx.config.water;
  const fresh = initialWater();
  for (const key of ['cisterns', 'sewage', 'lift']) water[key] ??= fresh[key];
  const def = (i) => ctx.catalog.buildings.byId[i.buildingId];

  const mains = graphOf(state, ctx, MAINS);
  const sewer = graphOf(state, ctx, SEWER);

  // --- the mains' parts, by component --------------------------------------
  const parts = new Map();
  const partOf = (key) => {
    if (!parts.has(key)) {
      parts.set(key, {
        key, pumps: [], pumpCapacity: 0, reclaimed: 0, purify: 0,
        cisterns: [], capacity: 0, stored: 0, people: 0, buildings: [], buildingDemand: 0, levels: [],
      });
    }
    return parts.get(key);
  };
  const firstFill = water.stored === null;
  for (const node of mains.nodes) {
    const d = def(node);
    const part = partOf(mains.component.get(node.instanceId));
    const scale = outputScale(node, d, ctx);
    const produced = (d.produces ?? []).find((p) => p.id === 'water');
    if (produced) {
      part.pumps.push(node);
      part.pumpCapacity += produced.qty * scale;
    }
    if ((d.effects ?? []).some((e) => e.op === 'reclamation.enable')) {
      part.reclaimed += (water.sewage[node.instanceId] ?? 0) * cfg.reclamationEfficiency * clamp(scale, 0, 1);
    }
    const q = (d.effects ?? []).find((e) => e.op === 'flow.setQuality' && e.target === 'water');
    if (q) part.purify += q.value * scale;
    const capacity = cisternCapacity(d);
    if (capacity > 0) {
      // The Shaft opens with its cisterns full, not dry: nothing has been
      // reclaimed yet on the first tick, and that is not a drought.
      if (firstFill || water.cisterns[node.instanceId] === undefined) water.cisterns[node.instanceId] = firstFill ? capacity : 0;
      water.cisterns[node.instanceId] = Math.min(water.cisterns[node.instanceId], capacity);
      part.cisterns.push(node);
      part.capacity += capacity;
      part.stored += water.cisterns[node.instanceId];
    }
  }
  const hasWater = (key) => {
    const p = parts.get(key);
    return !!p && (p.pumpCapacity > 0 || p.reclaimed > 0 || p.stored > 0);
  };
  const usable = (hub) => !hub.brokenDown;
  const hubCache = new Map();
  const hubAt = (level) => {
    if (!hubCache.has(level)) hubCache.set(level, hubFor(mains, ctx, level, { usable, live: hasWater }));
    return hubCache.get(level);
  };
  const keyOf = (hub) => (hub === VIRTUAL ? VIRTUAL : mains.component.get(hub.instanceId));
  // A room on the mains itself (the cultivation rooms) is not served by a
  // cistern's reach but by its pipes: it draws from its own component, and
  // drains by its own drains. It stands as its own hub.
  const piped = (instance) => mains.enforced && mains.byId.has(instance.instanceId)
    && !isHub(ctx, MAINS, instance.buildingId) && !(def(instance).produces ?? []).some((p) => p.id === 'water');
  const hubOf = (instance) => {
    if (!piped(instance)) return hubAt(instance.level);
    return hasWater(mains.component.get(instance.instanceId)) ? instance : null;
  };

  // --- demand, by the cistern that serves it --------------------------------
  const residents = residentsByLevel(state, ctx);
  const perCapita = cfg.potablePerCapitaPerTick * cohortFactor(state, ctx, 'waterMultiplier');
  const drinkers = []; // { level, qty, hub }
  let peopleDemand = 0;
  const dryLevels = [];
  residents.forEach((n, level) => {
    if (!n || level < 1) return;
    const qty = n * perCapita;
    peopleDemand += qty;
    const hub = hubAt(level);
    if (!hub) { dryLevels.push(level); return; }
    drinkers.push({ level, qty, hub });
    const part = partOf(keyOf(hub));
    part.people += qty;
    part.levels.push({ level, qty });
  });

  let buildingDemand = 0;
  const unserved = [];
  const users = [];
  for (const instance of state.buildings) {
    const d = def(instance);
    const use = (d?.consumes ?? []).find((c) => c.id === 'water');
    if (!use) {
      instance.waterShare = 1;
      continue;
    }
    const qty = use.qty * workScale(instance, d, ctx);
    buildingDemand += qty;
    const hub = hubOf(instance);
    if (!hub) {
      instance.waterShare = 0;
      if (qty > 0) unserved.push(instance.instanceId);
      continue;
    }
    users.push({ instance, qty, hub });
    const part = partOf(keyOf(hub));
    part.buildings.push({ instance, qty });
    part.buildingDemand += qty;
    part.levels.push({ level: instance.level, qty });
  }

  // --- settle each component ------------------------------------------------
  let aquifer = cfg.groundwaterIntakePerTick;
  let pumped = 0;
  let reclaimed = 0;
  let toPeople = 0;
  let toBuildings = 0;
  let deliveredQuality = 0;
  let delivered = 0;
  water.lift = {};
  const peopleShareOf = new Map();
  const qualityOf = new Map();
  const purification = new Map();
  for (const part of [...parts.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const demand = part.people + part.buildingDemand;
    const wanted = demand + (part.capacity - part.stored) - part.reclaimed;
    const lifted = clamp(wanted, 0, Math.min(part.pumpCapacity, aquifer));
    aquifer -= lifted;
    const available = lifted + part.reclaimed + part.stored;

    const people = Math.min(part.people, available);
    const rest = Math.min(part.buildingDemand, available - people);
    const buildingShare = part.buildingDemand > 0 ? rest / part.buildingDemand : 1;
    for (const { instance } of part.buildings) instance.waterShare = buildingShare;
    peopleShareOf.set(part.key, part.people > 0 ? people / part.people : 1);

    const used = people + rest;
    const left = clamp(available - used, 0, part.capacity);
    for (const cistern of part.cisterns) {
      water.cisterns[cistern.instanceId] = left * cisternCapacity(def(cistern)) / part.capacity;
    }

    // Fresh groundwater is clean; reclaimed water is only as clean as the
    // purifiers on these mains make it.
    const purified = clamp(part.purify, 0, 1);
    purification.set(part.key, purified);
    const reclaimedQuality = cfg.reclaimedQuality + (100 - cfg.reclaimedQuality) * purified;
    const made = lifted + part.reclaimed;
    qualityOf.set(part.key, made > 0 ? (lifted * 100 + part.reclaimed * reclaimedQuality) / made : null);

    // How far each pump lifts, on average, to where its water is drunk. Read
    // by powerDemand next tick: water costs more the higher people live.
    const mean = meanLevel(part.levels);
    for (const pump of part.pumps) water.lift[pump.instanceId] = mean === null ? 0 : Math.max(0, pump.level - mean);

    pumped += lifted;
    reclaimed += part.reclaimed;
    toPeople += people;
    toBuildings += rest;
    if (made > 0 && used > 0) {
      deliveredQuality += qualityOf.get(part.key) * used;
      delivered += used;
    }
  }

  // --- the sewer: what was used drains downhill, or is dumped -----------------
  const sewage = {};
  const spilled = new Array(state.levels.length + 1).fill(0);
  const plants = sewer.nodes.filter((n) => (def(n).effects ?? []).some((e) => e.op === 'reclamation.enable'));
  const drainCache = new Map();
  const drainsTo = (hub) => {
    const id = hub === VIRTUAL ? VIRTUAL : hub.instanceId;
    if (!drainCache.has(id)) {
      const reach = hub === VIRTUAL || !sewer.enforced ? null
        : sewer.byId.has(hub.instanceId) ? downhillFrom(sewer, hub.instanceId) : new Set();
      drainCache.set(id, plants.filter((p) => !p.brokenDown && (reach === null || reach.has(p.instanceId))));
    }
    return drainCache.get(id);
  };
  const drain = (hub, level, qty) => {
    if (qty <= 0) return;
    const to = drainsTo(hub);
    if (to.length === 0) {
      // Nothing laid to carry it away: it goes where it was made. Unenforced,
      // the sewer is assumed, and what no plant takes simply leaves.
      if (sewer.enforced) spilled[level] += qty;
      return;
    }
    for (const p of to) sewage[p.instanceId] = (sewage[p.instanceId] ?? 0) + qty / to.length;
  };
  for (const { level, qty, hub } of drinkers) drain(hub, level, qty * (peopleShareOf.get(keyOf(hub)) ?? 1));
  for (const { instance, qty, hub } of users) drain(hub, instance.level, qty * (instance.waterShare ?? 1));

  // --- record ---------------------------------------------------------------
  const used = toPeople + toBuildings;
  water.capacity = [...parts.values()].reduce((s, p) => s + p.capacity, 0);
  water.stored = Object.values(water.cisterns).reduce((s, v) => s + v, 0);
  water.sewage = sewage;
  water.spilled = spilled;
  water.greywater = Object.values(sewage).reduce((s, v) => s + v, 0);
  water.generation = pumped + reclaimed;
  water.pumped = pumped;
  water.reclaimed = reclaimed;
  water.toPeople = toPeople;
  water.demand = peopleDemand + buildingDemand;
  water.peopleShare = peopleDemand > 0 ? toPeople / peopleDemand : 1;
  water.buildingShare = buildingDemand > 0 ? toBuildings / buildingDemand : 1;
  water.dryLevels = dryLevels;
  water.unserved = unserved;
  water.liftLevels = Math.max(0, ...Object.values(water.lift));
  water.purification = Object.fromEntries(purification);

  const target = delivered > 0 ? deliveredQuality / delivered : water.quality;
  water.quality = approach(water.quality, target, cfg.qualityDriftPerTick);

  if (water.peopleShare < 1 || water.buildingShare < 1) {
    ctx.emit('water:shortfall', {
      peopleShare: water.peopleShare,
      buildingShare: water.buildingShare,
      shortfall: water.demand - used,
      dryLevels,
    });
  }
}

/** Demand-weighted mean level of everyone a pump's water reaches. */
function meanLevel(levels) {
  let weight = 0;
  let sum = 0;
  for (const { level, qty } of levels) { weight += qty; sum += qty * level; }
  return weight > 0 ? sum / weight : null;
}
