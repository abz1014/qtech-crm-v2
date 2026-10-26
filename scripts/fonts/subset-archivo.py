"""
Core subsets of Archivo, the app's face since direction C "Colour blocks" (DECISIONS 2026-10-22). Run from the repository root
after changing CORE or bumping @fontsource-variable/archivo, then copy the printed unicode-range lines into src/index.css:

    pip install fonttools brotli
    python scripts/fonts/subset-archivo.py

Two faces, each split in two by unicode-range (src/index.css), the same way Geist was (perf/lcp):

  "Archivo"       body, rows, buttons: the variable weight axis, cut to 400-700 (the app uses 400, 500 and 600; 700 is there so a
                  bare <b> is never synthesised). Normal width.
  "Archivo Wide"  page titles, section titles and the To do block headings: the width axis pinned at 118 % (direction C's "wider
                  cut") and weight 600-800 (titles are 750). Pinning the width makes it a third of the size of the full
                  width-and-weight file, and nothing in the app needs any other width.

Each face has a small core file (the characters the app's own words use) that every page needs, and the @fontsource latin
file for anything else (accented names, rare symbols), which the browser downloads only when such a character is on screen.
All layout features are kept (tabular figures among them: `.num` turns on tnum).

Archivo is (C) 2016 The Archivo Project Authors (Omnibus-Type), SIL Open Font License 1.1
(node_modules/@fontsource-variable/archivo/LICENSE), which permits subsetting and redistribution with the software.
"""
import os

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# Printable ASCII, no-break space, and the punctuation and symbols the app's text uses (counted over src/, 2026-10-22).
CORE = [(0x20, 0x7E)] + [(c, c) for c in (
    0xA0, 0xA3, 0xB0, 0xB7, 0xD7, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20AC,
    0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2248,
)]
SRC = 'node_modules/@fontsource-variable/archivo/files'
OUT = 'src/assets/fonts'
FACES = [
    # (output name, source file, axis limits)
    ('archivo-core', 'archivo-latin-wght-normal.woff2', {'wght': (400, 700)}),
    ('archivo-wide-core', 'archivo-latin-wdth-normal.woff2', {'wdth': 118, 'wght': (600, 800)}),
]


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
    for name, file, limits in FACES:
        src = f'{SRC}/{file}'
        font = instancer.instantiateVariableFont(TTFont(src), limits)
        cmap = set(font.getBestCmap())
        core = {c for a, b in CORE for c in range(a, b + 1)} & cmap
        opts = subset.Options()
        opts.flavor = 'woff2'
        opts.layout_features = ['*']
        opts.name_IDs = ['*']
        opts.notdef_outline = True
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=core)
        sub.subset(font)
        dst = f'{OUT}/{name}.woff2'
        subset.save_font(font, dst, opts)
        print(f'{dst}: {os.path.getsize(dst)} bytes (latin file {os.path.getsize(src)})')
        print(f'  core: {ranges(core)}')
        print(f'  rest: {ranges(cmap - core)}')


if __name__ == '__main__':
    main()
