# Visual Design Principles

*The art direction for the Shaft. What the game looks like and why. The exact
pixel dimensions, file naming and generation recipes that implement this live in
[asset-production-spec.md](asset-production-spec.md).*

This document is **binding on assets** the way
[terminology-glossary.md](terminology-glossary.md) is binding on code. An asset
that contradicts it is wrong even if it is beautiful.

---

## 1. Statement of intent

A cutaway of a machine that people live inside.

The player looks at the Shaft side-on, the way you look at an ant farm — dozens of
levels stacked in the dark, each one lit from inside by its own lamps, with nothing
above the top level and nothing below the dig face but rock. Every surface is
artificial. Every light is a fixture someone has to maintain. Nobody on screen has
seen the sun.

The register is **quiet bureaucratic dread**, not horror. Nothing lunges out of the
dark; the dark is simply where the shaft ends. The dread is that this all works,
and has worked for generations, and is entirely dependent on things nobody alive
understands. Balance that with small human evidence — laundry lines, a canteen with
the lights on, a school — so the picture reads as a *settlement* under strain
rather than a tomb.

The reference for *how it is drawn* is **16-bit SNES sidescroller pixel art** —
flat, hard-edged, a handful of shades per material. See §2; it is a hard
constraint, not a mood.

Technologically this is **dieselpunk**: an industrial-age imagination of the
future. Combustion, steam, brass, bakelite and analogue gauges, scaled up past what
those materials should sustain. Not retro-futurism as nostalgia — retro-futurism as
the only toolkit the founders had, kept running on repairs for eighty years.

---

## 2. Camera and projection

**Strict orthographic side elevation, drawn flat.** No perspective, no vanishing
point, no isometric, no three-quarter view — and no rendered volume either.

### The reference

**16-bit SNES-era sidescroller pixel art.** Not modern high-detail pixel art, not
painterly pixel art, not rendered 3D reduced to a small canvas. The specific look
of a Super Nintendo platformer's background and props: flat blocks of colour, hard
edges between them, a small number of shades per material, and depth implied by
*layering and value*, never by modelled light.

**The house style within that is Eastward (Pixpil).** It was picked from twenty
game references (`probe/v4`, `probe/v5`). It gives a cozy, lived-in,
retro-industrial underground in desaturated teal and dusty terracotta over soft
warm browns. It allows a little more soft two-tone modelling than a strict SNES
flat. It is 16-bit in scale and clean at a glance, but **richly detailed**: many
colour variations per material, strong lamplight and shadow, dithered light
falloff, and textured, lived-in back walls with props and wear (since v15; the
earlier "low texture" wish is withdrawn). Everything else in this section still
binds, above all the flat side view. The reference renders for the detail
level are the v16 rooms, for example `probe/v16/workshop-on.png` and
`probe/v16/superior-suite-on.png`.

This is a concrete, checkable target. Richness lives in colour, light and
surface detail, never in depth: an asset with modelled perspective or a receding
floor is wrong however good it looks, because stacked forty deep in a column the
depth cues fight each other, and a room that recedes makes the flat ones beside it
look broken.

### Flatness rules

- **Pixel shading, not rendering.** Many shades per material are fine, and light
  falls off in dithered steps. No smooth gradients, no airbrushed glow, no
  ambient occlusion, no rendered specular.
- **Hard edges.** Colour changes on a pixel boundary. Dithering is wanted, for
  light falloff and material texture; anti-aliased blur is not.
- **No modelled volume.** A pipe is a rectangle with a light band and a dark band,
  not a cylinder with a gradient wrapped around it.
- **Nothing recedes — except a room's side walls.** No floors running away from
  the viewer, no ceiling drawn in perspective, no furniture at an angle. A room is
  a *flat wall with things attached to it*, which is exactly how a SNES
  sidescroller drew an interior. The one sanctioned exception is the slanted side
  wall, below — and for rooms it is not optional.

### Corollaries

- Floors are horizontal lines. Walls are vertical lines. No foreshortening.
- Round things (tanks, flywheels, fan housings) are drawn as circles, not ellipses.
- A building's footprint is its *width*. Nothing has visible depth into the page.
- Figures face left or right, never toward the viewer.

### Slanted side walls — mandatory for rooms

**Every room shows its left and right side walls as narrow slanted wedges.** A
room is an enclosed space with walls of its own — the generator hall, a
family house, the council chamber. Its outer edges run inward toward the back wall
by a few pixels, so it reads as a space cut *into* the rock rather than a panel
stuck on the front of it. This is mandatory: a room without slanted side walls is
wrong in the same way as a room with a receding floor, and is regenerated.

The slant is a bevel, not a camera:

- A few pixels deep, at both the left and the right edge.
- The floor band and the ceiling band stay horizontal.
- Nothing inside the room follows the slant. Floor tiles converging, a ceiling
  drawn in perspective, or furniture angled to match the wedge turn the bevel into
  a vanishing point and fail this section.

**Open areas slant only where they end.** Some spaces are not rooms. The grove
(the arboretum), the mines at the dig face and the central stairwell are large
continuous areas, not closed-off spaces. Their side walls appear only where the
area as a whole ends — against rock, against a neighbouring room, or at the shaft
wall. Wherever the area continues into more of itself there is no wall and no
slant, and the content runs straight on across the join. How open-area sprites
carry their ends is in the production spec, §2.2.

**Every room spans exactly one level.** Nothing built in the build area crosses a
floor slab. The only spaces that run vertically through several levels are the
central stairwell and mine shafts / mine elevators.

### Figures — one scale for everyone

**Every person in the game is drawn to one body at one scale.** An adult is
**35–39 px tall** from the top of the head to the sole; a child is about 30 px.
That size holds in every room, at every depth, in every state. It is the yardstick
the player uses to judge how big everything else is. If it varies, the generator
hall and the family house stop being the same world.

At 36 px a figure is a bit over a third of a room's 96 px height: chest-high to a
counter, a head shorter than a doorway. The machinery still stands two to three
people tall. *(Changed 2026-09-22 from 22 px after `probe/v24`: the rooms' furniture
was drawn for a person this size, and at 22 px every adult read as a child. The
accepted set lands in a 4-px band rather than on one exact number — a generated
figure cannot be held to the pixel, and 4 px reads as ordinary variation in
height; asset-production-spec §4.2.)*

**Rooms are drawn empty of people.** Figures are their own layer (§3), placed
from staffing and haulage, so a room render never contains a person. Figures
baked into room renders came back anywhere from 10 to 28 px tall across the probe
rounds. The only way to keep one scale is to have one set of figure sprites.

**How a figure looks:** side profile facing right (mirrored for left), standing,
a one-pixel dark outline all around, a single pixel for the eye, no mouth, and two
shades per material. At 1× a role is recognised by two things only: its **headgear
or tool silhouette** (cap, hard hat, brimmed hat, crate on the back) and its **main
garment colour**. Every role gets a distinct pairing of the two. The exact pixel
spec, costume table and recipe are in the production spec, §4.2.

### Depth

Depth into the page is carried by exactly two devices: a **darker, lower-contrast
back-wall layer** behind the machinery, and the **slanted side walls** of rooms.
The first is a layer sitting behind another layer; the second is a few pixels of
bevel at a room's edges. Neither is a surface drawn in perspective.

This is the hardest rule in the document, and both halves of it fail the same way.
A single object drawn in perspective breaks the cutaway; a single object rendered
with volume breaks the register. Anything that arrives with either is regenerated
rather than nudged.

---

## 3. Layer stack

Back to front. Each layer has one job. A building's own state is expressed by
swapping to that state's render of the building (§7); conditions that cover a
whole level are expressed by changing a layer.

| # | Layer | Content | Bound to |
|---|---|---|---|
| 1 | Rock | Undisturbed strata around and below the Shaft | depth band |
| 2 | Back wall | The far side of each level's interior — darker, flatter | depth band |
| 3 | Structure | Floor slabs, stairwell, lift bore | depth band |
| 4 | Buildings | Each placed building, drawn in the render for its current state — `on`, `off` or `broken` (§7) | `buildingId`, `powered`, condition |
| 5 | Figures | Porters on the stairs, workers in buildings | `haulage.trips`, `staffing` |
| 6 | Foreground | Pipe and cable runs crossing in front of everything | depth band |
| 7 | Atmosphere | Per-level haze tint, steam, dust in lamp pools | `airQuality` |
| 8 | Vignette | Darkening toward the frame edges | constant |
| 9 | UI | Dashboard, panels, gauges, alerts | — |

Layers 4, 7 and 8 are where nearly all the mood lives. Layer 6 is what stops forty
levels of flat elevation reading like a spreadsheet — a cable bundle crossing in
front of a building says "this place was assembled over decades" in a way no amount
of detail *inside* the sprite can.

The renderer already carries the state hooks these layers need: `.unpowered`,
`.broken`, `.sealed` and `data-air` on the level node — see
[`src/ui/styles/screens.css`](../src/ui/styles/screens.css). `.unpowered` selects a
building's `off` render and `.broken` its `broken` render. The art plugs into
those hooks; it does not invent new ones.

---

## 4. The depth-band style gradient

**The core of this document.** The Shaft is not uniformly shabby. It gets grander
as you go up, and the gradient is the fastest way to show a player that this is a
society with a hierarchy, before a single line of dialogue.

Bands use the ids already defined in
[`resources/data/catalog/infrastructure/levels.json`](../resources/data/catalog/infrastructure/levels.json),
so art and simulation can never drift apart.

|  | `deep` — **The Works** | `mid` — **The Body** | `shallow` — **The Crown** |
|---|---|---|---|
| **Levels** | 29 → the dig face | 13–28 | 1–12 |
| **Holds** | Generator, pumps, reclamation, smelter, dig face | Habitation and cultivation — most of the population | Council chamber, archive, grove, security |
| **Surfaces** | Raw hewn rock, shotcrete patches, riveted plate bolted straight over gaps | Painted steel panelling over concrete, uniform enamel signage | Lacquered dark wood, brass and bronze, pressed-tin ceiling plates, enamel |
| **Geometry** | Improvised. Nothing lines up; additions are obvious | Standardised. Repeating modules, consistent heights | Composed. Symmetry, a centre line, deliberate proportion |
| **Wear** | **Structural.** Rust bleeding down walls, three layers of mismatched paint, jury-rigged cable bundles, tarps, chain hoists, props holding things up | **Cosmetic.** Scuffs and grime at hand height, dents, worn treads. Maintained, just tired | **Patina.** Tarnished brass, worn carpet runners, hairline crazing in enamel. Old money, not neglect |
| **Light** | Few harsh caged bulbs; deep shadow pools between them; furnace glow | Even rectangular wall lamps in wire cages; lamp glow from hydroponics | Frosted-glass sconces, warm and plentiful — still dim by surface standards |
| **Motifs** | Leaking flanged joints, steam wisps, floor gratings, soot, hand-stencilled numbering, exposed flywheels | Clipped duct runs, laundry lines, personal clutter, notice boards, bunk rows | Chevron and sunburst inlays, brass-bezelled gauges, fluted pilasters, engraved plaques, glass-fronted cabinets |
| **Palette skew** | Rust, soot, ash, with sodium pools | Concrete grey and institutional green-grey, with amber | Oxblood, bronze, deep enamel green, cream, with amber |
| **Sound of it** | Hammering, pressure release, water | Voices, machinery at a distance | Clocks, paper, footsteps on stone |

### The rule that keeps this from going wrong

**The upper levels are grander, not cleaner.**

They are still riveted. Still underground. Still lit by flame-coloured lamps. Still
bounded by rock you can see at the edges of the panelling. The difference is that
someone spent resources making them look *intentional* — panelling over the
concrete, a moulding where two surfaces meet, brass instead of painted steel on the
same gauge.

The failure mode to avoid is the upper levels reading as a different, nicer game —
a clean lobby, a modern office. If a `shallow` asset would look at home in an
untroubled building on the surface, it is wrong. Every level of the Shaft should
read as the same organism; only the tailoring changes.

The mirrored failure mode: `deep` reading as a ruin. It is not abandoned, it is
*working* — hard, constantly, and held together by people who are good at their
jobs. Scrappy means repaired, not derelict. A patch plate is evidence of
competence.

### Transitions

Bands change over 2–3 levels rather than at a hard line. Level 12 is not panelled
and level 13 bare; the wood panelling thins, the mouldings stop, the lamps get
plainer. A player scrolling down should feel the change without being able to name
the floor it happened on.

---

## 5. Shared vocabulary

Every asset draws from one kit, so a clinic and a smelter read as the same world.

**Materials:** riveted steel plate with rounded corners · cast iron · brass and
bronze · bakelite · enamel paint over steel · reinforced concrete · bare rock ·
wired glass · canvas and webbing · hardwood (upper levels only).

**Components:** analogue gauges with bezels · exposed flywheels and belt drives ·
cage lamps · mesh grating and diamond plate · flanged pipe runs with visible bolts
· lever switchgear and knife switches · riveted seams every few units · ducting
with banded joints · valve wheels · chain hoists · stencilled slab-serif numbering
and amber/black warning chevrons.

**Type, in-world:** stencilled uppercase on machinery; engraved slab-serif on
plaques; handwritten chalk or grease pencil for anything temporary. Never a
typeface that postdates the founders.

### Banned

This list does more work than the allow list.

- **No neon, no holograms, no glowing volumetric anything.** This is not cyberpunk.
- **No chrome, no white plastic, no clean sci-fi.** Nothing looks new.
- **No LCD or LED screens.** One exception in the entire game: the Nexus in the
  Apocrypha, whose whole narrative point is being an anachronistic object nobody
  can explain ([game-design-document.md](game-design-document.md) §6).
- **No sky, no daylight, no exterior.** Not once, in any asset, at any level. The
  single video feed of the surface is a narrative object, not a background.
- **No greenery** outside hydroponics, the oxygen garden and the grove — and there
  it is lamp-lit and cultivated, never wild.
- **No fantasy**, no magic, no ornament without a function it once served.
- **No modern branding, logos or iconography.**
- **No rendered-3D look.** No soft gradients, no ambient occlusion, no painterly
  shading, no high-detail "pixel art" that is really a downscaled render. See §2.
- **No receding floor.** No floor plane, no floor tiles vanishing toward a
  horizon, no furniture standing "behind" other furniture on a ground surface.
  See §2, The ground line.

---

## 6. Palette

> **Palette forcing is suspended for sprites (2026-09-21).** Rooms and figures are
> generated in the Eastward style (§2, production spec §4) without a forced
> palette, because the renders read as one set without it. What follows still
> holds for the **UI, overlays and tints**, which read from tokens.css. The colour
> *meanings* below — reserved amber, red for alarm, cold blue kept back for
> Chapter 2, contrast discipline — still apply to sprites as art direction,
> checked by eye rather than enforced by the generator.

**Palette v2 is locked**, and lives in
[`src/ui/styles/tokens.css`](../src/ui/styles/tokens.css). It was derived from two
approved images: the supplied style reference `resources/assets/style-image.png`,
which sets the neutral ramps and the near-black, and the sodium-industrial probe,
which sets the light. Cool steel and concrete as material; warm sodium as the only
light source.

The palette is now a **generation-time contract**, not just a stylesheet.

Pixel art bakes colour into the asset, so [`src/ui/styles/tokens.css`](../src/ui/styles/tokens.css)
can no longer recolour a sprite the way it recolours the placeholder SVG sheet.
Instead tokens.css remains the **single authority** for what the colours are, and
every generation is forced to that palette (see the production spec). UI, overlays
and tints still read from the tokens, so the two halves stay in agreement.

### Structure of the palette

- **Near-black** — rock, the void, and the outline colour, all one value. It is
  28% of the reference image by area. Nothing in the game is darker.
- **Cool steel** and **warm grey concrete** — the two material ramps, six or seven
  steps each. The largest share of every frame by area. Low saturation.
- **Band ramps** — three tuned sub-ramps, one per depth band, per the table in §4.
- **Reserved colours**, which carry meaning and are never used decoratively:

| Colour | Means | Used by |
|---|---|---|
| **Sodium amber** | Light. Warmth. Something is running | Every lamp and furnace in Ch. 1 |
| | *This is why a brownout needs no art: lose the amber and the level is cold grey* | |
| **Sickly green** | A terminal is on | Displays, readouts |
| **Cold blue** | The Nexus, and the outside | Ch. 2 only, deliberately alien |
| **Red** | Alarm | Alerts, klaxons, critical states only |

Using cold blue for a decorative water pipe in Chapter 1 spends the Nexus's
entrance for nothing. Using red for a painted door means the player learns to
ignore red. Reserved colours are a budget.

### Contrast discipline

- A building's **silhouette** must read against rock at 1× in its `off` render.
- Value carries structure; hue carries meaning. Desaturate first, then check the
  frame still parses.
- The darkest value in the palette belongs to the rock and the empty shaft, so the
  inhabited parts are always the brightest thing on screen.

---

## 7. Lighting and state legibility

**Light is the primary storyteller, and a building's state is carried by a full
render of the building in that state.**

Every building is drawn more than once: the same room, the same composition,
pixel for pixel, in each state it can be in. The lamps, the glow, the activity
and the damage are baked into each render, not layered on top. A light that is
drawn as part of the room looks like it belongs to the room. An additive glow
layer over an unlit base never quite does, and it cannot show a room that is
idle, or one that is wrecked.

| State | Reads as | Mechanism |
|---|---|---|
| **On** — powered, working | Lamps lit, furnace glowing, gauges alive, the room in use | `on` render — the master every other state derives from |
| **Off** — unpowered or idle | Lamps dark, nothing running, nobody working. Cold. Still there, but dead | `off` render |
| **Broken down** | Visible damage — a burst pipe, scorch, a dead or flickering lamp, a part stopped mid-stroke | `broken` render + animation halt |
| **Degraded condition** *(optional per building)* | Grime and rust, a lamp out, tired | `damaged` render where a building warrants one; otherwise the shared grime and rust overlay set over `on` |
| **Sealed level** | Shutters across the level, warning chevrons | Level overlay |
| **Air: poor / critical** | Haze tint over the whole level, thickening | Existing `data-air` tint |
| **Brownout** | The level dims as a whole, lamps first | Rooms drop to their `off` render one by one, under a level-wide dimming tint |

The states of one building must **register exactly**: same canvas, same geometry,
same position for every object. Only light, activity and damage change. That is
what lets the renderer swap or crossfade between them without the room jumping.
The production spec (§4) covers how the variants are generated from the approved
`on` render.

A brownout should be *felt* — the eye notices a level going dark long before it
notices a number changing in a panel. This is why `off` is its own render and
not simply a darkened `on`: a room with its lamps out has to look genuinely
unlit.

### Where light comes from

Every light is a fixture that exists in the world and draws power. No ambient fill
from nowhere. A level with its lamps off is genuinely dark, lit only by whatever
machinery is still burning on it — which is exactly the picture the power system
should be painting during a crisis.

---

## 8. Motion

Motion comes in three kinds, and the art is produced to fit them:

| Kind | What it is | Made of |
|---|---|---|
| **Ambient loop** | Fans, flywheels, fire, bubbling vats; flickering lamps | A full-room frame strip over the `on` render, or a dimmed `on` the lights dip to (spec §2.5) |
| **State transition** | Doors, shutters, a room powering up or going dark | Two state renders plus a short crossfade |
| **Sim-time motion** | Lift cars, porters on the stairs | Driven by trip interpolation, never by keyframes |

### The motion budget

Forty levels of ambient animation becomes noise. Rules:

- **At most one ambient loop per building.** The building's single most
  characteristic moving part, and nothing else.
- **Loops are slow.** 2–4 second cycles. This is heavy machinery, not a slot
  machine.
- **Glow pulses are subtle** — a breathing furnace, not a blinking light. Anything
  that blinks means an alarm.
- **Ambient motion stops when the clock is paused.** Already enforced by the
  `.paused` class; art must not rely on motion to be legible.
- **Steam and dust are the exception** — sparse, slow, and worth the exception
  because they are what make a still frame feel like a working place.

---

## 9. Chapter shift

| | Ch. 1 — The Mayor | Ch. 2 — The Chair | Ch. 3 — The Coryphaeus *(vision only)* |
|---|---|---|---|
| Register | Warm amber industrial | The same, plus a cold hidden layer | Schematic network map |
| Added | — | Nexus cold blue; the Apocrypha's older, dustier, analogue warmth | Control-room styling |

**This is a grade and an overlay, never a second asset set.** The Shaft does not
get repainted between chapters — the player's relationship to it changes, and the
picture is coloured accordingly. Implementation is the `[data-chapter]` token swap
that tokens.css already sets up, plus a grade layer.

Stated explicitly because with baked palettes the temptation to regenerate
everything per chapter is real, and it would triple the asset count to express
something a tint expresses better.

The Apocrypha is the one genuinely new visual space in Chapter 2: older than the
rest of the Shaft, analogue, physical texts and sealed containers, with the Nexus
as the single anachronistic object at its centre. It should not look dieselpunk. It
should look like something the dieselpunk was built on top of.

---

## 10. UI chrome

The dashboard is a **retro-terminal instrument panel**, and it is diegetic: the
player is reading the Shaft's own instruments, not a game HUD.

- **Panels** are riveted metal frames with recessed faces, not floating cards.
- **Meters** are analogue — needle gauges and bar tubes with tick marks and
  engraved labels, rather than flat progress bars.
- **Alerts** are klaxon-style: an amber/black chevron bar, a lamp that lights.
- **Type:** a generated bitmap face for headings, numerals and gauge labels, where
  the retro character earns its keep. Dense body text — dilemma prose, log entries,
  Accord text — stays in the system monospace already in tokens.css. Legibility
  beats period accuracy for anything the player has to actually read.
- **Texture:** subtle scanline and a slight glass curvature on readouts. Subtle
  enough that nobody notices it until it is removed.

The UI is bound to the world by style, not by theme: panel frames are generated
using an approved building sprite as a style reference, so the dashboard is made of
the same metal as the Shaft.

---

## 11. Open

- The Apocrypha's detailed visual design — deliberately still open, per
  [game-design-document.md](game-design-document.md) §9.
- Chapter 3's schematic register, once Chapter 3 is more than vision.
- Whether the dig face gets bespoke treatment as the one place the Shaft is
  actively growing.
- How the two vertical spaces — the central stairwell and mine shafts / mine
  elevators — treat the structural slab where they cross from one level to the
  next. §2 settles that rooms never cross it, and settles these spaces' side walls,
  but not their floor and ceiling.
- Which states beyond `on`, `off` and `broken` each building needs (§7).
