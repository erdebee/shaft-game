/**
 * selection.js
 * What the player has picked in the shaft: a building to inspect, or a level
 * to build on — and, while a porter's route is being edited, which porter.
 * UI state, not game state — it is never saved and never replayed, because
 * choosing to look at something changes nothing.
 *
 * While `editing` names a porter, a click on a building in the shaft adds it
 * to that porter's route (src/ui/screens/routeEditor.js) instead of opening
 * it in the inspector.
 */

let current = { instanceId: null, level: null, editing: null };
const listeners = new Set();

export function get() {
  return current;
}

/** Pick a building (which also picks its level) or, with no id, a level. */
export function select({ instanceId = null, level = null }) {
  current = { ...current, instanceId, level };
  notify();
}

export function clear() {
  select({});
}

/** Start editing a porter's route, or stop with null. */
export function editRoute(workerId) {
  current = { ...current, editing: workerId };
  notify();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(current);
}
