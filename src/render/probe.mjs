// Flight-path safety check: samples the camera path every 0.05 s against the real scene SDF and reports near-collisions.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 2000)));
await p.addInitScript(`window.__CAPTURE = { w: 640, h: 360, cols: 80 };`);
await p.goto('file://' + path.join(ROOT, 'live/index.html'));
await p.waitForFunction('window.__ready === true', null, { timeout: 90000 });
const ts = []; for (let t = 0; t <= 152; t += 0.05) ts.push(+t.toFixed(3));
const r = await p.evaluate((ts) => window.__probe(ts), ts);
let bad = 0, minD = 1e9, minAt = 0;
const segs = [];
for (const [t, d, m] of r) {
  if (d < minD) { minD = d; minAt = t; }
  if (d < 0.4) { bad++; if (!segs.length || t - segs[segs.length-1][1] > 0.11) segs.push([t, t, d, m]); else { const s = segs[segs.length-1]; s[1] = t; if (d < s[2]) { s[2] = d; s[3] = m; } } }
}
console.log('samples', r.length, 'min', minD.toFixed(3), 'at', minAt, 'bad', bad);
for (const s of segs) console.log(`  t ${s[0]}-${s[1]}  min d ${s[2].toFixed(3)} mat ${s[3]}`);
await b.close();
