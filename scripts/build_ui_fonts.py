#!/usr/bin/env python3
"""Saytdagi emoji va belgilar uchun yengil shriftlar yasaydi.

Emoji'ni operatsion tizim chizadi, shuning uchun Windows, Mac va telefonda har
xil chiqadi. Shu sababli sayt o'z shriftini beradi. Skript `src` ni ko'rib,
FAQAT ishlatilgan belgilarni oladi:

    public/fonts/sj-emoji.woff2     rangli emoji (Twemoji Mozilla, CC-BY 4.0)
    public/fonts/sj-symbols.woff2   oddiy belgilar: strelka, belgi (DejaVu Sans)
    src/styles/ui-fonts.css         @font-face va unicode-range

Saytga YANGI emoji qo'shilsa, shu skriptni qayta ishga tushiring. Aks holda
o'sha emoji eski usulda, tizim shrifti bilan chiqadi.

    pip install fonttools brotli
    python scripts/build_ui_fonts.py <Twemoji.Mozilla.ttf> <DejaVuSans.ttf>

Manbalar:
    https://github.com/mozilla/twemoji-colr/releases/download/v0.7.0/Twemoji.Mozilla.ttf
    https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf
"""
import glob
import io
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZWJ, VS16 = 0x200D, 0xFE0F

SYMBOL_RE = re.compile(
    "[\U0001F000-\U0001FAFF←-⇿⌀-⏿■-◿"
    "☀-➿⤀-⥿⬀-⯿]"
)
# Twemoji'da bor, lekin matn ichida oddiy belgi bo'lib turishi kerak: emoji
# bo'lsa ko'k kvadratga aylanadi. FE0F bilan yozilgani baribir emoji hisoblanadi.
TEXT_ONLY = set(map(ord, "↔↕↑↓←→▲▼▶◀✔☑●■□▪▫"))


def scan_source():
    """Qaytaradi: (hamma belgilar, FE0F bilan yozilganlar)."""
    used, with_vs = set(), set()
    for path in glob.glob(os.path.join(ROOT, "src", "**", "*"), recursive=True):
        if not path.endswith((".js", ".jsx", ".css", ".mjs")):
            continue
        if path.endswith("ui-fonts.css"):
            continue
        text = io.open(path, encoding="utf-8", errors="replace").read()
        for m in SYMBOL_RE.finditer(text):
            cp = ord(m.group(0))
            used.add(cp)
            if text[m.end():m.end() + 1] == "️":
                with_vs.add(cp)
    return used, with_vs


def make_subset(source, codepoints, target):
    font = TTFont(source)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]    # bayroqlar va ZWJ birikmalari GSUB'da turadi
    opts.hinting = False
    opts.desubroutinize = True
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=codepoints)
    sub.subset(font)
    font.flavor = "woff2"
    font.save(target)
    return os.path.getsize(target)


def css_range(codepoints):
    out, cps = [], sorted(codepoints)
    i = 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append("U+%X" % cps[i] if i == j else "U+%X-%X" % (cps[i], cps[j]))
        i = j + 1
    return ", ".join(out)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    twemoji_src, dejavu_src = sys.argv[1:]
    used, with_vs = scan_source()
    tw = TTFont(twemoji_src).getBestCmap()
    dj = TTFont(dejavu_src).getBestCmap()

    emoji = {c for c in used if c in tw and (c not in TEXT_ONLY or c in with_vs)}
    symbols = {c for c in used - emoji if c in dj}
    missing = used - emoji - symbols

    out = os.path.join(ROOT, "public", "fonts")
    os.makedirs(out, exist_ok=True)
    a = make_subset(twemoji_src, emoji | {ZWJ, VS16}, os.path.join(out, "sj-emoji.woff2"))
    b = make_subset(dejavu_src, symbols, os.path.join(out, "sj-symbols.woff2"))

    css = """/* AVTOMATIK YARATILGAN: scripts/build_ui_fonts.py. Qo'lda o'zgartirmang. */
@font-face {
  font-family: "SJ Emoji";
  src: url("/fonts/sj-emoji.woff2") format("woff2");
  font-display: block;
  unicode-range: %s;
}

@font-face {
  font-family: "SJ Symbols";
  src: url("/fonts/sj-symbols.woff2") format("woff2");
  font-display: swap;
  unicode-range: %s;
}
""" % (css_range(emoji | {ZWJ, VS16}), css_range(symbols))
    with io.open(os.path.join(ROOT, "src", "styles", "ui-fonts.css"), "w", encoding="utf-8", newline="\n") as f:
        f.write(css)

    print("emoji: %d belgi, %d KB" % (len(emoji), a // 1024))
    print("belgilar: %d belgi, %d KB" % (len(symbols), b // 1024))
    print("shriftda yo'q:", ["U+%X" % c for c in sorted(missing)])


if __name__ == "__main__":
    main()
