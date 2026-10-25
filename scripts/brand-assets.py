"""Derives the brand assets from the source logos in assets/logos/ (P10).

The source PNGs are generated artwork on a near-black (#09090E) background.
This keys that background out to real transparency (the dot's glow becomes
partial alpha), trims to the artwork, and writes two variants per logo:

  assets/brand/<name>-dark.png   original colours, for dark backgrounds
  assets/brand/<name>-light.png  white parts turned to ink, for light backgrounds

(the icon's bare symbol, without its tile, is written as `mark`)

plus the web app's icons and social card. Run once after the logos change;
the outputs are committed, so nothing here runs at build time.

    python3 scripts/brand-assets.py      (needs Pillow)
"""

from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "logos"
OUT = ROOT / "assets" / "brand"
APP = ROOT / "apps" / "web" / "app"
PUBLIC = ROOT / "apps" / "web" / "public" / "brand"
BG = (9, 9, 14)
INK = (17, 17, 20)


def unmatte(img: Image.Image, bg: tuple[int, int, int] = BG) -> Image.Image:
    """Transparent version of art drawn over `bg`: alpha from distance to it, colour un-premultiplied."""
    BG = bg  # noqa: N806 (shadows the module default on purpose)
    rgb = img.convert("RGB")
    out = Image.new("RGBA", rgb.size)
    src = rgb.load()
    dst = out.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            r, g, b = src[x, y]
            # How far the pixel sits above the background, as a share of the room left to white.
            a = max((r - BG[0]) / (255 - BG[0]), (g - BG[1]) / (255 - BG[1]), (b - BG[2]) / (255 - BG[2]), 0.0)
            a = min(1.0, a * 1.6)  # the artwork's colours are bright; lift faint glow and edges
            if a < 0.035:
                dst[x, y] = (0, 0, 0, 0)
                continue
            # c = a*fg + (1-a)*bg  =>  fg = (c - (1-a)*bg) / a
            fg = tuple(max(0, min(255, round((c - (1 - a) * k) / a))) for c, k in zip((r, g, b), BG))
            dst[x, y] = (*fg, round(a * 255))
    return out


def trim(img: Image.Image, pad: float) -> Image.Image:
    box = img.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    if not box:
        return img
    w, h = box[2] - box[0], box[3] - box[1]
    p = round(max(w, h) * pad)
    return img.crop((max(0, box[0] - p), max(0, box[1] - p), min(img.width, box[2] + p), min(img.height, box[3] + p)))


def to_light(img: Image.Image) -> Image.Image:
    """White and grey (unsaturated, bright) pixels become ink; the coloured bars and dot keep their colour."""
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            hi, lo = max(r, g, b), min(r, g, b)
            if hi > 150 and hi - lo < 40:
                px[x, y] = (*INK, a)
    return out


def on_canvas(img: Image.Image, size: tuple[int, int], fill=BG, scale=0.8) -> Image.Image:
    canvas = Image.new("RGBA", size, (*fill, 255))
    art = img.copy()
    art.thumbnail((round(size[0] * scale), round(size[1] * scale)), Image.LANCZOS)
    canvas.alpha_composite(art, ((size[0] - art.width) // 2, (size[1] - art.height) // 2))
    return canvas


def main() -> None:
    OUT.mkdir(exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    made = {}
    for name in ["primary", "stacked", "wordmark", "icon", "badge"]:
        src = Image.open(SRC / f"{name}.png")
        if name == "icon":
            # The icon is a rounded tile on the background; keep the tile, trimmed, for app icons,
            # and derive a bare mark (no tile) from the tile's interior for everything else.
            tile = src.convert("RGBA")
            made["tile"] = tile
        if name == "icon":
            # The bare mark: the tile's interior, keyed against the tile's own colour, so no tile remains.
            src = src.crop((300, 300, 980, 900))
            dark = trim(unmatte(src, (11, 11, 15)), 0.06)
            name = "mark"
        else:
            dark = trim(unmatte(src), 0.06)
        light = to_light(dark)
        dark.save(OUT / f"{name}-dark.png", optimize=True)
        light.save(OUT / f"{name}-light.png", optimize=True)
        made[name] = dark
        print(f"{name}: {dark.width}x{dark.height}")

    # Web app icons (Next.js file conventions): the tile, square.
    tile = made["tile"].crop((190, 190, 1064, 1064))  # the rounded tile's bounds in the 1254 px source
    tile.resize((512, 512), Image.LANCZOS).save(APP / "icon.png", optimize=True)
    tile.resize((180, 180), Image.LANCZOS).convert("RGB").save(APP / "apple-icon.png", optimize=True)
    # Social card: the primary logo on the background, 1200 × 630.
    on_canvas(made["primary"], (1200, 630), scale=0.78).convert("RGB").save(
        APP / "opengraph-image.png", optimize=True
    )
    # Public copies for <img> in the app (dark and light).
    for name in ["stacked", "wordmark", "badge"]:
        for v in ["dark", "light"]:
            im = Image.open(OUT / f"{name}-{v}.png")
            im.thumbnail((900, 900), Image.LANCZOS)
            im.save(PUBLIC / f"{name}-{v}.png", optimize=True)
    print("icons, social card and public copies written")


if __name__ == "__main__":
    main()
