/**
 * effects.js
 * The single gateway for cross-domain state change. Systems write their own
 * domain directly; everything else goes through applyEffects, which is
 * therefore the one place that has to clamp, log and emit.
 *
 * Two categories of effect, and confusing them is the trap:
 *
 *   ONE-SHOT   dilemma options, law cards, beats, hidden clauses. Applied once,
 *              mutating state. That is applyEffects().
 *
 *   STANDING   a building's `effects` while it stands, a statute's while it is
 *              enacted. These are MODIFIERS, recomputed every tick and never
 *              accumulated — applying a common hall's +6 morale once per tick
 *              would run morale to its cap in twenty seconds. That is
 *              collectModifiers().
 *
 * A statute is both: the ops collectModifiers understands stand while it is
 * law, and the rest (a doubt swing, a flag) happen once, on the day it is
 * enacted — enactmentEffects() is that remainder. And `meter.shift` is a
 * one-shot op whose result is standing: it moves where a meter settles, for
 * good, which is what a kept promise earns and a broken one costs.
 *
 * Both read the same op vocabulary from schema.js. A declared op with no
 * handler throws by design: silence is how content bugs become balance
 * mysteries three hours into a playtest.
 */

import { clamp } from '../utils/math.js';
import { EFFECT_OPS } from '../config/schema.js';
import * as S from './selectors.js';
import { workRate } from '../systems/society/meters.js';
import { putInStorehouses, takeFromStorehouses } from '../systems/resources/stores.js';
import { made, used } from '../systems/resources/ledger.js';
import { earn as earnAuthority } from '../governance/authorityLedger.js';

/**
 * Ops that describe a standing capability or modifier rather than an event.
 * When these appear in a building or statute definition they are collected by
 * collectModifiers; applyEffects still handles them for the one-shot case
 * (a beat enabling a capability permanently, say).
 */
const STANDING_OPS = new Set([
  'meter.add',
  'risk.add',
  'buffer.add',
  'network.capacity',
  'network.boost',
  'flow.scrub',
  'flow.setQuality',
  'spoilage.multiply',
  'consumption.multiply',
  'zone.outputMultiply',
  'population.healthRate',
  'recipe.enable',
  'extraction.enable',
  'reclamation.enable',
  'haulage.enable',
  'capability.enable',
]);

/**
 * Ops collectModifiers turns into standing modifiers. Wider than STANDING_OPS
 * by faction.satisfaction, which is one-shot in a ruling and standing in a
 * statute: a curfew angers Order for as long as it is law, not for a week.
 */
const COLLECTED_OPS = new Set([...STANDING_OPS, 'faction.satisfaction']);

/** The part of a law card that happens once, on the day it is enacted. */
export function enactmentEffects(card) {
  return (card?.effects ?? []).filter((e) => !COLLECTED_OPS.has(e.op));
}

const HANDLERS = {
  // --- meters and resources -------------------------------------------
  'meter.add': (state, ctx, e) => {
    const def = ctx.catalog.meters.byId[e.target];
    const min = def?.min ?? 0;
    const max = def?.max ?? 100;
    state.meters[e.target] = clamp((state.meters[e.target] ?? 0) + e.value, min, max);
  },

  // Where the meter settles, not where it is: collectModifiers adds this to
  // the meter's target for the rest of the run, so it never drifts back.
  'meter.shift': (state, ctx, e) => {
    state.narrative.shifts ??= {};
    state.narrative.shifts[e.target] = (state.narrative.shifts[e.target] ?? 0) + e.value;
  },

  // Goods are local: a gift lands in the common stores, and a loss comes out
  // of them. What will not fit, or is not there, is simply not.
  'stock.add': (state, ctx, e) => {
    if (e.value >= 0) made(state, e.target, putInStorehouses(state, ctx, e.target, e.value), 'events');
    else used(state, e.target, takeFromStorehouses(state, ctx, e.target, -e.value), 'events');
  },

  'focus.add': (state, ctx, e) => {
    const cap = ctx.catalog.abstracts.byId[e.target]?.cap ?? Infinity;
    state.resources.abstracts[e.target] = clamp(
      (state.resources.abstracts[e.target] ?? 0) + e.value, 0, cap,
    );
  },

  'authority.add': (state, ctx, e) => {
    earnAuthority(state, ctx, e.value);
  },

  // --- narrative bookkeeping -------------------------------------------
  'flag.set': (state, ctx, e) => {
    state.narrative.flags[e.target] = e.value === undefined ? true : e.value;
  },

  'capability.enable': (state, ctx, e) => {
    state.narrative.capabilities[e.target] = true;
  },

  'content.unlock': (state, ctx, e) => {
    if (!state.narrative.unlocked.includes(e.target)) state.narrative.unlocked.push(e.target);
  },

  'beat.arm': (state, ctx, e) => {
    if (!state.narrative.armedBeats.includes(e.target)) state.narrative.armedBeats.push(e.target);
  },

  'chapter.advance': (state, ctx, e) => {
    state.meta.chapter = e.value;
    state.narrative.flags[`chapter-${e.value}-entered`] = true;
  },

  'timer.start': (state, ctx, e) => {
    state.narrative.timers.push({
      id: e.target,
      startTick: state.clock.tick,
      expiresTick: state.clock.tick + e.ticks,
      condition: e.condition ?? null,
      label: e.label ?? null,
      promise: e.promise === true,
      holdTicks: e.holdTicks ?? null,
      heldTicks: 0,
      onMet: e.onMet ?? [],
      onExpire: e.onExpire ?? [],
    });
  },

  // --- governance -------------------------------------------------------
  'precedent.record': (state, ctx, e) => {
    const theme = (state.governance.precedent[e.theme] ??= {});
    theme[e.leaning] = (theme[e.leaning] ?? 0) + 1;
  },

  // Payment and the session are the caller's business (governance/
  // statuteEngine.js enact, or a codified ruling that paid in its own
  // effects); this is the law taking force, however it got there.
  'statute.enact': (state, ctx, e) => {
    if (S.statuteActive(state, e.target)) return;
    const card = ctx.content.lawCards.byId[e.target];
    state.governance.enacted.push({ id: e.target, enactedTick: state.clock.tick });
    state.governance.history ??= [];
    state.governance.history.push({ id: e.target, tick: state.clock.tick, act: 'enacted', via: e.via ?? 'effect' });
    applyEffects(state, ctx, enactmentEffects(card), `statute:${e.target}`);
  },

  'faction.satisfaction': (state, ctx, e) => {
    state.population.factionSatisfaction[e.target] = clamp(
      (state.population.factionSatisfaction[e.target] ?? 0) + e.value, 0, 100,
    );
  },

  // --- board -------------------------------------------------------------
  'doubt.add': (state, ctx, e) => {
    const targets = e.target === 'all' ? Object.keys(state.board) : [e.target];
    for (const id of targets.sort()) {
      if (!state.board[id]) continue;
      state.board[id].doubt = clamp(state.board[id].doubt + e.value, 0, 100);
    }
  },

  'board.replace': (state, ctx, e) => {
    const id = resolveMemberSelector(state, e.target);
    if (id) state.board[id].replaced = true;
  },

  'board.revealMole': (state, ctx, e) => {
    const id = resolveMemberSelector(state, e.target);
    if (id) {
      state.narrative.flags['mole-revealed'] = true;
      state.narrative.moleId = id;
    }
  },

  // --- buildings and supply ---------------------------------------------
  'building.demolish': (state, ctx, e) => {
    state.buildings = state.buildings.filter((b) => b.buildingId !== e.target);
  },

  'building.resize': (state, ctx, e) => {
    const instance = S.instancesOf(state, e.target)[0];
    if (instance) instance.slots = Math.max(0, (instance.slots ?? 1) + e.value);
  },

  'supply.cut': (state, ctx, e) => {
    if (!state.resources.cutSupplies.includes(e.target)) state.resources.cutSupplies.push(e.target);
  },

  'priority.reorder': (state, ctx, e) => {
    const ladder = [...S.priorityLadder(state, ctx)];
    const from = ladder.indexOf(e.target);
    if (from === -1) return;
    ladder.splice(from, 1);
    ladder.splice(clamp(e.value, 0, ladder.length), 0, e.target);
    state.governance.priorityLadder = ladder;
  },

  'lottery.slotsMultiply': (state, ctx, e) => {
    state.population.lotteryMultiplier = (state.population.lotteryMultiplier ?? 1) * e.value;
  },
};

/**
 * Standing ops need a no-op one-shot handler so that a building definition can
 * be validated and collected without applyEffects rejecting it. Anything
 * genuinely unimplemented still throws.
 */
const STANDING_ONLY = new Set([
  'risk.add', 'buffer.add', 'network.capacity', 'network.boost',
  'flow.scrub', 'flow.setQuality', 'spoilage.multiply', 'consumption.multiply',
  'zone.outputMultiply', 'population.healthRate',
  'recipe.enable', 'extraction.enable', 'reclamation.enable', 'haulage.enable',
]);

/**
 * Apply a list of one-shot effects in order.
 *
 * @param {object} state
 * @param {object} ctx    { config, catalog, content, rng, emit }
 * @param {Array}  effects
 * @param {string} source id of whatever caused this, for the log
 */
export function applyEffects(state, ctx, effects, source = 'unknown') {
  if (!Array.isArray(effects)) return;

  for (const effect of effects) {
    if (!effect || typeof effect !== 'object' || !effect.op) continue;

    const handler = HANDLERS[effect.op];
    if (!handler) {
      if (STANDING_ONLY.has(effect.op)) continue; // collected, not applied
      const known = effect.op in EFFECT_OPS;
      throw new Error(
        known
          ? `effects: "${effect.op}" is declared in schema.js but has no handler`
          : `effects: unknown effect op "${effect.op}"`,
      );
    }

    handler(state, ctx, effect);
    ctx.emit('effect:applied', { op: effect.op, target: effect.target, value: effect.value, source });
  }
}

/**
 * Aggregate every STANDING effect currently in force — from placed buildings
 * (scaled by condition, and only while powered) and from enacted statutes.
 *
 * Returns a plain object of sums and products. Nothing here mutates state:
 * callers read the result as a target, so a modifier can be removed simply by
 * demolishing the building that supplied it.
 */
export function collectModifiers(state, ctx) {
  const mods = {
    meter: {},        // additive, by meter id
    risk: {},         // additive, by risk id
    buffer: {},       // additive capacity, by resource id
    network: {},      // additive capacity/boost, by network id
    scrub: {},        // additive scrubbing, by flow id
    quality: {},      // additive treatment share, by flow id (1 = fully treated)
    multiply: {},     // multiplicative, by "kind:target"
    faction: {},      // additive satisfaction target, by faction id
    capabilities: {}, // boolean
    recipes: {},      // boolean, by building id
    haulage: {},      // boolean, by method id
  };

  // How hard everyone works, from the productivity meter. Every building's
  // output scales by it (buildings/buildingRegistry.js workScale).
  mods.multiply.work = workRate(state, ctx);

  const add = (bucket, key, value) => { bucket[key] = (bucket[key] ?? 0) + value; };
  const mul = (key, value) => { mods.multiply[key] = (mods.multiply[key] ?? 1) * value; };

  const sources = [];

  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;
    // A browned-out, wrecked or starved building supplies nothing, and an
    // understaffed or water-rationed one supplies part of it: a scrubber with
    // no carbon, or with nobody to change the filters, cleans no air; a
    // clinic with no water heals nobody.
    if (instance.powered === false || instance.starved) continue;
    const scale = conditionScale(instance.condition, def, ctx) * staffingScale(instance, def)
      * (instance.waterShare ?? 1);
    if (scale <= 0) continue;
    sources.push({ effects: def.effects ?? [], scale });
  }

  for (const enacted of state.governance.enacted) {
    const card = ctx.content.lawCards?.byId[enacted.id];
    if (card) sources.push({ effects: card.effects ?? [], scale: 1 });
  }

  for (const { effects, scale } of sources) {
    for (const e of effects) {
      switch (e.op) {
        case 'meter.add': add(mods.meter, e.target, e.value * scale); break;
        case 'faction.satisfaction': add(mods.faction, e.target, e.value * scale); break;
        case 'risk.add': add(mods.risk, e.target, e.value * scale); break;
        case 'buffer.add': add(mods.buffer, e.target, e.value * scale); break;
        case 'network.capacity':
        case 'network.boost': add(mods.network, e.target, e.value * scale); break;
        case 'flow.scrub': add(mods.scrub, e.target, e.value * scale); break;
        case 'flow.setQuality': add(mods.quality, e.target, e.value * scale); break;
        case 'consumption.multiply': mul(`consumption:${e.target}`, e.value); break;
        case 'spoilage.multiply': mul(`spoilage:${e.target}`, e.value); break;
        case 'zone.outputMultiply': mul(`zone:${e.target}`, e.value); break;
        case 'population.healthRate': add(mods.meter, 'healthRate', e.value * scale); break;
        case 'capability.enable': mods.capabilities[e.target] = true; break;
        case 'recipe.enable': mods.recipes[e.target] = true; break;
        case 'haulage.enable': mods.haulage[e.target] = true; break;
        case 'reclamation.enable': mods.capabilities['reclamation'] = true; break;
        case 'extraction.enable': mods.capabilities['extraction'] = true; break;
        default: break; // one-shot ops in a standing list are ignored, not an error
      }
    }
  }

  // Reputation: kept and broken promises move where a meter settles for good.
  for (const [id, value] of Object.entries(state.narrative.shifts ?? {})) add(mods.meter, id, value);

  return mods;
}

/**
 * Output scale for a building's condition: full above `degraded`, reduced
 * between `degraded` and `breakdown`, nothing below. A null breakdown
 * threshold means the building degrades but never stops (the grove).
 */
export function conditionScale(condition, def, ctx) {
  const t = def.conditionThresholds ?? {};
  const degraded = t.degraded ?? 0.6;
  const breakdown = t.breakdown;

  if (condition >= degraded) return 1;
  if (breakdown === null || breakdown === undefined) return ctx.config.buildings.degradedEfficiencyMultiplier;
  if (condition <= breakdown) return 0;
  return ctx.config.buildings.degradedEfficiencyMultiplier;
}

/** Share of its staff an instance has; 1 for a building that needs none. */
export function staffingScale(instance, def) {
  const needed = def.staffing ?? 0;
  if (needed === 0) return 1;
  return clamp((instance.staffing ?? 0) / needed, 0, 1);
}

function resolveMemberSelector(state, target) {
  if (target === 'highest-doubt') return S.highestDoubt(state);
  if (target === 'lowest-doubt') return S.lowestDoubt(state);
  return state.board[target] ? target : null;
}

/** Ops declared in schema.js with neither a handler nor standing treatment. */
export function unimplementedOps() {
  return Object.keys(EFFECT_OPS).filter((op) => !(op in HANDLERS) && !STANDING_ONLY.has(op));
}

export { STANDING_OPS };
