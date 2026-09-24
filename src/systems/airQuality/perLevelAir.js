/**
 * perLevelAir.js
 * The `airQuality` system. Air is tracked per level, not settlement-wide
 * (level.airQuality, 0-100). Each tick, in this order:
 *
 *   1. LOAD      residents and heavy industry foul their own level
 *   2. SCRUB     each working scrubber cleans the levels within its radius,
 *                worst first — a scrubber's capacity goes where the air is
 *                bad, not where it is already clean
 *   3. MIGRATE   air mixes with the levels above and below; duct fans
 *                (network.boost on the duct network) make it mix faster
 *   4. SEAL      a sealed level is cut off from 2 and 3 and goes stale
 *
 * Deep levels, crowded levels and levels far from a scrubber degrade first,
 * which is a political fact as much as a physical one.
 *
 * Also the external catalyst supply: a delivery arrives every
 * air.catalystDeliveryIntervalTicks unless the supply has been cut — the
 * scrubbers' one input nobody in the Shaft can make.
 *
 * Owns level.airQuality and nothing else.
 */

import { clamp } from '../../utils/math.js';
import { outputScale } from '../buildings/buildingRegistry.js';
import { residentsByLevel } from '../population/housing.js';
import { put } from '../resources/stores.js';
import { made } from '../resources/ledger.js';

const CATALYST = 'scrubber-catalyst';

export function tick(state, ctx) {
  const cfg = ctx.config.air;
  const levels = state.levels;
  const residents = residentsByLevel(state, ctx);
  const before = levels.map((l) => l.airQuality);

  // --- 1. load ------------------------------------------------------------
  const load = new Array(levels.length + 1).fill(0);
  for (let i = 1; i < residents.length; i++) load[i] += residents[i] * cfg.contaminantPerCapitaPerTick;
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def?.airLoad) continue;
    // A recipe building is only dirty while it has a batch on.
    if (runsRecipes(def) && !instance.job) continue;
    load[instance.level] += def.airLoad * outputScale(instance, def, ctx);
  }
  for (const level of levels) level.airQuality -= load[level.index];

  // --- 2. scrub -----------------------------------------------------------
  for (const scrubber of scrubbers(state, ctx)) {
    scrub(levels, scrubber, cfg.scrubberRadiusLevels);
  }

  // --- 3. migrate ---------------------------------------------------------
  const boost = ctx.modifiers.network['duct-network'] ?? 0;
  const rate = clamp(cfg.migrationRateBetweenLevels * (1 + boost), 0, 0.5);
  const mixed = levels.map((level, i) => {
    if (level.sealed) return level.airQuality;
    let flow = 0;
    for (const j of [i - 1, i + 1]) {
      const other = levels[j];
      if (!other || other.sealed) continue;
      flow += (other.airQuality - level.airQuality) * rate / 2;
    }
    return level.airQuality + flow;
  });

  // --- 4. seal ------------------------------------------------------------
  levels.forEach((level, i) => {
    const q = level.sealed ? mixed[i] - cfg.sealedLevelDecayPerTick : mixed[i];
    level.airQuality = clamp(q, 0, 100);
  });

  reportCrossings(ctx, levels, before, cfg.qualityCriticalThreshold);
  deliverCatalyst(state, ctx);
}

/**
 * Working scrubbers — anything with a flow.scrub effect on air — with the
 * capacity they have this tick. A starved or dark scrubber has none.
 */
function scrubbers(state, ctx) {
  const out = [];
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    const effect = (def?.effects ?? []).find((e) => e.op === 'flow.scrub' && e.target === 'air-quality');
    if (!effect) continue;
    const capacity = effect.value * outputScale(instance, def, ctx);
    if (capacity > 0) out.push({ level: instance.level, capacity });
  }
  return out;
}

/**
 * Spend one scrubber's capacity on the unsealed levels in its radius, filling
 * the worst first. Levels are topped up toward the next-worst in turn, so
 * capacity spreads evenly across equally bad levels rather than all landing on
 * whichever was examined first.
 */
function scrub(levels, { level, capacity }, radius) {
  const inReach = levels.filter((l) => !l.sealed && Math.abs(l.index - level) <= radius && l.airQuality < 100);
  let left = capacity;

  while (left > 1e-9 && inReach.length > 0) {
    inReach.sort((a, b) => a.airQuality - b.airQuality || a.index - b.index);
    const worst = inReach[0].airQuality;
    const tied = inReach.filter((l) => l.airQuality - worst < 1e-9);
    const next = inReach.length > tied.length ? inReach[tied.length].airQuality : 100;
    // Raise the tied group to the next level up (or to 100), or as far as the
    // remaining capacity goes.
    const step = Math.min(next - worst, left / tied.length);
    for (const l of tied) l.airQuality += step;
    left -= step * tied.length;
    for (let i = inReach.length - 1; i >= 0; i--) {
      if (inReach[i].airQuality >= 100 - 1e-9) inReach.splice(i, 1);
    }
  }
}

/** One event per level that crosses into, or back out of, critical air. */
function reportCrossings(ctx, levels, before, critical) {
  levels.forEach((level, i) => {
    const was = before[i] < critical;
    const is = level.airQuality < critical;
    if (is && !was) ctx.emit('air:critical', { level: level.index, quality: level.airQuality });
    if (!is && was) ctx.emit('air:recovered', { level: level.index, quality: level.airQuality });
  });
}

function runsRecipes(def) {
  return (def.effects ?? []).some((e) => e.op === 'recipe.enable');
}

function deliverCatalyst(state, ctx) {
  const { catalystDeliveryIntervalTicks: every, catalystDeliveryQty: qty } = ctx.config.air;
  if (!every || !qty || state.clock.tick % every !== 0) return;
  if (state.resources.cutSupplies.includes(CATALYST)) return;
  // It comes down through the Exit and waits there, like everything that
  // comes from outside; someone has to carry it to the scrubbers.
  const exit = state.buildings.find((b) => ctx.catalog.buildings.byId[b.buildingId]?.receivesDeliveries);
  if (!exit) return;
  const landed = put(exit, ctx.catalog.buildings.byId[exit.buildingId], ctx, CATALYST, qty);
  made(state, CATALYST, landed, 'outside');
  if (landed > 0) ctx.emit('supply:delivered', { id: CATALYST, qty: landed, level: exit.level });
}
