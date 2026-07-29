#!/usr/bin/env python3
"""
Rebuilds assets/icon.ico from the master brand art at ArgusFinal.png (repo root).

Why this exists instead of scripts/generate-icon.ts: that script draws a placeholder flat-color
glyph from scratch (no real art available at the time) and was never part of the actual build
pipeline — it's referenced only in an error message in scripts/release.ts. This script does the
real job: take the real logo PNG, de-matte its white background into transparency, and produce a
multi-resolution ICO.

Small-size handling (16-48px): the source art's thin pulse-line stroke and thin node-connector
lines are only 4-6px wide at 1254px native resolution, i.e. sub-pixel at 16-32px after downscale.
Sharpening/unsharp-mask cannot recover detail that thin (confirmed earlier by direct comparison,
see icon.ico's git history) — downscaling as-is just turns those strokes into gray mush. The fix
is a morphological opening (erode then dilate) on the alpha channel before downscaling, which
strips thin linework while preserving the bulky pillar/node shapes, applied only below
SIMPLIFY_BELOW_PX. Sizes at or above that keep the full-detail art.

Usage: python3 scripts/generate-icon.py
"""
import struct
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "argus-source.png"
OUT = ROOT / "assets" / "icon.ico"
MARK_OUT = ROOT / "assets" / "argus-mark.png"

# Every place the mark needs to physically live as a standalone PNG (web app icons, browser tab
# favicons). Kept in sync from this one script instead of hand-copied so they can never drift.
WEB_TARGETS = [ROOT / "ui" / "public", ROOT / "website" / "public"]

SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
SIMPLIFY_BELOW_PX = 64  # sizes smaller than this get the morphological-opening treatment


def de_matte_white(im: Image.Image) -> Image.Image:
    """Converts a logo rendered on a solid white background into a clean RGBA cutout.

    A plain "brightness near white = transparent" threshold is wrong here: this logo's gradient
    fill has genuinely light lavender highlights that are nowhere near black, so a pure
    color-distance test would make chunks of the actual glossy fill semi-transparent (this was
    tried first — the result looked washed-out/faded, not because of any alpha-blend math error,
    but because real fill pixels were being misclassified as partially-background).

    The fix is connectivity, not just color: flood-fill from the canvas corners to find the
    region that's *actually* contiguous background, using PIL's built-in ImageDraw.floodfill
    (no extra deps). Only that connected region — plus a few px of dilation to cover the
    anti-aliased edge band where it meets the artwork — is treated as background/edge-blend.
    Everything else keeps full opacity regardless of how light its color is."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    flood = rgb.copy()
    SENTINEL = (255, 0, 255)
    for corner in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if flood.getpixel(corner) != SENTINEL:
            ImageDraw.floodfill(flood, corner, SENTINEL, thresh=18)
    flood_px = flood.load()
    core = Image.new("L", (w, h), 0)
    core_px = core.load()
    for y in range(h):
        for x in range(w):
            if flood_px[x, y] == SENTINEL:
                core_px[x, y] = 255

    band_outer = core.filter(ImageFilter.MaxFilter(7))
    rgb_px = rgb.load()
    out = Image.new("RGBA", (w, h))
    opx = out.load()
    core_l = core.load()
    band_l = band_outer.load()
    for y in range(h):
        for x in range(w):
            r, g, b = rgb_px[x, y]
            if core_l[x, y]:
                opx[x, y] = (0, 0, 0, 0)
            elif band_l[x, y]:
                a = 255 - min(r, g, b)
                if a <= 0:
                    opx[x, y] = (0, 0, 0, 0)
                    continue
                af = a / 255
                fr = max(0, min(255, round((r - (1 - af) * 255) / af)))
                fg = max(0, min(255, round((g - (1 - af) * 255) / af)))
                fb = max(0, min(255, round((b - (1 - af) * 255) / af)))
                opx[x, y] = (fr, fg, fb, a)
            else:
                opx[x, y] = (r, g, b, 255)
    return out


def autocrop(im: Image.Image, pad_frac: float = 0.06) -> Image.Image:
    """Crops to the opaque content's bounding box, then pads back out to a centered square."""
    bbox = im.getbbox()
    content = im.crop(bbox)
    w, h = content.size
    side = max(w, h)
    pad = round(side * pad_frac)
    canvas_side = side + pad * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(content, ((canvas_side - w) // 2, (canvas_side - h) // 2), content)
    return canvas


def progressive_downscale(im: Image.Image, target: int) -> Image.Image:
    """Halves repeatedly with a box filter until close to target, then does the final precise
    resize with LANCZOS — avoids both the slowness and the ringing of a single huge-ratio LANCZOS
    downscale straight from the 1404px master."""
    while im.size[0] > target * 2:
        im = im.resize((im.size[0] // 2, im.size[1] // 2), Image.BOX)
    return im


def simplify_master(im: Image.Image) -> Image.Image:
    """Morphological opening on the alpha channel: erode strips anything thinner than the kernel,
    dilate grows the survivors back to their original bulk so they don't shrink.

    The right kernel size is a property of the *source art*, not of whatever target icon size it
    will later be downscaled to: measured directly against the 1404px master, the pulse-line
    stroke and thin node-connector lines are ~30-40px wide while the pillar shapes and circular
    nodes are 100px+ — so one fixed kernel comfortably between those two numbers removes the thin
    linework and keeps the bulky shapes, independent of final render size. (An earlier version of
    this script scaled the kernel with the *target* size instead, which made it too small to
    matter at every size and also, at extreme sizes, big enough to erase the node circles
    entirely — since dilate can't resurrect something erode reduced to nothing.) A light blur
    afterward softens the harder edges the min/max filters leave, so later LANCZOS downscaling
    anti-aliases cleanly instead of ringing on hard edges."""
    r, g, b, a = im.split()
    kernel = round(im.size[0] * 0.04)
    if kernel % 2 == 0:
        kernel += 1
    opened = a.filter(ImageFilter.MinFilter(kernel)).filter(ImageFilter.MaxFilter(kernel))
    opened = opened.filter(ImageFilter.GaussianBlur(radius=max(1.0, kernel / 10)))
    return Image.merge("RGBA", (r, g, b, opened))


def render_size(master: Image.Image, simplified_master: Image.Image, size: int) -> Image.Image:
    src = simplified_master if size < SIMPLIFY_BELOW_PX else master
    src = progressive_downscale(src, size)
    return src.resize((size, size), Image.LANCZOS)


def png_bytes(im: Image.Image) -> bytes:
    from io import BytesIO

    buf = BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def build_ico(frames: list[tuple[int, bytes]]) -> bytes:
    """Hand-assembled ICO: PIL's high-level ICO writer doesn't reliably combine independently
    generated per-size images into one true multi-frame file (confirmed earlier this produced a
    1-frame file silently) — manual ICONDIR/ICONDIRENTRY construction is more reliable here."""
    count = len(frames)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = b""
    blobs = b""
    for size, data in frames:
        dim = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    return header + entries + blobs


def main() -> None:
    print(f"[generate-icon] source: {SRC}")
    raw = Image.open(SRC)
    cutout = de_matte_white(raw)
    master = autocrop(cutout)
    print(f"[generate-icon] master content square: {master.size[0]}x{master.size[1]}")

    simplified_master = simplify_master(master)

    frames = []
    for size in SIZES:
        rendered = render_size(master, simplified_master, size)
        frames.append((size, png_bytes(rendered)))
        print(f"[generate-icon]   rendered {size}px ({'simplified' if size < SIMPLIFY_BELOW_PX else 'full detail'})")

    ico = build_ico(frames)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(ico)
    print(f"[generate-icon] wrote {len(ico)} bytes to {OUT} ({len(frames)} frames: {SIZES})")

    # Standalone PNG mark for the web apps (ArgusMark.tsx), at a size generous enough for retina
    # display at any on-screen size the component is actually used at (currently up to ~40px).
    mark = render_size(master, simplified_master, 512)
    mark.save(MARK_OUT)
    print(f"[generate-icon] wrote {MARK_OUT}")

    for target_dir in WEB_TARGETS:
        favicon = render_size(master, simplified_master, 48)
        favicon.save(target_dir / "favicon.png")
        apple_touch = render_size(master, simplified_master, 180)
        apple_touch.save(target_dir / "apple-touch-icon.png")
        mark.save(target_dir / "argus-mark.png")
        print(f"[generate-icon] wrote favicon.png, apple-touch-icon.png, argus-mark.png to {target_dir}")


if __name__ == "__main__":
    main()
