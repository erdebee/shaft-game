/**
 * hash.js
 * Stable, order-independent hashing of plain data. Used for the config hash a
 * save records, and for comparing two game states in the determinism tests.
 *
 * Object keys are sorted before serialising, so two states that differ only in
 * key insertion order hash the same — otherwise a harmless refactor that
 * reorders a state field would read as a determinism failure.
 */

/** Deterministic JSON: object keys sorted, arrays kept in order. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** FNV-1a over a string. Not cryptographic — a fingerprint, not a signature. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Fingerprint any plain-data value. */
export function hashData(value) {
  return hashString(stableStringify(value));
}
