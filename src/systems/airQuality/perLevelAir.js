/**
 * perLevelAir.js
 * The `airQuality` system. Air is tracked per level, not settlement-wide, as
 * two numbers (0-100): PURITY (level.airQuality) — what the crowds and the
 * machines foul and the scrubbers clean — and OXYGEN (level.oxygen) — what
 * everyone breathes and the gardens make. Breathable air is the worse of the
 * two (core/selectors.js breathable). Each tick, in this order:
 *
 *   1. LOAD      residents, heavy industry and dumped sewage foul their own
 *                level; residents and combustion burn its oxygen; plants in
 *                bays and groves breathe a little back out
 *   2. AIRFLOW   the duct fans move air: sucked off some levels, through
 *                the scrubbers and gardens on the ducts, blown out onto
 *                others (airflow.js). A scrubber or garden works on its own
 *                level with whatever the passing air did not use
 *   3. MIGRATE   air mixes with the levels above and below
 *   4. SEAL      a sealed level is cut off from 2 and 3 and goes stale
 *
 * The surface level is not part of it: it is open to the air outside, always
 * clean, and neither vented nor mixed with the level below (airflow.js
 * isOutside).
 *
 * A plant needs clean air too: below its airNeed it grows proportionally
 * slower (`airShare`, read by outputScale next tick). The deep levels, where
 * the generator, the smelter and the dig face are, foul fastest; the gardens
 * are in the shallows. The ducts, and which way the fans turn, are how one
 * reaches the other.
 *
 * Also the external catalyst supply: a delivery arrives every
 * air.catalystDeliveryIntervalTicks unless the supply has been cut — the
 * scrubbers' one input nobody in the Shaft can make.
 *
 * Owns level.airQuality, level.oxygen, state.resources.flows.air and each
 * instance's `airShare`.
 */

import { clamp } from '../../utils/math.js';
import { outputScale } from '../buildings/buildingRegistry.js';
import { residentsByLevel } from '../population/housing.js';
import { put } from '../resources/stores.js';
import { made } from '../resources/ledger.js';
import { graphOf } from '../infrastructure/networkGraph.js';
import { settleAirflow, isOutside, FOUL, FRESH } from './airflow.js';
import { breathable } from '../../core/selectors.js';

const CATALYST = 'scrubber-catalyst';

export function tick(state, ctx) {
  const cfg = ctx.config.air;
  const levels = state.levels;
  for (const level of levels) level.oxygen ??= 100;
  const residents = residentsByLevel(state, ctx);
  const before = levels.map(breathable);
  const def = (i) => ctx.catalog.buildings.byId[i.buildingId];
  const scaleOf = new Map(state.buildings.map((b) => [b.instanceId, def(b) ? outputScale(b, def(b), ctx) : 0]));

  // --- 1. load --------------------------------------------------------------
  const foul = new Array(levels.length + 1).fill(0);
  const breath = new Array(levels.length + 1).fill(0);
  const spilled = state.resources.flows.water?.spilled ?? [];
  for (let i = 1; i < foul.length; i++) {
    foul[i] += (residents[i] ?? 0) * cfg.contaminantPerCapitaPerTick + (spilled[i] ?? 0) * (cfg.sewageLoadPerUnit ?? 0);
    breath[i] += (residents[i] ?? 0) * (cfg.oxygenPerCapitaPerTick ?? 0);
  }
  const foulDucts = graphOf(state, ctx, FOUL);
  const freshDucts = graphOf(state, ctx, FRESH);
  for (const instance of state.buildings) {
    const d = def(instance);
    if (!d) continue;
    // A recipe building is only dirty while it has a batch on.
    const idle = runsRecipes(d) && !instance.job;
    const scale = scaleOf.get(instance.instanceId);
    if (d.airLoad && !idle) foul[instance.level] += d.airLoad * scale;
    if (d.oxygenDraw && !idle) breath[instance.level] += d.oxygenDraw * scale;
    // Plants breathe out where they stand; a garden on the ducts breathes
    // into the air passing it (step 2).
    if (d.oxygenOutput && !freshDucts.byId.has(instance.instanceId)) breath[instance.level] -= d.oxygenOutput * scale;
  }
  for (const level of levels) {
    level.airQuality -= foul[level.index];
    level.oxygen -= breath[level.index];
  }

  // --- 2. airflow ------------------------------------------------------------
  state.resources.flows.air = settleAirflow(state, ctx, foulDucts, freshDucts, scaleOf);

  // --- 3. migrate -------------------------------------------------------------
  const rate = clamp(cfg.migrationRateBetweenLevels, 0, 0.5);
  const mix = (field) => levels.map((level, i) => {
    if (level.sealed || isOutside(ctx, level)) return level[field];
    let flow = 0;
    for (const j of [i - 1, i + 1]) {
      const other = levels[j];
      if (!other || other.sealed || isOutside(ctx, other)) continue;
      flow += (other[field] - level[field]) * rate / 2;
    }
    return level[field] + flow;
  });
  const purity = mix('airQuality');
  const oxygen = mix('oxygen');

  // --- 4. seal ----------------------------------------------------------------
  levels.forEach((level, i) => {
    const q = level.sealed ? purity[i] - cfg.sealedLevelDecayPerTick : purity[i];
    level.airQuality = clamp(q, 0, 100);
    level.oxygen = clamp(oxygen[i], 0, 100);
    // The surface breathes the air outside, whatever is done on it.
    if (isOutside(ctx, level)) {
      level.airQuality = 100;
      level.oxygen = 100;
    }
  });

  // Plants grow at the share the air allows.
  for (const instance of state.buildings) {
    const need = def(instance)?.airNeed;
    if (!need) continue;
    const q = levels[instance.level - 1]?.airQuality ?? 100;
    instance.airShare = clamp(q / need, 0, 1);
  }

  reportCrossings(ctx, levels, before, cfg.qualityCriticalThreshold);
  deliverCatalyst(state, ctx);
}

/** One event per level that crosses into, or back out of, critical air. */
function reportCrossings(ctx, levels, before, critical) {
  levels.forEach((level, i) => {
    const now = breathable(level);
    const was = before[i] < critical;
    const is = now < critical;
    if (is && !was) ctx.emit('air:critical', { level: level.index, quality: now, oxygen: level.oxygen < level.airQuality });
    if (!is && was) ctx.emit('air:recovered', { level: level.index, quality: now });
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
