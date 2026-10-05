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
  /* Outline: a sidecut body (widest at the contact points, narrower at the waist)
     closed by elliptical nose and tail caps, so the ends are round, not pointed.
     Samples are listed along x; caps get extra samples for a smooth curve. */
  const E = 0.17;                                  // cap length (nose/tail curve)
  const xs = [], ws = [];
  const CAP = 10, BODY = 22, xT = -L / 2 + E, xN = L / 2 - E;
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
  const TOPC = [0.06, 0.62, 0.74], BOTC = [0.96, 0.94, 0.90], EDGE = [0.10, 0.11, 0.15];
  const top = [], bot = [];
  for (let i = 0; i < n; i++) {
    const x = xs[i], w = ws[i], y = baseY(x);
    top.push([geoVert(g, x, y + T, -w, 0, 1, 0, ...TOPC), geoVert(g, x, y + T, w, 0, 1, 0, ...TOPC)]);
    bot.push([geoVert(g, x, y, -w, 0, -1, 0, ...BOTC), geoVert(g, x, y, w, 0, -1, 0, ...BOTC)]);
  }
  // rail normal at sample i: outward from the outline z = ±w(x), i.e. (-dw/dx, 0, ±1)
  const slope = (i) => {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    return (ws[b] - ws[a]) / ((xs[b] - xs[a]) || 1e-6);
  };
  for (let i = 0; i < n - 1; i++) {
    // top surface / bottom surface (winding flipped)
    geoQuad(g, top[i][0], top[i][1], top[i + 1][1], top[i + 1][0]);
    geoQuad(g, bot[i][0], bot[i + 1][0], bot[i + 1][1], bot[i][1]);
    // rails
    const xA = xs[i], xB = xs[i + 1], wA = ws[i], wB = ws[i + 1];
    const yA = baseY(xA), yB = baseY(xB), sA = slope(i), sB = slope(i + 1);
    for (const sgn of [-1, 1]) {
      const nA = V3.norm(V3(), V3(-sA, 0, sgn)), nB = V3.norm(V3(), V3(-sB, 0, sgn));
      const a = geoVert(g, xA, yA + T, sgn * wA, nA.x, 0.3, nA.z, ...EDGE);
      const b = geoVert(g, xA, yA, sgn * wA, nA.x, -0.3, nA.z, ...EDGE);
      const c = geoVert(g, xB, yB, sgn * wB, nB.x, -0.3, nB.z, ...EDGE);
      const d = geoVert(g, xB, yB + T, sgn * wB, nB.x, 0.3, nB.z, ...EDGE);
      if (sgn < 0) geoQuad(g, a, d, c, b); else geoQuad(g, a, b, c, d);
    }
  }
  // bindings
  for (const bx of [-0.27, 0.27]) {
    const y0 = baseY(bx) + T;
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
  /* Snowy fir: a trunk plus five drooping, star-shaped branch tiers. Flat-shaded
     facets; each tier's upper surface fades from snow at the top to needles at
     the tips, the underside is dark. Unit scale: ~4.6 m tall. */
  const g = Geo();
  geoCyl(g, 0, 0, 0, 0.15, 0.08, 1.3, [0.30, 0.21, 0.15], 7, false, false);
  const SNOW = [0.93, 0.96, 1.0], UNDER = [0.08, 0.20, 0.14];
  const face = (A, B, C, ca, cb, cc, hint) => {
    let ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { [B, C] = [C, B]; [cb, cc] = [cc, cb]; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    geoTri(g, geoVert(g, A[0], A[1], A[2], nx, ny, nz, ...ca),
              geoVert(g, B[0], B[1], B[2], nx, ny, nz, ...cb),
              geoVert(g, C[0], C[1], C[2], nx, ny, nz, ...cc));
  };
  const K = 10, TIERS = 5;
  for (let t = 0; t < TIERS; t++) {
    const k = t / (TIERS - 1);
    const y0 = 0.95 + t * 0.74;                     // tier skirt height
    const R = 1.5 * (1 - k * 0.72);                 // radius shrinks up the tree
    const yTop = y0 + 1.15 - k * 0.15;
    const rTop = t === TIERS - 1 ? 0.0 : R * 0.16;
    const green = [0.10 + k * 0.03, 0.30 + k * 0.06, 0.19 + k * 0.03];
    const tip = [], top = [];
    for (let i = 0; i < K; i++) {
      const a = (i + t * 0.5) / K * TAU;            // twist each tier a little
      const out = i % 2 === 0;
      const r = out ? R : R * 0.62;
      const droop = out ? 0.22 : 0.0;
      tip.push([Math.cos(a) * r, y0 - droop, Math.sin(a) * r]);
      top.push([Math.cos(a) * rTop, yTop, Math.sin(a) * rTop]);
    }
    const snowMix = (c, m) => [lerp(c[0], SNOW[0], m), lerp(c[1], SNOW[1], m), lerp(c[2], SNOW[2], m)];
    const tipCol = snowMix(green, 0.12), midCol = snowMix(green, 0.55);
    for (let i = 0; i < K; i++) {
      const j = (i + 1) % K;
      const A = top[i], B = top[j], C = tip[i], D = tip[j];
      const hint = [(C[0] + D[0]) * 0.5, 0.8, (C[2] + D[2]) * 0.5];   // outward + up
      if (rTop > 0) face(A, D, C, SNOW, i % 2 ? tipCol : midCol, i % 2 ? midCol : tipCol, hint);
      face(A, B, D, SNOW, SNOW, j % 2 ? midCol : tipCol, hint);
      if (rTop === 0) face(A, D, C, SNOW, tipCol, tipCol, hint);
      // underside back to the trunk
      face(C, D, [0, y0 + 0.28, 0], UNDER, UNDER, UNDER, [(C[0] + D[0]) * 0.5, -1.2, (C[2] + D[2]) * 0.5]);
    }
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
    const cov = a;
    d[i * 4] = a > 0 ? dN[i * 4] : 160;            // un-premultiplied shade
    d[i * 4 + 1] = Math.round(sn * 255);
    d[i * 4 + 2] = Math.round(tg * 255);
    // keep a clear 2-texel border so clamped edge texels never smear along the card rim
    const edge = x < 2 || y < 2 || x >= W - 2 || y >= H - 2;
    d[i * 4 + 3] = edge ? 0 : Math.round(Math.min(1, cov) * 255);
  }
  return { W, H, data: d };
}
