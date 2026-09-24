/**
 * placeLayer.js
 * Putting a building down: the building picked in the Build tab
 * (selection.placing), drawn as a ghost in the shaft under the pointer.
 *
 * The ghost is centred on the slot the pointer is over and kept inside its
 * level. Where the building can go it shows as its own render, half there;
 * where it cannot — a room in the way, the wrong depth, the level's zone
 * full, the stores short — the same footprint carries a red wash, and a
 * small popover by the pointer says which. A click on
 * a good spot builds there (player:placeBuilding with the slot) and ends the
 * placing; shift-click keeps it for another. Escape or a right-click cancels.
 *
 * Picking a building brings the nearest level that can take it into view, if
 * none already is — scrolled, not jumped, so the player sees where they went.
 *
 * UI, not world: nothing here is saved, and the only thing it writes is the
 * command a click asks for.
 */

import { roomRect, levelY, LEVEL_HEIGHT, ROOM_HEIGHT, SLOT_WIDTH, BUILD_X } from './interpolate.js';
import { pan } from './viewport.js';
import { placement, depthBandOf } from '../../core/commands.js';
import { inStorehouses, nameOf } from '../../systems/resources/stores.js';
import * as selection from '../selection.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createPlaceLayer(view, root, dispatch) {
  const layer = view.layers.placing;
  const ghost = document.createElementNS(SVG_NS, 'g');
  ghost.setAttribute('class', 'place-ghost');
  const picture = document.createElementNS(SVG_NS, 'image');
  picture.setAttribute('class', 'place-picture');
  picture.setAttribute('preserveAspectRatio', 'none');
  const plain = document.createElementNS(SVG_NS, 'rect');
  plain.setAttribute('class', 'place-plain');
  const wash = document.createElementNS(SVG_NS, 'rect');
  wash.setAttribute('class', 'place-blocked');
  const edge = document.createElementNS(SVG_NS, 'rect');
  edge.setAttribute('class', 'place-edge');
  ghost.append(picture, plain, wash, edge);
  layer.appendChild(ghost);

  // Why the spot is red: HTML over the shaft rather than SVG in it, so it
  // stays crisp at any zoom and can sit wherever the pointer is.
  const tip = document.createElement('div');
  tip.className = 'place-tip';
  tip.setAttribute('role', 'status');
  tip.hidden = true;
  root.appendChild(tip);

  /** The pointer, in client pixels, while it is over the shaft. */
  let pointer = null;
  /** The building the ghost was last drawn for, to notice a new pick. */
  let shownFor = null;
  /** A level the view is scrolling to, until it arrives or the player pans. */
  let target = null;

  view.svg.addEventListener('pointermove', (event) => { pointer = { x: event.clientX, y: event.clientY }; });
  view.svg.addEventListener('pointerleave', () => { pointer = null; });
  view.svg.addEventListener('contextmenu', (event) => {
    if (!selection.get().placing) return;
    event.preventDefault();
    selection.place(null);
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selection.get().placing) selection.place(null);
  });

  /** Where the pointer would put the building: its level, first slot and verdict. */
  function spotAt(state, ctx, buildingId, client) {
    if (!client) return null;
    const ctm = view.svg.getScreenCTM();
    if (!ctm) return null;
    const pt = view.svg.createSVGPoint();
    pt.x = client.x;
    pt.y = client.y;
    const { x, y } = pt.matrixTransform(ctm.inverse());
    const level = Math.floor(y / LEVEL_HEIGHT) + 1;
    const row = state.levels.find((l) => l.index === level);
    if (!row || x < BUILD_X) return null;

    // Slots sit a seam apart only where a room stands, so each one's left
    // edge comes from the rooms beside it rather than a fixed pitch.
    let over = 0;
    for (let s = 0; s < row.buildSlots; s++) {
      if (roomRect({ level, slot: s }, state.buildings).x <= x) over = s;
    }
    const def = ctx.catalog.buildings.byId[buildingId];
    const width = def.slots ?? 1;
    const slot = Math.max(0, Math.min(row.buildSlots - width, over - Math.floor((width - 1) / 2)));
    const check = placement(state, ctx, buildingId, level, { slot });
    return { level, slot, width, ok: check.ok, reason: check.reason };
  }

  /** Levels that can take the building somewhere, cost aside. */
  function homesFor(state, ctx, buildingId) {
    return state.levels
      .map((l) => l.index)
      .filter((level) => {
        const check = placement(state, ctx, buildingId, level);
        return check.ok || check.reason === 'cost';
      });
  }

  /** Scroll to the nearest level that can take it, unless one is in view already. */
  function reveal(state, ctx, buildingId) {
    const vp = view.viewport;
    const homes = homesFor(state, ctx, buildingId);
    if (!homes.length) return;
    const inView = (level) => level >= vp.topLevel && level + 1 <= vp.topLevel + vp.visibleLevels;
    if (homes.some(inView)) return;
    const centre = vp.topLevel + vp.visibleLevels / 2 - 0.5;
    const nearest = homes.reduce((a, b) => (Math.abs(b - centre) < Math.abs(a - centre) ? b : a));
    target = nearest + 0.5 - vp.visibleLevels / 2;
  }

  /** The popover, beside the pointer and kept inside the shaft's box. */
  function showTip(text) {
    tip.hidden = !text;
    if (!text) return;
    if (tip.textContent !== text) tip.textContent = text;
    const box = root.getBoundingClientRect();
    const x = Math.min(pointer.x - box.left + 14, box.width - tip.offsetWidth - 8);
    const y = pointer.y - box.top + 18;
    tip.style.transform = `translate(${Math.max(8, Math.round(x))}px, ${Math.round(y + tip.offsetHeight > box.height - 8 ? y - tip.offsetHeight - 30 : y)}px)`;
  }

  return {
    /** Per frame, before the viewBox is set: the scroll, then the ghost. */
    update(state, ctx) {
      const { placing } = selection.get();
      view.svg.classList.toggle('placing', Boolean(placing));
      if (placing !== shownFor) {
        shownFor = placing;
        target = null;
        if (placing) reveal(state, ctx, placing);
      }

      if (target !== null) {
        const vp = view.viewport;
        const before = vp.topLevel;
        const step = (target - vp.topLevel) * 0.2;
        vp.topLevel += Math.abs(step) < 0.01 ? target - vp.topLevel : step;
        pan(vp, 0);
        // Arrived, or pinned against an end of the shaft short of the target.
        if (vp.topLevel === target || vp.topLevel === before) target = null;
      }

      const spot = placing ? spotAt(state, ctx, placing, pointer) : null;
      ghost.style.display = spot ? '' : 'none';
      showTip(spot && !spot.ok ? whyNot(state, ctx, placing, spot) : null);
      if (!spot) return;
      const r = roomRect({ level: spot.level, slot: spot.slot, slots: spot.width }, state.buildings);
      const art = view.art.rooms.get(placing);
      for (const node of [picture, plain, wash, edge]) {
        node.setAttribute('x', String(r.x));
        node.setAttribute('y', String(levelY(spot.level)));
        node.setAttribute('width', String(SLOT_WIDTH * spot.width));
        node.setAttribute('height', String(ROOM_HEIGHT));
      }
      if (art) picture.setAttribute('href', art.on);
      picture.style.display = art ? '' : 'none';
      plain.style.display = art ? 'none' : '';
      wash.style.display = spot.ok ? 'none' : '';
      ghost.classList.toggle('blocked', !spot.ok);
      ghost.dataset.reason = spot.reason ?? '';
    },

    /**
     * A click while placing: build if the spot is good. Always consumes the
     * click, so a room under the ghost is never opened by accident.
     */
    pick(state, ctx, event) {
      const { placing } = selection.get();
      const spot = spotAt(state, ctx, placing, { x: event.clientX, y: event.clientY });
      if (!spot?.ok) return true;
      dispatch({ type: 'player:placeBuilding', buildingId: placing, level: spot.level, slot: spot.slot });
      if (!event.shiftKey) selection.place(null);
      return true;
    },

    /** The player took the view: stop scrolling for them. */
    cancelScroll() {
      target = null;
    },
  };
}

/** Why a building cannot go at a spot, in a sentence. */
function whyNot(state, ctx, buildingId, spot) {
  const def = ctx.catalog.buildings.byId[buildingId];
  const bands = ctx.tables?.levels?.depthBands ?? [];
  switch (spot.reason) {
    case 'occupied':
      return 'Another room already stands here.';
    case 'no-room':
      return `${def.name} does not fit here.`;
    case 'wrong-depth': {
      const band = bands.find((b) => b.id === def.levelConstraint);
      const here = bands.find((b) => b.id === depthBandOf(ctx, spot.level));
      return band
        ? `${def.name} can only go on the ${band.name.toLowerCase()} (${band.fromLevel}–${band.toLevel ?? 'bottom'}); level ${spot.level} is in the ${here ? here.name.toLowerCase() : 'wrong band'}.`
        : `${def.name} cannot go at this depth.`;
    }
    case 'zone-full': {
      const cap = ctx.tables?.levels?.levelTemplate?.zoneAllowances?.[def.zone];
      return `Level ${spot.level} already has its ${cap} ${def.zone} slots in use.`;
    }
    case 'cost': {
      const short = (placement(state, ctx, buildingId, spot.level).cost ?? [])
        .filter((c) => inStorehouses(state, ctx, c.id) < c.qty)
        .map((c) => `${nameOf(ctx, c.id).toLowerCase()} (${Math.floor(inStorehouses(state, ctx, c.id))} of ${c.qty})`);
      return `Not enough in the stores: ${short.join(', ')}.`;
    }
    case 'system':
      return `${def.name} is part of the Shaft's government and cannot be built again.`;
    default:
      return `${def.name} cannot be built here.`;
  }
}
