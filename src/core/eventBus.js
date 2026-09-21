/**
 * eventBus.js
 * Pub/sub channel connecting systems without direct imports between them.
 * Governance publishes law changes, resources publish shortfalls, narrative
 * listens for both. Keeps chapter logic out of the simulation systems.
 */

const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => off(event, handler);
}

export function off(event, handler) {
  listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  for (const handler of listeners.get(event) ?? []) {
    handler(payload, event);
  }
  for (const handler of listeners.get('*') ?? []) {
    handler(payload, event);
  }
}

export function clear() {
  listeners.clear();
}
