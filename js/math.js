/* =====================================================================
   math.js — the only "library" this game uses: 3x3/4x4 matrices,
   vec3 helpers and a few scalar utilities. Column-major mat4 (Float32Array)
   so it can be uploaded straight to WebGL.
   ===================================================================== */
'use strict';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const sstep = smoothstep;
// frame-rate independent exponential smoothing
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const sign = (v) => v < 0 ? -1 : 1;

/* ---------------- vec3 (plain objects: {x,y,z}) ---------------- */
function V3(x = 0, y = 0, z = 0) { return { x, y, z }; }
V3.set = function (o, x, y, z) { o.x = x; o.y = y; o.z = z; return o; };
V3.copy = function (o, a) { o.x = a.x; o.y = a.y; o.z = a.z; return o; };
V3.add = function (o, a, b) { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o; };
V3.sub = function (o, a, b) { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; };
V3.scale = function (o, a, s) { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o; };
V3.dot = function (a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; };
V3.cross = function (o, a, b) {
  const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
  o.x = ay * bz - az * by; o.y = az * bx - ax * bz; o.z = ax * by - ay * bx; return o;
};
V3.len = function (a) { return Math.hypot(a.x, a.y, a.z); };
V3.dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); };
V3.norm = function (o, a) {
  const l = Math.hypot(a.x, a.y, a.z);
  if (l > 1e-8) { o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; }
  else { o.x = 0; o.y = 1; o.z = 0; }
  return o;
};
V3.lerp = function (o, a, b, t) { o.x = lerp(a.x, b.x, t); o.y = lerp(a.y, b.y, t); o.z = lerp(a.z, b.z, t); return o; };

/* ---------------- mat4 (column-major) ---------------- */
function M4() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function m4ident(o) {
  o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o;
}

function m4mul(o, a, b) { // o = a * b
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    o[i * 4]     = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    o[i * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    o[i * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    o[i * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return o;
}

function m4perspective(o, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  o.fill(0);
  o[0] = f / aspect; o[5] = f;
  o[10] = (far + near) * nf;
  o[11] = -1;
  o[14] = 2 * far * near * nf;
  return o;
}

function m4ortho(o, l, r, b, t, n, f) {
  o.fill(0);
  o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = 2 / (n - f);
  o[12] = (l + r) / (l - r); o[13] = (t + b) / (b - t); o[14] = (f + n) / (n - f); o[15] = 1;
  return o;
}

const _la_t = V3();
function m4lookAt(o, ex, ey, ez, cx, cy, cz, upx, upy, upz) {
  let zx = ex - cx, zy = ey - cy, zz = ez - cz;      // camera looks down -Z
  let l = Math.hypot(zx, zy, zz); if (l < 1e-9) { zz = 1; l = 1; }
  zx /= l; zy /= l; zz /= l;
  let xx = upy * zz - upz * zy, xy = upz * zx - upx * zz, xz = upx * zy - upy * zx;
  l = Math.hypot(xx, xy, xz);
  if (l < 1e-6) { xx = 1; xy = 0; xz = 0; } else { xx /= l; xy /= l; xz /= l; }
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * ex + xy * ey + xz * ez);
  o[13] = -(yx * ex + yy * ey + yz * ez);
  o[14] = -(zx * ex + zy * ey + zz * ez);
  o[15] = 1;
  return o;
}

function m4invert(o, a) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
        a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
        a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
        a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return m4ident(o);
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b06 - a10 * b09 - a12 * b05) * det;
  o[13] = (a00 * b09 - a01 * b06 + a02 * b05) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}

/* Build a rigid matrix from an orthonormal basis (columns = images of X,Y,Z). */
function m4basis(o, r, u, f, px, py, pz) {
  o[0] = r.x; o[1] = r.y; o[2] = r.z; o[3] = 0;
  o[4] = u.x; o[5] = u.y; o[6] = u.z; o[7] = 0;
  o[8] = -f.x; o[9] = -f.y; o[10] = -f.z; o[11] = 0; // local forward is -Z (GL convention)
  o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
  return o;
}

/* Set a matrix directly from three basis vectors (columns = images of X,Y,Z).
   NOTE: X,Y,Z must form a RIGHT-HANDED frame (Z = X × Y) or winding flips. */
function m4axes(o, X, Y, Z, px, py, pz, scale) {
  const s = scale === undefined ? 1 : scale;
  o[0] = X.x * s; o[1] = X.y * s; o[2] = X.z * s; o[3] = 0;
  o[4] = Y.x * s; o[5] = Y.y * s; o[6] = Y.z * s; o[7] = 0;
  o[8] = Z.x * s; o[9] = Z.y * s; o[10] = Z.z * s; o[11] = 0;
  o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
  return o;
}

/* Same, with per-axis scale. */
function m4axesS(o, X, Y, Z, px, py, pz, sx, sy, sz) {
  o[0] = X.x * sx; o[1] = X.y * sx; o[2] = X.z * sx; o[3] = 0;
  o[4] = Y.x * sy; o[5] = Y.y * sy; o[6] = Y.z * sy; o[7] = 0;
  o[8] = Z.x * sz; o[9] = Z.y * sz; o[10] = Z.z * sz; o[11] = 0;
  o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
  return o;
}

/* Stretch a unit +Y cylinder to span a→b (used for limbs). */
function m4limb(o, ax, ay, az, bx, by, bz, thickness) {
  let fx = bx - ax, fy = by - ay, fz = bz - az;
  const len = Math.hypot(fx, fy, fz) || 1e-5;
  fx /= len; fy /= len; fz /= len;
  // arbitrary perpendicular helper
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(fy) > 0.9) { ux = 1; uy = 0; uz = 0; }
  let rxv = uy * fz - uz * fy, ryv = uz * fx - ux * fz, rzv = ux * fy - uy * fx;
  let l = Math.hypot(rxv, ryv, rzv) || 1e-5;
  rxv /= l; ryv /= l; rzv /= l;
  const uxv = fy * rzv - fz * ryv, uyv = fz * rxv - fx * rzv, uzv = fx * ryv - fy * rxv;
  o[0] = rxv * thickness; o[1] = ryv * thickness; o[2] = rzv * thickness; o[3] = 0;
  o[4] = fx * len; o[5] = fy * len; o[6] = fz * len; o[7] = 0;
  o[8] = -uxv * thickness; o[9] = -uyv * thickness; o[10] = -uzv * thickness; o[11] = 0;   // round, not a ribbon
  o[12] = ax; o[13] = ay; o[14] = az; o[15] = 1;
  return o;
}

/* Transform helpers */
function m4point(out, m, x, y, z) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  out.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  out.z = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  return out;
}
function m4dir(out, m, x, y, z) {
  out.x = m[0] * x + m[4] * y + m[8] * z;
  out.y = m[1] * x + m[5] * y + m[9] * z;
  out.z = m[2] * x + m[6] * y + m[10] * z;
  return out;
}

/* Angle difference wrapped to [-PI, PI] */
function angDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
