/* =====================================================================
   audio.js — all sound is shaped noise: the sea's hiss, the roar of a
   wave pitching, the hollow rumble inside the tube, splashes.
   ===================================================================== */
'use strict';

const Sfx = {
  ctx: null, master: null, noise: null, muted: false,
  sea: null, seaF: null, roar: null, roarF: null, tube: null,

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 3; }
    this.noise = buf;
    [this.sea, this.seaF] = this.loop(500, 0.12);
    [this.roar, this.roarF] = this.loop(900, 0);
    [this.tube] = this.loop(180, 0);
  },
  loop(freq, gain) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    s.playbackRate.value = 0.6 + Math.random() * 0.5;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(this.master); s.start();
    return [g, f];
  },
  burst(dur, f0, f1, gain, type = 'lowpass') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  splash(k = 1) { this.burst(0.5 + 0.3 * k, 3000, 500, 0.35 * k, 'bandpass'); },
  stroke() { this.burst(0.22, 1800, 700, 0.06, 'bandpass'); },
  crash(k) { this.burst(2.4, 1400, 200, 0.5 * k); },

  /* per frame: roar = how close breaking water is, tube = inside the barrel */
  update(roar, tube, under) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sea.gain.setTargetAtTime(under ? 0.05 : 0.12, t, 0.3);
    this.seaF.frequency.setTargetAtTime(under ? 250 : 520, t, 0.2);
    this.roar.gain.setTargetAtTime(0.5 * roar * (under ? 0.4 : 1), t, 0.15);
    this.roarF.frequency.setTargetAtTime(400 + 1100 * roar, t, 0.2);
    this.tube.gain.setTargetAtTime(tube ? 0.9 : (under ? 0.6 : 0), t, 0.12);
  },
  toggle() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
    return this.muted;
  }
};
