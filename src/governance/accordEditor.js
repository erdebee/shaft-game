/**
 * accordEditor.js
 * Drafting and amendment of the Accord. Handles article structure, proposed
 * versus enacted text, amendment procedure, and the vote that ratifies it.
 * Editing is deliberately friction-heavy — law should feel expensive to change.
 */

export function draftAmendment(state, { articleId, text, sponsor }) {
  // TODO
}

export function ratify(state, amendmentId, voteResult) {
  // TODO: enact, version the article, record who voted which way
}

export function repeal(state, articleId) {
  // TODO
}
