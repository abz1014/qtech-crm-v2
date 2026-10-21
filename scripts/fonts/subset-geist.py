"""
Core subsets of the Geist faces the app uses (perf/lcp). Run from the repository root after changing CORE or bumping
@fontsource/geist-sans or @fontsource/geist-mono, then copy the printed unicode-range lines into src/index.css:

    pip install fonttools brotli
    python scripts/fonts/subset-geist.py

Each face is split in two by unicode-range (src/index.css): a small core file (the characters the app's own words use) that
every page needs, and the @fontsource latin file for anything else (accented names, rare symbols), which the browser downloads
only when such a character is on screen. The glyphs, kerning and features are Geist's own (all layout features kept), so the
text looks exactly the same; a phone on a slow connection downloads about 40 KB of type instead of about 110 KB.

Geist and Geist Mono are (C) 2023 Vercel, SIL Open Font License 1.1 (node_modules/@fontsource/geist-sans/LICENSE), which
permits subsetting and redistribution with the software.
"""
import os

from fontTools import subset
from fontTools.ttLib import TTFont

# Printable ASCII, no-break space, and the punctuation and symbols the app's text uses (counted over src/, 2026-10-22).
CORE = [(0x20, 0x7E)] + [(c, c) for c in (
    0xA0, 0xA3, 0xB0, 0xB7, 0xD7, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20AC,
    0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2248,
)]
FACES = [
    ('geist-sans', 400), ('geist-sans', 500), ('geist-sans', 600),
    ('geist-mono', 400), ('geist-mono', 500),
]
OUT = 'src/assets/fonts'


def ranges(codes):
    codes = sorted(codes)
    out = []
    for c in codes:
        if out and out[-1][1] == c - 1:
            out[-1][1] = c
        else:
            out.append([c, c])
    return ', '.join(f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}' for a, b in out)


def main():
    os.makedirs(OUT, exist_ok=True)
    for family, weight in FACES:
        src = f'node_modules/@fontsource/{family}/files/{family}-latin-{weight}-normal.woff2'
        cmap = set(TTFont(src).getBestCmap())
        core = {c for a, b in CORE for c in range(a, b + 1)} & cmap
        dst = f'{OUT}/{family}-{weight}-core.woff2'
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['*']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        font = subset.load_font(src, opts)
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=core)
        sub.subset(font)
        subset.save_font(font, dst, opts)
        print(f'{dst}: {os.path.getsize(dst)} bytes (latin file {os.path.getsize(src)})')
        print(f'  core: {ranges(core)}')
        print(f'  rest: {ranges(cmap - core)}')


if __name__ == '__main__':
    main()
