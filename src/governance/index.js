/**
 * The `governance` system: the Accord's calendar. Sessions open and close and
 * Authority is paid on the tick; enacted statutes need no ticking of their
 * own, because their standing effects are collected with every other
 * modifier (core/effects.js collectModifiers).
 */

import * as statutes from './statuteEngine.js';

export function tick(state, ctx) {
  statutes.tick(state, ctx);
}
