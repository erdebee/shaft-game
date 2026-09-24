/**
 * conduits.js
 * How the networks look in the shaft: the drawing primitives the network
 * layer (networkLayer.js) builds a network out of.
 *
 *   ducts and pipes  pixel tiles (tools/conduitTiles.mjs) repeated along a
 *                    run — rusted, riveted duct for the air; bolted cast
 *                    iron for the sewer; galvanised pipe for the mains — with
 *                    a joint plate wherever a run turns or ends
 *   trunk cable      the thick insulated cable from a generator to its
 *                    junctions, sagging where it hangs across a room
 *   wires            the thin lines a junction hangs out to every room it
 *                    feeds, drooping between the rooms like washing lines
 *
 * Everything here is in shaft units and draws into the SVG group it is
 * given. Nothing reads state.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

let patternSerial = 0;

export function svg(parent, tag, className = '') {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  parent.appendChild(node);
  return node;
}

/**
 * A straight run of tiles from (x1, y1) to (x2, y2) — horizontal or
 * vertical — centred on that line. The tile is anchored at the run's start,
 * so every run begins on a flange.
 *
 * @param defs  where the run's <pattern> goes
 * @param tiles { v, h } from roomArt's conduit(): the run's two tiles
 */
export function tileRun(parent, defs, tiles, x1, y1, x2, y2) {
  const vertical = x1 === x2;
  const tile = vertical ? tiles.v : tiles.h;
  if (!tile) return null;
  const thick = vertical ? tile.width : tile.height;
  const x = vertical ? x1 - thick / 2 : Math.min(x1, x2);
  const y = vertical ? Math.min(y1, y2) : y1 - thick / 2;
  const w = vertical ? thick : Math.abs(x2 - x1);
  const h = vertical ? Math.abs(y2 - y1) : thick;
  if (w <= 0 || h <= 0) return null;

  const id = `conduit-${patternSerial++}`;
  const pattern = svg(defs, 'pattern');
  pattern.id = id;
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('x', String(x));
  pattern.setAttribute('y', String(y));
  pattern.setAttribute('width', String(tile.width));
  pattern.setAttribute('height', String(tile.height));
  const img = svg(pattern, 'image');
  img.setAttribute('href', tile.href);
  img.setAttribute('width', String(tile.width));
  img.setAttribute('height', String(tile.height));

  const run = svg(parent, 'rect', 'conduit-run');
  run.setAttribute('x', String(x));
  run.setAttribute('y', String(y));
  run.setAttribute('width', String(w));
  run.setAttribute('height', String(h));
  run.setAttribute('fill', `url(#${id})`);
  return run;
}

/** A joint plate centred on a point: where a run turns, meets a room, or ends. */
export function joint(parent, tile, x, y) {
  if (!tile) return null;
  const img = svg(parent, 'image', 'conduit-joint');
  img.setAttribute('href', tile.href);
  img.setAttribute('x', String(Math.round(x - tile.width / 2)));
  img.setAttribute('y', String(Math.round(y - tile.height / 2)));
  img.setAttribute('width', String(tile.width));
  img.setAttribute('height', String(tile.height));
  return img;
}

/**
 * The route a duct, pipe or trunk takes between two rooms: out along the
 * upper room's ceiling to a riser, down the riser, and in along the lower
 * room's. On one level it is a single run. Returns the corner points.
 */
export function riserRoute(a, b, riserX) {
  if (a.y === b.y) return [a, b];
  const [top, bottom] = a.y < b.y ? [a, b] : [b, a];
  const route = [top, { x: riserX, y: top.y }, { x: riserX, y: bottom.y }, bottom];
  return a.y < b.y ? route : route.reverse();
}

/** Lay tiles along a route and a joint on every corner and end. */
export function tileRoute(parent, defs, tiles, route) {
  for (let i = 0; i < route.length - 1; i++) {
    const p = route[i];
    const q = route[i + 1];
    if (p.x === q.x && p.y === q.y) continue;
    tileRun(parent, defs, tiles, p.x, p.y, q.x, q.y);
  }
  for (const p of route) joint(parent, tiles.joint, p.x, p.y);
}

/** A span that sags: a quadratic from one point to another, dipping by `sag`. */
export function sagPath(a, b, sag) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + sag * 2; // a quadratic reaches half its control's offset
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** How far a span of width `dx` droops. */
export function sagOf(dx) {
  return 4 + Math.abs(dx) * 0.07;
}

/**
 * A route as one path, the level runs sagging and the drops straight: how a
 * cable hangs off its fixings.
 */
export function hangingPath(route) {
  let d = `M${route[0].x.toFixed(1)} ${route[0].y.toFixed(1)}`;
  for (let i = 1; i < route.length; i++) {
    const p = route[i - 1];
    const q = route[i];
    if (p.y === q.y) {
      const sag = sagOf(q.x - p.x);
      d += `Q${((p.x + q.x) / 2).toFixed(1)} ${(p.y + sag * 2).toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    } else {
      d += `L${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    }
  }
  return d;
}

/** The generator's trunk: a thick black cable with a sheen along its top. */
export function trunkCable(parent, d) {
  svg(parent, 'path', 'cable-trunk-edge').setAttribute('d', d);
  svg(parent, 'path', 'cable-trunk').setAttribute('d', d);
  const sheen = svg(parent, 'path', 'cable-trunk-sheen');
  sheen.setAttribute('d', d);
  sheen.setAttribute('transform', 'translate(-1 -1.5)');
}

/** A thin supply wire. `lit` is whether what it feeds has power. */
export function wire(parent, d, lit) {
  svg(parent, 'path', 'wire-edge').setAttribute('d', d);
  const core = svg(parent, 'path', 'wire');
  core.setAttribute('d', d);
  core.dataset.lit = String(lit);
}

/** A cable clamp where a wire leaves a drop or meets a room. */
export function clamp(parent, x, y) {
  const c = svg(parent, 'rect', 'wire-clamp');
  c.setAttribute('x', String(x - 2));
  c.setAttribute('y', String(y - 2));
  c.setAttribute('width', '4');
  c.setAttribute('height', '4');
  return c;
}

/** A small plate with a figure on it, centred on a point. */
export function plate(parent, x, y, text, className = '') {
  const g = svg(parent, 'g', `net-plate ${className}`.trim());
  g.setAttribute('transform', `translate(${Math.round(x)} ${Math.round(y)})`);
  const w = 6 + text.length * 5;
  const box = svg(g, 'rect');
  box.setAttribute('x', String(-w / 2));
  box.setAttribute('y', '-6');
  box.setAttribute('width', String(w));
  box.setAttribute('height', '11');
  const t = svg(g, 'text');
  t.setAttribute('y', '2.5');
  t.textContent = text;
  return g;
}
