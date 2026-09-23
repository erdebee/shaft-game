/**
 * inspect.js
 * The selected building: what it is, whether it is working and — if not —
 * why, and the three things the player can do about it: crew it, point it at
 * a recipe, or tear it down.
 *
 * The frame is built when the selection changes; per frame only the readouts
 * are refreshed.
 */

import * as selection from '../selection.js';
import { el, button } from '../components/dom.js';
import { render as renderMeter } from '../components/resourceMeter.js';
import { recipesFor } from '../../systems/resources/componentChain.js';
import { factionOf } from '../../systems/population/staffing.js';
import { powerDemand } from '../../systems/buildings/buildingRegistry.js';

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();
  const host = el('section', 'card inspect');
  root.appendChild(host);

  let shownId = undefined;
  let refresh = () => {};

  function build(instance, currentCtx) {
    host.replaceChildren();
    if (!instance) {
      host.append(el('h2', '', 'Inspect'), el('div', 'meter-label', 'Click a room in the Shaft to inspect it.'));
      refresh = () => {};
      return;
    }
    const def = currentCtx.catalog.buildings.byId[instance.buildingId];
    const faction = factionOf(currentCtx, def.id);

    host.append(
      el('h2', '', def.name),
      el('div', 'meter-label', `Level ${instance.level} · ${def.zone}${faction ? ` · ${currentCtx.catalog.factions.byId[faction].name}` : ''}`),
    );
    const status = el('div', 'inspect-status');
    host.appendChild(status);

    const condition = renderMeter(host, { label: 'Condition' });

    // Crews: only for buildings that have posts.
    let crewValue = null;
    if (def.staffing) {
      const crews = el('div', 'inspect-row');
      crewValue = el('span', 'meter-value');
      crews.append(
        el('span', 'meter-label', 'Crews'),
        button('−', 'Fewer crews', () => setCrews(-1)),
        crewValue,
        button('+', 'More crews', () => setCrews(1)),
      );
      host.appendChild(crews);
    }
    function setCrews(step) {
      const current = selectedInstance(state);
      if (!current) return;
      dispatch({ type: 'player:assignStaff', instanceId: current.instanceId, count: (current.staffTarget ?? 0) + step });
    }

    const facts = el('div', 'inspect-facts');
    host.appendChild(facts);

    // Recipe: for buildings that run them.
    const recipes = recipesFor(def.id, currentCtx);
    let recipeSelect = null;
    let batch = null;
    if (recipes.length) {
      const row = el('label', 'inspect-row');
      recipeSelect = el('select', 'inspect-select');
      recipeSelect.appendChild(new Option('Automatic — whatever is short', ''));
      for (const r of recipes) {
        recipeSelect.appendChild(new Option(`${r.id} (${r.inputs.map((i) => `${i.qty} ${i.id}`).join(' + ')} → ${r.outputs.map((o) => `${o.qty} ${o.id}`).join(' + ')})`, r.id));
      }
      recipeSelect.value = instance.recipeId ?? '';
      recipeSelect.addEventListener('change', () => {
        dispatch({ type: 'player:setRecipe', instanceId: instance.instanceId, recipeId: recipeSelect.value || null });
      });
      row.append(el('span', 'meter-label', 'Recipe'), recipeSelect);
      batch = el('div', 'meter-label');
      host.append(row, batch);
    }

    // Demolish asks twice: the first click arms it, the second tears it down.
    if (!def.fixed) {
      let armed = false;
      const demolish = button('Demolish', 'Demolish this building', () => {
        if (!armed) {
          armed = true;
          demolish.textContent = 'Really demolish? Nothing is refunded';
          setTimeout(() => { armed = false; demolish.textContent = 'Demolish'; }, 3000);
          return;
        }
        dispatch({ type: 'player:demolish', instanceId: instance.instanceId });
        selection.select({ level: instance.level });
      }, 'text-button danger');
      host.appendChild(demolish);
    }

    refresh = (currentState, ctxNow) => {
      const current = selectedInstance(currentState);
      if (!current) return;
      const [text, band] = statusOf(current, def, currentState, ctxNow);
      status.textContent = text;
      status.dataset.state = band;
      condition.update(current.condition * 100, 100, current.condition < 0.4 ? 'critical' : current.condition < 0.75 ? 'warn' : 'ok', `${Math.round(current.condition * 100)}%`);
      if (crewValue) crewValue.textContent = `${current.staffing} / ${current.staffTarget ?? def.staffing} (posts ${def.staffing})`;

      const lines = [];
      const draw = powerDemand(current, def, ctxNow, currentState);
      if (draw > 0) lines.push(`Draws ${Math.round(draw)} kW`);
      if (def.housing) lines.push(`Homes for ${def.housing}`);
      if ((current.waterShare ?? 1) < 1) lines.push(`Water ration ${Math.round(current.waterShare * 100)}%`);
      for (const c of def.consumes ?? []) lines.push(`Uses ${c.qty} ${c.id} / tick`);
      for (const p of def.produces ?? []) lines.push(`Makes ${p.qty} ${p.id} / tick`);
      if (current.repairing) lines.push('On the repair list');
      facts.replaceChildren(...lines.map((line) => el('div', 'meter-label', line)));

      if (batch) {
        const job = current.job;
        const recipe = job && ctxNow.catalog.recipes.byId[job.recipeId];
        batch.textContent = recipe ? `Batch: ${recipe.id}, ${Math.min(100, Math.round((job.progress / recipe.ticks) * 100))}%` : 'No batch running';
      }
    };
  }

  return {
    update(currentState, currentCtx) {
      const instance = selectedInstance(currentState);
      const id = instance?.instanceId ?? null;
      if (id !== shownId) {
        shownId = id;
        build(instance, currentCtx);
      }
      refresh(currentState, currentCtx);
    },
  };
}

function list(ids = []) {
  return ids.join(', ');
}

function selectedInstance(state) {
  const { instanceId } = selection.get();
  return instanceId ? state.buildings.find((b) => b.instanceId === instanceId) ?? null : null;
}

/** One line saying whether the building works, and the first reason it does not. */
function statusOf(instance, def, state, ctx) {
  const faction = factionOf(ctx, def.id);
  if (faction && state.population.strikes.some((s) => s.faction === faction)) return ['On strike', 'critical'];
  if (instance.brokenDown) return ['Broken down — waiting for repairs', 'critical'];
  if (instance.powered === false) return ['Dark — no power', 'critical'];
  if (instance.starved) return [`Waiting for ${list(instance.missing) || 'its inputs'} — none in its store`, 'critical'];
  if (instance.blocked) return [`Store full of ${list(instance.full)} — waiting for a porter to collect`, 'warn'];
  if ((instance.waterShare ?? 1) < 1) return ['Short of water', 'warn'];
  if (def.staffing && instance.staffing < def.staffing) return [`Short-handed: ${instance.staffing} of ${def.staffing} crews`, 'warn'];
  if (recipesFor(def.id, ctx).length && !instance.job) return ['Idle — nothing needed, or no inputs', 'warn'];
  return ['Working', 'ok'];
}
