/**
 * componentChain.js
 * Multi-stage refinement: ore -> ingot -> part -> assembly. Recipes live in
 * catalog/resources/recipes.json; each names the building that runs it, its
 * inputs and outputs, its power draw and how many ticks a batch takes.
 *
 * A recipe building works in BATCHES. Starting a batch takes its inputs out of
 * stock at once; the batch then advances by the building's output scale each
 * tick (so an understaffed or worn smelter is slow, and a browned-out one
 * stalls), and its outputs land when it completes. Batches are what give a
 * recipe its `ticks`, and they stop a building flipping between recipes every
 * tick when two stocks are equally short.
 *
 * Which recipe runs next: the one the player pinned on the instance, or else
 * the affordable recipe whose output is furthest below its reserve (the
 * `reserve` on its stock or component definition, weighted by its
 * `reservePriority`). When every output is at reserve the building idles, and
 * an idle recipe building draws no power.
 *
 * NOTE: the scrubber catalyst deliberately has no local recipe. That gap is
 * seeded as a mystery in Chapter 1 and becomes the Presidium's leverage in
 * Chapter 2 — do not add a self-production path without a narrative decision.
 */

import { outputScale } from '../buildings/buildingRegistry.js';

export function tick(state, ctx) {
  for (const instance of state.buildings) {
    const def = ctx.catalog.buildings.byId[instance.buildingId];
    if (!def) continue;
    const recipes = recipesFor(def.id, ctx);
    if (recipes.length === 0) continue;

    const scale = outputScale(instance, def, ctx);
    if (scale <= 0) continue;

    if (!instance.job) startNext(state, ctx, instance, recipes);
    if (!instance.job) continue;

    const recipe = ctx.catalog.recipes.byId[instance.job.recipeId];
    instance.job.progress += scale;
    if (instance.job.progress < recipe.ticks) continue;

    const efficiency = recipe.efficiencyTunable ? tunable(ctx, recipe.efficiencyTunable) : 1;
    for (const output of recipe.outputs) {
      state.resources.stocks[output.id] = (state.resources.stocks[output.id] ?? 0) + output.qty * efficiency;
    }
    instance.job = null;
    ctx.emit('recipe:completed', { instanceId: instance.instanceId, recipeId: recipe.id });

    // Straight on to the next batch, so a busy smelter never idles a tick
    // between one and the next.
    startNext(state, ctx, instance, recipes);
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
    const stock = state.resources.stocks[output.id] ?? 0;
    const shortfall = Math.max(0, 1 - stock / def.reserve);
    most = Math.max(most, shortfall * (def.reservePriority ?? 1));
  }
  return most;
}

function startNext(state, ctx, instance, recipes) {
  const recipe = chooseRecipe(state, ctx, instance, recipes);
  if (!recipe) return;

  for (const input of recipe.inputs) {
    state.resources.stocks[input.id] -= input.qty;
  }
  instance.job = { recipeId: recipe.id, progress: 0 };
}

/**
 * The next batch, or null to idle. A pinned recipe runs whenever it can,
 * reserve or not — the player asked for it. Ties break on catalogue order.
 */
function chooseRecipe(state, ctx, instance, recipes) {
  if (instance.recipeId) {
    const pinned = recipes.find((r) => r.id === instance.recipeId);
    return pinned && affordable(state, pinned) ? pinned : null;
  }

  let best = null;
  let bestNeed = 0;
  for (const recipe of recipes) {
    if (!affordable(state, recipe)) continue;
    const n = need(state, ctx, recipe);
    if (n > bestNeed) {
      best = recipe;
      bestNeed = n;
    }
  }
  return best;
}

function affordable(state, recipe) {
  return recipe.inputs.every((input) =>
    !state.resources.cutSupplies.includes(input.id) &&
    (state.resources.stocks[input.id] ?? 0) >= input.qty);
}

function definitionOf(ctx, id) {
  return ctx.catalog.components.byId[id] ?? ctx.catalog.stocks.byId[id] ?? null;
}

function tunable(ctx, path) {
  return path.split('.').reduce((node, key) => node?.[key], ctx.config) ?? 1;
}
