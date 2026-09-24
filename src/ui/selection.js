/**
 * selection.js
 * What the player has picked in the shaft: a building to inspect, or a level
 * to build on — and, while a route is being edited, which route.
 * UI state, not game state — it is never saved and never replayed, because
 * choosing to look at something changes nothing.
 *
 * While `editing` names a route, a click on a building in the shaft offers
 * to add it to that route (src/ui/view/shaftView.js) instead of
 * opening it in the inspector.
 *
 * `viewing` names a route the player is only looking at, from the Routes
 * list: the shaft and the minimap draw it as they draw one being edited, but
 * the list stays in the panel and the first click in the shaft closes it.
 * Opening a route in the editor ends the viewing.
 *
 * `follow` names a porter the shaft view keeps centred on, until the player
 * pans the view themselves.
 *
 * `placing` names a building the player has picked from the Build tab and is
 * now putting down: the shaft shows its ghost under the pointer and a click
 * on a free slot builds it there (src/ui/view/placeLayer.js).
 *
 * `network` names the network the Infrastructure panel has open: the shaft
 * draws it and the other lines on its page (view/networkLayer.js), with
 * every socket on them. A click on a free socket starts a link, held in
 * `linkFrom` as { instanceId, network, socket } — or, from a joint on a
 * pipe, as { network, tap } — and a click on a second socket (or a room
 * with one free, or a run to tee into) finishes it.
 *
 * `highlight` names a link the player has picked out in the shaft: it is
 * drawn lit there and on the minimap, and its sockets offer to take it out.
 */

let current = { instanceId: null, level: null, editing: null, viewing: null, follow: null, placing: null, network: null, linkFrom: null, highlight: null };
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
 * Start editing a route, or stop with null. `follow` names a porter to bring
 * into view and keep there.
 */
export function editRoute(routeId, { follow = null } = {}) {
  current = { ...current, editing: routeId, viewing: null, follow: routeId ? follow : null };
  notify('route');
}

/**
 * Show a route in the shaft without opening it, or stop with null. Asking to
 * view the route already shown stops showing it.
 */
export function viewRoute(routeId) {
  const next = routeId && routeId === current.viewing ? null : routeId;
  if (next === current.viewing) return;
  current = { ...current, viewing: next };
  notify('view');
}

/** The route the shaft draws: the one being edited, or else the one viewed. */
export function shownRoute() {
  return current.editing ?? current.viewing;
}

/** Follow a porter in the shaft, or nobody with null, without opening anything. */
export function followPorter(workerId) {
  current = { ...current, follow: workerId };
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
  current = { ...current, network: networkId, linkFrom: null, highlight: null };
  notify('network');
}

/**
 * Start a link from a socket — { instanceId, network, socket } — or drop the
 * half-laid one with null. Starting one on another line of the page opens
 * that line.
 */
export function startLink(from) {
  const same = (a, b) => a === b || (!!a && !!b && a.instanceId === b.instanceId && a.network === b.network
    && a.socket === b.socket && a.tap === b.tap);
  if (same(current.linkFrom, from)) return;
  current = { ...current, network: from?.network ?? current.network, linkFrom: from, highlight: from ? null : current.highlight };
  notify('network');
}

/** Pick out a link in the shaft, or let it go with null. */
export function highlightLink(linkId) {
  if (current.highlight === linkId) return;
  current = { ...current, highlight: linkId };
  notify('network');
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Listeners hear what changed: 'select', 'route', 'view' or 'network'. */
function notify(kind = 'select') {
  for (const fn of listeners) fn(current, kind);
}
