# 2-slot stairwell blockout, 128x104 = one level (96 room + 8 slab), tiling vertically into one continuous stair.
# Front flight A: floor landing (left, row 88) up-right to a half landing (right, row 36).
# Rear flight B: half landing up-left, crossing the top edge; it wraps to the bottom-left of the tile,
# so in a stack it arrives on the next floor's landing. Floor walkway exits to the right, sign beside it.
from PIL import Image
import base64, io
W,H=128,104
hexc=lambda h: tuple(int(h[i:i+2],16) for i in (1,3,5))
P=dict(dark='#140f18',ink='#241c26',plum='#372c34',slate='#4f4148',mauve='#6c5a5c',taupe='#8e7870',sand='#b69c86',cream='#dcc6a4',
       tealDeep='#1f3638',teal='#33585a',tealLit='#4f837c',amber='#f2b25a')
im=Image.new('RGB',(W,H),hexc(P['slate'])); px=im.load()
def rect(x0,y0,x1,y1,c):
    for y in range(y0,y1+1):
        for x in range(max(0,x0),min(W-1,x1)+1): px[x,y%H]=hexc(P[c])
rect(0,0,2,H-1,'dark')                                      # shaft wall on the far left
for k in range(14):                                         # rear flight B, wraps across the top edge
    x=112-8*k; y=36-4*k
    rect(x-7,y,x,y+3,'mauve'); rect(x-7,y+4,x,y+7,'plum')
rect(108,36,127,39,'taupe'); rect(108,40,127,43,'plum')     # half landing
for k in range(13):                                         # front flight A
    x=12+8*k; y=84-4*k
    rect(x,y,x+7,y+3,'sand'); rect(x,y+4,x+7,y+7,'mauve')
for k in range(13):                                         # handrail on flight A
    x=12+8*k; y=70-4*k; rect(x,y,x+7,y,'tealLit')
rect(92,62,120,78,'cream'); rect(93,63,119,77,'teal')       # floor sign beside the exit
rect(62,10,64,14,'amber'); rect(24,10,26,14,'amber')        # lamps
rect(0,88,12,88,'taupe'); rect(0,89,12,95,'mauve')          # floor landing, left
rect(48,88,127,88,'taupe'); rect(48,89,127,95,'mauve')      # walkway out to the rooms
rect(0,96,12,103,'plum'); rect(48,96,127,103,'plum')        # slab (open where the stair passes)
B=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]; G=[1.18,1.05,0.92,0.8]; T=[(8,2,-6),(3,0,-2),(-2,0,3),(-5,-1,6)]
cl=lambda v:max(0,min(255,v))
out=im.copy(); o=out.load()
for y in range(H):
    for x in range(W):
        band=min(3,int((y/H)*3+B[y%4][x%4]/16)); r,g,b=px[x,y]
        o[x,y]=tuple(cl(int(cl(int(v*G[band]))+T[band][k])) for k,v in enumerate((r,g,b)))
out.save('guide2-stairwell-lit.png'); im.save('guide2-stairwell.png')
n=len(out.getcolors(1<<20)); q=out.quantize(colors=n,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE)
buf=io.BytesIO(); q.save(buf,'PNG',optimize=True); b=base64.b64encode(buf.getvalue()).decode()
open('guide2-stairwell-lit.b64','w').write(b); print(n,len(b)); print(b)
S=Image.new('RGB',(W,H*3)); [S.paste(out,(0,H*i)) for i in range(3)]; S.resize((W*3,H*9),Image.NEAREST).save('/private/tmp/claude-501/-Users-roybrondgeest-Documents-silogame/e86563f9-ca69-4d10-8f6e-38e6ce6a69a0/scratchpad/stairguide2.png')
