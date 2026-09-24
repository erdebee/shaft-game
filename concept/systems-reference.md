# Systems Reference — Resources, Buildings, Infrastructure

*Companion to the main design document. Covers the base simulation layer for Chapters 1 and 2.*

---

## 1. Resource taxonomy

Resources split into two classes that behave — and fail — differently. This split drives most of the sim's design.

### Flow resources
Produced and consumed continuously. Cannot be meaningfully stockpiled. Must be delivered by a network. **Failure is instant and cascading.**

| Resource | Produced by | Delivered by | Notes |
|---|---|---|---|
| **Power** | Main generator | Power grid | Transmission loss scales with distance; per-building priority ranking |
| **Air quality** | Scrubbers, oxygen gardens | Duct network | Tracked **per level**, not globally; CO₂ rises with local density |
| **Water** *(hybrid)* | Deep pump, reclamation | Water mains | Piped, but buffered in cisterns; lifting upward costs power |

### Stock resources
Physical goods. Stored, depleted gradually, and moved by hand. **Failure is slow and visible in advance** — which is what gives the player time to make political choices, and where dilemmas come from.

| Resource | Source | Primary use |
|---|---|---|
| **Food** | Hydroponics, protein vats | Population survival |
| **Scrap** | Recycler, salvage | Feedstock for parts |
| **Ore** (see §2) | Dig face | Feedstock for refining |
| **Wood** | Grove / arboretum | Culture, legitimacy, paper (see §4) |

### Abstract resources

| Resource | Meaning | Spent on |
|---|---|---|
| **Labour** | Worker-shifts available | Every production and haulage task |
| **Focus** | Staff pulled off productive work | Investigation and story revelation |
| **Authority** | Political capital | Enacting Accord amendments |

### Meters

| Meter | Governs | Failure state |
|---|---|---|
| **Stability** | Resistance to unrest | Rebellion |
| **Trust** | Population belief in leadership | Rebellion |
| **Freedom** | Civil liberties | Unrest, faction anger |
| **Productivity** | Economic output | Resource collapse |
| **Structural integrity** | Physical soundness of the Shaft | Collapse events, level loss |
| **Board doubt** *(Ch. 2)* | Advisory Board suspicion, per member | Loss of departmental control |

---

## 2. Minerals and the refining chain

Each mineral maps to a distinct component type — no ore is generically interchangeable with another.

| Mineral | Refines into | Used for |
|---|---|---|
| **Iron ore** | Steel | Structural repair, basic parts, tools, pipes |
| **Copper ore** | Wire, contacts | Power grid, elevator motors, lighting |
| **Coal** | Fuel + activated carbon | Smelting heat, **and scrubber filter media** |
| **Gold / silver** | Precision contacts | Terminals, sensors, medical equipment, Archive |
| **Limestone** | Concrete | Excavation shoring, structural integrity repair |
| **Silica sand** | Glass | Grow-lamp elements, cistern lining, optics |

**Coal is the key interdependency.** Doubling as activated carbon for scrubbers turns air quality from a fixed installation into an ongoing consumable cost — scrubbers need a permanent supply line from the mine, making Mechanical and Air co-dependent.

### Chain
`Dig face → ore → smelter (needs coal + power) → ingots → workshop → components`

### Component tiers

| Tier | Inputs | Used for | Character |
|---|---|---|---|
| **Basic parts** | Steel | General maintenance, most repairs | Bulk consumable |
| **Electrical components** | Copper, trace gold | Grid, elevators, lighting | Moderate scarcity |
| **Precision components** | Gold, silica | Terminals, sensors, clinic equipment | Slow to produce; always the crisis bottleneck |

### Mine depletion
Veins deplete. Deeper digging costs progressively more: extra ventilation power, water ingress requiring pumps, longer haul times, rising structural risk. This makes the recycler genuinely important and puts a slow clock on the Shaft that good management can slow but never escape.

### Story hook
One component is **not producible at any depth** — the scrubber catalyst, publicly credited to "founder-era stockpiles." Players will notice they never mine it. The Chapter 2 reveal (that the Presidium has supplied it all along) pays off a detail they've been staring at for twenty hours.

---

## 3. Buildings

Each level has a fixed number of build slots. Growth requires excavating downward — expensive, slow, and a structural integrity risk.

| Zone | Buildings |
|---|---|
| **Cultivation** | Hydroponics bay, protein vats, food processing, seed vault, grove/arboretum |
| **Water** | Deep pump, purifier, reclamation plant, cistern |
| **Air** | Scrubber, oxygen garden, duct fan |
| **Power** | Main generator, battery bank, junction / substation |
| **Mechanical** | Workshop, smelter, recycler, dig face, machine shop |
| **Habitation** | Family homes in five suite tiers — simple, modest, superior, luxury, presidential (each step houses fewer per slot, costs more upkeep, buys more morale; presidential is shallow-only and costs trust) — plus canteen, clinic, school, common hall. No dormitories: people live in their own family houses |
| **Administration** | Council chamber, archive, security post, holding cells |

**Note:** the common hall raises morale *and* assembly risk — a direct hook from the sim layer into the political layer.

---

## 4. Wood — the cultural resource

Deliberately **not** survival-critical, which is what makes spending capacity on it a political statement.

**Source:** a legacy grove occupying valuable Cultivation slots in direct competition with food production. Trees mature over years of game time, so planting pays off long after the administration that ordered it.

**Uses:**
- Furniture and interior fittings → morale
- Ceremonial and memorial items, Board chamber fittings → legitimacy
- Instrument bodies and cultural objects → morale
- Medical splints → minor clinic input
- **Paper**

**Paper is the important one.** The political layer literally consumes wood: amending the Accord, maintaining archives, keeping court records, and the physical volumes of the Apocrypha all draw on the same finite stock. A Chair who legislates constantly is quietly spending the Shaft's timber — and a Shaft that can no longer make paper is one that can no longer keep records, which is its own horror given the story.

---

## 5. Infrastructure and distribution

The player lays all four networks by hand — cables, pipes, drains and ducts
between buildings (`catalog/infrastructure/networks.json`), from Build ›
Infrastructure. Each network has **hubs** that hand it out to every level
within their reach, and a hub works only once it is linked back to a source.
Links cost materials per level spanned and have a maximum span, so long runs
need intermediate hubs.

### Power grid
`Generator → cable → junction → cable → junction …`, `battery → cable → junction`
- A **junction** lights every room within its reach, up to its capacity
- Transmission loss scales with the cable run from the generator plus the drop from the junction to the room
- **Junction priority (1–5)** set in advance: when supply drops below demand, the grid serves junctions in priority order, so whole districts go dark together. Within one junction the Accord's Order of Supply decides. Deciding whether the clinic's junction outranks the workshop's is a decision made early and felt later
- **Battery banks** cabled to a junction back up that junction and no other, and charge from the surplus

### Water network
- Source at the bottom (deep pump); pipes carry it up to **cisterns**, which store it and supply every room and resident within reach
- **Pumping upward costs power proportional to lift height**, so water cost scales with how high people live, making vertical layout an economic decision
- A **purifier** on the mains cleans the reclaimed water passing through it

### Sewer
- What a cistern's area uses comes back as greywater and drains **downhill only**, cistern to cistern, to the **reclamation plant**, which returns it to its mains at a loss
- Sewage no drain can carry is dumped where it was made and fouls that level's air

### Air network
- Tracked **per level**, as two numbers: purity (fouled by crowds and industry, most of all the deep generator, smelter and dig face) and oxygen (breathed by everyone, burned by combustion). Breathable air is the worse of the two
- **Duct fans suck or blow.** Air drawn off the levels a sucking fan reaches travels the ducts to the blowing fans, and is blown out onto their levels. A ducted group moves the lesser of what its suckers can draw and its blowers can push — two blowers and no sucker move nothing
- Everything the air passes works on it: a **scrubber** cleans it, an **oxygen garden** breathes into it, each sharing its capacity over the air through it. A scrubber or garden off the air's path works on its own level only
- A sucked level is refilled from the stairwell, taking on the Shaft's average air. The gardens are in the shallows and the people in the middle, so fresh air is drawn at the top and blown downward; the Works' foul air is best drawn off and cleaned on its way somewhere else
- Plants (bays, groves, gardens) need clean air to grow and breathe a little oxygen back out
- Sealing a level (fire, contamination, containment during unrest) cuts it from every fan — which is also why it begins suffocating

### Haulage
Stock resources are moved by assigned **porters**. Distance in levels equals labour time.

| Method | Speed | Cost | Constraint |
|---|---|---|---|
| **Stairwell** | Slow | Free | Worker fatigue, congestion at shift change |
| **Freight elevator** | Fast | Power per trip | Limited cars, breaks down, needs parts |
| **Dumbwaiter** | Medium | Low power | Small loads only |

Placement matters permanently: a hydroponics bay twenty levels from the canteen burns porter-hours every day, forever.

---

## 6. The maintenance economy

The loop that gives Engineering its leverage as a faction.

1. Buildings have a **condition** value that decays with use
2. Below a threshold, efficiency drops
3. Further down, breakdown events fire
4. Repairs cost **components + engineer labour**
5. Components come from the workshop → which consumes ore and scrap → which comes from the mine and recycler

This makes components a hidden second economy running beneath the visible food-and-power one. Neglecting Engineering doesn't hurt immediately — it hurts about thirty days later, all at once.

---

## 7. Open items

- Tick and shift structure — how fast time passes, what the player does per cycle
- Depletion rates and excavation cost curve
- Recycler efficiency and how far it offsets a dwindling mine
- Medicine and clinic supply chain (clinic exists; its inputs undefined)
- Build slot counts per level; excavation time and risk values
- Starting conditions and Chapter 1 difficulty curve
