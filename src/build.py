"""Assemble the real-time player (live/index.html) from the sources in this folder.
Usage:  python3 src/build.py            -> writes live/index.html (site version, fonts linked)
        python3 src/build.py --inline   -> also writes live/standalone.html with fonts embedded
"""
import base64, json, pathlib, sys
SRC = pathlib.Path(__file__).parent
ROOT = SRC.parent
tl = json.dumps(json.loads((SRC/'timeline.json').read_text()), separators=(',', ':'))
scene = (SRC/'scene.glsl').read_text().replace('`', '')
js = ['(() => {', '"use strict";', 'const TL = ' + tl + ';', 'const CAP = window.__CAPTURE || null;', "if (CAP) document.body.classList.add('capture');",
      'const DUR = TL.duration;', (SRC/'corpus.js').read_text(), 'const FS_SCENE = `' + scene + '`;', (SRC/'comp.js').read_text(),
      (SRC/'engine.js').read_text(), (SRC/'boot.js').read_text(), '})();']
head = (SRC/'head.html').read_text()
style_end = head.index('</style>') + len('</style>')
meta = ('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="description" content="One unbroken flight through the inside of a mind, rendered live in ASCII.">')

def page(f5, f7):
    h = head.replace('__FONT500__', f5).replace('__FONT700__', f7)
    h = h.replace('<button id="goMute">enter muted</button>\n    </div>',
                  '<button id="goMute">enter muted</button>\n    </div>\n    <p><a href="../" style="color:var(--dim)">or watch the rendered video instead</a></p>')
    return ('<!doctype html><html lang="en"><head>' + meta + h[:style_end] + '</head><body>' + h[style_end:] +
            '<script>window.__FALLBACK_MSG = " Try the rendered video on the main page.";</script>\n<script>\n' + '\n'.join(js) + '\n</script>\n</body></html>\n')

(ROOT/'live').mkdir(exist_ok=True)
(ROOT/'live/index.html').write_text(page('../fonts/jetbrains-mono-latin-500-normal.woff2', '../fonts/jetbrains-mono-latin-700-normal.woff2'))
if '--inline' in sys.argv:
    b = lambda n: 'data:font/woff2;base64,' + base64.b64encode((ROOT/'fonts'/n).read_bytes()).decode()
    (ROOT/'live/standalone.html').write_text(page(b('jetbrains-mono-latin-500-normal.woff2'), b('jetbrains-mono-latin-700-normal.woff2')))
print('built live/index.html')
