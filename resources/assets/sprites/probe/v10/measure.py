from PIL import Image
import sys
def bbox(path):
    im=Image.open(path).convert('RGBA'); a=im.getchannel('A')
    b=a.point(lambda v:255 if v>128 else 0).getbbox()
    return b
for n in sys.argv[1:]:
    b=bbox(n); print(n.ljust(28),'h',b[3]-b[1],'w',b[2]-b[0],'top',b[1],'bottom',b[3]-1)
