/**
 * boardRelations.js
 * Per-member disposition on the Advisory Board: trust, ambition, faction tie,
 * and what each one wants from the player. Vote outcomes are derived from
 * these rather than rolled, so lobbying is legible.
 *
 * One member is the Presidium's pre-planted mole. Which one is fixed at run
 * start from the seed and must not be inferable from disposition alone.
 */

export function adjust(state, memberId, { trust = 0, favour = 0 }, reason) {
  // TODO
}

export function predictVote(state, motion) {
  // TODO: per-member lean, with an uncertainty band shown to the player
}

export function lobby(state, memberId, offer) {
  // TODO
}
