// Deterministic frame capture: renders every frame of live/index.html headlessly and pipes it to ffmpeg.
// usage: node src/render/capture.mjs 1920x1080x220 out.mp4   (WxHxCOLUMNS; mux src/render/score.wav afterwards)
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import { spawn } from 'child_process';
import fs from 'fs';
const [w, h, cols] = process.argv[2].split('x').map(Number);
const out = process.argv[3];
const FPS = 30, DUR = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/timeline.json'))).duration;
const total = Math.round(DUR * FPS);
const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(FPS), '-i', '-',
  '-vf', 'vflip', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: w, height: h } });
await p.addInitScript(`window.__CAPTURE = { w: ${w}, h: ${h}, cols: ${cols} };`);
await p.goto('file://' + path.join(ROOT, 'live/index.html'));
await p.waitForFunction('window.__ready === true', null, { timeout: 60000 });
const t0 = Date.now();
for (let i = 0; i < total; i++) {
  const s = await p.evaluate(([t, w, h]) => { window.__renderAt(t); const gl = document.getElementById('c').getContext('webgl2');
    const px = new Uint8Array(w*h*4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let bin = ''; const CH = 0x8000; for (let k = 0; k < px.length; k += CH) bin += String.fromCharCode.apply(null, px.subarray(k, k+CH)); return btoa(bin); }, [i / FPS, w, h]);
  if (!ff.stdin.write(Buffer.from(s, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
  if (i % 30 === 0) fs.appendFileSync(out + '.log', `frame ${i}/${total}  ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await b.close();
fs.appendFileSync(out + '.log', `done ${((Date.now()-t0)/1000).toFixed(0)}s\n`);
