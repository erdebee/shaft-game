"""compose_anim.py <spec.json>: paste animated parts back into a room.

Each spec: {"room": base render, "out": name, "parts": [{"frames": "prefix" (prefix-0..N.png),
"at": [x, y] where the frames sit in the room, "shapes": [["rect"|"ellipse", x0, y0, x1, y1], ...]}],
"n": frames, "pingpong": bool}. Only pixels inside the shapes (room coordinates, inclusive)
come from the animation; everything else is the untouched base render, so nothing outside
the named parts can move. Writes <out>-strip.png, <out>-mask.png and <out>.gif (3x)."""
import json, sys
from PIL import Image, ImageDraw
for spec in json.load(open(sys.argv[1])):
    base = Image.open(spec['room']).convert('RGB'); w, h = base.size; n = spec['n']
    order = list(range(n + 1)) + (list(range(n - 1, 0, -1)) if spec.get('pingpong') else [])
    if not spec.get('pingpong'): order = list(range(n))       # frame n ~ frame 0 for true loops
    mask = Image.new('L', (w, h)); frames = [base.copy() for _ in order]
    for part in spec['parts']:
        m = Image.new('L', (w, h)); d = ImageDraw.Draw(m)
        for s in part['shapes']:
            (d.rectangle if s[0] == 'rect' else d.ellipse)(s[1:], fill=255)
        mask.paste(255, (0, 0), m)
        for k, i in enumerate(order):
            f = Image.open(f"{part['frames']}-{i}.png").convert('RGB')
            layer = base.copy(); layer.paste(f, tuple(part['at']))
            frames[k] = Image.composite(layer, frames[k], m)
    out = spec['out']; mask.save(f'{out}-mask.png')
    strip = Image.new('RGB', (w * len(frames), h))
    for k, f in enumerate(frames): strip.paste(f, (k * w, 0))
    strip.save(f'{out}-strip.png')
    big = [f.resize((w * 3, h * 3), Image.NEAREST) for f in frames]
    big[0].save(f'{out}.gif', save_all=True, append_images=big[1:], duration=spec.get('ms', 120), loop=0)
    print(out, len(frames), 'frames, mask px', sum(1 for v in mask.getdata() if v))
