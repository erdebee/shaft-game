/**
 * componentChain.js
 * Multi-stage refinement: ore -> ingot -> part -> assembly. Recipes live in
 * catalog/resources/recipes.json; each names the building that runs it, its
 * inputs and outputs, its power draw and how many ticks a batch takes.
 *
 * A recipe building works in BATCHES, out of its own store (stores.js).
 * Starting a batch takes its inputs out of that store at once; the batch then
 * advances by the building's output scale each tick (so an understaffed or
 * worn smelter is slow, and a browned-out one stalls), and its outputs land in
 * the store when it completes — or wait, finished, while the store is full
 * (`blocked`) until a porter collects. Batches are what give a
 * recipe its `ticks`, and they stop a building flipping between recipes every
 * tick when two stocks are equally short.
 *
 * Which recipe runs next: the one the player pinned on the instance, or else
 * the affordable recipe whose output is furthest below its reserve across
 * the whole Shaft (the
 * `reserve` on its stock or component definition, weighted by its
 * `reservePriority`). When every output is at reserve the building idles, and
 * an idle recipe building draws no power.
 *
 * NOTE: the scrubber catalyst deliberately has no local recipe. That gap is
 * seeded as a mystery in Chapter 1 and becomes the Presidium's leverage in
 * Chapter 2 — do not add a self-production path without a narrative decision.
 */

import { workScale } from '../buildings/buildingRegistry.js';
import { amount, put, take, room, total } from './stores.js';
import { setWaiting } from './flowStock.js';

export function tick(state, ctx) {
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;
    const recipes = recipesFor(def.id, ctx);
    if (recipes.length === 0) continue;

    // workScale, not outputScale: this system decides `starved` for recipe
    // buildings, so it must not read it — a starved smelter has to keep
    // checking its bunker, or it would never notice the coal arrive.
    const scale = workScale(instance, def, ctx) * (instance.waterShare ?? 1);
    if (scale <= 0) {
      setWaiting(instance, [], [], ctx);
      continue;
    }

    if (!instance.job) startNext(state, ctx, instance, def, recipes);
    if (!instance.job) {
      setWaiting(instance, waitingFor(state, ctx, instance, recipes), [], ctx);
      continue;
    }

    const recipe = ctx.catalog.recipes.byId[instance.job.recipeId];
    if (instance.job.progress < recipe.ticks) instance.job.progress += scale;
    if (instance.job.progress < recipe.ticks) {
      setWaiting(instance, [], [], ctx);
      continue;
    }

    // Done — but the batch only leaves the building if all of it fits.
    const efficiency = recipe.efficiencyTunable ? tunable(ctx, recipe.efficiencyTunable) : 1;
    const full = recipe.outputs.filter((o) => room(instance, def, ctx, o.id) < o.qty * efficiency).map((o) => o.id);
    setWaiting(instance, [], full, ctx);
    if (full.length > 0) continue;

    for (const output of recipe.outputs) put(instance, def, ctx, output.id, output.qty * efficiency);
    instance.job = null;
    ctx.emit('recipe:completed', { instanceId: instance.instanceId, recipeId: recipe.id });

    // Straight on to the next batch, so a busy smelter never idles a tick
    // between one and the next.
    startNext(state, ctx, instance, def, recipes);
  }
}

/** Recipes a building can run, in catalogue order. */
export function recipesFor(buildingId, ctx) {
  return ctx.catalog.recipes.all.filter((r) => r.building === buildingId);
}

/**
 * Whether the settlement can make this at all. False for anything no recipe
 * produces — the scrubber catalyst above all.
 */
export function canProduce(resourceId, ctx) {
  return ctx.catalog.recipes.all.some((r) => r.outputs.some((o) => o.id === resourceId));
}

/**
 * How badly a recipe's output is wanted: its shortfall below reserve as a
 * share (1 when the stock is empty, 0 at or above reserve), weighted by the
 * definition's reservePriority so fuel beats steel when both are short. A
 * recipe with several outputs is as wanted as its most wanted one — coking
 * coal is worth running for the carbon alone.
 */
export function need(state, ctx, recipe) {
  let most = 0;
  for (const output of recipe.outputs) {
    const def = definitionOf(ctx, output.id);
    if (!def?.reserve) continue;
    const stock = total(state, output.id);
    const shortfall = Math.max(0, 1 - stock / def.reserve);
    most = Math.max(most, shortfall * (def.reservePriority ?? 1));
  }
  return most;
}

function startNext(state, ctx, instance, def, recipes) {
  const recipe = chooseRecipe(state, ctx, instance, recipes);
  if (!recipe) return;

  for (const input of recipe.inputs) take(instance, input.id, input.qty);
  instance.job = { recipeId: recipe.id, progress: 0 };
}

/**
 * Why an idle recipe building is idle. Nothing, if every output is at reserve
 * — that is rest, not starvation. Otherwise the inputs it lacks for the
 * recipes it would run.
 */
function waitingFor(state, ctx, instance, recipes) {
  const wanted = instance.recipeId
    ? recipes.filter((r) => r.id === instance.recipeId)
    : recipes.filter((r) => need(state, ctx, r) > 0);
  const missing = new Set();
  for (const r of wanted) {
    for (const input of r.inputs) if (amount(instance, input.id) < input.qty) missing.add(input.id);
  }
  return [...missing];
}

/**
 * The next batch, or null to idle. A pinned recipe runs whenever it can,
 * reserve or not — the player asked for it. Ties break on catalogue order.
 */
function chooseRecipe(state, ctx, instance, recipes) {
  if (instance.recipeId) {
    const pinned = recipes.find((r) => r.id === instance.recipeId);
    return pinned && affordable(state, instance, pinned) ? pinned : null;
  }

  let best = null;
  let bestNeed = 0;
  for (const recipe of recipes) {
    if (!affordable(state, instance, recipe)) continue;
    const n = need(state, ctx, recipe);
    if (n > bestNeed) {
      best = recipe;
      bestNeed = n;
    }
  }
  return best;
}

/** Whether the building's own store holds a whole batch's inputs. */
function affordable(state, instance, recipe) {
  return recipe.inputs.every((input) =>
    !state.resources.cutSupplies.includes(input.id) &&
    amount(instance, input.id) >= input.qty);
}

function definitionOf(ctx, id) {
  return ctx.catalog.components.byId[id] ?? ctx.catalog.stocks.byId[id] ?? null;
}

function tunable(ctx, path) {
  return path.split('.').reduce((node, key) => node?.[key], ctx.config) ?? 1;
}
