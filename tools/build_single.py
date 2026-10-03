"""Bundle index.html + js/*.js into one self-contained file: dist/powder-line.html

The game uses plain classic <script src> tags (no modules, no fetch, no assets),
so inlining them in order produces a single file that runs by double-clicking it.

    python3 tools/build_single.py
"""
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'index.html')
OUT_DIR = os.path.join(ROOT, 'dist')
OUT = os.path.join(OUT_DIR, 'powder-line.html')

html = open(SRC, encoding='utf-8').read()
tag = re.compile(r'<script src="(js/[\w.-]+\.js)(?:\?v=[\w.-]+)?"></script>')


def inline(m):
    path = os.path.join(ROOT, m.group(1))
    js = open(path, encoding='utf-8').read()
    if '</script' in js.lower():
        sys.exit('refusing to inline %s: it contains "</script"' % m.group(1))
    return '<script>/* %s */\n%s\n</script>' % (m.group(1), js)


bundled, n = tag.subn(inline, html)
if n == 0:
    sys.exit('no <script src="js/..."> tags found in index.html')
os.makedirs(OUT_DIR, exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(bundled)
print('inlined %d scripts -> %s (%.0f KB)' % (n, os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))
