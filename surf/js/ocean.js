/* =====================================================================
   ocean.js — the sea. Waves are straight swell lines travelling to shore
   (+z) at SEA.C. Each one shoals, then breaks column by column outward
   from its peak (the peel), so a wave reads: unbroken shoulder → pitching
   lip → throwing barrel → collapsing whitewater.

   A wave's cross-section at any x is one continuous curve in (z, y):
     back → crest → top of the lip → lip tip → underside of the lip
          → the wall (back of the tube) → trough → flat water ahead.
   With no lip the "tongue" collapses to the crest, so the same sample
   layout covers a gentle swell and a full barrel. The renderer sweeps
   these curves along x; physics reads the same curves, so what you see
   is what you ride.
   ===================================================================== */
'use strict';

const SEA = {
  C: 5.2,          // wave speed, m/s shoreward
  G: 9.81,
  ZB: -112,        // break line (where a set wave's peak pitches)
  Z_END: 70,       // ride over: the wave has run out of reef
  LINEUP: [-130, -116],
  START_Z: -119,   // you start (and restart) sitting here
  LB: 34,          // profile span behind the crest
  LF: 20,          // …and ahead of it
  T_THROW: 1.0,    // s from first pitch to the lip landing in the trough
  SHORE: 129       // water meets sand around here (a long reef: rides of half a minute)
};

// samples per section of the profile
const NP_BACK = 24, NP_TON = 16, NP_TIP = 4, NP_WALL = 22, NP_FRONT = 10;
const NP = NP_BACK + NP_TON + NP_TIP + NP_TON + NP_WALL + NP_FRONT;
const I_TON = NP_BACK, I_TIP = I_TON + NP_TON, I_IN = I_TIP + NP_TIP,
      I_WALL = I_IN + NP_TON, I_FRONT = I_WALL + NP_WALL;

/* one column of one wave, reused (never allocate per frame) */
function Profile() {
  return {
    z: new Float32Array(NP), y: new Float32Array(NP),
    tz: new Float32Array(NP), ty: new Float32Array(NP),
    foam: new Float32Array(NP), thin: new Float32Array(NP),
    a: 0, H: 0, s: 0, lam: 0, foamAmt: 0, zT: 0, yT: 0, tipZ: 0, tipY: 0
  };
}

/* small background swell so the sea is never a mirror. Three sines, each
   amp·sin(ax·x + bz·z − w·t + ph); the renderer evaluates them separably.
   It fades out near the shore and over the surf waves (whose profiles are exact). */
const AMB = [[0.10, 0.06, 0.17, 1.05, 0], [0.06, -0.11, 0.23, 1.37, 1.3], [0.03, 0.31, 0.41, 2.1, 0.4]];
function ambientRaw(x, z, t) {
  let s = 0;
  for (const [a, ax, bz, w, ph] of AMB) s += a * Math.sin(ax * x + bz * z - w * t + ph);
  return s;
}
function ambientK(z) {               // shore fade × "not under a surf wave"
  let k = 1 - smoothstep(SEA.SHORE - 31, SEA.SHORE - 5, z);
  for (const w of Ocean.waves) {
    const d = Math.max(w.zw - SEA.LB - z, z - w.zw - SEA.LF);
    if (d < 8) k *= smoothstep(0, 8, d);
  }
  return k;
}
function ambient(x, z, t) { const k = ambientK(z); return k > 0 ? k * ambientRaw(x, z, t) : 0; }

const Ocean = {
  t: 0,
  waves: [],
  nextId: 1,

  reset() { this.t = 0; this.waves.length = 0; },

  /* opts: { zw, H0, xPeak, vp (peel speed; huge = closeout), main } */
  spawn(o) {
    const w = {
      id: this.nextId++, zw: o.zw, H0: o.H0, xPeak: o.xPeak || 0, vp: o.vp || 6.5,
      main: !!o.main, tb0: this.t + (SEA.ZB - o.zw) / SEA.C, broke: false,
      // sections: the peel speeds up and slows down along the reef (keeps d(age)/dx > 0)
      sec: o.sec === undefined ? 1.0 : o.sec, ph: o.ph === undefined ? Math.random() * TAU : o.ph
    };
    this.waves.push(w);
    this.waves.sort((a, b) => a.zw - b.zw);
    return w;
  },

  update(dt) {
    this.t += dt;
    for (const w of this.waves) {
      w.zw += SEA.C * dt;
      if (!w.broke && this.t >= w.tb0) w.broke = true;
    }
    for (let i = this.waves.length - 1; i >= 0; i--) if (this.waves[i].zw > SEA.SHORE + 2) this.waves.splice(i, 1);
  },

  /* height envelope: shoaling on the way in, dying in the shallows */
  waveH(w) {
    return w.H0 * (0.28 + 0.72 * smoothstep(SEA.ZB - 100, SEA.ZB, w.zw))
                * (1 - 0.82 * smoothstep(SEA.SHORE - 79, SEA.SHORE - 7, w.zw));
  },
  age(w, x) {
    const d = Math.abs(x - w.xPeak);
    return this.t - w.tb0 - d / w.vp - w.sec * (Math.sin(d * 0.055 + w.ph) - Math.sin(w.ph));
  },

  /* stage of a column: a = seconds since it pitched (<0: not yet) */
  stage(w, x, P) {
    const a = this.age(w, x), T = SEA.T_THROW;
    let H = this.waveH(w), s, lam, foam;
    const pre = smoothstep(SEA.ZB - 70, SEA.ZB, w.zw);
    if (a < 0) {
      lam = 0; foam = 0;
      s = 0.1 + 0.36 * pre + 0.54 * pre * smoothstep(-1.5, 0, a);
    } else if (a < T) {
      lam = a / T; s = 1; foam = 0.2 * smoothstep(0.7, 1, lam);
    } else {
      const k = a - T;
      lam = Math.exp(-k * 1.2);
      s = 0.5 + 0.5 * Math.exp(-k * 1.5);
      H *= 0.42 + 0.58 * Math.exp(-k / 1.2);
      foam = smoothstep(-0.05, 0.2, k) * (1 - 0.45 * smoothstep(SEA.SHORE - 49, SEA.SHORE - 5, w.zw));
    }
    P.a = a; P.H = H; P.s = s; P.lam = lam; P.foamAmt = foam;
  },

  /* fill P with the wave's cross-section at x (absolute z) */
  profile(w, x, P) {
    this.stage(w, x, P);
    const H = Math.max(P.H, 0.02), s = P.s, lam = P.lam, foam = P.foamAmt, zw = w.zw;
    const LB = SEA.LB, LF = SEA.LF;
    const zT = H * (0.8 + 2.6 * (1 - s)), yT = -0.13 * H * s;
    P.zT = zw + zT; P.yT = yT;
    const crestFoam = P.a < 0 ? 0.3 * smoothstep(-0.7, 0, P.a) * s : 0;
    let i = 0;

    // back: y = H·smoothstep(u)^1.4
    for (let k = 0; k < NP_BACK; k++, i++) {
      const u = k / NP_BACK;
      const f = (q) => Math.pow(q * q * (3 - 2 * q), 1.4);
      const e = 1e-3, dy = H * (f(Math.min(1, u + e)) - f(Math.max(0, u - e))) / (2 * e);
      P.z[i] = zw - LB + LB * u; P.y[i] = H * f(u);
      setTan(P, i, LB, dy);
      P.foam[i] = Math.max(foam * 0.85, crestFoam) * smoothstep(0.55, 1, u);
      P.thin[i] = 0.45 * s * smoothstep(0.8, 1, u);
    }

    // the tongue (lip): a ballistic jet from the crest. centreline c(v)
    const X = lam * 1.15 * H, rise = 0.18;
    const th = (v) => 0.03 + lam * H * 0.12 * (1 - 0.5 * v);
    const th0 = th(0), y0 = H - th0 / 2;
    const D = lam * lam * (y0 + X * rise - (yT + 0.15));
    const cz = (v) => X * v, cy = (v) => y0 + X * rise * v - D * v * v;
    const tanAt = (v) => {            // unit tangent of the centreline
      let dz = X, dy = X * rise - 2 * D * v;
      const l = Math.sqrt(dz * dz + dy * dy);
      return l < 1e-5 ? [1, 0] : [dz / l, dy / l];
    };
    const lipFoam = Math.max(foam, crestFoam, 0.12 * lam);
    for (let k = 0; k < NP_TON; k++, i++) {          // top of the lip, crest → tip
      const v = k / (NP_TON - 1), t = tanAt(v), h = th(v) / 2;
      P.z[i] = zw + cz(v) - t[1] * h; P.y[i] = cy(v) + t[0] * h;
      setTan(P, i, t[0], t[1]);
      P.foam[i] = lipFoam * (0.6 + 0.4 * v); P.thin[i] = 0.35 + 0.65 * lam;
    }
    {                                                 // round the tip
      const t = tanAt(1), h = th(1) / 2, nz = -t[1], ny = t[0];
      for (let k = 1; k <= NP_TIP; k++, i++) {
        const f = k / (NP_TIP + 1) * Math.PI, c = Math.cos(f), sn = Math.sin(f);
        P.z[i] = zw + cz(1) + (nz * c + t[0] * sn) * h;
        P.y[i] = cy(1) + (ny * c + t[1] * sn) * h;
        setTan(P, i, -nz * sn + t[0] * c, -ny * sn + t[1] * c);
        P.foam[i] = Math.max(lipFoam, 0.3 * lam); P.thin[i] = 1;
      }
      P.tipZ = zw + cz(1); P.tipY = cy(1);
    }
    for (let k = NP_TON - 1; k >= 0; k--, i++) {      // underside, tip → back of the tube
      const v = k / (NP_TON - 1), t = tanAt(v), h = th(v) / 2;
      P.z[i] = zw + cz(v) + t[1] * h; P.y[i] = cy(v) - t[0] * h;
      setTan(P, i, -t[0], -t[1]);
      P.foam[i] = foam * 0.8; P.thin[i] = 0.4 + 0.6 * lam;
    }

    // the wall: hermite from the back of the tube down into the trough
    {
      const Wz = 0, Wy = H - th0;
      const phi = lerp(0.35, Math.PI / 2, Math.pow(s, 1.5)) + 0.2 * lam;
      const L = Math.hypot(zT - Wz, yT - Wy) * 1.25;
      const m0z = Math.cos(phi) * L, m0y = -Math.sin(phi) * L, m1z = L, m1y = 0;
      for (let k = 0; k < NP_WALL; k++, i++) {
        const u = k / NP_WALL, u2 = u * u, u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
        const d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u;
        P.z[i] = zw + h00 * Wz + h10 * m0z + h01 * zT + h11 * m1z;
        P.y[i] = h00 * Wy + h10 * m0y + h01 * yT + h11 * m1y;
        setTan(P, i, d00 * Wz + d10 * m0z + d01 * zT + d11 * m1z, d00 * Wy + d10 * m0y + d01 * yT + d11 * m1y);
        P.foam[i] = foam * (1 - 0.4 * u) + 0.35 * lam * smoothstep(0.75, 1, P.lam) * smoothstep(0.6, 1, u);
        P.thin[i] = 0.75 * s * (1 - u) * (1 - u);
      }
    }
    // flat water ahead
    for (let k = 0; k < NP_FRONT; k++, i++) {
      const u = k / (NP_FRONT - 1), sm = u * u * (3 - 2 * u);
      P.z[i] = zw + zT + (LF - zT) * u; P.y[i] = yT * (1 - sm);
      setTan(P, i, LF - zT, -yT * 6 * u * (1 - u));
      P.foam[i] = foam * 0.7 * (1 - u) * (1 - u); P.thin[i] = 0;
    }
  },

  /* shoreward water speed under a wave: shallow-water orbital motion,
     u ≈ C·η/h — near the crest the water itself is heading for the beach */
  orbital(q, y) {
    if (!q.wave || q.H < 0.1) return 0;
    return SEA.C * 0.55 * clamp(y / q.H, 0, 1.1);
  },

  /* the wave whose profile span holds z (spans never overlap) */
  waveAt(z) {
    for (const w of this.waves) if (z >= w.zw - SEA.LB && z <= w.zw + SEA.LF) return w;
    return null;
  },

  /* surface under (x, z). yRef picks which sheet when the lip overhangs:
     the highest surface no more than `reach` above yRef (default: topmost).
     Fills Q: y, foam, wave, P (profile), ceil (lowest water above yRef+0.25). */
  _P: Profile(),
  sheet(x, z, yRef, Q, reach = 0.45) {
    const w = this.waveAt(z), amb = ambient(x, z, this.t);
    Q.wave = w; Q.ceil = Infinity; Q.foam = 0; Q.covered = false;
    if (!w) { Q.y = amb; Q.dydz = 0; return Q; }
    const P = this._P;
    this.profile(w, x, P);
    let best = -Infinity, low = Infinity, bestK = -1, lowK = -1;
    for (let k = 0; k < NP - 1; k++) {
      const z0 = P.z[k], z1 = P.z[k + 1];
      if ((z - z0) * (z - z1) > 0 || z0 === z1) continue;
      const f = (z - z0) / (z1 - z0), y = P.y[k] + (P.y[k + 1] - P.y[k]) * f;
      if (yRef === undefined || y <= yRef + reach) { if (y > best) { best = y; bestK = k; } }
      else if (y < Q.ceil) Q.ceil = y;
      if (y < low) { low = y; lowK = k; }
    }
    if (bestK < 0) { best = low; bestK = lowK; }
    if (bestK < 0) { Q.y = amb; Q.dydz = 0; return Q; }
    const k = bestK, z0 = P.z[k], z1 = P.z[k + 1];
    Q.y = best + amb;
    Q.dydz = (P.y[k + 1] - P.y[k]) / (z1 - z0);
    Q.foam = Math.max(P.foam[k], P.foam[k + 1]);
    Q.covered = Q.ceil < Infinity && bestK >= I_WALL - 2;
    Q.ceil += amb;
    Q.a = P.a; Q.H = P.H; Q.lam = P.lam; Q.s = P.s; Q.foamAmt = P.foamAmt;
    Q.zT = P.zT; Q.yT = P.yT; Q.tipZ = P.tipZ; Q.tipY = P.tipY; Q.zw = w.zw;
    return Q;
  },

  /* height + gradient of the supporting sheet */
  _q0: {}, _q1: {}, _q2: {},
  surface(x, z, yRef, out, reach) {
    const q = this.sheet(x, z, yRef, out, reach);
    const e = 0.35;
    const qa = this.sheet(x - e, z, yRef, this._q1, reach).y, qb = this.sheet(x + e, z, yRef, this._q2, reach).y;
    const ez = 0.3;
    const za = this.sheet(x, z - ez, yRef, this._q1, reach).y, zb = this.sheet(x, z + ez, yRef, this._q2, reach).y;
    q.gx = (qb - qa) / (2 * e);
    q.gz = (zb - za) / (2 * ez);
    // a near-vertical wall or a sheet switch makes finite differences explode
    if (!isFinite(q.gx) || Math.abs(q.gx) > 3) q.gx = clamp(q.gx || 0, -3, 3);
    if (!isFinite(q.gz) || Math.abs(q.gz) > 3) q.gz = clamp(q.gz || 0, -3, 3);
    return q;
  }
};

function setTan(P, i, dz, dy) {
  const l = Math.sqrt(dz * dz + dy * dy);
  if (l < 1e-6) { P.tz[i] = 1; P.ty[i] = 0; } else { P.tz[i] = dz / l; P.ty[i] = dy / l; }
}

