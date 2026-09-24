/**
 * resourceIcons.mjs
 * One 16x16 icon per resource, drawn pixel by pixel rather than generated.
 *
 * Same reasoning as props.mjs, one size smaller. `create_image_pixflux` will
 * not even accept a 16x16 canvas (its floor is 32x32 of total area), and a
 * 32x32 generation halved is mush: at this size every pixel is a decision
 * about silhouette, and there are only ~200 of them. Drawing them by hand
 * costs nothing, is reproducible, and lands exactly on the palette.
 *
 *   node tools/resourceIcons.mjs
 *
 * Writes resources/assets/sprites/icons/<resource-id>.png, one per id in
 * ICONS, plus a contact sheet at sprites/probe/<n>/icons-sheet.png when run
 * with --sheet <dir>.
 *
 * THE IDS ARE THE CATALOGUE IDS, verbatim — resources/data/catalog/resources/
 * *.json. An icon whose id is not a resource, or a resource with no icon, is
 * a manifest error the probe page reports; nothing here hardcodes a list the
 * catalogue does not already have.
 *
 * WHY 16x16. Shaft units are 1:1 with sprite pixels and zoom is integer
 * (spec §2), so an icon drawn at 16 is 16 units wide wherever it is put.
 * Three of them plus padding is 56 units, which fits across the narrowest
 * room (64). It is also the largest size that sits over a 32px figure without
 * covering it, which is what the porter bubbles need.
 *
 * COLOURS ARE TOKENS. Every value below is a colour declared in
 * src/ui/styles/tokens.css. The palette is suspended for room sprites (spec
 * §6) but never was for UI, and these are UI: they are read against a panel,
 * not against rock.
 *
 * One reserved colour is deliberately NOT used: --critical (#96472f) is
 * alarm, and belongs to the bar under an icon when a store is empty — to the
 * state, never to the thing itself. An icon that is already red cannot go red.
 *
 * Water IS blue, in its own --water ramp. It used to be drawn grey because
 * cold blue was held back for the Nexus; that rule was dropped (2026-09-24),
 * and a grey droplet read as mercury.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'resources/assets/sprites/icons');

export const SIZE = 16;

/** Every entry is a token from src/ui/styles/tokens.css. */
const C = {
  '.': null,
  K: [0x01, 0x02, 0x02], // rock — the keyline
  D: [0x1e, 0x1d, 0x27], // steel-darkest
  S: [0x2f, 0x32, 0x3e], // steel-dark
  T: [0x3a, 0x43, 0x4c], // steel
  E: [0x4f, 0x5b, 0x61], // steel-lit
  P: [0x66, 0x72, 0x72], // steel-pale
  B: [0x7e, 0x8c, 0x8d], // steel-bright
  W: [0x9c, 0xa8, 0xa3], // steel-highlight
  c: [0x3d, 0x34, 0x36], // concrete-dark
  n: [0x4b, 0x42, 0x40], // concrete
  C: [0x70, 0x6b, 0x62], // concrete-lit
  N: [0x9a, 0x92, 0x83], // concrete-bright
  o: [0x74, 0x44, 0x31], // rust-dark
  r: [0x8c, 0x44, 0x2e], // rust
  R: [0xb4, 0x67, 0x41], // rust-bright
  a: [0x8b, 0x6a, 0x4a], // sodium-dim
  A: [0xc5, 0x8c, 0x5e], // sodium / amber
  H: [0xe6, 0xb6, 0xa1], // sodium-spill
  F: [0xfc, 0xf5, 0xb4], // sodium-core
  U: [0x6b, 0x5c, 0x33], // brass-dark
  u: [0x8f, 0x7a, 0x45], // brass
  z: [0x7a, 0x5a, 0x38], // bronze
  w: [0x59, 0x48, 0x3f], // wood-lacquer
  m: [0x86, 0x94, 0x93], // steam
  i: [0xb3, 0xbb, 0xb3], // ink / figure
  g: [0x54, 0x6d, 0x58], // enamel-green
  G: [0xbc, 0xcc, 0xbb], // terminal-lit
  q: [0x1f, 0x35, 0x50], // water-deep
  v: [0x2f, 0x5f, 0x8a], // water
  V: [0x5b, 0x93, 0xbd], // water-lit
  Q: [0xc4, 0xe2, 0xee], // water-glint
};

// --- stocks ----------------------------------------------------------------

/** A ration tin: the unit is "ration", and a tin is what a ration comes in. */
const FOOD = [
  '................',
  '................',
  '..KKKKKKKKKKKK..',
  '..KWWWWWWWWWWK..',
  '..KBPPPPPPPPBK..',
  '..KKKKKKKKKKKK..',
  '..KAAAAAAAAAAK..',
  '..KAHHHHHHHHAK..',
  '..KAHAAAAAAHAK..',
  '..KAAAAAAAAAAK..',
  '..KKKKKKKKKKKK..',
  '..KPPPPPPPPPPK..',
  '..KEEEEEEEEEEK..',
  '..KTTTTTTTTTTK..',
  '..KKKKKKKKKKKK..',
  '................',
];

/** Scrap: a buckled plate with a bent rod still attached to it. */
const SCRAP = [
  '................',
  '................',
  '................',
  '.....KKKKKKKK...',
  '....KWBBBBBBKK..',
  '....KPEEEKEEEK..',
  '...KKKTTTKKTKK..',
  '..KKKKKKKKKKK...',
  '.KWBBBKBBBWKK...',
  '.KPEEEKEEEPK....',
  '.KKTTTTTTTKK....',
  '..KKKKKKKKKKKK..',
  '..KWBBBBBBBBWK..',
  '..KPEEEEEEEEEK..',
  '..KKTTTTTTTKKK..',
  '...KKKKKKKKK....',
];

/** Wood: two sawn log ends, rings showing. */
const WOOD = [
  '................',
  '................',
  '.......KKKKK....',
  '......KwwwwwK...',
  '.....KwzUUUzwK..',
  '.....KwzUaUzwK..',
  '.....KwzUUUzwK..',
  '.....KwwwwwwwK..',
  '..KKKKKKKKKK....',
  '.KwwwwwwwwwK....',
  'KwzUUUUUUzwK....',
  'KwzUaaaaUzwK....',
  'KwzUUUUUUzwK....',
  'KwwwwwwwwwwK....',
  '.KKKKKKKKKK.....',
  '................',
];

/** Paper: a stack of quires, ruled, the top sheet offset. */
const PAPER = [
  '................',
  '................',
  '...KKKKKKKKKK...',
  '...KNNNNNNNNK...',
  '...KNCCCCCCNK...',
  '...KNNNNNNNNK...',
  '..KKKKKKKKKKK...',
  '..KNNNNNNNNNK...',
  '..KNCCCCCCCNK...',
  '.KKKKKKKKKKKK...',
  '.KNNNNNNNNNNK...',
  '.KNCCCCCCCCNK...',
  '.KNNNNNNNNNNK...',
  '.KCCCCCCCCCCK...',
  '.KKKKKKKKKKKK...',
  '................',
];

// --- minerals --------------------------------------------------------------
// Four of the six are "a rock", so silhouette carries the difference before
// colour does: iron is one blunt chunk, copper is a chunk with a splinter off
// it, coal is three rounded lumps, gold has veins cut across it.

const IRON_ORE = [
  '................',
  '................',
  '......KKKK......',
  '....KKBWWBKK....',
  '...KBBWWWBBBK...',
  '..KPBBWrrBBBBK..',
  '..KPPBBrrBBBBK..',
  '.KEPPBBBBrrBBK..',
  '.KEEPPBBBrrBBK..',
  '.KTEEPPBBBBBK...',
  '..KTEEPPBBBK....',
  '..KKTTEEPPKK....',
  '....KKTTEKK.....',
  '......KKKK......',
  '................',
  '................',
];

const COPPER_ORE = [
  '................',
  '................',
  '.....KKKK.......',
  '...KKBWWBKK.....',
  '..KBBWWRRBBK....',
  '..KPBBRRBBBBK...',
  '.KEPPBRRBBBBK...',
  '.KEEPPBBBRRBK...',
  '.KTEEPPBBRRBK...',
  '..KTEEPPBBBK....',
  '..KKTTEEPKK.KK..',
  '....KKTEKK.KBWK.',
  '......KKK.KPBRK.',
  '..........KETBK.',
  '...........KKK..',
  '................',
];

const COAL = [
  '................',
  '................',
  '................',
  '.....KKKK.......',
  '....KSEEKK......',
  '...KSSEETSK.....',
  '...KSSSETSK.KK..',
  '..KKSSSTSKKKSEK.',
  '.KSEKKSSSKSSETK.',
  'KSEETKKKKSSSTSK.',
  'KSSETSK.KSSSSKK.',
  'KSSSTSKKKSSKK...',
  '.KSSSSSSKKK.....',
  '..KKSSSKK.......',
  '....KKKK........',
  '................',
];

const GOLD_ORE = [
  '................',
  '................',
  '......KKKK......',
  '....KKBWWBKK....',
  '...KBBWuuWBBK...',
  '..KPBBWuuBBBBK..',
  '..KPPBuuBBBBBK..',
  '.KEPPuuBBBuuBK..',
  '.KEEPuBBBuuFBK..',
  '.KTEEPPBuuBBK...',
  '..KTEEPuuBBK....',
  '..KKTTEuPKK.....',
  '....KKTTEKK.....',
  '......KKKK......',
  '................',
  '................',
];

/** Limestone: a pale chunk, blockier and squarer than the metal ores. */
const LIMESTONE = [
  '................',
  '................',
  '.....KKKKK......',
  '...KKWWNNNKK....',
  '..KWWNNNNNNNK...',
  '..KWNNNNNNNNNK..',
  '.KNNNNNNNNNNNK..',
  '.KNNNCNNNNNNNK..',
  '.KCNNNNNNNCNNK..',
  '.KCCNNNNNNNNCK..',
  '..KCCNNNCNNNCK..',
  '..KnCCCNNCCCCK..',
  '...KnnCCCCCCK...',
  '....KKnnCCKK....',
  '......KKKK......',
  '................',
];

/** Silica sand: a low heap, dithered so it reads as grains, not as a stone. */
const SILICA_SAND = [
  '................',
  '................',
  '................',
  '................',
  '.......KK.......',
  '......KNNK......',
  '.....KNCNNK.....',
  '....KNCNCNNK....',
  '...KNCNCNCNNK...',
  '..KNCNCNCNCNNK..',
  '..KCNCNCNCNCNK..',
  '.KNCNCNCNCNCNNK.',
  '.KCnCnCnCnCnCnK.',
  'KnCnCnCnCnCnCnCK',
  'KKKKKKKKKKKKKKKK',
  '................',
];

// --- components: refined ---------------------------------------------------

const STEEL_BILLET = [
  '................',
  '................',
  '................',
  '................',
  '....KKKKKKKK....',
  '...KWWWWWWWWK...',
  '..KWBBBBBBBBWK..',
  '.KWBBBBBBBBBBWK.',
  'KBBBBBBBBBBBBBBK',
  'KPPPPPPPPPPPPPPK',
  'KEEEEEEEEEEEEEEK',
  'KTTTTTTTTTTTTTTK',
  'KSSSSSSSSSSSSSSK',
  '.KKKKKKKKKKKKKK.',
  '................',
  '................',
];

/** Copper wire: a spool, flanges either side of the winding. */
const COPPER_WIRE = [
  '................',
  '................',
  '..KKK......KKK..',
  '..KPK......KPK..',
  '..KPKKKKKKKKPK..',
  '..KPKRoRoRoKPK..',
  '..KEKoRoRoRKEK..',
  '..KEKRoRoRoKEK..',
  '..KEKoRoRoRKEK..',
  '..KTKRoRoRoKTK..',
  '..KTKoRoRoRKTK..',
  '..KTKKKKKKKKTK..',
  '..KSK......KSK..',
  '..KKK......KKK..',
  '................',
  '................',
];

/** Precision contacts: a bakelite terminal strip, three brass screws. */
const PRECISION_CONTACTS = [
  '................',
  '................',
  '................',
  '.KKKKKKKKKKKKKK.',
  '.KccccccccccccK.',
  '.KcKKKcKKKcKKKK.',
  '.KcuuucuuucuuuK.',
  '.KcUKUcUKUcUKUK.',
  '.KcuuucuuucuuuK.',
  '.KcKKKcKKKcKKKK.',
  '.KDDDDDDDDDDDDK.',
  '.KDDDDDDDDDDDDK.',
  '.KKKKKKKKKKKKKK.',
  '................',
  '................',
  '................',
];

/** Fuel: a hooped drum with a filler cap. */
const FUEL = [
  '................',
  '................',
  '......KKK.......',
  '.....KKAKK......',
  '..KKKKKKKKKKK...',
  '..KRRRRRRRRRK...',
  '..KrrrrrrrrrK...',
  '..KKKKKKKKKKK...',
  '..KRRRRRRRRRK...',
  '..KrrrrrrrrrK...',
  '..KKKKKKKKKKK...',
  '..KrrrrrrrrrK...',
  '..KoooooooooK...',
  '..KKKKKKKKKKK...',
  '................',
  '................',
];

/** Activated carbon: a sack, the black granules showing at its mouth. */
const ACTIVATED_CARBON = [
  '................',
  '................',
  '....KKKKKK......',
  '...KDKKKKDK.....',
  '...KDDKKDDK.....',
  '...KCDDDDCK.....',
  '..KCNNNNNCK.....',
  '..KNNNNNNNCK....',
  '..KNNNNNNNCK....',
  '..KNNNNNNNCK....',
  '..KNNNNNNNCK....',
  '..KCNNNNNNCK....',
  '..KCCCCCCCCK....',
  '...KKKKKKKK.KK..',
  '..........KDDK..',
  '...........KK...',
];

/** Concrete: a cast slab, aggregate showing through the float marks. */
const CONCRETE = [
  '................',
  '................',
  '................',
  '..KKKKKKKKKKKK..',
  '.KNNNNNNNNNNNNK.',
  '.KNNNNNNNNNNNNK.',
  '.KNCNNNNCNNNCNK.',
  '.KCCCCCCCCCCCCK.',
  '.KCNCCCCNCCCNCK.',
  '.KCCCCCCCCCCCCK.',
  '.KnCNCCCCCNCCnK.',
  '.KnnnnnnnnnnnnK.',
  '..KKKKKKKKKKKK..',
  '................',
  '................',
  '................',
];

/** Glass: a pane, read by its glare rather than by anything behind it. */
const GLASS = [
  '................',
  '................',
  '..KKKKKKKKKKKK..',
  '..KmmmmmWWmmmK..',
  '..KmmmmWWmmmmK..',
  '..KmmmWWmmmmmK..',
  '..KmmWWmmmmWmK..',
  '..KmWWmmmmWWmK..',
  '..KWWmmmmWWmmK..',
  '..KWmmmmWWmmmK..',
  '..KmmmmWWmmmmK..',
  '..KmmmWWmmmmmK..',
  '..KmmWWmmmmmmK..',
  '..KKKKKKKKKKKK..',
  '................',
  '................',
];

// --- components: assembled -------------------------------------------------

/** Basic parts: a hex nut, with a bolt lying under it. */
const BASIC_PARTS = [
  '................',
  '................',
  '...KKKKKK.......',
  '..KWBBBBWK.KKKKK',
  '.KWBPKKPBWKWBBWK',
  '.KBPKSSKPBKKKKKK',
  '.KBPKSSKPBK.KTTK',
  '.KWBPKKPBWK.KTTK',
  '..KWBBBBWK..KTTK',
  '...KKKKKK...KTTK',
  '............KTTK',
  '............KTTK',
  '............KEEK',
  '............KKKK',
  '................',
  '................',
];

/** Electrical components: a wound coil on a core, two leads out the bottom. */
const ELECTRICAL_COMPONENTS = [
  '................',
  '................',
  '...KKKKKKKKKK...',
  '...KPPPPPPPPK...',
  '..KKKKKKKKKKKK..',
  '..KRoRoRoRoRRK..',
  '..KoRoRoRoRoRK..',
  '..KRoRoRoRoRRK..',
  '..KoRoRoRoRoRK..',
  '..KRoRoRoRoRRK..',
  '..KKKKKKKKKKKK..',
  '...KEEEEEEEEK...',
  '...KKKKKKKKKK...',
  '.....K....K.....',
  '.....K....K.....',
  '.....K....K.....',
];

/** Precision components: a fine gear with a jewelled hub. */
const PRECISION_COMPONENTS = [
  '................',
  '................',
  '.....K.KK.K.....',
  '....KuKuuKuK....',
  '...KKuuuuuuKK...',
  '.K.KuUUUUUUuK.K.',
  'KuKuUTTTTTTUuKuK',
  'KuuuUTFFFFTUuuuK',
  'KuuuUTFFFFTUuuuK',
  'KuKuUTTTTTTUuKuK',
  '.K.KuUUUUUUuK.K.',
  '...KKuuuuuuKK...',
  '....KuKuuKuK....',
  '.....K.KK.K.....',
  '................',
  '................',
];

/** Scrubber catalyst: a cartridge, mesh band between two end caps. */
const SCRUBBER_CATALYST = [
  '................',
  '................',
  '....KKKKKKKK....',
  '...KWWWWWWWWK...',
  '..KKBBBBBBBBKK..',
  '..KEKKKKKKKKEK..',
  '..KEKuUuUuUKEK..',
  '..KPKUuUuUuKPK..',
  '..KPKuUuUuUKPK..',
  '..KEKUuUuUuKEK..',
  '..KEKuUuUuUKEK..',
  '..KTKKKKKKKKTK..',
  '..KKTTTTTTTTKK..',
  '...KKKKKKKKKK...',
  '................',
  '................',
];

// --- flows -----------------------------------------------------------------
// These three are networks, not goods: nobody carries them, but a building
// can still be short of one, so the popover needs them.

/** Power: a stencilled bolt. Amber is the token that already means "running". */
const POWER = [
  '................',
  '................',
  '........KKKK....',
  '.......KAAAK....',
  '......KAAAK.....',
  '.....KAAAK......',
  '....KAAAK.......',
  '...KAAAKKKK.....',
  '...KAAAAAAK.....',
  '...KKKAAAHK.....',
  '.....KAAHK......',
  '....KAAHK.......',
  '...KAAHK........',
  '...KAHK.........',
  '...KKK..........',
  '................',
];

/** Water: a droplet, blue, with a glint high on the lit side. */
const WATER = [
  '................',
  '.......KK.......',
  '......KvvK......',
  '......KVvK......',
  '.....KvVvvK.....',
  '.....KVQvvK.....',
  '....KvVQvvvK....',
  '....KVQvvvvK....',
  '...KvVQvvvvvK...',
  '...KvVvvvvvvK...',
  '...KvvvvvvvqK...',
  '...KvvvvvvvqK...',
  '...KqvvvvvqqK...',
  '....KqqvvqqK....',
  '.....KKKKKK.....',
  '................',
];

/** Air quality: a louvred extract vent, with the draught coming off it. */
const AIR_QUALITY = [
  '.....B.....B....',
  '....m.....m.....',
  '................',
  '.....KKKKKK.....',
  '...KKTTTTTTKK...',
  '..KTTKKKKKKTTK..',
  '..KTKEEEEEEKTK..',
  '.KTKKKKKKKKKKTK.',
  '.KTKEEEEEEEEKTK.',
  '.KTKKKKKKKKKKTK.',
  '..KTKEEEEEEKTK..',
  '..KTTKKKKKKTTK..',
  '...KKTTTTTTKK...',
  '.....KKKKKK.....',
  '................',
  '................',
];

// --- abstracts -------------------------------------------------------------
// Never in a store and never on the popover, but the dashboard meters them,
// so the set is only complete with them in it.

/** Labour: a worker's hard hat. */
const LABOUR = [
  '................',
  '................',
  '................',
  '......KKKK......',
  '....KKAAAAKK....',
  '...KAAHHHHAAK...',
  '..KAAHHHHHHAAK..',
  '..KAAHHHHHHAAK..',
  '.KAAAHHHHHHAAAK.',
  '.KAaAAAAAAAAaAK.',
  'KAaaaaaaaaaaaaAK',
  'KAAAAAAAAAAAAAAK',
  'KKKKKKKKKKKKKKKK',
  '................',
  '................',
  '................',
];

/** Focus: a reading lens in a brass rim. */
const FOCUS = [
  '................',
  '................',
  '....KKKKKK......',
  '..KKuuuuuuKK....',
  '..KuUGGGGUuK....',
  '.KuUGGGGGGUuK...',
  '.KuGGGGGGGGuK...',
  '.KuGGGGGGGGuK...',
  '.KuUGGGGGGUuK...',
  '..KuUGGGGUuK....',
  '..KKuuuuuuKK....',
  '....KKKKKzK.....',
  '.........KzKK...',
  '..........KzzK..',
  '...........KKK..',
  '................',
];

/** Authority: a press seal — the stamp, not the law. */
const AUTHORITY = [
  '................',
  '................',
  '......KKKK......',
  '.....KzzzzK.....',
  '.....KzUUzK.....',
  '.....KzUUzK.....',
  '....KKzUUzKK....',
  '...KzzzzzzzzK...',
  '...KzUUUUUUzK...',
  '...KKKKKKKKKK...',
  '..KuuuuuuuuuuK..',
  '..KuUUUUUUUUuK..',
  '..KKKKKKKKKKKK..',
  '................',
  '................',
  '................',
];

export const ICONS = {
  food: FOOD,
  scrap: SCRAP,
  wood: WOOD,
  paper: PAPER,
  'iron-ore': IRON_ORE,
  'copper-ore': COPPER_ORE,
  coal: COAL,
  'gold-ore': GOLD_ORE,
  limestone: LIMESTONE,
  'silica-sand': SILICA_SAND,
  'steel-billet': STEEL_BILLET,
  'copper-wire': COPPER_WIRE,
  'precision-contacts': PRECISION_CONTACTS,
  fuel: FUEL,
  'activated-carbon': ACTIVATED_CARBON,
  concrete: CONCRETE,
  glass: GLASS,
  'basic-parts': BASIC_PARTS,
  'electrical-components': ELECTRICAL_COMPONENTS,
  'precision-components': PRECISION_COMPONENTS,
  'scrubber-catalyst': SCRUBBER_CATALYST,
  power: POWER,
  water: WATER,
  'air-quality': AIR_QUALITY,
  labour: LABOUR,
  focus: FOCUS,
  authority: AUTHORITY,
};

/** An ASCII map to RGBA. Throws on a wrong-sized map or an unknown letter. */
export function paint(id, map) {
  if (map.length !== SIZE) throw new Error(`${id}: ${map.length} rows, expected ${SIZE}`);
  const px = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    if (map[y].length !== SIZE) throw new Error(`${id}: row ${y} is ${map[y].length} wide, expected ${SIZE}`);
    for (let x = 0; x < SIZE; x++) {
      const ch = map[y][x];
      if (!(ch in C)) throw new Error(`${id}: row ${y} col ${x} is '${ch}', which is not in the palette`);
      const rgb = C[ch];
      const o = (y * SIZE + x) * 4;
      if (!rgb) continue;
      px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
    }
  }
  return px;
}

function main() {
  mkdirSync(OUT, { recursive: true });
  for (const [id, map] of Object.entries(ICONS)) {
    writeFileSync(resolve(OUT, `${id}.png`), encode(SIZE, SIZE, paint(id, map)));
  }
  console.log(`${Object.keys(ICONS).length} icons -> ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
