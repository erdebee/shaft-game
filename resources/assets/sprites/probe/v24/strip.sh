#!/bin/zsh
# strip.sh <out.png> <character-id> <animation-id> <frames>: download east frames and join them into a strip
B=https://backblaze.pixellab.ai/file/pixellab-characters/bc74b8b7-40e1-46d1-a78d-8fcceceb903c
tmp=$(mktemp -d)
for ((i=0; i<$4; i++)); do curl -sfL -o "$tmp/$i.png" "$B/$2/animations/$3/east/$i.png" || { echo "missing frame $i"; exit 1; }; done
python3 - "$1" "$tmp" "$4" <<'PY'
import sys
from PIL import Image
out, d, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
fr = [Image.open(f'{d}/{i}.png').convert('RGBA') for i in range(n)]
w, h = fr[0].size; s = Image.new('RGBA', (w * n, h))
hs = []
for i, f in enumerate(fr):
    s.alpha_composite(f, (i * w, 0)); b = f.getchannel('A').point(lambda v: 255 if v else 0).getbbox(); hs.append(b[3] - b[1])
s.save(out); print(out, f'{w}x{h}', 'heights', hs)
PY
