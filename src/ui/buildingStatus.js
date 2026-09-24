/**
 * buildingStatus.js
 * What is wrong with a building, in words and as a severity. One function for
 * the inspector's status lines and the shaft minimap's dots, so the two can
 * never disagree about whether a room is stalled.
 *
 * Reads state. Never writes it.
 */

import { recipesFor } from '../systems/resources/componentChain.js';
import { factionOf } from '../systems/population/staffing.js';
import { nameOf, shortages } from '../systems/resources/stores.js';

const IDLE = 'Idle — nothing needed, or no inputs';

/**
 * What is stopping the building, worst first, as [message, band] pairs — or
 * a single "Working" when nothing is. Every problem is listed, not just the
 * first: a smelter can be out of coal AND have nowhere to put its steel, and
 * fixing one only to find the other is the thing to spare the player.
 */
export function problemsOf(instance, def, state, ctx) {
  const problems = [];
  const good = (id) => nameOf(ctx, id).toLowerCase();
  const faction = factionOf(ctx, def.id);
  if (faction && state.population.strikes.some((s) => s.faction === faction)) problems.push(['Production stalled, on strike', 'critical']);
  if (instance.brokenDown) problems.push(['Production stalled, broken down — waiting for repairs', 'critical']);
  if (instance.powered === false) {
    const offGrid = state.resources.flows.power.offGrid?.includes(instance.instanceId);
    problems.push([offGrid ? 'Production stalled, no power — no junction reaches it' : 'Production stalled, no power', 'critical']);
  }
  if (state.resources.flows.water.unserved?.includes(instance.instanceId)) problems.push(['No water — no cistern reaches it', 'critical']);
  if (def.staffing && (instance.staffing ?? 0) === 0) problems.push(['Production stalled, no workers', 'critical']);
  if (instance.starved) {
    for (const id of instance.missing?.length ? instance.missing : []) problems.push([`Production stalled, ran out of ${good(id)}`, 'critical']);
    if (!instance.missing?.length) problems.push(['Production stalled, ran out of its inputs', 'critical']);
  }
  if (instance.blocked) {
    for (const id of instance.full ?? []) problems.push([`Production stalled, no space to store ${good(id)}`, 'critical']);
  }
  if ((instance.airShare ?? 1) < 1) problems.push([`The air is too foul to grow well — ${Math.round((instance.airShare ?? 0) * 100)}%`, 'warn']);
  if ((instance.waterShare ?? 1) < 1 && !state.resources.flows.water.unserved?.includes(instance.instanceId)) problems.push([`Short of water — rationed to ${Math.round((instance.waterShare ?? 0) * 100)}%`, 'warn']);
  if (def.staffing && instance.staffing > 0 && instance.staffing < def.staffing) problems.push([`Short-handed: ${instance.staffing} of ${def.staffing} crews`, 'warn']);
  if (!problems.length && recipesFor(def.id, ctx).length && !instance.job) problems.push([IDLE, 'warn']);
  return problems.length ? problems : [['Working', 'ok']];
}

/**
 * The one word the minimap needs: 'stalled', 'warning', or null.
 *
 * Idle is left out on purpose. A workshop with nothing to make is a room
 * doing what it was told, and a column of orange dots for every quiet one
 * would drown the rooms that are actually in trouble. An input running low
 * (the orange bar on the shortage plate) counts as a warning, so a room the
 * shaft is already flagging is flagged here too.
 */
export function severityOf(instance, def, state, ctx) {
  if (!def) return null;
  let worst = null;
  for (const [text, band] of problemsOf(instance, def, state, ctx)) {
    if (band === 'critical') return 'stalled';
    if (band === 'warn' && text !== IDLE) worst = 'warning';
  }
  if (!worst && instance.powered !== false && !instance.brokenDown
    && shortages(instance, def, ctx).some((s) => s.band === 'low')) worst = 'warning';
  return worst;
}
