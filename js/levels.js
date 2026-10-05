/* =====================================================================
   levels.js — the two built courses (the endless mountain lives in world.js).
     • Half-pipe: a long straight competition pipe; carve up a wall with enough
       speed and you launch out of the lip, then land back on the transition.
     • Park: a groomed run with tabletops, rollers, a mini-pipe and rails to grind.
   Each level supplies a height function, its own rules (lip launches, rails),
   camera framing and a static decoration mesh (coping, rails, finish arch).
   ===================================================================== */
'use strict';

/* ---------------- shared helpers ---------------- */

/* a straight square beam from a→b (any direction), cross-section w × h */
function geoBeam(g, a, b, w, h, col) {
  let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
  // side = dir × up (horizontal), up' = side × dir
  let sx = -dz, sy = 0, sz = dx; const sl = Math.hypot(sx, sz);
  if (sl < 1e-6) { sx = 1; sz = 0; } else { sx /= sl; sz /= sl; }   // vertical beams (posts) need a fallback side
  const ux = sy * dz - sz * dy, uy = sz * dx - sx * dz, uz = sx * dy - sy * dx;
  const hw = w / 2, hh = h / 2;
  const corner = (p, i, j) => [p[0] + sx * hw * i + ux * hh * j, p[1] + sy * hw * i + uy * hh * j, p[2] + sz * hw * i + uz * hh * j];
  const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)];
  const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const quad = (p, q, r, s) => {
    // flat face, wound to face away from the beam's centre line
    let e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const cx = (p[0] + q[0] + r[0] + s[0]) / 4 - mid[0], cy = (p[1] + q[1] + r[1] + s[1]) / 4 - mid[1], cz = (p[2] + q[2] + r[2] + s[2]) / 4 - mid[2];
    if (nx * cx + ny * cy + nz * cz < 0) { [q, s] = [s, q]; nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i0 = geoVert(g, p[0], p[1], p[2], nx, ny, nz, ...col), i1 = geoVert(g, q[0], q[1], q[2], nx, ny, nz, ...col);
    const i2 = geoVert(g, r[0], r[1], r[2], nx, ny, nz, ...col), i3 = geoVert(g, s[0], s[1], s[2], nx, ny, nz, ...col);
    geoQuad(g, i0, i1, i2, i3);
  };
  for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; quad(A[k], A[k1], B[k1], B[k]); }
  quad(A[0], A[3], A[2], A[1]); quad(B[0], B[1], B[2], B[3]);
}

/* finish arch: two posts and a banner across the course at z */
function geoFinishArch(g, z, halfW, cx = 0) {
  const yL = heightAt(cx - halfW, z), yR = heightAt(cx + halfW, z);
  const RED = [0.92, 0.22, 0.18], WHITE = [0.95, 0.96, 0.98];
  geoBeam(g, [cx - halfW, yL - 0.3, z], [cx - halfW, yL + 6.2, z], 0.35, 0.35, WHITE);
  geoBeam(g, [cx + halfW, yR - 0.3, z], [cx + halfW, yR + 6.2, z], 0.35, 0.35, WHITE);
  geoBeam(g, [cx - halfW, yL + 5.4, z], [cx + halfW, yR + 5.4, z], 0.12, 1.5, RED);
  for (let i = -3; i <= 3; i++) {                         // chequered strip under the banner
    const x0 = ((i - 0.5) / 3.5) * halfW, x1 = ((i + 0.5) / 3.5) * halfW;   // 7 squares spanning -halfW..+halfW
    geoBeam(g, [cx + x0, lerp(yL, yR, (x0 / halfW + 1) / 2) + 4.5, z + 0.08], [cx + x1, lerp(yL, yR, (x1 / halfW + 1) / 2) + 4.5, z + 0.08],
      0.06, 0.3, i % 2 ? WHITE : [0.08, 0.08, 0.1]);
  }
}

/* pipe cross-section: flat bottom B, quarter-circle transition R, deck beyond */
function pipeWall(ax, B, R) {
  if (ax <= B) return 0;
  const d = Math.min(ax - B, R * 0.997);
  return R - Math.sqrt(R * R - d * d);
}

/* launch out of a pipe lip: all outward speed turns into vertical speed (the top
   of the wall is vertical), with a little drift back into the pipe */
function pipeLipLaunch(P, cx, B, R, env) {
  const rel = P.pos.x - cx, ax = Math.abs(rel), out = rel >= 0 ? 1 : -1;
  if (env < 0.9 || ax < B + R - 0.45) return false;
  const vOut = P.vel.x * out;
  if (vOut < 1.0) return false;
  P.airborne = true; P.airTime = 0;
  P.vel.y = vOut + 0.6;
  P.vel.x = -out * 0.9;
  P.pos.x = cx + out * (B + R - 0.5);
  P.spin = 0; P.flip = 0; P.flipRate = 0; P.flipArmed = false;
  P.lean = 0;                       // carve lean shouldn't turn into an accidental spin
  P.coyote = 0.25;                  // releasing the jump right at the lip adds an ollie pop
  // turn the board during the air so it comes down facing back into the pipe
  // (mirror the heading across the pipe axis) — the classic frontside/backside air.
  // predicted travel on landing: back into the pipe (the fall turns into inward
  // speed on the transition) while keeping the down-pipe speed. Riding out
  // switch is legal, so aim for whichever of the two headings is closer.
  const vin = 0.9 + 0.55 * P.vel.y;
  const travel = Math.atan2(-out * vin, P.vel.z);
  const dA = angDelta(P.yaw, travel), dB = angDelta(P.yaw, travel + Math.PI);
  const d = Math.abs(dA) <= Math.abs(dB) ? dA : dB;
  P.autoYaw = { target: P.yaw + d };
  P.airLabel = out > 0 ? 'Frontside Air' : 'Backside Air';
  return true;
}

/* =====================================================================
   ZEN — the endless backcountry with nothing to chase: no gates, no lives,
   no score. Wipeouts just pick you back up.
   ===================================================================== */
Level.define({
  id: 'zen', name: 'Zen', blurb: 'Endless mountain · no gates, lives or score',
  height: mtnHeightAt, centerX: mtnCenterX,
  clearHalf: PISTE_HALF * 0.95, gates: false, zen: true, finishZ: null, spawnZ: 0,
  absorbCrests: true, rampLip: mtnRampLip
});

/* =====================================================================
   HALF-PIPE
   ===================================================================== */
const PIPE = { B: 5.0, R: 4.4, SLOPE: 0.30, START: -30, LEN: 430, DECK: 12 };
function pipeEnv(z) { return sstep(PIPE.START - 25, PIPE.START + 5, z) * sstep(PIPE.LEN + 40, PIPE.LEN, z); }

Level.define({
  id: 'pipe', name: 'Half-pipe', blurb: 'Competition pipe · carve the walls · boost the lip',
  clearHalf: 26, gates: false, finishZ: PIPE.LEN + 70, spawnZ: 4, airMin: 0.6,
  lengths: [{ key: 'short', label: '430 m', z: 430 }, { key: 'medium', label: '800 m', z: 800 }, { key: 'long', label: '1.2 km', z: 1200 }],
  defaultLength: 0,
  setLength(i) { PIPE.LEN = this.lengths[i].z; this.finishZ = PIPE.LEN + 70; },
  spawnSpeed: 12.5, wallAssist: 0.8,
  sunDir: [-0.30, 0.78, -0.45], sunScale: 0.8,   // high sun: the pipe floor isn't lost in the wall's shadow
  lod: [80, 40, 20],
  cam: { lockHeading: true, dist: 1.25, elev: 0.58 },
  centerX: () => 0,
  height(x, z) {
    const ax = Math.abs(x), env = pipeEnv(z);
    const lipX = PIPE.B + PIPE.R;
    let h = -z * PIPE.SLOPE;
    if (ax < lipX) h += pipeWall(ax, PIPE.B, PIPE.R) * env;
    else {
      const e = ax - lipX;
      h += PIPE.R * env + Math.min(e, PIPE.DECK) * 0.02;                    // flat deck
      if (e > PIPE.DECK) h += Math.pow(e - PIPE.DECK, 1.3) * 0.35;           // outer banks
    }
    return h;
  },
  lip(P) { return pipeLipLaunch(P, 0, PIPE.B, PIPE.R, pipeEnv(P.pos.z)); },
  decor() {
    const g = Geo(), lipX = PIPE.B + PIPE.R, STEEL = [0.62, 0.66, 0.72], BLUE = [0.16, 0.42, 0.82];
    // metal coping along both lips, in sloped segments that follow the deck
    for (let z = PIPE.START + 8; z < PIPE.LEN; z += 10) {
      for (const s of [-1, 1]) {
        const x = s * (lipX + 0.08);
        geoBeam(g, [x, heightAt(x + s * 0.4, z) + 0.06, z], [x, heightAt(x + s * 0.4, z + 10) + 0.06, z + 10], 0.16, 0.16, STEEL);
      }
    }
    // judges' marker poles along the deck every 50 m
    for (let z = 20; z < PIPE.LEN; z += 50) {
      for (const s of [-1, 1]) {
        const x = s * (lipX + 4), y = heightAt(x, z);
        geoBeam(g, [x, y - 0.2, z], [x, y + 2.2, z], 0.12, 0.12, BLUE);
        geoBeam(g, [x, y + 1.6, z], [x + s * 0.9, y + 1.6, z], 0.06, 0.6, BLUE);
      }
    }
    geoFinishArch(g, this.finishZ, 12);
    return g;
  }
});

/* =====================================================================
   PARK
   ===================================================================== */
const PARK = { SLOPE: 0.22, HALF: 26, LAP: 800, LEN: 800 };
/* one lap of the course; longer runs repeat it (alternate laps mirrored) */
const PARK_LAP = [
  // tabletops: x, z (start of take-off), half-width, take-off length, top length, landing length, height
  { k: 'table', x: -9, z: 40, w: 5, up: 6, top: 3, down: 8, h: 1.3 },
  { k: 'table', x: 0, z: 100, w: 6, up: 7, top: 6, down: 10, h: 2.0 },
  { k: 'table', x: -13, z: 160, w: 4, up: 6, top: 3, down: 8, h: 1.3 },
  { k: 'table', x: 13, z: 160, w: 4, up: 6, top: 3, down: 8, h: 1.3 },
  { k: 'rollers', z0: 215, z1: 262, amp: 0.9, wl: 11 },
  { k: 'table', x: 0, z: 290, w: 7, up: 8, top: 9, down: 13, h: 2.8 },
  { k: 'mini', z0: 345, z1: 425, B: 3.5, R: 3.6 },
  { k: 'table', x: -8, z: 520, w: 5, up: 7, top: 5, down: 9, h: 1.8 },
  { k: 'table', x: 0, z: 640, w: 7, up: 8, top: 10, down: 14, h: 3.0 },
  // HIGH RAMP: the big one — steep take-off, short deck, long landing
  { k: 'table', x: 0, z: 705, w: 8, up: 13, top: 3, down: 36, h: 6.5, big: true },
];
const PARK_LAP_RAILS = [
  // x0, z0 → x1, z1 ; height (m above the snow once past the ride-on entry)
  { x0: 9, z0: 36, x1: 9, z1: 52, h: 0.5 },
  { x0: 0, z0: 155, x1: 0, z1: 176, h: 0.55 },
  { x0: -6, z0: 455, x1: -6, z1: 474, h: 0.5 },
  { x0: 6, z0: 455, x1: 6, z1: 474, h: 0.5 },
  { x0: 9, z0: 515, x1: 9, z1: 532, h: 0.5 },
  { x0: 0, z0: 572, x1: 0, z1: 598, h: 0.6 },
];
// the live course (rebuilt in place — Level.rails and the physics hold these arrays)
const PARK_FEATURES = [], PARK_RAILS = [];
function buildPark(laps) {
  PARK_FEATURES.length = 0; PARK_RAILS.length = 0;
  for (let l = 0; l < laps; l++) {
    const dz = l * PARK.LAP, mx = l % 2 ? -1 : 1;           // odd laps mirrored for variety
    for (const f of PARK_LAP) {
      const c = Object.assign({}, f);
      if (c.z !== undefined) c.z += dz;
      if (c.z0 !== undefined) { c.z0 += dz; c.z1 += dz; }
      if (c.x !== undefined) c.x *= mx;
      PARK_FEATURES.push(c);
    }
    for (const r0 of PARK_LAP_RAILS) {
      const r = { x0: r0.x0 * mx, z0: r0.z0 + dz, x1: r0.x1 * mx, z1: r0.z1 + dz, h: r0.h };
      const dx = r.x1 - r.x0, dzz = r.z1 - r.z0;
      r.len = Math.hypot(dx, dzz); r.ux = dx / r.len; r.uz = dzz / r.len;
      r.zmin = Math.min(r.z0, r.z1); r.zmax = Math.max(r.z0, r.z1);
      PARK_RAILS.push(r);
    }
  }
  PARK.LEN = laps * PARK.LAP;
}
buildPark(1);
/* rail top height: flush with the snow at the start, rising to r.h over ~1.5 m
   (a ride-on rail), so you can roll straight onto it or ollie on anywhere */
function railTop(r, t) {
  const x = r.x0 + r.ux * t, z = r.z0 + r.uz * t;
  return heightAt(x, z) + Math.min(r.h, 0.05 + Math.max(0, t) * 0.33);
}

function miniEnv(f, z) { return sstep(f.z0, f.z0 + 8, z) * sstep(f.z1, f.z1 - 8, z); }

Level.define({
  id: 'park', name: 'Park', blurb: 'Tabletops · high ramp · mini-pipe · rails',
  clearHalf: 30, gates: false, finishZ: PARK.LEN, spawnZ: 4, airMin: 0.7,
  lengths: [{ key: 'short', label: '1 lap', laps: 1 }, { key: 'medium', label: '2 laps', laps: 2 }, { key: 'long', label: '3 laps', laps: 3 }],
  defaultLength: 0,
  setLength(i) { buildPark(this.lengths[i].laps); this.finishZ = PARK.LEN; },
  spawnSpeed: 9, wallAssist: 0.8,
  sunDir: [-0.30, 0.78, -0.45], sunScale: 0.8,
  lod: [80, 40, 20],
  cam: { lockHeading: false, dist: 1.1, elev: 0.48 },
  rails: PARK_RAILS,
  centerX: () => 0,
  height(x, z) {
    const ax = Math.abs(x);
    let h = -z * PARK.SLOPE;
    if (ax > PARK.HALF) h += Math.pow(ax - PARK.HALF, 1.4) * 0.45;           // banks keep you on the run
    for (const f of PARK_FEATURES) {
      if (f.k === 'table') {
        const u = z - f.z;
        if (u < 0 || u > f.up + f.top + f.down) continue;
        const m = sstep(f.w + 1.2, f.w, Math.abs(x - f.x));
        if (m <= 0) continue;
        let p;
        if (u < f.up) p = f.h * Math.pow(u / f.up, 1.7);                     // concave take-off
        else if (u < f.up + f.top) p = f.h;                                   // deck
        else p = f.h * (1 - sstep(0, 1, (u - f.up - f.top) / f.down));      // landing
        h += p * m;
      } else if (f.k === 'rollers') {
        if (z < f.z0 || z > f.z1) continue;
        const s = Math.sin((z - f.z0) / f.wl * Math.PI);
        h += f.amp * s * s * clamp((PARK.HALF + 2 - ax) / 4, 0, 1);   // fade out (not invert) on the banks
      } else if (f.k === 'mini') {
        const env = miniEnv(f, z);
        if (env <= 0) continue;
        const lip = f.B + f.R;
        h += (ax < lip ? pipeWall(ax, f.B, f.R) : f.R) * env * (ax > PARK.HALF ? Math.max(0, 1 - (ax - PARK.HALF) / 3) : 1);
      }
    }
    return h;
  },
  lip(P) {
    for (const f of PARK_FEATURES) {
      if (f.k !== 'mini' || P.pos.z < f.z0 || P.pos.z > f.z1) continue;
      return pipeLipLaunch(P, 0, f.B, f.R, miniEnv(f, P.pos.z));
    }
    return false;
  },
  decor() {
    const g = Geo(), RAIL = [1.0, 0.78, 0.12], POST = [0.20, 0.22, 0.27], ORANGE = [1.0, 0.45, 0.1], STEEL = [0.66, 0.70, 0.76];
    for (const r of PARK_RAILS) {
      // rail bar in short segments so it follows the snow and the ride-on ramp
      const N = Math.ceil(r.len / 1.0);
      for (let i = 0; i < N; i++) {
        const t0 = i / N * r.len, t1 = (i + 1) / N * r.len;
        geoBeam(g, [r.x0 + r.ux * t0, railTop(r, t0) - 0.03, r.z0 + r.uz * t0],
                   [r.x0 + r.ux * t1, railTop(r, t1) - 0.04, r.z0 + r.uz * t1], 0.13, 0.09, RAIL);
      }
      for (let t = 2.5; t < r.len; t += 4) {                                 // support posts
        const x = r.x0 + r.ux * t, z = r.z0 + r.uz * t;
        geoBeam(g, [x, heightAt(x, z) - 0.2, z], [x, railTop(r, t) - 0.07, z], 0.07, 0.07, POST);
      }
    }
    // orange marker sticks at each take-off lip so features read from afar
    for (const f of PARK_FEATURES) {
      if (f.k !== 'table') continue;
      for (const s of [-1, 1]) {
        const x = f.x + s * (f.w + 0.6), z = f.z + f.up, y = heightAt(x, z);
        geoBeam(g, [x, y - 0.2, z], [x, y + (f.big ? 3.0 : 1.4), z], f.big ? 0.14 : 0.08, f.big ? 0.14 : 0.08, ORANGE);
      }
    }
    // mini-pipe coping
    for (const f of PARK_FEATURES) {
      if (f.k !== 'mini') continue;
      for (let z = f.z0 + 8; z < f.z1 - 8; z += 8) for (const s of [-1, 1]) {
        const x = s * (f.B + f.R + 0.08);
        geoBeam(g, [x, heightAt(x + s * 0.3, z) + 0.05, z], [x, heightAt(x + s * 0.3, z + 8) + 0.05, z + 8], 0.13, 0.13, STEEL);
      }
    }
    geoFinishArch(g, this.finishZ, 20);
    return g;
  }
});
