/* ---------------------------------------------------------------- boot */
const fontsReady = document.fonts ? Promise.all([document.fonts.load('700 40px JBM'), document.fonts.load('500 40px JBM')]).catch(() => {}) : Promise.resolve();
fontsReady.then(() => {
  init();
  if (CAP){
    for (const k of allVariantKeys()) sceneProgram(k, false);
    window.__renderAt = (t) => { render(t); gl.finish(); return true; };
    window.__probe = (ts, pts) => probe(ts, pts);
    window.__cam = (t) => cameraAt(t);
    window.__ready = true;
    return;
  }
  startLive();
});

function startLive(){
  const aud = document.getElementById('aud');
  const gate = document.getElementById('gate'), bar = document.getElementById('bar');
  const bPlay = document.getElementById('bPlay'), bRestart = document.getElementById('bRestart'), bSound = document.getElementById('bSound'), tc = document.getElementById('tc');
  let playing = false, muted = false, t0 = 0, tNow = 19.4, useAudio = false;
  const fmt = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s/60)).padStart(2, '0') + ':' + String(s%60).padStart(2, '0'); };
  function clock(){ if (useAudio && !aud.paused && !muted) return aud.currentTime; return (performance.now() - t0)/1000; }
  function play(from){
    playing = true; bPlay.textContent = 'pause';
    t0 = performance.now() - from*1000; useAudio = false;
    if (!muted){ try { aud.currentTime = from; const pr = aud.play(); if (pr) pr.then(() => { useAudio = true; }).catch(() => { useAudio = false; }); } catch (e) {} }
  }
  function pause(){ playing = false; bPlay.textContent = 'play'; aud.pause(); }
  function begin(withSound){ muted = !withSound; bSound.textContent = muted ? 'sound off' : 'sound on'; gate.hidden = true; play(0); poke(); }
  document.getElementById('go').onclick = () => begin(true);
  document.getElementById('goMute').onclick = () => begin(false);
  bPlay.onclick = () => { if (playing) pause(); else play(tNow >= DUR ? 0 : tNow); };
  bRestart.onclick = () => play(0);
  bSound.onclick = () => { muted = !muted; bSound.textContent = muted ? 'sound off' : 'sound on'; if (muted) aud.pause(); else if (playing) play(tNow); };
  let hideT = 0; function poke(){ bar.classList.add('show'); clearTimeout(hideT); hideT = setTimeout(() => bar.classList.remove('show'), 2200); }
  addEventListener('pointermove', () => { if (gate.hidden) poke(); });
  addEventListener('keydown', e => { if (!gate.hidden) return; if (e.code === 'Space'){ e.preventDefault(); bPlay.click(); } poke(); });
  addEventListener('resize', () => { setupSize(); if (!playing) render(tNow); });
  let last = 0;
  function loop(now){
    requestAnimationFrame(loop);
    if (!playing) return;
    tNow = clock();
    if (tNow >= DUR){ tNow = DUR; pause(); poke(); }
    const f0 = performance.now();
    render(tNow);
    const k = variantKey(sceneState(Math.min(DUR, tNow + 2.5)));
    if (!progCache[k]) { try { sceneProgram(k, false); } catch (e) {} }
    if (lastFrame) { const dt = f0 - lastFrame; ema = ema*.92 + dt*.08; }
    lastFrame = f0;
    if (ema > 55 && f0 - lastDrop > 1500 && LIVE_COLS_MAX > 70) { LIVE_COLS_MAX = Math.round(Math.min(LIVE_COLS_MAX, cols)*.82); setupSize(); lastDrop = f0; ema = 30; }
    const s = Math.floor(tNow); if (s !== last){ last = s; tc.textContent = fmt(tNow) + ' / ' + fmt(DUR); }
  }
  let ema = 30, lastFrame = 0, lastDrop = 0;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); pause();
    const g = document.getElementById('gate'); g.hidden = false;
    g.querySelector('p').textContent = "This device's graphics chip couldn't keep up with the real-time render." + (window.__FALLBACK_MSG || '');
    g.querySelector('.row').hidden = true;
  });
  render(tNow);
  requestAnimationFrame(loop);
}
