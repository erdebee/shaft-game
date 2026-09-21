/**
 * viewport.js
 * What part of the shaft is on screen, and therefore what needs drawing.
 *
 * One mechanism answers four requirements at once. All geometry is authored in
 * shaft units; the viewBox maps a range of levels onto whatever pixel box
 * exists. So:
 *   - resolution independence is free (no devicePixelRatio, no redraw on zoom)
 *   - pan is a change of `topLevel`
 *   - zoom is a change of `visibleLevels`
 *   - culling is "which levels does the range cover"
 *
 * A phone showing 8 levels and a 4K monitor showing 40 run the same code with
 * a different viewBox. Nothing here knows about pixels.
 */

import { LEVEL_HEIGHT, SHAFT_WIDTH, levelY } from './interpolate.js';

export const MIN_VISIBLE_LEVELS = 4;
export const MAX_VISIBLE_LEVELS = 60;

export function createViewport({ levelCount, visibleLevels = 14, topLevel = 1 } = {}) {
  return {
    levelCount,
    visibleLevels: clampVisible(visibleLevels, levelCount),
    topLevel,
  };
}

/**
 * The SVG viewBox string. Height is derived from the visible level count, so
 * levels keep their aspect ratio regardless of the element's pixel size.
 */
export function viewBoxOf(viewport) {
  const y = levelY(viewport.topLevel);
  const height = viewport.visibleLevels * LEVEL_HEIGHT;
  return `0 ${y} ${SHAFT_WIDTH} ${height}`;
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

/** Scroll by a number of levels, stopping at the ends of the shaft. */
export function pan(viewport, deltaLevels) {
  const maxTop = Math.max(1, viewport.levelCount - viewport.visibleLevels + 1);
  viewport.topLevel = clamp(viewport.topLevel + deltaLevels, 1, maxTop);
  return viewport;
}

/**
 * Zoom, keeping `anchorLevel` at the same relative screen position — so
 * zooming does not throw away the thing the player was looking at. That anchor
 * is also what a pinch gesture would need, when touch support lands.
 */
export function zoom(viewport, factor, anchorLevel = null) {
  const before = viewport.visibleLevels;
  const after = clampVisible(before * factor, viewport.levelCount);
  if (after === before) return viewport;

  const anchor = anchorLevel ?? viewport.topLevel + before / 2;
  const ratio = (anchor - viewport.topLevel) / before;

  viewport.visibleLevels = after;
  viewport.topLevel = anchor - ratio * after;
  return pan(viewport, 0); // re-clamp to the shaft's ends
}

/**
 * Fit the visible level count to the element's own aspect ratio, so the shaft
 * fills its box instead of letterboxing.
 *
 * This is where resolution independence actually pays off: a tall narrow phone
 * gets fewer, larger levels and a wide monitor gets more, from the same
 * geometry and with no breakpoint. `zoomBias` lets the player zoom relative to
 * whatever the fitted baseline is, so a resize does not undo their zoom.
 */
export function fitToElement(viewport, rect, zoomBias = 1) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return viewport;

  const unitsTall = (rect.height / rect.width) * SHAFT_WIDTH;
  const fitted = (unitsTall / LEVEL_HEIGHT) * zoomBias;

  viewport.visibleLevels = clampVisible(fitted, viewport.levelCount);
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

function clampVisible(n, levelCount) {
  return Math.round(clamp(n, MIN_VISIBLE_LEVELS, Math.min(MAX_VISIBLE_LEVELS, levelCount)));
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
