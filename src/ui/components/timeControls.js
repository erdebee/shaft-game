/** Pause, speed selection, and the current decision-window indicator. */

import { SPEEDS, calendar } from '../../core/clock.js';

const LABELS = [
  ['PAUSED', '❙❙', 'Pause'],
  ['NORMAL', '▶', 'Normal speed'],
  ['FAST', '▶▶', 'Fast'],
  ['VERY_FAST', '▶▶▶', 'Very fast'],
];

/**
 * @param {HTMLElement} root
 * @param {(command: object) => void} dispatch
 *   Speed changes go through the command dispatcher, never straight to the
 *   clock — the UI does not write state, and a run has to replay from its
 *   command log (see src/core/commands.js).
 */
export function mount(root, dispatch) {
  const readout = document.createElement('div');
  readout.className = 'clock-readout';
  readout.innerHTML = `
    <span class="day">Day <span data-day>1</span></span>
    <span class="shift">Shift <span data-shift>1</span></span>
    <span class="tick">t<span data-tick>0</span></span>
  `;

  const speeds = document.createElement('div');
  speeds.className = 'speeds';

  const buttons = LABELS.map(([name, glyph, title]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = glyph;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', () => dispatch({ type: 'player:setSpeed', speed: name }));
    speeds.appendChild(button);
    return { name, button };
  });

  root.append(readout, speeds);

  const day = readout.querySelector('[data-day]');
  const shift = readout.querySelector('[data-shift]');
  const tick = readout.querySelector('[data-tick]');

  return {
    update(state) {
      const cal = calendar(state.clock);
      day.textContent = String(cal.day);
      shift.textContent = String(cal.shift);
      tick.textContent = String(state.clock.tick);

      for (const { name, button } of buttons) {
        button.setAttribute('aria-pressed', String(state.clock.speed === SPEEDS[name]));
      }
    },
  };
}
