/* =====================================================================
   meshes.js — every mesh in the game is generated here from numbers.
   Interleaved layout: position(3) normal(3) color(3) = 9 floats/vertex.
   ===================================================================== */
'use strict';

const STRIDE = 9;

/* ---------------- primitive builders ---------------- */
function Geo() {
  return { v: [], i: [] };
}
function geoVert(g, x, y, z, nx, ny, nz, r, gg, b) {
  const o = g.v.length;
  g.v.push(x, y, z, nx, ny, nz, r, gg, b);
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

/* ---------------- the snowboard ---------------- */
/* Local space: +X = nose, +Y = up from base, +Z = right edge. Length 3.05 */
function buildBoard() {
  const g = Geo();
  const L = 1.60, W = 0.15, T = 0.03;     // a real board: 160 cm, ~25 cm waist
  const segs = 26;
  const widthAt = (t) => {
    const nose = sstep(0, 0.22, t), tail = sstep(1, 0.78, t);
    return W * Math.min(nose, tail) * (1 - 0.16 * Math.sin(t * Math.PI));
  };
  const baseY = (t) => {                      // camber + rocker profile
    const c = -0.012 * Math.sin(t * Math.PI); // camber: mid lifts off the snow
    const rock = 0.04 * Math.pow(sstep(0.80, 1, t), 2) + 0.035 * Math.pow(sstep(0.20, 0, t), 2);
    return c + rock;
  };
  const top = [], bot = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, x = (t - 0.5) * L, w = widthAt(t), y = baseY(t);
    top.push([geoVert(g, x, y + T, -w, 0, 1, 0, 0, 0, 0), geoVert(g, x, y + T, w, 0, 1, 0, 0, 0, 0)]);
    bot.push([geoVert(g, x, y, -w, 0, -1, 0, 0, 0, 0), geoVert(g, x, y, w, 0, -1, 0, 0, 0, 0)]);
  }
  const TOPC = [0.06, 0.62, 0.74], BOTC = [0.96, 0.94, 0.90], EDGE = [0.10, 0.11, 0.15];
  // recolour top/bottom (rewrite colours by index)
  const setCol = (vi, c) => { const o = vi * STRIDE + 6; g.v[o] = c[0]; g.v[o + 1] = c[1]; g.v[o + 2] = c[2]; };
  for (let i = 0; i <= segs; i++) { setCol(top[i][0], TOPC); setCol(top[i][1], TOPC); setCol(bot[i][0], BOTC); setCol(bot[i][1], BOTC); }
  for (let i = 0; i < segs; i++) {
    // top surface
    geoQuad(g, top[i][0], top[i][1], top[i + 1][1], top[i + 1][0]);
    // bottom surface (winding flipped)
    geoQuad(g, bot[i][0], bot[i + 1][0], bot[i + 1][1], bot[i][1]);
    // rails
    const rA = (i / segs - 0.5) * L, rB = ((i + 1) / segs - 0.5) * L;
    const wA = widthAt(i / segs), wB = widthAt((i + 1) / segs);
    for (const sgn of [-1, 1]) {
      const a = geoVert(g, rA, baseY(i / segs) + T, sgn * wA, 0, .4, sgn, EDGE[0], EDGE[1], EDGE[2]);
      const b = geoVert(g, rA, baseY(i / segs), sgn * wA, 0, -.4, sgn, EDGE[0], EDGE[1], EDGE[2]);
      const c = geoVert(g, rB, baseY((i + 1) / segs), sgn * wB, 0, -.4, sgn, EDGE[0], EDGE[1], EDGE[2]);
      const d = geoVert(g, rB, baseY((i + 1) / segs) + T, sgn * wB, 0, .4, sgn, EDGE[0], EDGE[1], EDGE[2]);
      // the rail faces outward on both sides, but the -Z side traverses the
      // quad the other way round, so its winding has to be reversed
      if (sgn < 0) geoQuad(g, a, d, c, b); else geoQuad(g, a, b, c, d);
    }
  }
  // tips
  for (const t of [0, 1]) {
    const x = (t - 0.5) * L, y = baseY(t);
    const c = geoVert(g, x * 1.001, y + T * 0.5, 0, sign(t - 0.5), 0, 0, BOTC[0], BOTC[1], BOTC[2]);
    const a = bot[t === 0 ? 0 : segs][0], b = bot[t === 0 ? 0 : segs][1];
    const d = top[t === 0 ? 0 : segs][1], e = top[t === 0 ? 0 : segs][0];
    if (t === 0) { geoTri(g, c, b, a); geoTri(g, c, d, b); geoTri(g, c, e, d); geoTri(g, c, a, e); }
    else { geoTri(g, c, a, b); geoTri(g, c, b, d); geoTri(g, c, d, e); geoTri(g, c, e, a); }
  }
  // bindings
  for (const bx of [-0.27, 0.27]) {
    const y0 = baseY(0.5 + bx / L) + T;
    geoBox(g, bx, y0 + 0.012, 0.01, 0.20, 0.024, W * 1.75, [0.10, 0.11, 0.14]);   // base plate
    geoBox(g, bx, y0 + 0.10, -0.125, 0.17, 0.17, 0.03, [0.10, 0.11, 0.14]);       // highback (heel side)
  }
  return g;
}

/* ---------------- rider parts (drawn with per-part matrices) ----------------
   Every part is built in its own local frame:
     torso / pelvis / head : +Y up, +Z = the way the chest/face points,
                             +X = the lead shoulder side.  Origin at the base.
     limb meshes           : unit radius, unit length along +Y (m4limb scales them).
     boot                  : +X = board nose, +Z = toes, origin at the sole.       */
const RiderGeo = {};
const RIDER_COL = {
  jacket: [0.96, 0.40, 0.10], accent: [1.00, 0.84, 0.22], pants: [0.11, 0.14, 0.24],
  glove: [0.08, 0.08, 0.10], helmet: [0.17, 0.18, 0.22], lens: [1.00, 0.55, 0.12],
  skin: [0.86, 0.64, 0.50], boot: [0.20, 0.20, 0.24]
};

/* ellipse loft along +Y: rings = [[y, halfX, halfZ, colour], ...], closed top/bottom */
function geoLoft(g, rings, seg, cx = 0, cz = 0) {
  const base = g.v.length / STRIDE;
  for (let j = 0; j < rings.length; j++) {
    const [y, a, b, col] = rings[j];
    const jp = rings[Math.max(0, j - 1)], jn = rings[Math.min(rings.length - 1, j + 1)];
    const dy = (jn[0] - jp[0]) || 1, da = (jn[1] - jp[1]) / dy, db = (jn[2] - jp[2]) / dy;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg * TAU, c = Math.cos(t), sn = Math.sin(t);
      // outward normal of an elliptic section, tilted by the taper
      let nx = c / Math.max(a, 1e-3), nz = sn / Math.max(b, 1e-3);
      const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
      const ny = -(da * Math.abs(c) + db * Math.abs(sn));
      const l = Math.hypot(nx, ny, nz);
      geoVert(g, cx + c * a, y, cz + sn * b, nx / l, ny / l, nz / l, col[0], col[1], col[2]);
    }
  }
  const w = seg + 1;
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < seg; i++) {
    const a = base + j * w + i, b = a + 1, c = a + w, d = c + 1;
    geoTri(g, a, c, b); geoTri(g, b, c, d);
  }
  // caps
  const top = rings[rings.length - 1], bot = rings[0];
  const ct = geoVert(g, cx, top[0], cz, 0, 1, 0, top[3][0], top[3][1], top[3][2]);
  const tb = g.v.length / STRIDE;
  for (let i = 0; i <= seg; i++) { const t = i / seg * TAU; geoVert(g, cx + Math.cos(t) * top[1], top[0], cz + Math.sin(t) * top[2], 0, 1, 0, top[3][0], top[3][1], top[3][2]); }
  for (let i = 0; i < seg; i++) geoTri(g, ct, tb + i + 1, tb + i);
  const cb = geoVert(g, cx, bot[0], cz, 0, -1, 0, bot[3][0], bot[3][1], bot[3][2]);
  const bb = g.v.length / STRIDE;
  for (let i = 0; i <= seg; i++) { const t = i / seg * TAU; geoVert(g, cx + Math.cos(t) * bot[1], bot[0], cz + Math.sin(t) * bot[2], 0, -1, 0, bot[3][0], bot[3][1], bot[3][2]); }
  for (let i = 0; i < seg; i++) geoTri(g, cb, bb + i, bb + i + 1);
}

function buildRider() {
  const C = RIDER_COL;
  // jacket: hem → waist → chest → broad shoulders → collar. Wide across X, shallow in Z.
  const t = Geo();
  geoLoft(t, [
    [0.00, 0.165, 0.125, C.jacket], [0.08, 0.160, 0.120, C.jacket], [0.22, 0.175, 0.125, C.jacket],
    [0.36, 0.205, 0.135, C.jacket], [0.44, 0.225, 0.135, C.accent], [0.47, 0.225, 0.130, C.accent],
    [0.52, 0.215, 0.120, C.jacket], [0.57, 0.150, 0.095, C.jacket], [0.60, 0.075, 0.070, C.jacket]
  ], 14);
  geoSphere(t, 0.205, 0.50, 0, 0.085, C.jacket, 10, 6);                 // shoulder caps
  geoSphere(t, -0.205, 0.50, 0, 0.085, C.jacket, 10, 6);
  geoSphere(t, 0, 0.47, -0.10, 0.12, C.jacket, 10, 6, [1.2, 0.85, 0.75]);   // hood bunched on the back
  geoBox(t, 0, 0.30, 0.128, 0.025, 0.42, 0.012, C.glove);                // front zip
  RiderGeo.torso = t;

  // pelvis / seat of the pants, belt on top
  const pv = Geo();
  geoLoft(pv, [
    [-0.17, 0.150, 0.115, C.pants], [-0.06, 0.165, 0.125, C.pants],
    [0.00, 0.165, 0.125, C.glove], [0.03, 0.160, 0.122, C.glove]
  ], 14);
  RiderGeo.pelvis = pv;

  // limbs: unit-radius tapered tubes, scaled per part
  const limb = (col, r1) => { const g = Geo(); geoCyl(g, 0, 0, 0, 1, r1, 1, col, 10, true, true); return g; };
  RiderGeo.thigh = limb(C.pants, 0.85);
  RiderGeo.shin = limb(C.pants, 0.80);
  RiderGeo.uparm = limb(C.jacket, 0.85);
  RiderGeo.forearm = limb(C.jacket, 0.80);
  // knee + elbow joints so bent limbs don't show gaps
  RiderGeo.knee = Geo(); geoSphere(RiderGeo.knee, 0, 0, 0, 1, C.pants, 10, 6);
  RiderGeo.elbow = Geo(); geoSphere(RiderGeo.elbow, 0, 0, 0, 1, C.jacket, 10, 6);

  // head: chin/face, full helmet, goggle strap + big lens facing +Z
  const hd = Geo();
  geoSphere(hd, 0, 0.05, 0.035, 0.105, C.skin, 12, 8, [0.95, 1.0, 0.9]);                 // face / chin
  geoSphere(hd, 0, 0.115, 0, 0.150, C.helmet, 14, 9, [0.98, 0.90, 1.08]);                // helmet shell
  geoCyl(hd, 0, 0.075, 0, 0.152, 0.150, 0.125, C.glove, 16, false, false);              // strap band
  geoSphere(hd, 0, 0.10, 0.125, 0.085, C.lens, 12, 7, [1.25, 0.55, 0.45]);              // goggle lens
  geoCyl(hd, 0, -0.08, -0.01, 0.055, 0.06, 0.02, C.skin, 8, false, false);              // neck
  RiderGeo.head = hd;

  const ha = Geo();
  geoSphere(ha, 0, 0, 0, 0.065, C.glove, 10, 7, [1.0, 0.9, 1.25]);
  geoCyl(ha, 0, 0.03, 0, 0.055, 0.06, 0.10, C.glove, 8, false, false);                  // cuff
  RiderGeo.hand = ha;

  // boot: long axis across the board (+Z = toes)
  const bt = Geo();
  geoBox(bt, 0, 0.05, 0.025, 0.115, 0.10, 0.30, C.boot);
  geoBox(bt, 0, 0.15, -0.015, 0.115, 0.12, 0.17, C.boot);
  geoBox(bt, 0, 0.06, 0.10, 0.12, 0.035, 0.06, C.glove);                                // toe strap
  RiderGeo.boot = bt;
}

/* ---------------- vegetation + rocks (instanced) ---------------- */
function buildTree() {
  const g = Geo();
  geoCyl(g, 0, 0, 0, 0.16, 0.10, 1.1, [0.28, 0.20, 0.15], 6, false, false);
  const layers = [[1.0, 1.25, 1.95], [1.9, 1.02, 1.55], [2.75, 0.76, 1.20], [3.5, 0.46, 0.85]];
  for (let i = 0; i < layers.length; i++) {
    const [y0, , y1] = layers[i];
    const r0 = layers[i][1], r1 = (i + 1 < layers.length) ? layers[i + 1][1] * 0.72 : 0.02;
    const shade = 0.30 + i * 0.055;
    geoCyl(g, 0, y0, 0, r0, r1, y1, [shade * 0.42, shade, shade * 0.62], 7, true, false);
    // snow cap on top of each tier
    geoCyl(g, 0, y1 - 0.10, 0, r1 * 1.02 + 0.05, Math.max(0.02, r1 * 0.55), y1 + 0.10, [0.93, 0.96, 1.0], 7, true, false);
  }
  return g;
}
/* A displaced sphere shell with CORRECT normals.
   The previous version faked them with Math.abs(ny), which flipped the entire
   lower hemisphere to point upward — under backface culling that both lit the
   underside wrongly and failed the winding agreement test (127/162 = 78%).
   Normals are now central differences of the displaced grid itself:
   n = cross(dP/du, dP/dv), which is exactly the direction the a,b,c / b,d,c
   face winding produces. Verified analytically at the equator: a vertex at
   (1,0,0) gets n = (+,0,0). */
function geoBoulder(g, ring, ampLo, ampHi, seed, col, scale, tMax) {
  const seg = 9, w = seg + 1;
  const base = g.v.length / STRIDE;
  const tM = tMax === undefined ? 1 : tMax;   // fraction of the pole covered
  const pos = [];
  for (let j = 0; j <= ring; j++) {
    const v = (j / ring) * tM, th = v * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const ph = i / seg * TAU;
      const n = ampLo + ampHi * fbm(Math.cos(ph) * 3 + i, Math.sin(ph) * 3 + j * 2, 2, seed);
      pos.push(Math.sin(th) * Math.cos(ph) * n * scale,
               Math.cos(th) * n * 0.72 * scale,
               Math.sin(th) * Math.sin(ph) * n * scale);
    }
  }
  const P = (i, j) => { const k = (j * w + i) * 3; return [pos[k], pos[k + 1], pos[k + 2]]; };
  for (let j = 0; j <= ring; j++) {
    for (let i = 0; i <= seg; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(seg, i + 1);
      const j0 = Math.max(0, j - 1), j1 = Math.min(ring, j + 1);
      const A = P(i0, j), B = P(i1, j), C = P(i, j0), D = P(i, j1);
      const tx = B[0] - A[0], ty = B[1] - A[1], tz = B[2] - A[2];   // dP/du
      const sx = D[0] - C[0], sy = D[1] - C[1], sz = D[2] - C[2];   // dP/dv
      let nx = ty * sz - tz * sy, ny = tz * sx - tx * sz, nz = tx * sy - ty * sx;
      const l = Math.hypot(nx, ny, nz) || 1;
      const p = P(i, j);
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
