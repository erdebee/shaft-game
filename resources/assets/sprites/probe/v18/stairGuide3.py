# Continuous 2-slot stairwell: no slabs, no ceiling. Period 104 px (one level); drawn 208 tall (two periods)
# so every shape wraps and the sketch tiles seamlessly. Per level: an exit landing on the right at the rooms'
# floor line (row 88), flight A up-left to a half landing on the left, flight B up-right to the next exit landing.
from PIL import Image
import base64, io
W,PER,N=128,104,2; H=PER*N
hexc=lambda h: tuple(int(h[i:i+2],16) for i in (1,3,5))
P=dict(dark='#140f18',ink='#241c26',plum='#372c34',slate='#4f4148',mauve='#6c5a5c',taupe='#8e7870',sand='#b69c86',cream='#dcc6a4',
       teal='#33585a',tealLit='#4f837c',amber='#f2b25a')
im=Image.new('RGB',(W,H),hexc(P['slate'])); px=im.load()
def rect(x0,y0,x1,y1,c):
    for y in range(y0,y1+1):
        for x in range(max(0,x0),min(W-1,x1)+1): px[x,y%H]=hexc(P[c])
for p in range(N):
    o=p*PER
    rect(0,o,2,o+PER-1,'dark')                                  # shaft wall, continuous
    for k in range(13):                                         # rear flight B: half landing -> next exit landing
        x=20+6*k; y=o+36-4*k
        rect(x,y,x+5,y+3,'mauve'); rect(x,y+4,x+5,y+7,'plum')
    rect(4,o+36,22,o+39,'taupe'); rect(4,o+40,22,o+42,'plum')   # half landing (thin)
    for k in range(13):                                         # front flight A: exit landing -> half landing
        x=90-6*k; y=o+84-4*k
        rect(x,y,x+5,y+3,'sand'); rect(x,y+4,x+5,y+7,'mauve')
        rect(x,y-12,x+5,y-12,'tealLit')                         # handrail
    rect(96,o+88,127,o+91,'taupe'); rect(96,o+92,127,o+94,'plum')  # exit landing (thin), opens to the rooms
    rect(102,o+60,124,o+76,'cream'); rect(103,o+61,123,o+75,'teal')  # floor sign by the exit
    rect(112,o+52,114,o+55,'amber')                             # lamp over the sign
B=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]
cl=lambda v:max(0,min(255,v))
# Lighting: one lamp pool per level around the sign/exit, dithered falloff, so the pattern repeats per level.
out=im.copy(); o_=out.load()
for y in range(H):
    for x in range(W):
        yy=y%PER; d=((x-110)**2+(yy-60)**2)**0.5/60 + B[y%4][x%4]/16*0.6
        band=min(3,int(d*1.6)); G=[1.18,1.05,0.92,0.8][band]; T=[(8,2,-6),(3,0,-2),(-2,0,3),(-5,-1,6)][band]
        r,g,b=px[x,y]; o_[x,y]=tuple(cl(int(cl(int(v*G))+T[k])) for k,v in enumerate((r,g,b)))
out.save('guide3-stairwell-lit.png')
n=len(out.getcolors(1<<20)); q=out.quantize(colors=min(n,256),method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE)
buf=io.BytesIO(); q.save(buf,'PNG',optimize=True); b=base64.b64encode(buf.getvalue()).decode()
open('guide3-stairwell-lit.b64','w').write(b); print(n,len(b)); print(b)
S=Image.new('RGB',(W,H*2)); S.paste(out,(0,0)); S.paste(out,(0,H)); S.resize((W*2,H*4),Image.NEAREST).save('/private/tmp/claude-501/-Users-roybrondgeest-Documents-silogame/e86563f9-ca69-4d10-8f6e-38e6ce6a69a0/scratchpad/g3.png')
