/**
 * The score engine's data: the music library and the background score
 * (resources/assets/audio/).
 *
 * Sound is not testable here and is not tested. What is: every written theme
 * fills exactly the bars its chords span, every pattern is one bar long in its
 * meter, and every name a score uses exists. A score naming an instrument that
 * was renamed would otherwise play silence in that part, with no error.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseTheme, parseLine, names, melodyModes, themeOf } from '../../src/ui/audio/composer.js';
import { INSTRUMENTS, instrumentsFor } from '../../src/ui/audio/instruments.js';
import { resolveScore } from '../../src/ui/audio/music.js';

const asset = (path) => new URL(`../../resources/assets/${path}`, import.meta.url);
const read = (url) => JSON.parse(readFileSync(url, 'utf8'));

const manifest = read(asset('manifest.json'));
const libraryEntry = manifest.audio.find((a) => a.kind === 'music-library');
const library = read(asset(libraryEntry.path));
const scores = manifest.audio.filter((a) => a.kind === 'score');

test('the manifest lists the library and a background score, and both exist', () => {
  assert.ok(libraryEntry);
  assert.ok(scores.some((s) => s.id === 'background'));
  for (const entry of manifest.audio) assert.ok(existsSync(asset(entry.path)), entry.path);
});

test('every theme fills exactly the bars its chords span', () => {
  for (const name of names(library.themes)) {
    const theme = library.themes[name];
    assert.ok(library.meters[theme.meter], `${name}: unknown meter ${theme.meter}`);
    const parsed = parseTheme(theme, library.meters);
    assert.equal(parsed.steps, parsed.expected, `${name}: melody is ${parsed.steps} steps, chords span ${parsed.expected}`);
  }
});

test('every drum pattern is one bar in its meter, in the pattern alphabet', () => {
  for (const name of names(library.drums)) {
    const pattern = library.drums[name];
    if (!pattern) continue;
    const steps = library.meters[pattern.meter]?.steps;
    assert.ok(steps, `${name}: unknown meter ${pattern.meter}`);
    for (const [track, line] of Object.entries(pattern)) {
      if (track === 'meter') continue;
      assert.ok(['k', 's', 'r', 'h', 'o', 'sh', 't', 'T'].includes(track), `${name}: unknown track ${track}`);
      assert.equal(line.length, steps, `${name}.${track} is ${line.length} steps, not ${steps}`);
      assert.match(line, /^[Xxo?.]+$/, `${name}.${track}`);
    }
  }
});

test('every bass line is one bar for both bar lengths and starts on a note', () => {
  for (const name of names(library.bassPatterns)) {
    const lines = library.bassPatterns[name];
    if (!lines) continue;
    for (const steps of [16, 12]) {
      const line = lines[steps];
      assert.equal(line?.length, steps, `${name} has no ${steps}-step line`);
      assert.match(line, /^[0-9.-]+$/, name);
      assert.ok(parseLine(line).has(0), `${name}/${steps} is silent on the downbeat`);
    }
  }
});

test('every score names only things the library and the instruments have', () => {
  for (const entry of scores) {
    const s = resolveScore(library, read(asset(entry.path)));
    const check = (ok, what) => assert.ok(ok, `${entry.id}: ${what}`);
    check(library.scales[s.scale], `scale ${s.scale}`);
    check(library.meters[s.meter], `meter ${s.meter}`);
    check(s.progression in library.progressions, `progression ${s.progression}`);
    check(library.voicings.includes(s.voicing), `voicing ${s.voicing}`);
    check(melodyModes(library).includes(s.melody), `melody ${s.melody}`);
    check(library.harmonies.includes(s.harmony), `harmony ${s.harmony}`);
    check(instrumentsFor('pad').includes(s.padInst), `pad ${s.padInst}`);
    check(instrumentsFor('lead').includes(s.leadInst), `lead ${s.leadInst}`);
    check(instrumentsFor('bass').includes(s.bassInst), `bass ${s.bassInst}`);
    check(instrumentsFor('arp').includes(s.arpInst), `arpeggio ${s.arpInst}`);
    check(s.bassPattern in library.bassPatterns, `bass line ${s.bassPattern}`);
    check(library.arpPatterns.includes(s.arpPattern), `arp shape ${s.arpPattern}`);
    check(library.arpRates.includes(s.arpRate), `arp rate ${s.arpRate}`);
    check(s.drums in library.drums, `drums ${s.drums}`);
    check(library.kits[s.kit], `kit ${s.kit}`);
    check(library.textures[s.texture], `texture ${s.texture}`);
    const drums = library.drums[s.drums];
    const meter = themeOf(library, s)?.meter ?? s.meter;
    if (drums) check(drums.meter === meter, `drums ${s.drums} are ${drums.meter}, the score is ${meter}`);
  }
});

test('every instrument has a role and a trim for each role', () => {
  for (const [name, inst] of Object.entries(INSTRUMENTS)) {
    assert.ok(inst.roles.length, name);
    for (const role of inst.roles) assert.ok(inst.trim[role] > 0, `${name} has no trim as ${role}`);
  }
});
