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

### Power grid
`Generator → trunk cable → per-level junction → buildings`
- Transmission loss scales with distance travelled
- Junctions have capacity caps
- **Per-building priority ranking** set in advance: when supply drops below demand, low-priority buildings brown out first. Deciding whether the clinic outranks the workshop is a decision made early and felt later
- Battery banks buffer against generator faults

### Water network
- Source at the bottom (deep well)
- **Pumping upward costs power proportional to lift height**; greywater returns downward free by gravity to reclamation
- Water cost therefore scales with how high people live, making vertical layout an economic decision
- Cisterns per level buffer against pump failure

### Air network
- Quality tracked **per level**
- Scrubbers serve a radius of levels; stale air pools in poorly served pockets
- CO₂ rises with local population density
- Sealing a level (fire, contamination, containment during unrest) isolates it from the ducts — which is also why it begins suffocating

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
