/**
 * Data layer integrity.
 * Loads resources/data/ through the real contentLoader and checks the things
 * that are cheap to verify and expensive to debug: every file parses, every
 * manifest path exists, every tunable is declared, every id is unique and
 * kebab-case, every cross-reference resolves, and every effect op and
 * predicate is in the vocabulary.
 *
 * This is the test that makes "content is data" safe. Without it a typo in a
 * dilemma's target is a silent no-op that shows up as a balance mystery.
 *
 * The helpers under test are the loader's own — the browser and this test
 * exercise the same code path, so a green run here means the game can boot.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TUNABLES } from '../../src/config/schema.js';
import {
  manifestPaths,
  entitiesOf,
  buildDataset,
  loadDataset,
} from '../../src/config/contentLoader.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../resources/data');
const read = (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));
const readJson = async (rel) => read(rel);

const manifest = read('manifest.json');
const paths = manifestPaths(manifest);

/** The dataset as the game boots it, for the checks that need it whole. */
function dataset(selection = {}) {
  const docs = new Map(paths.map((p) => [p, read(p)]));
  return buildDataset(manifest, docs, selection);
}

test('every path in the manifest exists and parses', () => {
  assert.ok(paths.length > 20, `expected a populated manifest, found ${paths.length} paths`);
  for (const p of paths) {
    assert.ok(existsSync(join(DATA, p)), `manifest references missing file: ${p}`);
    assert.doesNotThrow(() => read(p), `invalid JSON: ${p}`);
  }
});

test('the dataset loads clean for every chapter and profile', async () => {
  for (const chapter of Object.keys(manifest.config.chapters)) {
    for (const profile of Object.keys(manifest.config.profiles)) {
      const ds = dataset({ chapter: Number(chapter), profile });
      assert.deepEqual(
        ds.errors,
        [],
        `chapter ${chapter} / profile ${profile}:\n${ds.errors.join('\n')}`,
      );
    }
  }
  // loadDataset throws on any error, so reaching past it is the assertion.
  const ds = await loadDataset({ readJson, chapter: 1, profile: 'default' });
  assert.ok(ds.configHash, 'expected a config hash');
  assert.equal(typeof ds.config.clock.tickMs, 'number');
});

test('base.json declares every tunable the schema knows about', () => {
  const base = read(manifest.config.base);
  const declared = new Set();
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_')) continue;
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, path);
      else declared.add(path);
    }
  };
  walk(base, '');

  // structure.levels comes from the shaft profile, not base.
  const missing = Object.keys(TUNABLES).filter((k) => !declared.has(k) && k !== 'structure.levels');
  assert.deepEqual(missing, [], `tunables with no base default:\n${missing.join('\n')}`);
});

test('later layers override earlier ones, with provenance recorded', () => {
  const ds = dataset({ chapter: 2, profile: 'default' });
  // chapter2.json sets water.reclamationEfficiency = 0.62 over base's 0.68.
  assert.equal(ds.config.water.reclamationEfficiency, 0.62);
  assert.equal(ds.provenance['water.reclamationEfficiency'], 'chapter');
  // Untouched by any override layer, so it stays attributed to base.
  assert.equal(ds.provenance['clock.tickMs'], 'base');
});

test('catalog patches apply by id without redefining the entity', () => {
  const ch1 = dataset({ chapter: 1 });
  const ch2 = dataset({ chapter: 2 });

  // chapter2.json patches scrubber-bank's consumes list.
  const s1 = ch1.catalog.buildings.byId['scrubber-bank'];
  const s2 = ch2.catalog.buildings.byId['scrubber-bank'];
  assert.equal(s2.consumes.find((c) => c.id === 'scrubber-catalyst').qty, 2);
  // Fields the patch did not name survive untouched.
  assert.equal(s2.powerDraw, s1.powerDraw);
  assert.equal(s2.zone, 'air');

  // board-doubt is disabled in Chapter 1 and enabled in Chapter 2.
  assert.equal(ch1.catalog.meters.byId['board-doubt'].enabled, false);
  assert.equal(ch2.catalog.meters.byId['board-doubt'].enabled, true);
});

test('ids are unique and kebab-case in every collection', () => {
  const ds = dataset();
  const bad = [];
  for (const tier of ['catalog', 'content']) {
    for (const [name, collection] of Object.entries(ds[tier])) {
      const ids = collection.ids;
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      assert.deepEqual([...new Set(dupes)], [], `duplicate ids in ${name}`);
      for (const id of ids) {
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) bad.push(`${name}: ${id}`);
      }
    }
  }
  assert.deepEqual(bad, [], `non-kebab-case ids:\n${bad.join('\n')}`);
});

test('the scrubber catalyst has no local recipe', () => {
  const recipes = entitiesOf(read('catalog/resources/recipes.json'));
  const producesCatalyst = recipes.some((r) =>
    (r.outputs ?? []).some((o) => o.id === 'scrubber-catalyst'),
  );
  assert.equal(
    producesCatalyst,
    false,
    'A recipe now produces scrubber-catalyst. That gap is the Chapter 2 coup lever — see README, "the one thread to be careful with". Changing it is a narrative decision, not a balance tweak.',
  );
});

test('the Nexus never says "Shaft"', () => {
  for (const p of [...manifest.content.directives, ...manifest.content.mandateClauses]) {
    const raw = readFileSync(join(DATA, p), 'utf8');
    raw.split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('"_')) return; // author notes may discuss it
      assert.ok(
        !/\bshafts?\b/i.test(line),
        `${p}:${i + 1} — the Nexus and the Core Mandate say "Facility", never "Shaft". This is a story beat, not a synonym.`,
      );
    });
  }
});

test('no file reintroduces the term "silo"', () => {
  for (const p of paths) {
    const raw = readFileSync(join(DATA, p), 'utf8');
    assert.ok(!/silo/i.test(raw), `${p} contains "silo" — not project vocabulary, see CONVENTIONS.md §1`);
  }
});
