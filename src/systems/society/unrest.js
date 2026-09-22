/**
 * unrest.js
 * What discontent does. The Shaft does not end at a threshold — it comes
 * apart, and each stage is something the player can see coming and answer:
 *
 *   WARNING   discontent rises past unrest.warnThreshold, and a faction that
 *             is still satisfied says so. A Shaft whose departments are all
 *             unhappy gets no warning at all.
 *   STRIKE    at a shift change above unrest.strikeThreshold, the least
 *             satisfied faction walks out for unrest.strikeDurationTicks:
 *             its buildings get no staff (population/staffing.js).
 *   DEMANDS   discontent rises past unrest.demandsThreshold: the people want
 *             a law or a promise. Raised as an event here; the dilemma that
 *             answers it belongs to the dilemma engine.
 *   RIOT      at a shift change above unrest.riotThreshold, rioters wreck
 *             buildings — a wrecked building that reaches nothing is gone.
 *
 * The fifth consequence, people leaving through the Exit, is population
 * leaving the population, so it lives in population/vitals.js.
 *
 * Owns population.strikes and population.unrest; demolishes through
 * state.buildings, which is the one reach outside its domain and is exactly
 * what a riot is.
 */

import { isShiftBoundary } from '../../core/clock.js';

export function initialUnrest() {
  return { lastStrikeTick: null, lastDemandsTick: null };
}

/**
 * @param {number} before  discontent at the start of this tick, so a
 *                         threshold crossing is seen once, on the tick it
 *                         happens
 */
export function tick(state, ctx, before) {
  const cfg = ctx.config.unrest;
  const now = state.meters.discontent ?? 0;
  const pop = state.population;
  pop.unrest ??= initialUnrest();

  endStrikes(state, ctx);

  if (before < cfg.warnThreshold && now >= cfg.warnThreshold) warn(state, ctx);

  if (before < cfg.demandsThreshold && now >= cfg.demandsThreshold && cooledDown(state, pop.unrest.lastDemandsTick, cfg.demandsCooldownTicks)) {
    pop.unrest.lastDemandsTick = state.clock.tick;
    ctx.emit('unrest:demands', { discontent: now });
  }

  if (!isShiftBoundary(state.clock)) return;

  if (now >= cfg.strikeThreshold && pop.strikes.length === 0 && cooledDown(state, pop.unrest.lastStrikeTick, cfg.strikeCooldownTicks)) {
    strike(state, ctx);
  }
  if (now >= cfg.riotThreshold) riot(state, ctx);
}

function cooledDown(state, last, cooldown) {
  return last === null || state.clock.tick - last >= cooldown;
}

function endStrikes(state, ctx) {
  const ending = state.population.strikes.filter((s) => s.untilTick <= state.clock.tick);
  if (ending.length === 0) return;
  state.population.strikes = state.population.strikes.filter((s) => s.untilTick > state.clock.tick);
  for (const s of ending) ctx.emit('unrest:strikeEnded', { faction: s.faction });
}

/** The most satisfied faction, if any is satisfied enough to speak up. */
function warn(state, ctx) {
  const threshold = ctx.config.factions.earlyWarningThreshold;
  const faction = byStanding(state, ctx).at(-1);
  if (faction && faction.satisfaction >= threshold) {
    ctx.emit('unrest:warning', { faction: faction.id, discontent: state.meters.discontent });
  }
}

/** The least satisfied faction walks out. */
function strike(state, ctx) {
  const faction = byStanding(state, ctx)[0];
  if (!faction) return;
  const untilTick = state.clock.tick + ctx.config.unrest.strikeDurationTicks;
  state.population.strikes.push({ faction: faction.id, untilTick });
  state.population.unrest.lastStrikeTick = state.clock.tick;
  ctx.emit('unrest:strike', { faction: faction.id, untilTick });
}

/**
 * Rioters pick their targets — anything but the Shaft's fixed structure — and
 * wreck them. Draws come from the `unrest` stream, so a riot never shifts the
 * economy's sequence.
 */
function riot(state, ctx) {
  const { riotTargetsPerShift, riotDamage } = ctx.config.unrest;
  for (let i = 0; i < riotTargetsPerShift; i++) {
    const targets = state.buildings.filter((b) => !ctx.catalog.buildings.byId[b.buildingId]?.fixed);
    if (targets.length === 0) return;
    const target = ctx.rng.unrest.pick(targets);
    target.condition = Math.max(0, target.condition - riotDamage);

    if (target.condition <= 0) {
      state.buildings = state.buildings.filter((b) => b !== target);
      ctx.emit('unrest:demolished', { instanceId: target.instanceId, buildingId: target.buildingId, level: target.level });
    } else {
      ctx.emit('unrest:riot', { instanceId: target.instanceId, buildingId: target.buildingId, level: target.level });
    }
  }
}

/** Factions, least satisfied first; ties broken by id. */
function byStanding(state, ctx) {
  return ctx.catalog.factions.ids
    .map((id) => ({ id, satisfaction: state.population.factionSatisfaction[id] ?? 0 }))
    .sort((a, b) => a.satisfaction - b.satisfaction || a.id.localeCompare(b.id));
}
