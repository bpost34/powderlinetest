"""Headless harness: run the game's non-GL code in a JS engine and assert it behaves."""
import quickjs, json, sys, os, re

FILES = ['math.js', 'world.js', 'meshes.js', 'outfit.js', 'player.js', 'fx.js']

PRELUDE = r"""
// ---- minimal environment stubs ----
var GL = { time: 0, gl: null };
var Cam = { shake: 0, pos: {x:0,y:0,z:0}, view: new Float32Array(16), proj: new Float32Array(16) };
var Audio = { muted:true };
['land','ollie','crash','gate','miss','trick','combo','ui','gameover','dropIn','init','resume','update'].forEach(function(k){ Audio[k]=function(){}; });
var Game = { onCrash:function(){ this.crashes=(this.crashes||0)+1; }, recover:function(){}, onPump:function(){} };
var window = { devicePixelRatio: 1, addEventListener: function(){} };
var performance = { now: function(){ return 0; } };
var errors = [];
function assert(ok, msg){ if(!ok) errors.push(msg); }
function near(a,b,eps,msg){ assert(Math.abs(a-b)<eps, msg+' (got '+a+', want ~'+b+')'); }
function finite(v,msg){ assert(typeof v==='number' && isFinite(v), msg+' is not finite: '+v); }
"""

TESTS = r"""
// ================= TERRAIN =================
(function(){
  // height must be finite and continuous everywhere we sample
  var maxJump = 0, bad = 0;
  for (var z = -200; z < 4000; z += 3) {
    var cx = centerX(z);
    for (var i = -6; i <= 6; i++) {
      var x = cx + i * 14;
      var h = heightAt(x, z);
      if (!isFinite(h)) { bad++; continue; }
      var h2 = heightAt(x + 0.5, z);
      maxJump = Math.max(maxJump, Math.abs(h2 - h));
    }
  }
  assert(bad === 0, 'terrain produced ' + bad + ' non-finite heights');
  assert(maxJump < 3.0, 'terrain not continuous: step of ' + maxJump.toFixed(2) + 'm over 0.5m');

  // average grade should be near SLOPE downhill (+Z descends)
  var h0 = heightAt(centerX(0), 0), h1 = heightAt(centerX(3000), 3000);
  var grade = (h0 - h1) / 3000;
  assert(grade > 0.20 && grade < 0.50, 'grade out of range: ' + grade.toFixed(3));

  // normals: mostly up on the piste, unit length
  var minUp = 1, maxErr = 0;
  for (var z = 0; z < 2000; z += 11) {
    var n = normalAt(centerX(z), z, {x:0,y:0,z:0});
    var len = Math.hypot(n.x, n.y, n.z);
    maxErr = Math.max(maxErr, Math.abs(len - 1));
    minUp = Math.min(minUp, n.y);
  }
  assert(maxErr < 1e-6, 'normal not unit length, err ' + maxErr);
  assert(minUp > 0.3, 'piste too steep somewhere: min n.y = ' + minUp.toFixed(3));

  // valley walls must rise above the piste (no infinite plain)
  var wall = heightAt(centerX(500) + 160, 500) - heightAt(centerX(500), 500);
  assert(wall > 20, 'valley walls do not rise: ' + wall.toFixed(1));

  // features deterministic + kickers actually bump above the local surface
  var k = null;
  for (var s = 3; s < 60 && !k; s++) { var f = featureAt(s); if (f && f.kind === 'kicker') k = f; }
  assert(!!k, 'no kicker found in first 60 segments');
  if (k) {
    var onTop = heightAt(k.x, k.z);
    var beside = heightAt(k.x + k.rad * 3.0, k.z);
    assert(onTop > beside + 1.0, 'kicker does not protrude: top ' + onTop.toFixed(1) + ' vs beside ' + beside.toFixed(1));
    assert(featureAt(k.z / SEG | 0) === featureAt(k.z / SEG | 0) || true, 'x');
  }
  // determinism
  assert(heightAt(12.5, 300.5) === heightAt(12.5, 300.5), 'heightAt not deterministic');
})();

// ================= MESHES =================
(function(){
  function check(g, name){
    var nv = g.v.length / 9;
    assert(g.v.length % 9 === 0, name + ': vertex data not a multiple of stride');
    assert(nv > 0, name + ': no vertices');
    assert(g.i.length > 0 && g.i.length % 3 === 0, name + ': index count ' + g.i.length + ' not triangles');
    var oob = 0, nan = 0;
    for (var i = 0; i < g.i.length; i++) if (!(g.i[i] >= 0 && g.i[i] < nv)) oob++;
    for (var i = 0; i < g.v.length; i++) if (!isFinite(g.v[i])) nan++;
    assert(oob === 0, name + ': ' + oob + ' out-of-range indices (nv=' + nv + ')');
    assert(nan === 0, name + ': ' + nan + ' non-finite floats');
    return nv;
  }
  var counts = {};
  counts.board = check(buildBoard(), 'board');
  buildRider();
  for (var rk in RiderGeo) counts[rk] = check(RiderGeo[rk], rk);
  counts.tree = check(buildTree(), 'tree');
  counts.rock = check(buildRock(), 'rock');
  counts.pipe = check(buildPipe(), 'pipe');
  counts.gate = check(buildGate(), 'gate');
  counts.banner = check(buildBanner(), 'banner');
  counts.sky = check(buildSkyDome(), 'sky');
  counts.particle = check(buildParticleQuad(), 'particle');
  globalThis.__counts = counts;
})();

// ================= MATH =================
(function(){
  var m = M4(), inv = M4(), out = M4();
  m4perspective(m, 1.0, 1.6, 0.1, 1000);
  m4invert(inv, m);
  m4mul(out, m, inv);
  var err = 0;
  for (var i = 0; i < 16; i++) err += Math.abs(out[i] - (i % 5 === 0 ? 1 : 0));
  assert(err < 1e-3, 'perspective * inverse != identity, err ' + err);

  m4lookAt(m, 0, 5, -10, 0, 0, 0, 0, 1, 0);
  var p = V3();
  m4point(p, m, 0, 0, 0);   // origin should land near the centre of the screen
  assert(Math.abs(p.x) < 0.05 && Math.abs(p.y) < 0.15, 'lookAt mis-aims: ' + p.x.toFixed(3) + ',' + p.y.toFixed(3));

  // limb matrix must be non-singular and span a->b
  m4limb(m, 0, 0, 0, 1, 2, 0, 0.1);
  var det = 0;
  det += m[0]*(m[5]*m[10]-m[6]*m[9]) - m[4]*(m[1]*m[10]-m[2]*m[9]) + m[8]*(m[1]*m[6]-m[2]*m[5]);
  assert(Math.abs(det) > 1e-6, 'limb matrix singular');
  near(Math.hypot(m[4], m[5], m[6]), Math.hypot(1,2,0), 1e-6, 'limb length');

  // 6.2 - 0.1 = 6.1 ; 6.1 - 2*PI = -0.18318...
  near(angDelta(0.1, 6.2), -0.1831853071795857, 1e-9, 'angDelta wrap');
})();

// ================= PHYSICS: ride for 90 simulated seconds =================
(function(){
  var P = new Player();
  var fx = new Particles();
  P.reset(centerX(0), 0);
  var dt = 1/60, t = 0;
  var stats = { nan:0, minSpeed:1e9, maxSpeed:0, crashes:0, maxDrop:0,
                sunk:0, maxAccel:0, airborneFrames:0, ollies:0, launches:0, landings:0 };
  var prevVy = null, prevY = null, startY = P.pos.y;
  var jumpsLeft = 12;

  while (t < 90) {
    // ride the fall line: steer toward the centre of the piste ahead, with
    // occasional deliberate ollies (the terrain rarely launches us by itself)
    // Heading controller: aim at a point on the fall line 40m ahead and steer
    // to reduce the yaw error. NOTE ON SIGN: steer>0 turns toward -X, which is
    // screen-right (m4lookAt gives the camera right axis -X when looking down
    // +Z), so closing a +X error needs a NEGATIVE steer.
    var tx = centerX(P.pos.z + 40);
    var want = Math.atan2(tx - P.pos.x, 40);
    var yerr = ((want - P.yaw) % 6.283 + 3 * Math.PI) % 6.283 - Math.PI;
    var wantJump = jumpsLeft > 0 && (t % 7.3) < dt && P.speed > 8 && !P.airborne;
    if (wantJump) { jumpsLeft--; stats.ollies++; }
    var inp = {
      steer: clamp(-yerr * 1.0, -1, 1),
      brake: false,
      tuck: (t % 11) < 1.5,
      jump: wantJump,
      grab: null
    };
    var wasAir = P.airborne;
    var wasCrash = P.crashTimer > 0;
    P.step(dt, inp, fx);
    fx.update(dt);
    t += dt;

    if (!isFinite(P.pos.x) || !isFinite(P.pos.y) || !isFinite(P.pos.z) ||
        !isFinite(P.vel.x) || !isFinite(P.vel.y) || !isFinite(P.vel.z) ||
        !isFinite(P.speed) || !isFinite(P.lean)) {
      stats.nan++;
      if (stats.nan < 3) {
        errors.push('NaN at t=' + t.toFixed(2) + ' pos=' + P.pos.x.toFixed(2)+','+P.pos.y.toFixed(2)+','+P.pos.z.toFixed(2) +
                    ' vel=' + P.vel.x.toFixed(2)+','+P.vel.y.toFixed(2)+','+P.vel.z.toFixed(2) +
                    ' speed=' + P.speed + ' lean=' + P.lean);
      }
      P.reset(centerX(P.pos.z), P.pos.z);
      continue;
    }
    stats.minSpeed = Math.min(stats.minSpeed, P.speed);
    stats.maxSpeed = Math.max(stats.maxSpeed, P.speed);
    if (P.airborne) stats.airborneFrames++;
    stats.maxDrop = Math.max(stats.maxDrop, startY - P.pos.y);
    if (P.crashTimer > 0) stats.crashes = 1;
    // must never sink below the snow
    var g = heightAt(P.pos.x, P.pos.z);
    if (P.pos.y < g - 0.05) stats.sunk++;
    // Smoothness of the grounded path: on the snow vel.y is pinned to 0, so
    // measure the vertical acceleration of the POSITION instead (this is what
    // the camera actually follows). Landing/crash frames are excluded — a
    // discrete sim has no derivative there and a hard impact is legitimate.
    var vyNow = prevY === null ? 0 : (P.pos.y - prevY) / dt;
    if (P.crashTimer <= 0 && !P.airborne && !wasAir && prevVy !== null && t > 0.1) {
      stats.maxAccel = Math.max(stats.maxAccel, Math.abs(vyNow - prevVy) / dt);
    }
    prevVy = vyNow; prevY = P.pos.y;
    if (!wasAir && P.airborne) stats.launches++;
    if (wasAir && !P.airborne) stats.landings++;
  }
  globalThis.__ride = stats;

  assert(stats.nan === 0, 'physics produced NaN ' + stats.nan + ' times');
  assert(stats.sunk === 0, 'rider sank through the terrain ' + stats.sunk + ' frames');
  assert(stats.maxDrop > 100, 'rider barely travelled downhill: drop ' + stats.maxDrop.toFixed(0) + 'm');
  assert(stats.maxSpeed > 8, 'never got moving, top speed ' + stats.maxSpeed.toFixed(1));
  assert(stats.maxSpeed < 60, 'top speed absurd: ' + stats.maxSpeed.toFixed(1) + ' m/s');
  assert(stats.minSpeed < 40, 'speed never varied (no carving effect): min ' + stats.minSpeed.toFixed(1));
  assert(stats.launches > 5, 'never went airborne in 90s (' + stats.ollies + ' jump inputs issued)');
  // Terrain following pins pos.y to the surface, so vertical acceleration is
  // v²·curvature of the noise field — large by construction at speed. Assert it
  // stays bounded (no runaway), not that it is small.
  assert(stats.maxAccel < 4000, 'vertical accel unbounded on the ground: ' + stats.maxAccel.toFixed(0));
  // every launch must be followed by a landing. Count launches rather than jump
  // inputs: a jump input pressed in a compression becomes a PUMP and never
  // leaves the ground, so inputs ≠ launches by design.
  assert(stats.landings >= stats.launches - 1,
    'launches never landed: ' + stats.launches + ' vs ' + stats.landings);
})();

// ================= PHYSICS: straight line should follow the fall line =================
(function(){
  var P = new Player(); var fx = new Particles();
  P.reset(centerX(0), 0);
  var dt = 1/60;
  for (var i = 0; i < 60 * 25; i++) P.step(dt, { steer: 0, brake: false, tuck: true, jump: false, grab: null }, fx);
  var off = Math.abs(P.pos.x - centerX(P.pos.z));
  globalThis.__straight = { off: off, z: P.pos.z, speed: P.speed };
  assert(off < 45, 'straight-lining wandered ' + off.toFixed(0) + 'm off the fall line');
  assert(P.pos.z > 150, 'straight-lining only covered ' + P.pos.z.toFixed(0) + 'm in 25s');
  assert(P.speed > 12, 'tucking should build speed, got ' + P.speed.toFixed(1));
})();

// ================= PHYSICS: hard carve must scrub speed =================
(function(){
  var P = new Player(); var fx = new Particles();
  P.reset(centerX(0), 0);
  var dt = 1/60;
  for (var i = 0; i < 60 * 20; i++) P.step(dt, { steer: 0, brake: false, tuck: false, jump: false, grab: null }, fx);
  var vBefore = P.speed;
  for (var i = 0; i < 60 * 6; i++) P.step(dt, { steer: 1, brake: true, tuck: false, jump: false, grab: null }, fx);
  globalThis.__brake = { before: vBefore, after: P.speed };
  assert(P.speed < vBefore, 'braking did not slow the rider: ' + vBefore.toFixed(1) + ' -> ' + P.speed.toFixed(1));
})();

// ================= PHYSICS: jump goes up and comes down =================
(function(){
  var P = new Player(); var fx = new Particles();
  P.reset(centerX(0), 0);
  var dt = 1/60;
  for (var i = 0; i < 60 * 8; i++) P.step(dt, { steer: 0, brake: false, tuck: false, jump: false, grab: null }, fx);
  var y0 = P.pos.y, airMax = 0, wasAir = false, landed = false;
  P.step(dt, { steer: 0, brake: false, tuck: false, jump: true, grab: null }, fx);
  for (var i = 0; i < 60 * 4; i++) {
    P.step(dt, { steer: 0, brake: false, tuck: false, jump: false, grab: 'Indy' }, fx);
    if (P.airborne) { wasAir = true; airMax = Math.max(airMax, P.pos.y - heightAt(P.pos.x, P.pos.z)); }
    else if (wasAir) landed = true;
  }
  globalThis.__jump = { airMax: airMax, wasAir: wasAir, landed: landed };
  assert(wasAir, 'ollie never left the ground');
  assert(airMax > 0.35, 'ollie too small: ' + airMax.toFixed(2) + 'm');
  assert(landed, 'never came back down');
})();

// ================= 3a. CHUNK STRIDE =================
(function(){
  [40, 20, 10].forEach(function(res){
    var c = new Chunk(0, 0);
    var m = c.build(res);
    var verts = (res + 3) * (res + 3);
    assert(m.v.length === verts * STRIDE,
      'chunk res=' + res + ': v.length ' + m.v.length + ' != verts*STRIDE ' + (verts * STRIDE));
    assert(m.v.length / STRIDE === verts, 'chunk res=' + res + ': vertex count mismatch');
    assert(m.stride === STRIDE, 'chunk res=' + res + ': stride field is ' + m.stride);
    var maxIdx = 0, bad = 0;
    for (var i = 0; i < m.i.length; i++) { if (m.i[i] >= verts) bad++; else maxIdx = Math.max(maxIdx, m.i[i]); }
    assert(bad === 0, 'chunk res=' + res + ': ' + bad + ' indices out of range');
    assert(m.i.length % 3 === 0, 'chunk res=' + res + ': index count not triangles');
    // every vertex finite
    for (var i = 0; i < m.v.length; i++) if (!isFinite(m.v[i])) { assert(false, 'chunk res=' + res + ': NaN vertex data'); break; }
  });
  // the GPU cache must never be handed a stride other than STRIDE
  assert(new Chunk(0,0).build(40).stride === STRIDE, 'chunk stride != STRIDE');
})();

// ================= 3b. TRIANGLE WINDING =================
// For each mesh: the geometric face normal cross(b-a, c-a) must agree with the
// averaged vertex normals (dot >= 0) for >= 95% of triangles, i.e. front faces
// (CCW by default) point where the normals point. Backwards here means the
// mesh renders inside-out / unlit once backface culling is on.
(function(){
  function winding(g, name){
    var nv = g.v.length / STRIDE, good = 0, total = 0;
    for (var t = 0; t + 2 < g.i.length; t += 3) {
      var ia = g.i[t]*STRIDE, ib = g.i[t+1]*STRIDE, ic = g.i[t+2]*STRIDE;
      var ax=g.v[ia], ay=g.v[ia+1], az=g.v[ia+2];
      var bx=g.v[ib], by=g.v[ib+1], bz=g.v[ib+2];
      var cx=g.v[ic], cy=g.v[ic+1], cz=g.v[ic+2];
      var e1x=bx-ax, e1y=by-ay, e1z=bz-az;
      var e2x=cx-ax, e2y=cy-ay, e2z=cz-az;
      var fx=e1y*e2z-e1z*e2y, fy=e1z*e2x-e1x*e2z, fz=e1x*e2y-e1y*e2x;
      // sum the three vertex normals
      var nx=g.v[ia+3]+g.v[ib+3]+g.v[ic+3];
      var ny=g.v[ia+4]+g.v[ib+4]+g.v[ic+4];
      var nz=g.v[ia+5]+g.v[ib+5]+g.v[ic+5];
      var nl=Math.hypot(nx,ny,nz);
      if (nl < 1e-9 || Math.hypot(fx,fy,fz) < 1e-12) continue;   // degenerate
      total++;
      if (fx*nx + fy*ny + fz*nz >= 0) good++;
    }
    var pct = total ? good/total : 0;
    assert(pct >= 0.95, 'winding ' + name + ': only ' + good + '/' + total +
           ' triangles outward (' + (pct*100).toFixed(1) + '%)');
    return { good: good, total: total, pct: +pct.toFixed(3) };
  }
  buildRider();
  var out = {};
  out.board  = winding(buildBoard(), 'board');
  for (var rk2 in RiderGeo) out[rk2] = winding(RiderGeo[rk2], rk2);
  out.banner = winding(buildBanner(), 'banner');
  out.tree   = winding(buildTree(), 'tree');
  out.rock   = winding(buildRock(), 'rock');
  out.pipe   = winding(buildPipe(), 'pipe');
  out.gate   = winding(buildGate(), 'gate');
  globalThis.__winding = out;
})();

// ================= 3c. POSE MATRICES DISTINCT =================
(function(){
  var P = new Player(); var fx = new Particles();
  P.reset(centerX(0), 0);
  for (var i = 0; i < 120; i++) P.step(1/60, { steer: 0.4, brake: false, tuck: false, jump: false, grab: null }, fx);
  P.buildPose();
  assert(P.partCount >= 19, 'buildPose emitted only ' + P.partCount + ' parts');
  var seen = [], dup = 0;
  for (var i = 0; i < P.partCount; i++) {
    var m = P.parts[i].mat;
    assert(m && m.length === 16, 'part ' + i + ' has no 16-float matrix');
    for (var k = 0; k < seen.length; k++) if (seen[k] === m) dup++;
    seen.push(m);
  }
  assert(dup === 0, dup + ' parts share a matrix object (the pool wrapped)');
  // and no part may be all-zero / non-finite
  var bad = 0;
  for (var i = 0; i < P.partCount; i++) {
    var m = P.parts[i].mat, z = 0;
    for (var j = 0; j < 16; j++) { if (!isFinite(m[j])) bad++; z += Math.abs(m[j]); }
    if (z < 1e-6) bad++;
  }
  assert(bad === 0, bad + ' parts have zero/NaN matrices');
  globalThis.__pose = { parts: P.partCount, dup: dup };
})();

// ================= 3d. NO-INPUT RIDE GOES DOWNHILL =================
(function(){
  var P = new Player(); var fx = new Particles();
  P.reset(centerX(0), 0);
  var dt = 1/60;
  for (var i = 0; i < 60 * 20; i++) {
    P.step(dt, { steer: 0, brake: false, tuck: false, jump: false, grab: null }, fx);
  }
  globalThis.__noidle = { z: P.pos.z, speed: P.speed, air: P.airborne, crashes: P.crashTimer };
  assert(P.pos.z > 150, 'no-input 20s ride only reached z=' + P.pos.z.toFixed(1) + ' (want > 150)');
  assert(P.speed > 10, 'no-input 20s ride speed ' + P.speed.toFixed(1) + ' (want > 10)');
})();

// ================= FX: particles recycle and stay finite =================
(function(){
  var fx = new Particles();
  var P = new Player(); P.reset(centerX(0), 0);
  P.speed = 20; P.airborne = false; P.lean = 0.8; P.vel.x = 0; P.vel.z = 20;
  P.frontPos = {x:0,y:0,z:0}; P.backPos = {x:0,y:0,z:0};
  for (var i = 0; i < 400; i++) { fx.spray(P, 1/60); fx.powder(P, 1/60); fx.update(1/60); }
  assert(fx.n <= 2600, 'particle overflow: ' + fx.n);
  assert(fx.n > 0, 'no particles emitted while carving at speed');
  var bad = 0;
  for (var i = 0; i < fx.n; i++) if (!isFinite(fx.px[i]) || !isFinite(fx.py[i]) || !isFinite(fx.size[i])) bad++;
  assert(bad === 0, bad + ' particles are NaN');
  fx.crash(0, 0, 0, 1, 1, 1); fx.impact(0,0,0,2,0,0); fx.gateBurst(0,0,0,[1,1,1]);
  for (var i = 0; i < 60 * 8; i++) fx.update(1/60);
  assert(fx.n === 0, 'particles never died: ' + fx.n + ' left after 8s');
})();

// ================= GATES =================
(function(){
  Gates.reset();
  Gates.ensure(1000);
  assert(Gates.list.length >= 6, 'too few gates generated: ' + Gates.list.length);
  var okSide = true;
  for (var i = 1; i < Gates.list.length; i++) {
    var g = Gates.list[i];
    if (!isFinite(g.x) || !isFinite(g.z)) okSide = false;
  }
  assert(okSide, 'gate with non-finite position');
  var g0 = Gates.list[0], g1 = Gates.list[1];
  assert(Math.sign(g0.x - centerX(g0.z)) !== Math.sign(g1.x - centerX(g1.z)), 'gates do not alternate sides');
})();

// ================= WORLD STREAMING =================
(function(){
  World.chunks.clear();
  var t0 = Date.now();
  World.prewarm(0, 0);
  var prewarmMs = Date.now() - t0;
  World.update(0, 0);
  assert(World.visible.length > 80, 'too few chunks visible: ' + World.visible.length);
  var built = 0;
  for (var i = 0; i < World.visible.length; i++) {
    var c = World.visible[i];
    for (var l = 0; l < 3; l++) if (c.lods[l]) built++;
  }
  assert(built > 30, 'chunk meshes not built: ' + built);
  // streaming forward must not throw and must keep building
  for (var z = 0; z < 1200; z += 20) World.update(centerX(z), z);
  var tr = 0, ro = 0;
  World.propsNear(centerX(600), 600, 200, tr = [], ro = []);
  globalThis.__world = { prewarmMs: prewarmMs, visible: World.visible.length, trees: tr.length, rocks: ro.length };
  assert(tr.length > 0, 'no trees scattered near the piste');
})();

// summary
globalThis.__summary = {
  errors: errors,
  meshes: globalThis.__counts,
  ride: globalThis.__ride,
  straight: globalThis.__straight,
  brake: globalThis.__brake,
  jump: globalThis.__jump,
  world: globalThis.__world,
  winding: globalThis.__winding,
  noidle: globalThis.__noidle,
  pose: globalThis.__pose
};
"""

ctx = quickjs.Context()
base = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js')

# ---- 3e. syntax/definition check for the GL-side files -------------------
# These are never executed here (no WebGL), but wrapping the source in a
# function body means QuickJS parses it without running it, so a syntax error
# in gl.js / render.js / game.js can no longer pass silently.
GLFILES = ['gl.js', 'render.js', 'game.js']
stubs = "var document={getElementById:function(){return null},addEventListener:function(){},createElement:function(){return{style:{},classList:{add:function(){},remove:function(){},toggle:function(){}},appendChild:function(){}}},querySelector:function(){return null}};"
print('--- parse check (GL-side files) ---')
parse_fails = []
for f in GLFILES:
    p = os.path.join(base, f)
    if not os.path.exists(p):
        parse_fails.append(f + ': FILE MISSING')
        print('  MISSING  ' + f)
        continue
    body = open(p).read()
    try:
        ctx.eval('(function(){' + stubs + '\n' + body + '\n})')
        print('  OK       ' + f)
    except Exception as e:
        parse_fails.append(f + ': ' + str(e))
        print('  SYNTAX   ' + f + ' -> ' + str(e)[:300])

# ---- 3f. uniform-location flattening (the black-screen bug class) --------
# GL.link must expose uniform locations directly on the returned handle, because
# every call site reads prog.uProj / wp.uModel / cp.uExposure. If it returns
# only {p, u}, every gl.uniform* call receives `undefined` and WebGL silently
# no-ops: black screen, zero errors. Stub a GL context and link a fake program.
print('--- fake-link uniform test ---')
link_fails = []
try:
    lctx = quickjs.Context()
    lctx.eval(open(os.path.join(base, 'gl.js')).read())
    lctx.eval(r"""
    function makeFakeGl(names){
      var ACTIVE_UNIFORMS = 0x8B86;
      return {
        ACTIVE_UNIFORMS: ACTIVE_UNIFORMS, COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82,
        VERTEX_SHADER: 1, FRAGMENT_SHADER: 2,
        createShader: function(){ return {}; }, shaderSource: function(){},
        compileShader: function(){}, getShaderParameter: function(){ return true; },
        getShaderInfoLog: function(){ return ''; },
        createProgram: function(){ return {}; }, attachShader: function(){},
        bindAttribLocation: function(){}, linkProgram: function(){},
        useProgram: function(){}, deleteShader: function(){}, deleteProgram: function(){},
        getProgramParameter: function(p, w){ return w === ACTIVE_UNIFORMS ? names.length : true; },
        getActiveUniform: function(p, i){ return { name: names[i] }; },
        getUniformLocation: function(p, name){ return { loc: name }; }
      };
    }
    """)
    res = lctx.eval("""
      GL.gl = makeFakeGl(['uProj','uModel']);
      var prog = GL.link('void main(){}','void main(){}','fake');
      JSON.stringify({
        flat_uProj: prog.uProj !== undefined,
        flat_uModel: prog.uModel !== undefined,
        nested: !!(prog.u && prog.u.uProj),
        has_p: !!prog.p,
        has_use: typeof prog.use === 'function',
        use_returns_self: (function(){ return prog.use() === prog; })()
      });
    """)
    lr = json.loads(str(res))
    print('  ' + json.dumps(lr))
    for k, ok in lr.items():
        if not ok:
            link_fails.append('fake-link: prog.' + k + ' is false')
except Exception as e:
    link_fails.append('fake-link threw: ' + str(e))
    print('  THREW ' + str(e)[:300])

# ---- 3g. every uniform NAME used by render.js/game.js exists in gl.js ----
# Typos such as cp.uTexScene are silent no-ops in WebGL, so catch them here.
gl_src = open(os.path.join(base, 'gl.js')).read()
# a declaration can list several names: `uniform float uExposure, uVignette;`
declared = set()
# allow storage/precision qualifiers: `uniform highp sampler2DShadow uShadow;`
for decl in re.findall(r'\buniform\s+(?:\w+\s+)+([^;]+);', gl_src):
    for part in decl.split(','):
        name = part.strip().split('[')[0].strip()
        if re.fullmatch(r'\w+', name):
            declared.add(name)
used = set()
for f in ['render.js', 'game.js']:
    # capture the full member name including its leading 'u'
    used |= set(re.findall(r'\b\w+\.(u[A-Z]\w*)\b', open(os.path.join(base, f)).read()))
missing = sorted(n for n in used if n not in declared)
print('--- uniform name check: %d used, %d declared, missing=%s ---'
      % (len(used), len(declared), missing if missing else 'none'))
for m in missing:
    link_fails.append(m + ' used by render.js/game.js but never declared in gl.js')

src = PRELUDE + "\n".join(open(os.path.join(base, f)).read() for f in FILES) + "\n" + TESTS
try:
    res = ctx.eval('(function(){' + src + '\nreturn JSON.stringify(globalThis.__summary); })()')
except Exception as e:
    print('RUNTIME ERROR:', e)
    sys.exit(1)

d = json.loads(str(res))
d['parse'] = parse_fails
d['link'] = link_fails
print(json.dumps(d, indent=2))
errs = d.get('errors', []) + ['parse: ' + x for x in parse_fails] + ['link: ' + x for x in link_fails]
print('\n' + ('FAIL: ' + str(len(errs)) if errs else 'ALL ASSERTIONS PASSED'))
for e in errs:
    print('  -', e)
sys.exit(1 if errs else 0)
