/**
 * maintenance.js
 * Engineering's leverage. Maintenance crews — dealt from the labour pool
 * ahead of every building's staff (population/staffing.js) — go round the
 * Shaft restoring condition, and every point they restore costs the
 * building's `repairCost` in components and materials, in proportion.
 *
 * The queue: broken-down buildings first, then by the power ladder (life
 * support before amenities), then worst condition first. A building joins it
 * below buildings.repairThreshold and stays on it until it is whole again, so
 * crews finish a job rather than dabbing at everything.
 *
 * Crews draw their parts from the depots and storehouses, nearest the job
 * first — parts sitting in the workshop's own store are not yet anywhere a
 * crew can reach. No parts, no repairs: the job stalls and the crews wait. Neglecting the
 * workshop does not hurt today; it hurts thirty days later, all at once.
 *
 * Owns state.maintenance and instance.condition upward (wear, downward, is
 * buildingRegistry's).
 */

import { clamp } from '../../utils/math.js';
import { currentLadder } from '../power/priorityLadder.js';
import { inStorehouses, takeFromStorehouses } from '../resources/stores.js';
import { used } from '../resources/ledger.js';

export function initialMaintenance(config) {
  return { crewTarget: config.buildings.maintenanceCrewsStart, crews: 0, stalledOn: null };
}

export function tick(state, ctx) {
  const m = state.maintenance;
  const { repairLabourPerCondition, repairThreshold } = ctx.config.buildings;
  let capacity = repairLabourPerCondition > 0 ? m.crews / repairLabourPerCondition : 0;
  m.stalledOn = null;

  for (const instance of state.buildings) {
    if (instance.condition < repairThreshold) instance.repairing = true;
    if (instance.repairing && instance.condition >= 1) instance.repairing = false;
  }

  for (const { instance, def } of queue(state, ctx)) {
    if (capacity <= 0) break;
    const restore = Math.min(capacity, 1 - instance.condition);
    const affordable = affordableShare(state, ctx, def, restore);
    if (affordable <= 0) {
      m.stalledOn ??= missingPart(state, ctx, def);
      continue;
    }
    const done = restore * affordable;
    for (const cost of def.repairCost ?? []) {
      used(state, cost.id, takeFromStorehouses(state, ctx, cost.id, cost.qty * done, instance.level), 'repairs');
    }
    instance.condition = clamp(instance.condition + done, 0, 1);
    capacity -= done;
    if (instance.condition >= 1) {
      instance.repairing = false;
      ctx.emit('maintenance:repaired', { instanceId: instance.instanceId, buildingId: instance.buildingId, level: instance.level });
    }
  }

  if (m.stalledOn) ctx.emit('maintenance:stalled', { id: m.stalledOn });
}

/** Buildings awaiting repair, in the order crews take them. */
function queue(state, ctx) {
  const ladder = currentLadder(state, ctx);
  const rank = (cls) => {
    const i = ladder.indexOf(cls);
    return i === -1 ? ladder.length : i;
  };
  return state.buildings
    .filter((b) => b.repairing)
    .map((instance) => ({ instance, def: ctx.catalog.buildings.byId[instance.buildingId] }))
    .filter(({ def }) => def)
    .sort((a, b) =>
      Number(b.instance.brokenDown) - Number(a.instance.brokenDown) ||
      rank(a.def.priorityClass) - rank(b.def.priorityClass) ||
      a.instance.condition - b.instance.condition ||
      a.instance.instanceId.localeCompare(b.instance.instanceId));
}

/** Share of `restore` the stores can pay for: 1 if all of it, 0 if none. */
function affordableShare(state, ctx, def, restore) {
  let share = 1;
  for (const cost of def.repairCost ?? []) {
    const need = cost.qty * restore;
    if (need <= 0) continue;
    share = Math.min(share, inStorehouses(state, ctx, cost.id) / need);
  }
  return clamp(share, 0, 1);
}

function missingPart(state, ctx, def) {
  return (def.repairCost ?? []).find((c) => inStorehouses(state, ctx, c.id) <= 0)?.id ?? null;
}
