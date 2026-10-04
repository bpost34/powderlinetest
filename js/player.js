/* =====================================================================
   player.js — the snowboarder.

   Physics model (arcade, but physically motivated):
     • gravity along the terrain gradient drives speed
     • the board only grips along its edge; the velocity is decomposed into
       {along the board} and {across the board}. Side-slip is damped hard
       when the edge is engaged and lightly when it is flat → that single
       rule produces carving, skidding, speed checks and the fall line.
     • turning comes from the edge angle: turn rate ∝ speed · tan(lean)
     • terrain curvature pushes/pulls the rider (compressions accelerate,
       crests unload → airborne when the downward accel exceeds gravity)
   ===================================================================== */
'use strict';

const G = 9.81;
const BOARD_L = 1.60;
const RIDE_H = 0.12;          // rider origin height above the board base
const LEAN_VIS = 1;           // visual lean direction (board tilt + body). Set to -1 to reverse. Physics unaffected.

class Player {
  constructor() {
    this.pos = V3(0, 0, 0);
    this.vel = V3(0, 0, 0);
    this.yaw = 0;             // heading of the board, radians
    this.lean = 0;            // edge angle, -1..1 (sign = which edge)
    this.leanVel = 0;
    this.speed = 0;
    this.turnRate = 0;
    this.airborne = false;
    this.airTime = 0;
    this.groundY = 0;
    this.unload = 0;          // 0 = planted, 1 = about to leave the ground
    this.load = 1;            // apparent load factor (for compression squash)
    this.tuck = 0;
    this.braking = 0;
    this.chop = 0;            // high-frequency chatter from rough terrain
    this.crashTimer = 0;
    this.crashSpin = V3();
    this.invuln = 0;
    this.landing = 0;         // impact strength of the most recent landing
    this.landedClean = false;
    this.jumpBuffer = 0;
    this.pumpCooldown = 0;
    this.spin = 0;            // accumulated in-air rotation (radians)
    this.flip = 0;            // accumulated in-air flip (radians, + = backflip / nose up)
    this.flipRate = 0;
    this.flipVis = 0;         // rendered flip angle (eases out after landing)
    this.flipArmed = false;   // flips need a fresh W/S press after takeoff
    this.grab = null;
    this.grabTime = 0;
    this.frontPos = V3(); this.backPos = V3();
    this.dir = V3(0, 0, 1); this.right = V3(1, 0, 0); this.up = V3(0, 1, 0);
    this.nrm = V3(0, 1, 0);
    this.boardMat = M4();
    this.parts = [];
    this.partCount = 0;
    // buildPose() emits 14 parts (torso, head, 8 limbs, 2 boots, 2 hands) plus
    // temporaries. The pool must never wrap mid-pose, or a later part shares —
    // and overwrites — an earlier part's matrix.
    this._tmpM = new Array(32);
    for (let i = 0; i < this._tmpM.length; i++) this._tmpM[i] = M4();
    this._mi = 0;
  }

  reset(x, z, speed) {
    const v0 = speed || 6;
    this.pos.x = x;
    this.pos.z = z;
    this.pos.y = heightAt(x, z) + RIDE_H;
    V3.set(this.vel, 0, 0, v0);
    this.yaw = 0; this.lean = 0; this.speed = v0;
    this.airborne = false; this.airTime = 0; this.crashTimer = 0;
    this.spin = 0; this.flip = 0; this.flipRate = 0; this.flipVis = 0; this.grab = null; this.tuck = 0; this.invuln = 1.2;
    this.grind = null;
    this.updateBasis();
  }

  _m() { const m = this._tmpM[this._mi % this._tmpM.length]; this._mi++; return m; }

  updateBasis() {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    V3.set(this.dir, s, 0, c);                       // nose direction (flat)
    V3.set(this.right, -c, 0, s);                    // = dir × up: the side we turn toward when lean > 0
    normalAt(this.pos.x, this.pos.z, this.nrm);
    // board up = terrain normal tilted by the lean angle around the nose axis
    const L = this.lean * 0.62 * LEAN_VIS;           // up to ~35° of ankle lean
    const cs = Math.cos(L), sn = Math.sin(L);
    V3.set(this.up,
      this.nrm.x * cs + this.right.x * sn,
      this.nrm.y * cs + this.right.y * sn,
      this.nrm.z * cs + this.right.z * sn);
    V3.norm(this.up, this.up);
    // re-orthogonalise the nose against up
    V3.cross(this.right, this.dir, this.up);
    V3.norm(this.right, this.right);
    V3.cross(this.dir, this.up, this.right);
    V3.norm(this.dir, this.dir);
  }

  /* ---------------- main step ---------------- */
  step(dt, input, fx) {
    this._mi = 0;
    this.landing = 0;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.crashTimer > 0) { this.stepCrash(dt, fx); return; }
    if (this.grind) { this.stepGrind(dt, input, fx); return; }

    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.pumpCooldown > 0) this.pumpCooldown -= dt;
    if (input.jump) this.jumpBuffer = 0.14;

    this.updateBasis();

    if (this.airborne) this.stepAir(dt, input, fx);
    else {
      this.stepGround(dt, input, fx);
      // level rules: e.g. carving up a pipe wall launches you out of the lip
      if (!this.airborne && Level.cur.lip && Level.cur.lip(this)) {
        Audio.ollie(); Cam.shake = Math.max(Cam.shake, 0.04);
      }
    }

    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const gy = heightAt(this.pos.x, this.pos.z);
    this.groundY = gy;
    if (this.airborne) {
      this.airTime += dt;
      if (this.pos.y <= gy + RIDE_H) {
        this.pos.y = gy + RIDE_H;
        this.land(fx);
      }
    } else {
      // stick to the surface (with a small tolerance so we don't sink on crests)
      this.pos.y = gy + RIDE_H;
      if (this.pos.y < gy + RIDE_H) this.pos.y = gy + RIDE_H;
    }

    // foot positions (used by the particle emitters)
    const half = BOARD_L * 0.5 * 0.86;
    V3.set(this.frontPos, this.pos.x + this.dir.x * half, this.pos.y, this.pos.z + this.dir.z * half);
    V3.set(this.backPos, this.pos.x - this.dir.x * half, this.pos.y, this.pos.z - this.dir.z * half);

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (Level.cur.rails) this.checkGrind(fx);
    if (this.airborne) this.flipVis = this.flip;
    else this.flipVis = damp(this.flipVis, 0, 14, dt);
  }

  /* ---------------- on the snow ---------------- */
  stepGround(dt, input, fx) {
    const n = this.nrm;

    // ---- steering: edge angle drives turn rate ----
    const steer = input.steer;                        // -1..1
    this.lean = damp(this.lean, steer * 0.92, clamp(9.0 - this.speed * 0.06, 4.5, 9.5), dt);

    // FLAT heading axes. updateBasis() re-orthogonalises this.dir/this.right
    // against the slope-tilted board up, so their horizontal length is only
    // cos(slope) ≈ 0.94. Projecting velocity onto them and then rebuilding
    // velocity from them every frame discards cos²(slope) ≈ 11% of horizontal
    // speed per step — tens of m/s² of phantom braking. Physics stays in the
    // flat horizontal plane; the tilted basis exists for rendering only.
    // sliding backwards (e.g. back down a pipe wall): swing the board round so
    // the rider rides out nose-first instead of fighting the forward clamp below
    if (this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw) < -0.6) {
      this.yaw += Math.PI; this.updateBasis();
    }
    const fX = Math.sin(this.yaw), fZ = Math.cos(this.yaw);
    const rX = fZ, rZ = -fX;

    // speed projected on the flat board axes
    let vFwd = this.vel.x * fX + this.vel.z * fZ;
    let vSide = this.vel.x * rX + this.vel.z * rZ;
    const sp = Math.hypot(vFwd, vSide);

    // turn rate from edge geometry (bicycle model): ω = v · tan(θ) / R
    const edge = Math.abs(this.lean);
    let turn = -this.lean * clamp(sp / 11, 0, 1.6) * 1.05;
    turn = clamp(turn, -1.15, 1.15);
    if (sp < 1.2) turn *= sp / 1.2;
    this.turnRate = damp(this.turnRate, turn, 12, dt);
    this.yaw += this.turnRate * dt;

    // ---- gravity along the fall line, split into board axes ----
    // For a surface y = h(x,z) the normal is (-dh/dx, 1, -dh/dz), so the
    // horizontal downhill direction is +(N.x, N.z) — NOT negated. Dividing by
    // N.y converts the slope into the acceleration g·tan(theta).
    const ny = Math.max(n.y, 0.25);
    const gx = n.x / ny, gz = n.z / ny;               // downhill gradient (m per m)
    const gFwd = gx * fX + gz * fZ;
    const gSide = gx * rX + gz * rZ;

    // ---- terrain curvature along the nose: compression vs. unloading ----
    const e = 2.2;
    const hB = heightAt(this.pos.x, this.pos.z);
    const hA = heightAt(this.pos.x + this.dir.x * e, this.pos.z + this.dir.z * e);
    const hC = heightAt(this.pos.x - this.dir.x * e, this.pos.z - this.dir.z * e);
    const curv = (hA - 2 * hB + hC) / (e * e);        // >0 valley, <0 crest
    const centripetal = sp * sp * curv;
    this.load = clamp(1 + centripetal / G, 0, 3.4);

    this.tuck = damp(this.tuck, input.tuck ? 1 : 0, 8, dt);
    this.braking = damp(this.braking, input.brake ? 1 : 0, 9, dt);

    // ---- jump: pump a compression, or ollie ----
    if (this.jumpBuffer > 0 && this.pumpCooldown <= 0) {
      if (this.load > 1.28 && gFwd > 0.02) {
        // PUMP: convert the compression into speed
        vFwd += 2.2 + (this.load - 1) * 5.2;
        this.pumpCooldown = 0.26;
        this.jumpBuffer = 0;
        fx.puff(this.pos.x, this.groundY, this.pos.z, 0.45);
        Audio.ollie();
        Game.onPump();
      } else {
        // OLLIE
        this.airborne = true; this.airTime = 0;
        this.vel.x = fX * vFwd + rX * vSide;
        this.vel.z = fZ * vFwd + rZ * vSide;
        this.vel.y = (5.6 + clamp(sp * 0.10, 0, 2.2)) * (0.80 + this.load * 0.24);
        this.jumpBuffer = 0; this.pumpCooldown = 0.26;
        this.spin = 0; this.flip = 0; this.flipRate = 0; this.flipArmed = false; this.autoYaw = null; this.airLabel = null;
        fx.puff(this.pos.x, this.groundY, this.pos.z, 0.7 + this.load * 0.3);
        Audio.ollie();
        Cam.shake = Math.max(Cam.shake, 0.05);
        return;
      }
    }

    // ---- longitudinal forces ----
    const dragCoef = lerp(0.0075, 0.0030, this.tuck) + this.braking * 0.02;
    const cd = dragCoef * sp * sp;
    const roll = 0.40 + this.braking * 3.4 + edge * 0.5 * (1 - smoothstep(0, 1, sp / 6));
    // levels with walls (pipes) make climbing a bit cheaper so airs are reachable
    const climb = gFwd < 0 && Level.cur.wallAssist ? Level.cur.wallAssist : 1;
    vFwd += (gFwd * G * 0.94 * climb - sign(vFwd) * (cd + roll)) * dt;
    vSide += gSide * G * 0.94 * dt;

    // ---- edge hold: kill side-slip, far harder when the edge is engaged ----
    const flatSlide = 1 - smoothstep(0.05, 0.55, edge);
    const slip = Math.abs(vSide);
    vSide = damp(vSide, 0, lerp(15.0, 2.2, flatSlide), dt);
    vFwd -= slip * (0.30 + this.braking * 3.0) * dt;      // scrub from skidding
    if (vFwd < 0.35) vFwd = damp(vFwd, 0.35, 1.2, dt);

    // ---- the mountain can't hold us over a crest → airborne ----
    if (centripetal < -G * 1.05) {
      this.airborne = true; this.airTime = 0;
      this.vel.x = fX * vFwd + rX * vSide;
      this.vel.z = fZ * vFwd + rZ * vSide;
      this.vel.y = Math.max(0, (hB - hC) / e) * sp;   // leave along the ramp we're coming off (the slope behind)
      this.spin = 0; this.flip = 0; this.flipRate = 0; this.flipArmed = false; this.autoYaw = null; this.airLabel = null;
      this.unload = 1;
      return;
    }

    this.vel.x = fX * vFwd + rX * vSide;
    this.vel.z = fZ * vFwd + rZ * vSide;
    this.vel.y = 0;
    this.unload = 0;

    // chatter: off-piste snow is rougher than the corduroy
    const d = Math.abs(this.pos.x - centerX(this.pos.z));
    const roughness = smoothstep(PISTE_HALF * 0.55, PISTE_HALF * 1.7, d);
    this.chop = damp(this.chop, (0.10 + roughness * 0.9) * clamp(sp / 20, 0, 1), 7, dt);
  }

  /* ---------------- in the air ---------------- */
  stepAir(dt, input, fx) {
    this.vel.y -= G * dt;
    // gentle air drag
    const k = 1 - 0.05 * dt;
    this.vel.x *= k; this.vel.z *= k;

    // in-air yaw from the board's remaining rotation (torque steer)
    const spinRate = clamp(-this.lean * 6.4, -6.4, 6.4);
    this.yaw += spinRate * dt;
    this.spin += spinRate * dt;
    if (this.autoYaw) {                    // pipe air: ease the board round to face back in;
      this.autoYaw.target += spinRate * dt; // the rider's own spins ride on top of it
      this.yaw += angDelta(this.yaw, this.autoYaw.target) * (1 - Math.exp(-3.2 * dt));
    }
    this.lean = damp(this.lean, input.steer * 0.92, 6, dt);

    // flips: W pitches forward = frontflip, S pulls back = backflip. Holding W/S
    // through the takeoff (tucking for speed) doesn't count — the key has to
    // be pressed fresh once airborne, so crest launches never flip you by accident.
    if (!input.tuck && !input.brake) this.flipArmed = true;
    const want = this.flipArmed ? (input.brake ? 1 : 0) - (input.tuck ? 1 : 0) : 0;   // + = nose up = backflip
    this.flipRate = damp(this.flipRate, want * 4.2, 9, dt);
    this.flip += this.flipRate * dt;

    this.grab = input.grab || null;
    this.grabTime = this.grab ? this.grabTime + dt : 0;

    this.tuck = damp(this.tuck, input.tuck ? 1 : 0, 8, dt);
    this.braking = damp(this.braking, input.brake ? 1 : 0, 8, dt);
  }

  /* ---------------- touchdown ---------------- */
  land(fx) {
    this.autoYaw = null;
    const n = this.nrm;
    normalAt(this.pos.x, this.pos.z, n);
    const vDown = this.vel.y;
    const impact = clamp(-vDown / 12, 0.05, 2.4);
    this.landing = impact;
    this.airborne = false;
    this.airTime = 0;
    this.pos.y = heightAt(this.pos.x, this.pos.z) + RIDE_H;

    // a fall onto a slope becomes speed down that slope (pipe walls, landing
    // ramps): horizontal speed gains |vy|·sin(slope) along the downhill direction
    if (vDown < 0) {
      const hn = Math.hypot(n.x, n.z);
      if (hn > 1e-3) {
        const gain = -vDown * hn * 0.9;                 // hn = sin(slope angle)
        this.vel.x += n.x / hn * gain; this.vel.z += n.z / hn * gain;
      }
    }

    // landing quality: is the board base aligned with the slope, and is the
    // board travelling along its own length? Riding backwards (switch) is a
    // legal landing, so compare against |dot| rather than dot.
    const travel = Math.hypot(this.vel.x, this.vel.z);
    let dot = 1, missAngle = 0;
    if (travel > 1.5) {
      const aX = Math.sin(this.yaw), aZ = Math.cos(this.yaw);
      dot = (this.vel.x * aX + this.vel.z * aZ) / travel;
      missAngle = Math.acos(clamp(Math.abs(dot), -1, 1));
    }
    const switchLanding = dot < 0;
    if (switchLanding) {
      // rotate the board a further half turn so it faces its direction of
      // travel; otherwise the rider would slide out tail-first
      this.yaw = (this.yaw + Math.PI) % TAU;
      this.updateBasis();
    }
    const upDot = n.y * this.up.y + n.x * this.up.x + n.z * this.up.z;
    const baseError = Math.acos(clamp(upDot, -1, 1));
    const overLean = Math.abs(this.lean);
    // an unfinished flip: how far the board is from upright around the flip axis
    const flipResidual = Math.abs(angDelta(0, this.flip));

    const bad =
      baseError > 0.72 ||                       // landing on the rail / sideways
      missAngle > 1.05 ||                       // travelling the wrong way
      (overLean > 0.72 && impact > 0.55) ||     // edge catch
      impact > 1.75 ||                          // just fell in it
      flipResidual > 0.85;                      // under/over-rotated the flip

    // scrub velocity into the direction of travel. The flat heading axes are
    // recomputed AFTER any switch correction above, since yaw changed by 180°.
    const keep = bad ? 0.30 : lerp(0.94, 0.70, clamp(impact, 0, 1));
    const fX = Math.sin(this.yaw), fZ = Math.cos(this.yaw);
    const fwdSpeed = Math.abs(this.vel.x * fX + this.vel.z * fZ);
    this.landedSwitch = switchLanding;
    this.vel.x = fX * fwdSpeed * keep;
    this.vel.z = fZ * fwdSpeed * keep;
    this.vel.y = 0;
    this.flipVis = angDelta(0, this.flip);      // ease the last few degrees out visually
    this.flip = 0; this.flipRate = 0;
    this.grab = null; this.grabTime = 0;

    fx.impact(this.pos.x, this.groundY, this.pos.z, impact * (bad ? 2.2 : 1), this.vel.x, this.vel.z);
    Cam.shake = Math.max(Cam.shake, clamp(impact * 0.30, 0.02, 0.42));
    Audio.land(impact * (bad ? 1.6 : 1));

    if (bad) { this.crash(fx); this.landedClean = false; }
    else { this.landedClean = true; this.chop = 0.4; }
  }

  /* ---------------- rails ---------------- */
  checkGrind(fx) {
    if (this.grind || this.crashTimer > 0) return;
    const p = this.pos, feet = p.y - RIDE_H;
    for (const r of Level.cur.rails) {
      if (p.z < r.zmin - 1 || p.z > r.zmax + 1) continue;
      const rx = p.x - r.x0, rz = p.z - r.z0;
      const t = rx * r.ux + rz * r.uz;
      if (t < 0 || t > r.len - 0.5) continue;
      if (Math.abs(rx * -r.uz + rz * r.ux) > 0.42) continue;       // sideways distance to the bar
      const top = railTop(r, t);
      const ok = this.airborne
        ? (this.vel.y <= 1.5 && feet > top - 0.5 && feet < top + 0.8)
        : (feet > top - 0.25);                                        // rolled onto the flush entry
      if (!ok) continue;
      if (this.airborne && Math.abs(angDelta(0, this.flip)) > 0.85) { this.crash(fx); return; }
      const along = this.vel.x * r.ux + this.vel.z * r.uz;
      this.grind = { r, t, dir: along >= 0 ? 1 : -1, s: Math.max(3, Math.abs(along)), time: 0 };
      this.airborne = false; this.airTime = 0; this.landedClean = true;
      this.flip = 0; this.flipRate = 0; this.grab = null; this.grabTime = 0;
      this.pos.y = top + RIDE_H;
      Audio.land(0.35); Cam.shake = Math.max(Cam.shake, 0.06);
      return;
    }
  }

  stepGrind(dt, input, fx) {
    const g = this.grind, r = g.r;
    g.time += dt;
    const ahead = clamp(g.t + g.dir * 0.5, 0, r.len);
    const slope = (railTop(r, ahead) - railTop(r, g.t)) / Math.max(0.05, Math.abs(ahead - g.t));
    g.s = Math.max(1.5, g.s + (-slope * G * 0.9 - 0.5) * dt);    // gravity along the bar, light friction
    g.t += g.dir * g.s * dt;
    const tt = clamp(g.t, 0, r.len);
    this.pos.x = r.x0 + r.ux * tt; this.pos.z = r.z0 + r.uz * tt;
    this.pos.y = railTop(r, tt) + RIDE_H;
    this.groundY = heightAt(this.pos.x, this.pos.z);
    this.vel.x = r.ux * g.dir * g.s; this.vel.z = r.uz * g.dir * g.s; this.vel.y = slope * g.s;
    this.speed = g.s;
    this.lean = damp(this.lean, input.steer * 0.25, 6, dt);
    this.tuck = damp(this.tuck, 0.4, 6, dt);
    this.updateBasis();
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (input.jump) this.jumpBuffer = 0.14;
    // metal sparks from the bar
    if (Math.random() < 0.6) {
      const a = rnd(TAU);
      fx.spawn(this.pos.x, this.pos.y - RIDE_H + 0.02, this.pos.z, Math.cos(a) * rnd(0.5, 2), rnd(0.5, 2.5), Math.sin(a) * rnd(0.5, 2),
        { life: rnd(0.15, 0.35), size: rnd(0.03, 0.07), col: [1.6, 1.0, 0.4], alpha: 1, grav: -9, drag: 0.5 });
    }
    const off = g.t < 0 || g.t > r.len;
    if (off || this.jumpBuffer > 0) {
      const railYaw = Math.atan2(r.ux * g.dir, r.uz * g.dir);
      let ang = Math.abs(angDelta(railYaw, this.yaw)); if (ang > Math.PI / 2) ang = Math.PI - ang;
      Game.onGrind(g.time, ang);
      this.grind = null;
      this.airborne = true; this.airTime = 0;
      this.vel.y = this.jumpBuffer > 0 ? 5.2 : Math.max(1.2, this.vel.y);
      this.jumpBuffer = 0;
      this.spin = 0; this.flip = 0; this.flipRate = 0; this.flipArmed = false; this.autoYaw = null; this.airLabel = null;
      if (!off) Audio.ollie();
    }
    const half = BOARD_L * 0.5 * 0.86;
    V3.set(this.frontPos, this.pos.x + this.dir.x * half, this.pos.y, this.pos.z + this.dir.z * half);
    V3.set(this.backPos, this.pos.x - this.dir.x * half, this.pos.y, this.pos.z - this.dir.z * half);
  }

  /* ---------------- wipeout ---------------- */
  crash(fx) {
    if (this.invuln > 0) return;
    this.crashTimer = 1.75;
    this.invuln = 0.2;
    this.spin = 0;
    V3.set(this.crashSpin, rnd(-7, 7), rnd(-4, 4), rnd(-9, 9));
    this.vel.x *= 0.55; this.vel.z *= 0.55; this.vel.y = 3.2;
    fx.crash(this.pos.x, this.pos.y, this.pos.z, this.vel.x, this.vel.y, this.vel.z);
    Cam.shake = Math.max(Cam.shake, 0.65);
    Audio.crash();
    Game.onCrash();
  }

  stepCrash(dt, fx) {
    this.crashTimer -= dt;
    this.flipVis = damp(this.flipVis, 0, 6, dt);
    this.vel.y -= G * dt;
    const k = 1 - 1.6 * dt;
    this.vel.x *= k; this.vel.z *= k;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    this.yaw += this.crashSpin.x * dt * 0.5;
    this.lean = damp(this.lean, Math.sin(this.crashTimer * 9) * 0.9, 6, dt);
    const gy = heightAt(this.pos.x, this.pos.z);
    this.groundY = gy;
    if (this.pos.y < gy + 0.35) {
      this.pos.y = gy + 0.35;
      this.vel.y = Math.abs(this.vel.y) * 0.28;
      if (Math.abs(this.vel.y) < 0.6) this.vel.y = 0;
      if (Math.random() < 0.5) fx.impact(this.pos.x, gy, this.pos.z, 0.25, this.vel.x, this.vel.z);
    }
    this.updateBasis();
    if (this.crashTimer <= 0) {
      this.crashTimer = 0;
      this.invuln = 1.1;
      this.lean = 0;
      this.vel.y = 0;
      this.updateBasis();
      Game.recover();
    }
  }

  /* =====================================================================
     Procedural rider. Feet are bolted to the bindings; everything else is
     posed from the board frame (X = nose, Y = up, Z = toe edge) with
     two-bone IK for arms and legs. The rider stands sideways (regular
     stance, chest toward the toe edge) with the upper body opened toward
     the nose, like a real snowboarder.
     ===================================================================== */
  buildPose() {
    this._mi = 0;
    const up = this.up, dir = this.dir, right = this.right;
    m4axes(this.boardMat, dir, up, right, this.pos.x, this.pos.y - RIDE_H, this.pos.z);
    const BM = this.boardMat;
    const local = (x, y, z) => V3(
      BM[0] * x + BM[4] * y + BM[8] * z + BM[12],
      BM[1] * x + BM[5] * y + BM[9] * z + BM[13],
      BM[2] * x + BM[6] * y + BM[10] * z + BM[14]);
    const add = (a, v, k) => V3(a.x + v.x * k, a.y + v.y * k, a.z + v.z * k);
    const nrm = (x, y, z) => V3.norm(V3(), V3(x, y, z));
    const lerpV = (a, b, k) => V3(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));

    const t = GL.time, crash = this.crashTimer > 0, air = this.airborne, lean = this.lean * LEAN_VIS;
    const grab = !crash && air && this.grab ? this.grab : null;
    const tuck = air ? Math.max(this.tuck, this.braking, Math.min(1, Math.abs(this.flipRate) / 2)) : this.tuck;

    // ---- posture ----
    let crouch = lerp(1, 0.80, tuck) * (1 - clamp(this.load - 1, 0, 1.6) * 0.12);
    if (air) crouch *= 0.92;
    if (grab) crouch = Math.min(crouch, 0.66);
    const bob = Math.sin(t * (4 + this.speed * 0.35)) * this.chop * 0.04;
    const side = lean * 0.16;                         // hips shift over the working edge
    const hipH = 0.86 * crouch + bob;                 // belt height above the board base
    const STANCE = 0.27;

    // body frame: chest (Z) faces the toe edge, opened toward the nose by `open`,
    // bent forward at the waist by `bend`, leaning into the turn. X = lead side.
    const frame = (open, bend, leanK) => {
      const co = Math.cos(open), so = Math.sin(open);
      let Z = nrm(right.x * co + dir.x * so, right.y * co + dir.y * so, right.z * co + dir.z * so);
      const Y = nrm(up.x + Z.x * bend + right.x * lean * leanK,
                    up.y + Z.y * bend + right.y * lean * leanK,
                    up.z + Z.z * bend + right.z * lean * leanK);
      const d = V3.dot(Z, Y);
      Z = nrm(Z.x - Y.x * d, Z.y - Y.y * d, Z.z - Y.z * d);
      return [V3.cross(V3(), Y, Z), Y, Z];            // right-handed: Z = X × Y
    };
    let open = 0.62 + (air ? clamp(this.spin * 0.08, -0.3, 0.3) : 0);
    // toe-side turns (lean > 0) press the chest forward over the toes; heel-side turns
    // (lean < 0) sit back over the heels — otherwise the constant forward bend
    // cancels most of a heel-side lean and the rider looks like they lean out
    let bend = 0.22 + tuck * 0.40 + (grab ? 0.65 : 0) + Math.max(0, lean) * 0.15 + Math.min(0, lean) * 0.30;
    if (crash) { bend += Math.sin(this.crashTimer * 7) * 0.7; open += Math.cos(this.crashTimer * 5) * 0.8; }
    const [TX, TY, TZ] = frame(open, bend, 0.40);
    const [PX, PY, PZ] = frame(open * 0.45, bend * 0.3, 0.25);

    const pelvisP = local(0, hipH, side);
    const torsoP = add(pelvisP, PY, 0.02);
    const shF = add(add(torsoP, TX, 0.20), TY, 0.48);
    const shB = add(add(torsoP, TX, -0.20), TY, 0.48);

    // ---- IK: joint between a and b for segment lengths L1, L2, bending toward `hint` ----
    const ik = (a, b, L1, L2, hint) => {
      let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d0 = Math.hypot(dx, dy, dz) || 1e-4;
      dx /= d0; dy /= d0; dz /= d0;
      const d = Math.min(d0, L1 + L2 - 1e-3);
      const along = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, L1 * L1 - along * along));
      const k = hint.x * dx + hint.y * dy + hint.z * dz;
      const hv = nrm(hint.x - dx * k, hint.y - dy * k, hint.z - dz * k);
      return {
        joint: V3(a.x + dx * along + hv.x * h, a.y + dy * along + hv.y * h, a.z + dz * along + hv.z * h),
        end: V3(a.x + dx * d, a.y + dy * d, a.z + dz * d)
      };
    };

    // ---- legs: hips → knees (pushed toward the toe edge / nose) → ankles in the boots ----
    const hipF = add(add(pelvisP, PX, 0.095), PY, -0.10);
    const hipB = add(add(pelvisP, PX, -0.095), PY, -0.10);
    const ankF = local(STANCE, 0.17, 0), ankB = local(-STANCE, 0.17, 0);
    const kneeHint = nrm(PZ.x + dir.x * 0.25, PZ.y + dir.y * 0.25, PZ.z + dir.z * 0.25);
    const legF = ik(hipF, ankF, 0.45, 0.45, kneeHint);
    const legB = ik(hipB, ankB, 0.45, 0.45, kneeHint);

    // ---- arms: out for balance, in for a tuck, up in the air, down to the board for grabs ----
    let hF = local(0.60, hipH + 0.10, 0.20 + side), hB = local(-0.52, hipH + 0.02, 0.12 + side);
    hF = lerpV(hF, local(0.28, hipH - 0.25, 0.30), tuck);
    hB = lerpV(hB, local(0.00, hipH - 0.28, 0.30), tuck);
    if (air) { hF = local(0.62, hipH + 0.40, 0.05); hB = local(-0.58, hipH + 0.34, 0.0); }
    const GRABS = {                                   // [hand, board-local target]
      Indy: ['B', -0.02, 0.15], stale: ['B', -0.05, -0.15],
      method: ['F', 0.05, -0.15], mute: ['F', 0.05, 0.15]
    };
    if (grab && GRABS[grab]) {
      const [hand, gx, gz] = GRABS[grab];
      const target = local(gx, 0.07, gz);
      if (hand === 'F') hF = target; else hB = target;
    }
    if (crash) {
      const w = this.crashTimer * 7;
      hF = V3(shF.x + Math.sin(w) * 0.5, shF.y + Math.abs(Math.cos(w)) * 0.4, shF.z + Math.cos(w) * 0.5);
      hB = V3(shB.x + Math.cos(w * 1.2) * 0.5, shB.y + Math.abs(Math.sin(w * 1.1)) * 0.4, shB.z + Math.sin(w * 1.2) * 0.5);
    }
    const elbHint = (sgn) => nrm(-TY.x * 0.6 + TX.x * 0.3 * sgn - TZ.x * 0.2,
                                 -TY.y * 0.6 + TX.y * 0.3 * sgn - TZ.y * 0.2,
                                 -TY.z * 0.6 + TX.z * 0.3 * sgn - TZ.z * 0.2);
    const armF = ik(shF, hF, 0.30, 0.28, elbHint(1));
    const armB = ik(shB, hB, 0.30, 0.28, elbHint(-1));

    // head looks down the hill toward the nose
    const headP = add(torsoP, TY, 0.70);
    let HZ = nrm(dir.x * 0.75 + TZ.x * 0.5, dir.y * 0.75 + TZ.y * 0.5, dir.z * 0.75 + TZ.z * 0.5);
    const hd = V3.dot(HZ, TY);
    HZ = nrm(HZ.x - TY.x * hd, HZ.y - TY.y * hd, HZ.z - TY.z * hd);
    const HX = V3.cross(V3(), TY, HZ);

    // ---- emit parts ----
    const out = [];
    const push = (mesh, mat) => out.push({ mesh, mat });
    const frameM = (X, Y, Z, p) => m4axes(this._m(), X, Y, Z, p.x, p.y, p.z, 1);
    const limbM = (a, b, r) => m4limb(this._m(), a.x, a.y, a.z, b.x, b.y, b.z, r);
    const ballM = (p, r) => { const m = this._m(); m4ident(m); m[0] = m[5] = m[10] = r; m[12] = p.x; m[13] = p.y; m[14] = p.z; return m; };
    const handM = (p, toward) => {
      const d = nrm(toward.x - p.x, toward.y - p.y, toward.z - p.z);
      return m4limb(this._m(), p.x, p.y, p.z, p.x + d.x, p.y + d.y, p.z + d.z, 1);
    };

    push('pelvis', frameM(PX, PY, PZ, pelvisP));
    push('torso', frameM(TX, TY, TZ, torsoP));
    push('head', frameM(HX, TY, HZ, headP));
    for (const leg of [legF, legB]) {
      push('thigh', limbM(leg === legF ? hipF : hipB, leg.joint, 0.088));
      push('shin', limbM(leg.joint, leg.end, 0.072));
      push('knee', ballM(leg.joint, 0.08));
    }
    for (const arm of [armF, armB]) {
      const sh = arm === armF ? shF : shB;
      push('uparm', limbM(sh, arm.joint, 0.064));
      push('forearm', limbM(arm.joint, arm.end, 0.054));
      push('elbow', ballM(arm.joint, 0.058));
      push('hand', handM(arm.end, arm.joint));
    }
    push('boot', frameM(dir, up, right, local(STANCE, 0.03, 0)));
    push('boot', frameM(dir, up, right, local(-STANCE, 0.03, 0)));

    // flips: rotate board + rider together about the board's toe–heel axis,
    // pivoting at the rider's centre of mass (+ = nose up = backflip)
    const fv = this.flipVis;
    if (Math.abs(fv) > 1e-3) {
      const piv = local(0, 0.70 * crouch, 0);
      const k = right, c = Math.cos(fv), sn = Math.sin(fv), ic = 1 - c;
      const R = this._m();
      R[0] = c + k.x * k.x * ic;       R[1] = k.y * k.x * ic + k.z * sn; R[2] = k.z * k.x * ic - k.y * sn; R[3] = 0;
      R[4] = k.x * k.y * ic - k.z * sn; R[5] = c + k.y * k.y * ic;      R[6] = k.z * k.y * ic + k.x * sn; R[7] = 0;
      R[8] = k.x * k.z * ic + k.y * sn; R[9] = k.y * k.z * ic - k.x * sn; R[10] = c + k.z * k.z * ic;    R[11] = 0;
      R[12] = piv.x - (R[0] * piv.x + R[4] * piv.y + R[8] * piv.z);
      R[13] = piv.y - (R[1] * piv.x + R[5] * piv.y + R[9] * piv.z);
      R[14] = piv.z - (R[2] * piv.x + R[6] * piv.y + R[10] * piv.z);
      R[15] = 1;
      m4mul(this.boardMat, R, this.boardMat);
      for (const q of out) m4mul(q.mat, R, q.mat);
    }

    this.parts = out;
    this.partCount = out.length;
  }
}
