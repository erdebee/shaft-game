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
 * Zoom is CONTINUOUS. The default fills the host's width with the shaft, at
 * whatever factor that takes, and the player can zoom in from there. It never
 * goes below 1x: a host too narrow for the shaft at 1x keeps 1x and scrolls
 * sideways (`left`) rather than shrinking sprites below their own pixels.
 *
 * A fractional scale gives some sprite pixels one more screen pixel than
 * their neighbours. What keeps that from crawling is the viewBox origin, which
 * is snapped to whole SCREEN pixels: panning then moves the picture by whole
 * pixels and the uneven rows stay where they are.
 */

import { LEVEL_HEIGHT, SHAFT_WIDTH, levelY } from './interpolate.js';

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;

export function createViewport({ levelCount, topLevel = 1 } = {}) {
  return {
    levelCount,
    topLevel,
    /** Screen pixels per sprite pixel. */
    scale: 1,
    /** The player's zoom as a multiple of the fitted scale; 1 fills the width. */
    zoomFactor: 1,
    /** Visible area in shaft units, derived from the host size and scale. */
    viewWidth: SHAFT_WIDTH,
    /** Left edge in shaft units, used only when the shaft overflows the view. */
    left: 0,
    visibleLevels: 7,
    host: null,
  };
}

/**
 * The SVG viewBox string. The origin is snapped to whole screen pixels (see
 * the header) and the shaft is centred when the view is wider than it.
 */
export function viewBoxOf(viewport) {
  const snap = (v) => Math.round(v * viewport.scale) / viewport.scale;
  const spare = SHAFT_WIDTH - viewport.viewWidth;
  const x = snap(spare <= 0 ? spare / 2 : clamp(viewport.left, 0, spare));
  const y = snap(levelY(viewport.topLevel));
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
 * Zoom by a factor (>1 in, <1 out), keeping `anchorLevel` at the same relative
 * screen position — so zooming does not throw away the thing the player was
 * looking at. Stops at the fitted scale going out and MAX_SCALE going in.
 */
export function zoom(viewport, factor, anchorLevel = null) {
  const before = viewport.visibleLevels;
  const centreX = viewport.left + viewport.viewWidth / 2;
  const anchor = anchorLevel ?? viewport.topLevel + before / 2;
  const ratio = (anchor - viewport.topLevel) / before;

  const fitted = fittedScale(viewport.host);
  viewport.zoomFactor = clamp(viewport.zoomFactor * factor, 1, Math.max(1, MAX_SCALE / fitted));
  fitToElement(viewport, viewport.host);
  viewport.topLevel = anchor - ratio * viewport.visibleLevels;
  viewport.left = centreX - viewport.viewWidth / 2;
  panX(viewport, 0);
  return pan(viewport, 0); // re-clamp to the shaft's ends
}

/** The scale at which the shaft fills the host's width, never below 1x. */
export function fittedScale(rect) {
  if (!rect || rect.width <= 0) return MIN_SCALE;
  return Math.max(MIN_SCALE, rect.width / SHAFT_WIDTH);
}

/**
 * Derive the visible area from the element's size and the scale, so the shaft
 * fills its box instead of letterboxing.
 */
export function fitToElement(viewport, rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return viewport;
  viewport.host = { width: rect.width, height: rect.height };

  const fitted = fittedScale(rect);
  viewport.scale = clamp(fitted * viewport.zoomFactor, fitted, Math.max(fitted, MAX_SCALE));
  viewport.viewWidth = rect.width / viewport.scale;
  viewport.visibleLevels = rect.height / viewport.scale / LEVEL_HEIGHT;
  panX(viewport, 0);
  return pan(viewport, 0);
}

/** Whether the shaft is wider than the view, so it scrolls sideways. */
export function overflowsX(viewport) {
  return viewport.viewWidth < SHAFT_WIDTH - 0.5;
}

/** Centre the viewport on a level — used to follow an event to its location. */
export function focusLevel(viewport, level) {
  viewport.topLevel = level - viewport.visibleLevels / 2;
  return pan(viewport, 0);
}

/**
 * Convert a pointer position within the SVG element into a shaft level.
 * Takes the element's own bounding box, so it is correct at any size without
 * the viewport storing pixel dimensions. `exact` keeps the fraction, which is
 * what a zoom anchor wants; a click wants the whole level it landed on.
 */
export function levelAtClientY(viewport, clientY, rect, exact = false) {
  const fraction = (clientY - rect.top) / rect.height;
  const level = viewport.topLevel + fraction * viewport.visibleLevels;
  return exact ? level : Math.floor(level);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}
