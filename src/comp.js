const FS_COMP = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uCells, uAtlasS, uAtlasN, uLabels, uNarr;
uniform vec2 uRes, uCell, uGrid, uNCell, uNGrid, uNOff;
uniform float uGT, uScramble, uGlitch, uDissolve, uWhite, uFade, uFadeAll, uLodS, uLodN, uBandA;
uniform vec4 uBand;
out vec4 o;
float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float glyph(sampler2D A, int code, vec2 f, float lod){
  int idx=code-32; if(idx<=0||idx>94) return 0.;
  vec2 g=vec2(float(idx%16), float(idx/16));
  return textureLod(A, vec2((g.x+f.x)/16., (g.y+f.y)/6.), lod).r;
}
void main(){
  vec2 fc = gl_FragCoord.xy;
  float frame = floor(uGT*30.+.5);
  float sh = 0.;
  if(uGlitch>0.){
    float band = floor(fc.y/(uCell.y*2.));
    if(h21(vec2(band, frame)) < uGlitch*.55) sh = (h21(vec2(band*3.1, frame+7.))-.5)*uCell.x*34.*uGlitch;
  }
  vec2 p = fc + vec2(sh, 0.);
  vec2 cf = p/uCell; ivec2 c = clamp(ivec2(floor(cf)), ivec2(0), ivec2(uGrid)-1);
  vec2 f = fract(cf); f.y = 1.-f.y;
  vec4 cell = texelFetch(uCells, c, 0);
  int code = int(cell.a*255.+.5)+32;
  vec3 col = cell.rgb;
  if(h21(vec2(c)+vec2(frame*.713, frame*1.37)) < uScramble){
    code = 33 + int(h21(vec2(c)*1.3+frame)*93.); col = max(col, vec3(.22,.2,.24))*1.35;
  }
  float dz = h21(vec2(c)*.917+vec2(3.1,7.7));
  if(dz < uDissolve) code = 32;
  vec4 L = texelFetch(uLabels, c, 0);
  if(L.r>0.){ code = int(L.r*255.+.5); col = mix(vec3(.92,.9,1.), vec3(1.,.58,.42), L.b)*L.g; }
  if(uWhite>0.){
    float hw = h21(vec2(c)*1.77+vec2(3.3,1.1));
    if(hw < uWhite){ code = hw < uWhite*.45 ? 64 : (hw < uWhite*.8 ? 35 : 37); col = mix(col, vec3(1.,.97,.9), smoothstep(0.,.7,uWhite)); }
  }
  float m = glyph(uAtlasS, code, f, uLodS);
  vec3 outc = col*m*1.42;
  vec2 tsz = uGrid*uCell;
  vec2 uvc = p/tsz; vec2 dc = uCell/tsz;
  vec3 bl = texture(uCells, uvc).rgb*.4 + (texture(uCells, uvc+dc*vec2(1.6,1.6)).rgb + texture(uCells, uvc+dc*vec2(-1.6,1.6)).rgb
          + texture(uCells, uvc+dc*vec2(1.6,-1.6)).rgb + texture(uCells, uvc+dc*vec2(-1.6,-1.6)).rgb)*.15;
  outc += bl*.26*(1.-uDissolve);
  outc += vec3(1.,.97,.9)*uWhite*uWhite*.45;
  vec2 q = fc/uRes - .5; outc *= (1. - .5*dot(q,q)*1.5)*uFade;
  vec2 bd = abs(fc - uBand.xy) - uBand.zw;
  float bandM = 1. - smoothstep(-uNCell.y*.3, uNCell.y*1.6, max(bd.x, bd.y));
  outc *= 1. - uBandA*.78*bandM;
  vec2 nf = (fc - uNOff)/uNCell; ivec2 nc = ivec2(floor(nf));
  if(nc.x>=0 && nc.y>=0 && nc.x<int(uNGrid.x) && nc.y<int(uNGrid.y)){
    vec4 N = texelFetch(uNarr, nc, 0);
    if(N.r>0.){
      vec2 f2 = fract(nf); f2.y = 1.-f2.y;
      float mm = glyph(uAtlasN, int(N.r*255.+.5), f2, uLodN);
      vec3 tc = mix(vec3(.97,.94,.88), vec3(1.,.52,.34), N.b);
      outc = mix(outc, tc*1.02, clamp(mm*N.g*1.1, 0., 1.));
    }
  }
  outc *= uFadeAll;
  outc += (h21(fc*.731 + frame*.37) - .5)*.014;
  o = vec4(outc, 1.);
}`;

