/**
 * icons.js
 * The goods icons and room renders, for the panels. The shaft view gets them with the rest of
 * the room art (view/roomArt.js); main.js hands the same Map over here once
 * it is loaded, so a panel can show a good's icon without fetching the
 * manifest again.
 */

let icons = new Map();
let rooms = new Map();

export function setIcons(map) {
  icons = map ?? new Map();
}

/** The room renders, by building id, for the Build tab's thumbnails. */
export function setRooms(map) {
  rooms = map ?? new Map();
}

/** A building's lit render (`href`), or null if it has none yet. */
export function roomOf(id) {
  const art = rooms.get(id);
  return art ? { href: art.on } : null;
}

/** The icon for a good, `{ href, w, h }`, or null if it has none yet. */
export function iconOf(id) {
  return icons.get(id) ?? null;
}
