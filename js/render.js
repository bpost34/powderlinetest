/* =====================================================================
   render.js — turns world + player state into draw calls.
   Owns the chase camera, the sun/shadow camera and the post chain.
   ===================================================================== */
'use strict';

const _m4 = { a: M4(), b: M4(), c: M4(), d: M4(), e: M4() };
const _v = [V3(), V3(), V3(), V3(), V3(), V3()];

const Cam = {
  proj: M4(), view: M4(), vp: M4(),
  pos: V3(0, 6, -14), look: V3(),
  fov: 1.07, aspect: 1,
  shake: 0, shakeT: 0,
  near: 0.35, far: 1400,
  // chase state: the camera follows the direction of TRAVEL (smoothed), not the
  // board's nose — so carving and in-air spins don't swing the whole view
  heading: 0, snapNext: true,
  // mouse orbit (right/middle drag) + wheel zoom; springs back after release
  orbitYaw: 0, orbitPitch: 0, zoom: 1, portraitZoom: 1, dragging: false, releaseT: 0,
  cust: 0,             // 0..1 blend into the close "customize rider" framing

  snap(P) { this.heading = P.yaw; this.orbitYaw = this.orbitPitch = 0; this.shake = 0; this.snapNext = true; },
  drag(dx, dy) {
    this.orbitYaw -= dx * 0.0055;
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.0045, -0.55, 0.95);
  },

  update(dt, P, state) {
    const speedN = clamp(P.speed / 26, 0, 1);
    // FOV opens up with speed — the classic sense-of-velocity trick
    // customize screen: swing in close and slowly circle the rider
    this.cust = damp(this.cust, Game.customizing ? 1 : 0, 3.5, dt);
    if (this.cust > 0.01 && !this.dragging) this.orbitYaw += dt * 0.35 * this.cust;
    this.fov = damp(this.fov, lerp(1.02 + speedN * 0.26 + (P.airborne ? 0.04 : 0), 0.62, this.cust), 3.2, dt);
    this.aspect = GL.w / Math.max(1, GL.h);
    // portrait screens: widen the vertical FOV so the horizontal view isn't a
    // slit, but only so far — the camera moves in instead (see portraitZoom)
    let vfov = this.fov;
    if (this.aspect < 1.25) vfov = Math.min(1.38, 2 * Math.atan(Math.tan(this.fov / 2) * 1.25 / this.aspect));
    // tall phone screens: ride closer so the rider's orientation reads on big airs
    this.portraitZoom = this.aspect < 1 ? lerp(0.62, 1, clamp((this.aspect - 0.45) / 0.55, 0, 1)) : 1;
    m4perspective(this.proj, vfov, this.aspect, this.near, this.far);

    // ---- heading: smoothed direction of travel ----
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (P.crashTimer <= 0) {
      // pipe: keep looking down the pipe instead of whipping across it on every wall
      const lock = Level.cur.cam && Level.cur.cam.lockHeading;
      const target = lock ? 0 : (hs > 1.5 ? Math.atan2(P.vel.x, P.vel.z) : P.yaw);
      const rate = P.airborne ? 0.8 : (hs > 1.5 ? 2.4 : 1.0);
      this.heading += angDelta(this.heading, target) * (1 - Math.exp(-rate * dt));
    }

    // ---- user orbit: hold while dragging, ease home ~1 s after release ----
    if (!this.dragging) {
      this.releaseT -= dt;
      if (this.releaseT <= 0) {
        this.orbitYaw = damp(angDelta(0, this.orbitYaw), 0, 2.4, dt);
        this.orbitPitch = damp(this.orbitPitch, 0, 2.4, dt);
      }
    }

    // ---- desired position: orbit the rider at (yaw, elevation, distance) ----
    const yaw = this.heading + this.orbitYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const lc = Level.cur.cam || {};
    const dist = lerp((9.0 + speedN * 3.5 + (P.airborne ? 1.5 : 0)) * this.zoom * (lc.dist || 1) * this.portraitZoom, 4.2, this.cust);
    const elev = clamp(lerp(lc.elev || 0.40, 0.16, this.cust) + this.orbitPitch, -0.12, 1.35);
    const ce = Math.cos(elev), se = Math.sin(elev);
    const fy = P.pos.y + 1.1;                               // focus: rider's chest
    const tx = P.pos.x - fx * dist * ce, tz = P.pos.z - fz * dist * ce;
    const ty = Math.max(fy + dist * se, heightAt(tx, tz) + 1.3);

    // ---- aim: rider, plus a lead down the hill when the view is at rest ----
    const userOff = Math.min(1, Math.abs(this.orbitYaw) * 1.5 + Math.abs(this.orbitPitch) * 1.5);
    const lead = (3 + speedN * 7) * (1 - userOff) * (1 - this.cust);
    const hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    const lx = P.pos.x + hx * lead, lz = P.pos.z + hz * lead;
    let ly = lerp(fy, heightAt(lx, lz) + 1.1, 0.5);
    // customize framing: the panel covers the right side (desktop) or the bottom
    // (portrait phone) — aim past the rider so they sit in the open part of the screen
    let ax = lx, az = lz;
    if (this.cust > 0.01) {
      const rx = -Math.cos(yaw), rz = Math.sin(yaw);       // toward screen-right on the ground plane
      const side = this.aspect > 1 ? 0.95 : 0, down = this.aspect > 1 ? 0.15 : 0.75;
      ax += rx * side * this.cust; az += rz * side * this.cust; ly -= down * this.cust;
    }

    if (this.snapNext) {
      V3.set(this.pos, tx, ty, tz); V3.set(this.look, ax, ly, az); this.snapNext = false;
    } else {
      const lag = this.dragging ? 16 : (P.airborne ? 4.5 : 7);
      this.pos.x = damp(this.pos.x, tx, lag, dt);
      this.pos.y = damp(this.pos.y, ty, lag * 0.8, dt);
      this.pos.z = damp(this.pos.z, tz, lag, dt);
      this.look.x = damp(this.look.x, ax, 9, dt);
      this.look.y = damp(this.look.y, ly, 6, dt);           // terrain noise ahead → smooth it
      this.look.z = damp(this.look.z, az, 9, dt);
    }

    // camera shake
    let sx = 0, sy = 0, sz = 0;
    if (this.shake > 0.001) {
      const s = this.shake;
      this.shakeT += dt * 40;
      sx = Math.sin(this.shakeT * 1.7) * s * 0.5;
      sy = Math.sin(this.shakeT * 2.3 + 1.1) * s * 0.7;
      sz = Math.cos(this.shakeT * 1.9) * s * 0.4;
      this.shake = damp(this.shake, 0, 5.5, dt);
    }

    m4lookAt(this.view, this.pos.x + sx, this.pos.y + sy, this.pos.z + sz,
      this.look.x, this.look.y, this.look.z, 0, 1, 0);
    m4mul(this.vp, this.proj, this.view);
  },

  /* keep the camera out of the ground */
  resolveGround() {
    const g = heightAt(this.pos.x, this.pos.z) + 1.0;
    if (this.pos.y < g) this.pos.y = g;
  }
};

const Sun = {
  dir: V3(-0.42, 0.62, -0.55),
  color: [1.30, 1.16, 0.94],
  skyTint: [0.42, 0.55, 0.78],
  groundTint: [0.30, 0.35, 0.44],
  fogColor: [0.72, 0.81, 0.93],
  fogDensity: 0.0026,
  lightVP: M4(), lightView: M4(), lightProj: M4(),
  radius: 80,          // shadow-map half-extent (m); smaller = crisper shadows

  init() { V3.norm(this.dir, this.dir); },

  update(cx, cy, cz) {
    const gl = GL.gl;
    const R = this.radius;
    // snap to texel grid to reduce shadow shimmer
    // dir points surface → sun, so the light camera sits on the sun side
    const ex = cx + this.dir.x * 160, ey = cy + this.dir.y * 160, ez = cz + this.dir.z * 160;
    m4lookAt(this.lightView, ex, ey, ez, cx, cy, cz, 0, 1, 0);
    m4ortho(this.lightProj, -R, R, -R, R, 1, 330);
    m4mul(this.lightVP, this.lightProj, this.lightView);
  },

  setUniforms(p) {
    const gl = GL.gl;
    gl.uniform3f(p.uSunDir, this.dir.x, this.dir.y, this.dir.z);
    gl.uniform3f(p.uSunColor, this.color[0], this.color[1], this.color[2]);
    gl.uniform3f(p.uSkyTint, this.skyTint[0], this.skyTint[1], this.skyTint[2]);
    gl.uniform3f(p.uGroundTint, this.groundTint[0], this.groundTint[1], this.groundTint[2]);
    gl.uniform3f(p.uFogColor, this.fogColor[0], this.fogColor[1], this.fogColor[2]);
    gl.uniform1f(p.uFogDensity, this.fogDensity);
    gl.uniform1f(p.uTime, GL.time);
    gl.uniformMatrix4fv(p.uLightVP, false, this.lightVP);
    gl.uniform3f(p.uCamPos, Cam.pos.x, Cam.pos.y, Cam.pos.z);
    Atmos.setUniforms(p);                    // lamps / rider glow / neon grid
    gl.uniformMatrix4fv(p.uView, false, Cam.view);
    // every world program multiplies by uProj; without this the shadow and
    // lit passes would transform by a zero matrix and draw nothing.
    gl.uniformMatrix4fv(p.uProj, false, Cam.proj);
    if (p.uShadow !== undefined) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, GL.buf.shadowTex);
      gl.uniform1i(p.uShadow, 0);
    }
  }
};

/* ---------------- draw helpers ---------------- */
const IDENT = M4();

function drawMesh(prog, meshName, model) {
  const gl = GL.gl;
  const m = GL.mesh[meshName]; if (!m) return;
  if (prog.uModel !== undefined) gl.uniformMatrix4fv(prog.uModel, false, model || IDENT);
  gl.bindVertexArray(m.vao);
  gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
}

/* =========================================================================
   Scene drawing
   ========================================================================= */
const Render = {
  trees: [], rocks: [],
  stats: { tris: 0, calls: 0 },

  /* free GPU chunk meshes that have not been drawn for a while. Driven by a
     monotonic frame counter (Game.frames resets every 0.5 s, so it cannot be
     used for age comparisons). */
  reapChunks(frame) {
    if (frame - (this._reapAt || 0) < 30) return;
    this._reapAt = frame;
    const gl = GL.gl;
    if (GL.chunkVAO.size < 120) return;
    for (const [key, m] of GL.chunkVAO) {
      if (frame - (m.lastUsed || 0) <= 120) continue;
      gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vb); gl.deleteBuffer(m.ib);
      GL.chunkVAO.delete(key);
      delete GL.mesh['_chunk' + key];   // drop the reference too, or it leaks
    }
  },

  /* ---------- pass 1: shadow map ---------- */
  shadows(P) {
    const gl = GL.gl;
    const fb = GL.vao.shadowFB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fb);
    gl.viewport(0, 0, fb.w, fb.h);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    // front-face culling for the shadow pass reduces acne on thin objects
    gl.cullFace(gl.FRONT);

    const sp = GL.prog.shadow;
    sp.use();
    Sun.setUniforms(sp);
    gl.uniformMatrix4fv(sp.uModel, false, IDENT);
    // terrain
    for (const c of World.visible) {
      const lod = this.pickLod(c);
      const m = GL.chunkMesh(c, lod);
      if (!m) continue;
      m.lastUsed = Game.frameNo;
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    }
    // level structures (rails, coping, finish arch)
    if (GL.mesh._levelDecor) drawMesh(sp, '_levelDecor', IDENT);
    // rider + board cast shadows
    drawMesh(sp, 'board', P.boardMat);
    for (let i = 0; i < P.partCount; i++) {
      const q = P.parts[i];
      drawMesh(sp, q.mesh, q.mat);
    }
    // trees: trunks, then the needle cards (alpha-tested, both faces)
    const ip = GL.prog.shadowInst;
    ip.use();
    Sun.setUniforms(ip);
    gl.uniformMatrix4fv(ip.uModel, false, IDENT);
    this.fillTreeBuffer(P);                       // refreshes this.trees for this frame
    const groups = this.fillShadowTrees();
    this.drawTrees(ip, groups, 'trunk', 'shadowProps');
    const fp = GL.prog.shadowFol.use();
    Sun.setUniforms(fp);
    gl.uniformMatrix4fv(fp.uModel, false, IDENT);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, GL.tex.needles);
    gl.uniform1i(fp.uNeedle, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.CULL_FACE);
    this.drawTrees(fp, groups, 'shadow', 'shadowProps');
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  },

  /* Draw whatever LOD the world streaming actually built for this chunk.
     Choosing by camera distance here (as it used to) asked for LODs that were
     never built, so chunkMesh() returned null → holes in the terrain. */
  pickLod(c) {
    if (c.lods[c.wantLod]) return c.wantLod;
    for (let l = 0; l < LODS.length; l++) if (c.lods[l]) return l;   // any built one
    return -1;
  },

  /* Pack visible trees into the shared instance buffer, grouped as
     [shape0 near | shape0 far | shape1 near | shape1 far] so each mesh draws
     one contiguous range. Also refreshes this.rocks. Cached per frame (the
     shadow and main passes share it). */
  TREE_LOD_DIST: 95,
  fillTreeBuffer(P) {
    if (this._treeFrame === Game.frameNo && this._groups) return this._groups;
    this._treeFrame = Game.frameNo;
    const ib = GL.buf.props, d = ib.data;
    const span = VIEW_R * CHUNK;
    World.propsNear(P.pos.x, P.pos.z, span, this.trees, this.rocks);
    const buckets = [[], [], [], []];
    const cx = Cam.pos.x, cz = Cam.pos.z, L2 = this.TREE_LOD_DIST * this.TREE_LOD_DIST;
    for (const t of this.trees) {
      const far = (t.x - cx) * (t.x - cx) + (t.z - cz) * (t.z - cz) > L2 ? 1 : 0;
      buckets[(t.shape || 0) * 2 + far].push(t);
    }
    const groups = [];
    let n = 0;
    for (let b = 0; b < 4; b++) {
      const first = n;
      for (const t of buckets[b]) {
        if (n >= ib.max) break;
        const c = Math.cos(t.rot), s = Math.sin(t.rot), sc = t.sc;
        const o = n * 20;
        // column-major: scale * rotY (slightly taller than wide for variety)
        d[o] = c * sc;      d[o + 1] = 0;        d[o + 2] = -s * sc;  d[o + 3] = 0;
        d[o + 4] = 0;       d[o + 5] = sc * (t.tall || 1); d[o + 6] = 0; d[o + 7] = 0;
        d[o + 8] = s * sc;  d[o + 9] = 0;        d[o + 10] = c * sc;  d[o + 11] = 0;
        d[o + 12] = t.x;    d[o + 13] = t.y - 0.1; d[o + 14] = t.z;   d[o + 15] = 1;
        const shade = 0.78 + hash2(Math.floor(t.x), Math.floor(t.z), 77) * 0.42;
        d[o + 16] = shade * (0.95 + t.sway * 0.016); d[o + 17] = shade; d[o + 18] = shade * 0.96; d[o + 19] = 1;
        n++;
      }
      groups.push({ shape: b >> 1, far: b & 1, first, count: n - first });
    }
    if (n) {
      const gl = GL.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, ib.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 20);
    }
    this._groups = groups;
    return groups;
  },

  /* Shadow casters: only trees inside the sun's shadow box (±Sun.radius in light
     space) — the rest can't reach the map. All drawn with the lighter LOD crown,
     which is plenty for a shadow. Groups come out as [s0 —, s0 lo, s1 —, s1 lo]. */
  fillShadowTrees() {
    const ib = GL.buf.shadowProps, d = ib.data, M = Sun.lightVP;
    const lists = [[], []];
    for (const t of this.trees) {
      const y = t.y + 3;
      const x = M[0] * t.x + M[4] * y + M[8] * t.z + M[12];
      const yy = M[1] * t.x + M[5] * y + M[9] * t.z + M[13];
      if (x < -1.08 || x > 1.08 || yy < -1.08 || yy > 1.08) continue;
      lists[t.shape || 0].push(t);
    }
    const groups = [];
    let n = 0;
    for (let sh = 0; sh < 2; sh++) {
      groups.push({ shape: sh, far: 0, first: n, count: 0 });
      const first = n;
      for (const t of lists[sh]) {
        if (n >= ib.max) break;
        const c = Math.cos(t.rot), s = Math.sin(t.rot), sc = t.sc, o = n * 20;
        d[o] = c * sc;  d[o + 1] = 0; d[o + 2] = -s * sc; d[o + 3] = 0;
        d[o + 4] = 0;   d[o + 5] = sc * (t.tall || 1); d[o + 6] = 0; d[o + 7] = 0;
        d[o + 8] = s * sc; d[o + 9] = 0; d[o + 10] = c * sc; d[o + 11] = 0;
        d[o + 12] = t.x; d[o + 13] = t.y - 0.1; d[o + 14] = t.z; d[o + 15] = 1;
        d[o + 16] = d[o + 17] = d[o + 18] = d[o + 19] = 1;
        n++;
      }
      groups.push({ shape: sh, far: 1, first, count: n - first });
    }
    if (n) {
      const gl = GL.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, ib.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 20);
    }
    this.shadowCasters = n;
    return groups;
  },

  /* what: 'trunk' (opaque trunks), 'foliage' / 'shadow' (needle cards) */
  drawTrees(prog, groups, what, buf = 'props') {
    const gl = GL.gl;
    for (let sh = 0; sh < FIR_SHAPES.length; sh++) {
      if (what === 'trunk') {
        const g0 = groups[sh * 2], g1 = groups[sh * 2 + 1];
        const cnt = g0.count + g1.count;
        if (!cnt) continue;
        const m = GL.mesh['firTrunk' + sh];
        gl.bindVertexArray(m.vao);
        GL.bindInstancing(prog, buf, 3, 20, g0.first);
        gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, cnt);
        continue;
      }
      for (let far = 0; far < 2; far++) {
        const g = groups[sh * 2 + far];
        if (!g.count) continue;
        const m = GL.mesh[(far ? 'firFolLo' : 'firFol') + sh];
        gl.bindVertexArray(m.vao);
        GL.bindInstancing(prog, buf, 3, 20, g.first);
        gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, g.count);
      }
    }
  },

  /* ---------- pass 2: main scene ---------- */
  scene(P, fx, state) {
    const gl = GL.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, GL.sceneFB());
    gl.viewport(0, 0, GL.w, GL.h);
    const ap = Atmos.p;
    gl.clearColor(ap.clear[0], ap.clear[1], ap.clear[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ---- sky ----
    // xyww pins depth to exactly 1.0; the default LESS test would fail
    // against the 1.0 depth-buffer clear, so relax it just for the dome.
    gl.depthMask(false);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    const sky = GL.prog.sky.use();
    gl.uniformMatrix4fv(sky.uProj, false, Cam.proj);
    gl.uniformMatrix4fv(sky.uView, false, Cam.view);
    gl.uniform3f(sky.uSunDir, Sun.dir.x, Sun.dir.y, Sun.dir.z);
    gl.uniform3f(sky.uSunColor, Sun.color[0], Sun.color[1], Sun.color[2]);
    gl.uniform3fv(sky.uZenith, ap.zenith);
    gl.uniform3fv(sky.uHorizon, ap.horizon);
    gl.uniform1f(sky.uStars, ap.stars);
    gl.uniform1f(sky.uCloudLum, ap.cloudLum);
    gl.uniform1f(sky.uTime, GL.time * 60);
    const skyM = GL.mesh.sky;
    gl.bindVertexArray(skyM.vao);
    gl.drawElements(gl.TRIANGLES, skyM.count, gl.UNSIGNED_INT, 0);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);

    // ---- distant peaks on the horizon ----
    Scenery.drawMountains();

    // ---- terrain ----
    const wp = GL.prog.world.use();
    Sun.setUniforms(wp);
    gl.uniform1f(wp.uSparkle, 1.0);
    gl.uniform1f(wp.uDetail, GL.quality < 1 ? 0 : 1);
    gl.uniformMatrix4fv(wp.uModel, false, IDENT);
    for (const c of World.visible) {
      const lod = this.pickLod(c);
      const m = GL.chunkMesh(c, lod);
      if (!m) continue;
      m.lastUsed = Game.frameNo;
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    }

    // ---- board tracks in the snow ----
    Scenery.drawTrail();

    // ---- instanced props (trees) ----
    const ip = GL.prog.inst.use();
    Sun.setUniforms(ip);
    gl.uniform1f(ip.uSparkle, 0.0);
    gl.uniformMatrix4fv(ip.uModel, false, IDENT);
    const groups = this.fillTreeBuffer(P);
    this.drawTrees(ip, groups, 'trunk');
    {
      const fp = GL.prog.foliage.use();
      Sun.setUniforms(fp);
      gl.uniform1f(fp.uSparkle, 1.0);
      gl.uniformMatrix4fv(fp.uModel, false, IDENT);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, GL.tex.needles);
      gl.uniform1i(fp.uNeedle, 2);
      gl.activeTexture(gl.TEXTURE0);
      const a2c = !!GL.vao.sceneMS;
      gl.uniform1f(fp.uA2C, a2c ? 1 : 0);
      gl.uniform1f(fp.uSnowLoad, Level.cur.zen && Atmos.mode === 'neon' ? 0.6 : 1.0);
      gl.uniform1f(fp.uWind, 0.6);
      gl.disable(gl.CULL_FACE);
      if (a2c) gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      this.drawTrees(fp, groups, 'foliage');
      if (a2c) gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.enable(gl.CULL_FACE);
      ip.use();
    }
    // rocks
    if (this.rocks.length) {
      const ib = GL.buf.props, d = ib.data;
      let r = 0;
      for (const k of this.rocks) {
        if (r >= ib.max) break;
        const o = r * 20, c = Math.cos(k.rot), s = Math.sin(k.rot), sc = k.sc;
        d[o] = c * sc; d[o + 1] = 0; d[o + 2] = -s * sc; d[o + 3] = 0;
        d[o + 4] = 0;  d[o + 5] = sc * 0.8; d[o + 6] = 0; d[o + 7] = 0;
        d[o + 8] = s * sc; d[o + 9] = 0; d[o + 10] = c * sc; d[o + 11] = 0;
        d[o + 12] = k.x; d[o + 13] = k.y - k.sc * 0.25; d[o + 14] = k.z; d[o + 15] = 1;
        const sh = 0.8 + hash2(Math.floor(k.x), Math.floor(k.z), 55) * 0.4;
        d[o + 16] = sh; d[o + 17] = sh; d[o + 18] = sh * 1.05; d[o + 19] = 1;
        r++;
      }
      if (r > 0) {
        const m = GL.mesh.rock;
        gl.bindVertexArray(m.vao);
        GL.bindInstancing(ip, 'props', 3, 20);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, ib.data, 0, r * 20);
        gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, r);
      }
    }

    // ---- kickers get a half-pipe wall when the feature asks for one ----
    this.drawPipes(ip);

    // ---- gates ----
    this.drawGates(ip, P);

    // ---- night: lamp posts along the run ----
    Atmos.drawLamps(ip, P);

    // ---- level structures ----
    const lp = GL.prog.lit.use();
    Sun.setUniforms(lp);
    gl.uniform1f(lp.uSparkle, 0.0);
    if (GL.mesh._levelDecor) drawMesh(lp, '_levelDecor', IDENT);

    // ---- rider + board: outfit palette + per-slot materials ----
    const rp = GL.prog.rider.use();
    Sun.setUniforms(rp);
    gl.uniform3fv(rp.uPal, Outfit.palette);
    drawMesh(rp, 'board', P.boardMat);
    for (let i = 0; i < P.partCount; i++) {
      const q = P.parts[i];
      drawMesh(rp, q.mesh, q.mat);
    }

    // ---- particles ----
    // depthMask off: a snow cloud must not write depth, or every puff
    // occludes the rider and terrain behind it.
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    fx.draw();
    Scenery.drawSnow();
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  },

  drawPipes(ip) {
    if (Level.cur.height !== mtnHeightAt) return;  // the mountain's random feature walls only
    const gl = GL.gl;
    const ib = GL.buf.parts, d = ib.data;
    let n = 0;
    const z0 = Math.floor((Cam.pos.z - 200) / SEG);
    for (let i = 0; i < 6; i++) {
      const k = featureAt(z0 + i);
      if (!k || k.kind !== 'pipe') continue;
      const y = heightAt(k.x, k.z);
      if (Math.abs(y - Cam.pos.y) > 160) continue;
      const o = n * 20;
      const c = Math.cos(k.a), s = Math.sin(k.a);
      // quarter torus runs across the piste; orient along the slope
      d[o] = c; d[o + 1] = 0; d[o + 2] = s; d[o + 3] = 0;
      d[o + 4] = 0; d[o + 5] = 1; d[o + 6] = 0; d[o + 7] = 0;
      d[o + 8] = -s; d[o + 9] = 0; d[o + 10] = c; d[o + 11] = 0;
      // NB: features carry no y — use the height sampled just above
      d[o + 12] = k.x; d[o + 13] = y - 0.5; d[o + 14] = k.z; d[o + 15] = 1;
      d[o + 16] = 0.93; d[o + 17] = 0.97; d[o + 18] = 1.0; d[o + 19] = 1;
      n++;
    }
    if (!n) return;
    const m = GL.mesh.pipe;
    gl.bindVertexArray(m.vao);
    GL.bindInstancing(ip, 'parts', 3, 20);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, ib.data, 0, n * 20);
    gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0, n);
  },

  /* gate colour: alternating slalom red / blue, green once cleared, grey if missed.
     Values > 1 push the flags past the bloom threshold so they glow. */
  gateTint(g, gi) {
    if (g.hit) return [0.45, 1.7, 0.6];
    if (g.missed) return [0.85, 0.85, 0.9];
    const next = g === Gates.upcoming();
    const k = next ? 1.15 + 0.45 * (0.5 + 0.5 * Math.sin(GL.time * 5)) : 1.0;
    return g.i % 2 ? [0.25 * k, 0.6 * k, 1.9 * k] : [1.9 * k, 0.28 * k, 0.22 * k];
  },

  drawGates(ip, P) {
    const gl = GL.gl;
    const ib = GL.buf.parts, d = ib.data;
    const vis = Gates.list.filter(g => Math.abs(g.z - Cam.pos.z) < 360);
    if (!vis.length) return;
    const put = (n, m, tint) => {
      const o = n * 20;
      for (let i = 0; i < 16; i++) d[o + i] = m[i];
      d[o + 16] = tint[0]; d[o + 17] = tint[1]; d[o + 18] = tint[2]; d[o + 19] = 1;
    };
    const m = _m4.b;
    const draw = (mesh, n) => {
      if (!n) return;
      const gm = GL.mesh[mesh];
      gl.bindVertexArray(gm.vao);
      GL.bindInstancing(ip, 'parts', 3, 20);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, ib.data, 0, n * 20);
      gl.drawElementsInstanced(gl.TRIANGLES, gm.count, gl.UNSIGNED_INT, 0, n);
    };

    // poles + flags (the right-hand pole is turned 180° so its flag hangs inward)
    let n = 0;
    for (const g of vis) {
      const tint = this.gateTint(g);
      for (const sgn of [-1, 1]) {
        if (n >= ib.max) break;
        const x = g.x + sgn * g.w * 0.5, y = heightAt(x, g.z) - 0.15;
        m4ident(m);
        if (sgn > 0) { m[0] = -1; m[10] = -1; }
        m[12] = x; m[13] = y; m[14] = g.z;
        put(n++, m, tint);
      }
    }
    draw('gate', n);

    // banner strung between the pole tops
    n = 0;
    for (const g of vis) {
      if (n >= ib.max) break;
      const xL = g.x - g.w * 0.5, xR = g.x + g.w * 0.5;
      const yL = heightAt(xL, g.z) + 4.9, yR = heightAt(xR, g.z) + 4.9;
      m4ident(m);
      m[0] = xR - xL; m[1] = yR - yL;           // X column spans pole to pole
      m[5] = 1.15;                             // banner height
      m[12] = xL; m[13] = yL; m[14] = g.z;
      put(n++, m, this.gateTint(g));
    }
    draw('banner', n);
  },

  /* ---------- pass 3+4: bloom + composite ---------- */
  post(speedN, flash, desat) {
    const gl = GL.gl;
    GL.resolveScene();
    const bw = GL.vao.bloomA.w, bh = GL.vao.bloomA.h;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    const tri = GL.mesh.fstri;

    // bright extract
    gl.bindFramebuffer(gl.FRAMEBUFFER, GL.vao.bloomA.fb);
    gl.viewport(0, 0, bw, bh);
    const bp = GL.prog.bright.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, GL.vao.scene.color);
    gl.uniform1i(bp.uTex, 0);
    gl.uniform1f(bp.uThresh, Atmos.p.bloomThresh);
    gl.bindVertexArray(tri.vao);
    for (let l = 3; l < 8; l++) { gl.disableVertexAttribArray(l); gl.vertexAttribDivisor(l, 0); }
    gl.drawElements(gl.TRIANGLES, tri.count, gl.UNSIGNED_INT, 0);

    // two blur hits, ping-ponging
    const bl = GL.prog.blur.use();
    for (let i = 0; i < 2; i++) {
      const spread = 1 + i * 2.1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, GL.vao.bloomB.fb);
      gl.viewport(0, 0, bw, bh);
      gl.bindTexture(gl.TEXTURE_2D, GL.vao.bloomA.color);
      gl.uniform1i(bl.uTex, 0);
      gl.uniform2f(bl.uDir, spread / bw, 0);
      gl.drawElements(gl.TRIANGLES, tri.count, gl.UNSIGNED_INT, 0);

      gl.bindFramebuffer(gl.FRAMEBUFFER, GL.vao.bloomA.fb);
      gl.bindTexture(gl.TEXTURE_2D, GL.vao.bloomB.color);
      gl.uniform2f(bl.uDir, 0, spread / bh);
      gl.drawElements(gl.TRIANGLES, tri.count, gl.UNSIGNED_INT, 0);
    }

    // composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, GL.w, GL.h);
    const cp = GL.prog.comp.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, GL.vao.scene.color);
    gl.uniform1i(cp.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, GL.vao.bloomA.color);
    gl.uniform1i(cp.uBloom, 1);
    gl.uniform1f(cp.uExposure, Atmos.p.exposure);
    gl.uniform1f(cp.uVignette, 0.85);
    gl.uniform1f(cp.uSpeed, speedN);
    gl.uniform1f(cp.uTime, GL.time);
    gl.uniform1f(cp.uFlash, flash);
    gl.uniform1f(cp.uDesat, desat);
    gl.uniform2f(cp.uRes, GL.w, GL.h);
    gl.drawElements(gl.TRIANGLES, tri.count, gl.UNSIGNED_INT, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }
};
