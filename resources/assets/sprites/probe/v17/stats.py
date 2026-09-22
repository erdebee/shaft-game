import sys
from PIL import Image, ImageStat
def floor(im):
    w,h=im.size; px=im.load(); best=(0,88)
    for y in range(int(h*0.72),h):
        ch=sum(1 for x in range(w) if px[x,y]!=px[x,y-1])
        if ch>best[0]: best=(ch,y)
    return best[1]
for f in sys.argv[1:]:
    im=Image.open(f).convert('RGB'); g=im.convert('L'); s=ImageStat.Stat(g)
    print(f"{f:28s} colours {len(im.getcolors(1<<20)):3d} lum {s.mean[0]:5.1f} contrast {s.stddev[0]:5.1f} floor {floor(im)}")
