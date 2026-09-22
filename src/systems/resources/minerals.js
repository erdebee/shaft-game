/**
 * minerals.js
 * Raw extraction: every working dig face cuts into every vein the Shaft
 * profile declares, in proportion to that vein's abundance and how much of it
 * is left. Seams deplete, so yield falls off as the dig goes on — a slow clock
 * on the Shaft that good management can slow but never escape, and the reason
 * the recycler matters.
 *
 * Owns state.resources.seams: remaining share of each vein, 1 at the start of
 * a run and 0 when it is worked out.
 */

import { outputScale } from '../buildings/buildingRegistry.js';

/** Seams at the start of a run: every vein in the profile, untouched. */
export function initialSeams(shaft) {
  const seams = {};
  for (const vein of shaft.veins ?? []) seams[vein.id] = 1;
  return seams;
}

export function tick(state, ctx) {
  const seams = state.resources.seams;
  const { baseYieldPerTick, depletionPerExtractionTick } = ctx.config.mining;

  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def || !extracts(def)) continue;

    const scale = outputScale(instance, def, ctx);
    if (scale <= 0) continue;

    for (const vein of ctx.shaft.veins ?? []) {
      const remaining = seams[vein.id] ?? 0;
      if (remaining <= 0) continue;

      const qty = baseYieldPerTick * vein.abundance * remaining * scale;
      state.resources.stocks[vein.id] = (state.resources.stocks[vein.id] ?? 0) + qty;

      seams[vein.id] = depleteSeam(remaining, depletionPerExtractionTick * scale);
      if (seams[vein.id] === 0) {
        ctx.emit('mining:seamExhausted', { id: vein.id, level: instance.level });
      }
    }
  }
}

/** A seam after one tick's work. Never below zero. */
export function depleteSeam(remaining, extracted) {
  return Math.max(0, remaining - extracted);
}

function extracts(def) {
  return (def.effects ?? []).some((e) => e.op === 'extraction.enable');
}
