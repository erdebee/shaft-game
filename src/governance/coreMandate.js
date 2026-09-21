/**
 * coreMandate.js
 * The Core Mandate: doctrine that predates the player and cannot be amended
 * from inside the settlement. It sets the outer bounds of what the Accord may
 * say. Attempts to legislate past it are the first hint of an authority above
 * the Advisory Board.
 */

export function loadMandate(data) {
  // TODO
}

/** @returns {{allowed: boolean, clause?: string}} */
export function permits(articleDraft, mandate) {
  // TODO: reject drafts that contradict a mandate clause, naming the clause
  return { allowed: true };
}
