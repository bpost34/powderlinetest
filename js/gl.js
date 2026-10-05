/* =====================================================================
   gl.js — the renderer. Hand-written WebGL2: no three.js, no gl-matrix.
   Passes:  (1) sun shadow map  (2) sky + terrain + props + rider + FX
            (3) bright extract → separable bloom  (4) tonemap/grade composite
   ===================================================================== */
'use strict';

const GL = {
  canvas: null, gl: null, dpr: 1, w: 1, h: 1,
  prog: {}, mesh: {}, vao: {}, buf: {}, tex: {},
  shadowSize: 2048,
  time: 0,
  quality: 1,          // 1 = full, 0.75 = reduced
  resScale: 1,         // dynamic resolution (1 = full pixel budget), lowered when frames run long

  /* ---------------- shader plumbing ---------------- */
  compile(type, src, name) {
    const gl = this.gl;
    const s = gl.createShader(type);
    // '#version' MUST be the very first characters of the source — no leading
    // newline, no whitespace, or the driver rejects the whole shader.
    gl.shaderSource(s, '#version 300 es\n' + src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n').map((l, i) => String(i + 1).padStart(3) + ' | ' + l).join('\n');
      throw new Error('Shader "' + name + '" failed to compile:\n' + log + '\n' + lines);
    }
    return s;
  },
  link(vsSrc, fsSrc, name) {
    const gl = this.gl;
    const p = gl.createProgram();
    const vs = this.compile(gl.VERTEX_SHADER, vsSrc, name + '.vert');
    const fs = this.compile(gl.FRAGMENT_SHADER, fsSrc, name + '.frag');
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    // Pin attributes to fixed slots: upload() hardcodes 0/1/2, bindInstancing
    // uses 3..7, bindParticles uses 3/4. Binding an undeclared name is a no-op.
    const SLOTS = [['aPos', 0], ['aNormal', 1], ['aColor', 2],
                   ['aIM0', 3], ['aIM1', 4], ['aIM2', 5], ['aIM3', 6], ['aTint', 7],
                   ['aP0', 3], ['aP1', 4], ['aAlpha', 1]];
    for (const [nm, loc] of SLOTS) gl.bindAttribLocation(p, loc, nm);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link "' + name + '": ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    // Uniform locations are flattened ONTO the returned handle: every call
    // site in render.js/game.js reads prog.uProj, wp.uModel, cp.uExposure…
    // directly. Returning only { p, u } made every gl.uniform* call receive
    // undefined — a silent no-op that rendered a black screen with no errors.
    return Object.assign({ p, u, use() { gl.useProgram(this.p); return this; } }, u);
  },

  /* ---------------- buffers ---------------- */
  /* geo = {v:[], i:[]} → VAO with pos(0) normal(1) color(2), stride STRIDE.
     Every mesh in the game uses this one layout — including streamed terrain,
     which writes white into the colour slots — so no per-mesh stride is needed
     and no attribute slot can ever read past the end of a buffer. */
  upload(name, geo) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geo.v), gl.STATIC_DRAW);
    const F = STRIDE * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, F, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, F, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, F, 24);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(geo.i), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const m = { vao, count: geo.i.length, vb, ib, stride: STRIDE };
    this.mesh[name] = m;
    return m;
  },

  /* dynamic instance buffer: stride floats per instance, attributes at baseLoc.. */
  instanceBuffer(name, maxInstances, stride) {
    const gl = this.gl;
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, maxInstances * stride * 4, gl.DYNAMIC_DRAW);
    this.buf[name] = { buf: b, data: new Float32Array(maxInstances * stride), max: maxInstances, stride };
    return this.buf[name];
  },
  /* instance layout A: mat4 (loc base..base+3) + vec4 tint (base+4), stride 20 */
  bindInstancing(prog, ibName, baseLoc, stride, first = 0) {
    const gl = this.gl;
    const ib = this.buf[ibName];
    gl.bindBuffer(gl.ARRAY_BUFFER, ib.buf);
    const F = stride * 4, o = first * F;        // first: start at instance #first (no baseInstance in WebGL2)
    for (let c = 0; c < 4; c++) {
      gl.enableVertexAttribArray(baseLoc + c);
      gl.vertexAttribPointer(baseLoc + c, 4, gl.FLOAT, false, F, o + c * 16);
      gl.vertexAttribDivisor(baseLoc + c, 1);
    }
    gl.enableVertexAttribArray(baseLoc + 4);
    gl.vertexAttribPointer(baseLoc + 4, 4, gl.FLOAT, false, F, o + 64);
    gl.vertexAttribDivisor(baseLoc + 4, 1);
  },

  /* instance layout B (particles): vec4 pos+size (loc 3), vec4 tint (loc 4), stride 8 */
  bindParticles(ibName) {
    const gl = this.gl;
    const ib = this.buf[ibName];
    gl.bindBuffer(gl.ARRAY_BUFFER, ib.buf);
    const F = 32;
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, F, 0);  gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, F, 16); gl.vertexAttribDivisor(4, 1);
    gl.disableVertexAttribArray(5); gl.vertexAttribDivisor(5, 0);
    gl.disableVertexAttribArray(6); gl.vertexAttribDivisor(6, 0);
    gl.disableVertexAttribArray(7); gl.vertexAttribDivisor(7, 0);
  },

  /* ---------------- render targets ---------------- */
  makeTarget(name, w, h, opts = {}) {
    const gl = this.gl;
    const color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, color);
    const fmt = opts.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    const internal = opts.hdr ? gl.RGBA16F : gl.RGBA8;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, fmt, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, opts.linear === false ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.linear === false ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    let depth = null;
    if (opts.depth) {
      depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    // Fail loudly: an incomplete FBO otherwise renders silently to nothing.
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) {
      const names = {};
      names[gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT] = 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT';
      names[gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT] = 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT';
      names[gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS] = 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS';
      names[gl.FRAMEBUFFER_UNSUPPORTED] = 'FRAMEBUFFER_UNSUPPORTED';
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      throw new Error('Framebuffer "' + name + '" incomplete (' + (names[st] || '0x' + st.toString(16)) +
        ') at ' + w + 'x' + h + (opts.hdr ? ' HDR' : '') + '. Try a lower quality setting.');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const t = { fb, color, depth, w, h };
    this.vao[name] = t;
    return t;
  },

  /* RGBA8 texture from raw pixels, mipmapped + anisotropic (foliage cards) */
  makeTexture(name, img) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, img.W, img.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const af = gl.getExtension('EXT_texture_filter_anisotropic');
    if (af) gl.texParameterf(gl.TEXTURE_2D, af.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(af.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    this.tex[name] = t;
    return t;
  },

  /* Multisampled scene target (resolved into 'scene' each frame). MSAA is what
     lets the foliage cards use alpha-to-coverage: soft, stable needle edges
     with no sorting. Returns false (and we render single-sampled) if the
     driver can't do multisampled float colour. */
  makeMSTarget(w, h) {
    const gl = this.gl;
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    if (samples < 2) return false;
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const color = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, color);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, this.hdr ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(color); gl.deleteRenderbuffer(depth); return false; }
    this.vao.sceneMS = { fb, colorRB: color, depthRB: depth, w, h, samples };
    return true;
  },

  /* where the 3D scene is drawn this frame */
  sceneFB() { return this.vao.sceneMS ? this.vao.sceneMS.fb : this.vao.scene.fb; },

  /* multisampled → texture, before post-processing reads it */
  resolveScene() {
    const ms = this.vao.sceneMS; if (!ms) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.vao.scene.fb);
    gl.blitFramebuffer(0, 0, ms.w, ms.h, 0, 0, ms.w, ms.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  },

  makeShadowMap(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      throw new Error('Shadow framebuffer incomplete (0x' + st.toString(16) + ') at ' + w + 'x' + h);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.buf.shadowTex = tex;
    this.vao.shadowFB = { fb, tex, w, h };
  },

  /* ---------------- init ---------------- */
  init(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: true, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    const floatExt = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.hdr = !!floatExt;

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.clearColor(0.05, 0.08, 0.13, 1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    // attribute bindings are identical for every standard mesh
    this.PROG_VS_COMMON = `
      precision highp float;
      in vec3 aPos; in vec3 aNormal; in vec3 aColor;
      out vec3 vNormal; out vec3 vColor; out vec3 vWorld;
      uniform mat4 uProj, uView, uModel;
      mat4 model(){ return uModel; }
    `;

    this.buildShaders();

    // geometry
    buildRider();
    this.upload('board', buildBoard());
    for (const k in RiderGeo) this.upload(k, RiderGeo[k]);
    this.upload('tree', buildTree());
    for (let sh = 0; sh < FIR_SHAPES.length; sh++) {
      this.upload('firFol' + sh, buildFirFoliage(sh, 0));
      this.upload('firFolLo' + sh, buildFirFoliage(sh, 1));
      this.upload('firTrunk' + sh, buildFirTrunk(sh));
    }
    this.makeTexture('needles', makeNeedleCanvas());
    this.upload('rock', buildRock());
    this.upload('pipe', buildPipe());
    this.upload('gate', buildGate());
    this.upload('banner', buildBanner());
    this.upload('particle', buildParticleQuad());
    this.upload('sky', buildSkyDome());
    this.upload('fstri', buildFsTri());
    this.upload('lampPost', buildLampPost());
    this.upload('lampHead', buildLampHead());

    this.instanceBuffer('props', 6000, 20);
    this.instanceBuffer('shadowProps', 2500, 20);
    this.instanceBuffer('parts', 96, 20);
    this.instanceBuffer('particles', 3000, 8);

    // chunk VAO cache
    this.chunkVAO = new Map();
    this.resize();
    return gl;
  },

  resize() {
    const gl = this.gl;
    // Render at most ~pixelBudget pixels (× resScale² from the dynamic-resolution
    // monitor) and let the browser upscale the canvas. A Retina laptop window is
    // 5–6 MP at full density — several times a phone — and every one of those
    // pixels runs the terrain noise and MSAA, so density is capped by area.
    const cw = Math.max(1, this.canvas.clientWidth), ch = Math.max(1, this.canvas.clientHeight);
    let dpr = Math.min(window.devicePixelRatio || 1, this.maxDPR());
    const budget = (this.quality < 1 ? 1.0e6 : 2.2e6) * this.resScale * this.resScale;
    if (cw * ch * dpr * dpr > budget) dpr = Math.sqrt(budget / (cw * ch));
    dpr = Math.max(dpr, 0.45);
    const w = Math.max(2, Math.floor(cw * dpr));
    const h = Math.max(2, Math.floor(ch * dpr));
    if (w === this.w && h === this.h && this.vao.scene) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = w; this.canvas.height = h;
    gl.viewport(0, 0, w, h);
    // release the previous targets first, or every resize leaks three
    // textures + fbo + rbo at full display resolution
    const ms = this.vao.sceneMS;
    if (ms) { gl.deleteFramebuffer(ms.fb); gl.deleteRenderbuffer(ms.colorRB); gl.deleteRenderbuffer(ms.depthRB); delete this.vao.sceneMS; }
    for (const nm of ['scene', 'bloomA', 'bloomB']) {
      const t = this.vao[nm]; if (!t) continue;
      if (t.color) gl.deleteTexture(t.color);
      if (t.depth) gl.deleteRenderbuffer(t.depth);
      if (t.fb) gl.deleteFramebuffer(t.fb);
      delete this.vao[nm];
    }
    const bw = Math.max(2, w >> 1), bh = Math.max(2, h >> 1);
    const msaa = this.msaa !== false && this.makeMSTarget(w, h);
    this.makeTarget('scene', w, h, { hdr: this.hdr, depth: !msaa });
    this.makeTarget('bloomA', bw, bh, { hdr: this.hdr });
    this.makeTarget('bloomB', bw, bh, { hdr: this.hdr });
  },
  maxDPR() { return this.quality < 1 ? 1.0 : 1.75; },

  /* called by the frame-rate monitor in game.js when a run keeps missing ~55 fps:
     shrink the render resolution first; at the floor, drop MSAA and the
     costlier surface detail */
  degrade() {
    if (this.resScale > 0.62) this.resScale = Math.max(0.6, this.resScale * 0.85);
    else if (this.msaa !== false) this.msaa = false;
    else if (this.quality >= 1) { this.quality = 0.75; Render.TREE_LOD_DIST = 60; }
    else return false;
    this.w = 0;                                   // force the targets to rebuild
    this.resize();
    if (window.console) console.info('POWDER LINE: render ' + this.w + 'x' + this.h +
      ' (scale ' + this.resScale.toFixed(2) + ', msaa ' + (this.msaa !== false) + ', quality ' + this.quality + ')');
    return true;
  },

  /* chunk mesh → GPU, cached by chunk+lod identity */
  /* free every cached terrain chunk (level switch) */
  purgeChunks() {
    const gl = this.gl;
    for (const [k, m] of this.chunkVAO) {
      gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vb); gl.deleteBuffer(m.ib);
      delete this.mesh['_chunk' + k];
    }
    this.chunkVAO.clear();
  },

  chunkMesh(chunk, lod) {
    if (lod < 0) return null;                 // nothing built for this chunk yet
    const key = chunk.ix + ':' + chunk.iz + ':' + lod;
    let m = this.chunkVAO.get(key);
    const data = chunk.lods[lod];
    if (!data) return null;
    if (m && m.count === data.count) return m;
    const gl = this.gl;
    if (m) { gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.vb); gl.deleteBuffer(m.ib); }
    m = this.upload('_chunk' + key, data);
    m.key = key;
    this.chunkVAO.set(key, m);
    return m;
  },
};
// (chunk cache reaping lives in Render.reapChunks — age-based, with a
//  monotonic frame counter, and it also drops the GL.mesh reference)

/* =====================================================================
   SHADERS
   ===================================================================== */
const LIGHTING_GLSL = `
  precision highp float;
  uniform vec3 uSunDir;      // normalized, points FROM surface TO sun
  uniform vec3 uSunColor;
  uniform vec3 uSkyTint;
  uniform vec3 uGroundTint;
  uniform vec3 uCamPos;
  uniform float uTime;
  uniform mat4 uLightVP;
  uniform highp sampler2DShadow uShadow;
  uniform float uFogDensity;
  uniform vec3 uFogColor;
  uniform float uSparkle;
  uniform float uDetail;     // 1 = full surface detail, 0 = low-spec devices
  // soft point lights (night lamps, rider glow): xyz = position, w = radius / rgb = colour
  uniform vec4 uPL[8]; uniform vec4 uPLc[8]; uniform int uPLn;
  // neon mode: grid traced on the snow
  uniform float uNeon; uniform vec3 uNeonA, uNeonB;

  const float PI = 3.14159265;

  float hash12(vec2 p){
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    float a = hash12(i), b = hash12(i+vec2(1,0)), c = hash12(i+vec2(0,1)), d = hash12(i+vec2(1,1));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm(vec2 p){
    float s = 0.0, a = 0.5;
    for(int i=0;i<4;i++){ s += vnoise(p)*a; p *= 2.03; a *= 0.5; }
    return s/0.9375;
  }
  // 3D value noise: no stretching on steep walls (2D xz noise smears into streaks)
  float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  float vnoise3(vec3 p){
    vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.0-2.0*f);
    float a = mix(mix(hash13(i), hash13(i+vec3(1,0,0)), u.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), u.x), u.y);
    float b = mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), u.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), u.x), u.y);
    return mix(a, b, u.z);
  }
  float fbm2(vec2 p){ return vnoise(p) * 0.66 + vnoise(p * 2.03 + 5.7) * 0.34; }
  float fbm3(vec3 p){ return (vnoise3(p) * 0.5 + vnoise3(p * 2.03 + 7.1) * 0.25 + vnoise3(p * 4.1 + 3.3) * 0.125) / 0.875; }

  float shadowFactor(vec3 wp, float ndl){
    vec4 lp = uLightVP * vec4(wp, 1.0);
    vec3 c = lp.xyz / lp.w * 0.5 + 0.5;
    if(c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    float bias = 0.0004 + 0.0016 * (1.0 - ndl);   // depth range is ~330 m → 0.13–0.66 m
    vec2 t = 1.0 / vec2(textureSize(uShadow, 0));
    float s = 0.0;
    for(int y=-1; y<=1; y++)
      for(int x=-1; x<=1; x++)
        s += texture(uShadow, vec3(c.xy + vec2(float(x), float(y)) * t, c.z - bias));
    return s / 9.0;
  }

  vec3 hemi(vec3 n){
    float up = n.y * 0.5 + 0.5;
    return mix(uGroundTint, uSkyTint, up);
  }

  // snow albedo: drifts, exposed rock, blue shadows in hollows
  vec3 snowAlbedo(vec3 wp, vec3 n, float ao){
    float steep = 1.0 - clamp(n.y, 0.0, 1.0);
    float rockMask = smoothstep(0.42, 0.72, steep) * (0.55 + 0.45 * fbm(wp.xz * 0.09));
    vec3 drift = mix(vec3(0.90,0.94,1.00), vec3(0.78,0.87,0.99), fbm(wp.xz * 0.035));
    vec3 rock = mix(vec3(0.26,0.28,0.33), vec3(0.42,0.43,0.47), fbm(wp.xz * 0.6));
    vec3 col = mix(drift, rock, rockMask);
    col *= 0.86 + 0.14 * ao;
    return col;
  }

  vec3 shade(vec3 albedo, vec3 n, vec3 wp, float ao, float rough, float sparkleAmt){
    vec3 V = normalize(uCamPos - wp);
    float ndl = clamp(dot(n, uSunDir), 0.0, 1.0);
    float sh = shadowFactor(wp, ndl);
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(n, H), 0.0), mix(24.0, 220.0, 1.0 - rough)) * rough;
    // rime sparkle: hash glints where the half-vector lines up
    if(sparkleAmt > 0.001 && uSparkle > 0.0){
      float g = hash12(floor(wp.xz * 26.0) + floor(wp.y * 7.0));
      float tw = fract(g * 31.7 + uTime * 0.7);
      float glint = smoothstep(0.90, 0.995, g) * smoothstep(0.35, 1.0, tw) *
                    pow(max(dot(H, n), 0.0), 60.0);
      spec += glint * sparkleAmt * 3.2;
    }
    vec3 sun = uSunColor * ndl * sh;
    vec3 amb = hemi(n) * (0.42 + 0.28 * n.y) * mix(1.0, 0.72, sh);
    // snow bounce light between slopes
    vec3 col = albedo * (sun + amb) + uSunColor * spec * sh * 0.55;
    // soft pools of light from nearby lamps (smooth falloff to zero at the radius)
    for(int i = 0; i < 8; i++){
      if(i >= uPLn) break;
      vec3 Lv = uPL[i].xyz - wp;
      float d = length(Lv);
      float a = clamp(1.0 - d / uPL[i].w, 0.0, 1.0);
      a *= a;
      col += albedo * uPLc[i].rgb * a * (0.25 + 0.75 * max(dot(n, Lv / max(d, 1e-3)), 0.0));
    }
    return col;
  }

  vec3 applyFog(vec3 col, vec3 wp, vec3 V, float dist){
    float h = wp.y - uCamPos.y;
    float fd = uFogDensity * exp(-max(h, 0.0) * 0.006);
    float f = 1.0 - exp(-pow(dist * fd, 1.55));
    float sunAmount = max(dot(-V, uSunDir), 0.0);
    vec3 fog = mix(uFogColor, uFogColor * 1.35 + vec3(0.22,0.16,0.07), pow(sunAmount, 5.0) * 0.75);
    return mix(col, fog, clamp(f, 0.0, 1.0));
  }
`;

GL.buildShaders = function () {
  const V_HEAD = `
    precision highp float;
    in vec3 aPos; in vec3 aNormal; in vec3 aColor;
    uniform mat4 uProj, uView, uModel;
  `;
  const V_OUT = `
    out vec3 vNormal; out vec3 vColor; out vec3 vWorld;
  `;

  /* ---------- terrain (procedural albedo, no vertex colour) ---------- */
  const TERRAIN_VS = V_HEAD + V_OUT + `
    void main(){
      vec4 wp = uModel * vec4(aPos, 1.0);
      vWorld = wp.xyz;
      vNormal = normalize(mat3(uModel) * aNormal);
      vColor = vec3(1.0);
      gl_Position = uProj * uView * wp;
    }`;

  const TERRAIN_FS = LIGHTING_GLSL + `
    in vec3 vNormal; in vec3 vColor; in vec3 vWorld;
    out vec4 fragColor;
    // wind-packed snow relief: soft drifts plus sastrugi ripples (height in metres)
    float snowRelief(vec2 q){
      float drift = fbm2(q * 0.22) * 0.30;
      float warp = vnoise(q * 0.05) * 7.0;
      float rip = sin(dot(q, vec2(0.83, 0.55)) * 2.1 + warp) * 0.5 + 0.5;
      rip = rip * rip * 0.035 * (0.4 + vnoise(q * 0.11));
      return drift + rip + vnoise(q * 2.3) * 0.012;
    }
    void main(){
      vec3 n = normalize(vNormal);
      float dist = length(uCamPos - vWorld);
      float forest = vColor.r, cav = vColor.g, wall = vColor.b;
      // micro relief → perturbed normal (fades out with distance, where it would alias)
      float rel = (1.0 - smoothstep(25.0, 90.0, dist)) * uDetail;
      if(rel > 0.0){
        vec2 q = vWorld.xz; float e = 0.12;
        float h0 = snowRelief(q);
        vec2 g = vec2(snowRelief(q + vec2(e, 0.0)) - h0, snowRelief(q + vec2(0.0, e)) - h0) / e;
        n = normalize(n + vec3(-g.x, 0.0, -g.y) * rel * 0.55);
      }
      // hollows hold cool shadow, crests catch light
      float ao = clamp(0.80 + (cav - 0.5) * 0.9, 0.55, 1.05) * (0.86 + 0.14 * clamp(n.y, 0.0, 1.0));
      vec3 alb = snowAlbedo(vWorld, n, ao);
      // valley walls: rock bands and gullies break through the snow on the steep parts
      float steep = 1.0 - clamp(n.y, 0.0, 1.0);
      float rock = 0.0;
      if(wall > 0.0 && steep > 0.15){
        float strata = fbm3(vec3(vWorld.x * 0.03, vWorld.y * 0.20, vWorld.z * 0.03));
        float gully = vnoise3(vec3(vWorld.x * 0.02, vWorld.y * 0.015, vWorld.z * 0.07));
        rock = wall * smoothstep(0.30, 0.55, steep + (strata - 0.5) * 0.45) * smoothstep(0.32, 0.6, gully);
        vec3 rockCol = mix(vec3(0.20, 0.20, 0.22), vec3(0.38, 0.37, 0.38), vnoise3(vWorld * 0.35));
        alb = mix(alb, rockCol, clamp(rock, 0.0, 1.0) * 0.9);
      }
      // distant forest canopy: past the real trees' range the cover is painted on,
      // as clumped dark crowns dusted with snow
      float fd = forest * smoothstep(60.0, 150.0, dist);
      if(fd > 0.0){
        float clump = vnoise3(vWorld * 0.42) * 0.66 + vnoise3(vWorld * 0.86 + 3.1) * 0.34 + vnoise3(vWorld * 0.045) * 0.45;
        float canopy = smoothstep(0.44, 0.62, clump) * fd;
        vec3 crown = mix(vec3(0.040, 0.068, 0.052), vec3(0.50, 0.55, 0.58), smoothstep(0.6, 0.9, vnoise3(vWorld * 1.1)) * 0.5);
        alb = mix(alb, crown, canopy * 0.92);
      }
      vec3 col = shade(alb, n, vWorld, ao, 0.55, smoothstep(0.55, 1.0, n.y) * (1.0 - rock));
      col *= mix(1.0, ao, 0.6);
      // groomed corduroy banding down the piste
      float cx = vWorld.x; // visual only
      col *= 1.0 + 0.022 * sin(cx * 1.1 + vWorld.z * 0.02);
      if(uNeon > 0.0){
        vec2 gp = vWorld.xz / 6.0;
        vec2 gw = abs(fract(gp - 0.5) - 0.5) / max(fwidth(gp), vec2(1e-4));
        float line = 1.0 - min(min(gw.x, gw.y), 1.0);
        vec3 nc = mix(uNeonA, uNeonB, 0.5 + 0.5 * sin(vWorld.z * 0.012 + vWorld.x * 0.02));
        col += nc * line * uNeon * exp(-dist * 0.006);
      }
      // cool sheen where the snow turns away from the camera (grazing angles)
      float fres = pow(1.0 - clamp(dot(n, normalize(uCamPos - vWorld)), 0.0, 1.0), 4.0);
      col += vec3(0.55, 0.70, 1.0) * fres * 0.16;
      col = applyFog(col, vWorld, normalize(uCamPos - vWorld), dist);
      fragColor = vec4(col, 1.0);
    }`;

  /* ---------- generic lit mesh (rider, board, props) ---------- */
  const LIT_VS = V_HEAD + V_OUT + `
    void main(){
      vec4 wp = uModel * vec4(aPos, 1.0);
      vWorld = wp.xyz;
      vNormal = normalize(mat3(uModel) * aNormal);
      vColor = aColor;
      gl_Position = uProj * uView * wp;
    }`;

  const LIT_FS = LIGHTING_GLSL + `
    in vec3 vNormal; in vec3 vColor; in vec3 vWorld;
    out vec4 fragColor;
    void main(){
      vec3 n = normalize(vNormal);
      float dist = length(uCamPos - vWorld);
      vec3 col = shade(vColor, n, vWorld, 1.0, 0.75, 0.0);
      col = applyFog(col, vWorld, normalize(uCamPos - vWorld), dist);
      fragColor = vec4(col, 1.0);
    }`;

  /* ---------- instanced props ---------- */
  const INST_VS = V_HEAD + V_OUT + `
    out float vEmis;
    in vec4 aIM0; in vec4 aIM1; in vec4 aIM2; in vec4 aIM3; in vec4 aTint;
    void main(){
      mat4 M = mat4(aIM0, aIM1, aIM2, aIM3);
      vec4 wp = uModel * M * vec4(aPos, 1.0);
      vWorld = wp.xyz;
      vNormal = normalize(mat3(M) * aNormal);
      vColor = aColor * aTint.rgb;   // mesh colour (foliage/trunk/snow) × per-instance tint
      vEmis = max(aTint.a - 1.0, 0.0);   // tint alpha above 1 = self-lit (lamp bulbs)
      gl_Position = uProj * uView * wp;
    }`;

  const INST_FS = LIGHTING_GLSL + `
    in vec3 vNormal; in vec3 vColor; in vec3 vWorld; in float vEmis;
    out vec4 fragColor;
    void main(){
      vec3 n = normalize(vNormal);
      float dist = length(uCamPos - vWorld);
      vec3 col = shade(vColor, n, vWorld, 1.0, 0.85, 0.0) + vColor * vEmis;
      col = applyFog(col, vWorld, normalize(uCamPos - vWorld), dist * (1.0 - min(vEmis, 1.0) * 0.6));
      fragColor = vec4(col, 1.0);
    }`;

  /* ---------- card foliage (instanced firs) ----------
     colour attribute = (u, v, ao); normal = the card's face normal. A soft
     volume normal (radial + up from the trunk) does most of the lighting so
     the crown reads as one rounded mass. Alpha-to-coverage under MSAA gives
     ragged, stable needle edges; without MSAA it falls back to alpha test. */
  const FOL_VS = V_HEAD + `
    out vec3 vNormal; out vec3 vVol; out vec3 vUVA; out vec3 vWorld; out vec3 vTint;
    in vec4 aIM0; in vec4 aIM1; in vec4 aIM2; in vec4 aIM3; in vec4 aTint;
    uniform float uWind, uTime;
    void main(){
      mat4 M = mat4(aIM0, aIM1, aIM2, aIM3);
      vec3 p = aPos;
      // branch tips bob a little in the wind (more out on the tips, higher up)
      float sway = sin(uTime * 1.3 + aIM3.x * 0.37 + aIM3.z * 0.21 + p.y * 0.6) * uWind;
      p.y += sway * aColor.x * 0.05;
      p.xz += sway * aColor.x * 0.035 * normalize(p.xz + 1e-4);
      vec4 wp = uModel * M * vec4(p, 1.0);
      vWorld = wp.xyz;
      vNormal = normalize(mat3(M) * aNormal);
      vec3 radial = vec3(p.x, 0.0, p.z);
      float rl = length(radial);
      vVol = normalize(mat3(M) * (rl > 1e-3 ? radial / rl * 0.85 + vec3(0.0, 0.75, 0.0) : vec3(0.0, 1.0, 0.0)));
      vUVA = aColor;
      vTint = aTint.rgb;
      gl_Position = uProj * uView * wp;
    }`;
  const FOL_FS = LIGHTING_GLSL + `
    in vec3 vNormal; in vec3 vVol; in vec3 vUVA; in vec3 vWorld; in vec3 vTint;
    out vec4 fragColor;
    uniform sampler2D uNeedle; uniform float uA2C, uSnowLoad;
    void main(){
      vec4 tx = texture(uNeedle, vUVA.xy);
      // mip levels average the coverage down, thinning distant crowns: lift it back
      vec2 tp = vUVA.xy * vec2(textureSize(uNeedle, 0));
      float lod = max(0.0, 0.5 * log2(max(dot(dFdx(tp), dFdx(tp)), dot(dFdy(tp), dFdy(tp)))));
      float a = tx.a * (1.0 + lod * 0.32);
      if(uA2C > 0.5) a = (a - 0.45) / max(fwidth(a), 1e-4) + 0.5;
      else if(a < 0.5) discard;
      vec3 V = normalize(uCamPos - vWorld);
      vec3 cn = normalize(vNormal);
      float top = step(0.0, dot(cn, V));               // looking at the upper face?
      float ao = vUVA.z;
      vec3 needle = mix(vec3(0.022, 0.050, 0.036), vec3(0.070, 0.135, 0.085), tx.r) * vTint;
      needle = mix(needle, vec3(0.16, 0.11, 0.08), tx.b * 0.8);
      float snow = clamp(tx.g * mix(0.15, 0.85, top) * uSnowLoad * (0.55 + 0.45 * ao), 0.0, 1.0);
      vec3 alb = mix(needle, vec3(0.90, 0.94, 1.0), snow);
      vec3 fn = top > 0.5 ? cn : -cn;
      // undersides lean on the soft volume normal (they catch bounce light off the snow)
      vec3 n = normalize(mix(normalize(vVol), fn, top > 0.5 ? 0.30 + snow * 0.45 : 0.12));
      vec3 col = shade(alb, n, vWorld, ao, mix(0.92, 0.6, snow), snow * 0.5);
      col *= mix(ao, 1.0, 0.5 + snow * 0.4);
      float dist = length(uCamPos - vWorld);
      col = applyFog(col, vWorld, V, dist);
      fragColor = vec4(col, clamp(a, 0.0, 1.0));
    }`;
  const SHADOW_FOL_VS = V_HEAD + `
    uniform mat4 uLightVP;
    out vec2 vUV;
    in vec4 aIM0; in vec4 aIM1; in vec4 aIM2; in vec4 aIM3; in vec4 aTint;
    void main(){
      mat4 M = mat4(aIM0, aIM1, aIM2, aIM3);
      vUV = aColor.xy;
      gl_Position = uLightVP * (uModel * M * vec4(aPos, 1.0));
    }`;
  const SHADOW_FOL_FS = `
    precision highp float;
    in vec2 vUV; out vec4 fragColor;
    uniform sampler2D uNeedle;
    void main(){ if(texture(uNeedle, vUV).a < 0.4) discard; fragColor = vec4(1.0); }`;

  /* ---------- shadow depth ---------- */
  const SHADOW_VS = V_HEAD + `
    uniform mat4 uLightVP;
    void main(){
      vec4 wp = uModel * vec4(aPos, 1.0);
      gl_Position = uLightVP * wp;
    }`;
  const SHADOW_FS = `
    precision highp float;
    out vec4 fragColor;
    void main(){ fragColor = vec4(1.0); }`;
  const SHADOW_INST_VS = V_HEAD + `
    uniform mat4 uLightVP;
    in vec4 aIM0; in vec4 aIM1; in vec4 aIM2; in vec4 aIM3; in vec4 aTint;
    void main(){
      mat4 M = mat4(aIM0, aIM1, aIM2, aIM3);
      vec4 wp = uModel * M * vec4(aPos, 1.0);
      gl_Position = uLightVP * wp;
    }`;

  /* ---------- sky dome ---------- */
  const SKY_VS = V_HEAD + `
    out vec3 vDir;
    void main(){
      vDir = aPos;
      // mat3() strips the camera translation so the dome follows the eye
      // instead of sitting at the world origin.
      mat4 V = mat4(mat3(uView));
      vec4 p = uProj * V * vec4(aPos, 1.0);
      gl_Position = p.xyww;   // pin to far plane (needs depthFunc LEQUAL)
    }`;
  const SKY_FS = `
    precision highp float;
    in vec3 vDir; out vec4 fragColor;
    uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uTime;
    uniform vec3 uZenith; uniform vec3 uHorizon;
    uniform float uStars, uCloudLum;
    float h12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
    float vn(vec2 p){ vec2 i=floor(p),f=fract(p); vec2 u=f*f*(3.0-2.0*f);
      return mix(mix(h12(i),h12(i+vec2(1,0)),u.x), mix(h12(i+vec2(0,1)),h12(i+vec2(1,1)),u.x), u.y); }
    float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=vn(p)*a; p=p*2.07+vec2(1.7,9.2); a*=0.5;} return s/0.96875; }
    void main(){
      vec3 d = normalize(vDir);
      float up = clamp(d.y, -0.2, 1.0);
      vec3 sky = mix(uHorizon, uZenith, pow(clamp(up,0.0,1.0), 0.62));
      float sd = max(dot(d, uSunDir), 0.0);
      sky += uSunColor * pow(sd, 220.0) * 6.0;                 // disk
      sky += uSunColor * pow(sd, 9.0) * 0.42;                  // glow
      sky += vec3(0.9,0.62,0.42) * pow(sd, 2.2) * 0.11;        // warm haze
      // drifting cloud deck
      if(d.y > 0.005){
        vec2 cp = d.xz / (d.y + 0.16) * 1.35;
        float t = uTime * 0.008;
        float c = fbm(cp + vec2(t, t * 0.3));
        float c2 = fbm(cp * 2.4 + vec2(-t * 1.6, t * 0.7));
        float cloud = smoothstep(0.48, 0.86, c * 0.75 + c2 * 0.35);
        cloud *= smoothstep(0.02, 0.30, d.y);
        vec3 lit = mix(vec3(0.62,0.68,0.80), vec3(1.06,1.02,0.98), smoothstep(0.35,0.75,c)) * uCloudLum;
        lit += uSunColor * pow(sd, 14.0) * 0.5;
        sky = mix(sky, lit, cloud * mix(0.85, 0.55, uStars));
      }
      // stars (night): sparse twinkling points, hidden behind the cloud deck
      if(uStars > 0.0 && d.y > 0.0){
        vec2 sp = d.xz / (d.y + 0.35) * 70.0;
        vec2 cell = floor(sp);
        float h = h12(cell);
        vec2 f = fract(sp) - vec2(h12(cell + 7.1), h12(cell + 3.3));
        float st = smoothstep(0.986, 1.0, h) * smoothstep(0.16, 0.0, length(f));
        st *= 0.6 + 0.4 * sin(uTime * 0.05 + h * 60.0);
        sky += vec3(0.85, 0.9, 1.0) * st * uStars * smoothstep(0.0, 0.25, d.y) * 1.8;
      }
      fragColor = vec4(sky, 1.0);
    }`;

  /* ---------- particles (instanced billboards) ---------- */
  const PART_VS = V_HEAD + `
    in vec4 aP0;   // xyz = centre, w = size
    in vec4 aP1;   // rgba = tint (alpha premultiplied by softness)
    uniform vec3 uRight, uUp;
    out vec2 vUV; out vec4 vTint;
    void main(){
      vTint = aP1;
      vUV = aPos.xy;
      vec3 wp = aP0.xyz + uRight * (aPos.x * aP0.w) + uUp * (aPos.y * aP0.w);
      gl_Position = uProj * uView * vec4(wp, 1.0);
    }`;
  const PART_FS = `
    precision highp float;
    in vec2 vUV; in vec4 vTint; out vec4 fragColor;
    void main(){
      float d = length(vUV);
      float a = smoothstep(1.0, 0.15, d) * vTint.w;
      if(a < 0.004) discard;
      fragColor = vec4(vTint.rgb, a);
    }`;

  /* ---------- post: bright pass / blur / composite ---------- */
  const FS_VS = `
    precision highp float;
    in vec3 aPos; out vec2 vUV;
    void main(){ vUV = aPos.xy * 0.5 + 0.5; gl_Position = vec4(aPos.xy, 0.0, 1.0); }`;

  const BRIGHT_FS = `
    precision highp float;
    in vec2 vUV; out vec4 fragColor;
    uniform sampler2D uTex; uniform float uThresh;
    void main(){
      vec3 c = texture(uTex, vUV).rgb;
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      float k = smoothstep(uThresh, uThresh + 0.55, l);
      fragColor = vec4(c * k, 1.0);
    }`;

  const BLUR_FS = `
    precision highp float;
    in vec2 vUV; out vec4 fragColor;
    uniform sampler2D uTex; uniform vec2 uDir;
    void main(){
      vec3 s = texture(uTex, vUV).rgb * 0.227;
      s += (texture(uTex, vUV + uDir * 1.3846).rgb + texture(uTex, vUV - uDir * 1.3846).rgb) * 0.316;
      s += (texture(uTex, vUV + uDir * 3.2308).rgb + texture(uTex, vUV - uDir * 3.2308).rgb) * 0.070;
      fragColor = vec4(s, 1.0);
    }`;

  const COMP_FS = `
    precision highp float;
    in vec2 vUV; out vec4 fragColor;
    uniform sampler2D uScene, uBloom;
    uniform float uExposure, uVignette, uSpeed, uTime, uFlash, uDesat;
    uniform vec2 uRes;
    vec3 aces(vec3 x){
      const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14;
      return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
    }
    void main(){
      vec2 uv = vUV;
      // radial speed streaks toward the edges when moving fast
      float s = clamp(uSpeed, 0.0, 1.0);
      vec2 off = (uv - 0.5);
      float streak = s * s * 0.028 * dot(off, off);
      vec3 col = texture(uScene, uv - off * streak).rgb;
      col += texture(uBloom, uv).rgb * 0.62;
      col *= uExposure;
      col = aces(col);
      // grade: cool shadows, warm highs
      col = pow(col, vec3(1.02, 1.0, 0.98));
      float luma = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(col, vec3(luma), uDesat * 0.75);
      float vig = smoothstep(1.35, 0.32, length(off) * 1.28);
      col *= mix(1.0, vig, uVignette);
      col += uFlash * vec3(1.0, 0.96, 0.9) * 0.55;
      // dither to kill banding on the snow
      float dth = fract(sin(dot(uv * uRes, vec2(12.9898,78.233)) + uTime) * 43758.5453);
      col += (dth - 0.5) / 255.0;
      fragColor = vec4(col, 1.0);
    }`;

  this.prog.world = this.link(TERRAIN_VS, TERRAIN_FS, 'world');
  this.prog.lit = this.link(LIT_VS, LIT_FS, 'lit');
  this.prog.inst = this.link(INST_VS, INST_FS, 'inst');
  this.prog.shadow = this.link(SHADOW_VS, SHADOW_FS, 'shadow');
  this.prog.shadowInst = this.link(SHADOW_INST_VS, SHADOW_FS, 'shadowInst');
  this.prog.foliage = this.link(FOL_VS, FOL_FS, 'foliage');
  this.prog.shadowFol = this.link(SHADOW_FOL_VS, SHADOW_FOL_FS, 'shadowFol');
  this.prog.sky = this.link(SKY_VS, SKY_FS, 'sky');
  this.prog.particle = this.link(PART_VS, PART_FS, 'particle');
  this.prog.bright = this.link(FS_VS, BRIGHT_FS, 'bright');
  this.prog.blur = this.link(FS_VS, BLUR_FS, 'blur');
  this.prog.comp = this.link(FS_VS, COMP_FS, 'comp');
};
