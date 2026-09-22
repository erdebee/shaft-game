/**
 * streams.js
 * Save-safe wrapper around config/rng.js.
 *
 * createStream returns stateful closures with no way to read or restore their
 * position, so a save taken mid-run would resume with fresh streams and
 * silently diverge from an uninterrupted run. That would break the one
 * guarantee the project actually promises about randomness.
 *
 * Rather than change rng.js — which is fully implemented and covered by live
 * tests — each stream is wrapped in a counter, and the counts live in
 * state.meta.rngCursors. On load, streams are recreated and replayed forward.
 * Replaying is a few hundred thousand mulberry32 calls at worst: microseconds.
 *
 * Stream names are fixed here rather than created ad hoc, because a stream
 * that appears only under some conditions would make cursor replay depend on
 * those conditions.
 */

import { createStream } from '../config/rng.js';

/**
 * Every named stream in the game. Adding a random draw means adding a stream
 * here, never borrowing an existing one — sharing is exactly what lets a
 * narrative change shift the economy's sequence.
 */
export const STREAM_NAMES = [
  'economy',    // extraction yields, breakdown rolls, spoilage
  'narrative',  // dilemma selection and weighting
  'events',     // scheduled event jitter
  'board',      // mole selection, vote uncertainty
  'names',      // porter and worker names — presentation only
  'unrest',     // riot targets
];

/** Wrap one stream so every draw is counted. */
function counted(stream, onDraw) {
  const wrap = (fn) => (...args) => { onDraw(); return fn(...args); };
  return {
    next: wrap(stream.next),
    int: wrap(stream.int),
    float: wrap(stream.float),
    chance: wrap(stream.chance),
    pick: wrap(stream.pick),
  };
}

/**
 * Build all streams for a run.
 *
 * @param {number|string} seed
 * @param {Record<string, number>} cursors draw counts to replay to, from a save
 * @returns {{streams: object, cursors: Record<string, number>}}
 *          `cursors` is live — read it when saving.
 */
export function createStreams(seed, cursors = {}) {
  const counts = {};
  const streams = {};

  for (const name of STREAM_NAMES) {
    counts[name] = 0;
    const raw = createStream(seed, name);

    // Replay to the saved position before handing the stream out.
    const target = cursors[name] ?? 0;
    for (let i = 0; i < target; i++) raw.next();
    counts[name] = target;

    streams[name] = counted(raw, () => { counts[name] += 1; });
  }

  return { streams, cursors: counts };
}

/** Snapshot of draw counts, for writing into state before a save. */
export function cursorsOf(counts) {
  const out = {};
  for (const name of STREAM_NAMES) out[name] = counts[name] ?? 0;
  return out;
}
