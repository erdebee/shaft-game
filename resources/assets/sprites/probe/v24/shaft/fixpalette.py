#!/usr/bin/env python3
"""fixpalette.py <in.png> <frames> <out.png> [ref-frame]: hold an animation to one palette.

A v3 animation redraws every frame, so colours drift a little from frame to frame (the miner's
trousers go green mid-swing). Each pixel whose colour is not in the reference frame's palette is
moved to the nearest colour that is, which leaves the drawing alone and only corrects the tone."""
import sys
from PIL import Image

src, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
ref_i = int(sys.argv[4]) if len(sys.argv) > 4 else 0
im = Image.open(src).convert('RGBA')
w = im.width // n
frames = [im.crop((i * w, 0, (i + 1) * w, im.height)) for i in range(n)]
palette = [c[1][:3] for c in frames[ref_i].getcolors(1 << 16) if c[1][3] > 128]

def near(c):
    return min(palette, key=lambda p: sum((a - b) ** 2 for a, b in zip(p, c)))

cache, moved = {}, 0
for f in frames:
    px = f.load()
    for y in range(f.height):
        for x in range(f.width):
            r, g, b, a = px[x, y]
            if a < 128 or (r, g, b) in palette: continue
            if (r, g, b) not in cache: cache[(r, g, b)] = near((r, g, b))
            px[x, y] = (*cache[(r, g, b)], a)
            moved += 1

res = Image.new('RGBA', im.size)
for i, f in enumerate(frames): res.alpha_composite(f, (i * w, 0))
res.save(out)
print(f'{out}: {len(palette)} colours, {moved} pixels moved')
