/**
 * meters.js
 * Moves every meter toward where the Shaft's conditions put it. The model is
 * data — each meter's `drift` or `accumulate` block in catalog/meters.json —
 * and this file only interprets it.
 *
 *   DRIFT       target = start + standing meter.add effects + drivers;
 *               the value moves toward it by drift.perTick. A one-shot
 *               effect (a ruling, a beat) moves the value, which then drifts
 *               back unless the conditions behind it hold.
 *   ACCUMULATE  the standing effects are added every tick, and nothing
 *               pulls the value back — the rock does not heal on its own.
 *
 * A driver reads one number and turns it into a contribution:
 *   { source, pivot, weight }  weight × (value − pivot)
 *   { source, below, weight }  weight × how far the value sits below `below`,
 *                              as a share of it (0 at or above)
 * Sources: need.<id> (population.needs), meter.<id>, population.health.
 *
 * Owns state.meters (global scope only).
 */

import { approach, clamp } from '../../utils/math.js';

export function tick(state, ctx) {
  for (const id of Object.keys(state.meters)) {
    const def = ctx.catalog.meters.byId[id];
    if (!def) continue;
    const min = def.min ?? 0;
    const max = def.max ?? 100;
    const standing = ctx.modifiers.meter[id] ?? 0;

    if (def.accumulate) {
      state.meters[id] = clamp(state.meters[id] + standing, min, max);
    } else if (def.drift) {
      const target = clamp(meterTarget(state, def, standing), min, max);
      state.meters[id] = approach(state.meters[id], target, def.drift.perTick);
    }
  }
}

/** Where a drifting meter is heading, before clamping. */
export function meterTarget(state, def, standing = 0) {
  let target = (def.start ?? 0) + standing;
  for (const driver of def.drift?.drivers ?? []) target += contribution(state, driver);
  return target;
}

function contribution(state, driver) {
  const value = read(state, driver.source);
  if (value === null) return 0;
  if (driver.below !== undefined) {
    const share = driver.below > 0 ? clamp((driver.below - value) / driver.below, 0, 1) : 0;
    return driver.weight * share;
  }
  return driver.weight * (value - (driver.pivot ?? 0));
}

function read(state, source) {
  const [kind, id] = source.split('.');
  if (kind === 'need') return state.population.needs?.[id] ?? null;
  if (kind === 'meter') return state.meters[id] ?? null;
  if (source === 'population.health') return state.population.health ?? null;
  throw new Error(`meters: unknown driver source "${source}"`);
}

/**
 * The productivity meter as a work-rate multiplier: 1 at its pivot, falling
 * to `floor` at 0 and rising to `ceiling`. Read by collectModifiers, so every
 * building works at this rate.
 */
export function workRate(state, ctx) {
  const def = ctx.catalog.meters.byId.productivity;
  const rate = def?.workRate;
  const value = state.meters.productivity;
  if (!rate || value === undefined) return 1;
  const r = value >= rate.pivot
    ? 1 + (rate.ceiling - 1) * (value - rate.pivot) / (100 - rate.pivot)
    : rate.floor + (1 - rate.floor) * value / rate.pivot;
  return clamp(r, rate.floor, rate.ceiling);
}
