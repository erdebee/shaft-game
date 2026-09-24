#!/usr/bin/env python3
"""pull.py [role ...]: download every 'work-*' and 'sit-*' animation of the kept figures from their
PixelLab character zips into raw/<role>-<animation>-<direction>.png (a horizontal strip), plus the
south and north rotations for the seated poses. A character with a job still running answers 423
and is skipped; run again later. Prints each take's per-frame opaque boxes so a clipped or drifting
take shows before anyone looks at it."""
import sys, io, os, re, zipfile, subprocess
from PIL import Image

CHARS = {
    'engineer': 'f32f7c52-8941-4174-8079-f2674b7e0f9c',
    'miner': '53d91e8d-eaf9-40f8-b3c6-0c21d959323e',
    'grower': '5a4b77fe-ade8-47e6-839e-737d5a8cc8c6',
    'kitchen-hand': '1a75fc44-ef95-4c04-9da1-311407c1cb31',
    'pump-tech': '883e9a8b-5209-40a7-947c-f752553ff1e5',
    'air-tech': '519f6b3e-de35-44af-ae47-643bfe796f52',
    'medic': 'bfb633d6-bbe1-48a6-a765-4e6771041f03',
    'teacher': '48ce42f3-4783-4f72-9605-45ae26043ad8',
    'archivist': 'fb725cae-bfd6-47b2-9dd1-70fac32df473',
    'councillor': '43e588dd-2149-4fce-9290-30f6924211dd',
    'resident': '47fec6e0-7ea6-4a07-bb6d-2d80baf2ecda',
    'resident-b': '7e56a44f-3a70-4a9d-9ea7-1a409a3d147a',
    'child': '28e7571f-9cb0-49de-9c29-7938c09c8fac',
    'elder': '991b42bd-2d05-406e-bde6-196e93f19a49',
}
os.chdir(os.path.dirname(os.path.abspath(__file__)))
os.makedirs('raw', exist_ok=True)

def box(f):
    return f.getchannel('A').point(lambda v: 255 if v > 0 else 0).getbbox()

for role, char in CHARS.items():
    if sys.argv[1:] and role not in sys.argv[1:]: continue
    r = subprocess.run(['curl', '-sfL', f'https://api.pixellab.ai/mcp/characters/{char}/download'], capture_output=True)
    if r.returncode: print(role, 'busy (jobs running)'); continue
    z = zipfile.ZipFile(io.BytesIO(r.stdout))
    clips = {}
    for n in sorted(z.namelist()):
        m = re.match(r'[^/]+/animations/((?:work|sit)-[^/]+)/([a-z-]+)/frame_(\d+)\.png$', n)
        if m: clips.setdefault((m[1], m[2]), []).append(Image.open(io.BytesIO(z.read(n))).convert('RGBA'))
        m = re.match(r'[^/]+/rotations/(south|north)\.png$', n)
        if m: Image.open(io.BytesIO(z.read(n))).save(f'raw/{role}-rot-{m[1]}.png')
    for (anim, d), fr in clips.items():
        # A take started from a custom frame can come back on a canvas that is not square;
        # clips are square cells, so pad it: centred across, standing on the bottom edge.
        side = max(fr[0].size)
        fr = [sq for f in fr for sq in [Image.new('RGBA', (side, side))] if not sq.alpha_composite(f, ((side - f.width) // 2, side - f.height))]
        w, h = side, side
        s = Image.new('RGBA', (w * len(fr), h))
        for i, f in enumerate(fr): s.alpha_composite(f, (i * w, 0))
        out = f'raw/{role}-{anim}-{d}.png'
        s.save(out)
        print(out, f'{w}x{h}x{len(fr)}', [box(f) for f in fr])
