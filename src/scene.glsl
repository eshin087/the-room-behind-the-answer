#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform vec2 uRes, uCell, uGrid;
uniform float uGT, uFocal, uCellAng, uCorpusLen, uTMax, uStepW;
uniform int uEdgeCount, uNodeCount, uCamZone;
uniform vec3 uCamPos, uCamR, uCamU, uCamF, uDoorW;
uniform vec4 uP;      // x door angle, y flood, z beacon, w web overlay on
uniform vec4 uZ1;     // backrooms, library, cathedral, void
uniform vec4 uZ2;     // corridor, sky, light plane, unused
uniform vec4 uMind;   // sponge center xyz, half size
uniform vec4 uCarve;  // backrooms door, library door, hole, corridor passages
uniform sampler2D uCorpus, uAtlas, uData, uProbe;
out vec4 oCol;
#define PI 3.14159265359
#define TAU 6.28318530718

float h11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float h31(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
mat2 rot2(float a){ float c=cos(a), s=sin(a); return mat2(c,s,-s,c); }
float sdBox(vec3 p, vec3 b){ vec3 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.); }
float sdBox2(vec2 p, vec2 b){ vec2 q=abs(p)-b; return length(max(q,0.))+min(max(q.x,q.y),0.); }
float luma(vec3 c){ return dot(c, vec3(.299,.587,.114)); }

const int RAMP[13] = int[13](32,46,44,45,126,58,59,61,33,42,35,36,64);
int rampChar(float v){ return RAMP[int(clamp(v,0.,1.)*12.99)]; }
int corpusAt(float i){ i = mod(floor(i), uCorpusLen); int ii=int(i);
  return int(texelFetch(uCorpus, ivec2(ii & 1023, ii >> 10), 0).r*255.+.5); }
float atlasInk(int code, vec2 f){
  int idx = code-32; if(idx<=0||idx>94) return 0.;
  vec2 g = vec2(float(idx%16), float(idx/16));
  return textureLod(uAtlas, vec2((g.x+f.x)/16., (g.y+1.-f.y)/6.), 2.).r;
}
vec3 gOff = vec3(0.);
vec2 projDir(vec3 P, vec3 T){
  vec3 v = P + gOff - uCamPos;
  float vz=dot(v,uCamF), vx=dot(v,uCamR), vy=dot(v,uCamU);
  float tz=dot(T,uCamF), tx=dot(T,uCamR), ty=dot(T,uCamU);
  return vec2(tx*vz-vx*tz, ty*vz-vy*tz);
}
int dirChar(vec2 d){
  d = vec2(d.x/uCell.x, d.y/uCell.y);
  float a = mod(atan(d.y, d.x) + PI/8., PI);
  int k = int(a/(PI/4.));
  return k==0?45: k==1?47: k==2?124: 92;
}
int lineChar(vec3 P, vec3 T){ return dirChar(projDir(P,T)); }
int surfText(vec2 st, float cw, float fp, float seed, float l, out float ink){
  float ratio = cw/fp;
  if(ratio > 4.6){
    vec2 q = st/vec2(cw, cw*1.6667);
    int code = corpusAt(-floor(q.y)*157. + floor(q.x) + seed);
    float k = atlasInk(code, fract(q));
    ink = smoothstep(.22,.5,k);
    return ink>.5 ? rampChar(max(l, .55)) : 32;
  }
  float lod = ratio > 1.2 ? exp2(ceil(log2(ratio/1.2))) : 1.;
  float cwe = cw/lod;
  vec2 q = st/vec2(cwe, cwe*1.6667);
  int code = corpusAt(-floor(q.y)*157. + floor(q.x) + seed + lod*1013.);
  ink = code==32?0.:1.;
  return code;
}
vec2 faceST(vec3 p, vec3 n){
  vec3 a = abs(n);
  if(a.y > a.x && a.y > a.z) return vec2(p.x, -p.z*sign(n.y));
  return a.x > a.z ? vec2(p.z*sign(n.x), p.y) : vec2(-p.x*sign(n.z), p.y);
}

/* ================= world layout ================= */
const vec3 B0 = vec3(11.5, 0., -22.5);
const vec3 C0 = vec3(-20.4, -51.5, -8.);
const vec3 D0 = vec3(-108.4, -66., 103.);
const vec3 ST0 = vec3(-108.4, -98., 50.);
const float STK = 123.;
const vec3 HOLE = vec3(-108.4, -52.8, 0.);
const vec3 TOWER = vec3(-150., 0., 135.);
const vec3 LIGHTP = vec3(-108.4, -30., 185.);

float gLamp = 1e5;
float gTrap = 0.;

/* ---------- backrooms (local) ---------- */
const float BS = 5.0, BH = 2.9;
const ivec3 BPATH[11] = ivec3[11](ivec3(6,1,1), ivec3(6,2,1), ivec3(6,2,0), ivec3(5,2,0), ivec3(4,2,0), ivec3(3,3,1),
                                  ivec3(3,4,1), ivec3(3,4,0), ivec3(2,4,0), ivec3(1,4,0), ivec3(0,4,0));
bool onPathEdge(vec2 cid, float o){
  if(cid.x < 0. || cid.x > 6. || cid.y < 1. || cid.y > 4.) return false;
  for(int i=0;i<11;i++){ if(float(BPATH[i].x)==cid.x && float(BPATH[i].y)==cid.y && float(BPATH[i].z)==o) return true; }
  return false;
}
float bEdge(vec2 cid, float perp, float along, float o, float y){
  bool onPath = onPathEdge(cid, o);
  float h = h21(cid*1.37 + o*7.13 + .5);
  if(!onPath && h<.36) return 1e5;
  float a0=0., a1=BS;
  if(!onPath){
    float h2 = h21(cid*3.17 + o*1.31 + 11.);
    if(h2<.3) a1 = BS*(.4+.45*h21(cid+o*5.3));
    else if(h2<.5) a0 = BS*(.15+.4*h21(cid*1.9+o*2.1));
  }
  float d = sdBox2(vec2(perp, along-(a0+a1)*.5), vec2(.09, (a1-a0)*.5));
  if(onPath) d = max(d, -sdBox(vec3(perp, y-1.2, along-2.5), vec3(.4, 1.2, .72)));
  else if(h21(cid*9.3+o*3.1) > .45){
    float dc = mix(a0,a1, .25+.5*h21(cid*7.7+o));
    d = max(d, -sdBox(vec3(perp, y-1.05, along-dc), vec3(.4, 1.05, .5)));
  }
  return d;
}
vec2 mapBack(vec3 p){
  vec2 res = vec2(p.y, 1.);
  float dc = BH - p.y; if(dc<res.x) res = vec2(dc, 2.);
  vec2 c = floor(p.xz/BS);
  vec2 q = p.xz - c*BS;
  float dw = bEdge(c, q.x, q.y, 0., p.y);
  dw = min(dw, bEdge(c+vec2(1,0), q.x-BS, q.y, 0., p.y));
  dw = min(dw, bEdge(c, q.y, q.x, 1., p.y));
  dw = min(dw, bEdge(c+vec2(0,1), q.y-BS, q.x, 1., p.y));
  dw = min(dw, min(min(q.x, BS-q.x), min(q.y, BS-q.y)) + .12);
  if(dw<res.x) res = vec2(dw, 4.);
  return res;
}
float panelMask(vec2 xz, out vec2 pid){ vec2 g = xz/2.5; pid=floor(g); vec2 f=(fract(g)-.5)*2.5; return step(abs(f.x),.62)*step(abs(f.y),.3); }
float panelOn(vec2 pid){ float h=h21(pid+.3); if(h<.1) return 0.; if(h<.17) return step(.45, vnoise(vec2(uGT*11., h*50.))); return 1.; }
float bLight(vec3 p, vec3 n){
  vec2 b = floor(p.xz/2.5 - .5);
  float acc = 0.;
  for(int i=0;i<2;i++) for(int j=0;j<2;j++){
    vec2 pid = b + vec2(i,j);
    vec3 L = vec3((pid.x+.5)*2.5, BH-.02, (pid.y+.5)*2.5) - p;
    float d2 = dot(L,L); L *= inversesqrt(d2);
    acc += panelOn(pid) * (max(dot(n,L),0.)*.75+.25) / (1.+d2*.22);
  }
  return acc;
}

/* ---------- library (world = local) ---------- */
const float LR = 11.0, LRi = 7.55, LH = 5.5;
vec3 hexFrame(vec2 p){
  float a = atan(p.y, p.x);
  float sec = floor(a/(PI/3.) + .5);
  vec2 q = rot2(-sec*PI/3.)*p;
  return vec3(q.x, q.y, sec);
}
float hexAp(vec2 p){ return max(abs(p.x), max(abs(.5*p.x + .8660254*p.y), abs(.5*p.x - .8660254*p.y))); }
vec2 mapLib(vec3 p){
  vec3 hf = hexFrame(p.xz);
  float ap = hf.x;
  vec2 res = vec2(LR - ap, 10.);
  float k = floor(p.y/LH); float ly = p.y - k*LH;
  for(int j=0;j<2;j++){
    float yy = ly - float(j)*LH;
    float kk = k + float(j);
    float dSlab = max(max(LRi - ap, ap - LR - 1.), abs(yy+.175)-.175);
    if(dSlab<res.x) res = vec2(dSlab, 11.);
    float dRail = length(vec2(ap-(LRi+.06), yy-1.)) - .05;
    float tb = mod(hf.y, .4) - .2;
    dRail = min(dRail, max(length(vec2(ap-(LRi+.06), tb)) - .025, abs(yy-.5)-.5));
    if(dRail<res.x) res = vec2(dRail, 12.);
    if(mod(kk, 3.)==0.){
      float ang = mod(kk/3., 3.)*PI/3.;
      vec2 bq = rot2(-ang)*p.xz;
      float dBr = max(sdBox2(vec2(bq.y, yy+.175), vec2(1.1,.175)), ap-LRi-.2);
      float dBrR = max(sdBox2(vec2(abs(bq.y)-1.06, yy-.5), vec2(.04,.5)), ap-LRi-.2);
      dBr = min(dBr, dBrR);
      if(dBr<res.x) res = vec2(dBr, 13.);
    }
  }
  float ly2 = mod(p.y - 3.9 + LH*.5, LH) - LH*.5;
  float dL = length(vec3(p.x, ly2, p.z)) - .42;
  gLamp = dL;
  dL = min(dL, length(p.xz) - .018);
  if(dL<res.x) res = vec2(dL, 14.);
  return res;
}

/* ---------- cathedral of weights (local) ---------- */
vec2 mapCath(vec3 p){
  vec2 cid = floor(p.xz/16. + .5);
  vec2 q = p.xz - cid*16.;
  vec2 qa = abs(q);
  float dP = length(q) - 1.35;
  dP = min(dP, length(qa - vec2(1.12)) - .48);
  dP = min(dP, sdBox(vec3(q.x, p.y-.7, q.y), vec3(2.1,.7,2.1)) - .04);
  dP = min(dP, sdBox(vec3(q.x, p.y-1.55, q.y), vec3(1.85,.15,1.85)));
  vec2 res = vec2(dP, 20.);
  float yy = max(p.y - 28., 0.);
  float bx = 8. - qa.x, bz = 8. - qa.y;
  float air1 = max(length(vec2(bx-2.5, yy)), length(vec2(bx+2.5, yy))) - 10.5;
  float air2 = max(length(vec2(bz-2.5, yy)), length(vec2(bz+2.5, yy))) - 10.5;
  float dV = -min(air1, air2);
  if(dV<res.x) res = vec2(dV, 21.);
  if(p.y<res.x) res = vec2(p.y, 22.);
  return res;
}

/* ---------- the void: stairs, tower, fragments (world) ---------- */
const float SP = 7.2, SN = 24., SR0 = 2.2, SR1 = 5.6;
const float STR = .42, STH = .26;
float helixD(vec3 p){
  float r = length(p.xz);
  float a = atan(p.z, p.x);
  float s = a/TAU*SN;
  float si = floor(s);
  float rise = SP/SN;
  float base = si*rise;
  float n = floor((p.y - base + .17)/SP + .5);
  float top = base + n*SP;
  float dr = max(SR0 - .05 - r, r - SR1);
  float d = max(abs(p.y-(top-.17))-.17, dr);
  float fs = s - si, arc = TAU/SN*r;
  d = min(d, max(max((1.-fs)*arc, abs(p.y-(top+rise-.17))-.17), dr));
  d = min(d, max(max(fs*arc, abs(p.y-(top-rise-.17))-.17), dr));
  return min(d, r - SR0);
}
vec2 mapVoid(vec3 p){
  vec3 q = p - ST0;
  float k = clamp(floor(q.z/STR), 0., STK);
  float d = 1e5;
  for(int j=-1;j<=1;j++){ float kk = clamp(k+float(j), 0., STK);
    d = min(d, sdBox(q - vec3(0., kk*STH - .3, kk*STR + STR*.5), vec3(1.6, .3, STR*.5))); }
  float L = sqrt(1. + (STH/STR)*(STH/STR));
  float wv = (q.y - STH/STR*q.z)/L;
  float slab = max(max(abs(q.x)-1.6, max(wv, -wv - .86/L)), max(-q.z - .1, q.z - (STK+1.)*STR));
  if(slab > .3) d = min(d, slab + .1);
  d = min(d, sdBox(q - vec3(0., STK*STH - .3, (STK+1.)*STR + 1.25), vec3(2.4, .3, 1.25)));
  vec2 res = vec2(d, 30.);
  float dt = helixD((p - TOWER)/3.5)*3.5;
  if(dt<res.x) res = vec2(dt, 31.);
  vec3 cell = floor(p/26. + .5);
  bool skip = (cell.x >= -5. && cell.x <= -3.) || abs(cell.x) <= 1. || (cell.x >= -7. && cell.x <= -5. && cell.z >= 4. && cell.z <= 6.);
  if(!skip){
    vec3 w = p - cell*26.;
    float hh = h31(cell);
    w.xz = rot2(floor(hh*4.)*PI*.5)*w.xz;
    if(fract(hh*7.3)>.5) w.xy = rot2(PI*.5)*w.xy;
    if(fract(hh*3.1)>.6) w.yz = rot2(-PI*.5)*w.yz;
    w += vec3(2.1, 1.8, 0.) + (vec3(h31(cell+1.), h31(cell+2.), h31(cell+3.))-.5)*7.;
    float kx = clamp(floor(w.x/.35), 0., 13.);
    float dS = 1e5;
    for(int j=-1;j<=1;j++){ float kk = clamp(kx+float(j),0.,13.);
      dS = min(dS, sdBox(w - vec3(kk*.35+.175, kk*.3-.3, 0.), vec3(.175,.3,1.))); }
    dS = min(dS, sdBox(w - vec3(14.*.35+1.1, 13.*.3-.1, 0.), vec3(1.1,.1,1.1)));
    dS = min(dS, sdBox(w - vec3(-1.1, -.4, 0.), vec3(1.1,.1,1.1)));
    vec3 bq = abs(p - cell*26.);
    dS = min(dS, 13. - max(bq.x, max(bq.y, bq.z)) + .3);
    if(dS<res.x) res = vec2(dS, 32.);
  }
  return res;
}

/* ---------- the red corridor (local) ---------- */
const float DZ = 16.0, DW = .8, DH = 1.45;
vec2 mapCorr(vec3 p){
  vec2 res = vec2(1.5 - abs(p.x), 40.);
  float zz = mod(p.z, 2.4) - 1.2;
  float dPil = max(sdBox(vec3(abs(p.x)-1.5, p.y-3.75, zz), vec3(.24, 3.75, .2)), max(p.z - (DZ-.6), .6 - p.z));
  float dBeam = max(sdBox(vec3(p.x, p.y-7.25, zz), vec3(1.6, .28, .16)), max(p.z - (DZ-.6), .6 - p.z));
  dPil = min(dPil, dBeam);
  if(dPil<res.x) res = vec2(dPil, 46.);
  if(p.y<res.x) res = vec2(p.y, 41.);
  float dc = 7.5 - p.y; if(dc<res.x) res = vec2(dc, 42.);
  float dEnd = max(abs(p.z-(DZ+.1))-.1, -sdBox2(vec2(p.x, p.y-DH), vec2(DW+.02, DH+.01)));
  if(dEnd<res.x) res = vec2(dEnd, 43.);
  vec3 q = p - vec3(-DW, DH, DZ+.03);
  q.xz = rot2(-uP.x)*q.xz;
  float dD = sdBox(q - vec3(DW-.01,0.,0.), vec3(DW-.02, DH-.02, .04));
  if(dD<res.x) res = vec2(dD, 44.);
  if(uZ2.z > .5){ float dL = DZ + .22 - p.z; if(dL<res.x) res = vec2(dL, 45.); }
  return res;
}
float doorGlow(vec3 ro, vec3 rd){
  float tz = (DZ - ro.z)/rd.z;
  if(tz<=0.) return 0.;
  vec3 q = ro + rd*tz;
  float e = sdBox2(vec2(q.x, q.y-DH), vec2(DW, DH));
  return exp(-abs(e)*11.)*(1.7+uP.y*2.) + exp(-max(e,0.)*2.2)*uP.y*1.3;
}

/* ---------- the whole mind (world) ---------- */
float menger(vec3 p, float iters){
  float d = sdBox(p, vec3(1.));
  float s = 1.; gTrap = 0.;
  for(int m=0;m<8;m++){
    if(float(m) >= iters) break;
    vec3 a = mod(p*s, 2.)-1.;
    s *= 3.;
    vec3 r = abs(1.-3.*abs(a));
    float da=max(r.x,r.y), db=max(r.y,r.z), dc=max(r.z,r.x);
    float c = (min(da,min(db,dc))-1.)/s;
    if(c>d){ d=c; gTrap=float(m+1); }
  }
  return d;
}
vec2 mapMind(vec3 p){
  float S = uMind.w;
  float fpd = max(length(p - uCamPos)*uCellAng, .001);
  float it = clamp(log(S*3./(fpd*4.5))/log(3.), 2., 8.);
  float d = menger((p - uMind.xyz)/S, it)*S;
  return vec2(d, 70.+gTrap);
}

/* ---------- regions and the joined world ---------- */
float regBack(vec3 p){ return sdBox(p - vec3(31.5, 1.45, -2.5), vec3(20., 1.75, 20.)); }
float regLib(vec3 p){ return max(hexAp(p.xz) - 11.3, abs(p.y + 25.) - 70.); }
float regCath(vec3 p){ return sdBox(p - vec3(-132.4, -29.8, 0.), vec3(120., 22.3, 120.)); }
float regCorr(vec3 p){ return sdBox(p - D0 - vec3(0., 3.75, 8.125), vec3(2., 4.25, 8.125)); }
float regVoid(vec3 p){
  float r = sdBox(p - vec3(-75., -236.8, 0.), vec3(325., 183.2, 300.));
  r = max(r, -regLib(p));
  return max(r, -regCorr(p));
}
float gBest, gMat;
void zoneAcc(float r, vec2 h, float bmat){
  float d = min(h.x, -r);
  if(d > gBest){ gBest = d; gMat = h.x < -r ? h.y : bmat; }
}
void zoneOut(float r, float bmat){ if(-r > gBest){ gBest = -r; gMat = bmat; } }
vec2 map(vec3 p){
  gLamp = 1e5; gBest = -1e9; gMat = 0.;
  float r;
#ifdef Z_BACK
  r = regBack(p); if(r > 0.) zoneOut(r, 4.); else zoneAcc(r, mapBack(p - B0), 4.);
#endif
#ifdef Z_LIB
  r = regLib(p); if(r > 0.) zoneOut(r, 15.); else zoneAcc(r, mapLib(p), 15.);
#endif
#ifdef Z_CATH
  r = regCath(p); if(r > 0.) zoneOut(r, 23.); else zoneAcc(r, mapCath(p - C0), 23.);
#endif
#ifdef Z_VOID
  r = regVoid(p); if(r > 0.) zoneOut(r, 35.); else zoneAcc(r, mapVoid(p), 35.);
#endif
#ifdef Z_CORR
  r = regCorr(p); if(r > 0.) zoneOut(r, 47.); else zoneAcc(r, mapCorr(p - D0), 47.);
#endif
#ifdef Z_MIND
  r = -regCorr(p); if(r > 0.) zoneOut(r, 72.); else zoneAcc(r, mapMind(p), 72.);
#endif
  float dt;
#ifdef C_BD
  dt = -sdBox(p - vec3(11.15, 1.25, 0.), vec3(.75, 1.25, .65)); if(dt > gBest){ gBest = dt; gMat = 50.; }
#endif
#ifdef C_LD
  dt = -sdBox(p - vec3(-11.6, -26.2, 0.), vec3(1.2, 1.3, .65)); if(dt > gBest){ gBest = dt; gMat = 50.; }
#endif
#ifdef C_HOLE
  dt = -max(length(p.xz - HOLE.xz) - 6., abs(p.y - HOLE.y) - 1.5); if(dt > gBest){ gBest = dt; gMat = 51.; }
#endif
#ifdef C_CORR
  dt = -sdBox(p - vec3(D0.x, D0.y + 3.75, D0.z), vec3(1.5, 3.75, .5)); if(dt > gBest){ gBest = dt; gMat = 50.; }
#endif
#ifdef Z_MIND
  dt = -sdBox(p - vec3(D0.x, D0.y + DH, D0.z + DZ + .3), vec3(DW + .02, DH + .01, .55)); if(dt > gBest){ gBest = dt; gMat = 50.; }
#endif
  return vec2(gBest, gMat);
}
int zoneOf(float m){
  if(m < 9.5) return 0; if(m < 16.) return 1; if(m < 24.) return 2; if(m < 36.) return 3;
  if(m < 47.) return 4; if(m < 52.) return 5; return 6;
}
vec3 calcN(vec3 p, float e){ vec2 k=vec2(1,-1);
  return normalize(k.xyy*map(p+k.xyy*e).x + k.yyx*map(p+k.yyx*e).x + k.yxy*map(p+k.yxy*e).x + k.xxx*map(p+k.xxx*e).x); }
float calcAO(vec3 p, vec3 n, float s){ float o=0., w=1.;
  for(int i=1;i<=4;i++){ float h=s*float(i)/4.; float d=map(p+n*h).x; o+=(h-d)*w; w*=.7; }
  return clamp(1.-o*1.5/s, 0., 1.); }

const vec3 SUN = normalize(vec3(-.35,.5,.8));
vec3 mindSky(vec3 ro, vec3 rd){
  float h = rd.y;
  vec3 c = mix(vec3(.16,.07,.12), vec3(.03,.025,.09), smoothstep(-.3,.6,h));
  float hc = max(dot(rd, normalize(uMind.xyz - ro)), 0.);
  c += vec3(1.,.55,.35)*pow(hc, 7.)*.42 + vec3(.6,.35,.8)*pow(hc, 2.5)*.14;
  float sd = max(dot(rd,SUN),0.);
  c += vec3(1.,.8,.5)*(pow(sd,4000.)*4. + pow(sd,60.)*.25);
  return c;
}
vec3 voidFog(vec3 ro, vec3 rd){
  vec3 L = normalize(LIGHTP - ro);
  float g = max(dot(rd, L), 0.);
  vec3 c = mix(vec3(.012,.01,.03), vec3(.05,.045,.09), smoothstep(-.4,.8,rd.y));
  return c + vec3(1.,.97,.9)*(pow(g,40.)*1.3 + pow(g,400.)*3.);
}
void zoneFog(int z, vec3 ro, vec3 rd, out vec3 fogC, out float fogK){
  if(z==0){ fogC = vec3(.17,.14,.05); fogK = .075; return; }
  if(z==1){ fogC = vec3(.06,.035,.018); fogK = .034; return; }
  if(z==2){ fogC = mix(vec3(.02,.045,.07), vec3(.20,.34,.44), smoothstep(-.1,.9,rd.y)); fogK = .028; return; }
  if(z==3){ fogC = voidFog(ro, rd); fogK = .011; return; }
  if(z==4){ fogC = vec3(.02,.002,.006); fogK = .03; return; }
  if(z==5){ fogC = vec3(.03,.025,.03); fogK = .04; return; }
  fogC = mindSky(ro, rd); fogK = .00011;
}

/* ================= shading ================= */
void shadeBack(vec3 pl, vec3 pw, vec3 rd, float fp, float m, out vec3 col, out int code){
  vec3 n = calcN(pw, .002);
  float fpn = fp/max(abs(dot(n,rd)),.2);
  float li = bLight(pl,n);
  float ao = calcAO(pw,n,.35);
  if(m==2.){
    vec2 pid; float pm = panelMask(pl.xz, pid);
    if(pm>.5){ float on = panelOn(pid); col = vec3(1.,.97,.82)*(.2+1.5*on); code = on>.5 ? 35 : 58; return; }
    vec2 dl = (.5-abs(fract(pl.xz/.625)-.5))*.625;
    vec3 base = vec3(.82,.78,.56)*(.3+.6*li)*ao;
    float lw = fpn*.6;
    if(dl.x<lw || dl.y<lw){ code = lineChar(pl, dl.x<dl.y ? vec3(0,0,1) : vec3(1,0,0)); if(dl.x<lw && dl.y<lw) code = 43; col = base*1.1; return; }
    col = base*.55; code = rampChar(luma(col)*.8); return;
  }
  if(m==1.){
    float nz = vnoise(pl.xz*3.)*.6 + vnoise(pl.xz*11.)*.4;
    float stain = smoothstep(.55,.78, vnoise(pl.xz*.6+3.));
    vec3 base = mix(vec3(.66,.55,.25), vec3(.40,.33,.14), stain);
    col = base*(.3+.8*li)*ao*(.75+.5*nz);
    code = rampChar(luma(col)*.62*(.8+.4*h21(floor(pl.xz*14.))));
    return;
  }
  vec2 st = faceST(pl, n);
  vec3 base = vec3(.88,.77,.40)*(.28+.8*li)*ao;
  float stripe = step(.5, fract(st.x/.42));
  if(pl.y<.14){ col = base*.75; code = lineChar(pl, vec3(-n.z,0.,n.x)); return; }
  float ink; int tc = surfText(st, .052, fpn, 7., luma(base)*1.1, ink);
  if(ink>.5){ col = base*(.9+.15*stripe); code = tc; }
  else { col = base*.5; code = rampChar(luma(base)*(.32+.12*stripe)); }
}
void shadeLib(vec3 p, vec3 rd, float fp, float m, out vec3 col, out int code){
  if(m==15.){ vec3 n = calcN(p,.002); float fpn = fp/max(abs(dot(n,rd)),.2); float ink; int tc = surfText(faceST(p,n), .09, fpn, 1501., .3, ink);
    col = vec3(.35,.22,.12)*(ink>.5?.6:.25); code = ink>.5? tc : rampChar(.08); return; }
  vec3 n = calcN(p, .002);
  float fpn = fp/max(abs(dot(n,rd)),.2);
  float k = floor((p.y-3.9)/LH+.5);
  vec3 L1 = vec3(0., k*LH+3.9, 0.);
  float li = 0.;
  for(int j=-1;j<=1;j++){ vec3 L = L1 + vec3(0., float(j)*LH, 0.) - p; float d2=dot(L,L); li += (max(dot(n,normalize(L)),0.)*.8+.2)*26./(5.+d2); }
  float ao = calcAO(p,n,.3);
  vec3 hf = hexFrame(p.xz);
  if(m==14.){ col = vec3(1.,.8,.45)*2.2; code = length(p.xz)<.1 ? 124 : 64; return; }
  if(m==10.){
    float u = -hf.y; float v = p.y;
    float kf = floor(p.y/LH); float ly = p.y - kf*LH;
    if(mod(hf.z+6., 3.)==0. && abs(u)<.8 && ly<2.4){ col = vec3(0.); code = 32; return; }
    float row = floor(v/.42); float fv = fract(v/.42);
    if(fv<.08){ col = vec3(.5,.32,.16)*li*ao; code = lineChar(p, vec3(-sin(hf.z*PI/3.),0.,cos(hf.z*PI/3.))); if(fv<.04) code = 95; return; }
    float bid = floor(u/.06 + row*17.31);
    float hb = h11(bid*1.7);
    float bh = .62 + .3*hb;
    if((fv-.08)/.92 > bh){ col = vec3(.05,.03,.02)*li; code = rampChar(.06); return; }
    float hc = h11(bid*3.3);
    vec3 bc = hc<.2? vec3(.65,.18,.12) : hc<.4? vec3(.22,.42,.30) : hc<.6? vec3(.62,.46,.22) : hc<.8? vec3(.22,.28,.55) : vec3(.78,.62,.30);
    col = bc*(.08+1.3*li)*ao;
    float ch = floor((1.-fv)*9.);
    code = corpusAt(bid*31. + ch);
    if(code==32) code = rampChar(luma(col)*.8);
    if(fp > .07) code = rampChar(luma(col)*1.3*(.7+.6*h21(vec2(bid,ch))));
    return;
  }
  if(m==11. || m==13.){
    vec3 base = vec3(.62,.46,.28)*(.1+.9*li)*ao;
    if(n.y>.6){ float ink; vec2 st = vec2(p.x, -p.z); int tc = surfText(st, .09, fpn, 91., luma(base), ink);
      col = base*(ink>.5?.9:.45); code = ink>.5? tc : rampChar(luma(base)*.35); return; }
    if(n.y<-.6){ col = base*.35; code = rampChar(luma(col)*.8); return; }
    col = vec3(1.,.74,.36)*(.45+.9*li); code = 61; return;
  }
  col = vec3(.95,.72,.35)*(.35+.9*li); code = abs(p.y - (floor(p.y/LH)*LH + 1.)) < .07 ? lineChar(p, vec3(-sin(hf.z*PI/3.),0.,cos(hf.z*PI/3.))) : 124;
}
void shadeCath(vec3 pl, vec3 pw, vec3 rd, float fp, float m, out vec3 col, out int code){
  vec3 n = calcN(pw, .003);
  float fpn = fp/max(abs(dot(n,rd)),.2);
  vec3 L = normalize(vec3(.35,.85,.4));
  float dif = max(dot(n,L),0.);
  float ao = calcAO(pw,n,1.2);
  float sky = .5+.5*n.y;
  if(m==20.){
    vec2 cid = floor(pl.xz/16.+.5); vec2 q = pl.xz - cid*16.;
    float hp = h21(cid);
    float u = atan(q.y, q.x)*1.55;
    float spd = .6 + 1.2*hp;
    float v = pl.y + uGT*spd*(hp<.5?1.:-1.);
    float cw = .13;
    vec2 g = vec2(u/cw, v/(cw*1.6667));
    vec2 cl = floor(g);
    float tok = floor(cl.x/8.); float pos = mod(cl.x, 8.);
    float hr = h21(vec2(tok*1.3+cid.x*7., cl.y + cid.y*13.));
    float flick = step(.93, h21(vec2(tok, cl.y) + floor(uGT*8.)));
    int c = 32;
    if(pos<.5) c = hr<.45 ? 45 : 32;
    else if(pos<1.5) c = 48 + int(h21(vec2(tok,cl.y)+flick*floor(uGT*8.))*1.99);
    else if(pos<2.5) c = 46;
    else if(pos<6.5) c = 48 + int(h21(vec2(tok*pos, cl.y+pos)+flick*floor(uGT*8.+pos))*9.99);
    vec3 base = vec3(.55,.85,1.)*(.06+1.05*dif+.25*sky)*ao;
    if(pl.y<1.72){ col = base*.5; code = rampChar(luma(col)); return; }
    float ratio = cw/fpn;
    if(ratio>2.6){ float ink = smoothstep(.22,.5, atlasInk(c, fract(g))); code = ink>.5 ? rampChar(luma(base)*1.2) : 32; col = base*(ink>.5?1.:.4); if(ink<=.5) code = rampChar(luma(base)*.25); return; }
    col = base*(1.+flick*.8); code = c==32 ? rampChar(luma(base)*.3) : c; return;
  }
  if(m==21. || m==23.){
    vec3 base = vec3(.45,.65,.8)*(.15+.5*dif+.4*sky)*ao;
    float ink; int tc = surfText(faceST(pl,n), .5, fpn, 311., luma(base), ink);
    col = base*(ink>.5?1.:.5); code = ink>.5? tc : rampChar(luma(base)*.5); return;
  }
  float hd = length(pl.xz - (HOLE.xz - C0.xz));
  vec3 glow = vec3(.6,.45,1.)*exp(-max(hd-6.,0.)*.35)*.9;
  vec2 dl = (.5-abs(fract(pl.xz/2.)-.5))*2.;
  vec3 base = vec3(.35,.55,.7)*(.2+.4*dif)*ao + glow*.6;
  float lw = fpn*.55;
  if(dl.x<lw || dl.y<lw){ code = lineChar(pl, dl.x<dl.y ? vec3(0,0,1) : vec3(1,0,0)); col = base*1.2; return; }
  col = base*.45 + glow*.3; code = rampChar(luma(col)*.7);
}
void shadeVoid(vec3 p, vec3 rd, float fp, float m, out vec3 col, out int code){
  vec3 n = calcN(p, .002);
  float fpn = fp/max(abs(dot(n,rd)),.2);
  if(m==35.){ float ink; int tc = surfText(faceST(p,n), .3, fpn, 3501., .3, ink);
    float gl = pow(max(dot(n, normalize(LIGHTP - p)), 0.), 2.)*.12;
    float sp = step(.55, h21(floor(faceST(p,n)/1.7)));
    col = vec3(.12,.11,.2)*(ink>.5 ? .5 : .15) + vec3(.3,.28,.4)*gl; code = (ink>.5 && sp>.5) ? tc : rampChar(.03+gl*.5); return; }
  vec3 L = normalize(vec3(.25,.75,-.55));
  float dif = max(dot(n,L),0.);
  float ao = calcAO(p,n,.5);
  float li = .16 + .72*dif + .18*max(n.y,0.);
  float lgt = pow(max(dot(n, normalize(LIGHTP - p)),0.),1.5)*.35;
  if(m==30.){
    vec3 q = p - ST0;
    vec3 base = vec3(.9,.92,.97)*(li+lgt)*ao;
    if(n.z < -.7){
      float k = floor(q.z/STR + .5);
      float yc = k*STH - STH*.5;
      float dist = dot(ST0 + vec3(0., yc, k*STR) - uCamPos, uCamF);
      float cwr = clamp(dist*uCellAng, .02, .2);
      float c = floor(q.x/cwr + 6.);
      float w = mod(k, uStepW);
      int code2 = 32;
      if(c>=0. && c<12. && abs(q.y - yc) < cwr*.9) code2 = corpusAt(uCorpusLen - uStepW*12. + w*12. + c);
      if(code2!=32){ col = vec3(1.,.93,.8)*(.9+.4*dif); code = code2; return; }
      if(abs(q.y - k*STH) < fpn*.9){ col = base*1.3 + vec3(.1); code = 95; return; }
      col = base*.8; code = rampChar(luma(col)*.85); return;
    }
    if(n.y>.7){ float ink; if(abs(fract(q.z/STR+1e-3)) < fpn*.9/STR){ col = base*1.2; code = 95; return; }
      int tc = surfText(vec2(q.x, -q.z), .07, fpn, floor(q.z/STR)*53.+5., luma(base), ink);
      col = base*(ink>.5?1.:.5); code = ink>.5? tc : rampChar(luma(base)*.4); return; }
    col = base*.7; code = rampChar(luma(col)*.8); return;
  }
  if(m==31.){
    vec3 base = vec3(.7,.8,.92)*(li+lgt)*ao;
    float ink; int tc = surfText(faceST(p,n), .5, fpn, 1201., luma(base), ink);
    col = base*(ink>.5?1.:.5); code = ink>.5? tc : rampChar(luma(base)*.5); return;
  }
  vec3 base = vec3(.82,.86,.97)*(li+lgt)*ao;
  float ink; int tc = surfText(faceST(p,n), .12, fpn, 3301., luma(base), ink);
  col = base*(ink>.5?1.:.55); code = ink>.5? tc : rampChar(luma(base)*.6);
}
void shadeCorr(vec3 pl, vec3 pw, vec3 rd, float fp, float m, out vec3 col, out int code){
  if(pl.z>DZ+.19 && m==45.){ col = vec3(1.,.97,.92)*2.5; code = 64; return; }
  vec3 n = calcN(pw, .002);
  float fpn = fp/max(abs(dot(n,rd)),.2);
  vec3 dp = vec3(0., DH, DZ) - pl;
  float dz = DZ - pl.z;
  float spill = 1./(1.+dz*dz*.045);
  float flood = uP.y;
  float dirL = max(dot(n, normalize(dp)), 0.);
  float lit = (.5 + 2.4*flood)*spill*(.35+.65*dirL) + .03 + flood*.25;
  vec3 light = vec3(1.,.93,.85);
  if(m==45.){ col = vec3(1.,.97,.92)*2.5; code = 64; return; }
  if(m==44.){
    vec3 q = pl - vec3(-DW, DH, DZ+.03); q.xz = rot2(-uP.x)*q.xz; q.x -= DW-.01;
    vec2 pr = abs(q.xy);
    vec3 base = vec3(.36,.1,.08)*(.25+.5*spill) + light*flood*.5;
    if(length((q.xy - vec2(.55, -.05))*vec2(1.,.6))<.04){ col = light*2.2; code = 42; return; }
    bool edge = pr.x<.62 && pr.y<1.3 && (abs(pr.x-.62)<fpn*.7 || abs(pr.y-1.3)<fpn*.7 || (abs(abs(q.y)-.62)<fpn*.6));
    if(edge){ code = abs(pr.x-.62)<fpn*.7 ? 124 : 45; col = base*1.8; return; }
    col = base*.75; code = rampChar(luma(col)*.9); return;
  }
  if(m==40. || m==43.){
    vec3 base = vec3(.8,.14,.17)*(.05+lit*1.3);
    base = mix(base, light*lit, flood*.5);
    float ink; int tc = surfText(faceST(pl,n), .05, fpn, 4401., luma(base)*1.2, ink);
    col = base*(ink>.5?1.:.3); code = ink>.5? tc : rampChar(luma(base)*.3); return;
  }
  if(m==46.){
    vec3 base = vec3(.55,.16,.16)*(.04+lit*1.6) + light*lit*flood*.4;
    col = base; code = rampChar(luma(base)*1.1); if(abs(n.x)>.7 && dirL>.3 && code==32) code = 46;
    return;
  }
  if(m==41.){
    vec3 r = reflect(rd, vec3(0,1,0));
    float refl = doorGlow(pl, r);
    vec3 base = vec3(.5,.1,.12)*(.03+.5*lit) + light*refl*.45;
    float ink; int tc = surfText(vec2(pl.x, -pl.z), .07, fpn, 902., luma(base), ink);
    col = base*(ink>.5?1.:.6); code = ink>.5? tc : rampChar(luma(base)*.7); return;
  }
  col = vec3(.2,.04,.05)*lit*.5; code = rampChar(luma(col));
}
void shadeTunnel(vec3 p, vec3 rd, float fp, float m, out vec3 col, out int code){
  vec3 n = calcN(p, .002);
  float fpn = fp/max(abs(dot(n,rd)),.2);
  float ink; int tc = surfText(faceST(p,n), .06, fpn, 5001., .4, ink);
  if(m==47.){
    float gl = pow(max(dot(n, normalize(LIGHTP - p)), 0.), 3.)*.2;
    vec3 base = vec3(.32,.06,.08)*(.25 + gl*2.);
    col = base*(ink>.5 ? .9 : .4); code = (ink>.5 && h21(floor(faceST(p,n)/.9)) > .7) ? tc : rampChar(luma(base)*.35); return;
  }
  if(m==51.){
    float gdown = smoothstep(-51.3, -54.3, p.y);
    vec3 base = mix(vec3(.3,.45,.55)*.4, vec3(.7,.5,1.)*1.3, gdown);
    col = base*(ink>.5?1.:.5); code = ink>.5? tc : rampChar(luma(base)*.7); return;
  }
  vec3 base = vec3(.55,.45,.35)*.35;
  col = base*(ink>.5?1.:.4); code = ink>.5? tc : rampChar(luma(base)*.4);
}
void shadeMind(vec3 p, vec3 rd, float t, float fp, float m, out vec3 col, out int code){
  vec3 n = calcN(p, max(.0012*t, .004));
  float fpn = fp/max(abs(dot(n,rd)),.2);
  float dif = max(dot(n,SUN),0.);
  float ao = calcAO(p,n, max(2., .03*t))*calcAO(p,n, max(9., .12*t)); ao *= ao;
  float lvl = m-70.;
  vec3 amb = vec3(.24,.19,.44)*(.55+.45*n.y);
  vec3 base = vec3(.92,.84,.8)*(vec3(1.,.8,.55)*dif*1.05 + amb*(.3+.7*ao)*1.35);
  base *= .85 + .15*abs(n.x) + .3*abs(n.z);
  float cs = 1.7*exp2(max(floor(log2(fp*1.4/1.7)), 0.));
  vec3 cw = floor(p/cs + n*.5);
  float hl = h31(cw);
  if(lvl > .5 && hl > .74){
    float k = floor(h31(cw+7.)*6.);
    vec3 lc = k<1.? vec3(1.,.85,.35) : k<2.? vec3(1.,.55,.22) : k<3.? vec3(.45,.85,1.) : k<4.? vec3(.7,.5,1.) : k<5.? vec3(.95,.97,1.) : vec3(1.,.28,.28);
    float tw = .65+.35*sin(uGT*2.6 + hl*60.);
    col = lc*(1.1+.7*tw)*(.35+.65*ao);
    code = hl > .95 ? 42 : hl > .86 ? 43 : 111;
    if(fpn > 1.2) code = hl > .9 ? 42 : 43;
    return;
  }
  float ink = 0.; int tc = 32;
  if(.85/fpn > .75) tc = surfText(faceST(p,n), .85, fpn, 7001.+lvl*97., luma(base)*1.1, ink);
  if(ink>.5){ col = base*1.1; code = tc; }
  else { col = base; code = rampChar(luma(base)*.9); }
}
void shade(vec3 ro, vec3 rd, float t, float m, out vec3 col, out int code){
  vec3 p = ro + rd*t;
  float fp = t*uCellAng;
  col = vec3(0.); code = 32;
  int z = zoneOf(m);
#ifdef Z_BACK
  if(z==0){ gOff = B0; shadeBack(p - B0, p, rd, fp, m, col, code); }
#endif
#ifdef Z_LIB
  if(z==1){ gOff = vec3(0.); shadeLib(p, rd, fp, m, col, code); }
#endif
#ifdef Z_CATH
  if(z==2){ gOff = C0; shadeCath(p - C0, p, rd, fp, m, col, code); }
#endif
#ifdef Z_VOID
  if(z==3){ gOff = vec3(0.); shadeVoid(p, rd, fp, m, col, code); }
#endif
#ifdef Z_CORR
  if(z==4){ gOff = D0; shadeCorr(p - D0, p, rd, fp, m, col, code); }
#endif
  if(z==5){ gOff = vec3(0.); shadeTunnel(p, rd, fp, m, col, code); }
#ifdef Z_MIND
  if(z==6){ gOff = vec3(0.); shadeMind(p, rd, t, fp, m, col, code); }
#endif
  gOff = vec3(0.);
}

/* ================= the web of words (analytic, depth tested) ================= */
void renderWeb(vec3 ro, vec3 rd, float tLim, bool miss, inout vec3 col, inout int code){
  float best = tLim;
  bool hit = false;
  vec3 halo = vec3(0.);
  float cellAngY = uCellAng*uCell.y/uCell.x;
  for(int i=0;i<200;i++){
    if(i>=uEdgeCount) break;
    vec4 A = texelFetch(uData, ivec2(i,1), 0);
    vec4 B = texelFetch(uData, ivec2(i,2), 0);
    vec3 ba = B.xyz-A.xyz; vec3 w0 = ro-A.xyz;
    float b = dot(rd,ba), c = dot(ba,ba), d = dot(rd,w0), e = dot(ba,w0);
    float den = c - b*b;
    float s = clamp((e - b*d)/max(den,1e-5), 0., 1.);
    float t = b*s - d;
    if(t<.3 || t>best) continue;
    vec3 P = A.xyz + ba*s;
    float dist = length(ro+rd*t - P);
    vec2 sd = projDir(P, ba);
    vec2 sdp = normalize(sd);
    float thr = .5*(abs(sdp.y)*uCellAng + abs(sdp.x)*cellAngY);
    if(dist/t < thr){
      best = t; hit = true;
      float wgt = A.w;
      float pulse = fract(uGT*.55 + B.w);
      vec3 ec = mix(vec3(.42,.34,.95), vec3(1.,.5,.34), smoothstep(.55,.95,wgt));
      col = ec*(.7+1.6*wgt)*exp(-t*.022);
      code = dirChar(sd);
      if(abs(s - pulse)<.035){ col = mix(col, vec3(1.,.9,.85), .7)*1.3; code = wgt>.6 ? 64 : 42; }
    }
  }
  for(int i=0;i<90;i++){
    if(i>=uNodeCount) break;
    vec4 N = texelFetch(uData, ivec2(i,0), 0);
    vec3 v = N.xyz - ro;
    float tca = dot(v, rd);
    if(tca<.3 || tca > tLim) continue;
    float d2 = dot(v,v) - tca*tca;
    float R = .05 + .06*N.w;
    float dd = sqrt(max(d2,0.));
    float ang = dd/tca;
    float nr = R/tca;
    halo += vec3(.75,.65,1.)*exp(-ang/(uCellAng*2.))*(.16+.35*N.w)*exp(-tca*.03);
    if(ang < nr + .5*uCellAng && tca-R < best){
      best = tca-R; hit = true;
      float br = (1.2+1.2*N.w)*exp(-tca*.02);
      vec3 nc = mix(vec3(.85,.8,1.), vec3(1.,.62,.45), step(.5,N.w));
      if(nr > 1.6*uCellAng){
        float th = sqrt(max(R*R-d2,0.));
        vec3 P = ro + rd*(tca-th); vec3 nn = normalize(P - N.xyz);
        float l = .25 + .75*max(dot(nn, normalize(vec3(-.3,.6,-.7))),0.);
        col = nc*br*l; code = rampChar(.35+.65*l);
      } else { col = nc*br; code = nr > .7*uCellAng ? 64 : nr > .35*uCellAng ? 111 : 42; }
    }
  }
  float hl = luma(halo);
  if(!hit && hl > .05){ col += halo*.8; if(code==32 || luma(col) < .08) code = hl>.28 ? 58 : 46; }
  else col += halo*.2;
  if(miss && !hit){
    vec3 sc3 = floor(rd/uCellAng*.9);
    float hs = h31(sc3);
    if(hs>.978 && code==32){ code = hs>.996 ? 43 : 46; col = vec3(.45,.4,.75)*(.5+.5*h31(sc3+3.)); }
  }
}

void renderMarch(vec3 ro, vec3 rd, out vec3 col, out int code){
  float t = .03; float m = -1.; float glow = 0.;
  for(int i=0;i<140;i++){
    vec3 p = ro+rd*t;
    vec2 h = map(p);
    glow += .05/(1.+gLamp*gLamp*6.);
    if(h.x < .0006*t + .0004){ m = h.y; break; }
    t += h.x*.82;
    if(t>uTMax) break;
  }
  vec3 fogC; float fogK;
  int z = m < 0. ? uCamZone : zoneOf(m);
  if(z==5) z = uCamZone;
  zoneFog(z, ro, rd, fogC, fogK);
  if(m<0.){
    col = fogC; code = rampChar(luma(col)*.8);
    if(z==6){
      float sd = max(dot(rd,SUN),0.);
      code = rampChar(luma(col)*.42*(.5+h21(floor(rd.xy/uCellAng))));
      vec3 s3 = floor(rd/uCellAng*.9);
      if(h31(s3)>.985){ code = h31(s3+1.)>.8 ? 43 : 46; col = vec3(.8,.75,1.)*.6; }
      if(sd>.9994) code = 64;
    }
    if(z==3) code = rampChar(luma(col)*.9);
  } else {
    shade(ro, rd, t, m, col, code);
    float f = exp(-t*fogK);
    col = mix(fogC, col, f);
    if(f<.35) code = rampChar(luma(col)*.85);
  }
  if(glow > .02){ col += vec3(1.,.72,.38)*glow*.9; if(glow>.12 && code==32) code = glow>.35?58:46; }
#ifdef Z_CORR
  if(uZ2.z > .5){
    vec3 rl = ro - D0;
    float tz = (DZ - rl.z)/rd.z;
    if(tz>0. && rl.z < DZ && (m<0. || t>tz-.2)){
      vec3 q = rl + rd*tz;
      if(abs(q.x) < 1.6 && q.y > -.2 && q.y < 3.6){
        float g = doorGlow(rl, rd);
        float e = sdBox2(vec2(q.x, q.y-DH), vec2(DW, DH));
        col += vec3(1.,.95,.88)*g;
        if(g>.3 && (e>0. || m==44.)) code = g>1.? 35 : g>.6 ? 43 : 58;
      }
    }
  }
#endif
#ifdef WEB
  if(z==3 || (m<0. && uCamZone==3)) renderWeb(ro, rd, m<0. ? 400. : t, m<0., col, code);
#endif
#ifdef Z_MIND
  if(uP.z > 0.){
    vec3 v = uDoorW - ro; float tb = dot(v, rd);
    if(tb > 0. && (m<0. || t > tb - 2.)){
      float ang = length(v - rd*tb)/tb;
      float g = exp(-ang/(uCellAng*1.2))*uP.z;
      col += vec3(1.,.9,.75)*g*1.6;
      if(g > .5) code = g > .9 ? 64 : 42; else if(g > .15 && code==32) code = 43;
    }
  }
#endif
}

void main(){
#ifdef PROBE
  vec3 pp = texelFetch(uProbe, ivec2(gl_FragCoord.xy), 0).xyz;
  vec2 hh = map(pp);
  oCol = vec4(hh.x, hh.y, 0., 1.);
#else
  vec2 px = gl_FragCoord.xy * uCell;
  float mr = min(uRes.x, uRes.y);
  vec2 uv = (px - .5*uRes)/(.5*mr);
  vec3 rd = normalize(uv.x*uCamR + uv.y*uCamU + uFocal*uCamF);
  vec3 col; int code;
  renderMarch(uCamPos, rd, col, code);
  col = vec3(1.) - exp(-col*1.35);
  float mx = max(col.r, max(col.g, col.b));
  col = col/max(mx, 1e-4) * pow(mx, .62);
  oCol = vec4(col, float(code-32)/255.);
#endif
}
