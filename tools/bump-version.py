#!/usr/bin/env python3
"""Stamp a new version on every local script/style URL so browsers never mix
old cached files with new ones after an update. Run before each commit."""
import pathlib, re, time

root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M%S')
pat = re.compile(r"""((?:\./|js/)[\w\-]+\.(?:js|css))(\?v=\w+)?(['"])""")
files = [root / 'index.html', *sorted((root / 'js').glob('*.js'))]
for f in files:
    s = f.read_text()
    s2 = pat.sub(lambda m: f"{m.group(1)}?v={v}{m.group(3)}", s)
    s2 = re.sub(r'href="style\.css(\?v=\w+)?"', f'href="style.css?v={v}"', s2)
    if s2 != s:
        f.write_text(s2)
print('version', v)
