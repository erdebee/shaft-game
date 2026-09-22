"""dim.py [k]: a slightly dimmer copy of each non-animated room, for flicker.

Each colour of the lit render maps to one darker colour, so the palette, dithering
and every edge stay exactly as drawn. How much a colour dims comes from the room's
own off render: over all pixels of that colour, the median off/on brightness ratio
says how much of it is lamplight (lamp glass and light pools ~0.2, shadows ~0.9).
dim = colour * (1 - k * (1 - ratio)). Writes <room>-dim.png; the game swaps it with
<room>-on.png at random to flicker the lights."""
import json, sys
from collections import defaultdict
from statistics import median
from PIL import Image
k = float(sys.argv[1]) if len(sys.argv) > 1 else 0.3
lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
for room, d in json.load(open('rooms.json')).items():
    on = Image.open(f'{d}/{room}-on.png').convert('RGB')
    off = Image.open(f'{d}/{room}-off.png').convert('RGB')
    ratios = defaultdict(list)
    for p, q in zip(on.getdata(), off.getdata()):
        ratios[p].append(min(1.0, lum(q) / max(lum(p), 1)))
    lut = {c: tuple(round(v * (1 - k * (1 - median(r)))) for v in c) for c, r in ratios.items()}
    out = Image.new('RGB', on.size); out.putdata([lut[p] for p in on.getdata()])
    out.save(f'{room}-dim.png')
    l0 = sum(map(lum, on.getdata())) / (on.width * on.height); l1 = sum(map(lum, out.getdata())) / (on.width * on.height)
    print(f'{room:18s} colours {len(on.getcolors(1 << 16)):3d} -> {len(out.getcolors(1 << 16)):3d}  lum {l0:5.1f} -> {l1:5.1f} ({100 * (l1 / l0 - 1):+.0f}%)')
