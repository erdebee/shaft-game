/**
 * viewport.js
 * What part of the shaft is on screen, and therefore what needs drawing.
 *
 * One mechanism answers four requirements at once. All geometry is authored in
 * shaft units (1:1 with sprite pixels); the viewBox maps a range of levels
 * onto whatever pixel box exists. So:
 *   - pan is a change of `topLevel`
 *   - zoom is a change of `scale`
 *   - culling is "which levels does the range cover"
 *
 * Zoom is INTEGER ONLY (asset-production-spec §1). Pixel art scaled by a
 * fractional factor shimmers, so the scale is a whole number of screen pixels
 * per sprite pixel and the visible area is derived from it: a bigger window
 * shows more levels, not bigger ones. The one exception is a host narrower
 * than the shaft at 1x, which fits the width instead so nothing is cut off.
 *
 * When the shaft is wider than the view it scrolls sideways too (`left`).
 */

import { LEVEL_HEIGHT, SHAFT_WIDTH, levelY } from './interpolate.js';

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

/** Fraction of the shaft width the default zoom may push out of view. */
const OVERFLOW_ALLOWANCE = 0.08;

export function createViewport({ levelCount, topLevel = 1 } = {}) {
  return {
    levelCount,
    topLevel,
    /** Screen pixels per sprite pixel. */
    scale: 1,
    /** The player's chosen scale, or null to take the largest that fits. */
    chosenScale: null,
    /** Visible area in shaft units, derived from the host size and scale. */
    viewWidth: SHAFT_WIDTH,
    /** Left edge in shaft units, used only when the shaft overflows the view. */
    left: 0,
    visibleLevels: 7,
    host: null,
  };
}

/**
 * The SVG viewBox string. Origins are rounded to whole sprite pixels so that,
 * at an integer scale, every sprite pixel lands on whole screen pixels even
 * mid-pan. The shaft is centred when the view is wider than it.
 */
export function viewBoxOf(viewport) {
  const spare = SHAFT_WIDTH - viewport.viewWidth;
  const x = spare <= 0 ? Math.round(spare / 2) : Math.round(clamp(viewport.left, 0, spare));
  const y = Math.round(levelY(viewport.topLevel));
  return `${x} ${y} ${viewport.viewWidth} ${viewport.visibleLevels * LEVEL_HEIGHT}`;
}

/**
 * Levels to draw: the visible range plus one row of margin either side, so
 * scrolling does not reveal an unpopulated edge.
 */
export function visibleRange(viewport) {
  const first = Math.max(1, Math.floor(viewport.topLevel) - 1);
  const last = Math.min(viewport.levelCount, Math.ceil(viewport.topLevel + viewport.visibleLevels) + 1);
  return { first, last };
}

export function isLevelVisible(viewport, level) {
  const { first, last } = visibleRange(viewport);
  return level >= first && level <= last;
}

/** Scroll sideways by shaft units; only has an effect when the shaft overflows. */
export function panX(viewport, deltaUnits) {
  viewport.left = clamp(viewport.left + deltaUnits, 0, Math.max(0, SHAFT_WIDTH - viewport.viewWidth));
  return viewport;
}

/** Scroll by a number of levels, stopping at the ends of the shaft. */
export function pan(viewport, deltaLevels) {
  const maxTop = Math.max(1, viewport.levelCount - viewport.visibleLevels + 1);
  viewport.topLevel = clamp(viewport.topLevel + deltaLevels, 1, maxTop);
  return viewport;
}

/**
 * Zoom one integer step in (+1) or out (-1), keeping `anchorLevel` at the same
 * relative screen position — so zooming does not throw away the thing the
 * player was looking at.
 */
export function zoom(viewport, step, anchorLevel = null) {
  const before = viewport.visibleLevels;
  const next = clamp(Math.round(viewport.scale) + Math.sign(step), MIN_SCALE, MAX_SCALE);
  if (next === viewport.scale) return viewport;

  const anchor = anchorLevel ?? viewport.topLevel + before / 2;
  const ratio = (anchor - viewport.topLevel) / before;

  viewport.chosenScale = next;
  fitToElement(viewport, viewport.host);
  viewport.topLevel = anchor - ratio * viewport.visibleLevels;
  return pan(viewport, 0); // re-clamp to the shaft's ends
}

/**
 * Derive the visible area from the element's size and the scale, so the shaft
 * fills its box instead of letterboxing. The default scale is the largest
 * whole number at which the full shaft width still fits.
 */
export function fitToElement(viewport, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return viewport;
  viewport.host = { width: rect.width, height: rect.height };

  // Round up when only a sliver would be cut: losing a few pixels at the far
  // end of the build area is better than a whole zoom step less.
  const fits = Math.floor(rect.width / SHAFT_WIDTH + OVERFLOW_ALLOWANCE);
  viewport.scale = fits < 1 && viewport.chosenScale === null
    ? rect.width / SHAFT_WIDTH
    : clamp(viewport.chosenScale ?? fits, MIN_SCALE, MAX_SCALE);

  viewport.viewWidth = rect.width / viewport.scale;
  viewport.visibleLevels = rect.height / viewport.scale / LEVEL_HEIGHT;
  panX(viewport, 0);
  return pan(viewport, 0);
}

/** Centre the viewport on a level — used to follow an event to its location. */
export function focusLevel(viewport, level) {
  viewport.topLevel = level - viewport.visibleLevels / 2;
  return pan(viewport, 0);
}

/**
 * Convert a pointer position within the SVG element into a shaft level.
 * Takes the element's own bounding box, so it is correct at any size without
 * the viewport storing pixel dimensions.
 */
export function levelAtClientY(viewport, clientY, rect) {
  const fraction = (clientY - rect.top) / rect.height;
  return Math.floor(viewport.topLevel + fraction * viewport.visibleLevels);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
