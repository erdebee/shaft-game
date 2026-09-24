/**
 * Resource icons: the 16x16 pixel icons the shaft view's shortage popover and
 * the porters' bubbles draw (tools/resourceIcons.mjs).
 *
 * The invariant is coverage. A room that has run out of something shows an
 * icon; a good with no icon falls back to two letters in a box, which is a
 * legible stand-in and an ugly one. A good added to the catalogue without an
 * icon should therefore fail here, at the moment it is added, rather than
 * turning up as "AC" on somebody's scrubber bank.
 *
 * The drawing itself is not testable and is not tested. The file's size,
 * its existence, and the fact that it draws SOMETHING are.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode } from '../../tools/png.mjs';

const asset = (path) => new URL(`../../resources/assets/${path}`, import.meta.url);
const data = (path) => new URL(`../../resources/data/${path}`, import.meta.url);
const read = (url) => JSON.parse(readFileSync(url, 'utf8'));

const manifest = read(asset('manifest.json'));
const icons = new Map(manifest.icons.map((i) => [i.id, i]));

const catalogue = {
  stocks: read(data('catalog/resources/stocks.json')).stocks,
  minerals: read(data('catalog/resources/minerals.json')).minerals,
  components: read(data('catalog/resources/components.json')).components,
  flows: read(data('catalog/resources/flows.json')).flows,
  abstracts: read(data('catalog/resources/abstracts.json')).abstracts,
};
const goods = [...catalogue.stocks, ...catalogue.minerals, ...catalogue.components].map((r) => r.id);
const everything = Object.values(catalogue).flat().map((r) => r.id);

test('every good a porter can carry has an icon', () => {
  const missing = goods.filter((id) => !icons.has(id));
  assert.deepEqual(missing, [], `no icon for: ${missing.join(', ')}`);
});

test('every flow and abstract has one too, so the set is the whole catalogue', () => {
  const missing = everything.filter((id) => !icons.has(id));
  assert.deepEqual(missing, [], `no icon for: ${missing.join(', ')}`);
});

test('every icon names a resource that exists', () => {
  const orphans = [...icons.keys()].filter((id) => !everything.includes(id));
  assert.deepEqual(orphans, [], `icons for nothing: ${orphans.join(', ')}`);
});

test('an icon is 16x16, loads at boot, and has something drawn on it', () => {
  for (const entry of manifest.icons) {
    assert.equal(entry.w, 16, `${entry.id}: declared width`);
    assert.equal(entry.h, 16, `${entry.id}: declared height`);
    assert.equal(entry.preloadGroup, 'boot',
      `${entry.id}: a porter can pick a good up on the first tick, so icons cannot stream in late`);
    assert.equal(entry.path, `sprites/icons/${entry.id}.png`);

    const png = decode(readFileSync(asset(entry.path)));
    assert.equal(png.width, 16, `${entry.id}: actual width`);
    assert.equal(png.height, 16, `${entry.id}: actual height`);

    let opaque = 0;
    for (let i = 3; i < png.pixels.length; i += 4) if (png.pixels[i] > 0) opaque++;
    assert.ok(opaque > 40, `${entry.id}: only ${opaque} pixels drawn — that is not an icon`);
    assert.ok(opaque < 256, `${entry.id}: an icon with no transparent margin will not sit on a plate`);
  }
});

test('every resource has the text its card shows: a description and a quote', () => {
  // The card that opens over an icon (ui/components/resourceTip.js) reads
  // these straight from the catalogue. A resource without them opens a card
  // with a name and numbers and nothing to say about what the thing is.
  const bare = Object.values(catalogue).flat()
    .filter((r) => !(typeof r.description === 'string' && r.description.length > 20
      && typeof r.quote?.text === 'string' && r.quote.text.length > 0
      && typeof r.quote?.by === 'string' && r.quote.by.length > 0))
    .map((r) => r.id);
  assert.deepEqual(bare, [], `no description or quote for: ${bare.join(', ')}`);
});
