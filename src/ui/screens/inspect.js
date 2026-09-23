/**
 * inspect.js
 * The selected building: what it is, whether it is working and — if not —
 * why, what is in its store, and what the player can do about it: crew it,
 * point it at a recipe, or tear it down. A porter station also lists its
 * porters, hires new ones and opens their routes; while a route is open this
 * tab is the route editor instead (routeEditor.js).
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
import { amount, capacity, inputsOf, outputsOf, isStorage } from '../../systems/resources/stores.js';
import * as routeEditor from './routeEditor.js';

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();
  const host = el('section', 'card inspect');
  root.appendChild(host);

  let shownId = undefined;
  let refresh = () => {};
  let editor = null;

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

    // What is in the building's own store, and how full.
    const storeCard = el('div', 'inspect-store');
    host.appendChild(storeCard);
    const storeKey = { value: null };

    // A porter station: its porters, and the hiring.
    let station = null;
    if (def.porterStation) {
      station = el('div', 'inspect-station');
      host.appendChild(station);
    }
    const stationKey = { value: null };

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

      renderStore(storeCard, storeKey, current, def, ctxNow);
      if (station) renderStation(station, stationKey, currentState, ctxNow, current, def, dispatch);

      if (batch) {
        const job = current.job;
        const recipe = job && ctxNow.catalog.recipes.byId[job.recipeId];
        batch.textContent = recipe ? `Batch: ${recipe.id}, ${Math.min(100, Math.round((job.progress / recipe.ticks) * 100))}%` : 'No batch running';
      }
    };
  }

  return {
    update(currentState, currentCtx) {
      const { editing } = selection.get();
      if (editing) {
        if (editor?.workerId !== editing) {
          editor?.destroy();
          editor = { workerId: editing, ...routeEditor.mount(host, currentState, currentCtx, dispatch, editing) };
          shownId = undefined;
        }
        editor.update();
        return;
      }
      if (editor) {
        editor.destroy();
        editor = null;
      }
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

/**
 * The building's store: every good it holds or has a place for, with a bar
 * against what it can hold, marked in (it uses it) or out (it makes it).
 */
function renderStore(root, key, instance, def, ctx) {
  const inputs = inputsOf(def, ctx);
  const outputs = outputsOf(def, ctx);
  const ids = new Set([...inputs, ...outputs, ...Object.keys(def.storeCapacity ?? {}), ...Object.keys(instance.stock ?? {})]);
  if (ids.size === 0) {
    if (key.value !== '') { root.replaceChildren(); key.value = ''; }
    return;
  }
  const sig = [...ids].join(',');
  if (key.value !== sig) {
    key.value = sig;
    root.replaceChildren(el('h3', 'build-zone', isStorage(def) ? `Store · holds ${def.storage.capacity}` : 'Store'));
    root.meters = new Map([...ids].map((id) => {
      const tag = inputs.has(id) ? 'in' : outputs.has(id) ? 'out' : 'held';
      return [id, renderMeter(root, { label: `${id} · ${tag}` })];
    }));
  }
  const held = Object.values(instance.stock ?? {}).reduce((a, b) => a + b, 0);
  for (const [id, meter] of root.meters) {
    const cap = isStorage(def) ? def.storage.capacity : capacity(instance, def, ctx, id);
    const qty = amount(instance, id);
    const out = outputs.has(id);
    const fill = cap > 0 ? qty / cap : 0;
    const bandOf = out ? (fill >= 0.999 ? 'critical' : fill > 0.8 ? 'warn' : 'ok') : (qty <= 1e-6 && inputs.has(id) ? 'critical' : fill < 0.2 && inputs.has(id) ? 'warn' : 'ok');
    meter.update(qty, isStorage(def) ? Math.max(held, 1) : cap, bandOf, `${Math.round(qty)} / ${Math.round(cap)}`);
  }
}

/** A station's porters, each with what they are doing, and the hiring. */
function renderStation(root, key, state, ctx, instance, def, dispatch) {
  const living = state.population.workers.filter((w) => w.stationId === instance.instanceId);
  const beds = def.porterStation.porters;
  const sig = living.map((w) => w.id).join(',');
  if (key.value !== sig) {
    key.value = sig;
    root.replaceChildren();
    const head = el('div', 'inspect-row');
    root.count = el('span', 'meter-label');
    head.append(root.count, button('Hire porter', 'Hire a porter from the labour pool', () => dispatch({ type: 'player:hirePorter', instanceId: instance.instanceId }), 'text-button'));
    root.appendChild(head);
    root.rows = living.map((w) => {
      const row = el('div', 'porter-row');
      const name = el('span', 'porter-name', w.name);
      const doing = el('span', 'meter-label porter-doing');
      let armed = false;
      const dismiss = button('Dismiss', `Dismiss ${w.name}`, () => {
        if (!armed) {
          armed = true;
          dismiss.textContent = 'Sure?';
          setTimeout(() => { armed = false; dismiss.textContent = 'Dismiss'; }, 3000);
          return;
        }
        dispatch({ type: 'player:dismissPorter', workerId: w.id });
      }, 'text-button danger');
      row.append(name, button('Route', `Edit ${w.name}'s route`, () => selection.editRoute(w.id), 'text-button'), dismiss, doing);
      root.appendChild(row);
      return { w, doing };
    });
  }
  root.count.textContent = `Porters ${living.length} of ${beds}`;
  for (const { w, doing } of root.rows) doing.textContent = routeEditor.describe(state, ctx, w);
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
