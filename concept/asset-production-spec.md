# Asset Production Spec

*The mechanical half of the visual direction. Exact dimensions, file layout,
naming, PixelLab recipes and the acceptance checklist. The reasoning behind all of
it is in [visual-design-principles.md](visual-design-principles.md) — read that
first; this is the sheet you work from while generating.*

---

## 1. The grid

Every dimension in the game derives from one number: **a build slot is 64×96
pixels.**

```
Build slot         64 × 96 px          10 slots per level
Level pitch       104 px               = 96 clear interior + 8 structural slab
Shaft width       788 px               = 128 stairwell + 10 × (64 slot + 2 seam); no lift column

Building sprites   64 × 96             1 slot
                  128 × 96             2 slots
                  192 × 96             3 slots  ← the reference proportion

Column strip      128 × 104            stairwell (continuous stair, §2.2), tiles vertically
Rock / back wall   64 × 104            one per depth band, tiles both ways
Seam               2 px                 dithered fade between neighbouring rooms, drawn by the renderer (§2.1)
Figures            48 × 48 canvas      adult ≈ 36 px, child ≈ 24 px, soles on the floor line (§4.2)
Floor line         row 88 of a room    top of the floor band; figures stand on it (§2.1)
Animated rooms     full-room strip      frames side by side, played over the `on` state (§2.5)

Zoom               integer only — 1× · 2× · 3×, nearest-neighbour
```

**Pixel size is 1×.** A sprite's pixels are screen pixels at 1× zoom: a 192×96
room is authored at 192×96, not generated smaller and scaled up.

> **Decided against: chunkier pixels.** Generating rooms at 96×48 or 64×32 and
> scaling them 2× or 3× into the slot gives genuinely bigger pixels, and it was
> tried across five variants (`probe/chunky/`, seeds 9001–9006). Rejected: at 2×
> the machinery stops being machinery and becomes silhouette, and the dieselpunk
> vocabulary — gauge faces, riveted seams, stencilled numbering — cannot survive
> it. The simplification that *was* wanted came from dropping to 16 colours
> instead, which flattens the reading without destroying the detail.
>
> **If chunk is ever revisited, only integer factors are usable.** 96×48 (2×) and
> 64×32 (3×) divide 192×96 cleanly; 128×64 does not — at 1.5× some source pixels
> become one screen pixel and some become two, the grid breaks, and the chunk
> reads as an accident rather than a style. Chunk is also a whole-game decision,
> never per-asset: mixing 1× and 2× sprites in one column looks like a bug.

**Why 96 tall rather than 64.** A 3-slot room at 192×96 is exactly 2:1, the
proportion of the style reference, and the extra 32px of height is what lets a room
hold what the reference holds: pipe runs across the ceiling *above* the machinery,
a full-height control cabinet, lockers, and figures small enough to give the
machinery scale. At 64 tall the ceiling run and the machine fight for the same
pixels and the room stops reading as a room.

64 stays the horizontal unit because it is a PixelLab native size and because the
slot is the simulation's own quantum. A `deep` machine room is a 3-slot build and
is generated as one 192×96 composition rather than three separate sprites — the
density comes from composing the whole bay at once.

### Why integer zoom

Pixel art scaled by a fractional factor shimmers: pixel rows land on different
numbers of screen pixels and the image crawls as it pans. The viewport therefore
snaps to whole multiples, and the visible level count is *derived* from the chosen
scale rather than the scale being derived from the element height.

At 2× on a 1080p window that is about 7 levels visible, which matches the current
default.

---

## 2. Mapping onto the existing coordinate system

The view is authored in "shaft units" mapped to the screen by SVG `viewBox`
([`src/ui/view/interpolate.js`](../src/ui/view/interpolate.js)). Those units become
**1:1 with reference pixels**:

| Constant | Now | Becomes |
|---|---|---|
| `LEVEL_HEIGHT` | 10 | **104** |
| `SHAFT_WIDTH` | 100 | **788** (768 + ten 2-px seams) |
| `STAIR_X` | 7 | **64** (centre of the 128-px stairwell) |
| `ELEVATOR_X` | 93 | **none**: no lift column (decided 2026-09-22) |
| `BUILD_X` | 16 | **128** |
| `BUILD_WIDTH` | 68 | **removed**: slots are `SLOT_WIDTH` 64, `BUILD_SLOTS` 10, `SEAM` 2 |

`roomRect` returns `x = 128 + 2 × (rooms to its left + 1) + slotIndex × 64`,
`y = levelY(level)`, `width = 64 × slots`, `height = 96` — with the 8 px slab
occupying `levelY(level) + 96` to `levelY(level) + 104`. Counting the rooms to the
left, rather than the slots, keeps every pair of neighbours exactly one seam apart
however many slots each spans.

**Implemented 2026-09-22** in `src/ui/view/interpolate.js`, `viewport.js`,
`shaftView.js` and `roomArt.js`. The placeholder figures are drawn at 11×22 until
the figure sprites (§4.2) replace them at 32×32.

---

## 2.1 What a room sprite is

A building ships as a **finished room with no frame**: its own painted back wall, a
ceiling with beams and pipe runs, a plated floor, and machinery packed wall to
wall. Every pixel of its rectangle is filled. Rooms sit on the structural slab and
2 px apart along a level. The renderer fills that seam (and the one between the
stairwell and the first room) with a dithered fade: each seam pixel takes the
neighbouring room's edge colour, darkened towards a shadow core between the two,
with checkerboard dither on the outer column. Chosen in `probe/v23` (dissolve,
2 px); it is computed from the rooms' edges at runtime, so no seam art is drawn.

```
no frame, no border      rooms sit directly against their neighbours
interior fully painted   back wall, ceiling, floor — the room's own envelope
slanted side walls       MANDATORY — left and right edges slant inward a few pixels
every pixel filled       no_background: false
no people                figures are their own layer (§4.2), never part of a room
floor line at row 88     floor band = rows 88–95; tolerance 86–90, exact row recorded
```

**No people in a room render.** Figures come from the figure layer so that every
person is the same size (principles §2, Figures). A room that comes back with a
person in it has that person inpainted out, or is regenerated.

**The floor line is row 88.** The floor band is the bottom 8 rows (88–95), and
figures stand with their soles on row 87. Generated floors wander: the v9 rooms
put it anywhere from row 85 to 92. So acceptance allows rows 86–90, and the exact
row of each building sprite is recorded as `floorY` on its manifest entry. The
renderer places figures on `floorY`, never on a guessed constant.

**Slanted side walls are mandatory on every room** (principles §2). The left and
right edges slant inward toward the back wall by a few pixels, so a room reads as
a cut *into* rock rather than as a flat panel. A room that comes back with square
edges fails acceptance and is regenerated, the same as one with a receding floor.

It is a bevel, not a projection. The floor stays a horizontal band (§ the ground
line), the ceiling stays a horizontal band, and nothing inside the room follows
the slant. The wedge is a few pixels deep, never enough to imply a camera angle.
The reference for depth and angle is `probe/v8/e-seed14003-flat250.png`: its
corners bevel inward while the wall, floor and machinery all stay flat.

The one exception is an open area, below. It is not a room, and it slants only
where it ends.

**Transparency is for rock, and nothing else.** A room is a built space, so it has
surfaces — you never see raw rock through a working level's back wall.
Transparency means "rock shows here", which is true in exactly one place: a room
deliberately open to the strata, like a dig face or a collapsed bay.

An **empty slot** is therefore not a transparent building. It is bare rock with the
level's structural slab under it — an unbuilt slot should look unbuilt, and that is
the only rock visible inside the build area.

> **Decided against: a bevelled frame around each room.** The style reference draws
> its room as a self-contained card inside a thick steel frame, and it was tried
> both ways — framed cards with knocked-out corners
> (`probe/palettes/*.png`, seeds 6001–6004) against unframed rooms
> (`*-noframe.png`, seeds 5001–5004). Unframed won.
>
> The frame makes a single room look more composed in isolation, but a column of
> them reads as a stack of loose cards rather than a continuous cutaway, and it
> spends pixels on repeated border instead of on the room. The reference is a
> single illustration; the Shaft is forty of them stacked, and that changes what
> the border costs.
>
> `tools/roundCorners.mjs` is kept — it is the tool that knocks corners out of a
> framed sprite, and is still the right thing if a one-off framed asset is ever
> needed.

> **Decided against: framing the level instead of the room.** Also tried. One bevel
> drawn by the renderer around each level bay, with rooms placed inside it. Same
> failure as per-room frames plus a worse one: rooms with no envelope of their own
> tile into a single undifferentiated band.
>
> The state-signalling a renderer-drawn frame would have given us lives in the
> building's state renders (§2.3) and the level overlays instead — not in a
> recoloured frame.

## 2.2 Open areas

Some buildings are not closed rooms but **large continuous areas**. Their side
walls slant only where the area as a whole ends; where it continues into more of
itself there is no wall, and the content runs straight across the join.

| Open area | Id | Why it is open |
|---|---|---|
| Grove / arboretum | `grove` | One planted hall. Adjacent plots read as one space, not a row of rooms |
| Mines | `dig-face` | Worked rock, open to the strata, and it runs on as the dig extends |
| Central stairwell | `stairwell` (structure strip, not a building) | One continuous stair shared by every level |

Any other building is a room unless it is added to this table.

An open-area building therefore ships in **end variants** of the same
composition, named after the ends that carry a slanted wall:

```
<id>-<state>-both.png     stands alone — slanted wall at both ends (reads like a room)
<id>-<state>-left.png     first in a run — wall on the left only, open to the right
<id>-<state>-right.png    last in a run — wall on the right only, open to the left
<id>-<state>-none.png     middle of a run — open at both ends
```

The renderer picks the variant from the building's neighbours on the same level:
a side carries a wall unless the neighbouring slot on that side is the same open
area. For the variants to join cleanly they share one composition, and the content
at an open edge has to continue believably into the next copy's opposite edge.

**Producing them.** Generate the `none` composition as the master, open at both
ends, then add the walls by repainting only the end strip (`inpaint_image` over
the leftmost or rightmost ~16 px) to get `left`, `right` and `both`. Generate the
state variants (§2.3) from each end variant. That is up to 4 ends × 3 states = 12
sprites per open-area building. It is worth it for three buildings; it would not
be worth it for every building, which is one reason the table stays short.

**Stairwell, adopted 2026-09-22:** `sprites/structure/stairwell.png`, **128×104**, one
continuous stair that tiles vertically with no floor or ceiling bands. Each tile holds an
exit landing on the right at the rooms' floor line and a blank sign plate
(`signPlate` in the manifest: x 102–116, y 58–67) on which the game prints the level
number in the 4×6 floor-digit font (`fonts/floor-digits-4x6.json`). Made from `probe/v18`
(Steel A, hand-fixed so the joins line up). The shaft is 788 px: the 128-px stairwell plus
10 build slots and their 2-px seams, with no lift column (decided 2026-09-22).

The stairwell is a structure strip, not a placed building, but it follows
the same rule: it slants only where it meets something that is not stairwell.

**Its treads are a contract.** Porters walk the stair the tile draws — a flight
down to the landing on the left, a turn, a flight back down to the right, and the
level's floor at row 88 — and the control points of that walk are measured off
the tread highlights, in `STAIR_PATH` in
[`src/ui/view/interpolate.js`](../src/ui/view/interpolate.js). Both flights are
drawn at 45°, one pixel across per pixel down, which is what lets straight lines
between a handful of points land on every step. **Redrawing this tile means
re-measuring that table**, or people will walk beside the stairs instead of on
them. `tests/ui/shaftGeometry.test.js` checks that the path repeats with the tile,
stays inside the column and never jumps sideways — it cannot check that it is
aimed at the treads, which is what `probe/v25` is for.

**Every room spans a single level** and is exactly 96 px of clear interior tall.
The only sprites that run vertically across levels are the stairwell and mine
shafts / mine elevators, which tile vertically as column strips like the stairwell
(§1). There is no catalog id for a mine shaft yet. How these two treat the slab
where they cross between levels is still open (principles §11).

## 2.3 State renders

A building is drawn once **per state**, not as one unlit base with an additive
lit layer (principles §7). Every state render has the same canvas and geometry.
Only light, activity and damage change.

| State | File suffix | Required | What changes from `on` |
|---|---|---|---|
| **On** | `-on` | yes — the master | Nothing; it is the reference. Lamps lit, machinery running, the room in use |
| **Off** | `-off` | yes | Lamps dark, nothing running, no workers, no steam. Genuinely unlit, not a darkened `on` |
| **Broken** | `-broken` | yes | Visible damage: burst pipe, scorch, a dead or flickering lamp, a part stopped mid-stroke |
| **Damaged** | `-damaged` | optional | Degraded but still working: grime, rust, a lamp out. Without one, the shared grime/rust overlays sit over `on` |

`on` is generated first and approved. Every other state is made **from** it with
`edit_image` and an instruction that describes only the change (§2.4, step 4).
Image-to-image with `init_image` was tried and rejected in v13. Then check that the state
**registers**: diff it against `on` and confirm nothing moved outside the lamps,
the activity and the damage. A state that shifted the room is regenerated, because
the renderer crossfades between states and any drift shows as the room jumping.

## 2.5 Animation strips and light flicker

Every room that is lit and running has some life in it, one of two ways:

- **Animated rooms** ship `<id>-on-anim.png`: the whole room, frames side by side,
  shown in place of the still `on` render while the room is on. Made with
  `animate_image_pixminimax` and composited through a hand-placed mask onto the
  untouched `on` render, so only the named parts move; the loop is closed by pinning
  the last frame to the first (`probe/v20`). The manifest entry carries
  `animation: { frames, frameMs }`. Seven rooms: presidential suite, main generator,
  canteen, protein vats, smelter, duct fan, purifier.
- **Every other room** ships `<id>-dim.png`: its `on` render with the lamps about 17%
  dimmer. Every colour of `on` maps to exactly one darker colour, weighted by how
  much it darkens in `off`, so the palette, dither and edges stay pixel-exact
  (`probe/v23/dim.py 0.3`). The renderer dips a room to it for 40–120 ms, one to
  three times, after a quiet 15–60 s, on its own schedule per room.

## 2.4 How a room is made — the adopted workflow

**Adopted 2026-09-21**, after probes v9–v12 (see `probe/v12/index.html`). Prompting
alone cannot hold the envelope. It produced perspective boxes and floors anywhere
from row 81 to 90. So every room goes through four steps, cheap ones first:

| Step | What | Tool | Cost |
|---|---|---|---|
| 1. Blockout | Add the building's main masses to `LAYOUTS` in `tools/roomGuide.mjs` (about 15 flat shapes), then run `node tools/roomGuide.mjs <width> room <building-id> --lit` for the lit, dithered guide | local | 0 |
| 2. Layout | `create_image_pixflux` with `init_image` = the **lit** guide at strength **75** for 128 px and wider; **135 and 165 for 64-px rooms** with the flat-wall wording below, which the model otherwise reads as a box seen from the front (v17, v19; 200 loses the props), `shading: "detailed shading"`, `detail: "highly detailed"`, and the detail lead in the prompt (§4). Two seeds per room, then pick | pixflux | 1 per try |
| 3. Master *(optional)* | Only when the layout render is not good enough to ship. `inpaint_image` over the approved layout, masking only the interior: `mask_x 7, mask_y 10, mask_width width − 14, mask_height 78` (open areas: `mask_x 0`, full width). The ceiling, side walls and floor line cannot move. **It redraws the room from the description; it does not keep the layout** (v13) | inpaint | ~20 |
| 4. States | `off`, `broken` (and `damaged`) with **`edit_image`** on the `on` render: a text instruction that changes only light or damage, ending in "keep all the detail, texture and dithering". Pass the `on` render by its PixelLab URL in `image_urls`, not as base64. Up to **four rooms of ≤128 px per call** for the same price; 192 and 256 px rooms go one per call | edit | ~20 per call |

v13 measured **~46 generations per building** with every step, including one inpaint per room and unbatched states for the wide rooms. Skipping step 3 when the layout is good, and batching states four at a time, brings a 128-px building down to about 11 (1 layout + 10 for two batched edits).

- **Open areas** (§2.2) use the `open` guide in steps 1–3, with no side walls. The
  end walls are then added by inpainting the end strips.
- **The floor line mostly holds**: rows 88–92 across the ten v13 rooms. The simple
  suite (92) and presidential suite (91) fall outside the 86–90 tolerance because
  their layout's floor band came out thin. Step 3 locks whatever step 2 produced, so
  check the floor at step 2. Record the exact row as `floorY` (§2.1).
- **Tested in v13 (ten rooms, `probe/v13/index.html`).** Inpainting over the approved
  layout redrew the composition from the text (the generator, the deep pump and the
  hydroponics bay all changed). The results were also grimier than their layouts. For
  the hydroponics bay and the canteen the layout render was the better room, and the
  canteen's master even gained a receding floor. So step 3 is a fallback, not a
  default.
- **States: the edit tool, not image-to-image.** pixflux `init_image` at strength 300
  left lamps lit and fires burning (brightness unchanged). At 150 it destroyed the
  room. `edit_image` gave genuinely dark `off` rooms (brightness 22–43 vs 66–103 lit)
  and damaged `broken` rooms, with the room unchanged. Check the edges of edit output:
  one 256-px render came back with a 1-px white column on each side.

- **The lit guide sets the richness (v15, v16).** The model keeps the guide's palette.
  Flat ~12-colour guides gave rooms of 8–16 colours with plain walls and no
  dithering (v14). `--lit` redraws the blockout in four lighting bands, Bayer-dithered
  where they meet and tinted warm to cool (~35 colours). With detailed shading it
  gives 22–50 colours, dithered light pools and textured walls, and stays flat. At
  strength 50 the extra shading reads as depth and rooms turn into perspective
  interiors; at 75 they hold.
- **Broken states of 64-px rooms** ask for "one single short strip" of warning tape;
  the generic wording criss-crosses the whole room with tape (v16).
- **64-px rooms turn into alcoves.** A tall, narrow frame reads as a doorway or a box
  seen from the front. Describe the back wall as "one flat plane filling the whole room
  edge to edge, no alcove, no inset box" and use strength 135 and 165 as the two tries;
  in v19 that fixed every room that failed at 120/150. Two 1-slot rooms on one 128-px
  canvas does not work: the model ignores the centre line.
- **Never paint a blockout shape in the wall colour.** `P.slate` equals the guide's
  back wall, so shapes drawn in it vanish (the v19 cell bars did).
- **Pale blocks high on the back wall become windows.** Name that object in the
  prompt and add "windowless, no window frame, no glass pane" (the v16 clinic).
- **Passing images.** Pasted base64 sometimes arrives garbled ("Could not decode
  image"; free, but a lost turn). Guides are local, so they go as compact indexed
  PNGs (~1–1.5k characters). Anything already on PixelLab goes by URL.

**No palette forcing for now** (§6). No step passes `color_image_base64`, and
inpaint or edit output is not snapped to a palette.

---

## 2.6 Foreground cuts

A room render is one flat image, so a figure drawn on it stands in front of
everything in the room — including the rail it is holding and the bars it is
locked behind. Rooms with something a person belongs *behind* ship a second
sprite, `<id>-<state>-fg.png`: the same render, transparent except for those
parts, drawn by the renderer **after** the figure layer.

**The cut is a copy, never a subtraction.** The pixels stay in the base render
too, so an empty room looks identical with the cut and without it, and a cut can
be re-aimed later without repainting anything. Removing the rail from the base
instead would leave a hole: the wall behind it was never drawn, and nothing here
inpaints.

Cut by [`tools/cutForeground.mjs`](../tools/cutForeground.mjs), which holds one
recipe per room — rectangles where the object is regular, a colour pick where it
is not:

| Render | What is lifted | How |
|---|---|---|
| `stairwell` | Both flights of guardrail and the landing | Every teal pixel except the wall panels by the lamp, grown once into the shaded half of its dither |
| `holding-cells` | Six bars, head rail, waist rail | Rectangles — the bars are 2 px wide on a 6 px pitch |
| `shaft-exit` | The cell's eight bars, head rail, waist rail and the notice posted on them | Rectangles — the bars are 3 px wide on an uneven 7–9 px pitch |
| `canteen` | The long table on the right | Rectangles — top plank and two legs |
| `school` | Three student desks | Rectangles — slab, legs, cross rails |
| `auditorium` | Eight stools and the lectern | Stencils — the prop sprites' own alpha (§2.7) |

Two things make this cheap. A room's state renders are pixel-aligned with each
other, so one set of shapes cuts `on`, `off`, `broken` and `dim`, each from its
own image so it carries that state's colours. And an animated room's moving
parts are elsewhere in the frame — the canteen table is identical in all eight
frames — so one static cut serves the strip as well as the still.

A colour pick grows into the object's own shading (a thin diagonal is drawn as a
dithered band, and lifting only the lit half leaves a dotted line a figure shows
through) and then drops islands under six pixels, because a two-pixel speck
floating over somebody's chest reads as dirt on the screen.

`tests/ui/foregroundArt.test.js` holds the invariant: same size as its render,
every visible pixel identical to the pixel underneath it, and the same shape
across a room's states.

---

## 2.7 Stamped props

Furniture small enough that the generator cannot draw it is authored by hand
instead, as a free-standing sprite in `sprites/props/`, and stamped into the
room render by [`tools/placeProps.mjs`](../tools/placeProps.mjs).

**When to reach for this.** `create_image_pixflux` needs a canvas of at least
32x32, and `inpaint_image` needs a mask of about that size before it has enough
room to put a silhouette in — which is taller than a stool or a lectern in a
96 px room is allowed to be. Asked for a lectern in a 32 px mask, the generator
returns a good lectern that is 32 px tall, whose board then sits above the chest
of the 38 px figure meant to stand behind it. At 15x11 and 19x22 there is no
generation to do: the silhouette *is* the sprite.

Four rules keep a stamped prop indistinguishable from a generated one:

- **Paint it from the room's own colours.** Sample the render. The auditorium's
  stool and lectern use six colours, all of which the render already contains,
  so stamping widens its palette by nothing.
- **Stamp onto `<id>-<state>-clean.png`**, the render as it came back from the
  generator, and write `<id>-<state>.png`. Re-running after moving a prop
  cannot then pile one stamp on top of another.
- **Map the prop into each state's own light.** A prop is drawn once, lit. The
  `off` and `broken` renders are separate generations with their own palettes,
  so the prop is put through what that render does to every colour of the lit
  one — the median brightness ratio §2.5 already measures — and snapped to that
  state's palette, so no state gains a colour.
- **Cut it back out with a stencil, not a rectangle.** The gap between a
  stool's legs is wall, and lifting that into the foreground hangs a rectangle
  of wall in front of whoever is sitting there. `cutForeground` takes the
  placement table straight from `placeProps.mjs`, so moving a prop moves its
  foreground with it.

A room whose furniture is at fixed columns also names them: `seats` on the lit
manifest entry is a list of x offsets, and `workerSlot` stands that room's
people on them instead of spreading them evenly across the width. A speaker two
pixels off the lectern reads as a mistake; everywhere else there is nothing to
line up with, so the even spread stands.

**Still open:** the figure sprites have no seated pose, so somebody on a seat
reads as standing behind a stool rather than sitting on it. A `sit` clip per
role is the fix.

---

## 2.8 Computed damage

A broken room that contains a screen needs the *picture* to fail, not just the
glass. [`tools/glitchScreen.mjs`](../tools/glitchScreen.mjs) tears the
rectangle inside a screen's frame into horizontal bands and damages each one:
most stay intact, about a quarter slip sideways, and the rest drop out, come
back in the wrong colours, or repeat a band from elsewhere, with two blown
scanlines across the whole width.

Computed rather than generated, for the reason the dim frames are (§2.5): every
colour it writes is already inside that rectangle, so the render's palette and
dithering survive exactly, and a seed makes it repeatable. Asking a generator
for "a distorted image" gets a redrawn room.

It reads the screen out of the untouched `-clean` render and writes only the
screen rectangle back into `<id>-<state>.png`, so it is idempotent and leaves
anything `placeProps.mjs` stamped into that file alone. Order is
`placeProps` then `glitchScreen`, though only because the second one is the one
that reads from `-clean` twice; neither depends on the other's output.

**The proportions are the whole job.** A first pass that corrupted about half
the rows made the panel read as noise, which says "off", not "broken". Pulled
back to a quarter, the dead tree and the horizon still read underneath the
damage, and the screen reads as *this* picture coming apart.

---

## 2.9 Resource icons

One 16×16 icon per resource in the catalogue —
`resources/data/catalog/resources/*.json`, all five kinds — drawn pixel by
pixel by [`tools/resourceIcons.mjs`](../tools/resourceIcons.mjs) from ASCII
maps, the same way §2.7's props are. They are listed in the asset manifest's
`icons` array, not `sprites`, and load at `boot`: a porter can pick a good up
on the first tick.

**Hand-drawn because a generator cannot take the job.**
`create_image_pixflux` rejects a 16×16 canvas outright — its floor is 1024 px
of total area — and a 32×32 generation halved is mush. At this size there are
about two hundred pixels and every one of them is a decision about silhouette.
This is §2.7's lesson one size smaller.

**Why 16.** Shaft units are 1:1 with sprite pixels and zoom is whole-numbered
(§1), so an icon drawn at 16 is 16 units wherever it is used and never scales.
Three plus padding is 58, which fits across the narrowest room (64); it is also
the largest size that sits over a 32 px figure without hiding it, which is what
the porters' carry bubbles need.

**Colours are tokens.** Palette forcing is suspended for room sprites (§6) but
never was for the UI, and these are UI — they are read against a panel, not
against rock. Every value in the tool's palette is a custom property declared
in [`tokens.css`](../src/ui/styles/tokens.css). One reserved colour is
deliberately absent:

- **`--critical`** is alarm. It belongs to the *state* — the bar the shaft
  view draws under an icon whose bin is empty — never to the thing itself. An
  icon that were already red could not go red.

**Water is blue**, in the `--water` ramp. Blue used to be held back for the
Nexus (principles §6); that was dropped, and the droplet was redrawn.

**Silhouette carries the difference before colour does.** Five of the six
minerals are "a rock"; drawn as one shape in five tints they are one icon five
times. Iron is a blunt chunk, copper a chunk with a splinter off it, coal three
rounded lumps, gold a chunk with veins cut across it, limestone pale and round.

`tests/ui/resourceIcons.test.js` fails when a resource is added to the
catalogue without an icon, when an icon names no resource, and when one is the
wrong size or empty. The drawing is not testable and is not tested.

---

## 3. Files and naming

Kebab-case throughout, matching the building ids in
`resources/data/catalog/buildings/*.json` exactly — per
[CONVENTIONS.md](../CONVENTIONS.md) §1, an id is a permanent contract.

```
resources/assets/sprites/
  buildings/<building-id>-on.png       powered and working — the master render
  buildings/<building-id>-off.png      unpowered / idle, lamps dark
  buildings/<building-id>-broken.png   broken down
  buildings/<building-id>-damaged.png  optional — degraded condition (§2.3)
  buildings/<building-id>-<state>-<ends>.png
                                       open areas only; ends ∈ both | left | right | none (§2.2)
  buildings/<building-id>-on-anim.png  animated rooms: frame strip (§2.5)
  buildings/<building-id>-dim.png      still rooms: dimmed `on` for the flicker (§2.5)
  buildings/<building-id>-<state>-fg.png
                                       optional — the part of that render people stand behind (§2.6)
  structure/stairwell.png              the stair spine, one level tall, tiled
  structure/stairwell-fg.png           its guardrails, drawn over the figures (§2.6)
  structure/<band>-rock.png            \
  structure/<band>-wall.png             |  band ∈ shallow | mid | deep
  structure/<band>-slab.png             |
  structure/<band>-stair.png            |
  structure/<band>-lift.png            /
  figures/<figure-id>.png              one per role in §4.2, 32 × 32, facing right
  icons/<resource-id>.png              one per resource in the catalogue, 16 × 16 (§2.9)
  overlays/<state>.png                 grime, rust, shutters, chevrons
  ui/<element-id>.png                  panel frames, gauge faces, klaxon
  probe/                               style probes — never shipped, never in the manifest
```

**Every file is enumerated in
[`resources/assets/manifest.json`](../resources/assets/manifest.json)** using the
`{ id, path, preloadGroup, chapter }` shape its `_plannedGroups` block already
reserves. Building sprites add one field, `floorY`: the row their figures stand on
(§2.1). A foreground cut adds `foregroundOf`, the id of the render it was taken
from (§2.6). Resource icons go in the manifest's `icons` array
rather than `sprites`, and add `w` and `h` (§2.9). There is no build step and no directory listing over `fetch()`, so the
manifest is the entry point, not a convenience — the same hard constraint that
governs the data manifest.

`preloadGroup` is `boot` for structure, figures and UI; `chapter1` / `chapter2` for
anything gated; `lazy` for the rest.

---

## 4. Tool selection

| Asset | Tool | Key arguments |
|---|---|---|
| Building layout | **`tools/roomGuide.mjs --lit`** → `create_image_pixflux` | `init_image` = the lit guide at strength 75, `view: "side"`, **`no_background: false`** (rooms are opaque — see §2.1), fixed `seed`. See §2.4 |
| Building `on` render (master) | the approved layout render, or `inpaint_image` over it as a fallback | interior masked, envelope locked. See §2.4 |
| Building `off` / `broken` / `damaged` renders | `edit_image` on the approved `on` | text instruction that changes only light or damage; batch up to four ≤128-px rooms per call (§2.4) |
| Open-area end walls | `inpaint_image` over the approved `none` master | Repaint only the end strip that gets a wall (§2.2) |
| Rock mass, back wall | **`tools/rockTile.mjs`** | Procedural, seamless, per band. Not generated — see §4.1 |
| Floor slab, edges | `create_sidescroller_tileset` | 32 px tiles; platform set, so it gives the slab its top surface and end caps |
| Stairwell column | `create_image_pixflux` + hand fix | 128×104, vertically tileable (§2.2) |
| Figures | **`tools/figureTemplate.mjs`** → `create_image_pixflux` | 32×32, `init_image` = the role's mannequin template at strength 150, `no_background: true`, facing east. See §4.2 |
| Resource icons | **`tools/resourceIcons.mjs`** | Hand-drawn, 16×16. No generator takes a canvas this small — see §2.9 |
| Animated rooms | `animate_image_pixminimax` over the approved `on` render + mask | Full-room strip, loop closed on frame 1 (§2.5) |
| UI panels, gauges | `create_ui_asset` | `style_image_base64` = an approved building, binding UI to the world |
| Display font | `create_font` | headings and numerals only |
| Palette repair | `reduce_colors` | not in use while palette forcing is suspended (§6) |

**Style knobs**, held constant across every call so 40 assets look like one set.
These are what actually produce the 16-bit SNES register — the prompt wording
alone will not:

```
outline              "selective outline"   dark keyline where a shape meets the backdrop
shading              "detailed shading"    rooms, since v15 (was "basic shading"); see below
detail               "highly detailed"     rooms, since v15 (was "medium detail"); with the lit guide at 75
view                 "side"                never omitted, on any call that accepts it
text_guidance_scale  10                    the flat wording needs pushing to survive
```

**The style lead is Eastward** (picked in `probe/v5`, refined through v16). Every
room prompt opens with this, verbatim:

> Richly detailed pixel art in the style of Eastward (Pixpil): cozy
> retro-industrial underground, desaturated teal and dusty terracotta, warm
> browns, 16-bit. Dithered shading, strong light and shadow, bright highlights and
> deep shadows, warm lamplight falloff rendered with dithering, many colour
> variations within each material.

Then the room's contents left to right, ending "everything in pure side view against
the back wall", then a sentence starting "The back wall is detailed and textured:"
with its materials, wear and fixtures. The envelope and negative tails of §5 follow;
drop the old "three shades per material" and "low texture" phrases.

**Richness replaced low texture on 2026-09-21** (v14 feedback). The v14 rooms
(basic shading, medium detail, flat guides) read as plain: simple backgrounds, low
colour and value range, no dithering. The detail recipe above fixes that without
losing the flat side view. Figures stay on `flat shading` (§4.2).

Backdrops and fills drop further still: `outline: "lineless"`,
`detail: "low detail"`, `text_guidance_scale: 12`.

**`shading` and the guide decide the look together.** On its own, `detailed
shading` pushed rooms toward rendered miniatures and perspective (v4–v11), which is
why rooms ran on `basic shading` through v14. Paired with the lit guide at
strength 75, it gives dithered, richly lit pixel art that stays a flat elevation.
Keep the two together: detailed shading over a flat guide, or the lit guide below
strength 75, brings the perspective back.

### 4.1 The rock backdrop is generated, not drawn

**`tools/rockTile.mjs` makes the rock. PixelLab does not.**

Every attempt to generate it came back as a **brick wall** — regular courses,
mortar lines, stacked blocks — across four rounds and every combination of
wording, including explicit `no bricks, no mortar, no courses, not masonry, not a
brick wall` at guidance 14 (seeds 1006, 7004, 8004, 8005). Image models have a
strong prior that a dark vertical surface is masonry, and at 64×104 in three
shades of near-black there is nothing to out-argue it with.

There is also nothing for a generator to contribute. The rock's whole job is to
**recede**: it is the darkest thing on screen, at the lowest contrast, and it must
not compete with the lit rooms (principles §6). That is a texture, not an
illustration.

Generated, it also solves the other standing complaint. The noise lattice wraps,
so the tile is **seamless by construction** — no visible grid where copies meet,
which no AI-generated fill managed.

```bash
node tools/rockTile.mjs deep     # → resources/assets/sprites/structure/deep-rock.png
node tools/rockTile.mjs mid
node tools/rockTile.mjs shallow
```

Each band draws from its own list of palette tokens, so the strata get colder with
depth: warm earth near the top, cold cut stone at the bottom. Output is three or
four colours, all exact palette tokens, and it is deterministic from its seed —
the same rule the simulation follows.

The same reasoning applies to anything else that is a **fill rather than a
subject**: flat metal plate, plain concrete, a blank back wall. If an asset has no
subject, generate it.

**`create_sidescroller_tileset` is not the answer either.** It makes *platform*
tiles — a floating ledge with finished edges, for a character to stand on. Of its
16 tiles only one is a solid interior fill, and the set is drawn to be looked at,
with the contrast to match. It remains the right tool for the structural slab's
top surface and end caps, and nothing else.

### 4.2 Figures

**Settled 2026-09-22 in `probe/v24`.** Sixteen roles, one recipe, reviewed in the
shaft itself (`probe/v24/shaft/index.html`: the real rooms, zoom 1×/2×/4×, a
version picker per role and keep/drop verdicts).

#### Recipe

PixelLab `create_character`, one call per role:

```
mode        "v3"                       2 generations, 8 directions
size        40                         adults land at 35-39 px; child: size 32 -> 30 px
view        "side"
outline     "single color black outline"
detail      "high detail"
description "side view, <costume>"     plain wording; style words add nothing
```

Only the **east** rotation is used; the renderer mirrors it for west. The earlier
mannequin route (`tools/figureTemplate.mjs` + pixflux at 22 px) is withdrawn: every
standard-mode figure was rejected for having no outline and reading too thin, and
size 48 or `create_character_pro_flash` came out too big for the rooms.

Two failures are worth knowing:

- **The generator crops the canvas.** A figure drawn at the full 40 px loses its
  feet or the top of its head. The teacher failed this way twice. Check the opaque
  box against the canvas edge and re-roll — `probe/v24/shaft/build.py` records a
  `clipped` flag for exactly this.
- **Wording moves the body, not just the costume.** "Of adult height … standing
  upright" lifted a 32-px constable to 36; "stocky", "broad-shouldered" or the
  `proportions` block fixes a figure that reads too thin.

#### Motion

Template animations on the finished figure, east only, **1 generation each**:
`walking-8-frames` (walk) and `breathing-idle` (idle). Both hold the costume and
the height within ±1 px. Custom v3 actions are less reliable and are used only
where a role needs a task loop: the miner's pickaxe swing took four attempts
before one closed its loop.

A v3 animation redraws every frame, so colours drift slightly between them (the
miner's trousers went green mid-swing). `probe/v24/shaft/fixpalette.py` snaps
every off-palette pixel to the nearest colour in the reference frame, which
repairs the drift without touching the drawing.

#### In the manifest

`resources/assets/manifest.json` holds a `figures` block: one entry per role, with
a `still` and any of `walk`, `idle`, `work`. Each clip is a horizontal strip of
square cells and carries its own measurements, so the renderer never inspects the
image:

```
w, h        one cell
frames      cells in the strip           frameMs: time per cell
feet        lowest opaque row            stands the figure on the room's floorY
cx          centre column of the body    mirrored for a west-facing figure
height      opaque height, for the scale check in tests/ui/figureArt.test.js
```

Sprites live in `sprites/figures/<role>-<clip>.png`.

#### Roles

Ids follow `resources/data/catalog/population/jobs.json`, plus `councillor`,
`resident`, `elder` and `child`, who are not jobs. A room's roles come from
`jobs.worksIn`; the four staffed rooms no job names are listed in `figures.js`
(`council-chamber` → councillor, `common-hall` → resident, `battery-bank` →
engineer, `seed-vault` → grower). A room with two jobs alternates them by figure
index, so the archive shows an archivist beside an investigator.

At 1× a role is read from its **headgear or tool silhouette** plus its **main
garment colour**, so no two roles share both.

| Figure id | Costume in the accepted render | Height |
|---|---|---|
| `engineer` | teal overalls over a cream shirt, flat cap, wrench | 38 |
| `miner` | dark brown jacket, yellow hard hat with a lamp, pickaxe | 36 |
| `porter` | cream shirt, brown trousers, small crate strapped high on the back | 35 |
| `grower` | mint apron over cream, wide brimmed hat, watering can | 38 |
| `kitchen-hand` | cream apron over terracotta, headscarf | 38 |
| `pump-tech` | dark teal overalls, heavyset, beard, rubber boots, wrench | 39 |
| `air-tech` | cream coveralls, filter mask, clipboard | 36 |
| `medic` | long cream coat, mint armband, medical bag | 38 |
| `teacher` | brown cardigan, cream shirt, skirt, books under the arm | 36 |
| `constable` | near-black long coat, peaked cap, pale badge | 36 |
| `archivist` | long grey-brown coat, round spectacles, paper bundle | 39 |
| `investigator` | charcoal coat, brimmed hat, notebook | 38 |
| `councillor` | long terracotta coat to the knees, grey hair, hands behind the back | 38 |
| `resident` | terracotta knitted jumper, brown trousers, cloth bag | 36 |
| `elder` | olive-brown shawl, white hair, walking cane, stooped | 38 |
| `child` | mint shirt, short brown trousers, small scarf | 30 |

Amber appears on a figure only as a lamp (the miner's helmet): it is reserved for
light (principles §6).

#### Still open

- **Work loops** beyond the miner's swing: carry, tend, read, repair.
- **Directions.** Only east is generated; a figure that should face the viewer
  (a portrait, a cutscene) needs its other rotations fetched, which cost nothing
  extra — they are already generated.
- **Costume against the room.** A figure in its room's own colours is hard to
  find at 1×; the outline helps but the pairing is worth a pass.

---

## 5. Prompt template

Prompts are assembled mechanically, not improvised. Same template every time:

```
<objects> standing in a row on the ground line, against <band surface>,
<side walls>, a ceiling band across the top, and a single flat floor band at the
very bottom edge with everything standing directly on it, <band wear>,
<shared motifs>, <state>,
16-bit SNES sidescroller pixel art, flat shading, two or three shades per
material, flat blocks of colour, hard edges, no gradients, no volumetric lighting,
completely flat orthographic elevation viewed straight from the side,
no perspective, no vanishing point, no receding floor,
dieselpunk, lit only by <band light>, dark and worn, no sky, no daylight,
no floor plane, no ground receding into the distance, no floor tiles vanishing
into the background, no perspective, no vanishing point, no isometric,
every pixel filled, no empty background, no frame or border,
no people, no figures, no workers, empty of people
```

`no people` is new with §4.2. Rooms were previously prompted with "one small
worker" for scale, and that is what produced figures between 10 and 28 px tall.

`no depth` was dropped from the tail because it argues against the mandatory side
walls. Everything else in the tail still applies.

### Side-wall token

> *room:* narrow slanted side walls at the left and right edges, angled a few pixels inward toward the back wall, floor and ceiling bands stay horizontal
>
> *open area, master (`none`):* the scene continues past the left and right edges, no side walls, content cut off by the frame edge

**Tested in `probe/v9/` (seeds 15001–15010). The room wording is unreliable.**
On 192-wide rooms (`main-generator`) it gave a mild bevel or none at all. On
128-wide rooms (`council-chamber`, `house`) it produced a full one-point
perspective box: trapezoid side walls, a visible floor and a visible ceiling.
That is exactly the failure §2 bans. The prompt cannot be trusted to draw the
slant at a controlled depth. The open-area wording worked on the grove and was
ignored on one of the two dig faces, which came back framed as a tunnel mouth.

**Tested in `probe/v11/` with a layout guide** (`tools/roomGuide.mjs`: the
envelope drawn flat, with the floor band at rows 88–95 and bevelled side walls),
used as a pixflux `init_image`:

| Guide strength | Floor line | Envelope | Contents |
|---|---|---|---|
| none (prompt only) | rows 81–90 | 4 of 5 came back as perspective boxes | full |
| 30 | rows 86–90 | perspective box returns | full |
| 50 | rows 88–93 | flat side view, bevel mostly kept | sparse: small props on a big empty wall |
| 100 | **row 88 on all five** | exact | empty: the guide comes back almost unchanged |

No strength gives both a controlled envelope and a full room. The plain guide
wall reads to the model as "an empty wall".

**Both fixes tested in `probe/v12/` (see its `index.html`). Both work.**

- **Option 1, a blockout guide.** `roomGuide.mjs <width> room <layout>` adds the
  building's main masses as flat shapes, used as `init_image`. Cost: 1
  generation. All six renders came out flat, with the floor on rows 88–90. The
  rooms are simpler and follow the sketch closely. Strength is set per building:
  70 for the house; 50 for the generator and the council chamber.
- **Option 2, `inpaint_image` inside the locked envelope.** The interior (x 7 to
  width − 8, rows 10–87) is masked, so the envelope cannot move. It gave the
  richest rooms of every round. Cost: about 20 generations per call. It does not
  force the palette: the renders came back with 57 and 29 colours. They were
  snapped to 16 for the probe, but with palette forcing suspended (§6) they now
  ship as they come.

**Adopted as the room workflow, §2.4.**

### State token

> *on:* lamps lit, machinery running, in use
>
> *off:* all lamps switched off, machinery stopped, nobody working, cold and dark
>
> *broken:* burst pipe, scorch marks, one lamp dead, machinery stopped, warning chevrons

`off`, `broken` and `damaged` are generated from the approved `on` with
`init_image` (§2.3), so their prompt is the `on` prompt with only this token
swapped.

### Band token blocks

Paste verbatim.

**`deep` — The Works**

> *surface:* raw hewn rock walls, shotcrete patches, riveted steel plate bolted over gaps, mismatched layers of peeling paint
> *wear:* heavy rust streaks bleeding down, jury-rigged cable bundles, patch plates, tarps, chain hoists, oil-stained floor grating, soot
> *light:* a few harsh caged bulbs and furnace glow, deep shadow between them

**`mid` — The Body**

> *surface:* painted steel panelling over concrete, uniform enamel signage, repeating riveted seams, standardised modules
> *wear:* scuffed and grimy at hand height, dented, worn treads — maintained but tired
> *light:* even rectangular wall lamps in wire cages

**`shallow` — The Crown**

> *surface:* lacquered dark wood panelling, brass and bronze fittings, pressed-tin ceiling plates, enamel and frosted glass, fluted pilasters, chevron inlays
> *wear:* tarnished brass, worn carpet, hairline crazing in the enamel — patina, not neglect
> *light:* frosted-glass sconces, warm and plentiful, still dim

**Shared motifs** (appended to every prompt)

> riveted plate with rounded corners, analogue gauges with brass bezels, flanged pipe runs, mesh grating, cage lamps, lever switchgear, stencilled slab-serif numbering, amber and black warning chevrons

**Never appears in a prompt:** neon, hologram, glowing, chrome, futuristic, clean,
screen, monitor, sky, sunlight, window to outside, plants (outside cultivation),
realistic, rendered, 3D, cinematic, volumetric.

### Glow blooms at 16 colours

A 45-colour palette has enough intermediate warm shades for a lamp to fall off
gradually and read as a glow. **At 16 it does not** — the falloff snaps to the two
palest colours in the ramp and becomes a solid mass that dominates the room. The
first v3 pass lost its bunks and its machinery to their own lighting.

The palette is not the thing to change; the prompt is. Two fixes, used together:

- Ask for **"small dim lamps with tight compact glow, mostly dark"**, never "pools
  of light", "casting light" or "lit by" as the leading clause.
- Say what should dominate: **"the machinery clearly readable and dominant"**.
- Add to the negative tail: `no large glow, no bloom, no bright light cones`.

This is the cost of a reduced palette and it is worth paying — but it has to be
paid on every asset with a light source in it, which is most of them.

### The perspective trap

Found the hard way on the first probe. The words **"interior"** and
**"cross-section"** both invite a one-point perspective room with a vanishing
point down the middle — the single failure that breaks the cutaway illusion
(principles §2). `view: "side"` alone does not prevent it.

Two fixes, used together:

1. **Describe the subject as a flat thing, not a room.** "a wall of steel bunk bed
   units bolted to a painted steel bulkhead" instead of "dormitory interior". Name
   the surface the objects are attached to, and the model draws that surface
   face-on.
2. **Negate explicitly**, as a fixed tail on every building prompt:

   > completely flat orthographic elevation viewed straight from the side, no
   > perspective, no vanishing point, no receding floor

   (`no depth` used to be in this tail. It was dropped when slanted side walls
   became mandatory; see the template above.)

The template's `orthographic side elevation cross-section` phrase is therefore
**replaced** by that tail. Keep "cross-section" for describing the *view of the
Shaft as a whole* in design conversation, and out of prompts entirely.

---

## 6. Palette forcing

> **Suspended, 2026-09-21.** Sprites are currently generated **without** a forced
> palette: no `color_image_base64` on generation calls, and no snapping of inpaint
> output afterwards. The renders looked right without one. The palette tooling
> below (`tools/palettePng.mjs`, the v3 per-band subsets) is kept, not deleted. It
> comes back if a stacked shaft of mixed renders stops reading as one set, which is
> the problem forcing was introduced to solve. Until then, colour consistency is
> checked by eye on the stacked shaft view.

`tools/palettePng.mjs` emits the locked palette from
[`src/ui/styles/tokens.css`](../src/ui/styles/tokens.css) as a PNG, which is passed
to every generation as `color_image_base64`. That constrains output to those
colours — and it is enforced, not suggested. Every asset generated this way has
come back with **every pixel an exact palette colour: zero drift, zero
near-misses**. It is worth more than any amount of prompt wording about colour.

### v3 — 16 colours, per band

Sprites are forced to a **subset** of the token set: a shared core of 11 plus five
accents per depth band, 16 in total.

```bash
node tools/palettePng.mjs     # → palette-v3-deep.png, -mid.png, -shallow.png
```

| | Colours |
|---|---|
| **core** (all bands) | rock · rock-cut · steel-darkest · steel-dark · steel · steel-lit · steel-pale · concrete · sodium · sodium-lamp · figure |
| **`deep`** | rust · rust-bright · soot · ash · steel-bright |
| **`mid`** | steel-paint · steel-paint-lit · concrete-lit · concrete-bright · terminal |
| **`shallow`** | brass · bronze · oxblood · wood-lacquer · cream |

**Why a subset rather than the whole palette.** The token set carries UI needs the
art does not have — meter states, panel surfaces, text greys. Forcing sprites to
all of it lets a generation reach for a colour that means something elsewhere. 16
is also simply the chosen look: fewer shades per material, flatter, forms that
read as blocks.

**Why per band rather than one palette.** A single 16-colour set is steel and rust
throughout, and `shallow` loses the brass and wood that make the depth gradient
legible (principles §4). Core-plus-accents keeps every band in one family — they
share eleven of sixteen colours — while letting the top and bottom of the Shaft
stay distinct. The rock uses its band's palette too, so the backdrop never reads
as belonging to a different game than the rooms in front of it.

The lists live in tokens.css as `--sprite-core` and `--sprite-<band>`, so there is
still exactly one authority for colour. A name that is not a colour token fails
loudly at generation rather than silently dropping a colour.

When the palette changes, `PALETTE_VERSION` changes and every asset generated
against the old version is regenerated. Mixing versions in one frame is visible
immediately and is worse than either version alone.

---

## 7. Reproducibility

Every shipped asset records **tool, prompt, seed and palette version** in the table
below. The codebase already holds simulation to this standard —
[README.md](../README.md) forbids `Math.random()` so that a run replays exactly —
and art generation gets the same treatment, so regenerating an asset after a
palette bump lands in the same place instead of quietly becoming a different
building.

| Asset | Tool | Seed | Palette | Notes |
|---|---|---|---|---|
| `council-chamber` | `create_image_pixflux` 192×96 | 10003 | **v3-shallow** | 15/16 colours |
| `dormitory` | `create_image_pixflux` 192×96 | 10012 | **v3-mid** | Seed 10002 lost to glow bloom. **Building removed** — probe record only; see note below |
| `main-generator` | `create_image_pixflux` 192×96 | 10011 | **v3-deep** | Seed 10001 lost to glow bloom |
| `<band>-rock` | **`tools/rockTile.mjs`** 64×104 | 1 | **v3** | Procedural — see §4.1 |

> **The dormitory no longer exists.** Housing is family homes in five suite tiers
> (`simple-suite` … `presidential-suite`; see
> [systems-reference.md](systems-reference.md) §Habitation). The dormitory rows and
> findings in this section are kept as probe history. They still stand as a
> mid-band palette test, but no dormitory asset ships. The mid-band habitation
> probe to redo is `simple-suite`.

The approved set lives in `probe/v2/`. Serve the repo and open
`resources/assets/sprites/probe/v2/index.html` to see it composed into Shaft at
1× and 2×.

**Earlier rounds**, kept for comparison and not shipped: seeds 1001–1006 (first
pass, rendered volume and perspective), 2001–2005 (the flat pass), 3001–3006
(`probe/styles/`, matching the supplied reference), 4001–6004 (`probe/palettes/`,
the cut-out / opaque / framed comparison).

### Probe findings

**What worked.** The band gradient reads immediately and without explanation: the
council chamber is warm wood and brass, the dormitory is cold institutional steel,
the generator is dark oiled machinery — and all three still look like the same
world. Forcing the palette is doing most of that work. The 64px grid carries enough
detail for gauge faces, riveted seams and stencilled signage to survive at 1×.

**The flat pass.** The first round came back as rendered miniatures — modelled
volume, soft falloff, and rooms drawn receding into the page. Regenerated with
`flat shading` + `medium detail` + guidance 10 and the SNES wording in the prompt,
and the register changed completely: blocks of colour, hard edges, nothing
receding. Both rounds are on the probe page side by side.

Two things learned from it:

- **The knobs do the work, not the prompt.** "16-bit SNES pixel art" in the
  description barely moved the output while `shading` stayed at `detailed`.
  Changing `shading` alone moved it further than any wording.
- **Flat costs contrast, and that has to be bought back.** The first flat
  dormitory came out pale and lost its subject — flat shading removes the tonal
  modelling that was separating foreground from background, so the *palette* has
  to do that job instead. Naming the actual material colours in the prompt ("dark
  grey and green painted steel") recovered it.

**Three things to fix before the full pass:**

1. ~~**Rock tiles visibly**, and reads as laid masonry rather than hewn rock.~~
   **Fixed** by generating it instead of prompting for it — see §4.1. The noise
   lattice wraps, so there is no repeat seam, and each band draws its own token
   list, so the strata get colder with depth.
2. **`deep` buildings lose their silhouette.** Dark machinery against dark rock is
   correct for mood and wrong for legibility — the generator nearly disappears at
   1×, and flat shading makes this worse by removing the tonal modelling that was
   carrying the edge. In the `on` render the fix is a larger pool of sodium spill
   around the machinery, which is also what the band description asks for ("harsh
   caged bulbs, deep shadow pooling between them"). The `off` render gets no such
   help, so its silhouette has to come from value contrast in the shapes
   themselves. Check both against the acceptance criteria on every `deep` asset.
3. **The floor slab has no art yet.** The composite uses flat concrete from the
   palette as an honest placeholder. The slab is 8px tall and spans the full 640px,
   so it is one of the most-repeated surfaces in the game and deserves a
   purpose-made strip.

4. **The receding floor plane was the hardest failure to kill.** Rooms kept coming
   back as interiors seen slightly from above, with the floor stretching back into
   the page — through `view: "side"`, flat shading, and every "no perspective"
   instruction. What finally fixed it was describing the floor as *a single flat
   band at the very bottom edge that every object stands directly on*, and the
   subject as objects **standing in a row on the ground line** rather than as a
   "room" or "interior". Both words invite depth; neither appears in a prompt now.
   See the principles doc §2, The ground line.

---

## 8. Acceptance checklist

An asset ships only if every line passes.

- [ ] **Dimensions exact.** 64×64, 128×64 or 192×64. Not resized after the fact.
- [ ] **Opaque envelope, no frame.** Own back wall, ceiling and floor; every pixel
      filled; no border of its own (§2.1).
- [ ] **Side elevation.** No perspective, no isometric drift, circles not ellipses.
- [ ] **Slanted side walls.** A room slants inward a few pixels at *both* the left
      and right edges, with floor and ceiling bands horizontal (§2.1). An open area
      slants only at the ends its end variant names, and its open edges run on
      without a wall (§2.2). Square edges on a room fail.
- [ ] **Flat.** Reads as 16-bit SNES sidescroller art: blocks of colour, hard
      edges, few shades per material. No gradients, no modelled volume.
- [ ] **Ground line, not floor plane.** The floor is a band at the very bottom
      edge; every object stands on it; nothing recedes into the page. This is the
      criterion that fails most often — check it first.
- [ ] **Silhouette reads at 1×** against rock, in the `off` render.
- [ ] **Distinguishable** from its neighbours in the same zone at a glance.
- [ ] **Colour reads as one set** with its neighbours when stacked in the shaft view. Palette conformance is suspended (§6).
- [ ] **Band-appropriate wear** — scrappy but working at `deep`, grand but not clean
      at `shallow`.
- [ ] **All state renders present** — `on`, `off`, `broken`, plus `damaged` where
      the building has one — and every open-area end variant (§2.2, §2.3).
- [ ] **States register.** Diffed against `on`, only the lamps, the activity and the
      damage have changed; nothing has moved.
- [ ] **Sits on the floor.** The sprite's bottom row is the floor line; nothing
      floats and nothing overhangs the slab.
- [ ] **Rooms: no people, floor line at row 88.** No figure anywhere in a room
      render. The top of the floor band is within rows 86–90, recorded as `floorY`
      (§2.1).
- [ ] **Figures: on the body.** Made from the mannequin template. Body 22 px ±1
      (child 14 ±1) plus at most 2 px of headgear, soles on row 31, facing right,
      full one-pixel outline, role readable from headgear or tool plus garment
      colour (§4.2).
- [ ] **No banned content** (§5 of the principles doc).
- [ ] **Recorded** in §7 and in `resources/assets/manifest.json`.

---

## 9. Order of production

1. **Palette** → suspended (§6). Skip for now.
2. **Probe** → one building per band plus the `deep` rock set. Approve the look
   before anything else is generated.
3. **Structure** → rock, wall, slab, stair and lift for all three bands. The
   backdrop has to exist before buildings can be judged in place.
4. **Figures** → one mannequin per role from `tools/figureTemplate.mjs`, then the
   roles in §4.2, `porter` and `engineer` first. Figures come before buildings so
   every room can be judged with a correctly sized person standing in it.
5. **Buildings** → by zone, `deep` first (most characterful, hardest to get right).
   For each: the `on` master, then (open areas only) its end variants, then the
   `off` / `broken` / `damaged` states from the approved `on`.
6. **Overlays** → grime, rust, shutters, chevrons.
7. **Animated parts** → over approved `on` renders only.
8. **UI** → panels and gauges, style-referenced from an approved building.
9. **Font** → last, once the palette and the UI frames are settled.
