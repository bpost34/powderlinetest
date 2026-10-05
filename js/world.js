/* =====================================================================
   world.js — the mountain. Everything here is generated from a seed at
   runtime: an analytic height function h(x,z), streamed LOD chunks,
   natural kickers, glades and race gates. The physics samples the very
   same h(x,z), so terrain and collision can never disagree.

   Convention: +X = across the valley, +Y = up, +Z = down the mountain.
   ===================================================================== */
'use strict';

const SEED = 1337;
const SLOPE = 0.34;          // average grade (rise/run)
const PISTE_HALF = 30;       // groomed corridor half-width
const WALL_START = 82;       // where the valley walls close in

/* ---------------- deterministic noise ---------------- */
function hash2(i, j, s) {
  let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s | 0, SEED + 1103515245);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s),
        c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}
function fbm(x, y, oct, s) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x, y, s + i * 977) * amp;
    norm += amp;
    x *= 2.03; y *= 2.01; amp *= 0.5;
  }
  return sum / norm;            // 0..1
}

/* The fall line: the mountain meanders, so you can never just hold straight.
   Memoised on the last z: terrain rows and normalAt() sample many x at one z,
   and every height sample needs the centre line (~20% of chunk build time). */
let _cxZ = NaN, _cxV = 0;
function mtnCenterX(z) {
  if (z === _cxZ) return _cxV;
  _cxZ = z;
  return _cxV = (z * 0.11) * Math.sin(z * 0.0032) +
         Math.sin(z * 0.0071) * 34 +
         Math.sin(z * 0.0019 + 1.7) * 58 +
         (fbm(0.5, z * 0.0022, 3, 31) - 0.5) * 40;
}

/* ---------------- feature generation (kickers / rollers) ---------------- */
const SEG = 74;                        // a feature zone every SEG metres
const _featCache = new Map();

function featureAt(segIndex) {
  let f = _featCache.get(segIndex);
  if (f !== undefined) return f;
  const r1 = hash2(segIndex, 17, 5), r2 = hash2(segIndex, 29, 9), r3 = hash2(segIndex, 41, 13);
  const z0 = segIndex * SEG;
  if (segIndex < 2) { f = null; _featCache.set(segIndex, f); return f; }
  const kind = r1 < 0.44 ? 'kicker' : (r1 < 0.62 ? 'rollers' : (r1 < 0.74 ? 'pipe' : (r1 < 0.84 ? 'ramp' : null)));
  if (!kind) { f = null; _featCache.set(segIndex, f); return f; }
  const cx = mtnCenterX(z0);
  if (kind === 'ramp') {
    // HIGH RAMP: a built kicker — steep concave take-off to a sharp lip, then a long
    // landing. Unlike the natural rollers, its lip launches you (see mtnRampLip).
    f = { kind, z: z0 + 20 + r2 * 20, x: cx + (r3 - 0.5) * PISTE_HALF * 0.6,
          h: 6.0 + r2 * 2.5, L: 14 + r3 * 4, D: 44, w: 6 + r2 * 2 };
    _featCache.set(segIndex, f);
    return f;
  }
  f = {
    kind, z: z0 + r2 * 30, x: cx + (r3 - 0.5) * PISTE_HALF * 1.1,
    h: kind === 'kicker' ? 3.4 + r1 * 3.6 : 1.15,
    L: kind === 'kicker' ? 12 + r2 * 6 : 9,
    rad: kind === 'kicker' ? 15 + r3 * 9 : 13,
    a: (hash2(segIndex, 61, 3) - 0.5) * 0.5,
    n: kind === 'rollers' ? 3 : 1,
    gap: 26
  };
  if (_featCache.size > 400) { const k = _featCache.keys().next().value; _featCache.delete(k); }
  _featCache.set(segIndex, f);
  return f;
}

function rampBump(x, z, k) {
  const v = Math.abs(x - k.x);
  if (v > k.w + 3) return 0;
  const u = z - k.z;                               // 0 = the lip
  if (u < -k.L || u > k.D) return 0;
  const m = sstep(k.w + 3, k.w, v);                // side walls fall away
  const p = u < 0 ? k.h * Math.pow((u + k.L) / k.L, 1.8)         // take-off: steepens into the lip
                  : k.h * (1 - sstep(0, 1, u / k.D));            // long landing back to the slope
  return p * m;
}
/* is (x, z) on a high ramp's lip? (natural crests are absorbed; ramps launch) */
function mtnRampLip(x, z) {
  const s0 = Math.floor((z + 40) / SEG);
  for (let i = 0; i < 3; i++) {
    const k = featureAt(s0 + i - 1);
    if (k && k.kind === 'ramp' && Math.abs(x - k.x) < k.w && z > k.z - 3 && z < k.z + 1.5) return true;
  }
  return false;
}

function kickerBump(x, z, k) {
  const c = Math.cos(k.a), s = Math.sin(k.a);
  const dx = x - k.x, dz = z - k.z;
  const u = dx * s + dz * c;      // along the ramp (positive = downhill)
  const v = dx * c - dz * s;      // across it
  if (Math.abs(v) > k.rad * 2.2) return 0;
  let h = 0;
  const lat = Math.exp(-(v * v) / (2 * k.rad * k.rad * 0.42));      // same for every roller
  for (let i = 0; i < k.n; i++) {
    const uu = u - i * k.gap;
    if (uu < -k.L || uu > k.rad) continue;
    if (uu < 0) h += k.h * sstep(-k.L, 0, uu) * lat;
    else h += k.h * Math.exp(-(uu * uu) / (2 * 4.6 * 4.6)) * lat;
  }
  return h;
}

/* ---------------- the height function ---------------- */
function mtnHeightAt(x, z) {
  const cx = mtnCenterX(z);
  const d = Math.abs(x - cx);
  const rough = sstep(PISTE_HALF * 0.55, PISTE_HALF * 2.1, d);   // 0 = groomed

  let y = -z * SLOPE;
  // long rollers
  y += (fbm(x * 0.0042, z * 0.0034, 3, 7) - 0.5) * (7 + 30 * rough);
  // medium features
  y += (fbm(x * 0.021, z * 0.018, 4, 23) - 0.5) * (1.4 + 10 * rough);
  // chopped / corduroy micro detail
  y += (fbm(x * 0.13, z * 0.12, 2, 43) - 0.5) * (0.16 + 1.5 * rough);
  // groomed corduroy lines on the piste
  y += Math.sin((x - cx) * 1.1) * 0.035 * (1 - rough);

  // valley walls close in
  if (d > WALL_START) {
    const e = (d - WALL_START) / 60;
    y += Math.pow(e, 1.75) * 62;
  }

  // natural kickers
  const s0 = Math.floor((z + 40) / SEG);
  for (let i = 0; i < 3; i++) {
    const k = featureAt(s0 + i - 1);
    if (k) y += k.kind === 'ramp' ? rampBump(x, z, k) : kickerBump(x, z, k);
  }
  return y;
}

/* ---------------- levels ----------------
   Every system (physics, chunks, props, camera, gates) reads the terrain through
   heightAt / centerX, which dispatch to the current level. The mountain is the
   original endless backcountry run; levels.js adds the half-pipe and the park. */
const Level = {
  defs: {},
  cur: null,
  define(def) { this.defs[def.id] = def; if (!this.cur) this.cur = def; },
};
Level.define({
  id: 'mountain', name: 'Backcountry', blurb: 'Mountain run · gates · kickers · high ramps',
  height: mtnHeightAt, centerX: mtnCenterX,
  clearHalf: PISTE_HALF * 0.95, gates: true, finishZ: 2500, spawnZ: 0,
  absorbCrests: true,     // rollers/kickers only send you airborne if you ollie…
  rampLip: mtnRampLip,    // …but built high ramps launch you off their lip
  lengths: [{ key: 'short', label: '1.2 km', z: 1200 }, { key: 'medium', label: '2.5 km', z: 2500 }, { key: 'long', label: '5 km', z: 5000 }],
  defaultLength: 1,
  setLength(i) { this.finishZ = this.lengths[i].z; },
  decor() { const g = Geo(); geoFinishArch(g, this.finishZ, PISTE_HALF + 4, mtnCenterX(this.finishZ)); return g; }
});
function heightAt(x, z) { return Level.cur.height(x, z); }
function centerX(z) { return Level.cur.centerX(z); }

const _n = V3();
function normalAt(x, z, out) {
  const e = 0.75;
  const hL = heightAt(x - e, z), hR = heightAt(x + e, z);
  const hD = heightAt(x, z - e), hU = heightAt(x, z + e);
  out = out || _n;
  return V3.norm(out, V3.set(out, hL - hR, 2 * e, hD - hU));
}

/* =========================================================================
   Chunk streaming
   ========================================================================= */
const CHUNK = 40;
const LODS = [{ r: 1, res: 40 }, { r: 3, res: 20 }, { r: 6, res: 10 }];
const VIEW_R = 6;

class Chunk {
  constructor(ix, iz) {
    this.ix = ix; this.iz = iz;
    this.x0 = ix * CHUNK; this.z0 = iz * CHUNK;
    this.lods = [null, null, null];
    this.props = null;
    this.scatter();
  }

  /* trees + boulders, deterministic per chunk */
  scatter() {
    const t = [], b = [];
    const n = Level.cur.height === mtnHeightAt ? 78 : 46;
    for (let i = 0; i < n; i++) {
      const rx = hash2(this.ix * 31 + i, this.iz * 17 + 3, 101);
      const rz = hash2(this.ix * 13 + i, this.iz * 29 + 7, 202);
      const x = this.x0 + rx * CHUNK, z = this.z0 + rz * CHUNK;
      const cx = centerX(z), d = Math.abs(x - cx);
      const clear = Level.cur.clearHalf;
      // the forest climbs the valley walls (thinning out toward the ridgeline)
      if (d < clear || d > WALL_START + 125) continue;
      const y = heightAt(x, z);
      const nz = normalAt(x, z, { x: 0, y: 0, z: 0 });
      if (nz.y < 0.5) continue;
      const wall = sstep(WALL_START, WALL_START + 125, d);
      const dense = sstep(clear, clear + 12, d) * (1 - wall * 0.55) * sstep(0.5, 0.62, nz.y)
        * (0.55 + 0.45 * fbm(x * 0.012, z * 0.012, 2, 31) * 2 - 0.45);     // glades and stands
      if (hash2(i, this.ix + this.iz * 7, 303) > dense * 0.92) continue;
      const sc = 0.75 + hash2(i, 9, 404) * 0.85;
      t.push({ x, y, z, sc, rot: hash2(i, 5, 505) * TAU, sway: hash2(i, 7, 606) * TAU,
               shape: hash2(i, this.ix * 3 + this.iz, 707) < 0.55 ? 0 : 1, tall: 0.9 + hash2(i, 11, 808) * 0.25 });
      const tr = t[t.length - 1];
      tr.c = Math.cos(tr.rot); tr.s = Math.sin(tr.rot);                     // instance matrix, cached
      tr.shade = 0.78 + hash2(Math.floor(x), Math.floor(z), 77) * 0.42;
    }
    // occasional boulders on the rideable slope beside the run — never up on the
    // valley walls (where they read as floating snowballs) or on steep ground.
    // Mountain terrain only; the built courses stay clean.
    if (Level.cur.height === mtnHeightAt) {
      for (let i = 0; i < 4; i++) {
        if (hash2(this.ix * 19 + i, this.iz * 23 + 5, 919) > 0.2) continue;     // occasional
        const x = this.x0 + hash2(this.ix * 71 + i, this.iz * 37 + 11, 707) * CHUNK;
        const z = this.z0 + hash2(this.ix * 53 + i, this.iz * 61 + 13, 808) * CHUNK;
        if (z < 60) continue;                                                     // keep the start clear
        const gz = ((z - 90) % GATE_SPACING + GATE_SPACING) % GATE_SPACING;
        if (gz < 12 || gz > GATE_SPACING - 12) continue;                         // keep gate lines clear
        const d = Math.abs(x - centerX(z));
        if (d < 8 || d > 55) continue;                                            // near the path, off the walls
        if (normalAt(x, z, { x: 0, y: 0, z: 0 }).y < 0.88) continue;              // no steep ground
        b.push({ x, y: heightAt(x, z), z, sc: 0.8 + hash2(i, this.ix * 3 + this.iz, 909) * 1.1, rot: hash2(i, 1, 111) * TAU });
      }
    }
    this.props = { trees: t, rocks: b };
  }

  /* build the vertex/index data for one LOD (skirted to hide cracks).
     Emits the shared STRIDE layout (pos, normal, colour) so GL.upload can
     treat terrain exactly like every other mesh. */
  build(res) {
    const cell = CHUNK / res;
    const n = res + 3;                       // grid indices -1 .. res+1
    const v = new Float32Array(n * n * STRIDE);

    // Pass 1: sample the raw heights once per grid vertex.
    const h = new Float32Array(n * n);
    let yMin = Infinity, yMax = -Infinity;
    for (let j = 0; j < n; j++) {
      const z = this.z0 + (j - 1) * cell;
      for (let i = 0; i < n; i++) {
        const y = h[j * n + i] = heightAt(this.x0 + (i - 1) * cell, z);
        if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      }
    }
    // bounding sphere for frustum culling (skirt drops a little below yMin)
    this.yMid = (yMin + yMax) * 0.5;
    this.rad = Math.hypot(CHUNK * 0.75, (yMax - yMin) * 0.5 + 2);

    // Pass 2: emit vertices. Normals come from central differences of the
    // heights we already sampled, which removes the 4 extra heightAt() calls
    // per vertex that normalAt() would have made (~5x fewer evals, and this
    // loop is what made prewarm cost seconds).
    const skirt = cell * 1.2 + 0.25;
    const mtn = Level.cur.height === mtnHeightAt, clear = Level.cur.clearHalf || 0;
    let p = 0;
    for (let j = 0; j < n; j++) {
      const gz = j - 1;
      const zRow = this.z0 + gz * cell, cxRow = centerX(zRow);
      for (let i = 0; i < n; i++) {
        const gx = i - 1;
        const idx = j * n + i;
        // neighbour indices, clamped at the grid edge (never wraps a row)
        const iL = i > 0 ? idx - 1 : idx, iR = i < n - 1 ? idx + 1 : idx;
        const jD = j > 0 ? idx - n : idx, jU = j < n - 1 ? idx + n : idx;
        // normal of y = h(x,z) is (h(x-e)-h(x+e), 2e, h(z-e)-h(z+e))
        let nx = h[iL] - h[iR], ny = 2 * cell, nz = h[jD] - h[jU];
        let l = Math.hypot(nx, ny, nz);
        if (!(l > 1e-8)) { nx = 0; ny = 1; nz = 0; l = 1; }     // degenerate guard
        let y = h[idx];
        if (gx < 0 || gz < 0 || gx > res || gz > res) y -= skirt;   // drop the skirt ring
        v[p++] = this.x0 + gx * cell; v[p++] = y; v[p++] = this.z0 + gz * cell;
        v[p++] = nx / l; v[p++] = ny / l; v[p++] = nz / l;
        // colour carries terrain hints for the shader (albedo itself is procedural):
        //  r = forest cover (matches the tree scatter; painted as distant canopy)
        //  g = cavity: 0.5 flat, < 0.5 hollow, > 0.5 crest (from the height Laplacian)
        //  b = valley-wall factor (exposed rock bands)
        const xv = this.x0 + gx * cell, d = Math.abs(xv - cxRow);
        let forest = 0, wall = 0;
        if (mtn) {
          wall = sstep(WALL_START, WALL_START + 70, d);
          forest = sstep(clear + 4, clear + 20, d) * (1 - sstep(WALL_START + 130, WALL_START + 260, d))
            * sstep(0.30, 0.50, ny / l) * clamp(0.45 + fbm(xv * 0.012, zRow * 0.012, 2, 31) * 1.1, 0, 1);
        }
        const lap = (h[iL] + h[iR] + h[jD] + h[jU] - 4 * h[idx]) / (cell * cell);
        v[p++] = forest; v[p++] = clamp(0.5 - lap * 1.6, 0, 1); v[p++] = wall;
      }
    }
    // n×n vertices (including the skirt ring) → (n-1)² quads
    const i = new Uint32Array((n - 1) * (n - 1) * 6);
    let q = 0;
    for (let j = 0; j < n - 1; j++) {
      for (let k = 0; k < n - 1; k++) {
        const a = j * n + k, b = a + 1, c = a + n, d = c + 1;
        i[q++] = a; i[q++] = c; i[q++] = b;
        i[q++] = b; i[q++] = c; i[q++] = d;
      }
    }
    return { v, i, count: i.length, stride: STRIDE };
  }
}

const World = {
  chunks: new Map(),
  visible: [],

  key(ix, iz) { return ix * 100000 + iz; },

  /* drop every chunk (CPU + GPU) — used when the level changes */
  reset() {
    this.chunks.clear(); this.visible.length = 0;
    _featCache.clear();
    if (typeof GL !== 'undefined' && GL.purgeChunks) GL.purgeChunks();
  },

  get(ix, iz) {
    const k = this.key(ix, iz);
    let c = this.chunks.get(k);
    if (!c) { c = new Chunk(ix, iz); this.chunks.set(k, c); }
    return c;
  },

  update(px, pz) {
    const cix = Math.floor(px / CHUNK), ciz = Math.floor(pz / CHUNK);
    this.visible.length = 0;
    const pending = [];
    for (let ring = 0; ring <= VIEW_R; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const ix = cix + dx, iz = ciz + dz;
          const c = this.get(ix, iz);
          let lod = LODS.length - 1;
          for (let l = 0; l < LODS.length; l++) if (ring <= LODS[l].r) { lod = l; break; }
          // remember which LOD we asked for so the renderer never requests one
          // that was never built (it would return null and punch a hole)
          c.wantLod = lod;
          if (!c.lods[lod]) pending.push([c, lod]);
          this.visible.push(c);
        }
      }
    }
    // build at most a couple of meshes per frame to stay smooth (nearest first)
    const budget = 3;
    for (let i = 0; i < pending.length && i < budget; i++) {
      const [c, lod] = pending[i];
      c.lods[lod] = c.build(LODS[lod].res);
    }
    // garbage collect far chunks
    if (this.chunks.size > 340) {
      for (const [k, c] of this.chunks) {
        if (Math.abs(c.ix - cix) > VIEW_R + 4 || Math.abs(c.iz - ciz) > VIEW_R + 4) this.chunks.delete(k);
      }
    }
  },

  /* synchronous fill of the near field so the first frame is not full of holes */
  /* Build ONLY the LOD that update() would choose for each ring — building all
     three cost ~2.4 s of synchronous stall at startup/restart. */
  lodForRing(ring) {
    for (let l = 0; l < LODS.length; l++) if (ring <= LODS[l].r) return l;
    return LODS.length - 1;
  },

  prewarm(px, pz, radius) {
    const R = radius === undefined ? 3 : radius;
    const cix = Math.floor(px / CHUNK), ciz = Math.floor(pz / CHUNK);
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const c = this.get(cix + dx, ciz + dz);
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      const lod = this.lodForRing(ring);
      c.wantLod = lod;
      if (!c.lods[lod]) c.lods[lod] = c.build(LODS[lod].res);
    }
  },

  /* gather props of visible chunks (trees/rocks) — used by renderer + physics */
  propsNear(x, z, span, outT, outR) {
    outT.length = 0; outR.length = 0;
    const cix = Math.floor(x / CHUNK), ciz = Math.floor(z / CHUNK), s = Math.ceil(span / CHUNK);
    for (let dz = -s; dz <= s; dz++) for (let dx = -s; dx <= s; dx++) {
      const c = this.chunks.get(this.key(cix + dx, ciz + dz));
      if (!c) continue;
      for (const t of c.props.trees) if (Math.abs(t.x - x) < span && Math.abs(t.z - z) < span) outT.push(t);
      for (const r of c.props.rocks) if (Math.abs(r.x - x) < span && Math.abs(r.z - z) < span) outR.push(r);
    }
  }
};

/* =========================================================================
   Gates — the line you're meant to ride. Alternating sides, every ~150m.
   ========================================================================= */
const GATE_SPACING = 150;
const Gates = {
  list: [],
  next: 0,
  reset() { this.list.length = 0; this.next = 0; },
  ensure(zAhead) {
    if (!Level.cur.gates) return;
    while (this.next * GATE_SPACING < zAhead) {
      const i = this.next++;
      const z = i * GATE_SPACING + 90;
      const cx = centerX(z);
      const side = (i % 2 === 0 ? -1 : 1) * (hash2(i, 3, 17) * PISTE_HALF * 0.72 + 3);
      this.list.push({
        z, x: cx + side, w: 13 + hash2(i, 9, 21) * 7,
        hit: false, missed: false, i
      });
    }
  },
  /* drop gates well behind the rider (the old test compared against a fixed -200,
     which never became true as z only increases) */
  trim(behindZ) {
    while (this.list.length && this.list[0].z < behindZ - 300) this.list.shift();
  },
  upcoming() {
    for (const g of this.list) if (!g.hit && !g.missed) return g;
    return null;
  }
};
