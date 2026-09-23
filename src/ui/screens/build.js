/**
 * build.js
 * The build menu for the selected level: every building, grouped by zone,
 * with what it takes (slots, power, crews, cost) and what it gives (housing,
 * output). One that cannot go here says why. Building goes through
 * player:placeBuilding like everything else.
 *
 * Rebuilds its list only when something that decides it changes — the level,
 * the buildings on it, or whether the stores can pay — never per frame.
 */

import * as selection from '../selection.js';
import { placement, buildCost, depthBandOf } from '../../core/commands.js';
import { el, button } from '../components/dom.js';
import { inStorehouses } from '../../systems/resources/stores.js';

const ZONES = ['habitation', 'cultivation', 'water', 'air', 'power', 'mechanical', 'logistics', 'administration'];

const REASONS = {
  'wrong-depth': 'wrong depth',
  fixed: 'fixed in place',
  'zone-full': 'zone full here',
  'no-room': 'no room',
  cost: 'cannot afford',
  'no-level': 'no such level',
};

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();

  const card = el('section', 'card build');
  const head = el('div', 'build-head');
  const up = button('▲', 'Level above', () => move(-1));
  const title = el('h2');
  const down = button('▼', 'Level below', () => move(1));
  head.append(up, title, down);
  const summary = el('div', 'meter-label');
  const list = el('div', 'build-list');
  card.append(head, summary, list);
  root.appendChild(card);

  let signature = null;
  // Every material any building costs: when one of these moves, what the
  // player can afford may have changed.
  const materials = [...new Set(ctx.catalog.buildings.all.flatMap((d) => buildCost(ctx, d).map((c) => c.id)))].sort();

  function move(step) {
    const level = selection.get().level ?? 1;
    const next = Math.min(state.levels.length, Math.max(1, level + step));
    selection.select({ level: next });
  }

  function rebuild(currentState, currentCtx, level) {
    list.replaceChildren();
    for (const zone of ZONES) {
      const defs = currentCtx.catalog.buildings.all.filter((d) => d.zone === zone && !d.fixed);
      if (defs.length === 0) continue;
      list.appendChild(el('h3', 'build-zone', zone));
      for (const def of defs) list.appendChild(row(currentState, currentCtx, def, level));
    }
  }

  function row(currentState, currentCtx, def, level) {
    const check = placement(currentState, currentCtx, def.id, level);
    const item = el('button', 'build-item');
    item.type = 'button';
    item.disabled = !check.ok;
    item.append(
      el('span', 'build-name', def.name),
      el('span', 'build-why', check.ok ? '' : REASONS[check.reason] ?? check.reason),
      el('span', 'build-facts', facts(def)),
      el('span', 'build-cost', check.cost.length ? `cost ${check.cost.map((c) => `${c.qty} ${c.id}`).join(', ')}` : 'no cost'),
    );
    item.title = def._note ?? def.name;
    item.addEventListener('click', () => {
      dispatch({ type: 'player:placeBuilding', buildingId: def.id, level });
      signature = null; // redraw now: the level and the stores just changed
    });
    return item;
  }

  return {
    update(currentState, currentCtx) {
      const level = selection.get().level;
      if (level === null) {
        title.textContent = 'Build';
        summary.textContent = 'Click an empty part of a level in the Shaft to build on it.';
        list.replaceChildren();
        signature = null;
        return;
      }
      const placed = currentState.buildings.filter((b) => b.level === level);
      const used = placed.reduce((n, b) => n + (b.slots ?? 1), 0);
      const slots = currentState.levels[level - 1]?.buildSlots ?? 0;
      title.textContent = `Level ${level}`;
      summary.textContent = `${depthBandOf(currentCtx, level) ?? ''} · ${slots - used} of ${slots} slots free`;

      // Affordability changes as stores move, so it is part of the key — but
      // rounded to whole units, or the list would rebuild every tick.
      const stores = materials.map((id) => Math.floor(inStorehouses(currentState, currentCtx, id))).join(',');
      const key = `${level}|${placed.map((b) => b.instanceId).join(',')}|${stores}`;
      if (key !== signature) {
        signature = key;
        rebuild(currentState, currentCtx, level);
      }
    },
  };
}

/** A building's size and what it does, in one line. */
function facts(def) {
  const parts = [`${def.slots ?? 1} slot${(def.slots ?? 1) > 1 ? 's' : ''}`];
  if (def.powerDraw) parts.push(`${def.powerDraw} kW`);
  if (def.staffing) parts.push(`${def.staffing} crew${def.staffing > 1 ? 's' : ''}`);
  if (def.housing) parts.push(`homes ${def.housing}`);
  for (const p of def.produces ?? []) parts.push(`+${p.qty} ${p.id}`);
  return parts.join(' · ');
}
