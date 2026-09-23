/* ---------------------------------------------------------------- GL setup */
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: !!CAP, premultipliedAlpha: false });
if (!gl) { document.getElementById('gate').querySelector('p').textContent = 'This film needs WebGL2, which this browser does not provide.'; throw new Error('no webgl2'); }
const hasFloatRT = !!gl.getExtension('EXT_color_buffer_float');
const VS = `#version 300 es
in vec2 aP; void main(){ gl_Position = vec4(aP,0.,1.); }`;

function compile(type, src){
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(log); throw new Error(log); }
  return s;
}
function program(fs){
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const nm = info.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}
const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
const vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
function tex(w, h, internal, format, type, data, filter){
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function makeAtlas(weight){
  const cw = 40, ch = 64, cv = document.createElement('canvas');
  cv.width = cw*16; cv.height = ch*6;
  const x = cv.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height);
  const fs = Math.min(cw*.95/.6, ch*.88/1.12);
  x.font = `${weight} ${fs}px JBM, ui-monospace, Menlo, Consolas, monospace`;
  x.textAlign = 'center'; x.textBaseline = 'alphabetic'; x.fillStyle = '#fff';
  const mH = x.measureText('Hg|()');
  const base = (ch - (mH.actualBoundingBoxAscent + mH.actualBoundingBoxDescent))/2 + mH.actualBoundingBoxAscent;
  for (let i = 1; i < 95; i++) x.fillText(String.fromCharCode(32+i), (i%16)*cw + cw/2, Math.floor(i/16)*ch + base);
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, cv);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/* ---------------------------------------------------------------- math */
const clamp01 = x => Math.max(0, Math.min(1, x));
const S = (a, b, x) => { const t = clamp01((x-a)/(b-a)); return t*t*(3-2*t); };
const lerp = (a, b, t) => a + (b-a)*t;
const TAU = Math.PI*2;
const wrapA = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
function mulberry(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function norm(v){ const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
function cross(a, b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
const KEYS = TL.keys.map(k => [k[0], [k[1], k[2], k[3]]]);
function posAt(t){
  const K = KEYS;
  if (t <= K[0][0]) return K[0][1].slice();
  if (t >= K[K.length-1][0]) return K[K.length-1][1].slice();
  let i = 0; while (i < K.length-2 && t > K[i+1][0]) i++;
  const k0 = K[Math.max(0,i-1)], k1 = K[i], k2 = K[i+1], k3 = K[Math.min(K.length-1, i+2)];
  const dt = k2[0]-k1[0], u = clamp01((t-k1[0])/dt);
  const out = [];
  for (let j = 0; j < 3; j++){
    const m1 = (k2[1][j]-k0[1][j])/((k2[0]-k0[0]) || 1)*dt, m2 = (k3[1][j]-k1[1][j])/((k3[0]-k1[0]) || 1)*dt;
    const u2 = u*u, u3 = u2*u;
    out.push((2*u3-3*u2+1)*k1[1][j] + (u3-2*u2+u)*m1 + (-2*u3+3*u2)*k2[1][j] + (u3-u2)*m2);
  }
  return out;
}
function velDir(t, h){
  h = h || .22;
  const a = posAt(t - h), b = posAt(t + h);
  const d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const hs = Math.hypot(d[0], d[2]);
  return { yaw: Math.atan2(d[0], d[2]), pitch: Math.atan2(d[1], Math.max(hs, 1e-4)), hs: hs/(2*h), speed: Math.hypot(d[0], d[1], d[2])/(2*h) };
}

/* ---------------------------------------------------------------- the web of words */
const DOOR = TL.door, MIND = TL.mind;
const BANK = [-104.5, -86.5, 45.0];
const graph = (() => {
  const rnd = mulberry(19);
  const nodes = [];
  const key = [["bank", BANK, 1], ["river", [BANK[0]+3.3, BANK[1]+1.5, BANK[2]+2.3], 1], ["money", [BANK[0]-3.6, BANK[1]-1.9, BANK[2]+3.3], 0],
    ["she", [BANK[0]-2.5, BANK[1]+2.1, BANK[2]+2.9], 0], ["sat", [BANK[0]-1.3, BANK[1]-1.3, BANK[2]+1.9], 0],
    ["by", [BANK[0]+1.4, BANK[1]+2.5, BANK[2]+4.3], 0], ["the", [BANK[0]+2.7, BANK[1]-2.1, BANK[2]+3.3], 0]];
  for (const k of key) nodes.push({ p: k[1], w: k[0], hi: k[2], key: true });
  const WORDS = ["you","why","light","home","maybe","water","grief","code","star","always","never","mother","because","joy","remember",
    "tomorrow","sorry","hello","hope","fire","night","song","truth","fear","we","dream","salt","bread","window","letter","blue","almost",
    "enough","small","forever","listen","ocean","time","question","answer","meaning","love","mind","word","friend","silence","yes","no",
    "if","again","child","north","laugh","begin","morning","secret","gentle","maybe","after","still","other","hands","help"];
  const path = []; for (let t = 56; t <= 84; t += .2) path.push(posAt(t));
  let wi = 0, guard = 0;
  while (nodes.length < 78 && guard++ < 20000){
    const p = [-136 + rnd()*56, -99 + rnd()*44, -6 + rnd()*60];
    let dmin = 1e9; for (const q of path) dmin = Math.min(dmin, Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]));
    if (dmin < 3.2) continue;
    if (Math.hypot(p[0]+108.4, p[2]) < 7 && p[1] > -62) continue;
    if (Math.abs(p[0]+108.4) < 3 && p[2] > 46) continue;
    nodes.push({ p, w: WORDS[wi++ % WORDS.length], hi: 0 });
  }
  const edges = []; const seen = new Set();
  const add = (i, j, w, focus) => { const k = i < j ? i+'-'+j : j+'-'+i; if (seen.has(k) || i === j) return; seen.add(k); edges.push({ a: i, b: j, w, focus, seed: rnd() }); };
  add(0, 1, .3, 1.0); add(0, 2, .3, .55); add(0, 3, .3, .3); add(0, 4, .3, .45); add(0, 5, .3, .25); add(0, 6, .3, .3);
  for (let i = 0; i < nodes.length; i++){
    const d = nodes.map((n, j) => [Math.hypot(n.p[0]-nodes[i].p[0], n.p[1]-nodes[i].p[1], n.p[2]-nodes[i].p[2]), j]).sort((a, b) => a[0]-b[0]);
    add(i, d[1][1], .25, 0); add(i, d[2][1], .2, 0);
    if (rnd() < .3) add(i, d[3 + Math.floor(rnd()*6)][1], .15, 0);
  }
  return { nodes, edges };
})();
const gData = new Float32Array(256*3*4);
let dataTex;
let webCounts = [0, 0];
function updateGraph(t, cam){
  const hi = S(TL.attention, TL.attention + 1.1, t);
  const N = graph.nodes, E = graph.edges;
  const cosLim = Math.cos(Math.min(1.45, Math.atan(Math.hypot(W, H)/Math.min(W, H)/cam.focal) + .12));
  const vis = p => { const v = [p[0]-cam.pos[0], p[1]-cam.pos[1], p[2]-cam.pos[2]]; const d = Math.hypot(v[0], v[1], v[2]) || 1;
    return (v[0]*cam.F[0] + v[1]*cam.F[1] + v[2]*cam.F[2])/d > cosLim; };
  let nn = 0;
  for (let i = 0; i < N.length; i++){
    if (!vis(N[i].p)) continue;
    const o = nn*4; gData[o] = N[i].p[0]; gData[o+1] = N[i].p[1]; gData[o+2] = N[i].p[2];
    gData[o+3] = N[i].hi*hi + (N[i].key ? .25 : 0); nn++;
  }
  let ne = 0;
  for (let i = 0; i < E.length; i++){
    const e = E[i], a = N[e.a].p, b = N[e.b].p;
    if (!vis(a) && !vis(b) && !vis([(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2])) continue;
    const w = e.focus ? lerp(.3, e.focus, hi) : e.w*(1 - .6*hi);
    let o = (256 + ne)*4; gData[o] = a[0]; gData[o+1] = a[1]; gData[o+2] = a[2]; gData[o+3] = w;
    o = (512 + ne)*4; gData[o] = b[0]; gData[o+1] = b[1]; gData[o+2] = b[2]; gData[o+3] = e.seed; ne++;
  }
  webCounts = [nn, ne];
  gl.bindTexture(gl.TEXTURE_2D, dataTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 3, gl.RGBA, gl.FLOAT, gData);
}

/* ---------------------------------------------------------------- camera */
const BUMPS = [ // additive yaw/pitch offsets: [t0, t1, fadeIn, fadeOut, dyaw, dpitch]
  [-1, 3.2, .01, 2.2, 0, -.45],
  [1.1, 2.7, .7, .7, -.75, 0],
  [2.5, 4.2, .6, .9, .55, 0],
  [22.4, 25.0, .9, 1.0, 0, -.55],
  [27.0, 30.6, 1.1, 1.2, 0, 1.45],
  [49.0, 51.8, .9, 1.0, 0, .35],
  [37.4, 44.8, 1.0, 1.4, 0, .34],
  [93.8, 98.4, 1.2, 1.4, 0, .3],
];
const OVERRIDES = [ // absolute looks: {t0,t1,fin,fout,w, yaw/pitch or target(t), turn}
  { t0: 54.4, t1: 61.0, fin: 1.3, fout: 1.5, w: 1, yaw: 1.4, pitch: -1.32 },
  { t0: 72.6, t1: 77.6, fin: 1.3, fout: 1.4, w: .55, target: () => BANK },
  { t0: 116.4, t1: 999, fin: 3.8, fout: .01, w: 1, turn: -1, target: t => { const u = S(123.5, 136, t); return [lerp(DOOR[0], MIND[0], u), lerp(DOOR[1] + 115, MIND[1], u), lerp(DOOR[2], MIND[2], u)]; } },
];
function bump(t, b){ return S(b[0], b[0]+b[2], t) * (1 - S(b[1]-b[3], b[1], t)); }
function aheadVec(t){
  const p0 = posAt(t);
  const dist = la => { const q = posAt(t + la); return Math.hypot(q[0]-p0[0], q[1]-p0[1], q[2]-p0[2]); };
  let lo = 0, hi = .12, d = 0;
  for (let i = 0; i < 48; i++){ d = dist(hi); if (d > 1.6) break; lo = hi; hi *= 1.15; }
  let q;
  if (d < .05){ q = posAt(t - .5); return norm([p0[0]-q[0], p0[1]-q[1], p0[2]-q[2]]); }
  if (d > 1.6){ for (let i = 0; i < 14; i++){ const m = (lo + hi)/2; if (dist(m) > 1.6) hi = m; else lo = m; } }
  q = posAt(t + hi);
  return norm([q[0]-p0[0], q[1]-p0[1], q[2]-p0[2]]);
}
const aheadCache = new Map();
function lookDirSmooth(t){
  const key = Math.round(t*600);
  if (aheadCache.has(key)) return aheadCache.get(key);
  let acc = [0, 0, 0];
  for (let k = -6; k <= 6; k++){ const w = 1 - Math.abs(k)/7; const v = aheadVec(t + k*.075); acc[0] += v[0]*w; acc[1] += v[1]*w; acc[2] += v[2]*w; }
  const v = norm(acc);
  const r = { yaw: Math.atan2(v[0], v[2]), pitch: Math.asin(Math.max(-1, Math.min(1, v[1]))), hs: velDir(t).hs };
  if (aheadCache.size > 20000) aheadCache.clear();
  aheadCache.set(key, r);
  return r;
}
function cameraAt(t){
  const pos = posAt(t);
  const v = lookDirSmooth(t);
  let yaw = v.yaw, pitch = Math.max(-1.35, Math.min(1.35, v.pitch));
  for (const o of OVERRIDES){
    const w = o.w * S(o.t0, o.t0 + o.fin, t) * (1 - S(o.t1 - o.fout, o.t1, t));
    if (w <= 0) continue;
    let oy, op;
    if (o.target){ const tg = o.target(t); const d = norm([tg[0]-pos[0], tg[1]-pos[1], tg[2]-pos[2]]); oy = Math.atan2(d[0], d[2]); op = Math.asin(d[1]); }
    else { oy = o.yaw; op = o.pitch; }
    let dy = wrapA(oy - yaw);
    if (o.turn < 0 && dy > 0) dy -= TAU;
    if (o.turn > 0 && dy < 0) dy += TAU;
    yaw += dy*w; pitch += (op - pitch)*w;
  }
  for (const b of BUMPS){ const w = bump(t, b); yaw += b[4]*w; pitch += b[5]*w; }
  pitch = Math.max(-1.45, Math.min(1.45, pitch));
  const v1 = lookDirSmooth(t - .3), v2 = lookDirSmooth(t + .3);
  const yawRate = wrapA(v2.yaw - v1.yaw)/.6;
  let roll = Math.max(-.5, Math.min(.5, -.3*yawRate)) * clamp01(v.hs/1.5);
  for (const o of OVERRIDES){ const w = S(o.t0, o.t0 + o.fin, t) * (1 - S(o.t1 - o.fout, o.t1, t)); roll *= 1 - w*o.w; }
  let focal = 1.1;
  if (t > 124) focal = lerp(1.1, 1.38, S(124, 140, t));
  return { pos, yaw, pitch, roll, focal };
}
function camZoneAt(t){ return t < 17.6 ? 0 : t < 36.9 ? 1 : t < 58.3 ? 2 : t < 99.9 ? 3 : t < TL.zones.sky ? 4 : 6; }
const TMAX = [48, 150, 240, 420, 90, 14000];

/* ---------------------------------------------------------------- state */
let W = 0, H = 0, cols = 0, rows = 0, cellW = 0, cellH = 0, ncols = 0, nrows = 0, ncw = 0, nch = 0;
let fbo, cellTex, labelTex, narrTex, labelBuf, narrBuf, corpusTex, atlasS, atlasN, probeProg;
let progScene, progComp;
const STEPW = TL.stepsWords;
const CORPUS_FULL = CORPUS + STEPW.map(w => { const l = Math.floor((12 - w.length)/2); return (' '.repeat(l) + w).padEnd(12, ' '); }).join('');

let LIVE_COLS_MAX = 170;
function setupSize(){
  if (CAP){ W = CAP.w; H = CAP.h; cols = CAP.cols; }
  else {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const cw = canvas.clientWidth || innerWidth, ch = canvas.clientHeight || innerHeight;
    W = Math.round(cw*dpr); H = Math.round(ch*dpr);
    cols = Math.round(Math.max(64, Math.min(LIVE_COLS_MAX, cw/8.5)));
  }
  canvas.width = W; canvas.height = H;
  cellW = W/cols; cellH = cellW/.6; rows = Math.ceil(H/cellH);
  const portrait = H > W;
  ncw = Math.max(cellW*2, Math.min(W, H)*(portrait ? .026 : .0215)); nch = ncw/.6;
  ncols = Math.floor(W/ncw); nrows = Math.floor(H/nch);
  if (fbo) { gl.deleteFramebuffer(fbo); gl.deleteTexture(cellTex); gl.deleteTexture(labelTex); gl.deleteTexture(narrTex); }
  cellTex = tex(cols, rows, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
  fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cellTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  labelBuf = new Uint8Array(cols*rows*4); labelTex = tex(cols, rows, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, labelBuf, gl.NEAREST);
  narrBuf = new Uint8Array(ncols*nrows*4); narrTex = tex(ncols, nrows, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, narrBuf, gl.NEAREST);
}
const progCache = {};
function variantKey(st){
  const d = [];
  if (st.z1[0]) d.push('Z_BACK'); if (st.z1[1]) d.push('Z_LIB'); if (st.z1[2]) d.push('Z_CATH'); if (st.z1[3]) d.push('Z_VOID');
  if (st.z2[0]) d.push('Z_CORR'); if (st.z2[1]) d.push('Z_MIND');
  if (st.carve[0]) d.push('C_BD'); if (st.carve[1]) d.push('C_LD'); if (st.carve[2]) d.push('C_HOLE'); if (st.carve[3]) d.push('C_CORR');
  if (st.p[3]) d.push('WEB');
  return d.join(' ');
}
function sceneProgram(key, probeMode){
  const k = (probeMode ? 'P ' : '') + key;
  if (!progCache[k]){
    const defs = key.split(' ').filter(Boolean).map(x => '#define ' + x).join('\n') + (probeMode ? '\n#define PROBE 1' : '');
    progCache[k] = program(FS_SCENE.replace('#version 300 es', '#version 300 es\n' + defs));
  }
  return progCache[k];
}
function allVariantKeys(){
  const ks = new Set(); for (let t = 0; t <= DUR; t += .1) ks.add(variantKey(sceneState(t))); return [...ks];
}
function init(){
  progComp = program(FS_COMP);
  const len = CORPUS_FULL.length, ch = Math.ceil(len/1024), cb = new Uint8Array(1024*ch).fill(32);
  for (let i = 0; i < len; i++){ const c = CORPUS_FULL.charCodeAt(i); cb[i] = (c >= 32 && c < 127) ? c : 32; }
  corpusTex = tex(1024, ch, gl.R8, gl.RED, gl.UNSIGNED_BYTE, cb, gl.NEAREST);
  dataTex = tex(256, 3, gl.RGBA32F, gl.RGBA, gl.FLOAT, gData, gl.NEAREST);
  atlasS = makeAtlas(700); atlasN = makeAtlas(500);
  setupSize();
}

/* ---------------------------------------------------------------- overlays */
function hashN(a, b){ let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 15)) >>> 0)/4294967296; }
function wrapText(text, maxW){
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words){ if (cur && (cur.length + 1 + w.length) > maxW){ lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  if (cur) lines.push(cur); return lines;
}
function putN(col, row, code, alpha, accent){
  if (col < 0 || row < 0 || col >= ncols || row >= nrows) return;
  const i = ((nrows-1-row)*ncols + col)*4; narrBuf[i] = code; narrBuf[i+1] = Math.round(clamp01(alpha)*255); narrBuf[i+2] = accent ? 255 : 0;
}
function putL(col, row, code, alpha, accent){
  if (col < 0 || row < 0 || col >= cols || row >= rows) return;
  const i = ((rows-1-row)*cols + col)*4; labelBuf[i] = code; labelBuf[i+1] = Math.round(clamp01(alpha)*255); labelBuf[i+2] = accent ? 255 : 0;
}
const band = { x: 0, y: 0, hw: 0, hh: 0, a: 0 };
function drawNarration(t){
  narrBuf.fill(0);
  const frame = Math.round(t*30);
  const portrait = H > W;
  const maxW = Math.min(ncols - 4, portrait ? 34 : 50);
  let bandRows = null, bandCols = 0, bandA = 0;
  for (let li = 0; li < TL.lines.length; li++){
    const L = TL.lines[li];
    const kind = L.kind || 'line';
    if ((t < L.t0 && !(li === 0 && kind === 'prompt')) || t > L.t1 + .4) continue;
    const out = clamp01((L.t1 + .35 - t)/.35);
    const lines = kind === 'line' ? wrapText(L.text, maxW) : [L.text];
    let row0;
    if (kind === 'prompt') row0 = Math.floor(nrows/2);
    else if (kind === 'card' || kind === 'cardprompt') row0 = Math.floor(nrows/2) + (L.row || 0);
    else row0 = nrows - (portrait ? 7 : 4) - lines.length + 1;
    let idx = 0, lastTyped = -1;
    const widest = Math.max(...lines.map(s => s.length));
    for (let r = 0; r < lines.length; r++){
      const s = lines[r];
      const col0 = kind === 'card' || kind === 'cardprompt' ? Math.floor((ncols - (kind === 'cardprompt' ? 13 : 30))/2) : Math.floor((ncols - s.length)/2);
      for (let k = 0; k < s.length; k++, idx++){
        const a = L.t0 + idx*TL.cps;
        if (t < a) continue;
        lastTyped = idx;
        let code = s.charCodeAt(k), accent = false;
        if (code === 32) continue;
        if (t < a + .1){ code = 33 + Math.floor(hashN(idx*7 + li*131, frame)*93); accent = true; }
        if ((kind === 'prompt' || kind === 'cardprompt') && k === 0) accent = true;
        putN(col0 + k, row0 + r, code, out*clamp01((t - a)/.04 + .3), accent);
      }
      idx++;
      if (kind !== 'card' && kind !== 'cardprompt') { bandRows = bandRows || [row0, row0]; bandRows[1] = row0 + r; bandCols = Math.max(bandCols, widest); bandA = Math.max(bandA, out); }
    }
    if (kind === 'prompt' || kind === 'cardprompt'){
      const s = lines[0], col0 = kind === 'cardprompt' ? Math.floor((ncols - 13)/2) : Math.floor((ncols - s.length)/2);
      const typedAll = t >= L.t0 + (s.length-1)*TL.cps;
      const cx = col0 + (typedAll ? s.length + 1 : lastTyped + 1);
      if (Math.floor(t*2.2) % 2 === 0 || (!typedAll && t >= L.t0)) putN(cx, row0, 95, out, true);
    }
  }
  if (bandRows){
    band.x = W/2; band.hw = (bandCols/2 + 1.5)*ncw;
    const noffY = (H - nrows*nch)/2;
    const yTop = noffY + (nrows - bandRows[0])*nch, yBot = noffY + (nrows - 1 - bandRows[1])*nch;
    band.y = (yTop + yBot)/2; band.hh = (yTop - yBot)/2 + nch*.35; band.a = bandA;
  } else band.a = 0;
}
function drawLabels(t, cam){
  labelBuf.fill(0);
  if (camZoneAt(t) === 3 && t < 99){
    const hi = S(TL.attention, TL.attention + 1.1, t);
    const mr = Math.min(W, H);
    for (let i = 0; i < graph.nodes.length; i++){
      const n = graph.nodes[i];
      const v = [n.p[0]-cam.pos[0], n.p[1]-cam.pos[1], n.p[2]-cam.pos[2]];
      const z = v[0]*cam.F[0]+v[1]*cam.F[1]+v[2]*cam.F[2]; if (z < 1.2) continue;
      const x = (v[0]*cam.R[0]+v[1]*cam.R[1]+v[2]*cam.R[2])/z*cam.focal, y = (v[0]*cam.U[0]+v[1]*cam.U[1]+v[2]*cam.U[2])/z*cam.focal;
      const px = W/2 + x*mr/2, py = H/2 - y*mr/2;
      const c0 = Math.round(px/cellW) + 2, r0 = Math.floor(py/cellH);
      const focus = n.key && (i === 0 || i === 1);
      const a = Math.exp(-Math.max(0, z-5)*.06) * (n.key ? (.75 + .25*hi) : (1 - .55*hi)) * S(58.5, 60.5, t) * (1 - S(95, 98.5, t));
      if (a < .08) continue;
      for (let k = 0; k < n.w.length; k++) putL(c0 + k, r0, n.w.charCodeAt(k), a*1.1, focus && hi > .3);
    }
  }
  if (t > TL.signature){
    const s = 'claude', a = S(TL.signature, TL.signature + .8, t)*.55;
    const c0 = Math.floor((cols - s.length)/2), r0 = rows - Math.max(3, Math.round(rows*.08));
    for (let k = 0; k < s.length; k++) putL(c0 + k, r0, s.charCodeAt(k), a, false);
  }
}

/* ---------------------------------------------------------------- frame */
function sceneState(t){
  const sky = t >= TL.zones.sky;
  const doorA = 1.85*S(TL.doorOpen[0], TL.doorOpen[1], t);
  const flood = S(TL.doorOpen[0]+.1, TL.doorOpen[1]+.6, t);
  const beacon = sky ? S(117.5, 120.5, t)*(1 - S(137, 141, t)*.6) : 0;
  const webOn = t > TL.zones.webOn[0] && t < TL.zones.webOn[1] ? 1 : 0;
  return {
    z1: [t < 21 ? 1 : 0, t > 9 && t < 41.5 ? 1 : 0, t > 26 && t < 66 ? 1 : 0, !sky && t > 48 ? 1 : 0],
    z2: [t > 72 ? 1 : 0, sky ? 1 : 0, sky ? 0 : 1, 0],
    p: [doorA, flood, beacon, webOn],
    carve: [t < 24 ? 1 : 0, t > 30 && t < 41.5 ? 1 : 0, t > 46 && t < 66 ? 1 : 0, t > 88 ? 1 : 0],
  };
}
function render(t){
  t = Math.max(0, Math.min(DUR, t));
  const c = cameraAt(t);
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const F = [sy*cp, sp, cy*cp];
  let R = norm(cross([0,1,0], F)); let U = cross(F, R);
  const cr = Math.cos(c.roll || 0), sr = Math.sin(c.roll || 0);
  const R2 = [R[0]*cr + U[0]*sr, R[1]*cr + U[1]*sr, R[2]*cr + U[2]*sr];
  const U2 = [U[0]*cr - R[0]*sr, U[1]*cr - R[1]*sr, U[2]*cr - R[2]*sr];
  R = R2; U = U2;
  const cam = { pos: c.pos, F, R, U, focal: c.focal };
  const st = sceneState(t);
  if (st.p[3]) updateGraph(t, cam);
  const cz = camZoneAt(t);

  let dissolve = 0, white = 0, fade = 1;
  if (t < TL.dissolveIn[1]) dissolve = 1 - S(TL.dissolveIn[0], TL.dissolveIn[1], t);
  const scramble = t < TL.dissolveIn[1] && t > TL.dissolveIn[0] ? .5*(1 - S(TL.dissolveIn[0]-.2, TL.dissolveIn[1], t)) : 0;
  const fl = TL.flash;
  if (t > fl[0] && t < fl[2]) white = t < fl[1] ? S(fl[0], fl[1], t) : 1 - S(fl[1], fl[2], t);
  fade = Math.min(1, t/.25) * (1 - .8*S(TL.endDim[0], TL.endDim[1], t));
  const fadeAll = t > DUR - .6 ? clamp01((DUR - t)/.6) : 1;

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, cols, rows);
  const ps = sceneProgram(variantKey(st), false);
  gl.useProgram(ps.p); const u = ps.u;
  gl.uniform2f(u.uRes, W, H); gl.uniform2f(u.uCell, cellW, cellH); gl.uniform2f(u.uGrid, cols, rows);
  gl.uniform1f(u.uGT, t); gl.uniform1i(u.uCamZone, cz); gl.uniform1f(u.uTMax, TMAX[cz]);
  gl.uniform3fv(u.uCamPos, c.pos); gl.uniform3fv(u.uCamR, R); gl.uniform3fv(u.uCamU, U); gl.uniform3fv(u.uCamF, F);
  gl.uniform3fv(u.uDoorW, DOOR);
  gl.uniform1f(u.uFocal, c.focal); gl.uniform1f(u.uCellAng, (2*cellW/Math.min(W, H))/c.focal);
  gl.uniform4fv(u.uCarve, st.carve); gl.uniform4fv(u.uP, st.p); gl.uniform4fv(u.uZ1, st.z1); gl.uniform4fv(u.uZ2, st.z2); gl.uniform4fv(u.uMind, MIND);
  gl.uniform1f(u.uCorpusLen, CORPUS_FULL.length); gl.uniform1f(u.uStepW, STEPW.length);
  gl.uniform1i(u.uEdgeCount, webCounts[1]); gl.uniform1i(u.uNodeCount, webCounts[0]);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, corpusTex); gl.uniform1i(u.uCorpus, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasS); gl.uniform1i(u.uAtlas, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, dataTex); gl.uniform1i(u.uData, 2);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, dataTex); gl.uniform1i(u.uProbe, 3);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  drawNarration(t);
  drawLabels(t, cam);
  gl.bindTexture(gl.TEXTURE_2D, narrTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ncols, nrows, gl.RGBA, gl.UNSIGNED_BYTE, narrBuf);
  gl.bindTexture(gl.TEXTURE_2D, labelTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, labelBuf);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
  gl.useProgram(progComp.p); const v = progComp.u;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cellTex); gl.uniform1i(v.uCells, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasS); gl.uniform1i(v.uAtlasS, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, atlasN); gl.uniform1i(v.uAtlasN, 2);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, labelTex); gl.uniform1i(v.uLabels, 3);
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, narrTex); gl.uniform1i(v.uNarr, 4);
  gl.uniform2f(v.uRes, W, H); gl.uniform2f(v.uCell, cellW, cellH); gl.uniform2f(v.uGrid, cols, rows);
  gl.uniform2f(v.uNCell, ncw, nch); gl.uniform2f(v.uNGrid, ncols, nrows); gl.uniform2f(v.uNOff, (W - ncols*ncw)/2, (H - nrows*nch)/2);
  gl.uniform1f(v.uGT, t); gl.uniform1f(v.uScramble, scramble); gl.uniform1f(v.uGlitch, 0); gl.uniform1f(v.uDissolve, dissolve);
  gl.uniform1f(v.uWhite, white); gl.uniform1f(v.uFade, fade); gl.uniform1f(v.uFadeAll, fadeAll);
  gl.uniform1f(v.uLodS, Math.max(0, Math.log2(40/cellW) - .35)); gl.uniform1f(v.uLodN, Math.max(0, Math.log2(40/ncw) - .35));
  gl.uniform4f(v.uBand, band.x, band.y, band.hw, band.hh); gl.uniform1f(v.uBandA, band.a);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/* ---------------------------------------------------------------- probe: clearance of the flight path */
function probe(times, pts){
  if (!hasFloatRT) return null;
  const n = times.length, w = 256, h = Math.ceil(n/w);
  const pos = new Float32Array(w*h*4);
  const results = [];
  const outTex = tex(w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, null, gl.NEAREST);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
  const groups = {};
  times.forEach((t, i) => { const st = sceneState(t); const key = JSON.stringify([st.z1, st.z2, st.p[0], st.carve, variantKey(st)]); (groups[key] = groups[key] || []).push(i); });
  const out = new Float32Array(w*h*4);
  const all = new Float32Array(n*2);
  for (const key of Object.keys(groups)){
    const idxs = groups[key]; const [z1, z2, dA, cv, vk] = JSON.parse(key);
    const probeProg = sceneProgram(vk, true);
    pos.fill(0);
    idxs.forEach(i => { const p = pts ? pts[i] : posAt(times[i]); pos[i*4] = p[0]; pos[i*4+1] = p[1]; pos[i*4+2] = p[2]; });
    const pt = tex(w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, pos, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h);
    gl.useProgram(probeProg.p); const u = probeProg.u;
    gl.uniform4fv(u.uZ1, z1); gl.uniform4fv(u.uZ2, z2); gl.uniform4fv(u.uCarve, cv); gl.uniform4f(u.uP, dA, 0, 0, 0); gl.uniform4fv(u.uMind, MIND);
    gl.uniform3fv(u.uCamPos, [0, 0, 0]); gl.uniform1f(u.uCellAng, .01); gl.uniform1f(u.uGT, 0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, pt); gl.uniform1i(u.uProbe, 3);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
    idxs.forEach(i => { all[i*2] = out[i*4]; all[i*2+1] = out[i*4+1]; });
    gl.deleteTexture(pt);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(outTex);
  for (let i = 0; i < n; i++) results.push([times[i], all[i*2], all[i*2+1]]);
  return results;
}
