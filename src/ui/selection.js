/**
 * selection.js
 * What the player has picked in the shaft: a building to inspect, or a level
 * to build on. UI state, not game state — it is never saved and never
 * replayed, because choosing to look at something changes nothing.
 */

let current = { instanceId: null, level: null };
const listeners = new Set();

export function get() {
  return current;
}

/** Pick a building (which also picks its level) or, with no id, a level. */
export function select({ instanceId = null, level = null }) {
  current = { instanceId, level };
  for (const fn of listeners) fn(current);
}

export function clear() {
  select({});
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
