/* =====================================================================
   gfx.js — hand-written WebGL2 for the surf game.
   One pass: sky → land → ocean → rider → spray. The ocean is rebuilt on
   the CPU every frame by sweeping the wave profiles (ocean.js) along x, so
   the barrel can overhang — a heightfield can't curl.
   ===================================================================== */
'use strict';

const GLSL_COMMON = `
precision highp float;
uniform vec3 uSun; uniform vec3 uCam; uniform float uTime;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec3 skyCol(vec3 d){
  float y = d.y;
  vec3 zen = vec3(0.13, 0.30, 0.56), hor = vec3(1.0, 0.76, 0.55);
  vec3 c = mix(hor, zen, pow(clamp(y, 0.0, 1.0), 0.48));
  vec3 flat_ = normalize(vec3(d.x, 0.0, d.z) + 1e-5);
  float sd = max(dot(flat_, normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
  c = mix(c, vec3(1.0, 0.58, 0.36), pow(sd, 4.0) * 0.5 * (1.0 - clamp(y * 2.5, 0.0, 1.0)));
  float s = max(dot(d, uSun), 0.0);
  c += vec3(1.0, 0.78, 0.5) * pow(s, 14.0) * 0.4;
  c += vec3(1.0, 0.93, 0.78) * smoothstep(0.99955, 0.99975, s) * 5.0;
  if (y < 0.0) c = mix(hor * 0.8, vec3(0.06, 0.2, 0.28), clamp(-y * 5.0, 0.0, 1.0));
  return c;
}
vec3 fogged(vec3 c, vec3 P){
  vec3 D = P - uCam; float d = length(D); vec3 V = D / d;
  float f = 1.0 - exp(-max(d - 50.0, 0.0) * 0.0021);
  return mix(c, skyCol(normalize(vec3(V.x, max(V.y, 0.015), V.z))), f);
}
vec3 tone(vec3 c){ c = max(c, 0.0); return c / (1.0 + 0.16 * c) * 1.12; }
`;

const VS_SKY = `
out vec2 vUV;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2.0 - 1.0, 0.9999, 1.0); }`;
const FS_SKY = GLSL_COMMON + `
in vec2 vUV; uniform vec3 uFwd, uRight, uUp; out vec4 o;
void main(){
  // view ray from the camera basis (inverting the projection in fp32 is too noisy)
  vec2 n = vUV * 2.0 - 1.0;
  vec3 d = normalize(uFwd + n.x * uRight + n.y * uUp);
  vec3 c = skyCol(d);
  if (d.y > 0.0) {                       // streaky sunset clouds
    vec2 q = d.xz / (d.y + 0.08) * 1.6 + vec2(uTime * 0.01, 0.0);
    float n = vnoise(q * vec2(0.5, 1.6)) * 0.6 + vnoise(q * vec2(1.1, 3.3)) * 0.3 + vnoise(q * 4.0) * 0.1;
    float cl = smoothstep(0.55, 0.85, n) * smoothstep(0.0, 0.12, d.y) * (1.0 - smoothstep(0.25, 0.6, d.y));
    float sd = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 3.0);
    c = mix(c, mix(vec3(0.95, 0.55, 0.5), vec3(1.0, 0.82, 0.6), sd), cl * 0.75);
  }
  o = vec4(tone(c), 1.0);
}`;

const VS_WATER = `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aAux;
uniform mat4 uVP; out vec3 vP; out vec3 vN; out vec2 vA;
void main(){ vP = aPos; vN = aNrm; vA = aAux; gl_Position = uVP * vec4(aPos, 1.0); }`;
const FS_WATER = GLSL_COMMON + `
in vec3 vP; in vec3 vN; in vec2 vA; out vec4 o;
float rip(vec2 q){ return vnoise(q * 1.3 + vec2(uTime * 0.5, uTime * 0.3)) + 0.5 * vnoise(q * 3.7 - vec2(uTime * 0.8, -uTime * 0.2)); }
void main(){
  vec3 V = normalize(uCam - vP);
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.0) N = -N;
  float dist = length(uCam - vP);
  float e = 0.12, r0 = rip(vP.xz);
  vec2 g = vec2(rip(vP.xz + vec2(e, 0)) - r0, rip(vP.xz + vec2(0, e)) - r0) / e;
  N = normalize(N - vec3(g.x, 0.0, g.y) * 0.05 / (1.0 + dist * 0.02));
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 refl = skyCol(normalize(vec3(R.x, abs(R.y), R.z)));
  float thin = vA.y, lit = max(dot(N, uSun), 0.0);
  vec3 deep = vec3(0.02, 0.12, 0.17), face = vec3(0.05, 0.33, 0.37);
  // water drawn up the face: streaks stretched along the wave, crawling upward
  float streak = vnoise(vec2(vP.x * 0.35 + vP.z * 0.1, vP.y * 2.6 - uTime * 1.6)) * 0.6 + vnoise(vec2(vP.x * 1.1, vP.y * 6.0 - uTime * 2.4)) * 0.4;
  float onWave = smoothstep(0.25, 1.2, vP.y);
  vec3 body = mix(deep, face, clamp(thin * 0.75 + 0.2 * vP.y, 0.0, 1.0)) * (0.75 + 0.35 * lit);
  body *= 1.0 + onWave * (streak - 0.5) * 0.45;
  float back = pow(max(dot(-V, uSun), 0.0), 2.0);
  body += thin * vec3(0.12, 0.52, 0.42) * (0.3 + 1.3 * back + 0.4 * lit);   // sun through the lip
  vec3 col = mix(body, refl, fres * 0.9);
  col += vec3(1.0, 0.82, 0.55) * pow(max(dot(R, uSun), 0.0), 260.0) * 4.0;
  // foam: noisy, stretched along the wave, crawling with the water
  float fn = vnoise(vec2(vP.x * 0.55, vP.z * 0.9 + vP.y * 0.7) + vec2(0.0, -uTime * 0.8)) * 0.6
           + vnoise(vP.xz * 2.7 + vec2(vP.y * 2.0, uTime * 0.4)) * 0.4;
  float f = vA.x;
  float fm = smoothstep(0.42, 0.62, f + (fn - 0.5) * 0.75) * smoothstep(0.02, 0.15, f);
  vec3 foamC = vec3(0.94, 0.96, 0.95) * (0.6 + 0.4 * lit) + vec3(0.15, 0.08, 0.02) * back;
  col = mix(col, foamC, fm);
  o = vec4(tone(fogged(col, vP)), 1.0);
}`;

const VS_LIT = `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol;
uniform mat4 uVP; uniform mat4 uModel; out vec3 vP; out vec3 vN; out vec3 vC;
void main(){ vec4 p = uModel * vec4(aPos, 1.0); vP = p.xyz; vN = mat3(uModel) * aNrm; vC = aCol; gl_Position = uVP * p; }`;
const FS_LIT = GLSL_COMMON + `
in vec3 vP; in vec3 vN; in vec3 vC; uniform vec3 uTint; uniform float uWet; out vec4 o;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(uCam - vP);
  if (dot(N, V) < 0.0) N = -N;
  float l = max(dot(N, uSun), 0.0);
  vec3 alb = vC * uTint;
  vec3 amb = mix(vec3(0.42, 0.34, 0.33), vec3(0.32, 0.45, 0.62), N.y * 0.5 + 0.5);
  vec3 c = alb * (amb * 0.75 + vec3(1.0, 0.8, 0.6) * l * 1.05);
  vec3 H = normalize(V + uSun);
  c += vec3(1.0, 0.85, 0.65) * pow(max(dot(N, H), 0.0), 40.0) * uWet * 0.8;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  c += vec3(1.0, 0.7, 0.45) * rim * 0.25 * max(dot(-V, uSun), 0.0);
  if (vP.y < 0.0) c = mix(c, vec3(0.03, 0.2, 0.24), clamp(-vP.y * 0.9, 0.0, 0.85));   // underwater
  o = vec4(tone(fogged(c, vP)), 1.0);
}`;

const VS_PART = `
layout(location=0) in vec4 aP; layout(location=1) in vec4 aC;
uniform mat4 uVP; uniform float uScale; out vec4 vC;
void main(){ gl_Position = uVP * vec4(aP.xyz, 1.0); gl_PointSize = clamp(aP.w * uScale / gl_Position.w, 1.0, 256.0); vC = aC; }`;
const FS_PART = `
precision highp float; in vec4 vC; out vec4 o;
void main(){ vec2 d = gl_PointCoord * 2.0 - 1.0; float r = dot(d, d); if (r > 1.0) discard;
  float a = vC.a * (1.0 - r) * (1.0 - r); o = vec4(vC.rgb * a, a); }`;

/* ---------------- tiny geometry helpers (pos3 nrm3 col3) ---------------- */
function G() { return { v: [], i: [] }; }
function gV(g, x, y, z, nx, ny, nz, r, gg, b) { g.v.push(x, y, z, nx, ny, nz, r, gg, b); return g.v.length / 9 - 1; }
function gBox(g, col) {                // unit cube centred at origin
  const F = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const n of F) {
    const u = n[1] ? [1, 0, 0] : [0, 1, 0], w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const b = g.v.length / 9;
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
      gV(g, (n[0] + u[0] * s + w[0] * t) / 2, (n[1] + u[1] * s + w[1] * t) / 2, (n[2] + u[2] * s + w[2] * t) / 2, n[0], n[1], n[2], col[0], col[1], col[2]);
    g.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return g;
}
function gCyl(g, seg, col) {           // unit cylinder along +Y, y∈[0,1], r=1, rounded-ish ends
  const b = g.v.length / 9;
  for (let j = 0; j <= 1; j++) for (let k = 0; k <= seg; k++) {
    const a = k / seg * TAU; gV(g, Math.cos(a), j, Math.sin(a), Math.cos(a), 0, Math.sin(a), col[0], col[1], col[2]);
  }
  for (let k = 0; k < seg; k++) { const a = b + k, c = b + seg + 1 + k; g.i.push(a, c, a + 1, a + 1, c, c + 1); }
  return g;
}
function gSphere(g, seg, col) {
  const b = g.v.length / 9, R = seg >> 1;
  for (let j = 0; j <= R; j++) for (let k = 0; k <= seg; k++) {
    const t = j / R * Math.PI, a = k / seg * TAU, x = Math.sin(t) * Math.cos(a), y = Math.cos(t), z = Math.sin(t) * Math.sin(a);
    gV(g, x, y, z, x, y, z, col[0], col[1], col[2]);
  }
  for (let j = 0; j < R; j++) for (let k = 0; k < seg; k++) {
    const a = b + j * (seg + 1) + k, c = a + seg + 1; g.i.push(a, c, a + 1, a + 1, c, c + 1);
  }
  return g;
}
/* a tube between two points, baked into g (palms) */
function gTube(g, a, b, ra, rb, seg, col) {
  const d = V3(b.x - a.x, b.y - a.y, b.z - a.z), f = V3.norm(V3(), d);
  const h = Math.abs(f.y) > 0.9 ? V3(1, 0, 0) : V3(0, 1, 0);
  const s = V3.norm(V3(), V3.cross(V3(), f, h)), t = V3.cross(V3(), s, f);
  const base = g.v.length / 9;
  for (let j = 0; j <= 1; j++) for (let k = 0; k <= seg; k++) {
    const an = k / seg * TAU, c = Math.cos(an), sn = Math.sin(an), r = j ? rb : ra, p = j ? b : a;
    const nx = s.x * c + t.x * sn, ny = s.y * c + t.y * sn, nz = s.z * c + t.z * sn;
    gV(g, p.x + nx * r, p.y + ny * r, p.z + nz * r, nx, ny, nz, col[0], col[1], col[2]);
  }
  for (let k = 0; k < seg; k++) { const x = base + k, y = base + seg + 1 + k; g.i.push(x, y, x + 1, x + 1, y, y + 1); }
}

/* the board: a lens-shaped shortboard along +Z (nose), ~1.85 m */
function gBoard(deck, rail) {
  const g = G(), N = 28, C = 10, L = 0.93;
  const half = (u) => u > 0                        // u ∈ [-1,1] tail → nose: pulled-in nose, squash tail
    ? 0.255 * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.25 * u)
    : 0.255 * (1 - 0.37 * u * u);
  const rocker = (u) => 0.11 * Math.pow(Math.max(u, 0), 3) + 0.03 * Math.pow(Math.max(-u, 0), 2);
  const rows = [];
  for (let k = 0; k <= N; k++) {
    const u = -0.985 + 1.965 * k / N, w = Math.max(half(u), 0.004), th = 0.035 * (1 - 0.6 * u * u), y0 = rocker(u);
    const ring = [];
    for (let c = 0; c <= C; c++) {               // deck: c=0..C left→right over the top
      const a = Math.PI * c / C, x = -Math.cos(a) * w, y = y0 + Math.sin(a) * th + th * 0.2;
      ring.push([x, y, u * L, -Math.cos(a) * 0.4, Math.sin(a) + 0.2, 0, 1]);
    }
    for (let c = 1; c < C; c++) {                // hull: back underneath
      const a = Math.PI * c / C, x = Math.cos(a) * w, y = y0 - Math.sin(a) * th * 0.35;
      ring.push([x, y, u * L, Math.cos(a) * 0.3, -1, 0, 0]);
    }
    rows.push(ring);
  }
  const M = rows[0].length;
  for (let k = 0; k <= N; k++) for (let c = 0; c < M; c++) {
    const p = rows[k][c], stripe = p[6] && Math.abs(p[0]) < 0.03 ? 0.75 : 1;
    const col = p[6] ? deck.map(v => v * stripe) : rail;
    const l = Math.hypot(p[3], p[4], p[5]);
    gV(g, p[0], p[1], p[2], p[3] / l, p[4] / l, p[5] / l, col[0], col[1], col[2]);
  }
  for (let k = 0; k < N; k++) for (let c = 0; c < M; c++) {
    const a = k * M + c, b = k * M + (c + 1) % M, d = a + M, e = b + M;
    g.i.push(a, d, b, b, d, e);
  }
  // three fins
  for (const [x, z, s] of [[0, -0.84, 1], [-0.16, -0.72, 0.85], [0.16, -0.72, 0.85]]) {
    const b = g.v.length / 9, fc = [0.2, 0.22, 0.25];
    gV(g, x, 0, z + 0.06, 1, 0, 0, ...fc); gV(g, x, 0, z - 0.06 * s, 1, 0, 0, ...fc); gV(g, x, -0.12 * s, z - 0.09 * s, 1, 0, 0, ...fc);
    g.i.push(b, b + 1, b + 2);
  }
  return g;
}

/* ---------------- land ---------------- */
/* The coast is straight and repeats every LAND_P metres along x; the land mesh is
   re-centred under the camera by whole periods, so the shoreline never ends. */
const LAND_P = 480, LK = TAU / LAND_P;
function landH(x, z) {
  z -= SEA.SHORE - 9;                         // shape authored with the waterline near z = 9
  let y = -3;
  if (z > -16) y = Math.max(y, -1.7 + (z + 16) * 0.075);
  y += smoothstep(34, 70, z) * 2.4 * (1 + 0.4 * Math.sin(x * LK * 4));
  y += smoothstep(120, 280, z) * (34 + 24 * Math.sin(x * LK + 1) + 12 * Math.sin(x * LK * 2 + 0.4));
  return y;
}
function landCol(x, y, z, slope) {
  z -= SEA.SHORE - 9;
  const wet = [0.5, 0.42, 0.32], dry = [0.88, 0.77, 0.58], grass = [0.38, 0.47, 0.25], hill = [0.25, 0.37, 0.24], rock = [0.42, 0.36, 0.31];
  let c = y < 0.45 ? wet : dry;
  if (y > 2.2 && z > 45) c = grass;
  if (z > 110) c = hill;
  if (slope > 0.75) c = rock;
  const n = 0.92 + 0.08 * Math.sin(x * LK * 99 + z * 0.7) * Math.sin(x * LK * 24 - z * 0.9);
  return c.map(v => v * n);
}
function buildLand() {
  const g = G();
  const xs = [], zs = [], z0 = SEA.SHORE - 30;
  for (let u = -1; u <= 1.0001; u += 1 / 90) xs.push(Math.sign(u) * (Math.abs(u) * 260 + Math.pow(Math.abs(u), 3) * 640));
  for (let u = 0; u <= 1.0001; u += 1 / 90) zs.push(z0 + Math.pow(u, 1.6) * 560);
  const W = xs.length;
  for (const z of zs) for (const x of xs) {
    const y = landH(x, z), e = 1;
    const gx = (landH(x + e, z) - landH(x - e, z)) / 2, gz = (landH(x, z + e) - landH(x, z - e)) / 2;
    const l = Math.hypot(gx, 1, gz), c = landCol(x, y, z, Math.hypot(gx, gz));
    gV(g, x, y, z, -gx / l, 1 / l, -gz / l, c[0], c[1], c[2]);
  }
  for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < W - 1; i++) {
    const a = j * W + i; g.i.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
  }
  // palms along the back of the beach: one period's worth, repeated
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const palms = [];
  for (let k = 0; k < 44; k++) palms.push([r() * LAND_P, SEA.SHORE + 29 + r() * 34, 7 + r() * 6, (r() - 0.5) * 0.5, -0.3 * r(), r]);
  const fr = palms.map(() => Array.from({ length: 16 }, r));
  for (let rep = -2; rep <= 1; rep++) palms.forEach(([px, z, hgt, lean, lz], pi) => {
    const x = px + rep * LAND_P, y0 = landH(x, z), trunk = [0.36, 0.28, 0.2], leaf = [0.17, 0.3, 0.13], f16 = fr[pi];
    let prev = V3(x, y0 - 0.3, z);
    for (let s = 1; s <= 6; s++) {
      const t = s / 6, p = V3(x + lean * hgt * t * t, y0 + hgt * t, z + lz * hgt * t * t);
      gTube(g, prev, p, 0.24 - 0.1 * t + 0.05, 0.24 - 0.1 * t, 6, trunk); prev = p;
    }
    for (let f = 0; f < 8; f++) {                      // fronds: drooping strips
      const a = f / 8 * TAU + f16[f * 2], L = 3.2 + f16[f * 2 + 1] * 1.4, dx = Math.cos(a), dz = Math.sin(a);
      const b = g.v.length / 9, segs = 5;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs, w = 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05)) + 0.05;
        const cx = prev.x + dx * L * t, cz = prev.z + dz * L * t, cy = prev.y + 0.9 * t - 2.4 * t * t;
        gV(g, cx - dz * w, cy, cz + dx * w, 0, 1, 0, ...leaf);
        gV(g, cx + dz * w, cy, cz - dx * w, 0, 1, 0, ...leaf);
      }
      for (let s = 0; s < segs; s++) { const q = b + s * 2; g.i.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    }
  });
  // a lifeguard tower every period, for scale
  for (let rep = -2; rep <= 1; rep++) {
    const x = 40 + rep * LAND_P, z = SEA.SHORE + 23, y = landH(x, z), c = [0.95, 0.9, 0.82], red = [0.85, 0.25, 0.2];
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) gTube(g, V3(x + ox, y, z + oz), V3(x + ox * 0.8, y + 2.6, z + oz * 0.8), 0.08, 0.08, 5, c);
    const b = G(); gBox(b, red);
    for (let q = 0; q < b.v.length; q += 9) { b.v[q] = b.v[q] * 2.4 + x; b.v[q + 1] = b.v[q + 1] * 1.6 + y + 3.4; b.v[q + 2] = b.v[q + 2] * 2.2 + z; }
    const o = g.v.length / 9; g.v.push(...b.v); g.i.push(...b.i.map(i => i + o));
  }
  return g;
}

/* ---------------- camera ---------------- */
const Cam = {
  pos: V3(0, 3, -60), tgt: V3(0, 0, -100), fov: 62 * Math.PI / 180,
  proj: M4(), view: M4(), vp: M4(), shake: 0, aspect: 1,
  set(aspect) {
    this.fov = (aspect < 1 ? 74 : 62) * Math.PI / 180;     // portrait phones: see more of the wave
    m4perspective(this.proj, this.fov, aspect, 0.1, 2500);
    const s = this.shake, sx = (Math.random() - 0.5) * s, sy = (Math.random() - 0.5) * s;
    m4lookAt(this.view, this.pos.x + sx, this.pos.y + sy, this.pos.z, this.tgt.x + sx, this.tgt.y + sy, this.tgt.z, 0, 1, 0);
    m4mul(this.vp, this.proj, this.view);
    this.aspect = aspect;
  }
};

/* ---------------- spray particles ---------------- */
const Fx = {
  MAX: 2400, n: 0, p: null,  // per particle: x y z vx vy vz life max size r g b a drag grav
  init() { this.p = new Float32Array(this.MAX * 15); this.data = new Float32Array(this.MAX * 8); },
  emit(x, y, z, vx, vy, vz, life, size, r = 1, g = 1, b = 1, a = 0.8, drag = 1.2, grav = 1) {
    if (this.n >= this.MAX) return;
    const o = this.n++ * 15, P = this.p;
    P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = vx; P[o + 4] = vy; P[o + 5] = vz;
    P[o + 6] = life; P[o + 7] = life; P[o + 8] = size; P[o + 9] = r; P[o + 10] = g; P[o + 11] = b; P[o + 12] = a; P[o + 13] = drag; P[o + 14] = grav;
  },
  update(dt) {
    const P = this.p;
    for (let i = 0; i < this.n; i++) {
      const o = i * 15;
      P[o + 6] -= dt;
      if (P[o + 6] <= 0) { this.n--; if (i < this.n) { P.copyWithin(o, this.n * 15, this.n * 15 + 15); i--; } continue; }
      const d = Math.exp(-P[o + 13] * dt);
      P[o + 3] *= d; P[o + 5] *= d; P[o + 4] = P[o + 4] * d - SEA.G * P[o + 14] * dt;
      P[o] += P[o + 3] * dt; P[o + 1] += P[o + 4] * dt; P[o + 2] += P[o + 5] * dt;
    }
  },
  fill() {
    const P = this.p, D = this.data;
    for (let i = 0; i < this.n; i++) {
      const o = i * 15, q = i * 8, t = P[o + 6] / P[o + 7];
      D[q] = P[o]; D[q + 1] = P[o + 1]; D[q + 2] = P[o + 2]; D[q + 3] = P[o + 8] * (1.6 - 0.6 * t);
      D[q + 4] = P[o + 9]; D[q + 5] = P[o + 10]; D[q + 6] = P[o + 11]; D[q + 7] = P[o + 12] * Math.min(1, t * 2.5);
    }
    return this.n;
  }
};

/* ---------------- the renderer ---------------- */
const Gfx = {
  gl: null, canvas: null, w: 1, h: 1, dpr: 1,
  prog: {}, mesh: {},
  sun: V3.norm(V3(), V3(0.38, 0.2, -1)),
  oc: null,

  init(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.prog.sky = this.link(VS_SKY, FS_SKY, 'sky');
    this.prog.water = this.link(VS_WATER, FS_WATER, 'water');
    this.prog.lit = this.link(VS_LIT, FS_LIT, 'lit');
    this.prog.part = this.link(VS_PART, FS_PART, 'part');
    this.mesh.land = this.upload(buildLand());
    this.mesh.box = this.upload(gBox(G(), [1, 1, 1]));
    this.mesh.cyl = this.upload(gCyl(G(), 10, [1, 1, 1]));
    this.mesh.sph = this.upload(gSphere(G(), 14, [1, 1, 1]));
    this.mesh.board = this.upload(gBoard([0.98, 0.95, 0.88], [0.95, 0.45, 0.2]));
    this.initOcean();
    // far sea: a big flat ring under/around the swept mesh
    const f = [], S = 6000, y = -1.2;
    for (const [x, z] of [[-S, -S], [S, -S], [S, S], [-S, S]]) f.push(x, y, z, 0, 1, 0, 0, 0);
    this.mesh.far = this.uploadWater(new Float32Array(f), new Uint32Array([0, 1, 2, 0, 2, 3]));
    Fx.init();
    this.partVao = gl.createVertexArray(); gl.bindVertexArray(this.partVao);
    this.partBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
    gl.bufferData(gl.ARRAY_BUFFER, Fx.data.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    this.resize();
  },
  compile(type, src, name) {
    const gl = this.gl, s = gl.createShader(type);
    gl.shaderSource(s, '#version 300 es\n' + src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader ' + name + ': ' + gl.getShaderInfoLog(s));
    return s;
  },
  link(vs, fs, name) {
    const gl = this.gl, p = gl.createProgram();
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs, name + '.vs'));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs, name + '.fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link ' + name + ': ' + gl.getProgramInfoLog(p));
    const u = { p };
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name] = gl.getUniformLocation(p, a.name); }
    return u;
  },
  upload(geo) {
    const gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.v), gl.STATIC_DRAW);
    for (let k = 0; k < 3; k++) { gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k, 3, gl.FLOAT, false, 36, k * 12); }
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(geo.i), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: geo.i.length };
  },
  uploadWater(v, idx, dynamic) {
    const gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, v, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, vb, ib, count: idx.length };
  },
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const w = Math.max(1, Math.round(innerWidth * dpr)), h = Math.max(1, Math.round(innerHeight * dpr));
    if (w === this.w && h === this.h) return;
    this.canvas.width = this.w = w; this.canvas.height = this.h = h; this.dpr = dpr;
  },

  /* ---------- the swept ocean ---------- */
  initOcean() {
    const NX = 132, MAXR = 720;
    this.oc = {
      NX, MAXR, rows: 0, xs: new Float32Array(NX),
      rowWave: new Int16Array(MAXR), rowK: new Int16Array(MAXR), rowZ: new Float32Array(MAXR),
      data: new Float32Array(NX * MAXR * 8), tan: new Float32Array(NX * MAXR * 2),
      profs: [Profile(), Profile(), Profile(), Profile(), Profile(), Profile()],
      mesh: null, idxRows: -1
    };
    const o = this.oc;
    o.mesh = this.uploadWater(o.data, new Uint32Array(6), true);
  },
  buildOcean(cx, cz) {
    const o = this.oc, t = Ocean.t, NX = o.NX;
    cx = Math.round(cx / 0.5) * 0.5;
    for (let i = 0; i < NX; i++) {
      const u = (i / (NX - 1)) * 2 - 1, a = Math.abs(u);
      o.xs[i] = cx + Math.sign(u) * (a * 52 + a * a * a * 520);
    }
    // rows: a grid in z, with each wave's profile spliced in
    const zFar = cz - 520, zNear = Math.min(cz + 170, SEA.SHORE + 33);
    const waves = Ocean.waves.filter(w => w.zw + SEA.LF > zFar && w.zw - SEA.LB < zNear).sort((a, b) => a.zw - b.zw).slice(0, o.profs.length);
    let r = 0, z = zFar, wi = 0;
    const dz = (z) => clamp(0.6 + 0.024 * Math.abs(z - cz), 0.6, 16);
    while (z < zNear && r < o.MAXR - NP) {
      const w = waves[wi];
      if (w && z >= w.zw - SEA.LB - 0.4) {
        for (let k = 0; k < NP; k++, r++) { o.rowWave[r] = wi; o.rowK[r] = k; }
        z = w.zw + SEA.LF + Math.max(0.4, dz(w.zw + SEA.LF)); wi++; continue;
      }
      o.rowWave[r] = -1; o.rowZ[r] = z; r++; z += dz(z);
    }
    const R = o.rows = r, D = o.data, T = o.tan;
    // ambient swell, separably: sin(ax·x + (bz·z − w·t + ph)) from per-column and per-row trig
    if (!o.cs) { o.cs = new Float32Array(NX * 6); o.rs = new Float32Array(o.MAXR * 7); }
    for (let i = 0; i < NX; i++) for (let m = 0; m < 3; m++) {
      const a = AMB[m][1] * o.xs[i]; o.cs[i * 6 + m * 2] = Math.sin(a); o.cs[i * 6 + m * 2 + 1] = Math.cos(a);
    }
    for (let j = 0; j < R; j++) {
      if (o.rowWave[j] >= 0) continue;
      const z = o.rowZ[j]; o.rs[j * 7 + 6] = ambientK(z);
      for (let m = 0; m < 3; m++) {
        const b = AMB[m][2] * z - AMB[m][3] * t + AMB[m][4];
        o.rs[j * 7 + m * 2] = Math.sin(b); o.rs[j * 7 + m * 2 + 1] = Math.cos(b);
      }
    }
    for (let i = 0; i < NX; i++) {
      const x = o.xs[i], cs = o.cs, ci = i * 6;
      for (let k = 0; k < waves.length; k++) Ocean.profile(waves[k], x, o.profs[k]);
      for (let j = 0; j < R; j++) {
        const v = (j * NX + i) * 8, q = (j * NX + i) * 2;
        const wv = o.rowWave[j];
        if (wv < 0) {                     // open water
          const rs = o.rs, rj = j * 7, kk = rs[rj + 6];
          let am = 0, dam = 0;
          if (kk > 0) for (let m = 0; m < 3; m++) {
            const sA = cs[ci + m * 2], cA = cs[ci + m * 2 + 1], sB = rs[rj + m * 2], cB = rs[rj + m * 2 + 1];
            am += AMB[m][0] * (sA * cB + cA * sB);
            dam += AMB[m][0] * AMB[m][2] * (cA * cB - sA * sB);
          }
          D[v] = x; D[v + 1] = am * kk; D[v + 2] = o.rowZ[j]; D[v + 6] = 0; D[v + 7] = 0;
          const l = Math.sqrt(1 + dam * kk * dam * kk); T[q] = 1 / l; T[q + 1] = dam * kk / l;
        } else {                          // a wave's profile (no ambient over the waves)
          const P = o.profs[wv], k = o.rowK[j];
          D[v] = x; D[v + 1] = P.y[k]; D[v + 2] = P.z[k]; D[v + 6] = P.foam[k]; D[v + 7] = P.thin[k];
          T[q] = P.tz[k]; T[q + 1] = P.ty[k];
        }
      }
    }
    // normals: cross(profile tangent, across-columns difference)
    for (let j = 0; j < R; j++) for (let i = 0; i < NX; i++) {
      const v = (j * NX + i) * 8, q = (j * NX + i) * 2;
      const a = (j * NX + Math.max(i - 1, 0)) * 8, b = (j * NX + Math.min(i + 1, NX - 1)) * 8;
      const ax = D[b] - D[a], ay = D[b + 1] - D[a + 1], az = D[b + 2] - D[a + 2];
      const sz = T[q], sy = T[q + 1];      // s = (0, sy, sz)
      let nx = sy * az - sz * ay, ny = sz * ax, nz = -sy * ax;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      D[v + 3] = nx / l; D[v + 4] = ny / l; D[v + 5] = nz / l;
    }
    const gl = this.gl, m = o.mesh;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vb);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, D, 0, R * NX * 8);
    if (o.idxRows !== R) {
      const idx = new Uint32Array((R - 1) * (NX - 1) * 6);
      let n = 0;
      for (let j = 0; j < R - 1; j++) for (let i = 0; i < NX - 1; i++) {
        const a = j * NX + i, b = a + NX;
        idx[n++] = a; idx[n++] = b; idx[n++] = a + 1; idx[n++] = a + 1; idx[n++] = b; idx[n++] = b + 1;
      }
      gl.bindVertexArray(m.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);
      m.count = idx.length; o.idxRows = R;
    }
  },

  common(p) {
    const gl = this.gl;
    gl.useProgram(p.p);
    if (p.uVP) gl.uniformMatrix4fv(p.uVP, false, Cam.vp);
    if (p.uSun) gl.uniform3f(p.uSun, this.sun.x, this.sun.y, this.sun.z);
    if (p.uCam) gl.uniform3f(p.uCam, Cam.pos.x, Cam.pos.y, Cam.pos.z);
    if (p.uTime) gl.uniform1f(p.uTime, Ocean.t);
  },

  _m: M4(), _m2: M4(), _id: M4(), _landM: M4(),
  part(mesh, local, base, col) {
    const gl = this.gl, p = this.prog.lit;
    m4mul(this._m2, base, local);
    gl.uniformMatrix4fv(p.uModel, false, this._m2);
    gl.uniform3f(p.uTint, col[0], col[1], col[2]);
    gl.bindVertexArray(mesh.vao); gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
  },

  frame(S) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.w, this.h);
    Cam.set(this.w / this.h);
    this.buildOcean(Cam.pos.x, Cam.pos.z);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    // sky
    let p = this.prog.sky; this.common(p);
    {   // camera basis rows of the view matrix, scaled to the frustum
      const v = Cam.view, ty = Math.tan(Cam.fov / 2), tx = ty * Cam.aspect;
      gl.uniform3f(p.uRight, v[0] * tx, v[4] * tx, v[8] * tx);
      gl.uniform3f(p.uUp, v[1] * ty, v[5] * ty, v[9] * ty);
      gl.uniform3f(p.uFwd, -v[2], -v[6], -v[10]);
    }
    gl.depthMask(false); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.depthMask(true);
    // land
    p = this.prog.lit; this.common(p);
    gl.uniform1f(p.uWet, 0);
    m4ident(this._landM); this._landM[12] = Math.round(Cam.pos.x / LAND_P) * LAND_P;   // follow by whole periods
    this.part(this.mesh.land, this._landM, this._id, [1, 1, 1]);
    // ocean
    p = this.prog.water; this.common(p);
    gl.bindVertexArray(this.mesh.far.vao); gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(this.oc.mesh.vao); gl.drawElements(gl.TRIANGLES, this.oc.mesh.count, gl.UNSIGNED_INT, 0);
    // rider
    p = this.prog.lit; this.common(p);
    if (S) this.drawRider(S);
    // spray
    const n = Fx.fill();
    if (n) {
      p = this.prog.part; this.common(p);
      gl.uniform1f(p.uScale, this.h * 0.5 / Math.tan(Cam.fov / 2));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, Fx.data, 0, n * 8);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.bindVertexArray(this.partVao); gl.drawArrays(gl.POINTS, 0, n);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  },

  /* ---------- the surfer ---------- */
  _L: M4(), _B: M4(), _bx: V3(), _by: V3(), _bz: V3(),
  drawRider(S) {
    const gl = this.gl, p = this.prog.lit;
    gl.uniform1f(p.uWet, 1);
    const suit = [0.07, 0.08, 0.1], skin = [0.78, 0.55, 0.4], hair = [0.25, 0.17, 0.1], trim = [0.1, 0.55, 0.75];
    // board frame: Z = nose, Y = deck normal
    const B = this._B, X = this._bx, Y = this._by, Z = this._bz;
    V3.set(Y, S.up.x, S.up.y, S.up.z);
    V3.set(Z, S.fwd.x, S.fwd.y, S.fwd.z);
    V3.cross(X, Y, Z); V3.norm(X, X); V3.cross(Z, X, Y);
    m4axes(B, X, Y, Z, S.bpos.x, S.bpos.y, S.bpos.z, 1);
    this.part(this.mesh.board, this._id, B, [1, 1, 1]);
    // the body has its own frame (separates from the board in a wipeout)
    if (S.bodyM) m4axes(B, S.bodyM.X, S.bodyM.Y, S.bodyM.Z, S.bodyM.p.x, S.bodyM.p.y, S.bodyM.p.z, 1);
    const J = S.pose;            // joints in body-local metres
    const L = this._L;
    const limb = (a, b, r, col) => { m4limb(L, a[0], a[1], a[2], b[0], b[1], b[2], r); this.part(this.mesh.cyl, L, B, col); };
    const ball = (c, r, col, sy = 1) => {
      m4ident(L); L[0] = r; L[5] = r * sy; L[10] = r; L[12] = c[0]; L[13] = c[1]; L[14] = c[2];
      this.part(this.mesh.sph, L, B, col);
    };
    limb(J.hip, J.chest, 0.15, suit);
    ball(J.chest, 0.17, suit, 1.1); ball(J.hip, 0.15, suit);
    limb(J.chest, J.neck, 0.06, skin);
    ball(J.head, 0.12, skin, 1.1); ball([J.head[0] + J.hairOff[0], J.head[1] + J.hairOff[1], J.head[2] + J.hairOff[2]], 0.115, hair);
    for (const s of [0, 1]) {
      limb(J.sh[s], J.el[s], 0.055, suit); limb(J.el[s], J.ha[s], 0.045, s ? trim : suit); ball(J.ha[s], 0.05, skin);
      ball(J.el[s], 0.055, suit);
      limb(J.hp[s], J.kn[s], 0.085, suit); limb(J.kn[s], J.ft[s], 0.065, suit); ball(J.kn[s], 0.08, suit);
      ball(J.ft[s], 0.06, skin, 0.7);
    }
    gl.uniform1f(p.uWet, 0);
  }
};
