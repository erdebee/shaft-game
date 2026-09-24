/**
 * perLevelAir.js
 * The `airQuality` system. Air is tracked per level, not settlement-wide, as
 * two numbers (0-100): PURITY (level.airQuality) — what the crowds and the
 * machines foul and the scrubbers clean — and OXYGEN (level.oxygen) — what
 * everyone breathes and the gardens make. Breathable air is the worse of the
 * two (breathable()). Each tick, in this order:
 *
 *   1. LOAD      residents, heavy industry and dumped sewage foul their own
 *                level; residents and combustion burn its oxygen; plants in
 *                bays and groves breathe a little back out
 *   2. EXHAUST   each ducted-together group of scrubbers and duct fans cleans
 *                the scrubbers' own levels, then every level its running fans
 *                serve, worst first — each fan moving no more than its
 *                ductFlowPerTick. An unducted scrubber cleans its own level
 *                only
 *   3. FRESH AIR likewise each ducted group of oxygen gardens and fans tops up
 *                the oxygen of the levels its fans serve, worst first
 *   4. MIGRATE   air mixes with the levels above and below
 *   5. SEAL      a sealed level is cut off from 2-4 and goes stale
 *
 * A plant needs clean air too: below its airNeed it grows proportionally
 * slower (`airShare`, read by outputScale next tick). The deep levels, where
 * the generator, the smelter and the dig face are, foul fastest; the gardens
 * are in the shallows. The ducts are how one reaches the other.
 *
 * Also the external catalyst supply: a delivery arrives every
 * air.catalystDeliveryIntervalTicks unless the supply has been cut — the
 * scrubbers' one input nobody in the Shaft can make.
 *
 * Owns level.airQuality, level.oxygen and each instance's `airShare`.
 */

import { clamp } from '../../utils/math.js';
import { outputScale } from '../buildings/buildingRegistry.js';
import { residentsByLevel } from '../population/housing.js';
import { put } from '../resources/stores.js';
import { made } from '../resources/ledger.js';
import { graphOf, isHub, levelsServedBy } from '../infrastructure/networkGraph.js';
import { breathable } from '../../core/selectors.js';

const CATALYST = 'scrubber-catalyst';
const EXHAUST = 'duct-network';
const FRESH = 'oxygen-ducts';

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
  const freshGraph = graphOf(state, ctx, FRESH);
  for (const instance of state.buildings) {
    const d = def(instance);
    if (!d) continue;
    // A recipe building is only dirty while it has a batch on.
    const idle = runsRecipes(d) && !instance.job;
    const scale = scaleOf.get(instance.instanceId);
    if (d.airLoad && !idle) foul[instance.level] += d.airLoad * scale;
    if (d.oxygenDraw && !idle) breath[instance.level] += d.oxygenDraw * scale;
    // Plants off the fresh-air ducts breathe out where they stand; a garden
    // on them breathes into the ducts (step 3).
    if (d.oxygenOutput && !freshGraph.byId.has(instance.instanceId)) breath[instance.level] -= d.oxygenOutput * scale;
  }
  for (const level of levels) {
    level.airQuality -= foul[level.index];
    level.oxygen -= breath[level.index];
  }

  // --- 2. exhaust -------------------------------------------------------------
  const scrubPower = (i) => {
    const e = (def(i).effects ?? []).find((x) => x.op === 'flow.scrub' && x.target === 'air-quality');
    return e ? e.value * scaleOf.get(i.instanceId) : 0;
  };
  for (const loop of loops(state, ctx, graphOf(state, ctx, EXHAUST), scrubPower, scaleOf)) {
    spend(loop, 'airQuality');
  }

  // --- 3. fresh air -----------------------------------------------------------
  const oxygenPower = (i) => (def(i).oxygenOutput ?? 0) * scaleOf.get(i.instanceId);
  for (const loop of loops(state, ctx, freshGraph, oxygenPower, scaleOf)) {
    spend(loop, 'oxygen');
  }

  // --- 4. migrate -------------------------------------------------------------
  const rate = clamp(cfg.migrationRateBetweenLevels, 0, 0.5);
  const mix = (field) => levels.map((level, i) => {
    if (level.sealed) return level[field];
    let flow = 0;
    for (const j of [i - 1, i + 1]) {
      const other = levels[j];
      if (!other || other.sealed) continue;
      flow += (other[field] - level[field]) * rate / 2;
    }
    return level[field] + flow;
  });
  const purity = mix('airQuality');
  const oxygen = mix('oxygen');

  // --- 5. seal ----------------------------------------------------------------
  levels.forEach((level, i) => {
    const q = level.sealed ? purity[i] - cfg.sealedLevelDecayPerTick : purity[i];
    level.airQuality = clamp(q, 0, 100);
    level.oxygen = clamp(oxygen[i], 0, 100);
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

/**
 * Each ducted-together group on one of the air loops: how much its sources
 * (scrubbers, or gardens) can do this tick, the levels they stand on, and
 * each running fan in the group with the levels it serves and how much it
 * can move (ductFlowPerTick). Unenforced, one group reaching every level
 * with no fan in the way.
 */
function loops(state, ctx, graph, power, scaleOf) {
  const open = (indices) => indices.map((l) => state.levels[l - 1]).filter((l) => l && !l.sealed);
  const out = [];
  for (const [, members] of graph.members) {
    let capacity = 0;
    const own = new Set();
    const fans = [];
    for (const node of members) {
      const p = power(node);
      if (p > 0) { capacity += p; own.add(node.level); }
      if (!graph.enforced || !isHub(ctx, graph.networkId, node.buildingId)) continue;
      const scale = scaleOf.get(node.instanceId);
      if (scale <= 0) continue;
      const flow = (ctx.catalog.buildings.byId[node.buildingId].ductFlowPerTick ?? Infinity) * scale;
      fans.push({ levels: open(levelsServedBy(state, ctx, node)), flow });
    }
    if (capacity <= 0) continue;
    if (!graph.enforced) out.push({ capacity, own: open(state.levels.map((l) => l.index)), fans: [] });
    else out.push({ capacity, own: open([...own]), fans });
  }
  return out;
}

/**
 * Spend a group's capacity: on the sources' own levels first, then fan by
 * fan, the fan serving the worst air first, each passing on no more than it
 * can move.
 */
function spend({ capacity, own, fans }, field) {
  let left = fill(own, field, capacity);
  const worst = (fan) => Math.min(100, ...fan.levels.map((l) => l[field]));
  for (const fan of [...fans].sort((a, b) => worst(a) - worst(b))) {
    if (left <= 1e-9) break;
    const give = Math.min(fan.flow, left);
    left -= give - fill(fan.levels, field, give);
  }
}

/**
 * Spend capacity on a set of levels, filling the worst first, and return
 * what is left. Levels are topped up toward the next-worst in turn, so capacity
 * spreads evenly across equally bad levels rather than all landing on
 * whichever was examined first.
 */
function fill(levels, field, capacity) {
  const inReach = levels.filter((l) => l[field] < 100);
  let left = capacity;

  while (left > 1e-9 && inReach.length > 0) {
    inReach.sort((a, b) => a[field] - b[field] || a.index - b.index);
    const worst = inReach[0][field];
    const tied = inReach.filter((l) => l[field] - worst < 1e-9);
    const next = inReach.length > tied.length ? inReach[tied.length][field] : 100;
    // Raise the tied group to the next level up (or to 100), or as far as the
    // remaining capacity goes.
    const step = Math.min(next - worst, left / tied.length);
    for (const l of tied) l[field] += step;
    left -= step * tied.length;
    for (let i = inReach.length - 1; i >= 0; i--) {
      if (inReach[i][field] >= 100 - 1e-9) inReach.splice(i, 1);
    }
  }
  return left;
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
