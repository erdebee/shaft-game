"""clean_anim.py <prefix> <n_frames> <out>: keep motion only where it recurs.

Pixels that change (>24 luma) in at least two frames, grown by 1 px, with specks
under 6 px dropped, form the motion mask; everything else is copied from frame 0,
so the room itself cannot shimmer. Writes <out>-strip.png (frames side by side)
and <out>.gif (3x, 120 ms)."""
import sys
from PIL import Image, ImageChops, ImageFilter
pre, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
fr = [Image.open(f'{pre}-{i}.png').convert('RGB') for i in range(n)]
w, h = fr[0].size
count = [0] * (w * h)
for f in fr[1:]:
    d = ImageChops.difference(fr[0], f).convert('L').load()
    for y in range(h):
        for x in range(w):
            if d[x, y] > 24: count[y * w + x] += 1
m = Image.new('L', (w, h)); m.putdata([255 if c >= 2 else 0 for c in count])
# drop specks: flood-fill components, keep size >= 6
px = m.load(); seen = set()
for y in range(h):
    for x in range(w):
        if px[x, y] and (x, y) not in seen:
            comp, st = [], [(x, y)]; seen.add((x, y))
            while st:
                cx, cy = st.pop(); comp.append((cx, cy))
                for nx, ny in ((cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1)):
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and (nx, ny) not in seen:
                        seen.add((nx, ny)); st.append((nx, ny))
            if len(comp) < 6:
                for p in comp: px[p] = 0
m = m.filter(ImageFilter.MaxFilter(3))
clean = [Image.composite(f, fr[0], m) for f in fr]
m.save(f'{out}-mask.png')
strip = Image.new('RGB', (w * n, h))
for i, f in enumerate(clean): strip.paste(f, (i * w, 0))
strip.save(f'{out}-strip.png')
big = [f.resize((w * 3, h * 3), Image.NEAREST) for f in clean]
big[0].save(f'{out}.gif', save_all=True, append_images=big[1:], duration=120, loop=0)
print(out, 'mask px', sum(1 for v in m.getdata() if v), 'of', w * h)
