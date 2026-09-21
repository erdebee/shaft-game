/** Shared numeric helpers used across systems. */

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const approach = (current, target, rate) =>
  current < target ? Math.min(target, current + rate) : Math.max(target, current - rate);
