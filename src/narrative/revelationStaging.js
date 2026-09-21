/**
 * revelationStaging.js
 * How the Chair presents a Nexus directive to the Advisory Board. The same
 * directive can be staged four ways, and each trades Presidium favour against
 * Board doubt differently — per member, using their credibility profile in
 * content/board/credibility.json.
 *
 * Doubt is sticky: it decays far more slowly than favour, so withholding is
 * survivable in the short run and corrosive over a chapter. Doubt does not
 * fail the run — it fails capabilities, as a doubting member stops
 * implementing revelations in their own domain.
 *
 * Framing ids, deltas and doubt modifiers are data, not code:
 * resources/data/content/nexus/framings.json.
 */

/** Must match the framing ids in content/nexus/framings.json. */
export const FRAMINGS = [
  'faithful-proclamation',
  'reinterpreted-teaching',
  'buried-footnote',
  'withhold',
];

export function stage(state, { truthId, framing, audience }) {
  // TODO: apply doubt/favour deltas, schedule delayed leak risk
}

export function leakRisk(state, truthId) {
  // TODO: rises with how many people know and how long it has been held
}
