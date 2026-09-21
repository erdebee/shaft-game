/**
 * spriteMap.js
 * Which SVG symbol draws which building, and which of its parts move.
 *
 * Presentation, not simulation — so it lives here rather than in the catalog.
 * A building's data says what it consumes and produces; this says what it
 * looks like. Adding a sprite means adding a <symbol> to
 * resources/assets/sprites/buildings.svg and, at most, a line here.
 *
 * Buildings with no entry fall back to a generic block keyed by zone, so a new
 * building in the catalog renders sensibly before anyone has drawn it.
 */

/**
 * Animated parts, by kind:
 *   'spin'  — continuous rotation (a fan)
 *   'pulse' — opacity or scale loop (a furnace glow, a lamp)
 *   'door'  — two-state, driven by sim state via a CSS class
 *   'car'   — position driven by trip interpolation, not CSS
 *
 * 'spin' and 'pulse' are ambient CSS loops and must pause with the clock; the
 * root `.paused` class handles that (see screens.css). 'car' is sim-time
 * motion and is driven from interpolate.js instead.
 */
export const SPRITES = {
  'main-generator':   { symbol: 'generator',   parts: [{ id: 'glow', kind: 'pulse' }] },
  'battery-bank':     { symbol: 'battery',     parts: [{ id: 'charge', kind: 'pulse' }] },
  'junction':         { symbol: 'junction',    parts: [] },

  'scrubber-bank':    { symbol: 'scrubber',    parts: [{ id: 'fan', kind: 'spin' }] },
  'oxygen-garden':    { symbol: 'garden',      parts: [] },
  'duct-fan':         { symbol: 'ductfan',     parts: [{ id: 'fan', kind: 'spin' }] },

  'deep-pump':        { symbol: 'pump',        parts: [{ id: 'piston', kind: 'pulse' }] },
  'purifier':         { symbol: 'tank',        parts: [] },
  'reclamation-plant':{ symbol: 'tank',        parts: [] },
  'cistern':          { symbol: 'cistern',     parts: [{ id: 'waterline', kind: 'pulse' }] },

  'hydroponics-bay':  { symbol: 'hydroponics', parts: [{ id: 'lamps', kind: 'pulse' }] },
  'protein-vats':     { symbol: 'vats',        parts: [] },
  'food-processing':  { symbol: 'workshop',    parts: [] },
  'seed-vault':       { symbol: 'vault',       parts: [{ id: 'door', kind: 'door' }] },
  'grove':            { symbol: 'grove',       parts: [] },

  'smelter':          { symbol: 'smelter',     parts: [{ id: 'glow', kind: 'pulse' }] },
  'workshop':         { symbol: 'workshop',    parts: [] },
  'machine-shop':     { symbol: 'workshop',    parts: [] },
  'recycler':         { symbol: 'workshop',    parts: [] },
  'dig-face':         { symbol: 'digface',     parts: [] },
  'salvage-post':     { symbol: 'workshop',    parts: [] },
  'freight-elevator': { symbol: 'liftshaft',   parts: [{ id: 'car', kind: 'car' }] },
  'dumbwaiter':       { symbol: 'liftshaft',   parts: [{ id: 'car', kind: 'car' }] },

  'simple-suite':       { symbol: 'suite-simple',       parts: [] },
  'modest-suite':       { symbol: 'suite-modest',       parts: [] },
  'superior-suite':     { symbol: 'suite-superior',     parts: [] },
  'luxury-suite':       { symbol: 'suite-luxury',       parts: [] },
  'presidential-suite': { symbol: 'suite-presidential', parts: [] },
  'canteen':          { symbol: 'canteen',     parts: [] },
  'clinic':           { symbol: 'clinic',      parts: [{ id: 'lamp', kind: 'pulse' }] },
  'school':           { symbol: 'school',      parts: [] },
  'common-hall':      { symbol: 'hall',        parts: [] },

  'council-chamber':  { symbol: 'chamber',     parts: [] },
  'archive':          { symbol: 'archive',     parts: [{ id: 'door', kind: 'door' }] },
  'security-post':    { symbol: 'security',    parts: [] },
  'holding-cells':    { symbol: 'cells',       parts: [{ id: 'door', kind: 'door' }] },
};

const ZONE_FALLBACK = {
  cultivation: 'generic-cultivation',
  water: 'tank',
  air: 'generic-air',
  power: 'junction',
  mechanical: 'workshop',
  habitation: 'suite-simple',
  administration: 'chamber',
};

export function spriteFor(buildingDef) {
  const entry = SPRITES[buildingDef.id];
  if (entry) return entry;
  return { symbol: ZONE_FALLBACK[buildingDef.zone] ?? 'generic-cultivation', parts: [] };
}

/** How many ambient worker figures to draw for an instance. */
export function workerFigureCount(instance, buildingDef) {
  const staffed = Math.min(instance.staffing ?? 0, buildingDef.staffing ?? 0);
  // Cap at three, and never more than one per slot: past that the figures stop
  // reading as people and start reading as texture, and the information is
  // already in the staffing number.
  return Math.min(staffed, 3, instance.slots ?? 1);
}
