/**
 * schema.js
 * Declares the shape and legal range of every tunable parameter, the effect and
 * predicate vocabularies content is allowed to use, and the cross-reference
 * rules that make a dangling id a load-time failure rather than a runtime
 * `undefined`.
 *
 * This file is the contract between content and code. Adding an effect op to a
 * dilemma without adding it to EFFECT_OPS is rejected on load, on purpose — it
 * is how a typo in an override file gets caught before it becomes an
 * unexplained balance shift three hours into a playtest.
 */

const N = (min, max) => ({ type: 'number', min, max });
const RATE = { type: 'number', min: 0, max: 1 };
const METER = { type: 'number', min: 0, max: 100 };
const TICKS = { type: 'number', min: 0, max: 1000000 };
const LIST = { type: 'array' };
const BOOL = { type: 'boolean' };

/**
 * Every legal tunable, by dot-path. Unknown keys in any layer fail validation.
 * Ranges are deliberately generous where balance is unsettled and tight where
 * a value outside the range would be meaningless rather than merely wrong.
 */
export const TUNABLES = {
  'clock.tickMs': N(16, 60000),
  'clock.shiftsPerDay': N(1, 8),
  'clock.ticksPerShift': TICKS,
  'clock.ticksPerDecisionWindow': TICKS,
  'clock.ticksPerAmendmentWindow': TICKS,
  'clock.autoPauseTriggers': LIST,

  'power.baseGeneration': N(0, 100000),
  'power.transmissionLossPerLevel': RATE,
  'power.junctionCapacity': N(0, 100000),
  'power.batteryBankCapacity': N(0, 100000),
  'power.batteryChargeRatePerTick': N(0, 10000),
  'power.brownoutRecoveryTicks': TICKS,
  'power.defaultPriorityLadder': LIST,

  'air.contaminantPerCapitaPerTick': N(0, 10),
  'air.migrationRateBetweenLevels': RATE,
  'air.scrubberVolumePerTick': N(0, 10000),
  'air.scrubberRadiusLevels': N(0, 50),
  'air.catalystConsumptionPerTick': N(0, 100),
  'air.qualityWarnThreshold': METER,
  'air.qualityCriticalThreshold': METER,
  'air.sealedLevelDecayPerTick': N(0, 100),

  'water.potablePerCapitaPerTick': N(0, 10),
  'water.reclamationEfficiency': RATE,
  'water.groundwaterIntakePerTick': N(0, 10000),
  'water.pumpPowerPerLevelLifted': N(0, 1000),
  'water.cisternCapacityPerLevel': N(0, 100000),

  'structure.integrityStart': METER,
  'structure.levels': N(1, 200),
  'structure.excavationIntegrityCost': N(0, 100),
  'structure.excavationTicks': TICKS,
  'structure.excavationCostCurveExponent': N(1, 4),
  'structure.collapseRiskThreshold': METER,

  'haulage.porterTicksPerLevel': N(0, 100),
  'haulage.fatiguePerLevelHauled': RATE,
  'haulage.shiftChangeCongestionMultiplier': N(1, 10),

  'buildings.conditionStart': RATE,
  'buildings.degradedEfficiencyMultiplier': RATE,
  'buildings.breakdownCheckIntervalTicks': TICKS,
  'buildings.repairLabourPerCondition': N(0, 1000),

  'mining.baseYieldPerTick': N(0, 100),
  'mining.depletionPerExtractionTick': RATE,
  'mining.depthVentilationPowerPerLevel': N(0, 1000),
  'mining.depthWaterIngressPerLevel': N(0, 1000),
  'mining.recyclerEfficiency': RATE,

  'population.startingHeadcount': N(0, 100000),
  'population.unrestThreshold': METER,
  'population.moraleStart': METER,
  'population.foodPerCapitaPerTick': N(0, 10),
  'population.labourPerWorkerPerShift': N(0, 10),
  'population.birthLotterySlotsPerCycle': N(0, 1000),
  'population.birthLotteryCycleTicks': TICKS,
  'population.deathAgeMean': N(1, 150),
  'population.focusPerStaffPulled': N(0, 100),

  'factions.satisfactionStart': METER,
  'factions.satisfactionDriftPerTick': N(-1, 1),
  'factions.sabotageThreshold': METER,
  'factions.earlyWarningThreshold': METER,

  'governance.amendmentVotesRequired': N(0, 20),
  'governance.authorityStart': N(0, 1000),
  'governance.authorityRegenPerWindow': N(0, 1000),
  'governance.authorityCap': N(0, 1000),
  'governance.precedentDecayPerTick': RATE,
  'governance.codificationThreshold': N(1, 20),
  'governance.codificationDiscount': RATE,
  'governance.flipFlopPenaltyPerWindowStood': N(0, 100),
  'governance.flipFlopPenaltyCap': N(0, 100),
  'governance.contradictionSurchargePerLeaningStep': N(0, 10),
  'governance.paperPerAmendment': N(0, 1000),
  'governance.hiddenClauseFocusCost': N(0, 1000),

  'narrative.dilemmaBaseIntervalTicks': TICKS,
  'narrative.dilemmaIntervalJitterTicks': TICKS,
  'narrative.dilemmaHardPause': BOOL,
  'narrative.promiseTimerGraceTicks': TICKS,
  'narrative.leadFocusCostDefault': N(0, 1000),
  'narrative.catalystMysteryEnabled': BOOL,
  'narrative.nexusEnabled': BOOL,
  'narrative.apocryphaUnlocked': BOOL,
  'narrative.revelationStagingEnabled': BOOL,

  'board.doubtStart': METER,
  'board.doubtDecayPerTick': RATE,
  'board.doubtFreezeThreshold': METER,
  'board.doubtInquiryThreshold': METER,
  'board.revelationFrequencyMemoryTicks': TICKS,
};

/**
 * The effect vocabulary. Every `{ op: … }` in any content file must appear
 * here. `targets` names the catalogue an op's target is resolved against, so
 * a misspelled meter or building id is caught at load; null means the target
 * is a free-form key (a flag, a timer name) with nothing to check it against.
 */
export const EFFECT_OPS = {
  'meter.add': { targets: 'meters', value: 'number' },
  'stock.add': { targets: 'stocks', value: 'number' },
  'focus.add': { targets: 'abstracts', value: 'number' },
  'doubt.add': { targets: 'boardMembers', value: 'number', allowAll: true },
  'faction.satisfaction': { targets: 'factions', value: 'number' },
  'population.healthRate': { targets: null, value: 'number' },

  'consumption.multiply': { targets: 'any-resource', value: 'number' },
  'spoilage.multiply': { targets: 'stocks', value: 'number' },
  'zone.outputMultiply': { targets: null, value: 'number' },
  'lottery.slotsMultiply': { targets: null, value: 'number' },

  'flow.scrub': { targets: 'flows', value: 'number' },
  'flow.setQuality': { targets: 'flows', value: 'number' },
  'buffer.add': { targets: 'any-resource', value: 'number' },
  'network.capacity': { targets: 'networks', value: 'number' },
  'network.boost': { targets: 'networks', value: 'number' },
  'priority.reorder': { targets: null, value: 'number' },
  'supply.cut': { targets: 'components' },

  'recipe.enable': { targets: 'buildings' },
  'extraction.enable': { targets: null },
  'reclamation.enable': { targets: 'flows' },
  'haulage.enable': { targets: 'haulage' },

  'building.demolish': { targets: 'buildings' },
  'building.resize': { targets: 'buildings', value: 'number' },
  'risk.add': { targets: null, value: 'number' },

  'statute.enact': { targets: 'lawCards' },
  'precedent.record': { targets: null, theme: 'precedentThemes' },
  'authority.add': { targets: null, value: 'number' },

  'flag.set': { targets: null },
  'capability.enable': { targets: null },
  'content.unlock': { targets: 'any-content' },
  'timer.start': { targets: null, nested: ['onMet', 'onExpire'] },
  'beat.arm': { targets: 'beats' },
  'chapter.advance': { targets: null, value: 'number' },
  'board.replace': { targets: 'boardMembers', allowSelectors: ['highest-doubt', 'lowest-doubt'] },
  'board.revealMole': { targets: 'boardMembers', allowSelectors: ['highest-doubt', 'lowest-doubt'] },
};

/**
 * The predicate vocabulary, used by `preconditions`, `requires`, `armedBy`,
 * `satisfiedBy` and dilemma variant `when` clauses. `all-of`, `any-of` and
 * `not` take an `of` array and nest arbitrarily.
 */
export const PREDICATES = {
  'all-of': { combinator: true },
  'any-of': { combinator: true },
  'not': { combinator: true },

  'meter.above': { targets: 'meters', value: 'number' },
  'meter.below': { targets: 'meters', value: 'number' },
  'stock.above': { targets: 'any-resource', value: 'number' },
  'stock.aboveDaysOfSupply': { targets: 'stocks', value: 'number' },
  'stock.belowDaysOfSupply': { targets: 'stocks', value: 'number' },
  'flow.shortfall': { targets: 'flows' },

  'building.exists': { targets: 'buildings' },
  'buildings.noneBelowCondition': { targets: null, value: 'number' },

  'statute.active': { targets: 'lawCards' },
  'leaning.atLeast': { targets: null, theme: 'precedentThemes' },
  'capability.enabled': { targets: null },
  'flag.set': { targets: null },

  'doubt.anyAbove': { targets: null, value: 'number' },
  'directive.fired': { targets: 'directives' },
  'chapter.is': { targets: null, value: 'number' },
  'tick.after': { targets: null, value: 'number' },
};

/**
 * Cross-reference rules: for each catalogue, which of its fields hold ids from
 * which other catalogue. Resolved after every layer is merged, so a reference
 * to something a later layer removed still fails loudly.
 */
export const REFS = {
  recipes: { building: 'buildings', 'inputs[].id': 'any-resource', 'outputs[].id': 'any-resource' },
  buildings: { 'consumes[].id': 'any-resource', 'produces[].id': 'any-resource', 'repairCost[].id': 'any-resource', zone: null },
  minerals: { 'refinesInto[]': 'components' },
  flows: { network: 'networks' },
  stocks: { 'producedBy[]': 'buildings' },
  jobs: { faction: 'factions', 'worksIn[]': 'buildings' },
  factions: { 'controls[]': 'buildings' },
  haulage: { requiresBuilding: 'buildings', 'repairCost[].id': 'any-resource' },
  articles: { 'foundingClauses[]': 'hiddenClauses' },
  lawCards: { article: 'articles', 'consumes[].id': 'any-resource', leaningTheme: 'precedentThemes' },
  hiddenClauses: { article: 'articles' },
  credibility: { memberId: 'boardMembers' },
  directives: { citesMandate: 'mandateClauses', expectedResponse: 'lawCards' },
  apocrypha: {},
  leads: { 'unlocks[]': 'leads' },
  dilemmas: { theme: 'precedentThemes' },
};

/** Catalogues whose ids are all valid where a rule says 'any-resource'. */
export const RESOURCE_CATALOGUES = ['flows', 'stocks', 'abstracts', 'minerals', 'components'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate one config layer against TUNABLES.
 * Catches unknown keys, wrong types and out-of-range values. Keys beginning
 * with `_` are documentation and skipped; `patch` blocks are checked against
 * the catalogues elsewhere, once every layer is merged.
 *
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validate(layer, layerName = 'unknown') {
  const errors = [];
  const tunables = layer?.tunables ?? {};

  walk(tunables, '', (path, value) => {
    const spec = TUNABLES[path];
    if (!spec) {
      errors.push(`[${layerName}] unknown tunable "${path}"`);
      return;
    }
    if (spec.type === 'array') {
      if (!Array.isArray(value)) errors.push(`[${layerName}] "${path}" expected array, got ${typeof value}`);
      return;
    }
    if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') errors.push(`[${layerName}] "${path}" expected boolean, got ${typeof value}`);
      return;
    }
    if (value === null) return; // null is a legal "undecided" — see CONVENTIONS.md §2
    if (!isNum(value)) {
      errors.push(`[${layerName}] "${path}" expected number, got ${typeof value}`);
      return;
    }
    if (isNum(spec.min) && value < spec.min) {
      errors.push(`[${layerName}] "${path}" = ${value} below minimum ${spec.min}`);
    }
    if (isNum(spec.max) && value > spec.max) {
      errors.push(`[${layerName}] "${path}" = ${value} above maximum ${spec.max}`);
    }
  });

  return { ok: errors.length === 0, errors };
}

/** Validate one effect op list against EFFECT_OPS, recursing into timers. */
export function validateEffects(effects, where = 'unknown') {
  const errors = [];
  if (!Array.isArray(effects)) return { ok: true, errors };

  for (const effect of effects) {
    if (!effect || typeof effect !== 'object') continue;
    const spec = EFFECT_OPS[effect.op];
    if (!spec) {
      errors.push(`[${where}] unknown effect op "${effect.op}"`);
      continue;
    }
    if (spec.value === 'number' && effect.value !== undefined && !isNum(effect.value)) {
      errors.push(`[${where}] "${effect.op}" value expected number, got ${typeof effect.value}`);
    }
    for (const key of spec.nested ?? []) {
      const nested = validateEffects(effect[key], `${where} > ${effect.op}.${key}`);
      errors.push(...nested.errors);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Validate one predicate tree against PREDICATES. */
export function validatePredicate(pred, where = 'unknown') {
  const errors = [];
  if (!pred) return { ok: true, errors };

  // A bare array is shorthand for all-of.
  if (Array.isArray(pred)) {
    for (const p of pred) errors.push(...validatePredicate(p, where).errors);
    return { ok: errors.length === 0, errors };
  }

  const spec = PREDICATES[pred.pred];
  if (!spec) {
    errors.push(`[${where}] unknown predicate "${pred.pred}"`);
    return { ok: false, errors };
  }
  if (spec.combinator) {
    const of = Array.isArray(pred.of) ? pred.of : [pred.of];
    if (!pred.of) errors.push(`[${where}] "${pred.pred}" requires an "of" array`);
    for (const p of of) errors.push(...validatePredicate(p, `${where} > ${pred.pred}`).errors);
  } else if (spec.value === 'number' && pred.value !== undefined && !isNum(pred.value)) {
    errors.push(`[${where}] "${pred.pred}" value expected number, got ${typeof pred.value}`);
  }

  return { ok: errors.length === 0, errors };
}

/** Flatten an object to dot-paths, skipping `_`-prefixed documentation keys. */
function walk(obj, prefix, visit) {
  for (const [key, value] of Object.entries(obj ?? {})) {
    if (key.startsWith('_')) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      walk(value, path, visit);
    } else {
      visit(path, value);
    }
  }
}
