# Untitled Project

A browser-based survival and management simulation set in a sealed underground
settlement governed by layered deception. The player manages physical
infrastructure and writes the law that governs it — and discovers, chapter by
chapter, who is actually in charge.

**Status:** first vertical slice runs. The clock, the layered data loader, the
effect and predicate interpreters, power distribution, haulage with named
porters, and the animated SVG cross-section all work end to end. Everything
else — the other seven systems, governance, dilemmas, revelation staging,
chapter drivers — is still stubs.

## Running it

No build step. Native ES modules, served over HTTP (modules will not load from
`file://`):

```
npm run serve
```

Then open `http://localhost:8000`.

`tools/serve.py` is a plain standard-library static server that adds
`Cache-Control: no-store`. That header matters more than it looks: with no
build step, nothing invalidates a cached file, so `python3 -m http.server`
will happily serve a stale module or data file after you have edited it — and
the symptom is a change that appears to do nothing.

`package.json` carries no dependencies. It exists so Node's test runner treats
`.js` files as ES modules, matching how the browser loads them.

```
npm test          # node --test
npm run sim       # play the opening headlessly, one line per day
npm run sim -- --days 60 --every 5 --set population.foodPerCapitaPerTick=0.02
```

`tools/simRun.mjs` is the balance instrument: it builds a run exactly as the
browser does and prints population, health, food, water, air, power, stores,
the meters and the labour pool per day, plus strikes, riots and breakdowns.
`--set` overrides any tunable for an experiment without touching the data.

## Layout

```
concept/          design documents — the source of truth for intent
src/
  core/           game loop, state, clock, event bus, commands, run assembly,
                  and the effect/predicate interpreters
  config/         layered config resolution, content loading, schema, seeded RNG
  systems/        the physical simulation
  governance/     the Accord, Core Mandate, precedent, Apocrypha
  narrative/      dilemmas, revelation staging, Board relations
  chapters/       per-chapter logic and plot mechanics
  ui/
    view/         the animated SVG cross-section (viewport, sprites, figures)
    screens/      dashboard, accord, board, infrastructure
    components/   time controls, meters, log, dilemma modal
    styles/       tokens, base, screens
  save/           serialisation and migration
  utils/
tools/            serve.py — the no-cache dev server
resources/
  data/
    manifest.json the data layer's entry point — every file is enumerated here
    config/       layered scalar tunables + catalog patches
    catalog/      entity definitions the simulation reads
    content/      narrative payloads — dilemmas, directives, beats, roster
  assets/         images, audio, icons, fonts (+ manifest.json)
tests/
```

Naming and data-shape rules live in [CONVENTIONS.md](CONVENTIONS.md).

## Architecture rules

These are the constraints the structure is built to protect. Breaking one is a
decision worth making explicitly, not by accident.

**Content is data, not code.** Every number, statute, dilemma and Board member
lives in `resources/data/` as JSON. If a balance change requires editing a file
in `src/`, something is in the wrong place.

**The data layer has three tiers, split by merge semantics.** `config/` holds
scalar tunables (dot-path merged). `catalog/` holds entity definitions that
layers patch by id. `content/` holds narrative payloads that self-gate on
chapter and preconditions. Arrays are never deep-merged; a layer changing one
entity in a list addresses it by id through a `patch` block.

**Every data file is enumerated in `resources/data/manifest.json`.** There is
no build step and no directory listing over `fetch()`, so the manifest is the
entry point, not a convenience.

**Configuration is layered, never hardcoded.** Values resolve through
`base → chapter → shaft → mission → event → sandbox`, each layer overriding the
last key by key, with provenance recorded so a playtest report can name which
layer supplied which value. `config/schema.js` validates every layer on load.

**`effects` and `preconditions` are two shared mini-languages.** Both appear
across dilemmas, statutes, framings, directives, buildings and beats, and both
have exactly one grammar and one interpreter. The vocabularies are declared in
`config/schema.js` as `EFFECT_OPS` and `PREDICATES` — content using an
undeclared op fails validation rather than silently doing nothing.

**Determinism is a requirement, not a nicety.** Nothing calls `Math.random()`.
Every random draw comes from a named seeded stream declared in
`core/streams.js`, so adding a draw in the narrative code cannot shift the
economy's sequence. Draw counts live in `state.meta.rngCursors` and are
replayed on load, so a save resumes without diverging.

**A run is `seed + configHash + commandLog`.** Every player action is a
serializable command (`core/commands.js`), so a 2KB log replays a three-hour
run exactly — which is what makes a bug report reproducible. It also keeps the
UI honest: a screen that mutates state directly breaks replay immediately and
visibly. Anything that shapes a run and is *not* a command must be
deterministic from dataset + seed, which is why opening stores live in the
shaft profile and the porter roster is seeded inside `core/run.js`.

**One atomic unit of simulation: `stepOnce`.** Real-time play and headless
fast-forward call the same function, and only `clock.advance()` ever reads
wall-clock. `tests/core/determinism.test.js` asserts the two produce identical
state.

**Systems tick in a fixed order, in three phases.** `core/engine.js` defines
it: *simulate* (each system writes only its own domain, pushing events to a
per-tick outbox), *resolve* (the outbox drains through the event bus), then
*boundary* (decision window, then any requested pause). A hard-pausing dilemma
therefore stops the clock after the tick completes, never mid-pipeline. Systems
talk to each other through the event bus, not by importing each other.

**Animation is never simulation state.** The sim emits discrete facts — a
haulage trip has a route and a tick window — and the view derives position as a
pure function of `(fact, tick + alpha)`, where alpha is the sub-tick fraction
from `clock.accumulator`. No pixel position is ever stored or saved, which is
why pause freezes motion with no pause-handling code in the view. All view
geometry is in *shaft units* mapped to the screen by SVG `viewBox`, so the same
code serves a phone and a 4K monitor.

**One-shot effects and standing modifiers are different things.** A dilemma's
effects apply once through `applyEffects`. A building's `effects` are standing
modifiers, recomputed every tick by `collectModifiers` and never accumulated —
applying a common hall's +6 morale per tick would cap morale in twenty seconds.

**Chapter-specific plot mechanics stay in their chapter.** `nexusChannel.js` and
`presidiumCoup.js` live under `chapters/chapter2/` because they are that
chapter's plot, not reusable infrastructure.

**Chapter 3 is not in this scaffold.** It is documented as vision only and
excluded from v1 on purpose.

## The one thread to be careful with

The scrubber catalyst has no local production recipe, and that is deliberate.
It is seeded as an unexplained external supply in Chapter 1 and becomes the
Presidium's leverage in Chapter 2, when cutting it off demonstrates dependency
without a shot fired. `resources/data/catalog/resources/components.json` marks
it `producibleLocally: false` and, more importantly, **no recipe in
`recipes.json` produces it** — the gap is expressed by absence, which is harder
to break by accident than a boolean. `tests/config/dataIntegrity.test.js` fails
if one ever does. Changing this is a narrative decision, not a balance tweak.

## Terminology

| Term | Meaning |
| --- | --- |
| The Accord | The amendable law document |
| The Advisory Board | The governing council |
| The Chair | The true hidden authority behind the Board |
| The Apocrypha | The restricted archive chamber |
| The Nexus | The covert external directive channel |
| The Core Mandate | Pre-existing doctrine; bounds what the Accord may say |
| The Presidium | The central controlling settlement |
| The Coryphaeus | Head of the Presidium |

## Next

The pipeline is proven, so each remaining system slots into a known shape:
export `tick(state, ctx)`, write only your own domain, emit through `ctx.emit`.

1. **The remaining systems**, in `SYSTEM_ORDER`: water (`greywaterLoop`), air
   (`perLevelAir`), minerals and the component chain, then population proper
   (consumption, morale, unrest, the birth lottery). Air is the interesting one
   — it is tracked per level and consumes the catalyst.
2. **Balance.** Every number in `config/base.json` is a first-pass placeholder.
   Right now demand exceeds generation and food runs down: the sim is correct
   and the values are not. This is the first job that needs playtesting rather
   than code.
3. **Governance**, starting with `statuteEngine.compile` so law cards produce
   real standing modifiers, then the amendment window and precedent.
4. **Dilemmas.** The content, the interpreters and the hard-pause path all
   exist; `dilemmaEngine` needs to select and raise them, and `dilemmaModal`
   needs to present them.
5. **Lift cars.** The freight elevator and dumbwaiter carry trips in the sim
   but draw no moving car: the vector sheet that had one is gone, and the
   pixel rooms need a car sprite driven by `tripPosition`.

Also open: touch gestures and a responsive panel layout for tablet (the view is
already resolution-independent and the panel already stacks below 60rem, but
nothing is driven by touch yet); and whether `morale` and `legitimacy` are
first-class meters or derived reads — both are declared in
`catalog/meters.json` with a note, because the design document's effect tables
use them but its meter table does not list them.

Content still to write: prose fields are `""` throughout `content/` — Board
member names and histories, Accord baseline texts, Core Mandate verses,
Apocrypha bodies, directive texts, beat scenes, and the investigation lead
summaries. The mechanical scaffolding around each is in place.
