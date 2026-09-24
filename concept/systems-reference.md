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

The player lays every network by hand, socket by socket — cables, wires,
pipes, drains, feed lines and ducts between buildings
(`catalog/infrastructure/networks.json`), from Build › Infrastructure. Every
building on a network shows its **sockets** in the Shaft; clicking a free one
starts a link (a ghost of it follows the pointer), clicking a socket it fits
lays it, and clicking a used one takes it out. Sockets face in, out or either
way, and each takes one link, so a hub hands out only as many lines as it has
sockets. Pipes, drains and ducts can be **teed**: a new line runs from a
socket into the middle of an existing run of its network, so one line serves
several machines. Links cost materials per level spanned and have a maximum span.
Power and water are wired all the way to the room: no room is served by being
near a hub. The air is not: its ducts join only the air machines, and the
fans air the levels around them.

### Power grid
`Generator ═HV═ junction ─LV─ room`, `generator ═HV═ battery ═HV═ battery … ═HV═ junction`
- **High voltage:** a generator has six outputs, a junction one input. A battery sits in line, one input and one output, so batteries chain in series
- **Low voltage:** a junction has twelve outlets; every room that draws power has one, and is wired to a junction no more than four levels away. A room on no wire is dark. A junction carries up to its capacity
- Transmission loss scales with the high-voltage run from the generator plus the low-voltage wire from the junction to the room
- **Junction priority (1–5)** set in advance: when supply drops below demand, the grid serves junctions in priority order, so whole districts go dark together. Within one junction the Accord's Order of Supply decides. Deciding whether the clinic's junction outranks the workshop's is a decision made early and felt later
- **Battery banks** back up the junction at the end of their chain and no other, and charge from the surplus

### Water network
- **A loop, like the air.** Cisterns supply the rooms and residents around them; what they use drains down the sewer to the **reclamation plant**; the plant's recovered water goes to a **deep pump** it is piped to; and the pump pushes it back up the mains to the cisterns. Pumps drive the loop: without one, nothing on the mains moves, and a plant piped to no pump wastes what it recovers
- The pump tops the loop up with fresh groundwater for what reclamation loses, as much as it can draw and the aquifer gives
- **Main lines** (large pipe sleeves) run only between pumps, cisterns and reclamation plants (a purifier may sit on the mains). A pump sits in line, one pipe in (from the reclamation plant) and one out (up to the cisterns); a cistern has one fresh-water and one sewage sleeve, and so does a reclamation plant. More cisterns join a pump's main, and more drains a plant's, by tees
- **Feed lines** (a double pipe, water in and the used water back): a cistern has ten feed sleeves, and every room that uses water — homes included — has one, fed from a cistern no more than four levels away. A home's residents drink through its feed line; people with no home drink at the nearest room that has one
- **Pumping upward costs power proportional to lift height**, so water cost scales with how high people live, making vertical layout an economic decision
- A **purifier** on the mains cleans the reclaimed water passing through it

### Sewer
- What a cistern's area uses comes back as greywater and drains **downhill only**, cistern to cistern, to the **reclamation plant**, which recovers it at a loss for the pumps to send round again
- Sewage no drain can carry is dumped where it was made and fouls that level's air

### Air network
- Tracked **per level**, as two numbers: purity (fouled by crowds and industry, most of all the deep generator, smelter and dig face) and oxygen (breathed by everyone, burned by combustion). Breathable air is the worse of the two
- **Two duct lines, one loop.** Duct fans suck or blow. Foul-air ducts carry what the sucking fans draw off their levels to the **scrubbers**; fresh-air ducts carry it on, cleaned, to the blowing fans, which push it out onto their levels. Air only moves round a loop that passes a scrubber — two blowers, or foul ducts straight to a blower, move nothing
- **Sleeves:** a duct fan has one duct sleeve, which takes either line; a scrubber and an oxygen garden have one foul and one fresh. Several fans share a scrubber through tees in the ducts
- **Oxygen gardens** sit in the loop like a scrubber — foul air in, fresh air out — and breathe into the air passing through them. A scrubber cleans only the air its ducts carry through it — air drifting past it in the Shaft, from a blower to a sucker, is untouched, so a scrubber on no loop cleans nothing. A garden off the air's path breathes into its own level only
- **Through the Shaft, the air takes the stairwell.** A fan's vents open on its own level and the ones either side. Between a blower and a sucker the air flows up or down the stairwell through every level in between, and each level mixes the passing air into its own before handing it on. So a level is aired by what flows past it. Nothing flows beyond the last fan, and two fans turning the same way side by side push against each other, leaving the levels between them barely aired. Air is moved, never made: only the scrubbers and gardens change it
- The player's targets are each room's **oxygen** and **pollution**; the Infrastructure › Air page and a gauge on every room show both
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
