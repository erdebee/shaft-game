/**
 * diffExport.js
 * Emits a human-readable diff of resolved config against base. Attach it to a
 * playtest report so a balance complaint can be traced to the values in play.
 */

export function diff(resolvedA, resolvedB) {
  // TODO: return [{ path, from, to, sourceLayer }]
  return [];
}

export function toMarkdown(diffEntries) {
  // TODO
  return '';
}

export function download(diffEntries, filename = 'config-diff.md') {
  // TODO: Blob + object URL
}
