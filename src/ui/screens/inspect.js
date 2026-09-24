/**
 * inspect.js
 * The selected building: what it is, whether it is working and — if not —
 * why, what it consumes and produces and how much of each is on hand, and what the player can do about it: crew it,
 * point it at a recipe, or tear it down. A porter station also lists its
 * porters, hires new ones and opens their routes, the same roster the Porters
 * tab shows (porters.js). Inspect has no tab of its own: it opens when a room
 * is clicked in the shaft.
 *
 * Every building also lists the porters whose routes call at it, and what
 * each brings and takes away. Clicking one opens their route and brings them
 * into view.
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
import { renderStation } from './porters.js';
import { problemsOf } from '../buildingStatus.js';
import { iconOf } from '../icons.js';
import { visitorsOf } from '../routePlan.js';
import { graphOf, hubFor, isHub, networksOf, networkDef } from '../../systems/infrastructure/networkGraph.js';
import { priorityOf } from '../../systems/power/priorityLadder.js';

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

    // A junction's priority on the grid, 1 served first.
    let priorityButtons = null;
    if (isHub(currentCtx, 'power-grid', def.id)) {
      const row = el('div', 'inspect-row net-priority');
      row.appendChild(el('span', 'meter-label', 'Grid priority'));
      priorityButtons = [];
      for (let p = 1; p <= 5; p++) {
        const b = button(String(p), `Priority ${p}${p === 1 ? ', served first' : p === 5 ? ', dropped first' : ''}`, () => {
          dispatch({ type: 'player:setPriority', instanceId: instance.instanceId, priority: p });
        }, 'net-prio');
        priorityButtons.push(b);
        row.appendChild(b);
      }
      host.appendChild(row);
    }

    const facts = el('div', 'inspect-facts');
    host.appendChild(facts);

    // What it consumes and produces, and how much of each is on hand.
    const storeCard = el('div', 'inspect-store');
    host.appendChild(storeCard);
    const storeKey = { value: null };

    // The porters whose routes call here.
    const visitors = el('div', 'inspect-visitors');
    host.appendChild(visitors);
    const visitorsKey = { value: null };

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
      lines.push(...networkLines(currentState, ctxNow, current, def, draw));
      if (priorityButtons) {
        const p = priorityOf(current, ctxNow);
        priorityButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === p)));
      }
      facts.replaceChildren(...lines.map((line) => el('div', 'meter-label', line)));

      renderStore(storeCard, storeKey, current, def, ctxNow);
      renderVisitors(visitors, visitorsKey, currentState, ctxNow, current);
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

/**
 * The porters whose routes call at this building: each a button that opens
 * their route and follows them, with the goods they bring here and the goods
 * they take away, as icons that open the resource card.
 */
function renderVisitors(root, key, state, ctx, instance) {
  const visits = visitorsOf(state, instance.instanceId);
  const sig = JSON.stringify(visits.map((v) => [v.porter.id, v.stops, v.brings, v.takes]));
  if (key.value !== sig) {
    key.value = sig;
    root.replaceChildren();
    root.rows = [];
    if (!visits.length) return;
    root.appendChild(el('h3', 'build-zone', 'Porters calling here'));
    for (const { porter, stops, brings, takes } of visits) {
      const row = el('div', 'visitor-row');
      const name = button(porter.name, `Open ${porter.name}'s route and follow them`, () => selection.editRoute(porter.id, { follow: true }), 'visitor-name');
      const where = el('span', 'meter-label', `stop ${stops.map((i) => i + 1).join(', ')}`);
      const goods = el('span', 'visitor-goods');
      if (brings.length) goods.append(el('span', 'meter-label', 'brings'), ...brings.map((id) => goodIcon(ctx, id)));
      if (takes.length) goods.append(el('span', 'meter-label', 'takes'), ...takes.map((id) => goodIcon(ctx, id)));
      const doing = el('span', 'meter-label visitor-doing');
      row.append(name, where, goods, doing);
      root.appendChild(row);
      root.rows.push({ porter, doing });
    }
  }
  for (const { porter, doing } of root.rows ?? []) doing.textContent = routeEditor.describe(state, ctx, porter);
}

/** A good's icon, small, opening the resource card; its name if it has none. */
function goodIcon(ctx, id) {
  const icon = iconOf(id);
  const node = icon ? el('img', 'visitor-icon') : el('span', 'visitor-icon visitor-icon-missing', nameOf(ctx, id).slice(0, 3));
  if (icon) {
    node.src = icon.href;
    node.alt = nameOf(ctx, id);
  }
  node.dataset.resource = id;
  node.tabIndex = 0;
  node.title = nameOf(ctx, id);
  return node;
}

/**
 * Where the building sits on the networks: what it is linked to, and which
 * junction and cistern serve it.
 */
function networkLines(state, ctx, instance, def, draw) {
  const lines = [];
  const levelOf = (hub) => (hub && hub !== '*' ? `level ${hub.level}` : null);
  if (draw > 0 || def.powerDraw > 0) {
    const hub = hubFor(graphOf(state, ctx, 'power-grid'), ctx, instance.level, { usable: (h) => !h.brokenDown });
    if (hub) lines.push(hub === '*' ? 'Power from the grid' : `Power via the junction on ${levelOf(hub)} (priority ${priorityOf(hub, ctx)})`);
  }
  if ((def.consumes ?? []).some((c) => c.id === 'water')) {
    const hub = hubFor(graphOf(state, ctx, 'water-mains'), ctx, instance.level, { usable: (h) => !h.brokenDown });
    if (hub) lines.push(hub === '*' ? 'Water from the mains' : `Water from the cistern on ${levelOf(hub)}`);
  }
  for (const networkId of networksOf(ctx, def.id)) {
    const links = (state.infrastructure?.links ?? []).filter((l) => l.network === networkId && (l.from === instance.instanceId || l.to === instance.instanceId));
    const net = networkDef(ctx, networkId);
    lines.push(links.length
      ? `${net.name}: ${links.length} ${net.link}${links.length > 1 ? 's' : ''}`
      : `${net.name}: not connected — lay it from Build › Infrastructure`);
  }
  return lines;
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
