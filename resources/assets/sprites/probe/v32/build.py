#!/usr/bin/env python3
"""build.py: turn the chosen takes in raw/ into the game's clips.

Every v3 take is held to its first frame's palette (the drift fix from probe/v24/shaft/fixpalette.py),
measured the way manifest figures are (feet = the floor line, one below the lowest opaque row, cx = body centre of frame 0,
height = opaque height of frame 0), and written to final/<role>-<clip>.png. The seated poses are
built here rather than generated: one generated key frame, and a second frame with everything above
the shoulders' base dropped one pixel, which is a breath. clips.json lists what was built.

  python3 build.py            build final/ and clips.json
  python3 build.py --install  also copy final/ into sprites/figures and write the manifest clips"""
import json, os, sys, shutil
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)

# role, clip, source take, frameMs, note[, (first, last) frames kept][, a fix from FIXES]
# A take starts from the standing reference pose, so a loop that plays all of it drops the
# arms to the hips and lifts them again every cycle. The optional range keeps only the
# working part: e.g. (3, 6) drops the first 3 and the last 2 of 9 frames.
TAKES = [
    # Seen from behind (north): the worker faces the machine, the tank, the counter.
    ('engineer', 'work', 'engineer-work-back-f-north', 150, 'from behind, turning a spanner at shoulder height', (2, 8)),
    ('miner', 'shovel', 'miner-work-shovel-back-d-north', 110, 'from behind, scoop and throw into the furnace (smelter)'),
    ('miner', 'sort', 'miner-work-sort-back-c-north', 140, 'from behind, lifts scrap and tosses it on the pile (recycler, salvage post)'),
    ('grower', 'back', 'grower-work-back-b-north', 220, 'from behind, reaching up into the plants (hydroponics, vats)', (3, 6)),
    ('kitchen-hand', 'work', 'kitchen-hand-work-back-d-north', 150, 'from behind, stirring at the counter', (3, 7)),
    ('pump-tech', 'work', 'pump-tech-work-back-a-north', 140, 'from behind, turning a valve wheel'),
    ('medic', 'work', 'medic-work-back-f-north', 200, 'from behind, writing up notes on a clipboard', (3, 8), 'neck-from-rotation'),
    # Side view (east), mirrored for west.
    ('grower', 'work', 'grower-work-tend-a-east', 150, 'bends to water the plants (grove)'),
    ('air-tech', 'work', 'air-tech-work-gauge-a-east', 180, 'reads a gauge, notes it on the clipboard'),
    ('archivist', 'work', 'archivist-work-read-a-east', 220, 'reading, turning a page'),
    ('teacher', 'work', 'teacher-work-lecture-a-east', 160, 'lecturing, pointing at the board'),
    ('councillor', 'present', 'councillor-work-present-a-east', 160, 'speaking at the lectern'),
]
# Clips an earlier round installed that no take now fills: removed from the manifest and figures/.
RETIRED = [('engineer', 'wrench'), ('kitchen-hand', 'cook')]
# role, clip, key frame, breathing cut row (rows above it drop 1 px), erase from row, feet row, frameMs, note
POSES = [
    ('child', 'seated', 'child-seated-key', 24, None, None, 650, 'seated at a desk, facing the room'),
    ('resident', 'seated-back', 'resident-seated-back-key', 30, 35, 34, 750, 'on a stool, seen from behind'),
]

def frames_of(img, n=None):
    w = img.height; n = n or img.width // w
    return [img.crop((i * w, 0, (i + 1) * w, w)) for i in range(n)]

def strip(frames):
    w, h = frames[0].size; s = Image.new('RGBA', (w * len(frames), h))
    for i, f in enumerate(frames): s.alpha_composite(f, (i * w, 0))
    return s

def hold_palette(frames):
    pal = [c[1][:3] for c in frames[0].getcolors(1 << 16) if c[1][3] > 128]
    cache = {}
    for f in frames[1:]:
        px = f.load()
        for y in range(f.height):
            for x in range(f.width):
                r, g, b, a = px[x, y]
                if a < 128 or (r, g, b) in pal: continue
                if (r, g, b) not in cache: cache[(r, g, b)] = min(pal, key=lambda p: sum((u - v) ** 2 for u, v in zip(p, (r, g, b))))
                px[x, y] = (*cache[(r, g, b)], a)
    return frames

def despeckle(frames):
    for f in frames:
        px = f.load(); w, h = f.size
        lone = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] and not any(
            0 <= x + dx < w and 0 <= y + dy < h and px[x + dx, y + dy][3]
            for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy)]
        for x, y in lone: px[x, y] = (0, 0, 0, 0)
    return frames

def neck_from_rotation(frames, rotation='raw/medic-rot-north.png'):
    """The medic's clipboard pokes out beside her head as corners with an outline round
    them. Recolouring them leaves dark blobs, so everything from the third row of her
    head down to the top of her shoulders is rebuilt instead, from her plain back rotation, lined
    up on where her head is in each frame: her own neck and collar, nothing else."""
    ref = Image.open(rotation).convert('RGBA')
    def rows(img):
        box = [img.crop((0, y, img.width, y + 1)).getchannel('A').getbbox() for y in range(img.height)]
        return [(b[0], b[2]) if b else None for b in box]
    rr = rows(ref)
    r_top = next(y for y, b in enumerate(rr) if b)
    r_left = min(b[0] for b in rr[r_top:r_top + 5] if b)
    r_width = max(b[1] - b[0] for b in rr[r_top:r_top + 5] if b)
    # the reference's own shoulders: the first row wider than its head by 3 or more
    r_shoulder = next(y for y in range(r_top, ref.height) if rr[y] and rr[y][1] - rr[y][0] >= r_width + 3)
    for f in frames:
        fr = rows(f)
        top = next(y for y, b in enumerate(fr) if b)
        left = min(b[0] for b in fr[top:top + 5] if b)
        width = max(b[1] - b[0] for b in fr[top:top + 5] if b)
        shoulder = next(y for y in range(top, f.height) if fr[y] and fr[y][1] - fr[y][0] >= width + 3)
        dx = left - r_left
        # from the third row of the head: the corners' tips reach up beside the hair
        for y in range(top + 3, shoulder):
            ry = min(r_top + (y - top), r_shoulder - 1)  # past the reference's neck, repeat its last neck row
            for x in range(f.width):
                sx = x - dx
                f.putpixel((x, y), ref.getpixel((sx, ry)) if 0 <= sx < ref.width else (0, 0, 0, 0))
    return frames

FIXES = {'neck-from-rotation': neck_from_rotation}

def measure(frames, feet=None):
    boxes = [f.getchannel('A').point(lambda v: 255 if v > 0 else 0).getbbox() for f in frames]
    b0 = boxes[0]
    return {'w': frames[0].width, 'h': frames[0].height, 'frames': len(frames),
            'feet': feet if feet is not None else max(b[3] for b in boxes if b),
            'cx': round((b0[0] + b0[2]) / 2), 'height': (feet if feet is not None else b0[3]) - b0[1],
            'clipped': any(b[0] == 0 or b[1] == 0 or b[2] == f.width or b[3] == f.height for b, f in zip(boxes, frames) if b)}

os.makedirs('final', exist_ok=True)
out = []
for role, clip, src, ms, note, *extra in TAKES:
    fr = despeckle(hold_palette(frames_of(Image.open(f'raw/{src}.png').convert('RGBA'))))
    keep = next((e for e in extra if isinstance(e, tuple)), None)
    if keep: fr = fr[keep[0]:keep[1] + 1]
    for name in (e for e in extra if isinstance(e, str)): fr = FIXES[name](fr)
    strip(fr).save(f'final/{role}-{clip}.png')
    out.append({'role': role, 'clip': clip, 'source': src, 'frameMs': ms, 'note': note, **measure(fr)})

for role, clip, src, cut, erase, feet, ms, note in POSES:
    key = Image.open(f'raw/{src}.png').convert('RGBA')
    if erase is not None:  # the generator drew its own stool; the room has one
        px = key.load()
        for y in range(erase, key.height):
            for x in range(key.width): px[x, y] = (0, 0, 0, 0)
    breath = Image.new('RGBA', key.size)
    breath.alpha_composite(key.crop((0, cut, key.width, key.height)), (0, cut))
    breath.alpha_composite(key.crop((0, 0, key.width, cut)), (0, 1))
    fr = [key, breath]
    strip(fr).save(f'final/{role}-{clip}.png')
    out.append({'role': role, 'clip': clip, 'source': src, 'frameMs': ms, 'note': note, **measure(fr, feet)})

json.dump(out, open('clips.json', 'w'), indent=1)
for c in out: print(f"{c['role']:13} {c['clip']:12} {c['w']}x{c['h']}x{c['frames']} feet {c['feet']} cx {c['cx']} h {c['height']}{'  CLIPPED' if c['clipped'] else ''}")

if '--install' in sys.argv:
    mpath = '../../../manifest.json'
    m = json.load(open(mpath))
    roles = {r['role']: r for r in m['figures']['roles']}
    for c in out:
        path = f"sprites/figures/{c['role']}-{c['clip']}.png"
        shutil.copy(f"final/{c['role']}-{c['clip']}.png", f'../../../{path}')
        roles[c['role']]['clips'][c['clip']] = {k: c[k] for k in ('w', 'h', 'frames', 'feet', 'cx', 'height', 'frameMs')} | {'path': path}
        # path first, as in the rest of the block
        cl = roles[c['role']]['clips'][c['clip']]
        roles[c['role']]['clips'][c['clip']] = {'path': cl.pop('path'), **cl}
    for role, clip in RETIRED:
        gone = roles[role]['clips'].pop(clip, None)
        if gone and os.path.exists(f"../../../{gone['path']}"): os.remove(f"../../../{gone['path']}")
    open(mpath, 'w').write(json.dumps(m, indent=1) + '\n')
    print('installed', len(out), 'clips; retired', RETIRED)

# ---- inline data: everything index.html needs, written into the page itself ----
# The page must open however it is opened: from the dev server, from disk (file://, which
# may not fetch() or import modules) and as the preview pane's data: snapshot (which cannot
# resolve a relative path at all). So the manifest bits, the clip list, the crew logic and
# every image the page draws travel inside index.html, between the data:begin/end markers.
# crew.js is copied from the real module (and visualJitter from interpolate.js) every
# build, so the page still runs the game's code.
import re, base64
SRC = '../../../../../src/ui/view/'
m = json.load(open('../../../manifest.json'))
jobs = json.load(open('../../../../data/catalog/population/jobs.json'))['jobs']
jitter = re.search(r'export function visualJitter\(key\) \{.*?\n\}', open(SRC + 'interpolate.js').read(), re.S).group(0)
crew = open(SRC + 'crew.js').read()
crew = re.sub(r"^import .*?;\n", '', crew, flags=re.M)
names = re.findall(r'^export (?:function|const) (\w+)', crew, re.M)
body = (jitter + '\n' + crew).replace('export function', 'function').replace('export const', 'const')
paths = {c['path'] for r in m['figures']['roles'] for c in r['clips'].values()}
paths |= {s['path'] for s in m['sprites'] if s['id'].endswith('-on') or s['id'].endswith('-on-fg')}
images = {p: 'data:image/png;base64,' + base64.b64encode(open('../../../' + p, 'rb').read()).decode() for p in sorted(paths)}
data = {
    'sprites': [{k: s[k] for k in ('id', 'path', 'floorY') if k in s} for s in m['sprites']],
    'roles': m['figures']['roles'], 'stages': m['figures']['rooms'],
    'jobs': [{'id': j['id'], 'worksIn': j.get('worksIn', [])} for j in jobs],
    'clips': out, 'images': images,
}
block = ('<!-- data:begin (written by build.py; rebuild rather than edit) -->\n<script>\n'
         f'window.PROBE = {json.dumps(data)};\n'
         'window.crew = (function () {\n' + body + f"\nreturn {{ {', '.join(names)} }};\n}})();\n"
         '</script>\n<!-- data:end -->')
page = open('index.html').read()
page = re.sub(r'<!-- data:begin.*?<!-- data:end -->', lambda _: block, page, flags=re.S)
open('index.html', 'w').write(page)
print(f'inlined {len(images)} images and crew ({", ".join(names)}) into index.html, {len(page) // 1024} KB')
