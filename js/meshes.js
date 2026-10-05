/* =====================================================================
   meshes.js — every mesh in the game is generated here from numbers.
   Interleaved layout: position(3) normal(3) color(3) = 9 floats/vertex.
   ===================================================================== */
'use strict';

const STRIDE = 9;

/* ---------------- rider palette slots ----------------
   Rider and board meshes carry a second vertex stream, aux = (slot, ao, v):
     slot : which outfit item the vertex belongs to (RS.*). The rider shader
            looks the colour up in Outfit.palette[slot] and the material
            (cloth / gloss / lens) in its per-slot table, so recolouring the
            outfit is just a uniform update, never a mesh rebuild.
     ao   : baked ambient occlusion, 0..1 (1 = open)
     v    : distance along the part's main axis in metres (seams, quilting)
   The vertex colour is then a multiplier on the palette colour (white = as is,
   darker = a fixed shade detail such as a seam or a sole).                  */
const RS = {
  JACKET: 0, ACCENT: 1, PANTS: 2, GLOVES: 3, HELMET: 4, LENS: 5,
  BOOTS: 6, BOARD_TOP: 7, BOARD_BASE: 8, BINDING: 9, TRIM: 10, MASK: 11
};
const RS_COUNT = 12;

/* ---------------- primitive builders ---------------- */
/* Geo({ aux: true }) also records the aux stream: set g.slot / g.ao / g.vv
   before emitting vertices (they apply to every vertex until changed). */
function Geo(opts) {
  return { v: [], i: [], aux: opts && opts.aux ? [] : null, slot: 0, ao: 1, vv: 0 };
}
function geoVert(g, x, y, z, nx, ny, nz, r, gg, b) {
  const o = g.v.length;
  g.v.push(x, y, z, nx, ny, nz, r, gg, b);
  if (g.aux) g.aux.push(g.slot, g.ao, g.vv);
  return o / STRIDE;
}
function geoTri(g, a, b, c) { g.i.push(a, b, c); }
function geoQuad(g, a, b, c, d) { g.i.push(a, b, c, a, c, d); }

/* flat-ish box */
function geoBox(g, cx, cy, cz, sx, sy, sz, col) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const P = [
    [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1]],
    [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [0, 0, -1]],
    [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [1, 0, 0]],
    [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-1, 0, 0]],
    [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 1, 0]],
    [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0]]
  ];
  for (const [p0, p1, p2, p3, n] of P) {
    const a = geoVert(g, cx + p0[0], cy + p0[1], cz + p0[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    const b = geoVert(g, cx + p1[0], cy + p1[1], cz + p1[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    const c = geoVert(g, cx + p2[0], cy + p2[1], cz + p2[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    const d = geoVert(g, cx + p3[0], cy + p3[1], cz + p3[2], n[0], n[1], n[2], col[0], col[1], col[2]);
    geoQuad(g, a, b, c, d);
  }
}

/* UV sphere (optionally squashed). */
function geoSphere(g, cx, cy, cz, r, col, seg = 12, ring = 8, squash) {
  const sq = squash || [1, 1, 1];
  const base = g.v.length / STRIDE;
  for (let j = 0; j <= ring; j++) {
    const v = j / ring, th = v * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, ph = u * TAU;
      const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
      geoVert(g, cx + nx * r * sq[0], cy + ny * r * sq[1], cz + nz * r * sq[2], nx, ny, nz, col[0], col[1], col[2]);
    }
  }
  const w = seg + 1;
  // CCW as seen from outside (normals point outward from +Y pole)
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) {
    const a = base + j * w + i, b = a + 1, c = a + w, d = c + 1;
    geoTri(g, a, b, c); geoTri(g, b, d, c);
  }
}

/* tapered cylinder along +Y from y0 to y1 */
function geoCyl(g, cx, cy0, cz, r0, r1, y1, col, seg = 10, capTop = true, capBot = false) {
  const base = g.v.length / STRIDE;
  const h = y1 - cy0;
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * TAU, ca = Math.cos(a), sa = Math.sin(a);
    const sl = Math.atan2(r0 - r1, h);
    const nx = ca * Math.cos(sl), ny = Math.sin(sl), nz = sa * Math.cos(sl);
    geoVert(g, cx + ca * r0, cy0, cz + sa * r0, nx, ny, nz, col[0], col[1], col[2]);
    geoVert(g, cx + ca * r1, y1, cz + sa * r1, nx, ny, nz, col[0], col[1], col[2]);
  }
  for (let i = 0; i < seg; i++) {
    const a = base + i * 2;
    geoQuad(g, a, a + 1, a + 3, a + 2);
  }
  if (capTop) {
    const c = geoVert(g, cx, y1, cz, 0, 1, 0, col[0], col[1], col[2]);
    const b = g.v.length / STRIDE;
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * TAU;
      geoVert(g, cx + Math.cos(a) * r1, y1, cz + Math.sin(a) * r1, 0, 1, 0, col[0], col[1], col[2]);
    }
    // viewed from +Y (outside), CCW is centre→i→i+1 with +sin(a) ring winding
    for (let i = 0; i < seg; i++) geoTri(g, c, b + i + 1, b + i);
  }
  if (capBot) {
    const c = geoVert(g, cx, cy0, cz, 0, -1, 0, col[0], col[1], col[2]);
    const b = g.v.length / STRIDE;
    for (let i = 0; i <= seg; i++) {
      const a = -i / seg * TAU;
      geoVert(g, cx + Math.cos(a) * r0, cy0, cz + Math.sin(a) * r0, 0, -1, 0, col[0], col[1], col[2]);
    }
    // this ring winds the other way (-a), so the fan needs the same order as
    // the top cap to come out pointing along the cap normal (-Y)
    for (let i = 0; i < seg; i++) geoTri(g, c, b + i + 1, b + i);
  }
}

/* ---------------- rider / board surface helpers ----------------
   Rider and board parts are lofts, grids and thin shells with smooth numeric
   normals. Triangles are wound to agree with their vertex normals, so a
   builder never has to care which way a strip runs. Points are [x, y, z]. */
const p3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const p3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const p3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const p3norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// triangle wound so its face normal agrees with the summed vertex normals; slivers are dropped
function geoTriN(g, a, b, c) {
  const V = g.v, A = a * STRIDE, B = b * STRIDE, C = c * STRIDE;
  const ux = V[B] - V[A], uy = V[B + 1] - V[A + 1], uz = V[B + 2] - V[A + 2];
  const wx = V[C] - V[A], wy = V[C + 1] - V[A + 1], wz = V[C + 2] - V[A + 2];
  const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
  if (fx * fx + fy * fy + fz * fz < 1e-16) return;
  const d = fx * (V[A + 3] + V[B + 3] + V[C + 3]) + fy * (V[A + 4] + V[B + 4] + V[C + 4]) + fz * (V[A + 5] + V[B + 5] + V[C + 5]);
  if (d < 0) g.i.push(a, c, b); else g.i.push(a, b, c);
}

/* local frame {o, X, Y, Z}: Y along `y`, Z as close to `z` as possible */
function geoFrame(o, y, z) {
  const Y = p3norm(y), Z = p3norm(p3sub(z, Y.map(v => v * p3dot(z, Y))));
  return { o, X: p3cross(Y, Z), Y, Z };
}

/* Grid surface. P[row][col] = point, A[row] = { s: slot, c: colour multiplier
   (number or rgb), ao, v }. A row whose slot differs from the row below (or
   flagged `hard`) is emitted twice so each band keeps its own attributes.
   o.wrap closes the columns into a ring; o.hint(p, j, i) is a rough outward
   direction that only picks the normal's sign; o.M = frame applied at the end. */
function geoSurf(g, P, A, o) {
  const R = P.length, C = P[0].length, wrap = !!o.wrap, M = o.M;
  const cen = (j) => { const s = [0, 0, 0]; for (const p of P[j]) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return s.map(v => v / C); };
  const axis = p3norm(p3sub(cen(R - 1), cen(0)));
  const N = [];
  let sgn = 0;
  for (let j = 0; j < R; j++) {
    N.push([]);
    for (let i = 0; i < C; i++) {
      const il = wrap ? (i + C - 1) % C : Math.max(0, i - 1), ir = wrap ? (i + 1) % C : Math.min(C - 1, i + 1);
      const du = p3sub(P[j][ir], P[j][il]);
      const dv = p3sub(P[Math.min(R - 1, j + 1)][i], P[Math.max(0, j - 1)][i]);
      const n = p3cross(dv, du);
      if (Math.hypot(n[0], n[1], n[2]) < 1e-12) { N[j].push(null); continue; }   // pole
      sgn += p3dot(p3norm(n), o.hint ? o.hint(P[j][i], j, i) : [0, 0, 0]);
      N[j].push(p3norm(n));
    }
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < C; i++) {
    if (!N[j][i]) N[j][i] = axis.map(v => v * (j === 0 ? -1 : 1));
    else if (sgn < 0) N[j][i] = N[j][i].map(v => -v);
  }
  const emit = (j, at) => {
    g.slot = at.s; g.ao = at.ao; g.vv = at.v;
    const c = typeof at.c === 'number' ? [at.c, at.c, at.c] : at.c, ids = [];
    for (let i = 0; i < C; i++) {
      let p = P[j][i], n = N[j][i];
      if (M) {
        p = [M.o[0] + M.X[0] * p[0] + M.Y[0] * p[1] + M.Z[0] * p[2], M.o[1] + M.X[1] * p[0] + M.Y[1] * p[1] + M.Z[1] * p[2], M.o[2] + M.X[2] * p[0] + M.Y[2] * p[1] + M.Z[2] * p[2]];
        n = p3norm([M.X[0] * n[0] + M.Y[0] * n[1] + M.Z[0] * n[2], M.X[1] * n[0] + M.Y[1] * n[1] + M.Z[1] * n[2], M.X[2] * n[0] + M.Y[2] * n[1] + M.Z[2] * n[2]]);
      }
      ids.push(geoVert(g, p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2]));
    }
    return ids;
  };
  const lo = [], hi = [];                          // row as the bottom / top edge of a band
  for (let j = 0; j < R; j++) {
    const a = A[j], b = A[j - 1];
    if (j > 0 && (a.hard || a.s !== b.s)) { hi[j] = emit(j, Object.assign({}, b, { v: a.v })); lo[j] = emit(j, a); }
    else hi[j] = lo[j] = emit(j, a);
  }
  for (let j = 0; j < R - 1; j++) for (let i = 0; i < (wrap ? C : C - 1); i++) {
    const i1 = (i + 1) % C, a = lo[j][i], b = lo[j][i1], c = hi[j + 1][i], d = hi[j + 1][i1];
    geoTriN(g, a, c, b); geoTriN(g, b, c, d);
  }
}

/* Elliptic loft along +Y. rings = [{ y, a (half X), b (half Z, default a),
   x, z (centre), s, c, ao, v, hard }]; s is inherited down the list. A ring
   with a = 0 closes the end. o.warp(p, t, ring, j) may move points; o.M frame. */
function rLoft(g, rings, seg, o = {}) {
  const P = [], A = [];
  let s = o.s !== undefined ? o.s : g.slot;
  rings.forEach((r, j) => {
    if (r.s !== undefined) s = r.s;
    const row = [], b = r.b !== undefined ? r.b : r.a;
    for (let i = 0; i < seg; i++) {
      const t = i / seg * TAU;
      let p = [(r.x || 0) + Math.cos(t) * r.a, r.y, (r.z || 0) + Math.sin(t) * b];
      if (o.warp) p = o.warp(p, t, r, j);
      row.push(p);
    }
    P.push(row);
    A.push({ s, c: r.c !== undefined ? r.c : 1, ao: r.ao !== undefined ? r.ao : 1, v: r.v !== undefined ? r.v : r.y, hard: !!r.hard });
  });
  geoSurf(g, P, A, { wrap: true, M: o.M, hint: (p, j) => [p[0] - (rings[j].x || 0), 0, p[2] - (rings[j].z || 0)] });
}

/* round tube along +Y for the m4limb parts: prof = [[y, radius, extra], ...];
   len = the part's length in metres, so vv comes out in metres */
function rTube(g, prof, seg, len, v0 = 0) {
  rLoft(g, prof.map(([y, r, e]) => Object.assign({ y, a: r, v: (y - v0) * len }, e)), seg);
}

/* Thin closed slab between an outer and an inner grid of the same shape:
   both faces plus the four edge walls (attributes from A, one per row). */
function geoShell(g, Po, Pi, A, M) {
  const R = Po.length, C = Po[0].length;
  geoSurf(g, Po, A, { M, hint: (p, j, i) => p3sub(Po[j][i], Pi[j][i]) });
  geoSurf(g, Pi, A, { M, hint: (p, j, i) => p3sub(Pi[j][i], Po[j][i]) });
  const wall = (pts, outs, at) => geoSurf(g, [pts.map(q => q[0]), pts.map(q => q[1])], [at, at],
    { M, hint: (p, j, i) => outs[i] });
  for (const j of [0, R - 1]) {
    const jn = j ? j - 1 : 1;
    wall(Po[j].map((p, i) => [Pi[j][i], p]), Po[j].map((p, i) => p3sub(p, Po[jn][i])), A[j]);
  }
  for (const i of [0, C - 1]) {
    const inn = i ? i - 1 : 1;
    const pts = [], outs = [];
    for (let j = 0; j < R; j++) { pts.push([Pi[j][i], Po[j][i]]); outs.push(p3sub(Po[j][i], Po[j][inn])); }
    // walls run along the rows here, so attributes are constant per wall
    geoSurf(g, [pts.map(q => q[0]), pts.map(q => q[1])], [A[0], A[0]], { M, hint: (p, jj, ii) => outs[ii] });
  }
}

/* multiply the baked AO of vertices [from, end) by fn(x, y, z) */
function bakeAO(g, from, fn) {
  for (let k = from, n = g.v.length / STRIDE; k < n; k++)
    g.aux[k * 3 + 1] *= fn(g.v[k * STRIDE], g.v[k * STRIDE + 1], g.v[k * STRIDE + 2]);
}

/* ---------------- boot shape (shared by the boot mesh and the binding straps) ----------------
   Boot frame: +X = board nose, +Y = up, +Z = toes, origin at the sole.
   Rows: [y, half X, half Z, centre Z]. The toe box is a long low ellipse, the
   shaft a short round one, so the lofted rings give a soft-boot instep. */
const BOOT_SECT = [
  [0.000, 0.050, 0.136, 0.026], [0.014, 0.058, 0.149, 0.026], [0.032, 0.061, 0.152, 0.025],
  [0.062, 0.063, 0.143, 0.022], [0.092, 0.063, 0.118, 0.010], [0.122, 0.062, 0.092, -0.004],
  [0.155, 0.062, 0.080, -0.012], [0.195, 0.064, 0.075, -0.015], [0.232, 0.067, 0.077, -0.015]
];
function bootSect(y) {
  const S = BOOT_SECT;
  let k = 0;
  while (k < S.length - 2 && S[k + 1][0] < y) k++;
  const u = clamp((y - S[k][0]) / (S[k + 1][0] - S[k][0]), 0, 1);
  return [lerp(S[k][1], S[k + 1][1], u), lerp(S[k][2], S[k + 1][2], u), lerp(S[k][3], S[k + 1][3], u)];
}
// point on the boot surface at height y, angle t (0 = +X, π/2 = toes), pushed out by `off`
function bootPt(y, t, off) {
  const [a, b, z] = bootSect(y), c = Math.cos(t), s = Math.sin(t);
  const n = p3norm([c / a, 0, s / b]);
  return [c * a + n[0] * off, y, z + s * b + n[2] * off];
}

/* ---------------- the snowboard ---------------- */
/* Local space: +X = nose, +Y = up from base, +Z = right edge. Length 1.60 */
function buildBoard() {
  const g = Geo({ aux: true });
  const L = 1.60, W = 0.15, T = 0.03;     // a real board: 160 cm, ~25 cm waist
  /* Outline: a sidecut body (widest at the contact points, narrower at the waist)
     closed by elliptical nose and tail caps, so the ends are round, not pointed.
     Samples are listed along x; caps get extra samples for a smooth curve. */
  const E = 0.17;                                  // cap length (nose/tail curve)
  const xs = [], ws = [];
  const CAP = 10, BODY = 28, xT = -L / 2 + E, xN = L / 2 - E;
  for (let k = CAP; k >= 1; k--) {                 // tail cap: tip → contact point
    const ph = k / CAP * Math.PI / 2;
    xs.push(xT - E * Math.sin(ph)); ws.push(W * Math.cos(ph));
  }
  for (let k = 0; k <= BODY; k++) {                // body with sidecut
    const u = k / BODY;
    xs.push(lerp(xT, xN, u)); ws.push(W * (1 - 0.16 * Math.sin(u * Math.PI)));
  }
  for (let k = 1; k <= CAP; k++) {                 // nose cap: contact point → tip
    const ph = k / CAP * Math.PI / 2;
    xs.push(xN + E * Math.sin(ph)); ws.push(W * Math.cos(ph));
  }
  const n = xs.length;
  const baseY = (x) => {                           // camber underfoot, rocker up into the tips
    const t = x / L + 0.5;
    const c = -0.012 * Math.sin(clamp(t, 0, 1) * Math.PI);
    const rock = 0.05 * Math.pow(sstep(0.82, 1, t), 2) + 0.045 * Math.pow(sstep(0.18, 0, t), 2);
    return c + rock;
  };
  /* top graphic as a shade multiplier on the BOARD_TOP colour: a light centre
     stripe nose to tail, a chevron near each end pointing at the nose, and
     darker tips. f = position across the board, -1..1 */
  const graphic = (x, f) => {
    const xn = x / (L / 2), af = Math.abs(f);
    let k = 0.56;
    k = lerp(k, 1.0, 1 - sstep(0.16, 0.30, af));
    for (const c of [0.50, -0.62]) k = lerp(k, 1.0, 1 - sstep(0.05, 0.10, Math.abs(xn - c + 0.32 * af)));
    k = lerp(k, 0.48, sstep(0.80, 0.92, Math.abs(xn)));
    return k;
  };
  const COLS = 7;                                  // top-surface vertices across the width
  const nearBinding = (x) => 1 - 0.18 * Math.max(sstep(0.16, 0.08, Math.abs(x - 0.27)), sstep(0.16, 0.08, Math.abs(x + 0.27)));
  g.slot = RS.BOARD_TOP; g.ao = 1;
  const top = [];
  for (let i = 0; i < n; i++) {
    const x = xs[i], w = ws[i], y = baseY(x), row = [];
    g.vv = x;
    for (let c = 0; c < COLS; c++) {
      const f = c / (COLS - 1) * 2 - 1, k = graphic(x, f);
      g.ao = nearBinding(x);
      row.push(geoVert(g, x, y + T, f * w, 0, 1, 0, k, k, k));
    }
    top.push(row);
  }
  g.slot = RS.BOARD_BASE; g.ao = 1;
  const bot = [];
  for (let i = 0; i < n; i++) {
    g.vv = xs[i];
    bot.push([geoVert(g, xs[i], baseY(xs[i]), -ws[i], 0, -1, 0, 1, 1, 1), geoVert(g, xs[i], baseY(xs[i]), ws[i], 0, -1, 0, 1, 1, 1)]);
  }
  // rail normal at sample i: outward from the outline z = ±w(x), i.e. (-dw/dx, 0, ±1)
  const slope = (i) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    return (ws[b] - ws[a]) / ((xs[b] - xs[a]) || 1e-6);
  };
  for (let i = 0; i < n - 1; i++) {
    // top surface / bottom surface (winding flipped)
    for (let c = 0; c < COLS - 1; c++) geoQuad(g, top[i][c], top[i][c + 1], top[i + 1][c + 1], top[i + 1][c]);
    geoQuad(g, bot[i][0], bot[i + 1][0], bot[i + 1][1], bot[i][1]);
  }
  g.slot = RS.TRIM; g.ao = 1;
  for (let i = 0; i < n - 1; i++) {
    // rails
    const xA = xs[i], xB = xs[i + 1], wA = ws[i], wB = ws[i + 1];
    const yA = baseY(xA), yB = baseY(xB), sA = slope(i), sB = slope(i + 1);
    for (const sgn of [-1, 1]) {
      const nA = V3.norm(V3(), V3(-sA, 0, sgn)), nB = V3.norm(V3(), V3(-sB, 0, sgn));
      const a = geoVert(g, xA, yA + T, sgn * wA, nA.x, 0.3, nA.z, 1, 1, 1);
      const b = geoVert(g, xA, yA, sgn * wA, nA.x, -0.3, nA.z, 0.8, 0.8, 0.8);
      const c = geoVert(g, xB, yB, sgn * wB, nB.x, -0.3, nB.z, 0.8, 0.8, 0.8);
      const d = geoVert(g, xB, yB + T, sgn * wB, nB.x, 0.3, nB.z, 1, 1, 1);
      if (sgn < 0) geoQuad(g, a, d, c, b); else geoQuad(g, a, b, c, d);
    }
  }
  // bindings: base plate + disc, curved highback, ankle and toe straps hugging the boot
  for (const bx of [-0.27, 0.27]) {
    const y0 = baseY(bx) + T;
    const M = { o: [bx, 0.03, 0], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };   // the boot frame (player.js puts boots at y = 0.03)
    g.slot = RS.TRIM; g.ao = 0.8; g.vv = 0;
    geoCyl(g, bx, y0, 0.02, 0.085, 0.085, y0 + 0.008, [1, 1, 1], 14, true, false);    // mounting disc
    g.slot = RS.BINDING; g.ao = 0.85;
    geoBox(g, bx, y0 + 0.014, 0.015, 0.15, 0.016, 0.33, [1, 1, 1]);                  // base plate
    const A = (c, ao) => ({ s: RS.BINDING, c, ao, v: 0 });
    // highback: wraps the heel from side to side, tallest behind the calf
    const HB = 7, HR = 4, Po = [], Pi = [], Ah = [];
    for (let r = 0; r <= HR; r++) {
      const ro = [], ri = [];
      for (let k = 0; k <= HB; k++) {
        const t = -Math.PI / 2 + (k / HB - 0.5) * 2.5;          // centred on -Z (the heel)
        const h = 0.07 + 0.17 * Math.pow(Math.cos((k / HB - 0.5) * Math.PI), 1.4);
        const y = 0.012 + h * r / HR;
        const lean = y * 0.10;                                   // forward lean against the calf
        const po = bootPt(y, t, 0.024), pi = bootPt(y, t, 0.008);
        po[2] -= lean * 0.2; pi[2] -= lean * 0.2;
        ro.push(po); ri.push(pi);
      }
      Po.push(ro); Pi.push(ri); Ah.push(A(r === HR ? 0.8 : 1, lerp(0.7, 1, r / HR)));
    }
    geoShell(g, Po, Pi, Ah, M);
    // straps: bands around the front of the boot, low at the sides, high over the top
    const strap = (yS, yT, wid, t0, t1) => {
      const K = 7, So = [], Si = [];
      for (const e of [-0.5, 0.5]) {
        const ro = [], ri = [];
        for (let k = 0; k <= K; k++) {
          const t = lerp(t0, t1, k / K), y = lerp(yS, yT, Math.pow(Math.sin(t), 2)) + e * wid;
          ro.push(bootPt(y, t, 0.014)); ri.push(bootPt(y, t, 0.002));
        }
        So.push(ro); Si.push(ri);
      }
      geoShell(g, So, Si, [A(1, 1), A(1, 1)], M);
      g.slot = RS.TRIM;                                          // buckle on the toe-edge-facing side
      const bp = bootPt(lerp(yS, yT, 0.5), (t0 + t1) / 2 - 0.55, 0.018);
      geoBox(g, bx + bp[0], 0.03 + bp[1], bp[2], 0.012, 0.022, 0.03, [1, 1, 1]);
      g.slot = RS.BINDING;
    };
    strap(0.10, 0.165, 0.045, 0.15, Math.PI - 0.15);           // ankle strap over the instep
    strap(0.035, 0.075, 0.03, 0.35, Math.PI - 0.35);           // toe cap strap
  }
  return g;
}

/* ---------------- rider parts (drawn with per-part matrices) ----------------
   Every part is built in its own local frame:
     torso / pelvis / head : +Y up, +Z = the way the chest/face points,
                             +X = the lead shoulder side.  Origin at the base.
     limb meshes           : ≈unit radius, ≈unit length along +Y (m4limb scales them;
                             cuffs/folds bulge a little past 1).
     mitten                : origin at the wrist, +Y up the forearm, +X = thumb side.
     boot                  : +X = board nose, +Z = toes, origin at the sole.
     scarf                 : unit strip along +Y, width on X, thickness on Z.
   Colours come from the outfit palette per slot (RS.*); the vertex colour is
   only a shade multiplier, using these greys for fixed details.             */
const RiderGeo = {};
const RIDER_COL = {
  seam: 0.62, edge: 0.55, under: 0.42, inner: 0.30, sole: 0.34
};

function buildRider() {
  const C = RIDER_COL;
  const SEG = 12;

  /* jacket: puffy A-line torso, wider than deep. From the bottom: inside of the
     hem (dark), the hem lip that hangs over the pants, an accent hem band, the
     quilted body, an accent shoulder yoke, the collar. vv = height, for the
     shader's quilting baffles. */
  const t = Geo({ aux: true });
  const J = RS.JACKET, AC = RS.ACCENT;
  const TORSO = [
    { y: 0.020, a: 0, s: J, c: C.inner, ao: 0.25 },
    { y: -0.030, a: 0.150, b: 0.112, c: C.inner, ao: 0.3 },
    { y: -0.068, a: 0.182, b: 0.140, c: C.under, ao: 0.42 },
    { y: -0.078, a: 0.194, b: 0.151, c: C.edge, ao: 0.6 },
    { y: -0.066, a: 0.199, b: 0.156, s: AC, ao: 0.85 },
    { y: -0.026, a: 0.197, b: 0.154, ao: 0.9 },
    { y: -0.014, a: 0.195, b: 0.152, s: J, ao: 0.9 },
    { y: 0.060, a: 0.188, b: 0.146 },
    { y: 0.150, a: 0.186, b: 0.144 },
    { y: 0.250, a: 0.199, b: 0.153 },
    { y: 0.340, a: 0.215, b: 0.163, z: 0.006 },
    { y: 0.410, a: 0.226, b: 0.164, z: 0.006 },
    { y: 0.462, a: 0.230, b: 0.157, z: 0.003, s: AC },
    { y: 0.490, a: 0.230, b: 0.150 },
    { y: 0.535, a: 0.210, b: 0.132 },
    { y: 0.572, a: 0.162, b: 0.110 },
    { y: 0.598, a: 0.112, b: 0.098 },
    { y: 0.614, a: 0.094, b: 0.092, s: J },
    { y: 0.668, a: 0.090, b: 0.090 },
    { y: 0.692, a: 0.086, b: 0.086, c: C.edge },
    { y: 0.684, a: 0.068, b: 0.068, c: C.inner, ao: 0.3 },
    { y: 0.640, a: 0, c: C.inner, ao: 0.3 }
  ];
  rLoft(t, TORSO, 16);
  // armpits and the small of the back sit in the shade of the arms / bend
  bakeAO(t, 0, (x, y, z) => 1 - 0.35 * sstep(0.15, 0.21, Math.abs(x)) * sstep(0.18, 0.30, y) * (1 - sstep(0.40, 0.48, y)));
  // padded shoulder caps (part of the yoke); their lower half hides inside the sleeve top
  let v0 = t.v.length / STRIDE;
  t.slot = AC; t.ao = 1; t.vv = 0.48;
  geoSphere(t, 0.198, 0.492, 0.0, 0.080, [1, 1, 1], 10, 6, [1.0, 0.85, 0.95]);
  geoSphere(t, -0.198, 0.492, 0.0, 0.080, [1, 1, 1], 10, 6, [1.0, 0.85, 0.95]);
  bakeAO(t, v0, (x, y) => lerp(0.6, 1, sstep(0.44, 0.50, y)));
  // hood rolled up behind the collar: two squashed lumps, shaded underneath
  v0 = t.v.length / STRIDE;
  t.slot = J; t.vv = 0.60;
  geoSphere(t, 0, 0.630, -0.092, 0.125, [1, 1, 1], 10, 5, [1.0, 0.48, 0.55]);
  geoSphere(t, 0, 0.600, -0.122, 0.095, [1, 1, 1], 8, 5, [1.0, 0.55, 0.50]);
  bakeAO(t, v0, (x, y) => lerp(0.45, 1, sstep(0.56, 0.66, y)));
  // front zip: a thin dark slab following the chest profile
  {
    const zr = TORSO.slice(4, 18).filter(r => r.a > 0), Zo = [], Zi = [], Az = [];
    for (const r of zr) {
      const zf = (r.z || 0) + r.b;
      Zo.push([[-0.008, r.y, zf + 0.004], [0.008, r.y, zf + 0.004]]);
      Zi.push([[-0.008, r.y, zf - 0.004], [0.008, r.y, zf - 0.004]]);
      Az.push({ s: RS.TRIM, c: 1, ao: 1, v: r.y });
    }
    geoShell(t, Zo, Zi, Az);
  }
  RiderGeo.torso = t;

  // seat of the baggy pants (the jacket hem covers the top)
  const pv = Geo({ aux: true });
  rLoft(pv, [
    { y: -0.215, a: 0, s: RS.PANTS, ao: 0.5 },
    { y: -0.205, a: 0.085, b: 0.072, ao: 0.55 },
    { y: -0.170, a: 0.140, b: 0.112, ao: 0.75 },
    { y: -0.110, a: 0.172, b: 0.134 },
    { y: -0.040, a: 0.175, b: 0.136, ao: 0.8 },
    { y: 0.020, a: 0.167, b: 0.129, ao: 0.5 },
    { y: 0.050, a: 0.130, b: 0.100, ao: 0.4 },
    { y: 0.060, a: 0, ao: 0.4 }
  ], 14);
  RiderGeo.pelvis = pv;

  /* limbs: unit-radius tubes along +Y (y = 0 at the upper joint), scaled per
     part by m4limb. Profiles bulge, bunch into soft fold ripples near the
     joints (shaded troughs) and flare at the cuffs. */
  const P_ = { s: RS.PANTS }, J_ = { s: RS.JACKET };
  const fold = { ao: 0.74, c: 0.92 };
  RiderGeo.thigh = Geo({ aux: true });
  rTube(RiderGeo.thigh, [
    [-0.03, 0, Object.assign({ ao: 0.6 }, P_)], [0.0, 1.06, { ao: 0.7 }], [0.12, 1.17], [0.45, 1.22],
    [0.70, 1.27], [0.78, 1.17, fold], [0.84, 1.27], [0.905, 1.15, fold], [0.96, 1.21], [1.03, 1.10, { ao: 0.8 }], [1.07, 0, { ao: 0.8 }]
  ], SEG, 0.45);
  // shin: knee → ankle. Bunches where it stacks on the boot, then a wide cuff
  // that hangs over the boot with a dark underside.
  RiderGeo.shin = Geo({ aux: true });
  rTube(RiderGeo.shin, [
    [-0.06, 0, Object.assign({ ao: 0.8 }, P_)], [-0.03, 1.16], [0.03, 1.32], [0.09, 1.20, fold], [0.15, 1.33],
    [0.22, 1.24, { ao: 0.82, c: 0.9 }], [0.42, 1.30], [0.63, 1.37], [0.71, 1.48], [0.765, 1.36, fold],
    [0.82, 1.52], [0.87, 1.42, fold], [0.93, 1.57], [1.00, 1.61], [1.045, 1.60, { c: C.edge, ao: 0.6 }],
    [1.035, 1.36, { c: C.inner, ao: 0.3 }], [0.95, 0, { c: C.inner, ao: 0.25 }]
  ], SEG, 0.45);
  RiderGeo.uparm = Geo({ aux: true });
  rTube(RiderGeo.uparm, [
    [-0.08, 0, { s: RS.ACCENT }], [-0.05, 1.16], [0.05, 1.38], [0.13, 1.36], [0.15, 1.35, J_], [0.25, 1.33], [0.55, 1.27],
    [0.78, 1.24], [0.86, 1.10, fold], [0.93, 1.21], [1.03, 1.12, { ao: 0.85 }], [1.08, 0, { ao: 0.85 }]
  ], SEG, 0.30, 1);   // v = 0 at the elbow, like the forearm, so the baffles line up
  // forearm: elbow → wrist, accent cuff with a dark opening the mitten sits in
  RiderGeo.forearm = Geo({ aux: true });
  rTube(RiderGeo.forearm, [
    [-0.06, 0, Object.assign({ ao: 0.85 }, J_)], [-0.03, 1.15], [0.05, 1.28], [0.12, 1.15, fold], [0.20, 1.32],
    [0.55, 1.34], [0.76, 1.38], [0.82, 1.46, { s: RS.ACCENT }], [0.97, 1.50], [1.0, 1.43, { c: C.edge, ao: 0.6 }],
    [0.99, 1.10, { c: C.inner, ao: 0.3 }], [0.90, 0, { c: C.inner, ao: 0.3 }]
  ], SEG, 0.28);
  // knee + elbow joints fill the gap on the outside of a bent limb
  RiderGeo.knee = Geo({ aux: true });
  RiderGeo.knee.slot = RS.PANTS;
  geoSphere(RiderGeo.knee, 0, 0, 0, 1, [1, 1, 1], 10, 6);
  RiderGeo.elbow = Geo({ aux: true });
  RiderGeo.elbow.slot = RS.JACKET;
  RiderGeo.elbow.vv = 0.05;                        // mid-baffle: no quilting seam across the joint
  geoSphere(RiderGeo.elbow, 0, 0, 0, 1, [1, 1, 1], 8, 5);

  /* head: no face. Glossy helmet shell with a brim lip over the goggles and a
     lower back, ear pads, big goggles (lens on a dark frame + strap), and a
     neck gaiter covering the lower face and neck. */
  const hd = Geo({ aux: true });
  const HC = [0, 0.115, -0.006], HR = [0.150, 0.140, 0.166];
  const helm = [];
  const lat = (deg, e) => {
    const f = deg * Math.PI / 180;
    return Object.assign({ y: HC[1] + HR[1] * Math.sin(f), a: HR[0] * Math.cos(f), b: HR[2] * Math.cos(f), z: HC[2] }, e);
  };
  helm.push({ y: 0.095, a: 0, s: RS.HELMET, c: C.inner, ao: 0.3, z: HC[2] });
  helm.push(lat(-24, { a: HR[0] * 0.86, b: HR[2] * 0.86, c: C.inner, ao: 0.35, drop: 1 }));
  helm.push(lat(-24, { c: C.edge, ao: 0.75, drop: 1 }));
  for (const [d, lip] of [[-12, 0], [2, 0], [12, 0], [17, 0.020], [22, 0.018], [27, 0], [40, 0], [55, 0], [70, 0], [82, 0]])
    helm.push(lat(d, { lip, drop: d < 0 ? 0.5 : 0 }));
  helm.push({ y: HC[1] + HR[1], a: 0, z: HC[2] });
  rLoft(hd, helm, 14, {
    warp(p, t, r) {
      const s = Math.sin(t), c = Math.cos(t);
      if (r.drop) p[1] -= r.drop * 0.045 * (Math.pow(Math.max(0, -s), 1.5) + 0.35 * c * c);   // lower at the back / over the ears
      if (r.lip) { const k = r.lip * Math.pow(Math.max(0, s), 3); p[0] += c * k; p[2] += s * k; }
      return p;
    }
  });
  // ear pads
  hd.slot = RS.TRIM; hd.ao = 0.85; hd.vv = 0;
  geoSphere(hd, 0.143, 0.060, -0.010, 0.054, [1, 1, 1], 8, 5, [0.42, 1.0, 1.0]);
  geoSphere(hd, -0.143, 0.060, -0.010, 0.054, [1, 1, 1], 8, 5, [0.42, 1.0, 1.0]);
  // helmet surface point at height y, angle t, pushed out by `off` (for the goggles)
  const helmPt = (y, t, off) => {
    const k = Math.sqrt(Math.max(0.05, 1 - Math.pow((y - HC[1]) / HR[1], 2)));
    const a = HR[0] * k, b = HR[2] * k, c = Math.cos(t), s = Math.sin(t);
    const n = p3norm([c / a, 0, s / b]);
    return [c * a + n[0] * off, y, HC[2] + s * b + n[2] * off];
  };
  const band = (y0, y1, t0, t1, oIn, oOut, slot, bulge, K = 12, Rw = 3) => {
    const Po = [], Pi = [], A = [];
    for (let r = 0; r <= Rw; r++) {
      const y = lerp(y0, y1, r / Rw), ro = [], ri = [];
      for (let k = 0; k <= K; k++) {
        const t = lerp(t0, t1, k / K);
        const b = bulge ? bulge * Math.sin((k / K) * Math.PI) * Math.sin((r / Rw) * Math.PI) : 0;
        ro.push(helmPt(y, t, oOut + b)); ri.push(helmPt(y, t, oIn + b));
      }
      Po.push(ro); Pi.push(ri); A.push({ s: slot, c: 1, ao: 1, v: y });
    }
    geoShell(hd, Po, Pi, A);
  };
  band(0.060, 0.146, 0.33, Math.PI - 0.33, -0.006, 0.016, RS.TRIM, 0, 12, 2);       // goggle frame
  band(0.070, 0.137, 0.42, Math.PI - 0.42, 0.012, 0.024, RS.LENS, 0.006, 12, 2);    // lens, slightly domed
  band(0.084, 0.120, Math.PI - 0.36, TAU + 0.36, 0.0, 0.006, RS.TRIM, 0, 14, 1);   // strap round the back
  // neck gaiter / face mask: neck → jaw → under the goggles, with a nose bump
  rLoft(hd, [
    { y: -0.140, a: 0, z: -0.010, s: RS.MASK, ao: 0.4 },
    { y: -0.130, a: 0.062, z: -0.010, ao: 0.5 },
    { y: -0.085, a: 0.068, b: 0.070, z: -0.004, ao: 0.7 },
    { y: -0.055, a: 0.075, b: 0.080, ao: 0.8, c: 0.85 },
    { y: -0.025, a: 0.090, b: 0.096, z: 0.012 },
    { y: 0.012, a: 0.108, b: 0.113, z: 0.020 },
    { y: 0.045, a: 0.121, b: 0.126, z: 0.022 },
    { y: 0.072, a: 0.126, b: 0.131, z: 0.018, ao: 0.6 },
    { y: 0.092, a: 0.110, b: 0.114, z: 0.014, ao: 0.4 },
    { y: 0.100, a: 0, z: 0.014, ao: 0.4 }
  ], 12, {
    warp(p, t) {
      const f = Math.pow(Math.max(0, Math.sin(t)), 6) * Math.exp(-Math.pow((p[1] - 0.045) / 0.03, 2));
      p[2] += 0.016 * f;
      return p;
    }
  });
  RiderGeo.head = hd;

  /* mitten: gauntlet cuff tapering up into the sleeve, a flattened mitten body
     (palm normal on Z) and a thumb on the +X side. */
  const mt = Geo({ aux: true });
  mt.slot = RS.GLOVES;
  rLoft(mt, [
    { y: 0.100, a: 0, ao: 0.4 }, { y: 0.095, a: 0.042, b: 0.040, ao: 0.5 }, { y: 0.040, a: 0.052, b: 0.048, ao: 0.8 },
    { y: 0.006, a: 0.060, b: 0.055 }, { y: -0.002, a: 0.057, b: 0.051, c: C.edge, ao: 0.7 },
    { y: -0.008, a: 0.047, b: 0.040, c: C.seam, ao: 0.6 }, { y: -0.035, a: 0.058, b: 0.044 },
    { y: -0.070, a: 0.061, b: 0.045 }, { y: -0.100, a: 0.057, b: 0.042 }, { y: -0.122, a: 0.041, b: 0.033 },
    { y: -0.136, a: 0.022, b: 0.019 }, { y: -0.141, a: 0 }
  ], 10);
  rLoft(mt, [
    { y: -0.004, a: 0, ao: 0.7 }, { y: 0.0, a: 0.019, b: 0.017, ao: 0.75 }, { y: 0.030, a: 0.019, b: 0.017 },
    { y: 0.050, a: 0.016, b: 0.014 }, { y: 0.060, a: 0.009, b: 0.008 }, { y: 0.064, a: 0 }
  ], 8, { M: geoFrame([0.036, -0.030, 0.004], [0.62, -0.78, 0.12], [0, 0, 1]) });
  RiderGeo.mitten = mt;

  /* boot: a soft lofted boot with a dark sole, a seam line at the welt and a
     padded collar the pants cuff stacks on. */
  const bt = Geo({ aux: true });
  const S = BOOT_SECT, BR = [];
  BR.push({ y: 0, a: 0, z: S[0][3], s: RS.BOOTS, c: C.sole, ao: 0.6 });
  S.forEach(([y, a, b, z], k) => BR.push({ y, a, b, z, c: k < 2 ? C.sole : (k === 2 ? C.seam : 1), hard: k === 2, ao: k < 2 ? 0.7 : 1 }));
  BR.push({ y: 0.240, a: 0.070, b: 0.080, z: -0.015, c: C.seam });
  BR.push({ y: 0.236, a: 0.052, b: 0.060, z: -0.015, c: C.inner, ao: 0.3 });
  BR.push({ y: 0.200, a: 0, z: -0.015, c: C.inner, ao: 0.3 });
  rLoft(bt, BR, 12);
  RiderGeo.boot = bt;

  /* scarf segment: a flattened tube, unit length along +Y. Full width reaches
     back over the previous segment's end so the joints never pinch; the far
     end tapers inside the next segment. v sits mid-baffle (no quilting seam). */
  const sc = Geo({ aux: true });
  rLoft(sc, [
    { y: -0.16, a: 0, s: RS.ACCENT, v: 0.05 }, { y: -0.14, a: 0.5, b: 0.42, v: 0.05 },
    { y: 1.0, a: 0.5, b: 0.42, v: 0.05 }, { y: 1.03, a: 0.3, b: 0.25, v: 0.05 }, { y: 1.04, a: 0, v: 0.05 }
  ], 6);
  RiderGeo.scarf = sc;
}

/* ---------------- vegetation + rocks (instanced) ---------------- */
/* A noise-displaced sphere shell (tMax < 1 covers only the top of the pole).
   The noise wraps around the seam and each pole collapses to one point, so the
   shell is closed; normals are central differences of the displaced grid,
   wrapping across the seam. */
function geoBoulder(g, ring, ampLo, ampHi, seed, col, scale, tMax) {
  const seg = 9, w = seg + 1;
  const base = g.v.length / STRIDE;
  const tM = tMax === undefined ? 1 : tMax;   // fraction of the pole covered
  const pos = [];
  for (let j = 0; j <= ring; j++) {
    const v = (j / ring) * tM, th = v * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const pole = j === 0 || (j === ring && tM >= 1);
      const ii = pole ? 0 : i % seg;                 // seam column = first column; poles = one point
      const ph = ii / seg * TAU;
      const n = ampLo + ampHi * fbm(Math.cos(ph) * 3 + ii, Math.sin(ph) * 3 + j * 2, 2, seed);
      pos.push(Math.sin(th) * Math.cos(ph) * n * scale,
               Math.cos(th) * n * 0.72 * scale,
               Math.sin(th) * Math.sin(ph) * n * scale);
    }
  }
  const P = (i, j) => { const k = (j * w + i) * 3; return [pos[k], pos[k + 1], pos[k + 2]]; };
  for (let j = 0; j <= ring; j++) {
    for (let i = 0; i <= seg; i++) {
      const p = P(i, j);
      if (j === 0) { geoVert(g, p[0], p[1], p[2], 0, 1, 0, col[0], col[1], col[2]); continue; }
      if (j === ring && tM >= 1) { geoVert(g, p[0], p[1], p[2], 0, -1, 0, col[0], col[1], col[2]); continue; }
      const i0 = i > 0 ? i - 1 : seg - 1, i1 = i < seg ? i + 1 : 1;     // wrap across the seam
      const j0 = Math.max(0, j - 1), j1 = Math.min(ring, j + 1);
      const A = P(i0, j), B = P(i1, j), C = P(i, j0), D = P(i, j1);
      const tx = B[0] - A[0], ty = B[1] - A[1], tz = B[2] - A[2];   // dP/du
      const sx = D[0] - C[0], sy = D[1] - C[1], sz = D[2] - C[2];   // dP/dv
      let nx = ty * sz - tz * sy, ny = tz * sx - tx * sz, nz = tx * sy - ty * sx;
      const l = Math.hypot(nx, ny, nz) || 1;
      geoVert(g, p[0], p[1], p[2], nx / l, ny / l, nz / l, col[0], col[1], col[2]);
    }
  }
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) {
    const a = base + j * w + i, b = a + 1, c = a + w, d = c + 1;
    geoTri(g, a, b, c); geoTri(g, b, d, c);
  }
}
function buildRock() {
  const g = Geo();
  geoBoulder(g, 6, 0.72, 0.50, 12, [0.40, 0.43, 0.48], 1.00, 1);
  // snow cap: a slightly larger shell covering only the top 35% of the pole
  geoBoulder(g, 3, 0.80, 0.30, 31, [0.94, 0.96, 1.00], 1.045, 0.35);
  return g;
}
/* half-pipe wall: a quarter torus, oriented by the instance matrix */
function buildPipe() {
  const g = Geo(), R = 9, seg = 12, wSeg = 6, width = 9;
  const base = g.v.length / STRIDE;
  for (let j = 0; j <= wSeg; j++) {
    const t = j / wSeg, z = (t - 0.5) * width;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * (Math.PI / 2);
      const nx = Math.cos(a), ny = -Math.sin(a);
      geoVert(g, nx * R, ny * R + R, z, nx, ny, 0, 0.86, 0.93, 1.0);
    }
  }
  const w = seg + 1;
  for (let j = 0; j < wSeg; j++) for (let i = 0; i < seg; i++) {
    const a = base + j * w + i, b = a + 1, c = a + w, d = c + 1;
    geoTri(g, a, c, b); geoTri(g, b, c, d);
  }
  return g;
}

/* ---------------- gates ---------------- */
function buildGate() {
  /* slalom pole + flag panel. White so the per-instance tint gives the colour;
     the flag hangs toward +X (the gate centre for the left pole — the right
     pole is rotated 180° by its instance matrix). */
  const g = Geo(), W = [1, 1, 1], D = [0.30, 0.30, 0.32];
  for (let k = 0; k < 7; k++) geoCyl(g, 0, k * 0.86, 0, 0.10, 0.10, (k + 1) * 0.86, k % 2 ? D : W, 10, k === 6, false);
  geoSphere(g, 0, 6.1, 0, 0.18, W, 10, 7);
  geoBox(g, 0.95, 4.0, 0, 1.75, 1.8, 0.06, W);                // flag panel
  geoBox(g, 0.95, 3.05, 0, 1.75, 0.12, 0.08, D);               // weighted hem
  return g;
}
/* gate banner: unit box spanning x 0..1, y 0..1 (stretched between pole tops) */
function buildBanner() {
  const g = Geo();
  geoBox(g, 0.5, 0.5, 0, 1, 1, 0.06, [1, 1, 1]);
  geoBox(g, 0.5, 0.06, 0, 1, 0.12, 0.08, [0.30, 0.30, 0.32]);
  geoBox(g, 0.5, 0.94, 0, 1, 0.12, 0.08, [0.30, 0.30, 0.32]);
  return g;
}

/* ---------------- particles: one instanced quad ---------------- */
function buildParticleQuad() {
  const g = Geo();
  const a = geoVert(g, -1, -1, 0, 0, 0, 1, 1, 1, 1);
  const b = geoVert(g, 1, -1, 0, 0, 0, 1, 1, 1, 1);
  const c = geoVert(g, 1, 1, 0, 0, 0, 1, 1, 1, 1);
  const d = geoVert(g, -1, 1, 0, 0, 0, 1, 1, 1, 1);
  geoQuad(g, a, b, c, d);
  return g;
}

/* ---------------- sky dome ---------------- */
function buildSkyDome() {
  const g = Geo();
  const seg = 28, ring = 14, base = g.v.length / STRIDE;
  for (let j = 0; j <= ring; j++) {
    const v = j / ring, th = v * Math.PI * 0.5;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg, ph = u * TAU;
      const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
      geoVert(g, x, y, z, x, y, z, 1, 1, 1);
    }
  }
  const w = seg + 1;
  for (let j = 0; j < ring; j++) for (let i = 0; i < seg; i++) {
    const a = base + j * w + i, b = a + 1, c = a + w, d = c + 1;
    geoTri(g, a, b, c); geoTri(g, b, d, c);
  }
  return g;
}

/* ---------------- fullscreen triangle ---------------- */
function buildFsTri() {
  const g = Geo();
  geoVert(g, -1, -1, 0.999, 0, 0, 1, 1, 1, 1);
  geoVert(g, 3, -1, 0.999, 0, 0, 1, 1, 1, 1);
  geoVert(g, -1, 3, 0.999, 0, 0, 1, 1, 1, 1);
  geoTri(g, 0, 1, 2);
  return g;
}

/* =====================================================================
   CARD FOLIAGE CONIFERS
   Each fir is a trunk plus dozens of drooping "branch cards": bent quads
   textured with a procedurally painted needle spray (see makeNeedleCanvas),
   rendered alpha-to-coverage so the silhouette is ragged and organic
   instead of faceted. Vertex layout is the shared STRIDE one, re-purposed:
     normal = the card's own (upward-ish) face normal
     colour = (u along the branch, v across it, ambient occlusion)
   The shader derives a soft "volume" normal from the position (radial + up),
   so the crown shades like one rounded mass rather than flat cards.
   ===================================================================== */
function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* shapes: 0 = spruce (tall, narrow, heavy droop), 1 = fir (fuller, layered) */
const FIR_SHAPES = [
  { H: 6.2, R: 1.85, whorls: 16, per: 9, droop: 0.42, lift: 0.10, curve: 1.0 },
  { H: 5.4, R: 2.15, whorls: 13, per: 10, droop: 0.26, lift: 0.18, curve: 0.8 }
];

function buildFirFoliage(shape, lod) {
  const S = FIR_SHAPES[shape], g = Geo(), R = seededRand(1337 + shape * 71 + lod * 7);
  const whorls = lod ? Math.ceil(S.whorls * 0.5) : S.whorls;
  const per = lod ? Math.max(4, S.per - 3) : S.per;
  const segs = lod ? 1 : 3;
  const y0 = S.H * 0.07, y1 = S.H * 0.93;
  // two layers: the outer branches, then (full detail only) a shorter, darker
  // inner fill so the trunk doesn't show through the gaps
  for (let layer = 0; layer < (lod ? 1 : 2); layer++)
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);                     // 0 = bottom whorl, 1 = top
    const y = lerp(y0, y1, Math.pow(t, 0.92));
    const Rw = (S.R * Math.pow(1 - t, 0.95) + 0.22) * (lod ? 1.08 : 1) * (layer ? 0.55 : 1);
    const n = Math.max(3, Math.round(per * (1 - t * 0.45) * (layer ? 0.6 : 1)));
    const twist = R() * TAU;
    for (let b = 0; b < n; b++) {
      const a = twist + (b + R() * 0.5) / n * TAU;
      const L = Rw * (0.82 + R() * 0.32);
      const W = clamp(L * 0.85, 0.55, 1.7) * (lod ? 1.3 : 1);
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = -sa, pz = ca;                      // across the branch (horizontal)
      const roll = (R() - 0.5) * 0.5;               // tilt the card around its length
      const droop = S.droop * (0.7 + R() * 0.6) * (0.6 + 0.4 * (1 - t));
      const ao = lerp(0.5, 1.0, Math.pow(t, 0.7)) * (layer ? 0.6 : 1);
      const base = g.v.length / STRIDE;
      for (let k = 0; k <= segs; k++) {
        const u = k / segs;
        // branch rises a touch off the trunk, then sags toward the tip
        const r = 0.06 + u * L;
        const dy = S.lift * u * L - droop * Math.pow(u, 1.0 + S.curve) * L;
        const cx = ca * r, cy = y + dy, cz = sa * r;
        // card frame: along = outward (with the sag slope), across = horizontal + roll
        const slope = S.lift - droop * (1 + S.curve) * Math.pow(u, S.curve);
        let ax = px, ay = roll, az = pz;
        const half = W * 0.5 * (0.35 + 0.65 * Math.sin(Math.min(1, u * 1.15 + 0.12) * Math.PI * 0.5 + 0.0));
        // face normal = across × along, oriented upward
        let lx = ca, ly = slope, lz = sa;
        let nx = ay * lz - az * ly, ny = az * lx - ax * lz, nz = ax * ly - ay * lx;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const occ = ao * lerp(0.55, 1.0, u);
        geoVert(g, cx - ax * half, cy - ay * half, cz - az * half, nx, ny, nz, u, 0, occ);
        geoVert(g, cx + ax * half, cy + ay * half, cz + az * half, nx, ny, nz, u, 1, occ);
      }
      for (let k = 0; k < segs; k++) {
        const i0 = base + k * 2;
        geoQuad(g, i0, i0 + 2, i0 + 3, i0 + 1);
      }
    }
  }
  // leader: two crossed vertical cards at the very top
  const top = S.H, lh = S.H * 0.16;
  for (let c = 0; c < 2; c++) {
    const a = c * Math.PI * 0.5, ax = Math.cos(a) * 0.32, az = Math.sin(a) * 0.32;
    const base = g.v.length / STRIDE;
    const nx = -Math.sin(a), nz = Math.cos(a);
    geoVert(g, -ax, top - lh, -az, nx, 0.3, nz, 0.05, 0, 0.95);
    geoVert(g, ax, top - lh, az, nx, 0.3, nz, 0.05, 1, 0.95);
    geoVert(g, ax * 0.2, top + 0.15, az * 0.2, nx, 0.3, nz, 0.98, 1, 1.0);
    geoVert(g, -ax * 0.2, top + 0.15, -az * 0.2, nx, 0.3, nz, 0.98, 0, 1.0);
    geoQuad(g, base, base + 1, base + 2, base + 3);
  }
  return g;
}

function buildFirTrunk(shape) {
  const S = FIR_SHAPES[shape], g = Geo();
  geoCyl(g, 0, -0.3, 0, 0.17, 0.03, S.H * 0.72, [0.15, 0.11, 0.085], 7, false, false);
  return g;
}

/* Paint one needle spray into a canvas. Channels of the result:
   R = needle shade variation, G = snow load (upper face only, in the shader),
   B = bare twig, A = coverage. u (x) runs trunk → tip, v (y) across. */
function makeNeedleCanvas(W = 256, H = 128) {
  const R = seededRand(4242);
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const cN = mk(), cS = mk(), cT = mk();
  const n = cN.getContext('2d'), s = cS.getContext('2d'), tw = cT.getContext('2d');
  n.lineCap = s.lineCap = tw.lineCap = 'round';
  // a twig is a polyline; needles sprout off both sides along it
  const twigs = [];
  const main = [];
  for (let i = 0; i <= 12; i++) {
    const u = 0.02 + i / 12 * 0.94;
    main.push([u * W, H * (0.5 + Math.sin(u * 3.0) * 0.035)]);
  }
  twigs.push({ pts: main, w: 3.2 });
  // side shoots, angled toward the tip, shorter further out
  for (let i = 0; i < 9; i++) {
    const u0 = 0.12 + i * 0.088 + R() * 0.03;
    for (const side of [-1, 1]) {
      if (R() < 0.12) continue;
      const len = (0.34 - u0 * 0.22) * W * (0.8 + R() * 0.4);
      const ang = side * (0.78 + R() * 0.3);
      const x0 = u0 * W, y0 = H * (0.5 + Math.sin(u0 * 3.0) * 0.035);
      const pts = [];
      for (let k = 0; k <= 5; k++) {
        const f = k / 5;
        pts.push([x0 + Math.cos(ang * (1 - f * 0.35)) * len * f, y0 + Math.sin(ang * (1 - f * 0.35)) * len * f * 0.95]);
      }
      twigs.push({ pts, w: 1.8 });
      // a couple of small shoots off each side shoot
      for (const k of [2, 4]) {
        if (R() < 0.3) continue;
        const [bx, by] = pts[k], a2 = ang + side * (0.5 + R() * 0.3) * (R() < 0.5 ? 1 : -1) * 0.8;
        const l2 = len * (0.35 + R() * 0.15), q = [];
        for (let m = 0; m <= 3; m++) q.push([bx + Math.cos(a2) * l2 * m / 3, by + Math.sin(a2) * l2 * m / 3 * 0.95]);
        twigs.push({ pts: q, w: 1.2 });
      }
    }
  }
  const env = (x, y) => {                          // keep the spray inside a leaf-like envelope
    const u = x / W, v = Math.abs(y / H - 0.5) * 2;
    const half = 0.98 * Math.sin(Math.min(1, u * 1.08 + 0.1) * Math.PI) ** 0.7;
    return v < half;
  };
  for (const t of twigs) {
    tw.strokeStyle = '#fff'; tw.lineWidth = t.w; tw.beginPath();
    t.pts.forEach((p, i) => i ? tw.lineTo(p[0], p[1]) : tw.moveTo(p[0], p[1])); tw.stroke();
    n.strokeStyle = 'rgb(90,90,90)'; n.lineWidth = t.w; n.beginPath();
    t.pts.forEach((p, i) => i ? n.lineTo(p[0], p[1]) : n.moveTo(p[0], p[1])); n.stroke();
    // needles
    for (let k = 0; k < t.pts.length - 1; k++) {
      const [xa, ya] = t.pts[k], [xb, yb] = t.pts[k + 1];
      const dx = xb - xa, dy = yb - ya, dl = Math.hypot(dx, dy) || 1;
      const cnt = Math.ceil(dl / 2.1);
      for (let q = 0; q < cnt; q++) {
        const f = q / cnt, x = xa + dx * f, y = ya + dy * f;
        for (const side of [-1, 1]) {
          const nl = (t.w > 3 ? 11 : t.w > 1.5 ? 8.5 : 6.5) * (0.7 + R() * 0.5);
          const a = Math.atan2(dy, dx) + side * (0.9 + R() * 0.45);
          const ex = x + Math.cos(a) * nl, ey = y + Math.sin(a) * nl;
          if (!env(ex, ey)) continue;
          const g8 = Math.floor(120 + R() * 135);
          n.strokeStyle = 'rgb(' + g8 + ',' + g8 + ',' + g8 + ')';
          n.lineWidth = 1.0 + R() * 0.6;
          n.beginPath(); n.moveTo(x, y); n.lineTo(ex, ey); n.stroke();
        }
      }
    }
  }
  // snow clumps: soft blobs riding along the twigs, heavier mid-branch
  for (let i = 0; i < 40; i++) {
    const t = twigs[Math.floor(R() * twigs.length)];
    const k = Math.floor(R() * (t.pts.length - 1));
    const f = R(), p = [lerp(t.pts[k][0], t.pts[k + 1][0], f), lerp(t.pts[k][1], t.pts[k + 1][1], f)];
    const u = p[0] / W;
    if (R() > Math.sin(Math.min(1, u * 1.2) * Math.PI) * 0.9) continue;
    const dabs = 2 + Math.floor(R() * 4);
    for (let q = 0; q < dabs; q++) {
      const r = (1.8 + R() * 3.8) * (t.w > 3 ? 1.25 : 1);
      const x = p[0] + (R() - 0.5) * 7, y = p[1] + (R() - 0.5) * 5;
      const gr = s.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      s.fillStyle = gr; s.beginPath(); s.arc(x, y, r, 0, TAU); s.fill();
    }
  }
  const out = mk(), o = out.getContext('2d');
  const dN = n.getImageData(0, 0, W, H).data, dS = s.getImageData(0, 0, W, H).data, dT = tw.getImageData(0, 0, W, H).data;
  // snow load: a blurred copy of the needle coverage (snow bridges the gaps
  // between needles), broken up by soft low-frequency noise, so it lies in
  // continuous lumpy drifts along each shoot instead of polka dots
  const cov = new Float32Array(W * H), tmp = new Float32Array(W * H), blur = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) cov[i] = dT[i * 4 + 3] / 255;   // twig skeleton
  const RB = 4;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0, c = 0;
    for (let k = -RB; k <= RB; k++) { const xx = x + k; if (xx >= 0 && xx < W) { acc += cov[y * W + xx]; c++; } }
    tmp[y * W + x] = acc / c;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0, c = 0;
    for (let k = -RB; k <= RB; k++) { const yy = y + k; if (yy >= 0 && yy < H) { acc += tmp[yy * W + x]; c++; } }
    blur[y * W + x] = acc / c;
  }
  const img = o.createImageData(W, H), d = img.data;
  for (let i = 0; i < W * H; i++) {
    const x = i % W, y = (i / W) | 0;
    const lump = fbm(x * 0.045, y * 0.07, 3, 91);                  // world.js value-noise fbm
    const tipFade = 1 - Math.max(0, x / W - 0.78) * 4;              // tips stay green
    const drift = clamp((blur[i] * 5.0 - 0.85 + (lump - 0.5) * 1.4) * 1.8, 0, 1) * clamp(tipFade, 0, 1) * (dN[i * 4 + 3] > 20 ? 1 : 0);
    const a = dN[i * 4 + 3] / 255, tg = dT[i * 4 + 3] / 255;
    const sn = Math.max(drift, dS[i * 4 + 3] / 255 * 0.5);
    // snow only sits ON needles (plus a little bridging), it never becomes a solid sheet
    d[i * 4] = a > 0 ? dN[i * 4] : 160;            // un-premultiplied shade
    d[i * 4 + 1] = Math.round(sn * 255);
    d[i * 4 + 2] = Math.round(tg * 255);
    // keep a clear 2-texel border so clamped edge texels never smear along the card rim
    const edge = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
    d[i * 4 + 3] = edge ? 0 : Math.round(a * 255);
  }
  return { W, H, data: d };
}
