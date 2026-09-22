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
Shaft width       768 px               = 128 stairwell + 640 build area (10 slots); no lift column

Building sprites   64 × 96             1 slot
                  128 × 96             2 slots
                  192 × 96             3 slots  ← the reference proportion

Column strip      128 × 104            stairwell (continuous stair, §2.2), tiles vertically
Rock / back wall   64 × 104            one per depth band, tiles both ways
Rooms have no frame — they butt against each other and the slab (§2.1)
Figures            32 × 32 canvas      adult exactly 22 px, child 14 px, soles on row 31 (§4.2)
Floor line         row 88 of a room    top of the floor band; figures stand on it (§2.1)
Animated parts     square, ≤ 32 px     4 frames, composited at a recorded anchor

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
| `SHAFT_WIDTH` | 100 | **768** |
| `STAIR_X` | 7 | **64** (centre of the 128-px stairwell) |
| `ELEVATOR_X` | 93 | **none**: no lift column (decided 2026-09-22) |
| `BUILD_X` | 16 | **128** |
| `BUILD_WIDTH` | 68 | **640** (10 slots) |

`slotRect` then returns `x = 128 + slotIndex × 64`, `y = levelY(level)`,
`width = 64 × slots`, `height = 96` — with the 8 px slab occupying
`levelY(level) + 96` to `levelY(level) + 104`.

Figure constants become `FIGURE_W 32`, `FIGURE_H 32`.

*Recorded here as the contract. Changing the constants is a renderer task, not an
asset task.*

---

## 2.1 What a room sprite is

A building ships as a **finished room with no frame**: its own painted back wall, a
ceiling with beams and pipe runs, a plated floor, and machinery packed wall to
wall. Every pixel of its rectangle is filled. Rooms butt against each other along a
level and against the structural slab below.

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
(Steel A, hand-fixed so the joins line up). The shaft is 768 px: the 128-px stairwell plus
10 build slots, with no lift column (decided 2026-09-22).

The stairwell is a structure strip, not a placed building, but it follows
the same rule: it slants only where it meets something that is not stairwell.

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

## 2.4 How a room is made — the adopted workflow

**Adopted 2026-09-21**, after probes v9–v12 (see `probe/v12/index.html`). Prompting
alone cannot hold the envelope. It produced perspective boxes and floors anywhere
from row 81 to 90. So every room goes through four steps, cheap ones first:

| Step | What | Tool | Cost |
|---|---|---|---|
| 1. Blockout | Add the building's main masses to `LAYOUTS` in `tools/roomGuide.mjs` (about 15 flat shapes), then run `node tools/roomGuide.mjs <width> room <building-id> --lit` for the lit, dithered guide | local | 0 |
| 2. Layout | `create_image_pixflux` with `init_image` = the **lit** guide at strength **75** for 128 px and wider; **120–160 for 64-px rooms**, which the model otherwise reads as a box seen from the front (v17; 200 loses the props), `shading: "detailed shading"`, `detail: "highly detailed"`, and the detail lead in the prompt (§4). Two seeds per room, then pick | pixflux | 1 per try |
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
- **Pale blocks high on the back wall become windows.** Name that object in the
  prompt and add "windowless, no window frame, no glass pane" (the v16 clinic).
- **Passing images.** Pasted base64 sometimes arrives garbled ("Could not decode
  image"; free, but a lost turn). Guides are local, so they go as compact indexed
  PNGs (~1–1.5k characters). Anything already on PixelLab goes by URL.

**No palette forcing for now** (§6). No step passes `color_image_base64`, and
inpaint or edit output is not snapped to a palette.

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
  parts/<building-id>-<part>-<n>.png   animated part frames, n = 0..3
  structure/<band>-rock.png            \
  structure/<band>-wall.png             |  band ∈ shallow | mid | deep
  structure/<band>-slab.png             |
  structure/<band>-stair.png            |
  structure/<band>-lift.png            /
  figures/<figure-id>.png              one per role in §4.2, 32 × 32, facing right
  overlays/<state>.png                 grime, rust, shutters, chevrons
  ui/<element-id>.png                  panel frames, gauge faces, klaxon
  probe/                               style probes — never shipped, never in the manifest
```

**Every file is enumerated in
[`resources/assets/manifest.json`](../resources/assets/manifest.json)** using the
`{ id, path, preloadGroup, chapter }` shape its `_plannedGroups` block already
reserves. Building sprites add one field, `floorY`: the row their figures stand on
(§2.1). There is no build step and no directory listing over `fetch()`, so the
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
| Animated parts | `animate_object` over the approved `on` render | 4-frame loops |
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

**One body, one scale, every role.** The numbers below are exact, not approximate.
They are enforced by generating every figure from the same pixel mannequin, not
by asking for a size in the prompt.

#### Canvas and anchor

```
canvas        32 × 32 px, transparent
facing        right (east) only — the renderer mirrors for left-facing
anchor        soles on row 31 (the bottom row), body centred on column 16
placement     row 31 of the figure sits on row floorY − 1 of the room (§2.1)
```

#### The adult body — 22 px

Rows are canvas rows, top to bottom. Heights include the one-pixel outline.

| Rows | Part | Height | Width (incl. outline) | Notes |
|---|---|---|---|---|
| 10 | outline | 1 | — | top of the head |
| 11–15 | head | 5 | 7 | hair on the back half, face on the front half; eye on row 14 |
| 16 | neck / collar | 1 | 4 | |
| 17–23 | torso | 7 | 8 | front arm drawn over it, hand on row 23 at the hip |
| 24–28 | legs | 5 | 6 | legs together, standing |
| 29–30 | boots | 2 | 8 | toes point forward, one pixel past the shin |
| 31 | sole outline | 1 | — | the anchor row |
| | **total** | **22** | **8–10** | head = 6 of 22 ≈ 3.7 heads tall |

- **Headgear** (cap, hard hat, brimmed hat, headscarf) may rise up to **2 px** above
  row 10 and overhang the face by 2 px. Nothing else changes the height.
- **Carried things** (a crate on a back frame, a tool, a bag) may widen the
  silhouette to **14 px**. They never rise above the head and never hang below
  row 31.
- **Child: 14 px** (rows 18–31): outline 1, head 4, torso 4, legs 3, boots 1, sole 1.
  Head = 5 of 14 ≈ 2.8 heads, so children read younger by proportion, not only by
  size.
- **Elder: 21 px**: the adult body with the head and shoulders pushed forward one
  pixel. Grey or white hair, optional cane.

#### Look

- **Profile, facing right.** One eye visible. Never facing the viewer (principles §2).
- **Face:** a single 1-px eye in the outline colour on row 14, one pixel in from the
  front of the face. No mouth, no drawn nose.
- **Outline:** one pixel of the palette's darkest colour all round the silhouette,
  including under the soles. Figures are the only sprites with a *full* outline.
  Rooms use a selective one. The full outline is what keeps a 22-px person readable
  against a busy machine room.
- **Shading:** two tones per material, base plus a shadow on the back (left) side.
  At most one highlight pixel, on headgear or a tool. No dithering, no gradients.
- **Colours:** at most six plus the outline. Skin comes from the neutral ramp in one
  of three tones: light (`#dcc6a4` / shadow `#b69c86`), medium (`#b69c86` / `#8e7870`)
  or dark (`#8e7870` / `#6c5a5c`). **Amber appears on a figure only as a lamp** (the
  miner's helmet lamp). It is reserved for light (principles §6).
- **Pose:** standing, arms at the sides, the front hand free or holding the role's
  tool. Walk and work cycles are animated later from the approved standing sprite.

#### Roles

Ids follow `resources/data/catalog/population/jobs.json`. At 1× a role is read from
its **headgear or tool silhouette** plus its **main garment colour**, so no two roles
share both. The hex values are the colours the mannequin template is drawn in (palette v6/03). Generation is not palette-forced (§6), so they guide the costume rather than bind it.

| Figure id | Main garment | Headgear / tool silhouette | Probe |
|---|---|---|---|
| `engineer` | teal overalls `#33585a` over a cream shirt | flat cap · wrench | v10 ✓ |
| `miner` | dark brown jacket `#6c5a5c` | hard hat with a 1-px amber lamp · pickaxe | v10 ✓ |
| `porter` | cream shirt `#dcc6a4`, brown trousers | crate on a back frame | v10 — crate missing |
| `grower` | mint apron `#86b6a2` over cream | wide brimmed hat · watering can | v10 ✓ |
| `pump-tech` | dark teal overalls `#1f3638` | rubber boots · valve key | — |
| `air-tech` | cream coveralls | filter mask at the neck · clipboard | — |
| `kitchen-hand` | cream apron over terracotta | headscarf | — |
| `medic` | cream coat to the knees | mint armband · small case | — |
| `teacher` | brown cardigan `#8e7870` | books under the arm | — |
| `constable` | near-black coat `#241c26` | peaked cap · pale 1-px badge | — |
| `archivist` | long grey-brown coat `#6c5a5c` | 1-px spectacles · paper bundle | — |
| `investigator` | long dark coat | brimmed hat · notebook | — |
| `councillor` | long dark terracotta coat `#8e3f30` to the knees | grey hair · hands behind the back | v10 — hair came out mint |
| `resident` | everyday jumper in terracotta, mint or brown | bare-headed · optional bag | v10 ✓ |
| `child` | shirt and short trousers | scarf · 14 px | v10 ✓ |

#### Recipe

1. `node tools/figureTemplate.mjs adult <figure-id>` (or `child child`) writes the
   mannequin in the role's colours to `resources/assets/figure-template-*.png`.
2. `create_image_pixflux` at 32×32 with:
   - `init_image` = that template, `init_image_strength: 150`
   - `no_background: true`, `view: "side"`, `direction: "east"`
   - `shading: "flat shading"`, `outline: "single color black outline"`,
     `detail: "medium detail"`, `text_guidance_scale: 8`
   - a prompt that names the costume from the table and ends with *"keep exactly the
     size, proportions and pose of the input figure: 22 pixels tall, head 6 pixels
     tall, one pixel dark outline, one pixel eye, no mouth"*.
3. Measure the opaque bounding box. **Accept** a body of 22 px ±1 (child 14 ±1),
   plus up to 2 px of headgear. Shift the sprite so the soles sit on row 31.
   Regenerate anything else.

Why strength 150. At 250 every figure came back exactly 22 px but kept the
mannequin's mint shirt: the costume was ignored (`probe/v10/pass1-strength250/`).
At 150 with a template already in the role's colours, the costumes came through
and heights stayed within 21–23 px (`probe/v10/`).

**Tested in rooms (`probe/v11/test-rooms-with-figures.png`).** All seven figures
held one scale across five very different rooms: the resident against a stove and
table, councillors against chair backs, engineers against the engine. Two
problems remain:

- **Roles with a large carried object do not survive.** The porter's crate
  failed twice. The next attempt is to draw the crate into the porter's template
  instead of asking for it in the prompt.
- **Figures in a room's own colours disappear into it.** A teal engineer against
  a teal engine is hard to find at 1×. The full outline helps but is not enough on
  its own, so costume colours should be checked against the rooms each role
  works in.

The councillor's coat also came out near-black rather than terracotta.

`"no people"` in the room prompt worked on all 17 v11 renders.

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
