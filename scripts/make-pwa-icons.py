"""Regenerates the maskable PWA icon from the full-size mark, scripts/brand/logo-mark-master.png (the mark's white disc spans
72% of the square, inside the 80% maskable safe zone, so the full-bleed green square can be cropped to any shape).
public/brand/logo-mark.png is the small UI copy (84 px, scripts/make-brand-images.py), too small to be a source.
Run: python scripts/make-pwa-icons.py   (needs Pillow)"""
from PIL import Image
src = Image.open("scripts/brand/logo-mark-master.png").convert("RGB")
icon = src.resize((512, 512), Image.LANCZOS)
# A 256-colour palette PNG: visually the same (PSNR about 49 dB), about half the bytes; the icon is precached.
icon.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save("public/icon-maskable-512.png", optimize=True)
