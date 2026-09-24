/**
 * routeLines.js
 * One leg of an open route, drawn the same way wherever it is drawn — on the
 * minimap (shaftScroll.js) and in the shaft (routeLayer.js): a straight line
 * from stop to stop in the leg's colour over a dark casing, with chevrons
 * flowing along it the way the porter walks. With reduced motion the
 * chevrons stand still, spread along the line.
 *
 * `every` is the spacing of the chevrons and `speed` how fast they flow, both
 * in the drawing's own units, so each caller keeps them the same size on
 * screen. `most` caps the chevrons on one leg, so a leg the height of the
 * Shaft does not animate hundreds of them.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function drawLeg(parent, a, b, color, { every, speed, calm, most = Infinity }) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1) return null;
  const d = `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  const g = svgEl(parent, 'g', 'route-line');
  g.style.setProperty('--seg', color);
  svgEl(g, 'path', 'route-line-under').setAttribute('d', d);
  svgEl(g, 'path', 'route-line-over').setAttribute('d', d);

  const count = Math.max(1, Math.min(most, Math.round(length / every)));
  const dur = Math.max(0.5, length / speed);
  for (let k = 0; k < count; k++) {
    const c = svgEl(g, 'path', 'route-chevron');
    c.setAttribute('d', 'M-3 -3L2 0L-3 3z');
    const motion = svgEl(c, 'animateMotion');
    motion.setAttribute('path', d);
    motion.setAttribute('rotate', 'auto');
    motion.setAttribute('calcMode', 'linear');
    if (calm) {
      // Frozen at its share of the way along.
      const at = ((k + 0.5) / count).toFixed(3);
      motion.setAttribute('keyPoints', `${at};${at}`);
      motion.setAttribute('keyTimes', '0;1');
      motion.setAttribute('dur', '1s');
      motion.setAttribute('fill', 'freeze');
    } else {
      motion.setAttribute('dur', `${dur.toFixed(2)}s`);
      motion.setAttribute('begin', `${(-(k / count) * dur).toFixed(2)}s`);
      motion.setAttribute('repeatCount', 'indefinite');
    }
  }
  return g;
}

function svgEl(parent, tag, className = '') {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute('class', className);
  parent.appendChild(node);
  return node;
}
