/**
 * inspect.js
 * The selected building: what it is, whether it is working and — if not —
 * why, what it consumes and produces and how much of each is on hand, and what the player can do about it: crew it,
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
import { amount, capacity, inputsOf, outputsOf, isStorage, bandOf, nameOf } from '../../systems/resources/stores.js';
import * as routeEditor from './routeEditor.js';
import { problemsOf } from '../buildingStatus.js';
import { iconOf } from '../icons.js';

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
    const status = el('div', 'inspect-problems');
    host.appendChild(status);
    const statusKey = { value: null };

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

    // What it consumes and produces, and how much of each is on hand.
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
        const io = (list) => list.map((x) => `${x.qty} ${nameOf(currentCtx, x.id).toLowerCase()}`).join(' + ');
        recipeSelect.appendChild(new Option(`${io(r.inputs)} \u2192 ${io(r.outputs)}`, r.id));
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
      renderProblems(status, statusKey, problemsOf(current, def, currentState, ctxNow));
      condition.update(current.condition * 100, 100, current.condition < 0.4 ? 'critical' : current.condition < 0.75 ? 'warn' : 'ok', `${Math.round(current.condition * 100)}%`);
      if (crewValue) crewValue.textContent = `${current.staffing} / ${current.staffTarget ?? def.staffing} (posts ${def.staffing})`;

      const lines = [];
      const draw = powerDemand(current, def, ctxNow, currentState);
      if (draw > 0) lines.push(`Draws ${Math.round(draw)} kW`);
      if (def.housing) lines.push(`Homes for ${def.housing}`);
      if ((current.waterShare ?? 1) < 1) lines.push(`Water ration ${Math.round(current.waterShare * 100)}%`);
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
 * The building's goods, compact: what it consumes and what it produces, each
 * as its icon over "on hand / room" and a small bar of how full the bin is —
 * together a little bar chart of the building's stores. Count and bar are
 * coloured by the same bands the shaft's popover uses (stores.js bandOf): a
 * consumed good red when it is gone and orange when low; a produced one red
 * when there is no room left and orange once it is filling; green otherwise.
 * A depot or storehouse lists what it holds, each bar its share of the whole
 * store, and a good a porter left somewhere that has no use for it is listed
 * apart, with no bar, because there is no bin for it to fill.
 *
 * Hovering or focusing an icon opens the resource card (resourceTip.js).
 */
function renderStore(root, key, instance, def, ctx) {
  const inputs = inputsOf(def, ctx);
  const outputs = outputsOf(def, ctx);
  const storage = isStorage(def);
  const extra = [...Object.keys(def.storeCapacity ?? {}), ...Object.keys(instance.stock ?? {})]
    .filter((id) => !inputs.has(id) && !outputs.has(id));
  const groups = storage
    ? [['Stores', 'held', [...new Set(extra)]]]
    : [['Consumes', 'in', [...inputs]], ['Produces', 'out', [...outputs]], ['Also holds', 'held', [...new Set(extra)]]];
  const shown = groups.filter(([, , ids]) => ids.length);

  const sig = shown.map(([title, , ids]) => `${title}:${ids.join(',')}`).join('|');
  if (key.value !== sig) {
    key.value = sig;
    root.replaceChildren();
    root.cells = [];
    for (const [title, role, ids] of shown) {
      const group = el('div', 'res-group');
      const head = el('h3', 'build-zone', title);
      if (storage) root.total = head;
      const grid = el('div', 'res-grid');
      for (const id of ids) {
        const cell = el('div', 'res-cell');
        cell.dataset.resource = id;
        cell.tabIndex = 0;
        cell.setAttribute('aria-label', rateOf(def, ctx, id, role));
        const icon = iconOf(id);
        if (icon) {
          const img = el('img', 'res-icon');
          img.src = icon.href;
          img.alt = nameOf(ctx, id);
          cell.appendChild(img);
        } else {
          cell.appendChild(el('span', 'res-icon res-icon-missing', nameOf(ctx, id).slice(0, 3)));
        }
        const count = el('span', 'res-count');
        cell.appendChild(count);
        // The bar's frame is its own element so its edge can be a shade darker
        // than the fill, the same as the bars on the shaft's plates.
        let fill = null;
        let bar = null;
        if (role !== 'held' || storage) {
          bar = el('span', 'res-bar');
          fill = el('span', 'res-fill');
          bar.appendChild(fill);
          cell.appendChild(bar);
        }
        grid.appendChild(cell);
        root.cells.push({ id, role, count, bar, fill });
      }
      group.append(head, grid);
      root.appendChild(group);
    }
  }

  for (const { id, role, count, bar, fill } of root.cells ?? []) {
    const qty = amount(instance, id);
    if (storage || role === 'held') {
      count.textContent = compact(qty);
      count.dataset.band = 'none';
      if (bar) setBar(bar, fill, def.storage.capacity > 0 ? qty / def.storage.capacity : 0, 'ok');
      continue;
    }
    const cap = capacity(instance, def, ctx, id);
    const band = { out: 'critical', low: 'warn', full: 'critical', filling: 'warn', ok: 'ok' }[bandOf(qty, cap, role, ctx)];
    count.textContent = `${compact(qty)}/${compact(cap)}`;
    count.dataset.band = band;
    setBar(bar, fill, cap > 0 ? qty / cap : 0, band);
  }
  if (storage && root.total) {
    const held = Object.values(instance.stock ?? {}).reduce((a, b) => a + b, 0);
    root.total.textContent = `Stores · ${compact(held)}/${compact(def.storage.capacity)}`;
  }
}

/**
 * One bin's bar: fill to the share held, coloured by band. Anything held at
 * all shows at least a sliver, so "a little" never reads as "none".
 */
function setBar(bar, fill, share, band) {
  const pct = share <= 0 ? 0 : Math.max(4, Math.min(100, share * 100));
  fill.style.width = `${pct.toFixed(1)}%`;
  bar.dataset.band = band;
}

/** A whole number, shortened past four digits: 950, 1200, 12k. */
function compact(n) {
  const v = Math.round(n);
  return v >= 10000 ? `${Math.round(v / 1000)}k` : String(v);
}

/** A good's accessible label: its name, and the rate when the catalogue gives one. */
function rateOf(def, ctx, id, role) {
  const name = nameOf(ctx, id);
  const list = role === 'in' ? def.consumes : role === 'out' ? def.produces : null;
  const rate = list?.find((x) => x.id === id)?.qty;
  return rate ? `${name} · ${role === 'in' ? 'uses' : 'makes'} ${rate} a tick` : name;
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

function selectedInstance(state) {
  const { instanceId } = selection.get();
  return instanceId ? state.buildings.find((b) => b.instanceId === instanceId) ?? null : null;
}

/** Draw the problem lines, rebuilding only when they change. */
function renderProblems(root, key, problems) {
  const sig = problems.map(([text]) => text).join('|');
  if (key.value === sig) return;
  key.value = sig;
  root.replaceChildren(...problems.map(([text, band]) => {
    const line = el('div', 'inspect-status', text);
    line.dataset.state = band;
    return line;
  }));
}
