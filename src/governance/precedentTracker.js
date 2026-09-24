/**
 * precedentTracker.js
 * Records how the player has actually ruled, independent of what the Accord
 * says, and reads the pattern back: the case-history counter the Accord tab
 * shows, the surcharge a law pays for contradicting it, and the moment a
 * pattern is settled enough to be made policy.
 *
 * Two records, written by different paths:
 *   governance.precedent  counts per theme and leaning, written by the
 *                         `precedent.record` effect a ruling carries — so
 *                         the content decides what a ruling counts as
 *   governance.cases      one entry per ruling, written here by the dilemma
 *                         engine, so a later case can cite the earlier one
 *
 * Everything but record() is a pure read, so the dilemma engine and the UI
 * may both ask without changing anything.
 */

/** The leaning axis. Pragmatic sits between the other two. */
export const LEANINGS = ['harsh', 'pragmatic', 'lenient'];

/** How far apart two leanings are: 0, 1, or 2 for harsh against lenient. */
export function leaningDistance(a, b) {
  const i = LEANINGS.indexOf(a);
  const j = LEANINGS.indexOf(b);
  if (i === -1 || j === -1) return 0;
  return Math.abs(i - j);
}

export function record(state, { dilemmaId, optionId, theme, leaning }) {
  state.governance.cases ??= [];
  state.governance.cases.push({ dilemmaId, optionId, theme, leaning, tick: state.clock.tick });
}

/** Counts per leaning for a theme, zero-filled. */
export function countsOf(state, theme) {
  const counts = state.governance.precedent[theme] ?? {};
  return Object.fromEntries(LEANINGS.map((l) => [l, counts[l] ?? 0]));
}

/**
 * A theme's reputation: the leaning with the most rulings, how many, and how
 * far it leads the runner-up. `visible` once it has leaningVisibleAtCount —
 * leaning accumulates unseen at first, and the player discovers they have a
 * reputation rather than choosing one. Ties have no leader.
 */
export function leaningOf(state, ctx, theme) {
  const counts = countsOf(state, theme);
  const ranked = LEANINGS.map((l) => [l, counts[l]]).sort((a, b) => b[1] - a[1]);
  const [[top, n], [, second]] = ranked;
  const leader = n > second ? top : null;
  return {
    counts,
    leaning: leader,
    count: leader ? n : 0,
    lead: n - second,
    visible: leader !== null && n >= ctx.config.governance.leaningVisibleAtCount,
  };
}

/**
 * How many leaning steps the player's rulings on a theme sit from a leaning:
 * every ruling counts its distance. Three harsh dissent rulings put six steps
 * between the player and a lenient dissent law.
 */
export function contradictionSteps(state, theme, leaning) {
  if (!theme || !leaning) return 0;
  const counts = countsOf(state, theme);
  return LEANINGS.reduce((sum, l) => sum + counts[l] * leaningDistance(l, leaning), 0);
}

/**
 * The law a theme's settled pattern would become, if it is settled: its
 * leader leads every other leaning by governance.codificationThreshold, the
 * theme names a card for that leaning, and that card is not already law.
 * Returns { theme, leaning, cardId, cost } or null. The cost is discounted —
 * the population already expects it — and carries no contradiction surcharge,
 * because by definition it contradicts nothing.
 */
export function codification(state, ctx, theme) {
  const def = ctx.content.precedentThemes?.byId[theme];
  if (!def) return null;
  const { leaning, lead } = leaningOf(state, ctx, theme);
  if (!leaning || lead < ctx.config.governance.codificationThreshold) return null;
  const cardId = def.codifiesTo?.[leaning];
  const card = cardId ? ctx.content.lawCards.byId[cardId] : null;
  if (!card || state.governance.enacted.some((e) => e.id === cardId)) return null;
  const cost = Math.ceil(card.authorityCost * (1 - ctx.config.governance.codificationDiscount));
  return { theme, leaning, cardId, cost };
}

/** Earlier rulings on the same dilemma, newest first: what the Board will cite. */
export function findSimilar(state, dilemmaId) {
  return (state.governance.cases ?? []).filter((c) => c.dilemmaId === dilemmaId).reverse();
}
