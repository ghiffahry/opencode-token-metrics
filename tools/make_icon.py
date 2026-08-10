from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "web" / "static"
APP = ROOT / "app"

INDIGO = (79, 70, 229)   # #4F46E5
SKY = (14, 165, 233)     # #0EA5E9
WHITE = (255, 255, 255)
RADIUS = 0.21            

BARS = ((96, 200, 100, 430), (206, 130, 100, 430), (316, 70, 100, 430))

FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#4F46E5"/>'
    '<stop offset="1" stop-color="#0EA5E9"/>'
    "</linearGradient></defs>"
    '<rect width="32" height="32" rx="7" fill="url(#g)"/>'
    '<rect x="7" y="16" width="4" height="9" rx="2" fill="#fff"/>'
    '<rect x="14" y="12" width="4" height="13" rx="2" fill="#fff"/>'
    '<rect x="21" y="8" width="4" height="17" rx="2" fill="#fff"/>'
    "</svg>"
)


def render_icon(size):
    img = Image.new("RGBA", (size, size))
    px = img.load()
    denom = 2.0 * (size - 1) or 1.0
    for y in range(size):
        for x in range(size):
            t = (x + y) / denom
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(INDIGO, SKY)) + (255,)

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * RADIUS), fill=255
    )
    img.putalpha(mask)

    draw = ImageDraw.Draw(img)
    for x, top, w, bottom in BARS:
        h = bottom - top
        draw.rounded_rectangle(
            [int(x * size / 512), int(top * size / 512),
             int((x + w) * size / 512), int(bottom * size / 512)],
            radius=int(min(w, h) / 2 * size / 512),
            fill=WHITE,
        )
    return img


def main():
    STATIC.mkdir(exist_ok=True)
    APP.mkdir(exist_ok=True)
    (STATIC / "favicon.svg").write_text(FAVICON_SVG, encoding="utf-8")

    base = render_icon(512)
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    base.resize((256, 256), Image.LANCZOS).save(
        APP / "app.ico", format="ICO", sizes=[(s, s) for s in sizes]
    )

    print("wrote %s" % (STATIC / "favicon.svg"))
    print("wrote %s (%d sizes: %s)" % (APP / "app.ico", len(sizes), ", ".join(map(str, sizes))))


if __name__ == "__main__":
    main()
