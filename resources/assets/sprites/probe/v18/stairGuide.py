# Stairwell blockout, 64x104 = one level (96 room + 8 slab), meant to tile vertically.
# Switchback: flight 1 climbs bottom-left -> half landing on the right, flight 2 climbs back to the top-left,
# arriving on the slab of the tile above. Floor-sign plate on the wall above flight 2's foot.
from PIL import Image
import base64, io, sys
W,H=64,104
hexc=lambda h: tuple(int(h[i:i+2],16) for i in (1,3,5))
P=dict(dark='#140f18',ink='#241c26',plum='#372c34',slate='#4f4148',mauve='#6c5a5c',taupe='#8e7870',sand='#b69c86',cream='#dcc6a4',
       tealDeep='#1f3638',teal='#33585a',tealLit='#4f837c',rust='#8e3f30',terracotta='#cf6a40',amber='#f2b25a')
im=Image.new('RGB',(W,H),hexc(P['slate'])); px=im.load()
def rect(x0,y0,x1,y1,c):
    for y in range(max(0,y0),min(H-1,y1)+1):
        for x in range(max(0,x0),min(W-1,x1)+1): px[x,y]=hexc(P[c])
rect(0,0,2,H-1,'dark'); rect(61,0,63,H-1,'dark')            # shaft column edges
# flight 2 (behind): from half landing (x~50,y~50) up-left to top-left (x~6,y~0)
for i in range(12):
    x=50-i*4; y=48-i*4
    rect(x-3,y,x,y+3,'mauve'); rect(x-3,y+4,x,y+6,'plum')
rect(44,48,58,52,'taupe'); rect(44,53,58,55,'plum')         # half landing
# flight 1 (front): from the slab at bottom-left up to the half landing
for i in range(11):
    x=6+i*4; y=92-i*4
    rect(x,y,x+3,y+3,'sand'); rect(x,y+4,x+3,y+6,'mauve')
for i in range(11):                                         # handrail following flight 1
    x=6+i*4; y=80-i*4; rect(x,y,x+3,y,'tealLit')
rect(6,40,6,80,'tealDeep')
rect(34,12,56,26,'cream'); rect(35,13,55,25,'teal')         # floor-sign plate (blank)
rect(46,4,48,6,'amber')                                     # lamp over the sign
rect(0,96,63,96,'taupe'); rect(0,97,63,103,'mauve')         # slab = landing of this level
# lighting bands + Bayer dither, same as roomGuide --lit
B=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]; G=[1.18,1.05,0.92,0.8]; T=[(8,2,-6),(3,0,-2),(-2,0,3),(-5,-1,6)]
cl=lambda v:max(0,min(255,v))
out=im.copy(); o=out.load()
for y in range(H):
    for x in range(W):
        band=min(3,int((y/H)*3+B[y%4][x%4]/16)); r,g,b=px[x,y]
        o[x,y]=tuple(cl(int(cl(int(v*G[band]))+T[band][k])) for k,v in enumerate((r,g,b)))
out.save('guide-stairwell-lit.png'); im.save('guide-stairwell.png')
n=len(out.getcolors(1<<20)); q=out.quantize(colors=n,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE)
buf=io.BytesIO(); q.save(buf,'PNG',optimize=True); b=base64.b64encode(buf.getvalue()).decode()
open('guide-stairwell-lit.b64','w').write(b); print(n,len(b)); print(b)
# preview: three tiles stacked
S=Image.new('RGB',(W,H*3)); [S.paste(out,(0,H*i)) for i in range(3)]; S.resize((W*4,H*12),Image.NEAREST).save('/private/tmp/claude-501/-Users-roybrondgeest-Documents-silogame/e86563f9-ca69-4d10-8f6e-38e6ce6a69a0/scratchpad/stairguide.png')
