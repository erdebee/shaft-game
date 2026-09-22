# sheet.py out.png name... : side-by-side at 3x (64) / 2x (wider), labelled rows of a/b tries
import sys
from PIL import Image, ImageDraw
out, names = sys.argv[1], sys.argv[2:]
rows = []
for n in names:
    ims = [Image.open(f'{n}-{s}.png').convert('RGB') for s in (sys.argv[1].split('@')[1] if '@' in sys.argv[1] else 'ab')]
    rows.append((n, ims))
S = 3 if max(i.width for _, r in rows for i in r) <= 64 else 2
W = max(sum(i.width * S + 12 for i in r) for _, r in rows) + 120
H = sum(96 * S + 12 for _ in rows)
sheet = Image.new('RGB', (W, H), (20, 18, 24)); d = ImageDraw.Draw(sheet); y = 0
for n, r in rows:
    d.text((4, y + 4), n, fill=(230, 220, 200)); x = 120
    for im in r:
        sheet.paste(im.resize((im.width * S, im.height * S), Image.NEAREST), (x, y)); x += im.width * S + 12
    y += 96 * S + 12
sheet.save(out)
