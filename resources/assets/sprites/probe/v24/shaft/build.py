#!/usr/bin/env python3
"""build.py: gather every figure version named in spec.json into this folder and write figures.json.

A still is a local PNG or a character id (its east rotation is downloaded). An animation is a local strip
or {char, anim, frames} (east frames are downloaded and joined). For each image the script records the frame
size, the feet row (lowest opaque row over all frames) and the body's centre column, so the shaft page can
stand every figure on the room floor without guessing."""
import json, os, sys, subprocess, io
from PIL import Image

B = 'https://backblaze.pixellab.ai/file/pixellab-characters/bc74b8b7-40e1-46d1-a78d-8fcceceb903c'
HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

def fetch(url):
    data = subprocess.run(['curl', '-sfL', url], capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(data)).convert('RGBA')

def measure(strip, frames):
    w, h = strip.width // frames, strip.height
    bottom, heights, cx = 0, [], None
    for i in range(frames):
        box = strip.crop((i * w, 0, (i + 1) * w, h)).getchannel('A').point(lambda v: 255 if v > 0 else 0).getbbox()
        if not box: continue
        bottom = max(bottom, box[3]); heights.append(box[3] - box[1])
        if cx is None: cx = (box[0] + box[2]) / 2
    # a body that reaches the canvas edge was cropped by the generator (the teacher lost her feet this way)
    clipped = any(b and (b[1] == 0 or b[3] == h) for b in (strip.crop((i * w, 0, (i + 1) * w, h)).getchannel('A').getbbox() for i in range(frames)))
    return {'w': w, 'h': h, 'frames': frames, 'feet': bottom, 'cx': round(cx or w / 2), 'heights': [min(heights), max(heights)] if heights else None, 'clipped': clipped}

def get(src, name):
    out = f'img/{name}.png'
    if isinstance(src, str) and src.startswith('char:'):
        img = fetch(f'{B}/{src[5:]}/rotations/east.png'); frames = 1
    elif isinstance(src, dict):
        fr = [fetch(f"{B}/{src['char']}/animations/{src['anim']}/east/{i}.png") for i in range(src['frames'])]
        img = Image.new('RGBA', (fr[0].width * len(fr), fr[0].height))
        for i, f in enumerate(fr): img.alpha_composite(f, (i * fr[0].width, 0))
        frames = len(fr)
    else:
        img = Image.open(os.path.join('..', src)).convert('RGBA')
        frames = img.width // img.height
    img.save(out)
    return {'src': out, **measure(img, frames)}

def zip_anims(char):
    """All east-facing animations of a character, from its download zip, as {name: [frames]}."""
    import zipfile
    data = subprocess.run(['curl', '-sfL', f'https://api.pixellab.ai/mcp/characters/{char}/download'], capture_output=True, check=True).stdout
    z = zipfile.ZipFile(io.BytesIO(data)); out = {}
    for n in sorted(z.namelist()):
        p = n.split('/')
        if len(p) == 5 and p[1] == 'animations' and p[3] == 'east':
            out.setdefault(p[2], []).append(Image.open(io.BytesIO(z.read(n))).convert('RGBA'))
    return out

def strip_of(fr):
    img = Image.new('RGBA', (fr[0].width * len(fr), fr[0].height))
    for i, f in enumerate(fr): img.alpha_composite(f, (i * fr[0].width, 0))
    return img

TIMING = {'walk': 110, 'idle': 260}
os.makedirs('img', exist_ok=True)
spec = json.load(open('spec.json'))
only = set(sys.argv[1:])
old = {}
if os.path.exists('figures.json'):
    for r in json.load(open('figures.json'))['roles']:
        for v in r['versions']: old[v['id']] = v
for role in spec['roles']:
    for v in role['versions']:
        if only and v['id'] not in only and v['id'] in old:
            o = old[v['id']]; v['still'] = o['still']
            # keep downloaded measurements, but let the spec's timing and notes win
            spec_anims = v.get('anims', {})
            v['anims'] = {k: {**a, **{f: spec_anims[k][f] for f in ('ms', 'note', 'pp') if f in spec_anims.get(k, {})}} for k, a in o['anims'].items()}
            continue
        v['still'] = get(v['still'], f"{v['id']}-still")
        anims = {}
        for kind, a in v.get('anims', {}).items():
            try:
                anims[kind] = {**get(a['src'], f"{v['id']}-{kind}"), 'ms': a['ms'], 'note': a.get('note', ''), 'pp': a.get('pp', False)}
            except Exception as e:
                print('skip', v['id'], kind, e)
        # A version with `char` also picks up its template walk and idle from the character zip.
        if v.get('char'):
            try: za = zip_anims(v['char'])
            except subprocess.CalledProcessError: print('  zip locked (jobs pending):', v['id']); za = {}
            for name, fr in za.items():
                if name in TIMING and name not in anims:
                    img = strip_of(fr); out = f"img/{v['id']}-{name}.png"; img.save(out)
                    anims[name] = {'src': out, **measure(img, len(fr)), 'ms': TIMING[name], 'note': f'template ({name})', 'pp': False}
        v['anims'] = anims
        print(v['id'], v['still']['heights'], {k: a['heights'] for k, a in anims.items()})
json.dump(spec, open('figures.json', 'w'), indent=1)
