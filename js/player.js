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
/* fastest flip rotation (rad/s ≈ 430°/s): a double cork fits a big pipe air or a ramp
   (real ones take ~1.5–1.9 s), a flat ollie can't fit even a single */
const FLIP_MAX = 7.5;
const LEAN_VIS = 1;           // visual lean direction (board tilt + body). Set to -1 to reverse. Physics unaffected.

class Player {
  constructor() {
    this.pos = V3(0, 0, 0);
    this.vel = V3(0, 0, 0);
    this.yaw = 0;             // heading of the board, radians
    this.lean = 0;            // edge angle, -1..1 (sign = which edge)
    this.speed = 0;
    this.turnRate = 0;
    this.airborne = false;
    this.airTime = 0;
    this.groundY = 0;
    this.load = 1;            // apparent load factor (for compression squash)
    this.tuck = 0;
    this.braking = 0;
    this.chop = 0;            // high-frequency chatter from rough terrain
    this.crashTimer = 0;
    this.crashSpin = V3();
    this.invuln = 0;
    this.landedClean = false;
    this.jumpBuffer = 0;
    this.pumpCooldown = 0;
    this.pumpBuf = 0;         // pump button: short buffer so a press just before the dip counts
    this.press = null;        // butter / press: { type: 'nose'|'tail', t, bal, nz } while on the snow
    this.pressVis = 0;        // render-only board pitch for the press
    this.stompAt = -1;        // air time when stomp was pressed (-1 = not yet this air)
    this.flickRot = null;     // flick mode: { flip, spin, rf, rs } rotation still to do this air
    this.stance = 0;          // flick mode ground 180s: 0 = regular, PI = switch (render-only)
    this.stanceVis = 0;
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
    // buildPose() emits ~27 parts (pelvis, torso, head, 12 limb/joint parts,
    // 2 mittens, 2 boots, scarf segments) plus temporaries. The pool must never
    // wrap mid-pose, or a later part shares — and overwrites — an earlier part's matrix.
    this._tmpM = new Array(48);
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
    this._scarf = null;       // re-seed the scarf chain at the new spot
    this.grind = null;
    // nothing from before the reset carries over (turn momentum, landing settle, skid pose, buffered jumps)
    this.turnRate = 0; this.yawVis = 0; this.brakeVis = 0; this.jumpBuffer = 0; this.coyote = 0;
    this.press = null; this.pressVis = 0; this.pumpBuf = 0; this.stompAt = -1;
    this.flickRot = null; this.stance = 0; this.stanceVis = 0;
    this.updateBasis();
  }

  /* leaving the ground (ollie, crest, rail exit): a fresh air phase — no spin or
     flip carried over, flips must be re-armed, and no leftover grace window */
  _takeoff() {
    if (this.press) { this.airborne = true; this.endPress(true); }   // pop out of a press: counts, spin carries on
    this.airborne = true; this.airTime = 0; this.coyote = 0; this.stompAt = -1; this.flickRot = null; this.lipLaunch = false;
    this.lean *= 0.5;           // carve lean carries into the air as pre-spin; halved since spins got ~2x faster
    this.spinCap = null;        // set from the takeoff speed on the first air frame
    this.spin = 0; this.flip = 0; this.flipRate = 0; this.flipArmed = false;
    this.autoYaw = null; this.airLabel = null;
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
    if (this.invuln > 0) this.invuln -= dt;
    if (this.crashTimer > 0) { this.stepCrash(dt, fx); return; }
    if (this.grind) { this.stepGrind(dt, input, fx); return; }

    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.pumpCooldown > 0) this.pumpCooldown -= dt;
    if (input.jump) { this.jumpBuffer = 0.14; this.jumpCharge = input.charge !== undefined ? input.charge : 0.3; }

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
      this.pos.y = gy + RIDE_H;                 // ride on the surface
    }

    // foot positions (used by the particle emitters)
    const half = BOARD_L * 0.5 * 0.86;
    V3.set(this.frontPos, this.pos.x + this.dir.x * half, this.pos.y, this.pos.z + this.dir.z * half);
    V3.set(this.backPos, this.pos.x - this.dir.x * half, this.pos.y, this.pos.z - this.dir.z * half);

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (Level.cur.rails) this.checkGrind(dt, fx);
    if (this.airborne) this.flipVis = this.flip;
    else this.flipVis = damp(this.flipVis, 0, 14, dt);
    if (this.yawVis) this.yawVis = Math.abs(this.yawVis) < 1e-3 ? 0 : damp(this.yawVis, 0, 12, dt);
    // braking on the snow: blend into the heelside skid-stop pose (render-only)
    const wantBrake = !this.airborne && !this.grind && this.crashTimer <= 0 ? clamp(this.braking, 0, 1) : 0;
    this.brakeVis = damp(this.brakeVis || 0, wantBrake, 7, dt);
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
    // (not during a press: the board spins freely there and travel follows press.head)
    if (!this.press && this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw) < -0.6) {
      this.yaw += Math.PI; this.yawVis = (this.yawVis || 0) - Math.PI;   // ease the 180° visually
      this.updateBasis();
    }
    const head = this.press ? this.press.head : this.yaw;     // physics axes: travel during a press
    const fX = Math.sin(head), fZ = Math.cos(head);
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
    if (this.press) {
      // butter spin: the stick spins the flat board on the snow; no carving while pressed
      this.turnRate = damp(this.turnRate, 0, 12, dt);
      const spin = clamp(-this.lean * 4.6, -4.6, 4.6);
      this.yaw += spin * dt; this.press.spin += spin * dt;
    } else {
      this.turnRate = damp(this.turnRate, turn, 12, dt);
      this.yaw += this.turnRate * dt;
    }

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

    // ---- flick mode on the snow: ←/→ spins the board 180 to switch stance ----
    if (input.flick && Math.abs(input.flick.x) > 0.5 && Math.abs(input.flick.y) < 0.5) {
      this.stance = this.stance ? 0 : Math.PI;
      Game.onSwitch(this.stance !== 0);
    }

    // ---- butter / press: hold the button on the snow; the stick (up/down) keeps the balance ----
    const sFwd = +input.flipFwd || 0, sBack = +input.flipBack || 0;
    if (!input.butter) this.pressLock = false;            // after a slip, let go before pressing again
    if (input.butter && !this.press && !this.pressLock && sp > 2.5) {
      this.press = { type: sFwd > 0.3 ? 'nose' : 'tail', t: 0, bal: (Math.random() - 0.5) * 0.15, nz: Math.random() * 20,
                     head: Math.atan2(this.vel.x, this.vel.z), spin: 0 };
    }
    if (this.press) {
      const p = this.press;
      if (!input.butter) this.endPress(true);
      else {
        p.t += dt;
        // the press wants to tip further the longer you hold it; the stick fights back
        // (tail press: push up to come forward; nose press: pull back)
        const k = 1.3 + p.t * 0.35;
        const wobble = Math.sin(p.nz + p.t * 2.3) * 0.6 + Math.sin(p.nz * 1.7 + p.t * 3.9) * 0.4;
        const fix = (p.type === 'tail' ? sFwd - sBack : sBack - sFwd) * 2.6;
        p.bal += (p.bal * k + wobble * 0.55 - fix) * dt;
        if (Math.abs(p.bal) > 1) { this.endPress(false); this.pressLock = true; }
      }
    }
    const pressing = !!this.press;
    this.tuck = damp(this.tuck, pressing ? 0 : +input.tuck || 0, 8, dt);          // analog from the joystick, 0/1 from keys
    this.braking = damp(this.braking, pressing ? 0 : +input.brake || 0, 9, dt);   // (the stick balances a press instead)
    if (pressing) vFwd -= 0.45 * dt;                                                // a press scrubs a little speed

    // ---- pump button: push into a compression (dip, transition, roller up-slope) for speed ----
    if (input.pump) this.pumpBuf = 0.16;
    if (this.pumpBuf > 0) {
      this.pumpBuf -= dt;
      if (this.pumpCooldown <= 0 && this.load > 1.08) {
        vFwd += Math.min(1.2 + (this.load - 1) * 5.5, input.pumpMax === undefined ? Infinity : input.pumpMax);
        this.pumpCooldown = 0.3; this.pumpBuf = 0;
        fx.puff(this.pos.x, this.groundY, this.pos.z, 0.45);
        Audio.ollie();
        Game.onPump();
      }
    }

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
        this._takeoff();
        this.vel.x = fX * vFwd + rX * vSide;
        this.vel.z = fZ * vFwd + rZ * vSide;
        this.vel.y = this.popSpeed(sp) * (0.80 + Math.max(this.load, 1) * 0.24);   // a crest never weakens the pop
        this.jumpBuffer = 0; this.pumpCooldown = 0.26;
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
    // On natural terrain the rider soaks up crests with the legs and stays
    // planted; air only comes from an ollie (hold Space, release near the top).
    // Built kickers (park tables) still throw you off their lips.
    if (centripetal < -G * 1.05 && (!Level.cur.absorbCrests || (Level.cur.rampLip && Level.cur.rampLip(this.pos.x, this.pos.z)))) {
      this._takeoff();
      this.vel.x = fX * vFwd + rX * vSide;
      this.vel.z = fZ * vFwd + rZ * vSide;
      this.vel.y = Math.max(0, (hB - hC) / e) * sp;   // leave along the ramp we're coming off (the slope behind)
      this.coyote = 0.25;                            // a jump released just after leaving the lip still pops
      return;
    }

    this.vel.x = fX * vFwd + rX * vSide;
    this.vel.z = fZ * vFwd + rZ * vSide;
    this.vel.y = 0;
    if (this.press && Math.hypot(this.vel.x, this.vel.z) > 1) this.press.head = Math.atan2(this.vel.x, this.vel.z);

    // chatter: off-piste snow is rougher than the corduroy
    const d = Math.abs(this.pos.x - centerX(this.pos.z));
    const roughness = smoothstep(PISTE_HALF * 0.55, PISTE_HALF * 1.7, d);
    this.chop = damp(this.chop, (0.10 + roughness * 0.9) * clamp(sp / 20, 0, 1), 7, dt);
  }

  /* ---------------- in the air ---------------- */
  /* ollie pop: base on speed, scaled by how long Space/OLLIE was held (0.6 s = full load) */
  popSpeed(sp) {
    const charge = this.jumpCharge !== undefined ? this.jumpCharge : 0.3;
    // flat-ground ollie ≈ 0.5 m (tap) … ~1.7 m (full load at speed): arcade-generous but in
    // reach of a real pro ollie; big air comes from lips, ramps and kickers, not from pop
    return (3.3 + clamp(sp * 0.05, 0, 1.1)) * lerp(0.85, 1.3, clamp(charge / 0.6, 0, 1));
  }

  stepAir(dt, input, fx) {
    if (input.stomp && this.stompAt < 0) this.stompAt = this.airTime;   // one stomp per air: timing is the skill
    // "coyote time": a bump or lip launched us a moment before the jump was
    // released — still give the full ollie pop (plus some of the lip's own lift)
    if (this.coyote > 0) {
      this.coyote -= dt;
      if (this.jumpBuffer > 0) {
        // pipe lips: an ollie at the lip adds a little on top of the wall's own lift
        // (keeps the best airs near the real ~7.7 m record instead of 15+ m)
        this.vel.y = this.lipLaunch ? Math.min(this.vel.y + this.popSpeed(this.speed) * 0.3, 12.3)
                                    : Math.max(0, this.vel.y) * 0.6 + this.popSpeed(this.speed);
        this.coyote = 0; this.jumpBuffer = 0;
        fx.puff(this.pos.x, this.groundY, this.pos.z, 0.8);
        Audio.ollie();
      }
    }
    this.vel.y -= G * dt;
    // gentle air drag
    const k = 1 - 0.05 * dt;
    this.vel.x *= k; this.vel.z *= k;

    // in-air yaw from the board's remaining rotation (torque steer)
    // up to ~710°/s: a full-amplitude pipe air (~1.9 s) fits a 1080, a big-air jump a 1440
    // (real 1080s happen in ~1.2–1.9 s of air — PMC IMU study of competitive pipe riders).
    // How fast you can spin depends on the takeoff: a flat ollie only has the pop for ~400°/s.
    if (this.spinCap == null) this.spinCap = clamp(4 + Math.max(0, this.vel.y) * 0.85, 6.5, 12.4);   // first air frame
    const cap = this.spinCap || 12.4;
    const spinRate = clamp(-this.lean * 13.5, -cap, cap);
    this.yaw += spinRate * dt;
    this.spin += spinRate * dt;
    if (this.autoYaw) {                    // pipe air: ease the board round to face back in;
      this.autoYaw.target += spinRate * dt; // the rider's own spins ride on top of it
      this.yaw += angDelta(this.yaw, this.autoYaw.target) * (1 - Math.exp(-3.2 * dt));
    }
    this.lean = damp(this.lean, input.steer * 0.92, 6, dt);

    // ---- flick mode: a flick queues a whole rotation that finishes before touchdown ----
    if (input.flick) this.queueFlick(input.flick);
    if (this.flickRot) {
      const q = this.flickRot;
      const df = clamp(q.flip, -q.rf * dt, q.rf * dt), ds = clamp(q.spin, -q.rs * dt, q.rs * dt);
      q.flip -= df; q.spin -= ds;
      this.flip += df; this.flipRate = df / dt;
      this.yaw += ds; this.spin += ds;
      if (this.autoYaw) this.autoYaw.target += ds;
      if (Math.abs(q.flip) < 1e-4 && Math.abs(q.spin) < 1e-4) {
        this.flickRot = null; this.flipRate = 0;
        this.flip = Math.round(this.flip / TAU) * TAU;        // land exactly upright
      }
    }

    // flips: W pitches forward = frontflip, S pulls back = backflip. Holding W/S
    // through the takeoff (tucking for speed) doesn't count — the key has to
    // be pressed fresh once airborne (or a grab held), so crest launches never
    // flip you by accident.
    // (flip keys are W/S only — holding Space to load an ollie must never flip you)
    // (analog 0..1 from the touch joystick: a half push flips at half speed)
    const fF = +(input.flipFwd !== undefined ? input.flipFwd : input.tuck) || 0;
    const fB = +(input.flipBack !== undefined ? input.flipBack : input.brake) || 0;
    // a held grab is deliberate trick intent: flips are free immediately, even if
    // the stick was already pushed through the takeoff
    if ((fF < 0.1 && fB < 0.1) || input.grab) this.flipArmed = true;
    const want = this.flipArmed ? fB - fF : 0;                        // + = nose up = backflip
    if (!this.flickRot) {
      this.flipRate = damp(this.flipRate, want * FLIP_MAX * 0.95, 9, dt);
      this.flip += this.flipRate * dt;
    }

    this.grab = input.grab || null;
    this.grabTime = this.grab ? this.grabTime + dt : 0;

    this.tuck = damp(this.tuck, +input.tuck || 0, 8, dt);
    this.braking = damp(this.braking, +input.brake || 0, 8, dt);
  }

  /* ---------------- touchdown ---------------- */
  land(fx) {
    this.autoYaw = null;
    this.coyote = 0;              // a crest's grace window must not survive into the next ollie
    const n = this.nrm;
    normalAt(this.pos.x, this.pos.z, n);
    const vDown = this.vel.y;
    // impact = speed INTO the surface (along its normal), not raw vertical speed:
    // touching down on a downslope that matches your arc is soft, flat-to-flat is not
    const vN = this.vel.x * n.x + this.vel.y * n.y + this.vel.z * n.z;
    const impact = clamp(-vN / 12, 0.05, 2.4);
    // STOMP: pressed in the last ~0.22 s before touchdown → firmer, more forgiving landing
    const stomped = this.stompAt >= 0 && this.airTime > 0.35 && this.airTime - this.stompAt <= 0.22;
    const sf = stomped ? 1.2 : 1;
    this.stompAt = -1;
    this.airborne = false;
    this.airTime = 0;
    this.pos.y = heightAt(this.pos.x, this.pos.z) + RIDE_H;

    // keep the velocity component ALONG the slope (the into-the-snow part is the
    // impact). On pipe walls and landing ramps this turns the fall into speed.
    if (vN < 0) { this.vel.x -= vN * n.x; this.vel.z -= vN * n.z; }

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
    const upDot = n.y * this.up.y + n.x * this.up.x + n.z * this.up.z;
    const baseError = Math.acos(clamp(upDot, -1, 1));
    const overLean = Math.abs(this.lean);
    // an unfinished flip: how far the board is from upright around the flip axis
    const flipResidual = Math.abs(angDelta(0, this.flip));

    const bad =
      baseError > 0.95 * sf ||                  // landing on the rail / sideways
      missAngle > 1.25 * sf ||                  // travelling the wrong way (~72°)
      (overLean > 0.85 && impact > 0.8 * sf) || // edge catch
      impact > 2.0 * sf ||                      // just fell in it
      flipResidual > 1.05 * sf;                 // under/over-rotated the flip (~60°)
    if (stomped && !bad) { Game.onStomp(); Cam.shake = Math.max(Cam.shake, 0.12); fx.puff(this.pos.x, this.groundY, this.pos.z, 1.3); }

    const oldYaw = this.yaw;
    if (!bad && travel > 1.5) {
      // clean: the board settles onto the line you're travelling (switch landings
      // just ride out forwards). Speed is kept; only hard or sloppy landings cost.
      this.yaw = Math.atan2(this.vel.x, this.vel.z);
      const keep = lerp(1.0, 0.86, clamp((impact - 0.35) / 1.0, 0, 1)) * lerp(1.0, 0.82, Math.pow(missAngle / 1.25, 2));
      this.vel.x *= keep; this.vel.z *= keep;
    } else {
      if (switchLanding) this.yaw = (this.yaw + Math.PI) % TAU;
      const keep = bad ? 0.30 : 0.95;
      const fX = Math.sin(this.yaw), fZ = Math.cos(this.yaw);
      const fwdSpeed = Math.abs(this.vel.x * fX + this.vel.z * fZ);
      this.vel.x = fX * fwdSpeed * keep;
      this.vel.z = fZ * fwdSpeed * keep;
    }
    this.yawVis = angDelta(this.yaw, oldYaw);   // render-only: ease the board round, no pop
    this.updateBasis();
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
  checkGrind(dt, fx) {
    if (this.grind || this.crashTimer > 0) return;
    const p = this.pos, feet = p.y - RIDE_H;
    for (const r of Level.cur.rails) {
      if (p.z < r.zmin - 1 || p.z > r.zmax + 1) continue;
      const rx = p.x - r.x0, rz = p.z - r.z0;
      const t = rx * r.ux + rz * r.uz;
      if (t < 0 || t > r.len - 0.5) continue;
      const side = rx * -r.uz + rz * r.ux;                           // signed sideways distance to the bar
      const top = railTop(r, t);
      // coming down just beside the rail: pull gently onto its line (a forgiving "magnet")
      if (this.airborne && this.vel.y < 3 && Math.abs(side) < 1.2 && feet > top - 0.3 && feet < top + 2.5) {
        const pull = Math.min(Math.abs(side), 4.5 * dt) * Math.sign(side);   // magnet: 4.5 m/s
        this.pos.x += r.uz * pull; this.pos.z -= r.ux * pull;
      }
      if (Math.abs(side) > 0.6) continue;
      const ok = this.airborne
        ? (this.vel.y <= 3 && feet > top - 0.7 && feet < top + 1.2)
        : (feet > top - 0.25);                                        // rolled onto the flush entry
      if (!ok) continue;
      if (this.airborne && Math.abs(angDelta(0, this.flip)) > 1.05) { this.crash(fx); return; }
      const along = this.vel.x * r.ux + this.vel.z * r.uz;
      // keep (most of) the approach speed even if you come in at an angle
      this.grind = { r, t, dir: along >= 0 ? 1 : -1, s: Math.max(3, Math.hypot(this.vel.x, this.vel.z) * 0.92), time: 0 };
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
    if (input.jump) { this.jumpBuffer = 0.14; this.jumpCharge = input.charge; }   // pop height follows THIS hold
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
      this._takeoff();
      const popped = this.jumpBuffer > 0;
      this.vel.y = popped ? Math.max(3.6, this.popSpeed(g.s)) : Math.max(1.2, this.vel.y);
      this.jumpBuffer = 0;
      if (!off) Audio.ollie(); else this.coyote = 0.25;
    }
    const half = BOARD_L * 0.5 * 0.86;
    V3.set(this.frontPos, this.pos.x + this.dir.x * half, this.pos.y, this.pos.z + this.dir.z * half);
    V3.set(this.backPos, this.pos.x - this.dir.x * half, this.pos.y, this.pos.z - this.dir.z * half);
  }

  /* ---------------- wipeout ---------------- */
  /* flick mode: queue a full flip (dy) and/or spin (dx) if there's air left to finish it.
     The rotation rate is chosen so it completes before the predicted touchdown. */
  /* time until touchdown: trace the ballistic arc against the real terrain
     (a flat-ground estimate badly underestimates air over a downhill landing) */
  timeToLand() {
    let x = this.pos.x, y = this.pos.y, z = this.pos.z, vy = this.vel.y;
    const vx = this.vel.x, vz = this.vel.z, h = 1 / 30;
    for (let t = 0; t < 6; t += h) {
      if (y - RIDE_H <= heightAt(x, z)) return t;
      x += vx * h; z += vz * h; y += vy * h; vy -= G * h;
    }
    return 6;
  }

  queueFlick(f) {
    const tLeft = this.timeToLand();
    const q = this.flickRot || { flip: 0, spin: 0, rf: 0, rs: 0 };
    const avail = tLeft * 0.9;
    if (avail < 0.42) { Game.onFlickTooLow(); return; }
    const nf = q.flip + (Math.abs(f.y) > 0.38 ? (f.y < 0 ? -TAU : TAU) : 0);   // up = frontflip
    const ns = q.spin + (Math.abs(f.x) > 0.38 ? (f.x > 0 ? -TAU : TAU) : 0);   // right = spin right
    // finish the whole queue within the air left (snappy: ~0.85 s per rotation at most),
    // at no more than a real rider's rotation speed — flips ≤ ~315°/s, spins ≤ this
    // takeoff's spinCap. A flick that can't make it is refused (TOO LOW).
    const need = Math.max(Math.abs(nf) / FLIP_MAX, Math.abs(ns) / (this.spinCap || 12.4));   // fastest possible
    if (need > avail) { Game.onFlickTooLow(); return; }
    const dur = clamp(0.85 * Math.max(1, Math.max(Math.abs(nf), Math.abs(ns)) / TAU), need, avail);
    const rf = Math.abs(nf) / dur, rs = Math.abs(ns) / dur;
    q.flip = nf; q.spin = ns; q.rf = rf; q.rs = rs;
    this.flickRot = q;
  }

  /* end a butter/press: clean (released, or popped off) or slipped (lost the balance) */
  endPress(clean) {
    const p = this.press; if (!p) return;
    this.press = null;
    if (!this.airborne) {
      // back on the edges: the board must be near straight or switch to ride out;
      // anything else is a sideways slip (combo gone, but no crash)
      const a = Math.abs(angDelta(p.head, this.yaw));
      if (Math.min(a, Math.PI - a) > 0.6) clean = false;
      const oldYaw = this.yaw;
      this.yaw = p.head;                                     // ride out nose-first
      this.yawVis = angDelta(this.yaw, oldYaw);              // …easing round from switch if needed
      this.updateBasis();
    }
    Game.onPress(p.type, p.t, clean, Math.floor((Math.abs(p.spin) + 0.6) / Math.PI) * 180);   // completed half-turns (same ±35° as a clean ride-out)
  }

  crash(fx) {
    if (this.invuln > 0) return;
    this.press = null;
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
    let up = this.up, dir = this.dir, right = this.right;
    if (this.yawVis) {                 // landing settle: draw the board slightly behind its physics yaw
      const c = Math.cos(this.yawVis), sn = Math.sin(this.yawVis);
      dir = V3(dir.x * c - right.x * sn, dir.y * c - right.y * sn, dir.z * c - right.z * sn);
      right = V3(right.x * c + this.dir.x * sn, right.y * c + this.dir.y * sn, right.z * c + this.dir.z * sn);
    }
    const bv = this.brakeVis || 0;
    if (bv > 0.01) {
      // heelside skid stop: swing the board across the fall line (the rider ends up
      // facing down the hill, back to the camera) and rock it onto the heel edge
      const d = bv * Math.PI * 0.46, c = Math.cos(d), sn = Math.sin(d);
      const nd = V3(dir.x * c - right.x * sn, dir.y * c - right.y * sn, dir.z * c - right.z * sn);
      const nr = V3(right.x * c + dir.x * sn, right.y * c + dir.y * sn, right.z * c + dir.z * sn);
      dir = nd; right = nr;
      const t = bv * 0.42, ct = Math.cos(t), st = Math.sin(t);
      up = V3.norm(V3(), V3(up.x * ct - right.x * st, up.y * ct - right.y * st, up.z * ct - right.z * st));
      right = V3.norm(V3(), V3.cross(V3(), dir, up));
    }
    m4axes(this.boardMat, dir, up, right, this.pos.x, this.pos.y - RIDE_H, this.pos.z);
    const BM = this.boardMat;
    const local = (x, y, z) => V3(
      BM[0] * x + BM[4] * y + BM[8] * z + BM[12],
      BM[1] * x + BM[5] * y + BM[9] * z + BM[13],
      BM[2] * x + BM[6] * y + BM[10] * z + BM[14]);
    const add = (a, v, k) => V3(a.x + v.x * k, a.y + v.y * k, a.z + v.z * k);
    const nrm = (x, y, z) => V3.norm(V3(), V3(x, y, z));
    const lerpV = (a, b, k) => V3(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));

    const t = GL.time, crash = this.crashTimer > 0, air = this.airborne, lean = this.lean * LEAN_VIS * (this.press ? 0.35 : 1) * (this.stance ? -1 : 1) - bv * 0.85;   // switch: mirrored   // braking: sit back onto the heels
    const grab = !crash && air && this.grab ? this.grab : null;
    const tuck = air ? Math.max(this.tuck, this.braking, Math.min(1, Math.abs(this.flipRate) / 2)) : this.tuck;

    // ---- posture ----
    let crouch = lerp(1, 0.80, tuck) * (1 - clamp(this.load - 1, 0, 1.6) * 0.12) * (1 - 0.12 * bv);
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
    let open = (0.62 + (air ? clamp(this.spin * 0.08, -0.3, 0.3) : 0)) * (1 - 0.6 * bv);   // square up to the slope when stopping
    // toe-side turns (lean > 0) press the chest forward over the toes; heel-side turns
    // (lean < 0) sit back over the heels — otherwise the constant forward bend
    // cancels most of a heel-side lean and the rider looks like they lean out
    // press: + = tail press (nose up), − = nose press
    this.pressVis = damp(this.pressVis, this.press ? (this.press.type === 'tail' ? 1 : -1) : 0, 10, 1 / 60);
    let bend = 0.22 + tuck * 0.40 + (grab ? 0.65 : 0) + Math.max(0, lean) * 0.15 + Math.min(0, lean) * 0.30
      - this.pressVis * 0.28;                        // sit back over a tail press, lean out over a nose press
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
    const fw = this.dir;               // look where we're going (the board may be skidding sideways)
    let HZ = nrm(fw.x * 0.75 + TZ.x * 0.5, fw.y * 0.75 + TZ.y * 0.5, fw.z * 0.75 + TZ.z * 0.5);
    const hd = V3.dot(HZ, TY);
    HZ = nrm(HZ.x - TY.x * hd, HZ.y - TY.y * hd, HZ.z - TY.z * hd);
    const HX = V3.cross(V3(), TY, HZ);

    // ---- emit parts ----
    const out = [];
    const push = (mesh, mat) => out.push({ mesh, mat });
    const frameM = (X, Y, Z, p) => m4axes(this._m(), X, Y, Z, p.x, p.y, p.z, 1);
    const limbM = (a, b, r) => m4limb(this._m(), a.x, a.y, a.z, b.x, b.y, b.z, r);
    const ballM = (p, r) => { const m = this._m(); m4ident(m); m[0] = m[5] = m[10] = r; m[12] = p.x; m[13] = p.y; m[14] = p.z; return m; };
    // mitten frame: +Y up the forearm, thumb (+X) toward the chest's forward/up side
    const mittenM = (p, toward) => {
      const Y = nrm(toward.x - p.x, toward.y - p.y, toward.z - p.z);
      let c = V3(TZ.x + TY.x * 0.5, TZ.y + TY.y * 0.5, TZ.z + TY.z * 0.5);
      let k = V3.dot(c, Y);
      if (Math.hypot(c.x - Y.x * k, c.y - Y.y * k, c.z - Y.z * k) < 0.25) { c = TX; k = V3.dot(c, Y); }
      const X = nrm(c.x - Y.x * k, c.y - Y.y * k, c.z - Y.z * k);
      return m4axes(this._m(), X, Y, V3.cross(V3(), X, Y), p.x, p.y, p.z, 1);
    };

    push('pelvis', frameM(PX, PY, PZ, pelvisP));
    const torsoM = frameM(TX, TY, TZ, torsoP);
    push('torso', torsoM);
    push('head', frameM(HX, TY, HZ, headP));
    for (const leg of [legF, legB]) {
      push('thigh', limbM(leg === legF ? hipF : hipB, leg.joint, 0.086));
      push('shin', limbM(leg.joint, leg.end, 0.072));
      push('knee', ballM(leg.joint, 0.098));
    }
    for (const arm of [armF, armB]) {
      const sh = arm === armF ? shF : shB;
      push('uparm', limbM(sh, arm.joint, 0.060));
      push('forearm', limbM(arm.joint, arm.end, 0.052));
      push('elbow', ballM(arm.joint, 0.068));
      push('mitten', mittenM(arm.end, arm.joint));
    }
    push('boot', frameM(dir, up, right, local(STANCE, 0.03, 0)));
    push('boot', frameM(dir, up, right, local(-STANCE, 0.03, 0)));

    // flips: rotate board + rider together about the board's toe–heel axis,
    // pivoting at the rider's centre of mass (+ = nose up = backflip)
    // flick-mode stance: switch = board + rider turned 180° about the vertical (render-only)
    this.stanceVis += angDelta(this.stanceVis, this.stance) * (1 - Math.exp(-14 / 60));
    if (Math.abs(angDelta(0, this.stanceVis)) > 1e-3) {
      const k = up, a = this.stanceVis, piv = this.pos;
      const c = Math.cos(a), sn = Math.sin(a), ic = 1 - c, R = this._m();
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

    // butter / press: pitch board + rider up off the tail (or nose) contact point
    const pv = this.pressVis;
    if (Math.abs(pv) > 1e-3) {
      const piv = local(-Math.sign(pv) * 0.70, 0, 0), k = right, a = pv * 0.21;
      const c = Math.cos(a), sn = Math.sin(a), ic = 1 - c, R = this._m();
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

    // scarf: simulated in world space after the flip, so it trails the real motion
    this.stepScarf(torsoM);
    const S = this._scarf, SF = V3(torsoM[8] + torsoM[4] * 0.35, torsoM[9] + torsoM[5] * 0.35, torsoM[10] + torsoM[6] * 0.35);
    for (let i = 0; i < S.length - 1; i++) {
      const a = S[i], b = S[i + 1];
      const Y = V3(b.x - a.x, b.y - a.y, b.z - a.z);
      const len = Math.hypot(Y.x, Y.y, Y.z) || 1e-4;
      V3.scale(Y, Y, 1 / len);
      // flat side toward the chest/up direction: lies flat on the back when it hangs,
      // turns on edge when it streams out sideways (never parallel: the scarf trails behind)
      const X = V3.norm(V3(), V3.cross(V3(), Y, SF));
      const Z = V3.cross(V3(), X, Y);
      push('scarf', m4axesS(this._m(), X, Y, Z, a.x, a.y, a.z, 0.085 - i * 0.005, len, 0.040));
    }

    this.parts = out;
    this.partCount = out.length;
  }

  /* Scarf: a short verlet chain pinned at the back of the collar (TM = the
     torso matrix). Drag against still air makes it stream behind the rider and
     a speed-scaled flutter keeps it alive. dt is clamped and split into fixed
     substeps, each link is held at its rest length by moving only the child
     node (no stretch, no stiffness to blow up), nodes are pushed out of the
     torso and helmet, and the chain re-seeds after reset() or whenever it ends
     up far from its anchor (teleports, NaNs). */
  stepScarf(TM) {
    const N = 6, SL = 0.095;
    const anc = m4point(V3(), TM, 0, 0.63, -0.115);
    const now = GL.time || 0;
    const dt = clamp(now - (this._scarfT === undefined ? now : this._scarfT), 0, 1 / 20);
    this._scarfT = now;
    const X = V3(TM[0], TM[1], TM[2]), Y = V3(TM[4], TM[5], TM[6]), Z = V3(TM[8], TM[9], TM[10]);
    let S = this._scarf;
    if (S) {
      const e = S[N - 1];
      if (!isFinite(e.x + e.y + e.z) || Math.hypot(S[0].x - anc.x, S[0].y - anc.y, S[0].z - anc.z) > 1.5) S = null;
    }
    if (!S) {                                         // hang it down the back
      S = [];
      for (let i = 0; i < N; i++) {
        const x = anc.x - Z.x * 0.03 * i, y = anc.y - SL * i * 0.97, z = anc.z - Z.z * 0.03 * i;
        S.push({ x, y, z, px: x, py: y, pz: z });
      }
      this._scarf = S;
    }
    const a0 = V3(S[0].x, S[0].y, S[0].z);
    const n = Math.max(1, Math.ceil(dt / (1 / 90))), h = dt / n;
    const kd = Math.exp(-3.5 * h), sp = Math.min(this.speed, 25);
    const O = V3(TM[12], TM[13], TM[14]);
    for (let s = 0; s < n && dt > 0; s++) {
      const u = (s + 1) / n, ts = now - dt + u * dt, r0 = S[0];
      r0.x = r0.px = lerp(a0.x, anc.x, u); r0.y = r0.py = lerp(a0.y, anc.y, u); r0.z = r0.pz = lerp(a0.z, anc.z, u);
      for (let i = 1; i < N; i++) {
        const q = S[i];
        const f = Math.sin(ts * (15 + i * 3.1) + i * 1.3) * sp * 0.30 * (i / N);
        const vx = (q.x - q.px) * kd, vy = (q.y - q.py) * kd, vz = (q.z - q.pz) * kd;
        q.px = q.x; q.py = q.y; q.pz = q.z;
        q.x += vx + (X.x * f + Y.x * f * 0.4) * h * h;
        q.y += vy + (X.y * f + Y.y * f * 0.4 - G * 0.7) * h * h;
        q.z += vz + (X.z * f + Y.z * f * 0.4) * h * h;
        // keep out of the jacket (elliptic column) and the helmet (sphere), in torso space
        let lx = (q.x - O.x) * X.x + (q.y - O.y) * X.y + (q.z - O.z) * X.z;
        let ly = (q.x - O.x) * Y.x + (q.y - O.y) * Y.y + (q.z - O.z) * Y.z;
        let lz = (q.x - O.x) * Z.x + (q.y - O.y) * Z.y + (q.z - O.z) * Z.z;
        const e = (lx / 0.25) ** 2 + (lz / 0.19) ** 2;
        if (ly > -0.12 && ly < 0.62 && e < 1) { const k = 1 / Math.sqrt(Math.max(e, 1e-4)); lx *= k; lz *= k; }
        const hy = ly - 0.81, hr = Math.hypot(lx, hy, lz);
        if (hr < 0.17) { const k = 0.17 / Math.max(hr, 1e-4); lx *= k; ly = 0.81 + hy * k; lz *= k; }
        q.x = O.x + X.x * lx + Y.x * ly + Z.x * lz;
        q.y = O.y + X.y * lx + Y.y * ly + Z.y * lz;
        q.z = O.z + X.z * lx + Y.z * ly + Z.z * lz;
        // a little bending stiffness: keep the grandparent at least 1.7 links away
        if (i > 1) {
          const g = S[i - 2], bx = q.x - g.x, by = q.y - g.y, bz = q.z - g.z, bl = Math.hypot(bx, by, bz);
          if (bl < SL * 1.7 && bl > 1e-5) { const k = SL * 1.7 / bl; q.x = g.x + bx * k; q.y = g.y + by * k; q.z = g.z + bz * k; }
        }
        // inextensible link: move only the child back to the rest length
        const p = S[i - 1], dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
        const l = Math.hypot(dx, dy, dz) || 1e-6;
        q.x = p.x + dx * SL / l; q.y = p.y + dy * SL / l; q.z = p.z + dz * SL / l;
      }
    }
  }
}
