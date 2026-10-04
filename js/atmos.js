/* =====================================================================
   atmos.js — time of day for Zen: Day, Night (moonlight, stars, warm lamps
   along the run) and Neon (synthwave night: neon grid, neon lamps, glowing
   tracks). Other levels always ride in daylight.
   Each preset just retunes the existing lighting (sun/moon, sky, fog, haze,
   exposure, bloom); lamps add soft point lights to the shared shader.
   ===================================================================== */
'use strict';

const ATMOS_PRESETS = {
  day: {
    sunDir: [-0.42, 0.62, -0.55], sunColor: [1.30, 1.16, 0.94],
    skyTint: [0.42, 0.55, 0.78], groundTint: [0.30, 0.35, 0.44],
    fogColor: [0.72, 0.81, 0.93], fogDensity: 0.0026,
    zenith: [0.13, 0.32, 0.68], horizon: [0.78, 0.86, 0.96], clear: [0.62, 0.74, 0.90],
    haze: [0.76, 0.84, 0.95], mtnAmbLo: [0.34, 0.42, 0.58], mtnAmbHi: [0.62, 0.72, 0.90],
    exposure: 1.02, bloomThresh: 1.05, stars: 0, cloudLum: 1, neon: 0,
    trail: [0.42, 0.53, 0.74], trailAdd: false, flake: [1, 1, 1, 0.85], lamps: null, riderLight: null
  },
  night: {
    sunDir: [0.30, 0.55, -0.62], sunColor: [0.30, 0.38, 0.62],        // the moon
    skyTint: [0.07, 0.10, 0.19], groundTint: [0.05, 0.06, 0.10],
    fogColor: [0.06, 0.085, 0.16], fogDensity: 0.0032,
    zenith: [0.008, 0.016, 0.05], horizon: [0.07, 0.10, 0.19], clear: [0.065, 0.09, 0.175],
    haze: [0.065, 0.09, 0.17], mtnAmbLo: [0.05, 0.06, 0.10], mtnAmbHi: [0.13, 0.16, 0.27],
    exposure: 1.3, bloomThresh: 0.7, stars: 1, cloudLum: 0.10, neon: 0,
    trail: [0.10, 0.14, 0.30], trailAdd: false, flake: [0.80, 0.86, 1.0, 0.55],
    lamps: 'warm', riderLight: [0.30, 0.40, 0.65, 11], spray: [0.42, 0.48, 0.66]
  },
  neon: {
    sunDir: [0.30, 0.55, -0.62], sunColor: [0.13, 0.10, 0.28],
    skyTint: [0.07, 0.03, 0.14], groundTint: [0.03, 0.01, 0.05],
    fogColor: [0.16, 0.04, 0.20], fogDensity: 0.0030,
    zenith: [0.015, 0.0, 0.05], horizon: [0.22, 0.05, 0.27], clear: [0.17, 0.045, 0.21],
    haze: [0.18, 0.05, 0.23], mtnAmbLo: [0.06, 0.02, 0.10], mtnAmbHi: [0.20, 0.08, 0.30],
    exposure: 1.15, bloomThresh: 0.65, stars: 0.7, cloudLum: 0.12, neon: 1.0,
    neonA: [0.10, 0.95, 1.0], neonB: [1.0, 0.20, 0.85],
    trail: [0.25, 1.0, 1.0], trailAdd: true, flake: [0.85, 0.75, 1.0, 0.5],
    lamps: 'neon', riderLight: [0.55, 0.16, 0.65, 9], spray: [0.62, 0.48, 0.85]
  }
};
const ATMOS_ORDER = ['day', 'night', 'neon'];
const NEON_LAMP_COLS = [[1.0, 0.18, 0.80], [0.15, 0.90, 1.0], [0.55, 1.0, 0.25], [0.65, 0.30, 1.0]];
const LAMP_SPACING = 32;

const Atmos = {
  zenMode: 'day',      // the rider's choice for Zen (persisted)
  mode: 'day',         // what's actually applied (always day outside Zen)
  p: ATMOS_PRESETS.day,
  lightPos: new Float32Array(32), lightCol: new Float32Array(32), lightN: 0,

  load() {
    try { const m = localStorage.getItem('powderline.atmos'); if (ATMOS_PRESETS[m]) this.zenMode = m; } catch (e) { }
  },

  /* apply the right preset for the current level */
  refresh() {
    this.mode = Level.cur.zen ? this.zenMode : 'day';
    this.p = ATMOS_PRESETS[this.mode];
    const p = this.p;
    V3.norm(Sun.dir, V3(p.sunDir[0], p.sunDir[1], p.sunDir[2]));
    Sun.color = p.sunColor.slice(); Sun.skyTint = p.skyTint.slice(); Sun.groundTint = p.groundTint.slice();
    Sun.fogColor = p.fogColor.slice(); Sun.fogDensity = p.fogDensity;
    document.body.classList.toggle('night', this.mode !== 'day');
    const b = document.getElementById('atmosBtn');
    if (b) { b.textContent = { day: '☀', night: '☾', neon: '✦' }[this.zenMode]; b.title = 'Atmosphere: ' + this.zenMode + ' (N)'; }
    if (this.mode === 'day') this.lightN = 0;
  },

  cycle() {
    this.zenMode = ATMOS_ORDER[(ATMOS_ORDER.indexOf(this.zenMode) + 1) % ATMOS_ORDER.length];
    try { localStorage.setItem('powderline.atmos', this.zenMode); } catch (e) { }
    this.refresh();
  },

  /* lamps: one every LAMP_SPACING metres, alternating sides at the edge of the run */
  lampAt(k) {
    const z = k * LAMP_SPACING + 12;
    const side = k % 2 ? 1 : -1;
    const x = centerX(z) + side * (PISTE_HALF * 0.82 + hash2(k, 5, 77) * 4);
    const col = this.p.lamps === 'neon' ? NEON_LAMP_COLS[k % NEON_LAMP_COLS.length] : [1.0, 0.72, 0.42];
    return { x, y: heightAt(x, z), z, col };
  },

  /* per frame: the nearest lamps (+ a soft glow around the rider) become point lights */
  update(P) {
    if (!this.p.lamps) { this.lightN = 0; return; }
    const lights = [];
    const k0 = Math.floor((P.pos.z - 12) / LAMP_SPACING);
    for (let k = k0 - 3; k <= k0 + 4; k++) {
      if (k < 1) continue;
      const L = this.lampAt(k);
      lights.push({ x: L.x, y: L.y + 3.6, z: L.z, r: 19, c: L.col, d: Math.hypot(L.x - P.pos.x, L.z - P.pos.z) });
    }
    lights.sort((a, b) => a.d - b.d);
    const rl = this.p.riderLight;
    let n = 0;
    if (rl) {
      this.lightPos.set([P.pos.x, P.pos.y + 2.6, P.pos.z, rl[3]], 0);
      this.lightCol.set([rl[0], rl[1], rl[2], 1], 0);
      n = 1;
    }
    for (const L of lights) {
      if (n >= 8) break;
      const s = this.p.lamps === 'neon' ? 1.6 : 1.25;
      this.lightPos.set([L.x, L.y, L.z, L.r], n * 4);
      this.lightCol.set([L.c[0] * s, L.c[1] * s, L.c[2] * s, 1], n * 4);
      n++;
    }
    this.lightN = n;
  },

  setUniforms(prog) {
    const gl = GL.gl, p = this.p;
    if (prog.uPLn !== undefined) {
      gl.uniform1i(prog.uPLn, this.lightN);
      if (this.lightN) { gl.uniform4fv(prog.uPL, this.lightPos); gl.uniform4fv(prog.uPLc, this.lightCol); }
    }
    if (prog.uNeon !== undefined) {
      gl.uniform1f(prog.uNeon, p.neon);
      if (p.neon) { gl.uniform3fv(prog.uNeonA, p.neonA); gl.uniform3fv(prog.uNeonB, p.neonB); }
    }
  },

  /* lamp posts + glowing heads (instanced, through the props program) */
  drawLamps(ip, P) {
    if (!this.p.lamps) return;
    const gl = GL.gl, ib = GL.buf.parts, d = ib.data;
    const k0 = Math.floor((Cam.pos.z - 12) / LAMP_SPACING);
    const list = [];
    for (let k = k0 - 2; k <= k0 + 9; k++) if (k >= 1) list.push(this.lampAt(k));
    const draw = (mesh, glow) => {
      let n = 0;
      for (const L of list) {
        if (n >= ib.max) break;
        const o = n * 20;
        for (let i = 0; i < 16; i++) d[o + i] = (i % 5 === 0) ? 1 : 0;
        d[o + 12] = L.x; d[o + 13] = L.y - 0.2; d[o + 14] = L.z;
        if (glow) { d[o + 16] = L.col[0]; d[o + 17] = L.col[1]; d[o + 18] = L.col[2]; d[o + 19] = 1 + glow; }
        else { d[o + 16] = 1; d[o + 17] = 1; d[o + 18] = 1; d[o + 19] = 1; }
        n++;
      }
      const m = GL.mesh[mesh];
      gl.bindVertexArray(m.vao);
      GL.bindInstancing(ip, 'parts', 3, 20);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, ib.data, 0, n * 20);
      gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, n);
    };
    draw('lampPost', 0);
    draw('lampHead', this.p.lamps === 'neon' ? 3.2 : 2.6);
  }
};

/* ---------------- lamp meshes ---------------- */
function buildLampPost() {
  const g = Geo(), DARK = [0.16, 0.17, 0.20];
  geoCyl(g, 0, 0, 0, 0.09, 0.07, 3.4, DARK, 8, true, false);
  geoBox(g, 0, 3.45, 0, 0.42, 0.08, 0.42, DARK);             // cap
  geoBox(g, 0, 2.95, 0, 0.36, 0.06, 0.36, DARK);             // collar
  return g;
}
function buildLampHead() {
  const g = Geo(), W = [1, 1, 1];
  geoBox(g, 0, 3.2, 0, 0.30, 0.44, 0.30, W);                 // the glowing lantern pane
  return g;
}
