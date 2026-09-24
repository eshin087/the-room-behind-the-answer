"""Score for the one-take flight. Everything is driven by v2/timeline.json and the camera path itself."""
import json, math, pathlib
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
HERE = pathlib.Path(__file__).parent
TL = json.load(open(HERE.parent / 'timeline.json'))
D = TL['duration']
N = int(D * SR)
t = np.arange(N) / SR
rng = np.random.default_rng(23)
dry = np.zeros((2, N)); wet = np.zeros((2, N))


def ss(x):
    x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)


def seg(t0, t1):
    a = max(0, int(t0 * SR)); b = min(N, int(t1 * SR)); return slice(a, b), t[a:b]


def lp(x, fc, order=2): return sosfilt(butter(order, fc, 'low', fs=SR, output='sos'), x)
def hp(x, fc, order=2): return sosfilt(butter(order, fc, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)


def add(sig, sl, amp=1.0, pan=0.0, send=0.3):
    l = math.cos((pan + 1) * math.pi / 4); r = math.sin((pan + 1) * math.pi / 4)
    dry[0, sl] += sig * amp * l * (1 - send * .5); dry[1, sl] += sig * amp * r * (1 - send * .5)
    wet[0, sl] += sig * amp * l * send; wet[1, sl] += sig * amp * r * send


def pad(freqs, t0, t1, amp, fade_in=2.0, fade_out=2.0, bright=.45, detune=6.0, trem=.1, send=.5):
    sl, tt = seg(t0, t1)
    env = ss((tt - t0) / fade_in) * ss((t1 - tt) / fade_out)
    for side, det in ((-1, -detune), (1, detune)):
        acc = np.zeros_like(tt)
        for i, f in enumerate(freqs):
            ph = rng.uniform(0, 2 * np.pi)
            lfo = 1 + trem * np.sin(2 * np.pi * (.06 + .04 * i) * tt + ph)
            for h in range(1, 7):
                fh = f * h * (2 ** (det * (1 if h % 2 else -1) / 1200))
                if fh > 9000: break
                acc += (bright ** (h - 1)) / h * np.sin(2 * np.pi * fh * tt + ph * h) * lfo
        acc = lp(acc, 2600)
        add(acc * env / max(1, len(freqs)) ** .5, sl, amp, pan=.35 * side, send=send)


def pluck(t0, f, amp, dur=1.6, pan=0.0, send=.5, bright=.5):
    sl, tt = seg(t0, t0 + dur); x = tt - t0
    env = np.exp(-x * (3.2 / dur) * 2.2) * ss(x / .004)
    sig = np.sin(2 * np.pi * f * x) + bright * .5 * np.sin(2 * np.pi * 2 * f * x) * np.exp(-x * 6) + bright * .25 * np.sin(2 * np.pi * 3.01 * f * x) * np.exp(-x * 9)
    add(sig * env, sl, amp, pan, send)


def click(t0, amp, pan=0.0, fc=4200.0):
    sl, tt = seg(t0, t0 + .02); x = tt - t0
    add(bp(rng.standard_normal(len(x)), fc * .6, min(fc * 1.6, 20000)) * np.exp(-x * 520), sl, amp, pan, .12)


def thump(t0, amp, f0=62, f1=34, dur=.55, send=.2):
    sl, tt = seg(t0, t0 + dur); x = tt - t0
    f = f1 + (f0 - f1) * np.exp(-x * 9)
    add(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * (5 / dur)) * ss(x / .003), sl, amp, 0, send)


def noise_swell(t0, t1, amp, f_lo, f_hi, curve=2.0, send=.4, down=False):
    sl, tt = seg(t0, t1); x = (tt - t0) / (t1 - t0)
    n = rng.standard_normal((2, len(tt)))
    bands = np.geomspace(f_lo, f_hi, 8)
    if down: bands = bands[::-1]
    for ch, pan in ((0, -.5), (1, .5)):
        acc = np.zeros(len(tt)); pos = x * (len(bands) - 1)
        for i, fb in enumerate(bands):
            acc += bp(n[ch], fb * .7, min(fb * 1.4, 20000)) * np.clip(1 - abs(pos - i), 0, 1)
        add(acc * np.clip(x, 0, 1) ** curve, sl, amp, pan, send)


# ------------------------------------------------------------------ camera path (port of engine posAt)
K = [(k[0], np.array(k[1:4], float)) for k in TL['keys']]


def posAt(tq):
    if tq <= K[0][0]: return K[0][1]
    if tq >= K[-1][0]: return K[-1][1]
    i = 0
    while i < len(K) - 2 and tq > K[i + 1][0]: i += 1
    k0, k1, k2, k3 = K[max(0, i - 1)], K[i], K[i + 1], K[min(len(K) - 1, i + 2)]
    dt = k2[0] - k1[0]; u = min(max((tq - k1[0]) / dt, 0), 1)
    m1 = (k2[1] - k0[1]) / ((k2[0] - k0[0]) or 1) * dt; m2 = (k3[1] - k1[1]) / ((k3[0] - k1[0]) or 1) * dt
    u2, u3 = u * u, u * u * u
    return (2 * u3 - 3 * u2 + 1) * k1[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * k2[1] + (u3 - u2) * m2


ctl_t = np.arange(0, D + 1 / 60, 1 / 60)
P = np.array([posAt(x) for x in ctl_t])
spd = np.linalg.norm(np.gradient(P, axis=0), axis=1) * 60
spd = np.convolve(spd, np.ones(20) / 20, mode='same')
spd_a = np.interp(t, ctl_t, spd)

# ------------------------------------------------------------------ wind: flight made audible
sky_t = TL['zones']['sky']
wind_scale = np.where(t < sky_t, 1.0, 0.0)
sp = np.clip(spd_a / 14.0, 0, 1.4) * wind_scale
sp_far = np.clip(np.log1p(spd_a) / np.log1p(900), 0, 1) * (1 - wind_scale)
n = rng.standard_normal((2, N))
for ch, pan in ((0, -.6), (1, .6)):
    lo = lp(n[ch], 500, 2); mid = bp(n[ch], 500, 2200, 2); hi = bp(n[ch], 2200, 7000, 2)
    w = lo * (.5 * sp) + mid * (.35 * sp ** 1.5) + hi * (.18 * sp ** 2.2) + lp(n[ch], 900, 2) * .22 * sp_far
    add(w, slice(0, N), .09, pan, .15)

# ------------------------------------------------------------------ zones
# backrooms: hum + low pad
pad([110.0, 164.81], .5, 18.8, .19, fade_in=3, bright=.35, trem=.06)
sl, tt = seg(1.0, 18.6)
hum = sum((1 / k) * np.sin(2 * np.pi * 60 * k * tt) for k in (2, 3, 4, 6, 8))
buzz = bp(rng.standard_normal(len(tt)), 900, 3000) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 120 * tt)))
flick = np.ones_like(tt)
for c in (4.1, 6.8, 9.9, 12.2, 15.3):
    flick *= 1 - .9 * np.exp(-((tt - c) / .05) ** 2)
add((hum * .5 + buzz * .06) * flick * ss((tt - 1.0) / 1.5) * ss((18.6 - tt) / 1.4), sl, .085, .1, .1)
# library
pad([146.83, 220.0, 261.63, 329.63, 349.23], 16.6, 38.0, .22, fade_in=1.6, bright=.4)
for f, a_, pn in ((440.0, .06, -.3), (659.25, .045, .3), (880.0, .025, 0)):
    pluck(17.6, f, a_, dur=4.0, pan=pn, send=.85, bright=.3)
# meme hall: playful arcade arpeggios over a bright chord
pad([196.0, 246.94, 293.66, 392.0], 36.4, 52.0, .16, fade_in=1.2, bright=.55, trem=.2, send=.4)
arp = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25]
for i in range(int((50.5 - 37.2) / .15)):
    a_ = 37.2 + i * .15
    pluck(a_, arp[i % len(arp)] * (1.5 if (i // 24) % 2 else 1.0), .018, dur=.22, pan=.5 * math.sin(i * .7), send=.3, bright=.9)
for tt_ in (41.3, 45.9):
    sl, tt2 = seg(tt_, tt_ + .5); x = tt2 - tt_
    sq = np.sign(np.sin(2 * np.pi * np.cumsum(900 + 700 * np.sin(x * 40) * np.exp(-x * 4)) / SR)) * np.exp(-x * 7)
    add(bp(sq, 600, 4000), sl, .03, .4, .4)
# cathedral: organ swell
pad([58.27, 87.31, 116.54, 146.83, 174.61, 220.0, 293.66], 50.2, 67.5, .27, fade_in=1.6, fade_out=2.5, bright=.62, trem=.04, send=.65)
thump(51.0, .3, 70, 30, 1.2, .5)
noise_swell(63.0, 67.9, .12, 200, 5000, curve=2.2, send=.5)
thump(67.8, .45, 80, 28, 1.4, .4)
# transformer: layered pulses, one per layer crossing, attention chord
pad([98.0, 146.83, 220.0, 233.08, 293.66], 66.5, 89.0, .21, fade_in=2.5, bright=.35)
for i, yl in enumerate([57., 48., 39., 30., 21., 12.]):
    y_abs = -118 + 3 + yl
    idx = np.argmin(np.abs(P[:, 1] - y_abs) + (np.abs(ctl_t - 76) > 12) * 1e3)
    tl_ = ctl_t[idx]
    thump(tl_, .12, 110, 55, .5, .3)
    pluck(tl_, [196.0, 220.0, 246.94, 293.66, 329.63, 392.0][i], .05, dur=2.2, pan=0, send=.7, bright=.4)
gm = [392.0, 466.16, 523.25, 587.33, 698.46, 783.99, 932.33]
for i in range(40):
    a_ = 68.5 + i * .44 + rng.uniform(-.1, .1)
    pluck(a_, rng.choice(gm), .035, dur=1.1, pan=rng.uniform(-.7, .7), send=.6, bright=.35)
att = TL['attention']
for f, d in ((587.33, 0), (783.99, .09), (1174.66, .18)):
    pluck(att + .25 + d, f, .075, dur=2.8, pan=0, send=.7, bright=.5)
# context window: steady digital pulse, static crackle for dropped tokens
pad([130.81, 196.0, 261.63], 86.5, 105.0, .15, fade_in=1.5, bright=.3, trem=.05)
for i in range(int((103.5 - 88.2) / .5)):
    a_ = 88.2 + i * .5
    click(a_, .05, pan=0, fc=2200)
sl, tt = seg(92.0, 104.0)
cr = rng.standard_normal(len(tt)) * (rng.random(len(tt)) < .004)
add(hp(np.convolve(cr, np.exp(-np.arange(200) / 30), mode='same'), 1500) * ss((tt - 92) / 2) * ss((104 - tt) / 1.5), sl, .08, -.3, .3)
# stairs: a note for every third step
pad([130.81, 196.0, 246.94, 293.66, 329.63], 102.0, 125.0, .2, fade_in=3.0, bright=.45)
scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0]
ST0z, STR, STK = 80.0, .42, 173
last = None; nstep = 0
for i, x in enumerate(ctl_t):
    if x < 104.5 or x > 124.0: continue
    k = int((P[i][2] - ST0z) / STR)
    if 0 <= k <= STK and last is not None and k != last:
        if k % 3 == 0:
            pluck(x, scale[min(nstep // 3, len(scale) - 1)], .05, dur=1.2, pan=-.2 + .4 * (nstep % 2), send=.55, bright=.4)
            nstep += 1
        thump(x, .03, 95, 60, .12, .05)
    last = k
# jailbreak corridor: unsettled cluster, heartbeat
pad([65.41, 69.3, 98.0, 103.83], 123.0, 139.5, .24, fade_in=1.5, bright=.55, detune=14, trem=.22, send=.35)
for i in range(16):
    a_ = 125.0 + i * .7
    if a_ > 135.0: break
    thump(a_, .26, 58, 38, .35, .1); thump(a_ + .2, .14, 52, 36, .3, .1)
for tt_ in np.arange(125.5, 134.0, 1.3):
    sl, tt2 = seg(tt_, tt_ + .9); x = tt2 - tt_
    w = bp(rng.standard_normal(len(x)), 1800, 5200) * np.sin(np.pi * np.clip(x / .9, 0, 1)) ** 2
    add(w, sl, .025, rng.uniform(-.8, .8), .6)
d0, d1 = TL['doorOpen']
sl, tt = seg(d0 - .2, d1 + .4); x = tt - (d0 - .2)
creak = np.sin(2 * np.pi * np.cumsum(95 + 40 * np.sin(x * 7) + 25 * rng.standard_normal(len(x)).cumsum() / 3000) / SR)
add(bp(np.sign(creak) * .5 + creak, 200, 2400) * ss(x / .2) * ss((d1 + .4 - tt) / .5), sl, .05, -.2, .5)
f0, f1, f2 = TL['flash']
noise_swell(d0, f1 + .05, .2, 200, 9000, curve=2.6, send=.6)
sl, tt = seg(d0, f1 + .05); x = (tt - d0) / (f1 + .05 - d0)
for base in (110, 220, 440, 880):
    fr = base * 2 ** x
    add(np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.sin(np.pi * np.clip(np.log2(fr / 110) / 4, 0, 1)) * x ** 2, sl, .05, 0, .5)
thump(f1, .6, 80, 28, 1.8, .3)
for fq in (87.31, 174.61, 261.63, 349.23, 440.0, 523.25, 659.25, 783.99, 987.77):
    pluck(f1 + .02, fq, .07, dur=6.0, pan=rng.uniform(-.6, .6), send=.85, bright=.6)
# the whole mind
pad([87.31, 130.81, 220.0, 329.63, 392.0, 493.88], 139.2, 166.0, .30, fade_in=1.2, fade_out=3.0, bright=.5, send=.65)
pad([43.65, 65.41], 141.0, 166.0, .18, fade_in=4, fade_out=3, bright=.3, send=.4)
for i in range(64):
    a_ = 142.0 + i * .36 + rng.uniform(-.08, .08)
    pluck(a_, rng.choice([1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0]), .02 * (1 - i / 96), dur=1.5, pan=rng.uniform(-.9, .9), send=.8, bright=.2)
# end
pad([110.0, 164.81, 246.94, 277.18], 162.5, 180.0, .24, fade_in=2.0, fade_out=3.0, bright=.3, send=.7)
for fq, d in ((440.0, 0), (554.37, .12), (659.25, .24)):
    pluck(168.2 + d, fq, .05, dur=4.0, pan=0, send=.8, bright=.3)
# sub bed per zone
for (fq, a_, b_) in ((55, .6, 18.4), (73.42, 17.0, 38.0), (49.0, 36.5, 51.8), (58.27, 50.4, 67.5), (49.0, 66.8, 88.8), (65.41, 87.8, 104.5), (65.41, 103.5, 124.5), (61.74, 123.5, 139.4), (43.65, 139.0, 166.0), (55, 163.0, 180)):
    sl, tt = seg(a_, b_)
    add(np.sin(2 * np.pi * fq * tt) * ss((tt - a_) / 1.2) * ss((b_ - tt) / 1.2), sl, .07, 0, .05)

# ------------------------------------------------------------------ narration typing and cursor
for L in TL['lines']:
    for i, ch in enumerate(L['text']):
        if ch != ' ':
            click(L['t0'] + i * TL['cps'], .05 + rng.uniform(0, .025), pan=rng.uniform(-.25, .25), fc=rng.uniform(3000, 5200))
for L in TL['lines']:
    if L.get('kind') in ('prompt', 'cardprompt'):
        end = L['t0'] + len(L['text']) * TL['cps']
        k = math.ceil(end * 2.2)
        while k / 2.2 < min(L['t1'], D - .4):
            if k % 2 == 0: pluck(k / 2.2, 1318.5, .018, dur=.18, pan=.2, send=.4, bright=.1)
            k += 1
# boot
thump(0.22, .35, 90, 40, .6)
for i, a in enumerate(np.linspace(.95, 3.2, 70)):
    pluck(a + rng.uniform(-.05, .05), rng.choice([1760, 2093, 2349, 2637, 3136, 3520, 4186]), .035 * (1 - i / 80), dur=.25, pan=rng.uniform(-.8, .8), send=.6, bright=.2)

# ------------------------------------------------------------------ reverb + master
ir_len = int(3.4 * SR); xi = np.arange(ir_len) / SR
ir = np.stack([rng.standard_normal(ir_len), rng.standard_normal(ir_len)]) * np.exp(-xi / .8)
ir[:, :int(.012 * SR)] *= np.linspace(0, 1, int(.012 * SR))
ir = np.stack([lp(ir[0], 6500), lp(ir[1], 6500)])
ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
rev = np.stack([fftconvolve(wet[0], ir[0])[:N], fftconvolve(wet[1], ir[1])[:N]])
mix = dry + rev * .9
mix = np.stack([hp(mix[0], 28), hp(mix[1], 28)])
mix[:, :int(.05 * SR)] *= np.linspace(0, 1, int(.05 * SR))
fade = int(1.5 * SR); mix[:, -fade:] *= np.linspace(1, 0, fade) ** 2
peak = np.abs(mix).max()
mix = np.tanh(mix / peak * 1.4) / np.tanh(1.4) * 10 ** (-1.0 / 20)
wavfile.write(str(HERE / 'score.wav'), SR, (mix.T * 32767).astype(np.int16))
print('score', D, 's; max speed', round(float(spd.max()), 1))
