/**
 * build.js
 * The Buildings tab: everything the player can build, one category at a
 * time. Each building shows its render, small; which depths of the shaft it
 * can go in (upper, mid, lower — the depth bands of levels.json); what it
 * takes (slots, power, crews, cost) and what it gives (housing, output).
 *
 * Clicking one picks it up (selection.placing): the shaft brings a level that
 * can take it into view and shows it as a ghost under the pointer, and a
 * click on a free slot builds it there (view/placeLayer.js). One that cannot
 * be built anywhere — the stores are short, or no level has room — says why
 * and cannot be picked.
 *
 * Rebuilds its list only when something that decides it changes — the
 * category, the buildings standing, or whether the stores can pay — never
 * per frame.
 */

import * as selection from '../selection.js';
import { placement, buildCost } from '../../core/commands.js';
import { el, button } from '../components/dom.js';
import { inStorehouses, nameOf } from '../../systems/resources/stores.js';
import { iconOf, roomOf } from '../icons.js';

const CATEGORIES = ['habitation', 'cultivation', 'water', 'air', 'power', 'mechanical', 'logistics', 'administration'];

/** The category open last, kept across visits to the tab. */
let category = CATEGORIES[0];

export function mount(root, state, ctx, dispatch) {
  root.replaceChildren();

  const card = el('section', 'card build');
  card.appendChild(el('h2', '', 'Buildings'));
  const chips = el('div', 'build-categories');
  chips.setAttribute('role', 'tablist');
  const chipButtons = new Map(CATEGORIES.map((zone) => {
    const chip = button(zone, `Show ${zone} buildings`, () => {
      category = zone;
      signature = null;
    }, 'build-category');
    chip.setAttribute('role', 'tab');
    chips.appendChild(chip);
    return [zone, chip];
  }));
  const hint = el('div', 'meter-label build-hint');
  const list = el('div', 'build-list');
  card.append(chips, hint, list);
  root.appendChild(card);

  const bands = ctx.tables?.levels?.depthBands ?? [];
  let signature = null;
  let items = [];
  // Every material any building costs: when one of these moves, what the
  // player can afford may have changed.
  const materials = [...new Set(ctx.catalog.buildings.all.flatMap((d) => buildCost(ctx, d).map((c) => c.id)))].sort();

  function rebuild(currentState, currentCtx) {
    list.replaceChildren();
    // The Shaft's own structure — the Exit, the council chamber, the archive —
    // came with it and is never built, so it is not on the menu.
    const defs = currentCtx.catalog.buildings.all.filter((d) => d.zone === category && !d.fixed && !d.system);
    items = defs.map((def) => row(currentState, currentCtx, def));
    list.append(...items.map((i) => i.node));
  }

  function row(currentState, currentCtx, def) {
    const cost = buildCost(currentCtx, def);
    const short = cost.filter((c) => inStorehouses(currentState, currentCtx, c.id) < c.qty);
    const room = currentState.levels.some((l) => {
      const check = placement(currentState, currentCtx, def.id, l.index);
      return check.ok || check.reason === 'cost';
    });
    const why = short.length ? 'cannot afford' : room ? '' : 'no room anywhere';

    const item = el('button', 'build-item');
    item.type = 'button';
    item.disabled = Boolean(why);
    item.title = def._note ?? def.name;
    item.addEventListener('click', () => {
      selection.place(selection.get().placing === def.id ? null : def.id);
    });

    const thumb = el('span', 'build-thumb');
    const art = roomOf(def.id);
    if (art) {
      const img = el('img');
      img.src = art.href;
      img.alt = '';
      img.style.aspectRatio = `${64 * (def.slots ?? 1)} / 96`;
      thumb.appendChild(img);
    }

    const head = el('span', 'build-title');
    head.append(el('span', 'build-name', def.name), depthBadges(def));

    const price = el('span', 'build-cost');
    if (!cost.length) price.textContent = 'no cost';
    for (const c of cost) price.appendChild(costChip(currentCtx, c, short.includes(c)));

    item.append(thumb, head, el('span', 'build-why', why), el('span', 'build-facts', facts(def)), price);
    return { id: def.id, node: item };
  }

  /** UP / MID / LOW, lit where the building may go. */
  function depthBadges(def) {
    const wrap = el('span', 'build-depths');
    const allowed = bands.filter((b) => !def.levelConstraint || def.levelConstraint === b.id);
    wrap.title = `Can be built on: ${allowed.map((b) => `${b.name.toLowerCase()} (${b.fromLevel}–${b.toLevel ?? 'bottom'})`).join(', ')}`;
    for (const band of bands) {
      const badge = el('span', 'build-depth', band.short);
      badge.dataset.allowed = String(allowed.includes(band));
      wrap.appendChild(badge);
    }
    return wrap;
  }

  return {
    update(currentState, currentCtx) {
      const { placing } = selection.get();
      for (const [zone, chip] of chipButtons) chip.setAttribute('aria-selected', String(zone === category));

      const stores = materials.map((id) => Math.floor(inStorehouses(currentState, currentCtx, id))).join(',');
      const built = currentState.buildings.map((b) => `${b.instanceId}@${b.level}.${b.slot}`).join(',');
      const key = `${category}|${built}|${stores}`;
      if (key !== signature) {
        signature = key;
        rebuild(currentState, currentCtx);
      }
      for (const { id, node } of items) node.setAttribute('aria-pressed', String(id === placing));

      const def = placing && currentCtx.catalog.buildings.byId[placing];
      hint.textContent = def
        ? `Placing ${def.name}: click a free slot in the Shaft. Shift-click to place another; Esc or right-click to cancel.`
        : 'Pick a building, then a slot in the Shaft.';
      hint.dataset.placing = String(Boolean(def));
    },
  };
}

/** One material of the cost: its icon and how many, red when the stores are short. */
function costChip(ctx, c, short) {
  const chip = el('span', 'build-cost-item');
  chip.dataset.short = String(short);
  const icon = iconOf(c.id);
  if (icon) {
    const img = el('img', 'build-cost-icon');
    img.src = icon.href;
    img.alt = nameOf(ctx, c.id);
    img.dataset.resource = c.id;
    chip.appendChild(img);
  }
  chip.appendChild(el('span', '', icon ? String(c.qty) : `${c.qty} ${nameOf(ctx, c.id).toLowerCase()}`));
  chip.title = `${c.qty} ${nameOf(ctx, c.id)}`;
  return chip;
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
