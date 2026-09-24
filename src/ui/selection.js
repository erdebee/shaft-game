/**
 * selection.js
 * What the player has picked in the shaft: a building to inspect, or a level
 * to build on — and, while a porter's route is being edited, which porter.
 * UI state, not game state — it is never saved and never replayed, because
 * choosing to look at something changes nothing.
 *
 * While `editing` names a porter, a click on a building in the shaft offers
 * to add it to that porter's route (src/ui/view/shaftView.js) instead of
 * opening it in the inspector.
 *
 * `follow` names a porter the shaft view keeps centred on, until the player
 * pans the view themselves.
 *
 * `placing` names a building the player has picked from the Build tab and is
 * now putting down: the shaft shows its ghost under the pointer and a click
 * on a free slot builds it there (src/ui/view/placeLayer.js).
 *
 * `network` names the network the Infrastructure panel has open: the shaft
 * draws it (view/networkLayer.js), and a click on one of its nodes starts
 * or finishes a link from `linkFrom` instead of opening the inspector.
 */

let current = { instanceId: null, level: null, editing: null, follow: null, placing: null, network: null, linkFrom: null };
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

/**
 * Start editing a porter's route, or stop with null. `follow` also brings the
 * porter into view and keeps them there.
 */
export function editRoute(workerId, { follow = false } = {}) {
  current = { ...current, editing: workerId, follow: workerId && follow ? workerId : null };
  notify('route');
}

/**
 * Stop following a porter: the player has taken the view. Quiet on purpose —
 * nothing listening cares, and a notify would pull the panel back to Inspect
 * every time the player scrolled.
 */
export function stopFollowing() {
  current = { ...current, follow: null };
}

/**
 * Start putting a building down, or stop with null. Quiet, like
 * stopFollowing: the Build tab and the shaft read it every frame, and a
 * notify would pull the panel over to whatever was selected before.
 */
export function place(buildingId) {
  current = { ...current, placing: buildingId };
}

/** Open a network in the shaft, or close it with null. Drops any half-laid link. */
export function showNetwork(networkId) {
  if (current.network === networkId && current.linkFrom === null) return;
  current = { ...current, network: networkId, linkFrom: null };
  notify('network');
}

/** Start a link from a node, or drop the half-laid one with null. */
export function startLink(instanceId) {
  if (current.linkFrom === instanceId) return;
  current = { ...current, linkFrom: instanceId };
  notify('network');
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Listeners hear what changed: 'select', 'route' or 'network'. */
function notify(kind = 'select') {
  for (const fn of listeners) fn(current, kind);
}
