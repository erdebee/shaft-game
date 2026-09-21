# Code and Data Conventions

Mechanical rules for how things are named, shaped and organised in this
repository. These are decisions already made — follow them without re-deciding.

For the *architectural* constraints (content is data, config is layered,
determinism, fixed tick order) see the **Architecture rules** section of
[README.md](README.md). For design intent see [`concept/`](concept/).

---

## 1. Naming

### Files

Two rules, split by what the file is:

| File kind | Convention | Example |
|---|---|---|
| **Data files** (`.json`) | kebab-case | `core-mandate.json`, `nexus-directives.json` |
| **JS modules** (`.js`) | camelCase, matching the concern they export | `eventBus.js`, `flowStock.js`, `buildingRegistry.js` |

Data files are kebab-case because their names line up with the kebab-case ids
inside them. JS modules are camelCase because their names line up with the
identifiers they export — `import { createClock } from './clock.js'`.

No snake_case, no PascalCase, anywhere.

> **Decided against:** kebab-case for JS modules too, for one uniform rule.
> Rejected because it would rename ~30 existing files and rewrite every import
> for no functional gain. If that ever happens it should be one deliberate
> commit, not a drift.

Directory names are lowercase, **plural for collections** (`buildings/`,
`profiles/`, `chapters/`), **singular for a single concern** (`config/`,
`save/`, `core/`).

### Identifiers inside JSON

**Kebab-case for every `id` field.** `scrubber-catalyst`, `member-02`,
`rationing-quotas`, `deep-cold`.

Ids are the primary key of the whole content layer. They must be:

- **Stable.** An id is a permanent contract. Renaming one is a migration, not
  an edit — every cross-reference and every save file points at it.
- **Unique within their catalogue.** Two buildings may not share an id. A
  building and a mineral may, but don't do it.
- **Semantic, never positional.** `common-hall`, not `building-14`. The one
  exception is deliberately anonymous roster entries pending characterisation
  (`member-01`), which get real ids once named.
- **Unprefixed by their own type.** `buildings/scrubber-bank`, not
  `building-scrubber-bank` — the catalogue already says what it is.

### JSON keys

**camelCase.** `powerDraw`, `wearPerTick`, `producibleLocally`,
`levelConstraint`. This is the one place camelCase is correct, because keys
are read directly into JS property access.

Keys prefixed with `_` are **documentation, never data**: `_note`, `_layer`.
The loader strips them. Use `_note` freely — a config file that needs a
comment should have one.

### JavaScript

| Thing | Convention | Example |
|---|---|---|
| Functions, variables | camelCase | `applyEffects`, `tickCount` |
| Exported factories | camelCase, `create` prefix | `createGameState`, `createClock` |
| Constants (module-level, frozen) | SCREAMING_SNAKE | `LAYER_ORDER`, `SYSTEM_ORDER`, `SPEEDS` |
| Event names | `domain:event`, colon-separated | `decision:window`, `config:reloaded` |
| Effect / predicate ops | `domain.verb`, dot-separated | `meter.add`, `statute.active` |
| Booleans | affirmative, no `not`/`disable` | `producibleLocally`, `amendable` |

Event names use `:` and effect ops use `.` on purpose — you can tell at a
glance whether a string is a bus channel or a content op.

### Terminology

The project's vocabulary is defined in
[`concept/terminology-glossary.md`](concept/terminology-glossary.md) and it is
**binding on code**. Identifiers use the in-world term, spelled the way the
glossary spells it.

The load-bearing one: the settlement is a **Shaft**. The Presidium's word for
it is a **Facility**, and that gap is a story beat, not a synonym — never use
them interchangeably in code. The word **silo** is not project vocabulary and
must not appear anywhere; it was purged from `LAYER_ORDER` and the profile
layer, and the only remaining trace is the working directory name.

---

## 2. Data files

### The three tiers

`resources/data/` is split by **merge semantics**, not by subject. Putting a
file in the wrong tier means it merges wrongly, so this matters.

| Tier | Holds | Merge behaviour |
|---|---|---|
| `config/` | Scalar tunables and catalog patches | Flattened to dot-paths; later layer wins per key |
| `catalog/` | Entity definitions the simulation reads | Id-keyed; layers patch fields via `patch` blocks |
| `content/` | Narrative payloads | Additive; entities self-gate on `chapter` + `preconditions` |

**Arrays are never deep-merged.** A layer that wants to change one entity in a
list addresses it by id through a `patch` block. If you find yourself wanting
index-based array merging, you're in the wrong tier.

### File shape

Every data file is an object at the top level — never a bare array. Catalogue
and content files carry their collection under one plural key named for its
contents:

```json
{
  "_note": "What this file is for, and any trap in it.",
  "buildings": [ { "id": "…" } ]
}
```

A top-level object means a file can gain metadata later without breaking every
reader. A bare array cannot.

### Cross-references

Reference other entities **by id string**, never by nesting a copy:

```json
"consumes": [{ "id": "scrubber-catalyst", "qty": 2 }]
```

Every id reference is resolved and validated at load. A dangling reference is
a load-time failure, not a runtime `undefined`.

### Numbers

- Rates are **per tick**, and say so in the key: `wearPerTick`,
  `contaminantPerCapitaPerTick`.
- Durations are in **ticks**, not seconds or days: `cooldownTicks`,
  `ticksPerDecisionWindow`.
- Efficiencies, multipliers and probabilities are **0–1 floats**. Meters are
  **0–100 integers**. Don't mix the two conventions in one field.
- A value that is genuinely unset is `null`, not `0` or `""`. `0` is a real
  balance value and must never double as "to be decided".

### Stubs

An unpopulated file still ships with its `_note` and **one realistic example
entity**, so the schema has something to validate and the resolver has
something to merge. Empty prose fields are `""`; empty numbers are `null`.

---

## 3. The two content mini-languages

`effects` and `preconditions` appear across dilemmas, statutes, framings,
directives, buildings and beats. They share **one grammar and one interpreter
each**. Do not invent a local variant for a new content type.

**Effects** are a flat list of ops, applied in order:

```json
[
  { "op": "meter.add", "target": "trust", "value": -10 },
  { "op": "precedent.record", "theme": "scarcity", "leaning": "harsh" }
]
```

**Predicates** are composable via `all-of` / `any-of` / `not`:

```json
{ "pred": "all-of", "of": [
  { "pred": "chapter.is", "value": 2 },
  { "pred": "not", "of": [{ "pred": "statute.active", "target": "curfew" }] }
]}
```

The full op and predicate vocabularies are declared in
[`src/config/schema.js`](src/config/schema.js) as `EFFECT_OPS` and
`PREDICATES`. **Adding an op means adding it there**, or validation rejects
content using it. That file is the contract between content and code.

---

## 4. Modules

**One concern per file, named after it.** `flowStock.js` handles flow and
stock resource bookkeeping and nothing else.

**No cross-system imports.** Systems talk through
[`src/core/eventBus.js`](src/core/eventBus.js). A system importing another
system directly is the one structural rule whose violation is hardest to undo
later.

**Every module opens with a block comment** stating what it owns and why it
exists — the existing stubs model this. It is not decoration: it is where the
*why* lives, and reviewers rely on it.

**Systems export a `tick(state)`.** The engine calls it; the system never
calls the engine.

**No `Math.random()`.** Every draw comes from a named seeded stream in
[`src/config/rng.js`](src/config/rng.js). A new random draw gets a new named
stream rather than borrowing an existing one, so adding narrative randomness
cannot shift the economy's sequence.

**Nothing writes to `gameState` outside its own domain.** `population` does
not reach into `state.resources`; it emits, and resources responds.

---

## 5. Tests

Mirror the source tree: `src/systems/resources/flowStock.js` is tested by
`tests/systems/flowStock.test.js`.

Node's built-in runner only — no framework, matching the zero-dependency
stance. Use `test.todo()` to record a test that should exist before the code
it covers does; the existing stubs do this and it's the intended pattern.

Any test involving randomness passes an explicit seed. A test that fails
intermittently is a broken test, not a flaky system.
