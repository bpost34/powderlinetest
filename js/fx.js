/* =====================================================================
   fx.js — GPU particles: edge spray, powder plumes, landing impacts,
   crash bursts and gate sparks. One instanced billboard draw call.
   ===================================================================== */
'use strict';

const MAXP = 2600;
const ONE3 = [1, 1, 1];

class Particles {
  constructor() {
    this.n = 0;
    // struct-of-arrays for cheap simulation
    this.px = new Float32Array(MAXP); this.py = new Float32Array(MAXP); this.pz = new Float32Array(MAXP);
    this.vx = new Float32Array(MAXP); this.vy = new Float32Array(MAXP); this.vz = new Float32Array(MAXP);
    this.life = new Float32Array(MAXP); this.maxLife = new Float32Array(MAXP);
    this.size = new Float32Array(MAXP); this.grow = new Float32Array(MAXP);
    this.r = new Float32Array(MAXP); this.g = new Float32Array(MAXP); this.b = new Float32Array(MAXP);
    this.a = new Float32Array(MAXP);
    this.grav = new Float32Array(MAXP);
    this.drag = new Float32Array(MAXP);
    this.stick = new Uint8Array(MAXP);   // die on contact with terrain
  }

  spawn(x, y, z, vx, vy, vz, opts) {
    if (this.n >= MAXP) return;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.maxLife[i] = this.life[i] = opts.life;
    this.size[i] = opts.size;
    this.grow[i] = opts.grow || 0;
    this.r[i] = opts.col[0]; this.g[i] = opts.col[1]; this.b[i] = opts.col[2];
    this.a[i] = opts.alpha === undefined ? 1 : opts.alpha;
    this.grav[i] = opts.grav === undefined ? -9 : opts.grav;
    this.drag[i] = opts.drag === undefined ? 1.4 : opts.drag;
    this.stick[i] = opts.stick ? 1 : 0;
  }

  clear() { this.n = 0; }

  /* ---------- emitters ---------- */

  /* carving spray: thrown off the engaged edge, opposite the turn */
  spray(P, dt) {
    const speed = P.speed;
    if (P.airborne || P.grind || speed < 3.2) return;
    const edge = Math.abs(P.lean);
    const rate = clamp(speed * (0.55 + edge * 2.6) * (P.braking ? 1.9 : 1.0), 0, 190);
    this.acc = (this.acc || 0) + rate * dt;
    const back = P.backPos, right = P.right;
    // spray flies opposite to the lateral force (out of the turn)
    const lat = -P.turnRate * P.speed;
    while (this.acc >= 1) {
      this.acc -= 1;
      const t = Math.random();
      const px = lerp(P.frontPos.x, back.x, t), pz = lerp(P.frontPos.z, back.z, t);
      const py = heightAt(px, pz) + 0.03;
      const side = sign(lat) || 1;
      const spread = rnd(0.5, 1.0);
      const sx = right.x * side * spread, sz = right.z * side * spread;
      const up = rnd(1.4, 5.2) * (0.4 + edge);
      const push = rnd(0.6, 2.6);
      this.spawn(
        px + sx * 0.25, py, pz + sz * 0.25,
        sx * rnd(2.5, 7.5) * speed * 0.16 - P.vel.x * 0.12,
        up,
        sz * rnd(2.5, 7.5) * speed * 0.16 - P.vel.z * 0.12,
        { life: rnd(0.35, 0.8), size: rnd(0.10, 0.30), grow: rnd(0.4, 1.5),
          col: [0.96, 0.98, 1.0], alpha: rnd(0.35, 0.85), grav: -7.5, drag: 2.1, stick: 1 }
      );
    }
  }

  /* deep powder: a continuous roost behind the rider at speed */
  powder(P, dt) {
    if (P.airborne || P.grind || P.speed < 12) return;
    this.accP = (this.accP || 0) + (P.speed - 10) * 0.9 * dt;
    while (this.accP >= 1) {
      this.accP -= 1;
      const b = P.backPos;
      const x = b.x + rnd(-0.3, 0.3), z = b.z + rnd(-0.3, 0.3);
      this.spawn(x, heightAt(x, z) + 0.1, z,
        -P.vel.x * 0.10 + rnd(-1, 1), rnd(0.6, 2.4), -P.vel.z * 0.10 + rnd(-1, 1),
        { life: rnd(0.7, 1.5), size: rnd(0.3, 0.75), grow: rnd(1.2, 2.8),
          col: [0.94, 0.97, 1.0], alpha: rnd(0.12, 0.32), grav: -1.6, drag: 1.0, stick: 0 }
      );
    }
  }

  /* landing impact: a ring of snow */
  impact(x, y, z, strength, vx, vz) {
    const n = Math.floor(clamp(strength * 26, 6, 60));
    for (let i = 0; i < n; i++) {
      const a = rnd(TAU), r = rnd(0.2, 1.1);
      const sp = rnd(2, 9) * clamp(strength, 0.3, 2.2);
      this.spawn(x + Math.cos(a) * r, y + 0.08, z + Math.sin(a) * r,
        Math.cos(a) * sp + vx * 0.22, rnd(1.5, 7.5) * clamp(strength, 0.4, 2), Math.sin(a) * sp + vz * 0.22,
        { life: rnd(0.5, 1.3), size: rnd(0.18, 0.55), grow: rnd(1.0, 3.0),
          col: [0.97, 0.99, 1.0], alpha: rnd(0.5, 0.95), grav: -8, drag: 1.7, stick: 1 }
      );
    }
  }

  /* wipeout: big chaotic plume + a few dark chunks */
  crash(x, y, z, vx, vy, vz) {
    for (let i = 0; i < 90; i++) {
      const a = rnd(TAU), e = rnd(0.1, 1);
      const sp = rnd(3, 16);
      this.spawn(x, y + 0.15, z,
        Math.cos(a) * sp * e + vx * 0.4, rnd(2, 12) + vy * 0.3, Math.sin(a) * sp * e + vz * 0.4,
        { life: rnd(0.7, 2.1), size: rnd(0.2, 0.8), grow: rnd(1.4, 3.6),
          col: [0.92, 0.96, 1.0], alpha: rnd(0.5, 1), grav: -9, drag: 1.3, stick: 1 }
      );
    }
    for (let i = 0; i < 14; i++) {
      const a = rnd(TAU);
      this.spawn(x, y + 0.4, z, Math.cos(a) * rnd(2, 8), rnd(3, 9), Math.sin(a) * rnd(2, 8),
        { life: rnd(0.9, 1.6), size: rnd(0.07, 0.16), grow: 0, col: [0.75, 0.83, 0.92],
          alpha: 1, grav: -14, drag: 0.5, stick: 0 });
    }
  }

  /* gate hit: a burst of glowing motes */
  gateBurst(x, y, z, col) {
    for (let i = 0; i < 34; i++) {
      const a = rnd(TAU), e = rnd(-0.4, 1);
      const sp = rnd(2, 9);
      this.spawn(x, y + rnd(0, 2.2), z,
        Math.cos(a) * sp, e * sp * 0.7 + 2, Math.sin(a) * sp,
        { life: rnd(0.4, 1.1), size: rnd(0.10, 0.34), grow: rnd(-0.1, 0.6),
          col, alpha: rnd(0.7, 1), grav: -2.5, drag: 2.4, stick: 0 }
      );
    }
  }

  /* ollie puff along the tail */
  puff(x, y, z, strength) {
    for (let i = 0; i < Math.floor(14 + strength * 26); i++) {
      const a = rnd(TAU);
      this.spawn(x + rnd(-0.4, 0.4), y + 0.05, z + rnd(-0.4, 0.4),
        Math.cos(a) * rnd(1, 5), rnd(0.6, 3.4), Math.sin(a) * rnd(1, 5),
        { life: rnd(0.3, 0.8), size: rnd(0.18, 0.5), grow: rnd(1, 2.6),
          col: [0.95, 0.98, 1.0], alpha: rnd(0.3, 0.7), grav: -3, drag: 2.2, stick: 1 }
      );
    }
  }

  /* ---------- simulation ---------- */
  update(dt) {
    const windX = Math.sin(GL.time * 0.4) * 0.5, windZ = Math.cos(GL.time * 0.31) * 0.5;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const d = 1 - this.drag[i] * dt;
      this.vx[i] = this.vx[i] * d + windX * dt;
      this.vz[i] = this.vz[i] * d + windZ * dt;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.size[i] += this.grow[i] * dt;
      if (this.stick[i]) {
        const g = heightAt(this.px[i], this.pz[i]);
        if (this.py[i] < g) { this.life[i] = Math.min(this.life[i], 0.12); this.py[i] = g; this.vy[i] = 0; }
      }
    }
  }
  kill(i) {
    const last = --this.n;
    if (i !== last) {
      this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
      this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
      this.size[i] = this.size[last]; this.grow[i] = this.grow[last];
      this.r[i] = this.r[last]; this.g[i] = this.g[last]; this.b[i] = this.b[last];
      this.a[i] = this.a[last]; this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last];
      this.stick[i] = this.stick[last];
    }
  }

  /* ---------- upload + draw ---------- */
  draw(camRight, camUp) {
    const gl = GL.gl;
    const ib = GL.buf.particles;
    const d = ib.data;
    const n = Math.min(this.n, ib.max);
    if (n === 0) return;
    for (let i = 0; i < n; i++) {
      const t = this.life[i] / this.maxLife[i];
      // fade in fast, out slow
      const fade = Math.min(1, t * 2.6) * Math.min(1, (1 - t) * 8 + 0.25);
      const o = i * 8;
      d[o] = this.px[i]; d[o + 1] = this.py[i]; d[o + 2] = this.pz[i]; d[o + 3] = Math.max(0.02, this.size[i]);
      const pt = Atmos.p.spray || ONE3;          // snow spray is unlit: dim it at night
      d[o + 4] = this.r[i] * pt[0]; d[o + 5] = this.g[i] * pt[1]; d[o + 6] = this.b[i] * pt[2]; d[o + 7] = this.a[i] * fade;
    }
    const p = GL.prog.particle.use();
    gl.uniformMatrix4fv(p.uProj, false, Cam.proj);
    gl.uniformMatrix4fv(p.uView, false, Cam.view);
    gl.uniform3f(p.uRight, camRight.x, camRight.y, camRight.z);
    gl.uniform3f(p.uUp, camUp.x, camUp.y, camUp.z);
    const m = GL.mesh.particle;
    // VAO first: attribute pointers and divisors are per-VAO state, so they
    // must be written into the particle VAO, not whatever was bound last.
    gl.bindVertexArray(m.vao);
    GL.bindParticles('particles');
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, ib.data, 0, n * 8);
    gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, n);
  }
}
