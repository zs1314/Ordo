# Builds web/fonts/adventor-todo-{regular,bold}.woff2 from TeX Gyre Adventor 2.501 (GUST Font License).
#
#   uv run --with fonttools --with brotli python dev/make-font.py <dir with texgyreadventor-{regular,bold}.otf>
#
# The originals: https://www.ctan.org/pkg/tex-gyre-adventor (fonts/tex-gyre/opentype/ on any CTAN mirror).
# Changes, also recorded in each file's name table (ID 10):
# - subset to the 473 characters below (Basic Latin, Latin-1, Latin Extended-A, Greek, common punctuation,
#   arrows and math symbols); everything else falls back to the system font, CJK included
# - vertical metrics set so a line box is as tall as it was with Century Gothic, which the layout was tuned for
# - renamed to "Adventor Todo", as the license asks of modified versions
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
OUT = Path(__file__).resolve().parent.parent / "web" / "fonts"
FAMILY = "Adventor Todo"
RANGES = (
    "0020-007E,00A0-0137,0139-0148,014A-0165,0168-017F,0192,01FA-01FF,02C6-02C7,02D8-02DD,0391-03A1,03A3-03A9,03B1-03C9,"
    "1E80-1E85,1EF2-1EF3,2013-2015,2017-201A,201C-201E,2020-2022,2026,2030,2032-2033,2039-203A,2044,20A4,20AC,2113,2116,"
    "2122,2126,212E,2190-2195,2202,2206,220F,2211-2212,2215,2219-221A,221E-221F,2229,222B,2248,2260-2261,2264-2265,2310,"
    "2320-2321,2500,2502,250C,2510,2514,2518,251C,2524,252C,2534,253C,2588,2591-2593,25A0-25A1,25AA-25AC,25B2,25BC,25CA-25CB,"
    "25CF,25E6,2660,2663,2665-2666,266A,FB01-FB02"
)
# hhea ascent / descent / lineGap, OS/2 typo ascender / descender / lineGap, win ascent / descent (units per em: 1000)
METRICS = {"regular": (1006, -220, 0, 750, -208, 112, 971, 220), "bold": (1006, -220, 0, 750, -208, 112, 992, 220)}
DESCRIPTION = ("Modified version of TeX Gyre Adventor 2.501: subset to 473 characters, vertical metrics changed, renamed. "
               "Original: https://www.gust.org.pl/projects/e-foundry/tex-gyre/adventor")


def codepoints():
    out = []
    for part in RANGES.split(","):
        a, _, b = part.partition("-")
        out.extend(range(int(a, 16), int(b or a, 16) + 1))
    return out


def build(weight):
    font = TTFont(SRC / f"texgyreadventor-{weight}.otf")
    opts = subset.Options()
    opts.layout_features = ["kern", "liga"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.drop_tables += ["FFTM"]
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=codepoints())
    sub.subset(font)

    hhea, os2 = font["hhea"], font["OS/2"]
    (hhea.ascent, hhea.descent, hhea.lineGap, os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap,
     os2.usWinAscent, os2.usWinDescent) = METRICS[weight]
    os2.fsSelection &= ~(1 << 7)  # USE_TYPO_METRICS off, like Century Gothic

    style = weight.capitalize()
    ps = f"AdventorTodo-{style}"
    names = font["name"]
    for nid in (1, 2, 3, 4, 6, 10, 13, 14, 16, 17):
        names.removeNames(nameID=nid)
    for nid, text in {
        1: FAMILY, 2: style, 3: f"2.501;{ps}", 4: f"{FAMILY} {style}", 6: ps, 10: DESCRIPTION,
        13: "This font is distributed under the GUST Font License (LPPL 1.3c or later).",
        14: "https://www.gust.org.pl/projects/e-foundry/licenses",
    }.items():
        names.setName(text, nid, 3, 1, 0x409)
        names.setName(text, nid, 1, 0, 0)
    cff = font["CFF "].cff
    cff.fontNames = [ps]
    top = cff.topDictIndex[0]
    top.FullName, top.FamilyName = f"{FAMILY} {style}", FAMILY

    font.flavor = "woff2"
    dest = OUT / f"adventor-todo-{weight}.woff2"
    font.save(dest)
    print(f"{dest.relative_to(OUT.parent.parent)}: {len(font.getBestCmap())} characters, {dest.stat().st_size // 1024} KB")


OUT.mkdir(parents=True, exist_ok=True)
for w in METRICS:
    build(w)
