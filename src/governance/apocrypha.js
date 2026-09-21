/**
 * apocrypha.js
 * The restricted archive. Controls which documents exist, who may read them,
 * and what accessing one costs. Reading is logged — and in Chapter 2 the
 * player controls the log, which is a different problem entirely.
 */

export function listAccessible(state, actor) {
  // TODO: filter by clearance and by chapter
  return [];
}

export function access(state, documentId, actor) {
  // TODO: reveal contents, record the access, fire narrative flags
}

export function redact(state, documentId, actor) {
  // TODO: Chapter 2 only — suppress a record and accept the risk
}
