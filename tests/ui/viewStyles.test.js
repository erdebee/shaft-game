/**
 * View style invariants.
 *
 * The view splits one concern across two nodes on purpose:
 *
 *   the wrapper <g>        POSITION, written by JS as a transform attribute
 *   the inner .figure-sprite  ANIMATION, written by CSS
 *
 * A CSS `transform` overrides an SVG `transform` attribute, so animating
 * `transform` on the positioned wrapper replaces its position. Worse, a
 * keyframe that only defines 50% takes the attribute value at 0% and 100%, so
 * the figure interpolates smoothly between where it belongs and the SVG
 * origin — figures appear to fly diagonally to the top-left corner and back,
 * once per cycle. It reads as a physics bug and is a cascade bug.
 *
 * This is a pure text check on the stylesheet rather than a rendering test,
 * because the failure is a rule that should not exist. Node cannot compute
 * styles, but it can read the rule that would cause them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(join(ROOT, 'src/ui/styles/screens.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ''); // comments may legitimately discuss this

/** Flat list of { selectors: string[], body: string }, ignoring at-rule wrappers. */
function rules(source) {
  const out = [];
  // Strip at-rule braces so nested rules are still seen as rules.
  const flat = source.replace(/@[a-z-]+[^{]*\{/gi, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(flat)) !== null) {
    const selectors = match[1].split(',').map((s) => s.trim()).filter(Boolean);
    out.push({ selectors, body: match[2] });
  }
  return out;
}

/** Classes whose transform is owned by JS and must never be animated in CSS. */
const POSITIONED = ['figure', 'figure-porter', 'figure-worker'];

/** True when the rule's subject (its rightmost compound) is a positioned wrapper. */
function targetsWrapper(selector) {
  const subject = selector.trim().split(/[\s>+~]+/).pop() ?? '';
  const classes = [...subject.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
  return classes.some((c) => POSITIONED.includes(c));
}

test('no CSS rule sets transform or animation on a JS-positioned figure wrapper', () => {
  const offenders = [];

  for (const rule of rules(css)) {
    const declares = /(^|;)\s*(transform|animation)(-[a-z]+)?\s*:/i.test(rule.body);
    if (!declares) continue;

    for (const selector of rule.selectors) {
      if (targetsWrapper(selector)) {
        offenders.push(`${selector} { ${rule.body.trim().replace(/\s+/g, ' ')} }`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'These rules animate or transform a figure wrapper, whose transform attribute is ' +
      'written by src/ui/view/figures.js. CSS transform wins over the attribute, so the ' +
      'figure will slide toward the SVG origin. Move the declaration to .figure-sprite:\n' +
      offenders.join('\n'),
  );
});

test('ambient figure animation is declared on the inner sprite', () => {
  const animated = rules(css).filter(
    (r) => /(^|;)\s*animation\s*:/i.test(r.body) &&
      r.selectors.some((s) => s.includes('figure')),
  );
  assert.ok(
    animated.length > 0,
    'expected at least one ambient figure animation — has it been removed?',
  );
  for (const rule of animated) {
    for (const selector of rule.selectors) {
      if (!selector.includes('figure')) continue;
      assert.match(
        selector.trim().split(/[\s>+~]+/).pop(),
        /\.figure-sprite/,
        `figure animation must target .figure-sprite, not "${selector.trim()}"`,
      );
    }
  }
});

test('paused state stops ambient animation via the sprite, not the wrapper', () => {
  assert.match(
    css,
    /\.shaft\.paused\s+\.figure-sprite\s*\{[^}]*animation-play-state:\s*paused/,
    'pausing the clock must also pause ambient figure animation (.shaft.paused .figure-sprite)',
  );
});
