"""Regenerates the maskable PWA icon from public/brand/logo-mark.png (the mark's white disc spans 72% of the
square, inside the 80% maskable safe zone, so the full-bleed green square can be cropped to any shape).
Run: python scripts/make-pwa-icons.py   (needs Pillow)"""
from PIL import Image
src = Image.open("public/brand/logo-mark.png").convert("RGB")
src.resize((512, 512), Image.LANCZOS).save("public/icon-maskable-512.png", optimize=True)
