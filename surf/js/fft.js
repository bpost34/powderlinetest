/* =====================================================================
   fft.js — wind-sea chop: a Tessendorf FFT ocean on WebGL2.

   Ported (simplified) from web-ocean by Maksymilian Dendura
   (https://github.com/noniv/web-ocean, MIT licence — notice below), which
   runs on WebGPU compute. Here everything is fragment passes:
     spectrum h0(k)   built once on the CPU (JONSWAP + Donelan–Banner)
     evolve           h(k,t) and the derived spectra, 2 render targets
     inverse FFT      log2(N) horizontal + log2(N) vertical passes
     assemble         per cascade → displacement (Dx, Dy, Dz, jxz) and
                      derivative (sx, sz, jxx, jzz) texture arrays, mipmapped
   Four cascades of 128² tile the sea at different scales. The breaking surf
   waves stay analytic (ocean.js); this adds the chop, the glittering slopes
   and the whitecaps on top of them.

   MIT License — Copyright (c) 2026 Maksymilian Dendura
   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions: The above copyright
   notice and this permission notice shall be included in all copies or
   substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
   WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
   ===================================================================== */
'use strict';

const FFT_N = 128, FFT_LOGN = 7, FFT_C = 4;
const FFT_L = [211.3, 39.7, 7.43, 1.393];          // patch size per cascade (m)

const FFT_VS = `
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const FFT_HEAD = `
precision highp float; precision highp int; precision highp sampler2D;
const int N = ${FFT_N};
const float PI = 3.14159265358979;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
vec2 mulI(vec2 a){ return vec2(-a.y, a.x); }
layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;
`;
// h(k,t) = h0(k) e^{-iwt} + conj(h0(-k)) e^{iwt}, plus displacement / slope / Jacobian spectra
const FFT_EVOLVE = FFT_HEAD + `
uniform sampler2D uH0; uniform float uTime, uChop, uLoop; uniform vec4 uL;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  int c = p.y / N, x = p.x, y = p.y - c * N;
  float L = c == 0 ? uL.x : c == 1 ? uL.y : c == 2 ? uL.z : uL.w;
  vec2 k = vec2(float(x >= N / 2 ? x - N : x), float(y >= N / 2 ? y - N : y)) * (2.0 * PI / L);
  float kl = length(k);
  if (kl < 1e-5) { oA = vec4(0.0); oB = vec4(0.0); return; }
  float w0 = 2.0 * PI / uLoop;                              // frequencies quantised: loops seamlessly
  float w = floor(sqrt(9.81 * kl + 7.4e-5 * kl * kl * kl) / w0) * w0;
  float ph = w * uTime;
  vec2 e = vec2(cos(ph), sin(ph));
  vec4 H0 = texelFetch(uH0, p, 0);
  vec2 h = cmul(H0.xy, vec2(e.x, -e.y)) + cmul(H0.zw, e);
  vec2 ih = mulI(h);
  float ik = 1.0 / kl, lam = uChop;
  vec2 Dx = ih * (lam * k.x * ik), Dz = ih * (lam * k.y * ik);
  vec2 jxz = h * (-lam * k.x * k.y * ik), jxx = h * (-lam * k.x * k.x * ik), jzz = h * (-lam * k.y * k.y * ik);
  vec2 sx = ih * k.x, sz = ih * k.y;
  // two real fields per complex signal (their spectra are Hermitian)
  oA = vec4(Dx + mulI(Dz), h + mulI(jxz));
  oB = vec4(sx + mulI(sz), jxx + mulI(jzz));
}`;
// one radix-2 pass of the inverse FFT along x or y (natural order in and out)
const FFT_PASS = FFT_HEAD + `
uniform sampler2D uA, uB; uniform int uSize, uHoriz;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  int idx = uHoriz == 1 ? p.x : p.y % N, base = uHoriz == 1 ? 0 : (p.y / N) * N;
  int hs = uSize / 2;
  int ev = (idx / uSize) * hs + idx % hs, od = ev + N / 2;
  ivec2 pe = uHoriz == 1 ? ivec2(ev, p.y) : ivec2(p.x, base + ev);
  ivec2 po = uHoriz == 1 ? ivec2(od, p.y) : ivec2(p.x, base + od);
  float a = 2.0 * PI * float(idx) / float(uSize);
  vec2 tw = vec2(cos(a), sin(a));
  vec4 eA = texelFetch(uA, pe, 0), oA_ = texelFetch(uA, po, 0), eB = texelFetch(uB, pe, 0), oB_ = texelFetch(uB, po, 0);
  oA = vec4(eA.xy + cmul(tw, oA_.xy), eA.zw + cmul(tw, oA_.zw));
  oB = vec4(eB.xy + cmul(tw, oB_.xy), eB.zw + cmul(tw, oB_.zw));
}`;
const FFT_ASSEMBLE = FFT_HEAD + `
uniform sampler2D uA, uB; uniform int uC;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy) + ivec2(0, uC * N);
  vec4 a = texelFetch(uA, p, 0), b = texelFetch(uB, p, 0);
  oA = vec4(a.x, a.z, a.y, a.w);     // Dx, Dy (height), Dz, jxz
  oB = b;                            // sx, sz, jxx, jzz
}`;

const FFTOcean = {
  ok: false, gl: null,
  wind: 6.5, windDir: 70 * Math.PI / 180, fetch: 40000, chop: 1.1, loop: 600, seed: 3,

  init(gl, link) {
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) return false;     // fall back to the procedural ripples
    try {
      this.pEvolve = link(FFT_VS, FFT_EVOLVE, 'fft.evolve');
      this.pPass = link(FFT_VS, FFT_PASS, 'fft.pass');
      this.pAsm = link(FFT_VS, FFT_ASSEMBLE, 'fft.assemble');
      const W = FFT_N, H = FFT_N * FFT_C;
      this.h0 = this.tex2D(gl.RGBA32F, W, H, this.spectrum());
      this.ping = this.target(W, H); this.pong = this.target(W, H);
      this.disp = this.texArray(); this.deriv = this.texArray();
      this.layerFB = [];
      for (let c = 0; c < FFT_C; c++) {
        const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.disp, 0, c);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, this.deriv, 0, c);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fft layer fb');
        this.layerFB.push(fb);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.vao = gl.createVertexArray();
      this.ok = true;
    } catch (e) { console.warn('FFT ocean disabled:', e.message); this.ok = false; }
    return this.ok;
  },

  tex2D(fmt, w, h, data) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  },
  target(w, h) {
    const gl = this.gl, A = this.tex2D(gl.RGBA32F, w, h), B = this.tex2D(gl.RGBA32F, w, h), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, A, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, B, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('fft target fb');
    return { A, B, fb };
  },
  texArray() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, FFT_LOGN + 1, gl.RGBA16F, FFT_N, FFT_N, FFT_C);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  },

  /* h0(k) for every cascade: (h0(k), conj(h0(-k))) — the wind-sea spectrum, as in web-ocean */
  spectrum() {
    const N = FFT_N, G = 9.81, out = new Float32Array(N * N * FFT_C * 4);
    const U = this.wind, F = this.fetch, gamma = 3.3;
    const alpha = 0.076 * Math.pow(U * U / (F * G), 0.22), wp = 22 * Math.pow(G * G / (U * F), 1 / 3);
    const omega = (k) => Math.sqrt(G * k + 7.4e-5 * k * k * k);
    const dOmega = (k) => (G + 3 * 7.4e-5 * k * k) / (2 * omega(k));
    const jonswap = (w) => {
      const sigma = w <= wp ? 0.07 : 0.09, d = (w - wp) / (sigma * wp), q = wp / w;
      return alpha * G * G / Math.pow(w, 5) * Math.exp(-1.25 * q * q * q * q) * Math.pow(gamma, Math.exp(-0.5 * d * d));
    };
    const spread = (theta, w) => {                       // Donelan–Banner
      const r = w / wp;
      const beta = r < 0.95 ? 2.61 * Math.pow(r, 1.3) : r < 1.6 ? 2.28 * Math.pow(r, -1.3) : Math.pow(10, -0.4 + 0.8393 * Math.exp(-0.567 * Math.log(r * r)));
      const sh = 1 / Math.cosh(clamp(beta * theta, -20, 20));
      return beta / (2 * Math.tanh(beta * Math.PI)) * sh * sh;
    };
    const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
    const L = FFT_L, kMin = [], kMax = [];
    for (let c = 0; c < FFT_C; c++) {
      kMax[c] = c < FFT_C - 1 ? TAU * 6 / L[c + 1] : Math.PI * N / L[c] * 0.98;
      kMin[c] = c === 0 ? Math.PI / L[c] : kMax[c - 1];
    }
    let s = this.seed * 7919 + 1;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const gauss = () => { const u = Math.max(rnd(), 1e-9), v = rnd(); const r = Math.sqrt(-2 * Math.log(u)); return [r * Math.cos(TAU * v), r * Math.sin(TAU * v)]; };
    const amp = (kx, kz, c) => {
      const kl = Math.hypot(kx, kz);
      if (kl < 1e-5 || kl < kMin[c] || kl >= kMax[c]) return 0;
      const w = omega(kl), S = jonswap(w) * spread(wrap(Math.atan2(kz, kx) - this.windDir), w) * dOmega(kl) / kl;
      const dk = TAU / L[c];
      return Math.sqrt(Math.max(S * Math.exp(-kl * kl * 0.0012 * 0.0012), 0)) * dk * 0.5;
    };
    const noise = [];
    for (let i = 0; i < N * N * FFT_C; i++) noise.push(gauss());
    let varSum = 0;
    for (let c = 0; c < FFT_C; c++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const nx = x >= N / 2 ? x - N : x, ny = y >= N / 2 ? y - N : y, kk = TAU / L[c];
      const mx = (N - x) % N, my = (N - y) % N;
      const a = noise[(c * N + y) * N + x], A = amp(nx * kk, ny * kk, c);
      const b = noise[(c * N + my) * N + mx], B = amp(-nx * kk, -ny * kk, c);
      const o = ((c * N + y) * N + x) * 4;
      out[o] = a[0] * A; out[o + 1] = a[1] * A; out[o + 2] = b[0] * B; out[o + 3] = -b[1] * B;
      varSum += (A * A + B * B);
    }
    this.hs = 4 * Math.sqrt(varSum);                     // rough significant wave height of the chop
    return out;
  },

  /* run the simulation for time t; leaves GL with no framebuffer bound */
  update(t) {
    if (!this.ok) return;
    const gl = this.gl, W = FFT_N, H = FFT_N * FFT_C;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.viewport(0, 0, W, H);
    let src = this.ping, dst = this.pong;
    // evolve → src
    let p = this.pEvolve; gl.useProgram(p.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, src.fb);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.h0); gl.uniform1i(p.uH0, 0);
    gl.uniform1f(p.uTime, t % this.loop); gl.uniform1f(p.uChop, this.chop); gl.uniform1f(p.uLoop, this.loop);
    gl.uniform4f(p.uL, FFT_L[0], FFT_L[1], FFT_L[2], FFT_L[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // inverse FFT: rows, then columns
    p = this.pPass; gl.useProgram(p.p); gl.uniform1i(p.uA, 0); gl.uniform1i(p.uB, 1);
    for (const horiz of [1, 0]) for (let size = 2; size <= FFT_N; size *= 2) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.A);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src.B);
      gl.uniform1i(p.uSize, size); gl.uniform1i(p.uHoriz, horiz);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const tmp = src; src = dst; dst = tmp;
    }
    // assemble each cascade into its layer, then mipmap
    p = this.pAsm; gl.useProgram(p.p); gl.uniform1i(p.uA, 0); gl.uniform1i(p.uB, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.A);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src.B);
    gl.viewport(0, 0, FFT_N, FFT_N);
    for (let c = 0; c < FFT_C; c++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.layerFB[c]);
      gl.uniform1i(p.uC, c);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.disp); gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.deriv); gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
  },

  /* bind for the water shader: disp on unit 2, deriv on unit 3 */
  bind(p) {
    const gl = this.gl;
    gl.uniform1f(p.uFFT, this.ok ? 1 : 0);
    if (!this.ok) return;
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.disp); gl.uniform1i(p.uDisp, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.deriv); gl.uniform1i(p.uDeriv, 3);
    gl.uniform4f(p.uInvL, 1 / FFT_L[0], 1 / FFT_L[1], 1 / FFT_L[2], 1 / FFT_L[3]);
    gl.uniform4f(p.uTexel, FFT_L[0] / FFT_N, FFT_L[1] / FFT_N, FFT_L[2] / FFT_N, FFT_L[3] / FFT_N);
    gl.activeTexture(gl.TEXTURE0);
  }
};
