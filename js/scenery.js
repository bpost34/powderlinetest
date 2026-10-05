/* =====================================================================
   scenery.js — atmosphere that isn't gameplay:
     • board tracks carved into the snow behind the rider
     • a ring of distant snow-capped peaks on the horizon
     • light ambient snowfall around the camera
   Everything is procedural; nothing is loaded.
   ===================================================================== */
'use strict';

const Scenery = {
  /* ---------------- init: programs, buffers, static meshes ---------------- */
  init(lowSpec) {
    const gl = GL.gl;

    this.prog = {
      trail: GL.link(`
        precision highp float;
        in vec3 aPos; in float aAlpha;
        uniform mat4 uProj, uView; uniform vec3 uCamPos;
        out float vA; out float vD;
        void main(){ vA = aAlpha; vD = length(uCamPos - aPos); gl_Position = uProj * uView * vec4(aPos, 1.0); }`, `
        precision highp float;
        in float vA; in float vD; out vec4 fragColor;
        uniform vec3 uCol; uniform float uMul;
        void main(){
          float a = vA * exp(-vD * 0.008);
          // multiply mode: darken whatever light/shadow the snow already has (a pressed groove);
          // additive mode (neon) keeps the glowing trace
          fragColor = uMul > 0.5 ? vec4(mix(vec3(1.0), uCol, a), 1.0) : vec4(uCol, a);
        }`, 'trail'),

      mtn: GL.link(`
        precision highp float;
        in vec3 aPos; in vec3 aNormal; in vec3 aColor;
        uniform mat4 uProj, uView, uModel;
        out vec3 vN; out vec3 vP; out vec3 vW;
        void main(){
          vN = aNormal; vP = aPos;
          vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz;
          gl_Position = uProj * uView * w;
        }`, `
        precision highp float;
        in vec3 vN; in vec3 vP; in vec3 vW; out vec4 fragColor;
        uniform vec3 uSunDir, uSunColor, uHaze, uAmbLo, uAmbHi; uniform float uHazeAmt, uHills;
        float h13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        float n3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.0-2.0*f);
          float a = mix(mix(h13(i), h13(i+vec3(1,0,0)), u.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), u.x), u.y);
          float b = mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), u.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), u.x), u.y);
          return mix(a, b, u.z); }
        float f3(vec3 p){ return (n3(p)*0.5 + n3(p*2.1+5.3)*0.25 + n3(p*4.3+1.7)*0.125) / 0.875; }
        float f2(vec3 p){ return (n3(p)*0.66 + n3(p*2.1+5.3)*0.34); }
        void main(){
          vec3 n = normalize(vN);
          float h = vP.y;
          float big = f2(vP * 0.004), det = f3(vP * 0.03);
          // bump the shading normal with rock detail so faces don't read as smooth plastic
          vec3 bump = vec3(n3(vP * 0.06 + 1.0) - 0.5, 0.0, n3(vP * 0.06 + 7.0) - 0.5);
          n = normalize(n + bump * 0.55);
          // snow holds on gentle faces and higher up; steep faces stay bare rock
          float snowLine = -10.0 + (big - 0.5) * 90.0;
          float snow = smoothstep(snowLine - 25.0, snowLine + 25.0, h + (n.y - 0.6) * 160.0 + (det - 0.5) * 60.0);
          snow *= smoothstep(0.42, 0.62, n.y + (det - 0.5) * 0.35);
          // rock: banded strata
          float strata = f2(vec3(vP.x * 0.006, vP.y * 0.05, vP.z * 0.006));
          vec3 rock = mix(vec3(0.17, 0.17, 0.19), vec3(0.36, 0.35, 0.36), strata);
          // forest on the lower, gentler slopes
          float tree = max(smoothstep(-35.0, -75.0, h + (big - 0.5) * 60.0), uHills * smoothstep(40.0, 0.0, h + (big - 0.5) * 50.0)) * smoothstep(0.55, 0.75, n.y);
          if(tree > 0.0) tree *= smoothstep(mix(0.30, 0.18, uHills), mix(0.50, 0.40, uHills), f2(vP * mix(0.06, 0.16, uHills)));
          vec3 alb = mix(rock, vec3(0.92, 0.95, 1.0), snow);
          alb = mix(alb, vec3(0.04, 0.065, 0.05) * (0.8 + 0.5 * n3(vP * 0.9)), tree * 0.9);
          float ndl = max(dot(n, uSunDir), 0.0);
          vec3 amb = mix(uAmbLo, uAmbHi, n.y * 0.5 + 0.5);
          vec3 col = alb * (uSunColor * ndl * 0.95 + amb * 0.7);
          // aerial perspective: the base sinks into the haze, peaks stay crisp
          float haze = uHazeAmt * (1.0 - smoothstep(-80.0, 200.0, h) * 0.45);
          fragColor = vec4(mix(col, uHaze, clamp(haze, 0.0, 1.0)), 1.0);
        }`, 'mtn')
    };

    // ---- tracks: dynamic strip, 4 floats per vertex (pos + alpha) ----
    this.TRAIL_MAX = 520;
    this.trail = [];                    // {x, z, hw, seg}
    this.trailSeg = 0; this.trailBreak = true;
    this.trailData = new Float32Array(this.TRAIL_MAX * 6 * 4);
    this.trailVAO = gl.createVertexArray();
    gl.bindVertexArray(this.trailVAO);
    this.trailBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.trailData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
    gl.bindVertexArray(null);

    // ---- distant peaks: two rings, built once, follow the camera ----
    this.ranges = [
      { mesh: GL.upload('_mtnFar', this.buildRange(1050, 1360, 300, lowSpec ? 160 : 260, 11, lowSpec ? 12 : 18)), haze: 0.55 },
      { mesh: GL.upload('_mtnNear', this.buildRange(760, 1010, 190, lowSpec ? 140 : 220, 29, lowSpec ? 12 : 18)), haze: 0.40 },
      // low forested foothills filling the gap between the streamed terrain and the ranges
      { mesh: GL.upload('_mtnHills', this.buildRange(300, 820, 45, lowSpec ? 120 : 200, 47, lowSpec ? 10 : 16, -125)), haze: 0.32, hills: 1 }
    ];

    // ---- snowfall ----
    this.FLAKES = lowSpec ? 260 : 520;
    this.BOX = 34;
    this.flakes = new Float32Array(this.FLAKES * 5);   // x y z (box-relative) speed phase
    for (let i = 0; i < this.FLAKES; i++) {
      const o = i * 5;
      this.flakes[o] = rnd(-this.BOX, this.BOX); this.flakes[o + 1] = rnd(-this.BOX, this.BOX);
      this.flakes[o + 2] = rnd(-this.BOX, this.BOX);
      this.flakes[o + 3] = rnd(0.7, 1.6); this.flakes[o + 4] = rnd(TAU);
    }
    GL.instanceBuffer('snow', this.FLAKES, 8);
  },

  /* A ring-shaped heightfield of ridged peaks around the origin (y relative to the
     camera). Grid in (angle, radius); heights from ridged noise under an envelope
     that is low at the inner/outer edges, so it reads as a mountain range rather
     than a wall. Smooth normals; snow, rock bands and the forested lower slopes
     are painted per-pixel by the shader. */
  buildRange(R0, R1, hMax, A, seed, RAD = 18, base = -120) {
    const g = Geo();
    const H = (i, j) => {
      const a = (i % A) / A * TAU, r = lerp(R0, R1, j / (RAD - 1));
      const u = Math.cos(a) * r * 0.004, v = Math.sin(a) * r * 0.004;   // periodic around the ring
      let n = 1 - Math.abs(2 * fbm(u + seed, v - seed, 5, seed) - 1);  // ridged
      n = Math.pow(n, 2.0);
      const detail = (fbm(u * 4 + seed, v * 4, 3, seed + 5) - 0.5) * 0.22;
      const env = Math.pow(Math.sin(Math.PI * j / (RAD - 1)), 0.8);    // 0 at both edges
      return base + (40 + (n + detail) * hMax) * env;
    };
    const pos = [];
    for (let j = 0; j < RAD; j++) for (let i = 0; i < A; i++) {
      const a = i / A * TAU, r = lerp(R0, R1, j / (RAD - 1));
      pos.push([Math.cos(a) * r, H(i, j), Math.sin(a) * r]);
    }
    const P = (i, j) => pos[clamp(j, 0, RAD - 1) * A + ((i % A) + A) % A];
    for (let j = 0; j < RAD; j++) for (let i = 0; i < A; i++) {
      // smooth normal from neighbouring grid points (central differences)
      const pL = P(i - 1, j), pR = P(i + 1, j), pD = P(i, j - 1), pU = P(i, j + 1);
      const ux = pR[0] - pL[0], uy = pR[1] - pL[1], uz = pR[2] - pL[2];
      const vx = pU[0] - pD[0], vy = pU[1] - pD[1], vz = pU[2] - pD[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz) || 1;
      const p = P(i, j);
      geoVert(g, p[0], p[1], p[2], nx / l, ny / l, nz / l, 1, 1, 1);
    }
    for (let j = 0; j < RAD - 1; j++) for (let i = 0; i < A; i++) {
      const i1 = (i + 1) % A;
      const a = j * A + i, b = j * A + i1, c = (j + 1) * A + i, d = (j + 1) * A + i1;
      g.i.push(a, c, b, b, c, d);
    }
    return g;
  },

  reset() { this.trail.length = 0; this.trailBreak = true; },

  /* ---------------- per-frame ---------------- */
  update(dt, P) {
    // tracks: drop a point every ~0.35 m while the board is on the snow
    if (P.airborne || P.grind || P.crashTimer > 0 || P.speed < 1) { this.trailBreak = true; }
    else {
      const last = this.trail[this.trail.length - 1];
      if (this.trailBreak || !last || Math.hypot(P.pos.x - last.x, P.pos.z - last.z) > 0.35) {
        if (this.trailBreak) this.trailSeg++;
        this.trailBreak = false;
        // skidding sideways leaves a wider scrape than a clean carve
        const travel = Math.atan2(P.vel.x, P.vel.z);
        const skid = Math.abs(Math.sin(angDelta(travel, P.yaw)));
        this.trail.push({ x: P.pos.x, z: P.pos.z, hw: 0.12 + skid * 0.6 + (P.brakeVis || 0) * 0.65, seg: this.trailSeg });
        if (this.trail.length > this.TRAIL_MAX) this.trail.shift();
      }
    }
    // snowfall
    const f = this.flakes, t = GL.time;
    for (let i = 0; i < this.FLAKES; i++) {
      const o = i * 5;
      f[o + 1] -= f[o + 3] * dt;
      f[o] += Math.sin(t * 0.9 + f[o + 4]) * 0.35 * dt;
      f[o + 2] += Math.cos(t * 0.7 + f[o + 4]) * 0.25 * dt;
    }
  },

  /* ---------------- drawing ---------------- */
  drawMountains() {
    const gl = GL.gl, p = this.prog.mtn.use();
    gl.uniformMatrix4fv(p.uProj, false, Cam.proj);
    gl.uniformMatrix4fv(p.uView, false, Cam.view);
    gl.uniform3f(p.uSunDir, Sun.dir.x, Sun.dir.y, Sun.dir.z);
    gl.uniform3f(p.uSunColor, Sun.color[0], Sun.color[1], Sun.color[2]);
    gl.uniform3fv(p.uHaze, Atmos.p.haze);
    gl.uniform3fv(p.uAmbLo, Atmos.p.mtnAmbLo);
    gl.uniform3fv(p.uAmbHi, Atmos.p.mtnAmbHi);
    const M = _m4.c; m4ident(M);
    M[12] = Cam.pos.x; M[13] = Cam.pos.y - 40; M[14] = Cam.pos.z;
    gl.uniformMatrix4fv(p.uModel, false, M);
    gl.disable(gl.CULL_FACE);
    for (let k = this.ranges.length - 1; k >= 0; k--) {     // nearest first: cheaper overdraw
      const r = this.ranges[k];
      gl.uniform1f(p.uHazeAmt, r.haze);
      gl.uniform1f(p.uHills, r.hills || 0);
      gl.bindVertexArray(r.mesh.vao);
      gl.drawElements(gl.TRIANGLES, r.mesh.count, gl.UNSIGNED_INT, 0);
    }
    gl.enable(gl.CULL_FACE);
  },

  drawTrail() {
    const tr = this.trail, n = tr.length;
    if (n < 2) return;
    const gl = GL.gl, d = this.trailData;
    let k = 0;
    const put = (x, y, z, a) => { d[k++] = x; d[k++] = y; d[k++] = z; d[k++] = a; };
    for (let i = 1; i < n; i++) {
      const a = tr[i - 1], b = tr[i];
      if (a.seg !== b.seg) continue;
      // sideways = perpendicular to the segment on the ground
      let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const sx = -dz, sz = dx;
      const fa = Math.pow((i - 1) / n, 0.6) * 0.42, fb = Math.pow(i / n, 0.6) * 0.42;
      const ya = heightAt(a.x, a.z) + 0.05, yb = heightAt(b.x, b.z) + 0.05;
      const a0x = a.x + sx * a.hw, a0z = a.z + sz * a.hw, a1x = a.x - sx * a.hw, a1z = a.z - sz * a.hw;
      const b0x = b.x + sx * b.hw, b0z = b.z + sz * b.hw, b1x = b.x - sx * b.hw, b1z = b.z - sz * b.hw;
      put(a0x, ya, a0z, fa); put(a1x, ya, a1z, fa); put(b0x, yb, b0z, fb);
      put(b0x, yb, b0z, fb); put(a1x, ya, a1z, fa); put(b1x, yb, b1z, fb);
    }
    const verts = k / 4;
    if (!verts) return;
    const p = this.prog.trail.use();
    gl.uniformMatrix4fv(p.uProj, false, Cam.proj);
    gl.uniformMatrix4fv(p.uView, false, Cam.view);
    gl.uniform3f(p.uCamPos, Cam.pos.x, Cam.pos.y, Cam.pos.z);
    gl.uniform3fv(p.uCol, Atmos.p.trail);                    // groove shadow (glows in neon)
    gl.bindVertexArray(this.trailVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, k);
    gl.disable(gl.CULL_FACE);
    gl.uniform1f(p.uMul, Atmos.p.trailAdd ? 0 : 1);
    gl.enable(gl.BLEND);
    if (Atmos.p.trailAdd) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -8);
    gl.drawArrays(gl.TRIANGLES, 0, verts);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  },

  drawSnow() {
    const gl = GL.gl, ib = GL.buf.snow, d = ib.data, f = this.flakes, B = this.BOX, W = B * 2;
    const cx = Cam.pos.x, cy = Cam.pos.y, cz = Cam.pos.z;
    for (let i = 0; i < this.FLAKES; i++) {
      const o = i * 5, q = i * 8;
      // wrap each flake into a box that travels with the camera
      const x = ((f[o] - cx) % W + W * 1.5) % W - B;
      const y = ((f[o + 1] - cy) % W + W * 1.5) % W - B;
      const z = ((f[o + 2] - cz) % W + W * 1.5) % W - B;
      d[q] = cx + x; d[q + 1] = cy + y; d[q + 2] = cz + z; d[q + 3] = 0.045 + (i % 5) * 0.012;
      const fc = Atmos.p.flake;
      d[q + 4] = fc[0]; d[q + 5] = fc[1]; d[q + 6] = fc[2]; d[q + 7] = fc[3];
    }
    const p = GL.prog.particle.use();
    const v = Cam.view;
    gl.uniformMatrix4fv(p.uProj, false, Cam.proj);
    gl.uniformMatrix4fv(p.uView, false, v);
    gl.uniform3f(p.uRight, v[0], v[4], v[8]);
    gl.uniform3f(p.uUp, v[1], v[5], v[9]);
    const m = GL.mesh.particle;
    gl.bindVertexArray(m.vao);
    GL.bindParticles('snow');
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, this.FLAKES * 8);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, this.FLAKES);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }
};
