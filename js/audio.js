/* =====================================================================
   audio.js — 100% synthesised with the WebAudio API. No audio files.
   Carving = filtered noise whose cutoff tracks edge pressure.
   Wind = brown noise through a moving bandpass, loudness ~ speed.
   ===================================================================== */
'use strict';

const Audio = {
  ctx: null, master: null, muted: false, ready: false,
  noiseBuf: null,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 8;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    this.master.connect(comp); comp.connect(ctx.destination);

    // one shared noise buffer (white), reused by every noise voice
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      d[i] = w * 0.6;
    }
    this.noiseBuf = buf;

    /* --- carve voice: noise → bandpass (edge pressure) + high hiss --- */
    this.carve = ctx.createGain(); this.carve.gain.value = 0;
    this.carve.connect(this.master);
    this.carveSrc = this.makeNoise();
    this.carveBP = ctx.createBiquadFilter();
    this.carveBP.type = 'bandpass'; this.carveBP.frequency.value = 900; this.carveBP.Q.value = 1.1;
    this.carveHP = ctx.createBiquadFilter();
    this.carveHP.type = 'highpass'; this.carveHP.frequency.value = 2400;
    this.carveHPG = ctx.createGain(); this.carveHPG.gain.value = 0.25;
    this.carveSrc.connect(this.carveBP); this.carveBP.connect(this.carve);
    this.carveSrc.connect(this.carveHP); this.carveHP.connect(this.carveHPG); this.carveHPG.connect(this.carve);
    this.carveSrc.start();

    /* --- wind: brown-ish noise → moving bandpass --- */
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    this.wind.connect(this.master);
    this.windSrc = this.makeNoise(true);
    this.windBP = ctx.createBiquadFilter();
    this.windBP.type = 'bandpass'; this.windBP.frequency.value = 420; this.windBP.Q.value = 0.7;
    this.windLP = ctx.createBiquadFilter();
    this.windLP.type = 'lowpass'; this.windLP.frequency.value = 1200;
    this.windSrc.connect(this.windBP); this.windBP.connect(this.windLP); this.windLP.connect(this.wind);
    this.windSrc.start();

    this.ready = true;
  },

  makeNoise(brown) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    if (!brown) {
      src.buffer = this.noiseBuf;
    } else {
      // brown bed needs its OWN buffer — integrating the shared white buffer
      // in place would corrupt the carve voice (and get applied twice).
      const b = ctx.createBuffer(1, this.noiseBuf.length, ctx.sampleRate);
      const out = b.getChannelData(0), inp = this.noiseBuf.getChannelData(0);
      let v = 0;
      for (let i = 0; i < out.length; i++) { v = (v + inp[i] * 0.02) * 0.998; out[i] = v * 8; }
      src.buffer = b;
    }
    src.loop = true;
    return src;
  },

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

  /* per-frame mix */
  update(speedN, edge, airborne, tuck) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : 1;
    const e = clamp(edge, 0, 1);
    if (airborne) {
      this.carve.gain.setTargetAtTime(0, t, 0.09);
    } else {
      const g = (0.035 + e * 0.30 + speedN * 0.09) * m;
      this.carve.gain.setTargetAtTime(g, t, 0.05);
      this.carveBP.frequency.setTargetAtTime(420 + e * 2400 + speedN * 900, t, 0.05);
      this.carveHPG.gain.setTargetAtTime((0.10 + e * 0.35) * m, t, 0.06);
    }
    const w = (airborne ? 0.10 + speedN * 0.24 : speedN * 0.16) * m * (tuck ? 1.25 : 1);
    this.wind.gain.setTargetAtTime(w, t, 0.12);
    this.windBP.frequency.setTargetAtTime(280 + speedN * 700 + Math.sin(t * 0.7) * 90, t, 0.3);
  },

  /* fade the riding loops (carve hiss, wind) out — paused, results, menu */
  quiet() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.carve.gain.setTargetAtTime(0, t, 0.08);
    this.wind.gain.setTargetAtTime(0, t, 0.15);
  },

  /* --- one-shots --- */
  noiseHit(freq, dur, vol, type, sweep) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type || 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t + dur);
    f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  },

  tone(freq, dur, vol, type, glide, delay) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, glide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },

  land(impact) {
    const s = clamp(impact, 0.2, 2.5);
    this.noiseHit(320, 0.16 + s * 0.1, 0.16 * s, 'lowpass', 90);
    this.tone(90, 0.22, 0.22 * s, 'sine', 42);
  },
  ollie() { this.noiseHit(1500, 0.14, 0.13, 'bandpass', 500); this.tone(220, 0.10, 0.07, 'triangle', 140); },
  crash() {
    this.noiseHit(180, 0.75, 0.42, 'lowpass', 55);
    this.noiseHit(2600, 0.30, 0.16, 'highpass', 900);
    this.tone(58, 0.9, 0.30, 'sine', 26);
  },
  gate() {
    this.tone(880, 0.16, 0.14, 'triangle', 1320);
    this.tone(1320, 0.22, 0.09, 'sine', 1760, 0.04);
  },
  miss() { this.tone(300, 0.22, 0.10, 'sawtooth', 150); },
  trick(mult) {
    const base = 520 + Math.min(mult, 6) * 90;
    this.tone(base, 0.14, 0.12, 'triangle', base * 1.5);
    this.tone(base * 1.5, 0.20, 0.09, 'sine', base * 2.2, 0.07);
  },
  combo(mult) {
    const base = 420 + Math.min(mult, 10) * 60;
    this.tone(base, 0.1, 0.09, 'square', base * 1.33);
  },
  ui(freq) { this.tone(freq || 660, 0.07, 0.06, 'triangle', (freq || 660) * 1.2); },
  gameover() {
    this.tone(330, 0.5, 0.16, 'sawtooth', 110);
    this.tone(220, 0.9, 0.14, 'sine', 60, 0.12);
    this.noiseHit(400, 1.2, 0.22, 'lowpass', 60);
  },
  dropIn() {
    this.tone(180, 0.9, 0.16, 'sine', 620);
    this.noiseHit(600, 0.9, 0.20, 'bandpass', 2600);
  }
};
