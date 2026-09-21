/**
 * configLoader.js
 * Resolves the layered configuration:
 *   base -> chapter/difficulty -> shaft profile -> mission -> event -> sandbox
 * Later layers override earlier ones key by key. Every resolved value keeps a
 * record of which layer supplied it, so the diff export can show what a
 * playtest build actually ran with.
 *
 * Only SCALAR TUNABLES are merged here. Catalog entities are patched by id and
 * content is additive — see contentLoader.js. Arrays are replaced wholesale,
 * never merged element by element, because index-based array merging across
 * layers is meaningless (CONVENTIONS.md §2).
 */

import { validate } from './schema.js';

export const LAYER_ORDER = ['base', 'chapter', 'shaft', 'mission', 'event', 'sandbox'];

/**
 * Deep-merge layers in LAYER_ORDER, recording provenance per key.
 *
 * Each layer may present its tunables either at the top level (as base.json
 * does) or nested under `tunables` alongside a `patch` block (as override
 * layers do). Both are accepted; `patch` blocks are ignored here.
 *
 * @param {Record<string, object>} layers keyed by layer name from LAYER_ORDER
 * @returns {{resolved: object, provenance: Record<string, string>, errors: string[]}}
 */
export function resolve(layers) {
  const resolved = {};
  const provenance = {};
  const errors = [];

  for (const layerName of LAYER_ORDER) {
    const layer = layers[layerName];
    if (!layer) continue;

    const tunables = tunablesOf(layer);
    const result = validate({ tunables }, layerName);
    errors.push(...result.errors);

    for (const [path, value] of Object.entries(flatten(tunables))) {
      setPath(resolved, path, value);
      provenance[path] = layerName;
    }
  }

  return { resolved, provenance, errors };
}

/**
 * A layer's tunables, whichever form it uses. Documentation keys and the
 * catalog `patch` block are stripped; so are the shaft profile's identity and
 * layout fields, which are read by contentLoader rather than merged as scalars.
 */
export function tunablesOf(layer) {
  if (layer.tunables) return layer.tunables;

  const NON_TUNABLE = new Set(['patch', 'tunables', 'id', 'name', 'facilityNumber', 'layout', 'veins']);
  const out = {};
  for (const [key, value] of Object.entries(layer)) {
    if (key.startsWith('_') || NON_TUNABLE.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Flatten nested objects to dot-paths. Arrays are leaves. */
export function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (key.startsWith('_')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

/** Write a dot-path into a nested object, creating intermediate objects. */
function setPath(target, path, value) {
  const parts = path.split('.');
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts.at(-1)] = value;
}

export async function loadLayer(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Config layer not found: ${path}`);
  return res.json();
}

/** Re-read layers and re-resolve without restarting the run. */
export async function hotReload(currentConfig, paths) {
  // TODO: reload, validate, emit 'config:reloaded' with a diff
}
