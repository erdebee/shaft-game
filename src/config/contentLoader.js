/**
 * contentLoader.js
 * Turns resources/data/ into the frozen dataset the engine reads.
 *
 * There is no build step and no directory listing over fetch(), so
 * manifest.json is the entry point: one read tells us every other file to read.
 *
 * Three tiers, three merge behaviours (CONVENTIONS.md §2):
 *   config/   scalar tunables, dot-path merged by configLoader.resolve()
 *   catalog/  entity definitions, patched by id from each layer's `patch` block
 *   content/  narrative payloads, additive, self-gating on chapter/preconditions
 *
 * Reading is separated from building so the same logic serves the browser
 * (fetch) and the Node tests (fs). buildDataset() is pure.
 */

import { resolve } from './configLoader.js';
import { validateEffects, validatePredicate, REFS, RESOURCE_CATALOGUES } from './schema.js';
import { hashData } from '../utils/hash.js';

/**
 * The collection inside a data file: the one non-underscore key holding an
 * array. Lets every file name its collection for what it contains
 * ("buildings", "dilemmas") without the loader needing to know the name.
 */
export function entitiesOf(doc) {
  const key = Object.keys(doc).find((k) => !k.startsWith('_') && Array.isArray(doc[k]));
  return key ? doc[key] : [];
}

/** Every .json path the manifest references, in declaration order. */
export function manifestPaths(manifest) {
  const paths = [];
  const walk = (node) => {
    if (typeof node === 'string' && node.endsWith('.json')) paths.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) if (!k.startsWith('_')) walk(v);
    }
  };
  walk(manifest.config);
  walk(manifest.catalog);
  walk(manifest.content);
  walk(manifest.tables);
  return paths;
}

/** Collections in a manifest group, skipping documentation keys. */
function groupEntries(group) {
  return Object.entries(group ?? {}).filter(([k, v]) => !k.startsWith('_') && Array.isArray(v));
}

/**
 * Build the dataset from already-parsed documents. Pure.
 *
 * @param {object} manifest parsed manifest.json
 * @param {Map<string, object>} docs path -> parsed JSON, covering manifestPaths()
 * @param {{chapter?: number, profile?: string, sandbox?: boolean}} selection
 */
export function buildDataset(manifest, docs, selection = {}) {
  const { chapter = 1, profile = 'default', sandbox = true } = selection;
  const get = (path) => {
    const doc = docs.get(path);
    if (!doc) throw new Error(`contentLoader: manifest path not loaded: ${path}`);
    return doc;
  };

  // --- config tier -----------------------------------------------------
  const layers = { base: get(manifest.config.base) };
  const chapterPath = manifest.config.chapters?.[String(chapter)];
  if (chapterPath) layers.chapter = get(chapterPath);
  const profilePath = manifest.config.profiles?.[profile];
  if (profilePath) layers.shaft = get(profilePath);
  if (sandbox && manifest.config.sandbox) layers.sandbox = get(manifest.config.sandbox);

  const { resolved: config, provenance, errors: configErrors } = resolve(layers);

  // The shaft profile's layout and veins are structure, not scalars — they are
  // read straight off the profile rather than merged into config.
  const shaftProfile = profilePath ? get(profilePath) : {};
  const shaft = {
    id: shaftProfile.id ?? profile,
    name: shaftProfile.name ?? '',
    facilityNumber: shaftProfile.facilityNumber ?? null,
    layout: shaftProfile.layout ?? {},
    veins: shaftProfile.veins ?? [],
    startingStocks: stripNotes(shaftProfile.startingStocks ?? {}),
    opening: shaftProfile.opening?.buildings ?? [],
  };

  // --- catalog tier ----------------------------------------------------
  const catalog = {};
  for (const [name, paths] of groupEntries(manifest.catalog)) {
    catalog[name] = indexById(paths.flatMap((p) => entitiesOf(get(p))));
  }
  const patchErrors = applyPatches(catalog, layers);

  // --- content tier ----------------------------------------------------
  const content = {};
  for (const [name, paths] of groupEntries(manifest.content)) {
    content[name] = indexById(paths.flatMap((p) => entitiesOf(get(p))));
  }

  // --- tables tier -----------------------------------------------------
  // Lookup tables, loaded verbatim: pools and maps rather than entities with
  // ids, so id-indexing and cross-reference checking do not apply.
  const tables = {};
  for (const [name, path] of Object.entries(manifest.tables ?? {})) {
    if (name.startsWith('_')) continue;
    tables[name] = get(path);
  }

  const dataset = { config, provenance, shaft, catalog, content, tables };
  const errors = [
    ...configErrors,
    ...patchErrors,
    ...checkRefs(dataset),
    ...checkVocabularies(dataset),
  ];

  dataset.configHash = hashData(config);
  dataset.errors = errors;
  return dataset;
}

/** Read everything the manifest names, then build. */
export async function loadDataset({ root = './resources/data', readJson, ...selection } = {}) {
  const read = readJson ?? (async (p) => {
    // 'no-cache' revalidates rather than refetching: cheap when the file is
    // unchanged, and correct when it is not. Without it the browser serves a
    // stale copy, so editing a data file and reloading shows the old values —
    // a nasty trap in a project with no build step to invalidate anything.
    const res = await fetch(`${root}/${p}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Data file not found: ${p}`);
    return res.json();
  });

  const manifest = await read('manifest.json');
  const paths = manifestPaths(manifest);
  const docs = new Map();
  // Sequential rather than parallel: deterministic failure order, and a
  // 47-file cold load is not the bottleneck worth optimising.
  for (const p of paths) docs.set(p, await read(p));

  const dataset = buildDataset(manifest, docs, selection);
  if (dataset.errors.length) {
    throw new Error(`Data validation failed:\n${dataset.errors.join('\n')}`);
  }
  return dataset;
}

/**
 * Index entities by id, preserving declaration order in `ids` so that
 * iteration is explicit and stable (CONVENTIONS.md, determinism principle 8).
 */
function indexById(entities) {
  const byId = {};
  const ids = [];
  for (const entity of entities) {
    const id = entity.id ?? entity.memberId;
    if (!id) continue;
    byId[id] = entity;
    ids.push(id);
  }
  return { byId, ids, all: entities };
}

/**
 * Apply each layer's `patch` block to catalog entities by id. Field-level
 * override only — a patch never redefines a whole entity, and never merges
 * arrays element-wise.
 */
function applyPatches(catalog, layers) {
  const errors = [];
  for (const [layerName, layer] of Object.entries(layers)) {
    for (const [collection, patches] of Object.entries(layer.patch ?? {})) {
      if (collection.startsWith('_')) continue;
      if (!catalog[collection]) {
        errors.push(`[${layerName}] patch targets unknown catalogue "${collection}"`);
        continue;
      }
      for (const [id, fields] of Object.entries(patches)) {
        if (id.startsWith('_')) continue;
        const entity = catalog[collection].byId[id];
        if (!entity) {
          errors.push(`[${layerName}] patch targets unknown ${collection} id "${id}"`);
          continue;
        }
        for (const [key, value] of Object.entries(fields)) {
          if (key.startsWith('_')) continue;
          entity[key] = value;
        }
      }
    }
  }
  return errors;
}

/** Drop `_`-prefixed documentation keys from a plain data block. */
function stripNotes(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

/** Ids valid for a REFS target, expanding the 'any-resource' pseudo-catalogue. */
function idsFor(dataset, target) {
  if (target === 'any-resource') {
    const ids = new Set();
    for (const c of RESOURCE_CATALOGUES) {
      for (const id of dataset.catalog[c]?.ids ?? []) ids.add(id);
    }
    return ids;
  }
  const collection = dataset.catalog[target] ?? dataset.content[target];
  return new Set(collection?.ids ?? []);
}

/** Resolve a ref path like "inputs[].id" or "controls[]" against an entity. */
export function extractRef(entity, field) {
  if (field.includes('[].')) {
    const [arrayKey, prop] = field.split('[].');
    return (entity[arrayKey] ?? []).map((x) => x?.[prop]);
  }
  if (field.endsWith('[]')) return entity[field.slice(0, -2)] ?? [];
  return [entity[field]];
}

/** Every id reference in REFS must resolve, after all patches are applied. */
export function checkRefs(dataset) {
  const errors = [];
  for (const [collection, rules] of Object.entries(REFS)) {
    const entities = dataset.catalog[collection]?.all ?? dataset.content[collection]?.all ?? [];
    for (const entity of entities) {
      for (const [field, target] of Object.entries(rules)) {
        if (target === null) continue;
        const valid = idsFor(dataset, target);
        for (const value of extractRef(entity, field)) {
          if (value === null || value === undefined) continue;
          if (!valid.has(value)) {
            const id = entity.id ?? entity.memberId;
            errors.push(`${collection}/${id}: ${field} -> "${value}" not found in ${target}`);
          }
        }
      }
    }
  }
  return errors;
}

/** Every effect op and predicate used anywhere must be declared in schema.js. */
export function checkVocabularies(dataset) {
  const errors = [];
  for (const tier of ['catalog', 'content']) {
    for (const [name, collection] of Object.entries(dataset[tier])) {
      for (const list of collectKeyed(collection.all, 'op')) {
        errors.push(...validateEffects(list, `${tier}/${name}`).errors);
      }
      for (const pred of collectKeyed(collection.all, 'pred', true)) {
        errors.push(...validatePredicate(pred, `${tier}/${name}`).errors);
      }
    }
  }
  return [...new Set(errors)];
}

/**
 * Find every effect list (arrays whose members carry `op`) or predicate object
 * (any object carrying `pred`) at any depth. `_`-prefixed keys are author
 * notes and are skipped, so a note discussing an op is not mistaken for one.
 */
function collectKeyed(node, key, wantObjects = false, out = []) {
  if (Array.isArray(node)) {
    if (!wantObjects && node.some((x) => x && typeof x === 'object' && key in x)) out.push(node);
    node.forEach((n) => collectKeyed(n, key, wantObjects, out));
  } else if (node && typeof node === 'object') {
    if (wantObjects && key in node) out.push(node);
    for (const [k, v] of Object.entries(node)) {
      if (!k.startsWith('_')) collectKeyed(v, key, wantObjects, out);
    }
  }
  return out;
}
