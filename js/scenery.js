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
        uniform vec3 uCol;
        void main(){ fragColor = vec4(uCol, vA * exp(-vD * 0.008)); }`, 'trail'),

      mtn: GL.link(`
        precision highp float;
        in vec3 aPos; in vec3 aNormal; in vec3 aColor;
        uniform mat4 uProj, uView, uModel;
        out vec3 vN; out vec3 vC; out float vH;
        void main(){
          vN = aNormal; vC = aColor; vH = aPos.y;
          gl_Position = uProj * uView * (uModel * vec4(aPos, 1.0));
        }`, `
        precision highp float;
        in vec3 vN; in vec3 vC; in float vH; out vec4 fragColor;
        uniform vec3 uSunDir, uSunColor, uHaze; uniform float uHazeAmt;
        void main(){
          vec3 n = normalize(vN);
          float ndl = max(dot(n, uSunDir), 0.0);
          vec3 amb = mix(vec3(0.34, 0.42, 0.58), vec3(0.62, 0.72, 0.90), n.y * 0.5 + 0.5);
          vec3 col = vC * (uSunColor * ndl * 0.85 + amb * 0.75);
          // aerial perspective: the base sinks into the haze, peaks stay crisp
          float haze = uHazeAmt * (1.0 - smoothstep(-80.0, 200.0, vH) * 0.5);
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
      { mesh: GL.upload('_mtnFar', this.buildRange(1050, 1360, 300, 120, 11)), haze: 0.55 },
      { mesh: GL.upload('_mtnNear', this.buildRange(760, 1010, 190, 96, 29)), haze: 0.40 }
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
     than a wall. Flat-shaded: snow on high, gentle faces; rock on steep ones. */
  buildRange(R0, R1, hMax, A, seed) {
    const g = Geo(), RAD = 9;
    const H = (i, j) => {
      const a = (i % A) / A * TAU, r = lerp(R0, R1, j / (RAD - 1));
      const u = Math.cos(a) * r * 0.004, v = Math.sin(a) * r * 0.004;   // periodic around the ring
      let n = 1 - Math.abs(2 * fbm(u + seed, v - seed, 4, seed) - 1); // ridged
      n = Math.pow(n, 2.2);
      const env = Math.sin(Math.PI * j / (RAD - 1));                   // 0 at both edges
      return -120 + (40 + n * hMax) * env;
    };
    const P = (i, j) => {
      const a = (i % A) / A * TAU, r = lerp(R0, R1, j / (RAD - 1));
      return [Math.cos(a) * r, H(i, j), Math.sin(a) * r];
    };
    const SNOW = [0.94, 0.96, 1.0], ROCK = [0.42, 0.47, 0.58], DARK = [0.32, 0.37, 0.48];
    const tri = (A_, B_, C_) => {
      let ux = B_[0] - A_[0], uy = B_[1] - A_[1], uz = B_[2] - A_[2], wx = C_[0] - A_[0], wy = C_[1] - A_[1], wz = C_[2] - A_[2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      if (ny < 0) { [B_, C_] = [C_, B_]; nx = -nx; ny = -ny; nz = -nz; }   // heightfield: face up
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const yMid = (A_[1] + B_[1] + C_[1]) / 3;
      const col = (yMid > 20 + (1 - ny) * 140 && ny > 0.45) ? SNOW : (ny > 0.7 ? ROCK : DARK);
      geoTri(g, geoVert(g, A_[0], A_[1], A_[2], nx, ny, nz, ...col),
                geoVert(g, B_[0], B_[1], B_[2], nx, ny, nz, ...col),
                geoVert(g, C_[0], C_[1], C_[2], nx, ny, nz, ...col));
    };
    for (let i = 0; i < A; i++) for (let j = 0; j < RAD - 1; j++) {
      const p00 = P(i, j), p10 = P(i + 1, j), p01 = P(i, j + 1), p11 = P(i + 1, j + 1);
      tri(p00, p10, p11); tri(p00, p11, p01);
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
        this.trail.push({ x: P.pos.x, z: P.pos.z, hw: 0.12 + skid * 0.6, seg: this.trailSeg });
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
    gl.uniform3f(p.uHaze, 0.76, 0.84, 0.95);
    const M = _m4.c; m4ident(M);
    M[12] = Cam.pos.x; M[13] = Cam.pos.y - 40; M[14] = Cam.pos.z;
    gl.uniformMatrix4fv(p.uModel, false, M);
    gl.disable(gl.CULL_FACE);
    for (const r of this.ranges) {
      gl.uniform1f(p.uHazeAmt, r.haze);
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
    gl.uniform3f(p.uCol, 0.42, 0.53, 0.74);                  // cool blue groove shadow
    gl.bindVertexArray(this.trailVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, k);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
      d[q + 4] = 1; d[q + 5] = 1; d[q + 6] = 1; d[q + 7] = 0.85;
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
