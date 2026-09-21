/**
 * buildingRegistry.js
 * Building definitions come from the catalog — resources/data/catalog/buildings/
 * (one file per zone: cultivation, water, air, power, mechanical, habitation,
 * administration), loaded and patched by config/contentLoader.js.
 *
 * This module tracks PLACED INSTANCES: which level and slot, condition,
 * staffing, and the resulting output modifier. Condition decays with use;
 * below conditionThresholds.degraded efficiency drops, and below .breakdown
 * events fire. Repairs cost components plus engineer labour, which is the loop
 * that gives Engineering its leverage as a faction.
 *
 * Owns only state.buildings. Power decides `powered` (see systems/power),
 * because what stays lit is a governance decision, not a building's own.
 */

import { clamp } from '../../utils/math.js';
import { conditionScale } from '../../core/effects.js';

/**
 * Wear and breakdown. A building only wears while it is actually running —
 * a browned-out workshop is idle, not deteriorating, which is what makes
 * demoting something on the priority ladder a genuine preservation tactic.
 */
export function tick(state, ctx) {
  const check = ctx.config.buildings.breakdownCheckIntervalTicks;
  const dueForCheck = check > 0 && state.clock.tick % check === 0;

  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;

    if (instance.powered !== false) {
      instance.condition = clamp(instance.condition - (def.wearPerTick ?? 0), 0, 1);
    }

    const thresholds = def.conditionThresholds ?? {};
    const breakdown = thresholds.breakdown;

    if (dueForCheck && breakdown != null && instance.condition <= breakdown && !instance.brokenDown) {
      instance.brokenDown = true;
      ctx.emit('building:breakdown', {
        instanceId: instance.instanceId,
        buildingId: instance.buildingId,
        level: instance.level,
      });
    }

    if (instance.brokenDown && breakdown != null && instance.condition > breakdown) {
      instance.brokenDown = false;
    }
  }
}

/**
 * Effective output scale for an instance: condition, staffing and breakdown
 * combined. 0 means the building contributes nothing this tick.
 */
export function outputScale(instance, def, ctx) {
  if (instance.brokenDown) return 0;
  if (instance.powered === false) return 0;

  const byCondition = conditionScale(instance.condition, def, ctx);
  const needed = def.staffing ?? 0;
  const byStaffing = needed === 0 ? 1 : clamp((instance.staffing ?? 0) / needed, 0, 1);

  return byCondition * byStaffing;
}

/** Power a building asks for this tick, before the ladder decides. */
export function powerDemand(instance, def, ctx) {
  if (instance.brokenDown) return 0;
  // Draw does not scale with condition: a worn machine asks for as much and
  // gives back less, which is what makes deferred maintenance expensive.
  return def.powerDraw ?? 0;
}

/**
 * Place an instance. Slot and zone validation lives in core/commands.js, which
 * is the only caller — placement is player intent, not simulation.
 */
export function place(state, ctx, buildingId, level) {
  const def = ctx.catalog.buildings.byId[buildingId];
  if (!def) throw new Error(`buildingRegistry: unknown building "${buildingId}"`);

  const instance = {
    instanceId: `b${state.buildings.length + 1}`,
    buildingId,
    level,
    slots: def.slots ?? 1,
    condition: ctx.config.buildings.conditionStart,
    staffing: 0,
    powered: true,
    brokenDown: false,
  };
  state.buildings.push(instance);
  return instance;
}

/** Instances on a level, in placement order. */
export function onLevel(state, levelIndex) {
  return state.buildings.filter((b) => b.level === levelIndex);
}
