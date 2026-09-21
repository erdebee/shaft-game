/** Display formatting. Keep unit strings in one place so the UI stays consistent. */

/**
 * A quantity with its unit. Unitless values (headcount, meters) pass an empty
 * unit and get no trailing space.
 */
export function quantity(value, unit = '') {
  const n = typeof value === 'number' ? trim(value) : value;
  return unit ? `${n} ${unit}` : `${n}`;
}

function trim(value) {
  if (!Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return value.toLocaleString('en');
  return (Math.round(value * 10) / 10).toLocaleString('en');
}

/**
 * In-world date from a tick. Days and shifts are 1-indexed, because the first
 * day of the settlement is day one, not day zero.
 */
export function tickToDate(tick, config) {
  const perShift = config.clock.ticksPerShift;
  const perDay = perShift * config.clock.shiftsPerDay;
  const day = Math.floor(tick / perDay) + 1;
  const shift = Math.floor((tick % perDay) / perShift) + 1;
  return { day, shift, label: `Day ${day}, shift ${shift}` };
}

/** Days-of-supply as a short readout. Infinity means nothing is consuming it. */
export function daysLabel(days) {
  if (!Number.isFinite(days)) return '—';
  if (days >= 100) return '99+d';
  return `${days.toFixed(1)}d`;
}
