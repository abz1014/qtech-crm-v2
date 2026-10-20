"""Makes the brand images the app serves, from the full-size masters in scripts/brand/ (audit 2, performance 1.5).
The masters stay out of public/ so the service worker never precaches them.
Run: python scripts/make-brand-images.py   (needs Pillow 11.2 or later, for AVIF)

  public/brand/logo-mark.png, .webp, .avif   84x84: the mobile top bar shows the mark at 28 px (3x for phone screens).
                                             Was the 640x640 master, 131 KB.
  public/brand/logo-wordmark.png             868x211, the master's own size: the quotation and PO PDFs print it 150 pt wide
                                             (about 420 dpi), and it is the PNG fallback in the UI. A 256-colour palette PNG,
                                             visually the same (PSNR over 50 dB), 85 KB -> about 35 KB.
  public/brand/logo-wordmark.webp, .avif     543x132: 3x the sign-in page's 181x44 (the top bar shows it at 124x30), for the UI.
  public/icon-512.png, icon-maskable-512.png, icon-192.png, apple-touch-icon.png
                                             Install icons (precached): re-encoded in place as 256-colour palette PNGs, same size.
"""
import io
import math
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
MASTERS = ROOT / "scripts" / "brand"
BRAND = ROOT / "public" / "brand"


def psnr(a, b):
    a, b = a.convert("RGB"), b.convert("RGB")
    hist = ImageChops.difference(a, b).histogram()
    mse = sum(count * (i % 256) ** 2 for i, count in enumerate(hist)) / (a.size[0] * a.size[1] * 3)
    return float("inf") if mse == 0 else 10 * math.log10(255 * 255 / mse)


def palette(im):
    return im.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)


def save(im, path, fmt, **options):
    buf = io.BytesIO()
    im.save(buf, fmt, **options)
    path.write_bytes(buf.getvalue())
    return len(buf.getvalue())


def report(path, size, quality):
    print(f"{path.relative_to(ROOT).as_posix():42} {size / 1024:6.1f} KB  PSNR {quality:.1f} dB")


def ui_variants(master, name, size, lossless_webp=False):
    """WebP and AVIF for the UI. A tiny two-colour mark blurs at its edges in lossy WebP (4:2:0 colour), so it is lossless there; AVIF keeps full colour resolution (4:4:4) for the same reason."""
    small = master.resize(size, Image.LANCZOS)
    webp = (palette(small).convert("RGB"), {"lossless": True, "quality": 100, "method": 6}) if lossless_webp else (small, {"quality": 90, "method": 6})
    for ext, fmt, (im, options) in (("webp", "WEBP", webp), ("avif", "AVIF", (small, {"quality": 70, "speed": 0, "subsampling": "4:4:4"}))):
        path = BRAND / f"{name}.{ext}"
        n = save(im, path, fmt, **options)
        report(path, n, psnr(small, Image.open(path)))
    return small


mark = Image.open(MASTERS / "logo-mark-master.png").convert("RGB")
mark_small = ui_variants(mark, "logo-mark", (84, 84), lossless_webp=True)
q = palette(mark_small)
report(BRAND / "logo-mark.png", save(q, BRAND / "logo-mark.png", "PNG", optimize=True), psnr(mark_small, q))

wordmark = Image.open(MASTERS / "logo-wordmark-master.png").convert("RGB")
ui_variants(wordmark, "logo-wordmark", (543, 132))
q = palette(wordmark)
report(BRAND / "logo-wordmark.png", save(q, BRAND / "logo-wordmark.png", "PNG", optimize=True), psnr(wordmark, q))

for icon in ("icon-512.png", "icon-maskable-512.png", "icon-192.png", "apple-touch-icon.png"):
    path = ROOT / "public" / icon
    im = Image.open(path)
    if im.mode == "P":
        print(f"{path.relative_to(ROOT).as_posix():42} already a palette PNG, left as it is")
        continue
    q = palette(im)
    report(path, save(q, path, "PNG", optimize=True), psnr(im, q))
