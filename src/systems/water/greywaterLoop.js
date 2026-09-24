/**
 * greywaterLoop.js
 * The `water` system. Closed-loop water: pumps lift groundwater, people and
 * buildings use it, and what they use returns downhill as greywater for
 * reclamation to recover — at a loss, and dirtier each time round unless a
 * purifier is running. Reclamation capacity is what lets the population grow
 * past what the aquifer alone can supply.
 *
 * Piped like a flow and buffered like a stock (catalog/resources/flows.json):
 * surplus fills the cisterns, a deficit drains them, and only when they are
 * dry does anyone go short. Then it is RATIONED, and people drink first: a
 * building gets a share of what is left, and works that much slower
 * (`waterShare`, read by outputScale next tick).
 *
 * Owns state.resources.flows.water and each instance's `waterShare`.
 */

import { approach, clamp } from '../../utils/math.js';
import { workScale, outputScale } from '../buildings/buildingRegistry.js';
import { residentsByLevel } from '../population/housing.js';
import { cohortFactor } from '../population/demography.js';

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
  };
}

export function tick(state, ctx) {
  const water = state.resources.flows.water;
  const cfg = ctx.config.water;

  // --- supply -----------------------------------------------------------
  let pumpCapacity = 0;
  let reclaimScale = 0;
  let pumpLevel = null;
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;
    const scale = outputScale(instance, def, ctx);
    const produced = (def.produces ?? []).find((p) => p.id === 'water');
    if (produced) {
      pumpCapacity += produced.qty * scale;
      pumpLevel = Math.max(pumpLevel ?? 0, instance.level);
    }
    if ((def.effects ?? []).some((e) => e.op === 'reclamation.enable')) reclaimScale += scale;
  }
  const reclaimed = water.greywater * cfg.reclamationEfficiency * clamp(reclaimScale, 0, 1);

  // --- demand -----------------------------------------------------------
  const residents = residentsByLevel(state, ctx);
  const drinkers = residents.reduce((sum, n) => sum + n, 0);
  const perCapita = cfg.potablePerCapitaPerTick * cohortFactor(state, ctx, 'waterMultiplier');
  const peopleDemand = drinkers * perCapita;

  const users = [];
  let buildingDemand = 0;
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    const use = (def?.consumes ?? []).find((c) => c.id === 'water');
    if (!use) {
      instance.waterShare = 1;
      continue;
    }
    const qty = use.qty * workScale(instance, def, ctx);
    users.push({ instance, qty });
    buildingDemand += qty;
  }

  // --- settle -----------------------------------------------------------
  // Reclaimed water is used first, being already up here. The pumps lift only
  // what is still needed, plus what the cisterns have room for — and the
  // aquifer yields what it yields, however many pumps are sunk into it.
  water.capacity = ctx.modifiers.buffer.water ?? 0;
  // The Shaft opens with its cisterns full, not dry: nothing has been
  // reclaimed yet on the first tick, and that is not a drought.
  if (water.stored === null) water.stored = water.capacity;
  const wanted = peopleDemand + buildingDemand + (water.capacity - water.stored) - reclaimed;
  const pumped = clamp(wanted, 0, Math.min(pumpCapacity, cfg.groundwaterIntakePerTick));
  const available = pumped + reclaimed + water.stored;

  const toPeople = Math.min(peopleDemand, available);
  const toBuildings = Math.min(buildingDemand, available - toPeople);
  water.peopleShare = peopleDemand > 0 ? toPeople / peopleDemand : 1;
  water.buildingShare = buildingDemand > 0 ? toBuildings / buildingDemand : 1;
  for (const { instance } of users) instance.waterShare = water.buildingShare;

  const used = toPeople + toBuildings;
  water.stored = clamp(available - used, 0, water.capacity);
  water.greywater = used; // it all comes back down, dirtier
  water.generation = pumped + reclaimed;
  water.pumped = pumped;
  water.reclaimed = reclaimed;
  water.toPeople = toPeople;
  water.demand = peopleDemand + buildingDemand;

  // How far the pumps lift, on average, to where the water is drunk. Read by
  // powerDemand next tick: water costs more the higher people live.
  water.liftLevels = pumpLevel === null ? 0 : Math.max(0, pumpLevel - meanLevel(residents, perCapita, users));

  // --- quality ----------------------------------------------------------
  // Fresh groundwater is clean; reclaimed water is only as clean as the
  // purifiers make it.
  const purification = clamp(ctx.modifiers.quality?.water ?? 0, 0, 1);
  const reclaimedQuality = cfg.reclaimedQuality + (100 - cfg.reclaimedQuality) * purification;
  const fresh = pumped + reclaimed;
  const target = fresh > 0 ? (pumped * 100 + reclaimed * reclaimedQuality) / fresh : water.quality;
  water.quality = approach(water.quality, target, cfg.qualityDriftPerTick);

  if (water.peopleShare < 1 || water.buildingShare < 1) {
    ctx.emit('water:shortfall', {
      peopleShare: water.peopleShare,
      buildingShare: water.buildingShare,
      shortfall: water.demand - used,
    });
  }
}

/** Demand-weighted mean level of everyone drawing water. */
function meanLevel(residents, perCapita, users) {
  let weight = 0;
  let sum = 0;
  residents.forEach((n, level) => { weight += n * perCapita; sum += n * perCapita * level; });
  for (const { instance, qty } of users) { weight += qty; sum += qty * instance.level; }
  return weight > 0 ? sum / weight : 0;
}
