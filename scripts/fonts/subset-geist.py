"""
Core subsets of Geist and Geist Mono, the app's faces since the Forest redesign (owner approval 2026-11-14). Run from the
repository root after changing CORE or bumping @fontsource-variable/geist or geist-mono, then copy the printed unicode-range lines
into src/index.css:

    pip install fonttools brotli
    python scripts/fonts/subset-geist.py

Two faces, each split in two by unicode-range (src/index.css), the same way Archivo was (perf/lcp):

  "Geist"       every word in the app: body, rows, buttons and the heavy titles. The variable weight axis cut to 400-800 (the app
                uses 400, 500, 600, 650, 700 and 800).
  "Geist Mono"  job, invoice and PO numbers. Weight 400-800 (hero numbers are 800).

Each face has a small core file (the characters the app's own words use) that every page needs, and the @fontsource latin
file for anything else (accented names, rare symbols), which the browser downloads only when such a character is on screen.
All layout features are kept (tabular figures among them: `.num` turns on tnum).

Geist and Geist Mono are (c) 2023 Vercel, in collaboration with basement.studio, SIL Open Font License 1.1
(src/assets/fonts/OFL-LICENSE.txt, also node_modules/@fontsource-variable/geist/LICENSE), which permits subsetting and
redistribution with the software. The licence file ships beside the subset files.
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
OUT = 'src/assets/fonts'
FACES = [
    # (output name, source file, axis limits)
    ('geist-core', 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', {'wght': (400, 800)}),
    ('geist-mono-core', 'node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2', {'wght': (400, 800)}),
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
        src = file
        font = instancer.instantiateVariableFont(TTFont(src, lazy=False), limits)
        # The @fontsource Geist files carry no gvar entry for glyphs with no variation (.notdef among them), which the
        # subsetter expects: give those glyphs an empty one.
        if 'gvar' in font:
            gvar = font['gvar'].variations
            for glyph in font.getGlyphOrder():
                if glyph not in gvar:
                    gvar[glyph] = []
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
