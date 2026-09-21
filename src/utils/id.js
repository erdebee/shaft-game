/** Deterministic id generation — must draw from a seeded stream, never Math.random. */

export function makeIdFactory(stream, prefix) {
  let n = 0;
  return () => `${prefix}_${(n++).toString(36)}_${stream.int(0, 1295).toString(36)}`;
}
