/** Stock level with trend arrow and time-to-empty at the current rate. */

import { quantity } from '../../utils/format.js';

/**
 * Create a meter row. Returns an `update` so the caller can refresh it without
 * rebuilding the DOM — this is called every frame.
 */
export function render(root, { label, unit = '' }) {
  const wrap = document.createElement('div');
  wrap.className = 'meter';
  wrap.innerHTML = `
    <span class="meter-label"></span>
    <span class="meter-value"></span>
    <span class="meter-bar"><span class="meter-fill"></span></span>
  `;
  wrap.querySelector('.meter-label').textContent = label;
  root.appendChild(wrap);

  const valueEl = wrap.querySelector('.meter-value');
  const fillEl = wrap.querySelector('.meter-fill');

  return {
    /**
     * @param {number} value
     * @param {number} max    the full-bar value
     * @param {'ok'|'warn'|'critical'} state
     * @param {string} [note] replaces the numeric readout when given
     */
    update(value, max, state = 'ok', note = null) {
      valueEl.textContent = note ?? quantity(round(value), unit);
      fillEl.style.width = `${clampPercent(value, max)}%`;
      wrap.dataset.state = state;
    },
  };
}

/**
 * Banding for a flow: how close demand is to what is available. Reads the
 * thresholds off the flow definition so the catalog stays the source of truth.
 */
export function flowState(flow, def) {
  if (flow.generation <= 0) return flow.demand > 0 ? 'critical' : 'ok';
  const load = flow.demand / flow.generation;
  if (load >= (def?.criticalThreshold ?? 1)) return 'critical';
  if (load >= (def?.warnThreshold ?? 0.9)) return 'warn';
  return 'ok';
}

function clampPercent(value, max) {
  if (!max || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function round(value) {
  return Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
}
