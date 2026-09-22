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
import { conditionScale, staffingScale } from '../../core/effects.js';

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
 * How hard an instance can work this tick: condition, staffing, power and
 * breakdown combined, but NOT whether it has its inputs. The resources system
 * uses this to decide whether inputs are needed at all, and is the one that
 * sets `starved` — so it must not read the flag it is about to write.
 */
export function workScale(instance, def, ctx) {
  if (instance.brokenDown) return 0;
  if (instance.powered === false) return 0;
  return conditionScale(instance.condition, def, ctx) * staffingScale(instance, def);
}

/**
 * Effective output scale for an instance: workScale, and nothing at all if it
 * went without its inputs last tick. A generator with no fuel generates
 * nothing; a scrubber with no carbon scrubs nothing. 0 means the building
 * contributes nothing this tick.
 */
export function outputScale(instance, def, ctx) {
  if (instance.starved) return 0;
  return workScale(instance, def, ctx);
}

/**
 * Power a building asks for this tick, before the ladder decides. A recipe
 * building draws its current recipe's power on top of its own, and only while
 * it has a batch on — an idle smelter is cold.
 */
export function powerDemand(instance, def, ctx) {
  if (instance.brokenDown) return 0;
  // Draw does not scale with condition: a worn machine asks for as much and
  // gives back less, which is what makes deferred maintenance expensive.
  const recipe = instance.job ? ctx.catalog.recipes.byId[instance.job.recipeId] : null;
  return (def.powerDraw ?? 0) + (recipe?.powerDraw ?? 0);
}

/**
 * A new placed instance. Slot and zone validation lives in core/commands.js,
 * which is the only caller — placement is player intent, not simulation.
 */
export function createInstance(def, ctx, { instanceId, level, slot }) {
  return {
    instanceId,
    buildingId: def.id,
    level,
    slot,
    slots: def.slots ?? 1,
    condition: ctx.config.buildings.conditionStart,
    staffing: 0,
    powered: true,
    brokenDown: false,
    starved: false,
    job: null,       // recipe buildings: { recipeId, progress } while a batch runs
    recipeId: null,  // recipe buildings: a recipe the player pinned, or null for auto
  };
}

/** Instances on a level, in placement order. */
export function onLevel(state, levelIndex) {
  return state.buildings.filter((b) => b.level === levelIndex);
}
