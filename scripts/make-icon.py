"""Gera build/icon.png e build/icon.ico (marca do LeagueSense: hexágono vazado com núcleo)."""
import math
from PIL import Image, ImageDraw

ACCENT = (92, 200, 180, 255)
BG = (13, 15, 19, 255)

def hexagon(cx, cy, r, rot=-90):
    return [(cx + r * math.cos(math.radians(rot + 60 * i)), cy + r * math.sin(math.radians(rot + 60 * i))) for i in range(6)]

def render(size):
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # placa arredondada de fundo
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=BG)
    cx = cy = s / 2
    outer = hexagon(cx, cy, s * 0.34)
    d.line(outer + [outer[0]], fill=ACCENT, width=int(s * 0.045), joint="curve")
    d.polygon(hexagon(cx, cy, s * 0.15), fill=ACCENT)
    return img.resize((size, size), Image.LANCZOS)

big = render(512)
big.save("build/icon.png")
sizes = [16, 24, 32, 48, 64, 128, 256]
big.save("build/icon.ico", sizes=[(n, n) for n in sizes])
print("ok", sizes)
