# Cut a 104-row periodic tile out of a 208-tall render. Row r of the tile takes render row
# o + ((r - o) mod 104), so the content keeps its level alignment (exit landing on row 88)
# and the only seam sits between tile rows o-1 and o, where rows o and o+104 of the render match best.
import sys
from PIL import Image
def rowdiff(px,w,y1,y2): return sum(abs(a-b) for x in range(w) for a,b in zip(px[x,y1],px[x,y2]))/(w*3)
for f in sys.argv[1:]:
    im=Image.open(f).convert('RGB'); w,h=im.size; px=im.load()
    errs=sorted((rowdiff(px,w,o,o+104)+0.5*rowdiff(px,w,max(o-1,0),o+103),o) for o in range(104))
    e,o=errs[0]
    tile=Image.new('RGB',(w,104)); tp=tile.load()
    for r in range(104):
        src=o+((r-o)%104)
        for x in range(w): tp[x,r]=px[x,src]
    tile.save(f.replace('.png','-tile.png'))
    print(f,'seam at row',o,'error',round(e,1),'median',round(errs[52][0],1))
