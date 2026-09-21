# Palettes for the v4 style round. One hand-authored set per style direction.
from PIL import Image
P = {
 # 1 — V3 refined: the locked v3-deep 16, unchanged, only the prompt/knobs move
 "01-v3-refined": ["#010202","#12141d","#1e1d27","#2f323e","#3a434c","#4f5b61","#667272","#4b4240","#c58c5e","#f4d6bd","#b3bbb3","#8c442e","#b46741","#030709","#504d4f","#7e8c8d"],
 # 2 — Reference-matched: sampled from style-image.png
 "02-reference": ["#010202","#1c1c26","#333641","#403838","#4b4240","#3a434c","#48555d","#54656b","#767c78","#98a493","#743f2d","#814b37","#756d63","#c58c5e","#f4d6bd","#6f9a5a"],
 # 3 — Sodium duotone: everything is a warm brown ramp, light is pale amber
 "03-sodium-duotone": ["#0b0706","#1d1410","#2e1f18","#433024","#5c4232","#775642","#946c4f","#b5875c","#d9a86a","#f5d58e","#fff2c4"],
 # 4 — Cold steel, one warm accent: blue-grey world, amber only for lamps
 "04-cold-steel-amber": ["#05070b","#0e141c","#18212c","#243140","#324357","#44586f","#5b7189","#7a90a6","#a3b5c4","#d8a24a","#ffe39a","#8c3f2c"],
 # 5 — Machine-green enamel: old industrial green paint, brass, rust
 "05-machine-green": ["#060807","#121815","#1d2823","#2a3b33","#3a5246","#4f6b5b","#6c8a74","#8fa88f","#6b5a3a","#9a8150","#c9a864","#7a3b26","#a8552f","#e8c27a","#2b2622"],
 # 6 — Bold outline cel: saturated SNES action-game ramps, 2 shades per material
 "06-bold-cel": ["#000000","#2a2d3a","#474d63","#6f7896","#a3adc8","#5a2a1e","#a0482a","#e07a3a","#3a4a2a","#6a8a3a","#ffd65a","#fff6c8","#e8e8e8"],
 # 7 — Lineless value blocks: muted, low-saturation, cinematic-platformer
 "07-lineless-muted": ["#0a0b0d","#16181c","#23262b","#33373d","#464a50","#5d6166","#7a7c7c","#5a4a3e","#7e6650","#b89a72","#e6d2a8"],
 # 8 — Dither shading: tiny palette, shading done with ordered dither
 "08-dither": ["#000000","#1b1f2a","#3a4150","#667080","#9aa4ae","#6a3424","#b0643a","#f0c070","#fff4d0"],
 # 9 — Chiaroscuro: mostly near-black, hard amber-lit planes
 "09-chiaroscuro": ["#000000","#0a0808","#171211","#2a201b","#45342a","#6b4c36","#9b6a44","#d0924f","#f7c872","#fff0c0","#3a3f47","#5c6570"],
 # 10 — Rust & teal: painted teal machinery against rust pipework
 "10-rust-teal": ["#05080a","#0f1a1e","#17292e","#21403f","#2e5a55","#43807a","#6aa8a0","#3a2018","#6b3522","#9c5230","#c77a45","#e8b074","#fbe3b0","#4a4e52"],
}
for name, cols in P.items():
    im = Image.new("RGB", (16*len(cols), 16))
    for i, c in enumerate(cols):
        rgb = tuple(int(c[j:j+2], 16) for j in (1, 3, 5))
        for x in range(16):
            for y in range(16):
                im.putpixel((i*16+x, y), rgb)
    im.save(f"palettes/{name}.png")
    print(name, len(cols))
