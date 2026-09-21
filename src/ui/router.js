/**
 * router.js
 * Screen switching. No history API — this is an application shell, not pages.
 *
 * A screen is `{ mount(root, state, ctx, dispatch) -> { update(state, ctx) } }`,
 * matching the shape the screen stubs already use. Only the active screen is
 * updated, so an off-screen panel costs nothing per frame.
 */

const screens = new Map();
let active = null;
let host = null;
let deps = null;

export function attach(root, { state, ctx, dispatch }) {
  host = root;
  deps = { state, ctx, dispatch };
}

export function register(name, screen) {
  screens.set(name, screen);
}

export function go(name) {
  const screen = screens.get(name);
  if (!screen) throw new Error(`router: unknown screen "${name}"`);
  if (!host) throw new Error('router: attach() must be called before go()');

  active = { name, instance: screen.mount(host, deps.state, deps.ctx, deps.dispatch) };
  return active.instance;
}

/** Update the active screen. Called once per frame by the engine's loop. */
export function update(state, ctx) {
  active?.instance?.update?.(state, ctx);
}

export function current() {
  return active?.name ?? null;
}
