/* =====================================================================
   surfer.js — the rider. Lives on the moving water surface in world
   space: gravity pulls down the local slope, the water drags.
     prone : isotropic drag, paddle thrust along the board. To catch a wave
             you need enough paddle speed when the face is under you that
             gravity on the slope can take you to wave speed.
     ride  : fins — little drag along the board, a lot across it, so
             angling down the face turns the slope into speed down the line.
             Stalling (drag the tail/hand) slows you so the curl catches up.
   Water is still except in whitewater, which shoves you shoreward.
   ===================================================================== */
'use strict';

const _Q = {}, _QA = {};

function J3(x, y, z) { return [x, y, z]; }
function poseNew() {
  return { hip: J3(0, 0, 0), chest: J3(0, 0, 0), neck: J3(0, 0, 0), head: J3(0, 0, 0), hairOff: J3(0, 0, 0),
           sh: [J3(0, 0, 0), J3(0, 0, 0)], el: [J3(0, 0, 0), J3(0, 0, 0)], ha: [J3(0, 0, 0), J3(0, 0, 0)],
           hp: [J3(0, 0, 0), J3(0, 0, 0)], kn: [J3(0, 0, 0), J3(0, 0, 0)], ft: [J3(0, 0, 0), J3(0, 0, 0)] };
}
function poseLerp(o, a, b, t) {
  for (const k in o) {
    if (typeof o[k][0] === 'number') for (let i = 0; i < 3; i++) o[k][i] = lerp(a[k][i], b[k][i], t);
    else for (let s = 0; s < 2; s++) for (let i = 0; i < 3; i++) o[k][s][i] = lerp(a[k][s][i], b[k][s][i], t);
  }
}
const set3 = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; };

const Surfer = {
  mode: 'prone',
  pos: V3(), vx: 0, vz: 0, vy: 0, yaw: Math.PI,
  stamina: 1, popArm: 0, sitMode: true, duckT: 0, duckCool: 0, popT: 0, wipeT: 0, tumbleT: 0, pumpT: 0, pumpCool: 0,
  phase: 0, crouch: 0.3, lean: 0, stall: 0, paddling: 0,
  lastHit: 0, rideWave: null, offWave: 0, bogT: 0, yPrev: 0, ydot: 0,
  tubeT: 0, tubeGap: 0, covered: false, inTube: false, tubeDepth: 0,
  turnAcc: 0, turnIdle: 0, turnFrac: 0, airT: 0, airSpin: 0, rideT: 0,
  lastMove: '', streak: 0,
  // render state
  nrm: V3(0, 1, 0), up: V3(0, 1, 0), fwd: V3(0, 0, -1), bpos: V3(), pose: poseNew(), bodyM: null,
  _pa: poseNew(), _pb: poseNew(), tumble: V3(), tumbleV: V3(),
  q: _Q,

  reset(x, z) {
    this.mode = 'prone'; V3.set(this.pos, x, 0, z); this.vx = this.vz = this.vy = 0; this.yaw = Math.PI;
    this.stamina = 1; this.duckT = this.duckCool = this.popT = this.wipeT = this.tumbleT = 0;
    this.lastHit = 0; this.rideWave = null; this.bodyM = null; this.tubeT = 0; this.covered = false; this.inTube = false;
    V3.set(this.up, 0, 1, 0); V3.set(this.nrm, 0, 1, 0);
  },

  speed() { return Math.hypot(this.vx, this.vz); },
  hx() { return Math.sin(this.yaw); }, hz() { return Math.cos(this.yaw); },

  /* where the rider sits relative to the wave in the query */
  zr(q) { return q.wave ? this.pos.z - q.zw : 1e9; },

  step(dt, In) {
    this.duckCool -= dt; this.pumpCool -= dt;
    switch (this.mode) {
      case 'prone': case 'duck': this.stepProne(dt, In); break;
      case 'popup': case 'ride': this.stepRide(dt, In); break;
      case 'air': this.stepAir(dt, In); break;
      case 'wipe': this.stepWipe(dt, In); break;
    }
    this.updatePose(dt, In);
  },

  /* ---------------- paddling, duck diving, catching ---------------- */
  stepProne(dt, In) {
    const P = this.pos, q = Ocean.surface(P.x, P.z, this.mode === 'duck' ? undefined : P.y + 0.2, _Q);
    const ducking = this.mode === 'duck';
    const g2 = q.gx * q.gx + q.gz * q.gz;
    let ax = 0, az = 0;
    if (!ducking) { ax = -SEA.G * q.gx / (1 + g2); az = -SEA.G * q.gz / (1 + g2); }
    // whitewater moves: the turbulent front shoves you toward the beach
    const zr = this.zr(q);
    const front = q.wave ? (zr > -2 && zr < q.zT - q.zw + 2.5 ? 1 : 0.25) : 0;
    let wz = ducking ? 0 : Ocean.orbital(q, q.y);
    // once it has hit you (or you went under it) the bore rolls over rather than carrying you
    const passed = q.wave && q.wave.id === this.lastHit ? 0.3 : 0.95;
    wz = Math.max(wz, SEA.C * smoothstep(0.3, 0.8, q.foam) * front * (ducking ? 0.1 : passed));
    // bore hits you: once per wave
    if (q.wave && q.foam > 0.5 && zr < q.zT - q.zw + 1 && zr > -2 && q.wave.id !== this.lastHit) {
      this.lastHit = q.wave.id;
      if (ducking) Game.onDuckedUnder();
      else { this.tumbleT = 1.0; this.yaw += (Math.random() - 0.5) * 1.6; this.stamina = Math.max(0, this.stamina - 0.12); Game.onWashed(); }
    }
    if (this.tumbleT > 0) { this.tumbleT -= dt; wz = Math.max(wz, SEA.C * 0.75 * this.tumbleT); }
    // the lip pitching on top of you while you lie on the face
    if (!ducking && q.wave && q.lam > 0.2 && q.a < SEA.T_THROW && zr < 1.0 && zr > -1.0 && P.y > 0.45 * q.H) {
      this.wipe('Over the falls!', q); return;
    }
    // paddling
    const hx = this.hx(), hz = this.hz();
    const want = this.tumbleT > 0 ? 0 : In.up;
    this.paddling = damp(this.paddling, want, 8, dt);
    if (want > 0.05) {       // tired arms are slower, never useless
      const tired = 0.6 + 0.4 * smoothstep(0, 0.3, this.stamina);
      const th = 3.3 * want * tired * (ducking ? 0.5 : 1);
      ax += hx * th; az += hz * th;
      this.stamina = Math.max(0, this.stamina - 0.035 * want * dt);
      this.phase += dt * 7.5 * want;
    } else this.stamina = Math.min(1, this.stamina + 0.08 * dt);
    this.stamina = Math.min(1, this.stamina + 0.012 * dt);
    // the wave picks up a committed paddler: on a clean face, nose to the beach, stroking
    const zTr = q.wave ? q.zT - q.zw : 0;
    if (!ducking && want > 0.05 && hz > 0.3 && q.wave && zr > 0 && zr < zTr + 0.5 && q.foamAmt < 0.3 && q.H > 1) {
      az += 2.4 * hz * smoothstep(zTr + 0.5, zTr * 0.6, zr);
    }
    // drawback: in front of a steep face the water runs back out to sea and pulls you onto it
    if (!ducking && q.wave && zr > zTr * 0.7 && zr < zTr + 7 && q.foamAmt < 0.3 && q.H > 1) {
      wz -= SEA.C * 0.35 * smoothstep(zTr + 7, zTr + 1, zr) * smoothstep(0.3, 0.8, q.s);
    }
    // drag relative to the water: a prone board slides along itself more easily
    const rx = this.vx, rz = this.vz - wz;
    const rl = rx * hx + rz * hz, rn = rx * hz - rz * hx;
    const kl = 0.72 + 0.1 * Math.abs(rl), kn = 2.2 + 0.2 * Math.abs(rn);
    ax -= hx * kl * rl + hz * kn * rn; az -= hz * kl * rl - hx * kn * rn;
    this.vx += ax * dt; this.vz += az * dt;
    // the shallows: whitewater dies on the sand
    if (P.z > SEA.SHORE - 6) { this.vz = Math.min(this.vz, 0.5); }
    // pivoting: easy when slow
    const turn = (this.tumbleT > 0 ? 0 : In.steer) * 2.3 / (1 + 0.2 * this.speed());
    this.yaw += turn * dt;
    // a little of your speed follows the nose as you turn
    P.x += this.vx * dt; P.z += this.vz * dt;
    if (ducking) {
      this.duckT -= dt;
      const k = Math.sin(Math.PI * clamp(1 - this.duckT / 1.15, 0, 1));
      P.y = q.y - 1.3 * k;
      if (this.duckT <= 0) { this.mode = 'prone'; this.duckCool = 0.5; }
    } else P.y = q.y;
    this.ydot = (P.y - this.yPrev) / dt; this.yPrev = P.y;
    this.surfNormal(q, dt, 10);

    // the action button: pop up if the wave has you, else duck dive. Facing the beach with
    // a clean wave coming it never ducks: pressing early arms the pop-up, which fires the
    // moment the wave takes you (holding the button keeps it armed)
    const catching = hz > 0.2 && this.cleanWaveBehind(q);
    if (In.actionPressed && catching) this.popArm = 1.2;
    if (In.action && catching) this.popArm = Math.max(this.popArm, 0.1);
    this.popArm -= dt;
    if (!ducking && this.tumbleT <= 0 && (this.popArm > 0 || In.actionPressed) && this.canPop()) { this.popArm = 0; this.popUp(q); }
    else if (In.actionPressed && !this.sitMode && !ducking && !catching && this.tumbleT <= 0 && this.duckCool <= 0 && this.stamina > 0.05) {
      this.mode = 'duck'; this.duckT = 1.15; this.stamina -= 0.04; Game.onDuck();
    }
    // missed: the wave went under you
    this.q = q;
  },

  /* the wave has you: on its face, carried at near wave speed, nose to the beach */
  canPop() {
    const q = this.q;
    if (this.mode !== 'prone' || this.tumbleT > 0 || !q || !q.wave) return false;
    const zr = this.pos.z - q.zw;
    return zr > 0 && zr < q.zT - q.zw + 2 && this.pos.y < 0.95 * q.H && q.gz < -0.08 && this.vz > 0.62 * SEA.C && this.hz() > 0.1 && q.foam < 0.55 && q.foamAmt < 0.3 && q.lam < 0.6 && q.zw < SEA.Z_END - 8;
  },
  /* an unbroken wave close behind you (or already under you) */
  cleanWaveBehind(q) {
    const P = this.pos;
    for (const w of Ocean.waves) {
      const d = P.z - w.zw;
      if (d < -1 || d > (this.sitMode ? 45 : 22)) continue;
      Ocean.stage(w, P.x, this._st || (this._st = {}));
      if (this._st.foamAmt < 0.3 && this._st.H > 1) return w;
    }
    return null;
  },

  popUp(q) {
    this.mode = 'popup'; this.popT = 0.38; this.rideWave = q.wave; this.offWave = 0; this.bogT = 0;
    this.tubeT = 0; this.covered = false; this.turnAcc = 0; this.airT = 0; this.rideT = 0;
    this.lastMove = ''; this.streak = 0;
    // stand up already angled for the open face (away from the peak, where it's breaking)
    const dir = this.shoulderDir(q.wave);
    this.vx = dir * Math.max(3.2, Math.abs(this.vx));
    this.yaw = Math.atan2(this.vx, this.vz);
    const steep = -q.gz;
    Game.onPopUp(steep);
  },

  /* which way along the wave is open: away from the peak */
  shoulderDir(w) { return w ? (Math.sign(this.pos.x - w.xPeak) || 1) : 1; },

  /* ---------------- riding ---------------- */
  stepRide(dt, In) {
    const P = this.pos;
    const q = Ocean.surface(P.x, P.z, P.y + 0.1, _Q);
    const g2 = q.gx * q.gx + q.gz * q.gz;
    let ax = -SEA.G * q.gx / (1 + g2), az = -SEA.G * q.gz / (1 + g2);
    const hx = this.hx(), hz = this.hz();
    const zr = this.zr(q);
    if (this.mode === 'popup') { this.popT -= dt; if (this.popT <= 0) this.mode = 'ride'; }
    const popping = this.mode === 'popup';
    this.rideT += dt;

    // controls: stall/crouch on down, pump on up
    this.stall = damp(this.stall, In.down, 10, dt);
    if (In.up > 0.5 && this.pumpCool <= 0 && !popping && Math.abs(q.gz) > 0.12) { this.pumpT = 0.32; this.pumpCool = 0.6; Game.onPump(); }
    if (this.pumpT > 0) { this.pumpT -= dt; ax += hx * 3.4; az += hz * 3.4; }

    const wz = Math.max(Ocean.orbital(q, q.y), SEA.C * smoothstep(0.35, 0.8, q.foam) * 0.9);
    this.vx += ax * dt; this.vz += az * dt;
    // fins: the board redirects the flow past it (keeping most of the speed)
    // rather than braking it — that's what lets a carve hold speed
    let rx = this.vx, rz = this.vz - wz;
    let rs = Math.hypot(rx, rz), rn = 0, rl = rs;
    if (rs > 0.05) {
      let ang = Math.atan2(rx, rz), d = angDelta(ang, this.yaw);
      const back = Math.abs(d) > Math.PI / 2;
      if (back) d = angDelta(ang, this.yaw + Math.PI);
      const grip = (popping ? 2.5 : 7) * dt, rot = clamp(d, -grip, grip);
      rn = rs * Math.sin(d - rot);                         // what the fins couldn't hold: slip
      ang += rot;
      rs *= (1 - 0.05 * Math.abs(rot)) * Math.exp(-dt * 2.5 * Math.abs(Math.sin(d - rot)));
      const kl = 0.1 + 0.012 * rs + this.stall * (0.6 + 0.04 * rs) + (popping ? 0.3 : 0);
      rs = Math.max(0, rs - kl * rs * dt);
      rl = back ? -rs : rs;
      rx = Math.sin(ang) * rs; rz = Math.cos(ang) * rs;
    }
    this.vx = rx; this.vz = rz + wz;
    const sp = this.speed();
    // steering: a carve; harder with speed
    const rate = (popping ? 0.8 : 1) * In.steer * clamp(3.1 - 0.07 * sp, 1.6, 3.1);
    this.yaw += rate * dt;
    this.lean = damp(this.lean, In.steer * clamp(sp / 7, 0.3, 1), 8, dt);
    P.x += this.vx * dt; P.z += this.vz * dt;
    P.y = q.y;
    this.ydot = (P.y - this.yPrev) / dt; this.yPrev = P.y;
    this.surfNormal(q, dt, 14);
    this.q = q;
    // spray off the rail
    const slip = Math.abs(rn) + Math.abs(In.steer) * sp * 0.25;
    if (slip > 1.2 && Math.random() < dt * 60) {
      const k = Math.min(1, slip / 6), sx = -hz * Math.sign(In.steer || 1), sz = hx * Math.sign(In.steer || 1);
      for (let i = 0; i < 1 + k * 4; i++)
        Fx.emit(P.x - hx * 0.6, P.y + 0.1, P.z - hz * 0.6, sx * (2 + 4 * k) + rnd(-1, 1) + this.vx * 0.5, 2 + 4 * k * Math.random(),
                sz * (2 + 4 * k) + rnd(-1, 1) + this.vz * 0.5, 0.6 + Math.random() * 0.4, 0.09 + 0.08 * k, 1, 1, 1, 0.75, 1.5, 1);
    }

    // ---- scoring: turns, tube, speed ----
    if (!popping) {
      Game.ridePts(sp * dt * 5);
      const frac = q.wave ? clamp((P.y - q.yT) / Math.max(q.H, 0.5), 0, 1.2) : 0;
      if (Math.abs(In.steer) > 0.3 && Math.sign(In.steer) === Math.sign(this.turnAcc || In.steer)) {
        if (this.turnAcc === 0) this.turnFrac = frac;
        this.turnAcc += rate * dt; this.turnIdle = 0; this.turnFrac = Math.max(this.turnFrac, frac);
      } else if (this.turnAcc !== 0) {
        this.turnIdle += dt;
        if (this.turnIdle > 0.12 || Math.sign(In.steer) === -Math.sign(this.turnAcc)) this.endTurn(sp);
      }
    }
    // tube: water over your head, with the lip still throwing
    const covered = q.covered && q.lam > 0.25 && q.a < SEA.T_THROW;
    if (covered) {
      const clear = q.ceil - P.y;
      this.tubeDepth = clamp((q.tipZ - P.z) / 2.5, 0, 1);
      if (clear < 0.75) return this.wipe('Lip to the head', q);
      this.tubeT += dt; this.tubeGap = 0;
      if (!this.inTube) { this.inTube = true; Game.onTubeIn(); }
    } else if (this.inTube) {
      this.tubeGap += dt;
      if (this.tubeGap > 0.25) { this.inTube = false; Game.onTubeOut(this.tubeT); this.tubeT = 0; }
    }
    this.covered = covered;
    this.crouch = damp(this.crouch, Math.max(this.stall, covered ? 1 : 0, 0.3 + 0.25 * Math.abs(In.steer)), 6, dt);

    // ---- endings ----
    if (q.wave && q.foam > 0.55 && zr > -1 && zr < q.zT - q.zw + 3) {
      return this.wipe(this.inTube ? 'The barrel shut on you' : 'Swallowed by the whitewater', q);
    }
    if (this.inTube && q.wave && q.a > SEA.T_THROW + 0.05 && zr < q.tipZ - q.zw) return this.wipe('The barrel shut on you', q);
    if (!q.wave || zr < -1.6) { this.offWave += dt; if (this.offWave > 0.35) return this.endRide(q.wave ? 'Kicked out the back' : 'Lost the wave'); }
    else this.offWave = 0;
    if (q.wave && q.zw > SEA.Z_END) return this.endRide('Rode it to the inside');
    if (!q.wave && Math.abs(rl) < 1.5 && !popping) { this.bogT += dt; if (this.bogT > 0.7) return this.endRide('Bogged down'); } else this.bogT = 0;
    // launch: off the lip with upward speed
    const nearLip = q.wave && zr < 1.0 && P.y > 0.72 * q.H && q.lam < 0.35;
    if (!popping && nearLip && this.ydot > 1.4 && In.actionPressed) {
      this.mode = 'air'; this.vy = this.ydot * 0.85 + 2.4;
      this.airT = 0; this.airSpin = 0; this.flushTurn(sp);
      Game.onAir();
    }
  },

  endTurn(sp) {
    const deg = Math.abs(this.turnAcc) * 180 / Math.PI, f = this.turnFrac;
    this.turnAcc = 0; this.turnIdle = 0;
    if (deg < 55) return;
    let name;
    if (deg >= 150) name = 'Cutback';
    else if (f > 0.66) name = deg > 100 ? 'Re-entry' : 'Snap';
    else if (f < 0.35) name = 'Bottom turn';
    else name = 'Carve';
    const rep = name === this.lastMove;
    this.streak = rep ? this.streak : this.streak + 1; this.lastMove = name;
    let pts = deg * 2.4 * clamp(sp / 7, 0.5, 1.6) * (name === 'Snap' || name === 'Re-entry' ? 1.5 : 1);
    if (rep) pts *= 0.5;
    Game.trick(name, Math.round(pts / 10) * 10);
  },
  flushTurn(sp) { if (this.turnAcc) this.endTurn(sp); },

  /* ---------------- air ---------------- */
  stepAir(dt, In) {
    const P = this.pos;
    this.airT += dt;
    this.vy -= SEA.G * dt;
    P.x += this.vx * dt; P.z += this.vz * dt; P.y += this.vy * dt;
    const spin = In.steer * 6.0 * dt;
    this.yaw += spin; this.airSpin += spin;
    this.crouch = damp(this.crouch, 1, 8, dt);
    const q = Ocean.surface(P.x, P.z, P.y, _Q);
    this.q = q;
    damp3(this.nrm, 0, 1, 0, 3, dt);
    if (P.y <= q.y && this.vy < 0) {
      P.y = q.y;
      const travel = Math.atan2(this.vx, this.vz), off = Math.abs(angDelta(this.yaw, travel));
      const turns = Math.abs(this.airSpin) * 180 / Math.PI;
      if (off > 0.85) return this.wipe('Blew the landing', q);
      const rot = Math.round(turns / 180) * 180;
      const name = rot >= 180 ? 'Air ' + rot : 'Air';
      Game.trick(name, Math.round((350 + this.airT * 500 + rot * 4) / 10) * 10);
      Game.onLand();
      // landing pushes the speed along the board
      const hx = this.hx(), hz = this.hz(), sp = Math.hypot(this.vx, this.vz);
      this.vx = lerp(this.vx, hx * sp, 0.6); this.vz = lerp(this.vz, hz * sp, 0.6);
      this.mode = 'ride'; this.yPrev = P.y; this.offWave = 0;
      for (let i = 0; i < 16; i++) Fx.emit(P.x, P.y, P.z, rnd(-3, 3), rnd(1, 4), rnd(-3, 3), 0.7, 0.14, 1, 1, 1, 0.8);
    }
  },

  /* ---------------- wipeout ---------------- */
  wipe(reason, q) {
    if (this.mode === 'wipe') return;
    const wasRiding = this.mode === 'ride' || this.mode === 'popup' || this.mode === 'air';
    this.mode = 'wipe'; this.wipeT = 2.6; this.inTube = false;
    V3.set(this.tumble, 0, 0, 0); V3.set(this.tumbleV, rnd(-6, 6), rnd(-9, 9), rnd(4, 9));
    if (q && q.wave) this.lastHit = q.wave.id;
    const P = this.pos;
    for (let i = 0; i < 40; i++) Fx.emit(P.x, P.y + 0.3, P.z, rnd(-4, 4), rnd(2, 7), rnd(-2, 6), 1.0, 0.25, 1, 1, 1, 0.8);
    Game.onWipe(reason, wasRiding);
  },
  stepWipe(dt, In) {
    const P = this.pos;
    this.wipeT -= dt;
    if (In.actionPressed) this.wipeT -= 0.22;
    const q = Ocean.surface(P.x, P.z, undefined, _Q);
    // tumbled toward the beach with the whitewater, slowing as it passes
    const push = SEA.C * 0.7 * smoothstep(0.2, 0.7, q.foam);
    this.vx = damp(this.vx, 0, 1.5, dt); this.vz = damp(this.vz, push, 1.5, dt);
    P.x += this.vx * dt; P.z += this.vz * dt;
    P.y = damp(P.y, q.y - (this.wipeT > 0.4 ? 1.3 : 0), 4, dt);
    this.tumble.x += this.tumbleV.x * dt; this.tumble.y += this.tumbleV.y * dt; this.tumble.z += this.tumbleV.z * dt;
    V3.scale(this.tumbleV, this.tumbleV, Math.exp(-0.6 * dt));
    if (Math.random() < dt * 20) Fx.emit(P.x + rnd(-0.5, 0.5), P.y + 0.2, P.z + rnd(-0.5, 0.5), 0, 1.5, 0, 0.8, 0.05, 0.85, 0.95, 1, 0.6, 0.5, -0.4);
    this.q = q;
    if (this.wipeT <= 0) {
      this.mode = 'prone'; this.yaw = Math.PI; this.vx = this.vz = 0; this.bodyM = null; this.tumbleT = 0;
      this.stamina = Math.max(this.stamina, 0.45);
      Game.onSurface();
    }
  },

  endRide(reason) {
    this.flushTurn(this.speed());
    if (this.inTube) { this.inTube = false; Game.onTubeOut(this.tubeT); }
    this.mode = 'prone'; this.vx *= 0.3; this.vz *= 0.3;
    if (this.rideWave) this.lastHit = this.rideWave.id;
    Game.onRideEnd(reason);
  },

  /* ---------------- render frame + pose ---------------- */
  surfNormal(q, dt, k) {
    const l = Math.hypot(q.gx, 1, q.gz);
    damp3(this.nrm, -q.gx / l, 1 / l, -q.gz / l, k, dt);
  },
  updatePose(dt, In) {
    const P = this.pos, u = this.nrm;
    let hx = this.hx(), hz = this.hz();
    // board forward: heading projected onto the deck plane
    let fx = hx, fy = 0, fz = hz;
    const d = fx * u.x + fy * u.y + fz * u.z;
    fx -= u.x * d; fy -= u.y * d; fz -= u.z * d;
    let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
    const U = V3(u.x, u.y, u.z);
    const ride = this.mode === 'ride' || this.mode === 'popup' || this.mode === 'air';
    if (this.mode === 'ride') {     // roll into the carve: rotate up about forward
      const a = -this.lean * 0.5, c = Math.cos(a), s = Math.sin(a);
      const sx = fy * U.z - fz * U.y, sy = fz * U.x - fx * U.z, sz = fx * U.y - fy * U.x;
      V3.set(U, U.x * c + sx * s, U.y * c + sy * s, U.z * c + sz * s);
    }
    if (this.mode === 'air') { fy += clamp(this.vy * 0.06, -0.4, 0.4); l = Math.hypot(fx, fy, fz); fx /= l; fy /= l; fz /= l; }
    if (this.mode === 'duck') { const k = Math.sin(Math.PI * clamp(1 - this.duckT / 1.15, 0, 1)); fy -= 0.35 * k * (this.duckT > 0.57 ? 1 : -1); }
    V3.set(this.fwd, fx, fy, fz); V3.set(this.up, U.x, U.y, U.z);
    V3.set(this.bpos, P.x, P.y + 0.02, P.z);

    const A = this._pa, B = this._pb;
    if (this.mode === 'wipe') {
      this.spread(A);
      poseLerp(this.pose, this.pose, A, 1 - Math.exp(-8 * dt));
      const t = this.tumble;
      this.bodyM = this.bodyM || { X: V3(), Y: V3(), Z: V3(), p: V3() };
      const M = M4(); m4ident(M); rotXYZ(M, t.x, t.y, t.z);
      V3.set(this.bodyM.X, M[0], M[1], M[2]); V3.set(this.bodyM.Y, M[4], M[5], M[6]); V3.set(this.bodyM.Z, M[8], M[9], M[10]);
      V3.set(this.bodyM.p, P.x + 0.6, P.y - 0.3, P.z + 0.4);
      // the board, on its leash, tumbles too
      const bt = t.y * 0.7;
      V3.set(this.fwd, Math.sin(bt), Math.sin(t.x * 0.5) * 0.6, Math.cos(bt)); V3.norm(this.fwd, this.fwd);
      V3.set(this.up, Math.sin(t.z * 0.6) * 0.8, Math.cos(t.z * 0.6), 0.2); V3.norm(this.up, this.up);
      V3.set(this.bpos, P.x - 0.8, Math.max(P.y + 0.6, (this.q.y || 0)) , P.z - 0.5);
      return;
    }
    this.bodyM = null;
    if (ride) {
      this.stand(A, this.crouch, this.lean, this.stall, this.mode === 'air');
      if (this.mode === 'popup') {
        this.prone(B, false, false);
        poseLerp(this.pose, B, A, smoothstep(0.38, 0.0, this.popT));
      } else poseLerp(this.pose, this.pose, A, 1 - Math.exp(-14 * dt));
    } else {
      if (this.sitMode && this.paddling < 0.1 && this.mode === 'prone') this.sit(A);
      else this.prone(A, this.paddling > 0.1, this.mode === 'duck');
      poseLerp(this.pose, this.pose, A, 1 - Math.exp(-16 * dt));
    }
  },

  /* body-local joints: X = to the rider's chest side, Y = up, Z = board nose */
  stand(J, c, l, stall, air) {
    const hy = 0.95 - 0.4 * c;
    set3(J.hip, 0.03 + 0.1 * l, hy, -0.02);
    set3(J.chest, 0.1 + 0.13 * c + 0.16 * l, hy + 0.49 - 0.06 * c, 0.07);
    set3(J.neck, J.chest[0] + 0.04, J.chest[1] + 0.17, J.chest[2] + 0.03);
    set3(J.head, J.chest[0] + 0.07 + 0.04 * c, J.chest[1] + 0.31, J.chest[2] + 0.05);
    set3(J.hairOff, -0.025, 0.04, -0.01);
    set3(J.hp[0], J.hip[0], hy, 0.1); set3(J.hp[1], J.hip[0], hy, -0.12);
    set3(J.ft[0], 0, 0.07, 0.36); set3(J.ft[1], 0, 0.07, -0.34);
    set3(J.kn[0], 0.18 + 0.16 * c, hy * 0.5 + 0.06, 0.33); set3(J.kn[1], 0.15 + 0.14 * c, hy * 0.5 + 0.03, -0.2);
    set3(J.sh[0], J.chest[0], J.chest[1] + 0.1, J.chest[2] + 0.19); set3(J.sh[1], J.chest[0], J.chest[1] + 0.1, J.chest[2] - 0.19);
    if (air) { set3(J.ha[0], 0.24, 0.14, 0.12); set3(J.ha[1], 0.1, hy + 0.5, -0.55); }
    else {
      set3(J.ha[0], 0.22 + 0.1 * l, hy + 0.26, 0.7);
      set3(J.ha[1], lerp(0.12, 0.45, stall), lerp(hy + 0.34, 0.1, stall), lerp(-0.62, -0.3, stall));
    }
    for (const s of [0, 1]) set3(J.el[s], (J.sh[s][0] + J.ha[s][0]) / 2 + 0.1, (J.sh[s][1] + J.ha[s][1]) / 2 - 0.04, (J.sh[s][2] + J.ha[s][2]) / 2);
  },
  /* waiting in the lineup: sat up on the board, legs in the water */
  sit(J) {
    const bob = Math.sin(Ocean.t * 1.7) * 0.02;
    set3(J.hip, 0, 0.14, -0.2); set3(J.chest, 0, 0.62 + bob, -0.14); set3(J.neck, 0, 0.8 + bob, -0.12); set3(J.head, 0, 0.93 + bob, -0.1);
    set3(J.hairOff, 0, 0.04, -0.04);
    for (const s of [0, 1]) {
      const sd = s ? 1 : -1;
      set3(J.hp[s], sd * 0.12, 0.13, -0.18);
      set3(J.kn[s], sd * 0.3, 0.02, 0.1);
      set3(J.ft[s], sd * 0.33, -0.42, 0.02 + 0.06 * Math.sin(Ocean.t * 1.3 + s * 2));
      set3(J.sh[s], sd * 0.2, 0.7 + bob, -0.14);
      set3(J.ha[s], sd * 0.24, 0.18, 0.12);
      set3(J.el[s], sd * 0.3, 0.42, -0.04);
    }
  },
  prone(J, paddling, duck) {
    set3(J.hip, 0, 0.19, -0.22); set3(J.chest, 0, 0.24, 0.3); set3(J.neck, 0, 0.32, 0.48); set3(J.head, 0, 0.42, 0.6);
    set3(J.hairOff, 0, 0.03, -0.04);
    for (const s of [0, 1]) {
      const sd = s ? 1 : -1;
      set3(J.hp[s], sd * 0.11, 0.18, -0.3);
      set3(J.kn[s], sd * 0.13, 0.15, -0.72);
      set3(J.ft[s], sd * 0.12, 0.22 + (duck ? 0.2 : 0), -1.08);
      set3(J.sh[s], sd * 0.2, 0.3, 0.36);
      if (duck) set3(J.ha[s], sd * 0.24, 0.1, 0.66);
      else if (paddling) {
        const f = this.phase + s * Math.PI;
        set3(J.ha[s], sd * 0.33, 0.04 - 0.32 * Math.sin(f), 0.5 + 0.34 * Math.cos(f));
      } else set3(J.ha[s], sd * 0.3, 0.06, 0.15);
      set3(J.el[s], (J.sh[s][0] + J.ha[s][0]) / 2 + sd * 0.1, (J.sh[s][1] + J.ha[s][1]) / 2 + 0.06, (J.sh[s][2] + J.ha[s][2]) / 2);
    }
  },
  spread(J) {
    set3(J.hip, 0, 0, 0); set3(J.chest, 0, 0.5, 0); set3(J.neck, 0, 0.67, 0); set3(J.head, 0, 0.8, 0); set3(J.hairOff, 0, 0.04, -0.03);
    for (const s of [0, 1]) {
      const sd = s ? 1 : -1;
      set3(J.sh[s], sd * 0.2, 0.6, 0); set3(J.el[s], sd * 0.45, 0.75, 0.1); set3(J.ha[s], sd * 0.7, 0.9, 0.15);
      set3(J.hp[s], sd * 0.11, 0, 0); set3(J.kn[s], sd * 0.25, -0.4, 0.1); set3(J.ft[s], sd * 0.3, -0.8, -0.1);
    }
  }
};

function damp3(v, x, y, z, k, dt) {
  const t = 1 - Math.exp(-k * dt);
  v.x += (x - v.x) * t; v.y += (y - v.y) * t; v.z += (z - v.z) * t;
  V3.norm(v, v);
}
/* M = Rx(a)·Ry(b)·Rz(c), written straight into the upper 3x3 */
function rotXYZ(M, a, b, c) {
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  M[0] = cb * cc; M[1] = ca * sc + sa * sb * cc; M[2] = sa * sc - ca * sb * cc;
  M[4] = -cb * sc; M[5] = ca * cc - sa * sb * sc; M[6] = sa * cc + ca * sb * sc;
  M[8] = sb; M[9] = -sa * cb; M[10] = ca * cb;
}
