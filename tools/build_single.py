"""Bundle a game page + its js/*.js into one self-contained file in dist/.

The games use plain classic <script src> tags (no modules, no fetch, no assets),
so inlining them in order produces a single file that runs by double-clicking it.

    python3 tools/build_single.py              # index.html      -> dist/powder-line.html
    python3 tools/build_single.py surf         # surf/index.html -> dist/swell-line.html
"""
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PAGES = {'': ('index.html', 'powder-line.html'), 'surf': ('surf/index.html', 'swell-line.html')}
which = sys.argv[1] if len(sys.argv) > 1 else ''
if which not in PAGES:
    sys.exit('unknown page %r (choose from: %s)' % (which, ', '.join(repr(k) for k in PAGES)))
SRC = os.path.join(ROOT, PAGES[which][0])
OUT_DIR = os.path.join(ROOT, 'dist')
OUT = os.path.join(OUT_DIR, PAGES[which][1])

html = open(SRC, encoding='utf-8').read()
tag = re.compile(r'<script src="((?:\.\./)?js/[\w.-]+\.js)(?:\?v=[\w.-]+)?"></script>')


def inline(m):
    path = os.path.normpath(os.path.join(os.path.dirname(SRC), m.group(1)))
    js = open(path, encoding='utf-8').read()
    if '</script' in js.lower():
        sys.exit('refusing to inline %s: it contains "</script"' % m.group(1))
    return '<script>/* %s */\n%s\n</script>' % (m.group(1), js)


bundled, n = tag.subn(inline, html)
if n == 0:
    sys.exit('no <script src="js/..."> tags found in index.html')
# every script must be inlined: a tag written differently (defer, type=…) would
# silently stay an external reference and break the single-file build
left = bundled.count('<script src=')
if left:
    sys.exit('%d <script src=...> tag(s) were not inlined (unexpected attributes?)' % left)
os.makedirs(OUT_DIR, exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    f.write(bundled)
print('inlined %d scripts -> %s (%.0f KB)' % (n, os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1024))
