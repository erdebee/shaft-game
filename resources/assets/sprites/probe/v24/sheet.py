"""sheet.py <dir> <rows spec>: 6x lineup of figures, one row per role, columns per wording.
Usage: python3 sheet.py r2 porter,councillor,miner,child w1,w2,w3"""
import sys
from PIL import Image, ImageDraw
d, roles, cols = sys.argv[1], sys.argv[2].split(','), sys.argv[3].split(',')
S, CW, RH = 5, 30, 48
def crop(p):
    im = Image.open(p).convert('RGBA'); b = im.getchannel('A').point(lambda v: 255 if v else 0).getbbox()
    return im.crop(b) if b else im
sheet = Image.new('RGBA', ((len(cols) * CW + 30) * S, (len(roles) * RH) * S + 16), (58, 50, 58, 255))
dr = ImageDraw.Draw(sheet)
for j, c in enumerate(cols): dr.text(((30 + j * CW) * S + 4, 2), c, fill=(255, 220, 120))
for i, r in enumerate(roles):
    dr.text((4, (i * RH + RH // 2) * S), r, fill=(255, 220, 120))
    for j, c in enumerate(cols):
        try: f = crop(f'{d}/{r}-{c}.png')
        except FileNotFoundError: continue
        big = f.resize((f.width * S, f.height * S), Image.NEAREST)
        x = (30 + j * CW) * S + (CW * S - big.width) // 2; y = 16 + ((i + 1) * RH - 2) * S - big.height
        sheet.alpha_composite(big, (x, y))
        dr.text(((30 + j * CW) * S + 4, 16 + ((i + 1) * RH - 2) * S + 2 - 14), f'{f.height}px', fill=(170, 200, 190))
sheet.convert('RGB').save(f'{d}/lineup.png'); print(sheet.size)
