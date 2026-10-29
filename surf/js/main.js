/* =====================================================================
   main.js — session flow, sets, camera, input, HUD.
   A session: sit in the lineup facing the beach → a set wave comes, you
   stroke into it (automatically) → Space to pop up → ride → back to the
   lineup. Three waves.
   ===================================================================== */
'use strict';

const $ = (id) => document.getElementById(id);
const WAVES = 3;

const Game = {
  state: 'menu',       // menu | play | pause | over
  main: null,          // the set wave you're meant to surf
  boreT: 0, setT: 0, attractT: 0,
  waveIdx: 0, rideScore: 0, total: 0, scores: [], riding: false,
  best: 0, bestTube: 0, topSpeed: 0, bestMove: null, wipes: 0,
  flash: '', flashT: 0, flashCls: '', missedT: 0, endT: 0, bannerT: 0,
  camDir: V3(1, 0, 0), tubeCam: 0, rideDir: 0, flipT: 0, camMode: '', sideSign: 1,
  roar: 0,

  init() {
    try { this.best = +(localStorage.getItem('swellline.best') || 0); } catch (e) { /* private mode */ }
    Ocean.reset();
    Surfer.reset(0, SEA.START_Z);
    this.attract(true);
  },

  start() {
    Sfx.start();
    Ocean.reset();
    this.toLineup(0);
    this.main = null; this.boreT = 0; this.setT = 2; this.waveIdx = 0; this.total = 0; this.scores = [];
    this.rideScore = 0; this.riding = false; this.bestTube = 0; this.topSpeed = 0; this.bestMove = null; this.wipes = 0;
    this.endT = 0; this.missedT = 0; this.respawnT = 0; $('fade').classList.remove('on');
    this.state = 'play'; Look.recenter();
    $('menu').classList.add('hide'); $('over').classList.add('hide'); $('pause').classList.add('hide');
    $('hud').classList.add('on'); $('under').classList.remove('on'); document.body.classList.add('playing');
    this.snapCam();
  },

  /* ---------------- the sea's schedule ---------------- */
  outermost() { let z = Infinity; for (const w of Ocean.waves) z = Math.min(z, w.zw); return z; },
  /* back to the lineup: sat on the board, facing the beach */
  toLineup(x) {
    Surfer.reset(x, SEA.START_Z); Surfer.yaw = 0; Surfer.sitMode = true;
  },
  updateSea(dt) {
    const P = Surfer.pos;
    if (this.main && !Ocean.waves.includes(this.main)) this.main = null;
    // a set wave that rolled through without you
    if (this.main && !this.riding && Surfer.rideWave !== this.main && this.main.zw > P.z + 8) {
      this.main = null; this.missedT = 2.2; this.setT = 2.5;
      if (Math.abs(P.z - SEA.START_Z) > 4) this.respawnT = 1.6;
    }
    if (this.main || this.riding || Surfer.mode !== 'prone' || this.respawnT > 0 || this.endT > 0) return;
    if (Math.abs(P.z - SEA.START_Z) > 4) { this.respawnT = 1.4; return; }   // drifted off: back to the spot
    this.setT -= dt;
    if (this.setT <= 0) {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.main = Ocean.spawn({ zw: Math.min(P.z - 34, this.outermost() - 64), H0: rnd(2.8, 3.4), xPeak: P.x + side * rnd(3, 7), vp: 6.5, main: true });
      this.sideSign = -side;
      this.setT = 3;
    }
  },

  /* menu backdrop: perfect peelers, no rider */
  attract(first) {
    if (first || this.attractT <= 0) {
      Ocean.spawn({ zw: first ? SEA.ZB - 8 : Math.min(SEA.ZB - 64, this.outermost() - 64), H0: 3.1, xPeak: -30, vp: 6.5, main: true, sec: 0.6 });
      this.attractT = 12.3;
    }
  },

  /* ---------------- per frame ---------------- */
  update(dt, In) {
    if (this.state === 'menu' || this.state === 'over') {
      this.attractT -= dt; this.attract(false);
      Ocean.update(dt); Fx.update(dt); this.waveFx(dt, V3(30, 0, -100));
      const t = Ocean.t * 0.05;
      V3.set(Cam.tgt, -6, 0.8, -96 + Math.sin(t) * 3);
      V3.set(Cam.pos, 24 + Math.sin(t * 0.7) * 6, 4.2, -84);
      return;
    }
    if (this.state !== 'play') return;
    Ocean.update(dt);
    this.updateSea(dt);
    if (Surfer.mode === 'prone') {       // in the lineup you only choose when to pop up: the rider strokes in by itself
      const m = this.main, d = m ? Surfer.pos.z - m.zw : 99;
      In = { steer: clamp(-Surfer.yaw * 2, -1, 1), up: d > -1 && d < 15 ? 1 : 0, down: 0, actionPressed: In.actionPressed, action: In.action };
    }
    Surfer.step(dt, In);
    Fx.update(dt);
    this.waveFx(dt, Surfer.pos);
    this.camera(dt);
    this.flashT -= dt; this.missedT -= dt; this.bannerT -= dt;
    if (this.respawnT > 0) {
      this.respawnT -= dt;
      $('fade').classList.toggle('on', this.respawnT < 1.4 && this.respawnT > 0.2);
      if (this.respawnT <= 0.8 && !this.respawned) { this.respawned = true; this.toLineup(Surfer.pos.x); this.snapCam(); }
    } else this.respawned = false;

    if (this.endT > 0) { this.endT -= dt; if (this.endT <= 0 && this.waveIdx >= WAVES) this.over(); }
    if (this.riding || Surfer.mode === 'air') this.topSpeed = Math.max(this.topSpeed, Surfer.speed());
    // sound
    let roar = 0;
    for (const w of Ocean.waves) {
      const st = Ocean._P; Ocean.stage(w, Surfer.pos.x, st);
      const k = Math.max(st.lam > 0.05 ? 0.9 : 0, st.foamAmt) * Math.exp(-Math.abs(Surfer.pos.z - w.zw) / 22);
      roar = Math.max(roar, k);
      if (w.broke && !w.heard) { w.heard = true; Sfx.crash(Math.exp(-Math.abs(Surfer.pos.z - w.zw) / 40)); }
    }
    this.roar = damp(this.roar, roar, 3, dt);
    Sfx.update(this.roar, Surfer.inTube, Surfer.mode === 'wipe' || Surfer.mode === 'duck');
    if (Surfer.mode === 'prone' && Surfer.paddling > 0.3) {
      const ph = Math.floor(Surfer.phase / Math.PI);
      if (ph !== this._stroke) { this._stroke = ph; Sfx.stroke(); }
    }
  },

  /* mist off the lip and the whitewater, near the camera */
  waveFx(dt, near) {
    const st = Ocean._P;
    for (const w of Ocean.waves) {
      if (Math.abs(w.zw - near.z) > 90) continue;
      const n = Math.floor(dt * 70 + Math.random());
      for (let i = 0; i < n; i++) {
        const x = near.x + rnd(-45, 45);
        Ocean.stage(w, x, st);
        if (st.lam > 0.15 && st.a < SEA.T_THROW) {
          Ocean.profile(w, x, st);
          Fx.emit(x, st.tipY + 0.1, st.tipZ, rnd(-0.5, 0.5), rnd(-1, 1.5), SEA.C * 0.8 + rnd(0, 1.5), 0.9, 0.28, 1, 1, 1, 0.35, 0.8, 0.5);
          if (st.a > 0.6 && Math.random() < 0.5)       // the lip landing: a big puff
            Fx.emit(x, st.yT + 0.6, st.tipZ + 0.3, rnd(-1, 1), rnd(2, 6), SEA.C + rnd(-1, 2), 1.4, 0.9, 1, 1, 1, 0.22, 1.2, 0.35);
        } else if (st.foamAmt > 0.5) {
          Fx.emit(x, st.H * 0.7, w.zw + rnd(0, 1.5), rnd(-0.5, 0.5), rnd(0.5, 2.5), SEA.C * 0.9, 1.1, 0.7 + st.H * 0.15, 1, 1, 1, 0.16, 0.6, 0.15);
        } else if (st.a < 0 && st.a > -0.6 && st.s > 0.85 && Math.random() < 0.3) {
          Fx.emit(x, st.H + 0.1, w.zw + 0.2, 0, rnd(0.5, 1.5), SEA.C * 0.6 - 2, 0.7, 0.15, 1, 1, 1, 0.4, 1, 0.3);   // feathering crest
        }
      }
    }
  },

  /* ---------------- camera ---------------- */
  snapCam() { this.camera(1 / 60, true); },
  camera(dt, snap) {
    const S = Surfer, P = S.pos, q = S.q || {};
    const eye = V3(), tgt = V3();
    const ride = S.mode === 'ride' || S.mode === 'popup' || S.mode === 'air';
    this.tubeCam = damp(this.tubeCam, S.covered ? 1 : 0, 2.5, dt);
    // which way along the wave you're going: only flips after a sustained reversal (cutbacks don't swing the camera)
    if (ride) {
      const vxw = S.vx;
      if (!this.rideDir) this.rideDir = Math.sign(vxw) || Math.sign(P.x - (S.rideWave ? S.rideWave.xPeak : 0)) || 1;
      if (Math.sign(vxw) === -this.rideDir && Math.abs(vxw) > 2) { this.flipT += dt; if (this.flipT > 1.2) { this.rideDir = -this.rideDir; this.flipT = 0; } }
      else this.flipT = 0;
    } else { this.rideDir = 0; this.flipT = 0; }
    // an orbit around the rider: (yaw, pitch, distance), damped as angles so a change of
    // view swings around the rider instead of cutting through the wave
    const hx = S.hx(), hz = S.hz(), heading = Math.atan2(hx, hz);
    let yaw, pitch, dist, look = 0, ldx = hx, ldz = hz, k = 2.6;
    if (ride) {
      const d = this.rideDir;
      yaw = Math.atan2(-d * 4.6, 4.2); pitch = 0.3; dist = 6.6; look = 3; ldx = d; ldz = 0; k = 3;
      this.camMode = 'ride';
    } else if (S.mode === 'wipe') {
      yaw = (this.camYaw || 0) + dt * 0.5; pitch = 0.5; dist = 7; k = 6; this.camMode = 'wipe';
    } else {
      // sat in the lineup: from in front, so you watch the set stand up behind you
      yaw = heading + 0.35 * (this.sideSign || 1); pitch = 0.22; dist = 7.5; look = -6;
      this.camMode = 'lineup';
    }
    if (snap || this.camYaw === undefined) { this.camYaw = yaw; this.camPitch = pitch; this.camDist = dist; }
    else {
      this.camYaw += angDelta(this.camYaw, yaw) * (1 - Math.exp(-k * dt));
      this.camPitch = damp(this.camPitch, pitch, 2.5, dt); this.camDist = damp(this.camDist, dist, 2.5, dt);
    }
    this.lookAhead = damp(this.lookAhead || 0, look, 2, dt);
    this.ldx = damp(this.ldx || 0, ldx, 3, dt); this.ldz = damp(this.ldz || 0, ldz, 3, dt);
    // the player's own orbit on top (drag / wheel); drifts back to the auto view when left alone
    const L = Look;
    L.idle += dt;
    if (L.idle > 2.5) { L.yaw = damp(L.yaw, 0, 1.5, dt); L.pitch = damp(L.pitch, 0, 1.5, dt); }
    const free = 1 - this.tubeCam;
    const cyaw = this.camYaw + L.yaw * free, cpit = clamp(this.camPitch + L.pitch * free, 0.04, 1.35);
    const cp = Math.cos(cpit), r = this.camDist * lerp(1, L.zoom, free);
    const ox = Math.sin(cyaw) * cp * r, oy = Math.sin(cpit) * r, oz = Math.cos(cyaw) * cp * r;
    const ty = Math.max(P.y, -0.3) + 0.6;
    V3.set(eye, P.x + ox, ty + oy, P.z + oz);
    V3.set(tgt, P.x + this.ldx * this.lookAhead, ty, P.z + this.ldz * this.lookAhead);
    // the barrel: tuck in behind the rider under the lip (blended in by tubeCam)
    const tc = this.tubeCam;
    if (tc > 0.01 && q.wave) {
      const d = this.rideDir || 1;
      const mid = q.covered && isFinite(q.ceil) ? (q.ceil + q.yT) * 0.5 : P.y + 0.95;
      const ex = P.x - d * 2.6, ey = P.y + clamp(mid - P.y, -0.6, 0.95);
      const ez = this.tubeEyeZ(q.wave, ex, ey, P.z);
      V3.lerp(eye, eye, V3(ex, ey, ez), tc);
      V3.lerp(tgt, tgt, V3(P.x + d * 6, P.y + 0.8, P.z + 0.4), tc);
    }
    if (snap) { V3.set(Cam.pos, eye.x, eye.y, eye.z); V3.set(Cam.tgt, tgt.x, tgt.y, tgt.z); }
    else {    // the orbit is already smooth: follow it tightly so the rider stays framed
      Cam.pos.x = damp(Cam.pos.x, eye.x, 12, dt); Cam.pos.y = damp(Cam.pos.y, eye.y, 8, dt); Cam.pos.z = damp(Cam.pos.z, eye.z, 12, dt);
      Cam.tgt.x = damp(Cam.tgt.x, tgt.x, 14, dt); Cam.tgt.y = damp(Cam.tgt.y, tgt.y, 8, dt); Cam.tgt.z = damp(Cam.tgt.z, tgt.z, 14, dt);
    }
    // stay out of the water (but the tube cam may sit under the lip)
    // (inside the tube the lip is overhead: trust the framing instead)
    if (this.tubeCam < 0.3) {
      const w = Ocean.sheet(Cam.pos.x, Cam.pos.z, undefined, this._cq || (this._cq = {}));
      if (Cam.pos.y < w.y + 0.7) Cam.pos.y = w.y + 0.7;
    }
    Cam.shake = Math.max(0, Cam.shake - dt * 2);
    if (S.inTube) Cam.shake = Math.max(Cam.shake, 0.05);
  },

  /* inside the barrel at column x, height y: between the wall and the falling curtain */
  _tp: null,
  tubeEyeZ(w, x, y, fallback) {
    const P = this._tp || (this._tp = Profile());
    Ocean.profile(w, x, P);
    let wallZ = null;
    for (let k = I_WALL; k < I_FRONT; k++) {
      const y0 = P.y[k], y1 = P.y[k + 1];
      if ((y - y0) * (y - y1) <= 0 && y0 !== y1) { wallZ = P.z[k] + (P.z[k + 1] - P.z[k]) * (y - y0) / (y1 - y0); break; }
    }
    if (wallZ === null) return fallback;
    const room = P.tipZ - wallZ;
    return room > 1.2 ? wallZ + Math.min(0.9, room * 0.4) : wallZ + 0.6;
  },

  /* ---------------- hooks from the surfer ---------------- */
  say(text, cls = '', t = 1.6) { this.flash = text; this.flashCls = cls; this.flashT = t; },
  onDuckedUnder() { this.say('Under it!', 'go', 0.9); },
  onWashed() { Sfx.splash(1); Cam.shake = 0.5; this.say('Caught inside! <small>duck dive (Space) just before the whitewater hits</small>', 'warn', 2.2); },
  onTooEarly() { this.say('Not yet — keep paddling', 'warn', 1); },
  onDuck() { Sfx.splash(0.5); },
  onPopUp(steep) {
    this.riding = true; this.rideScore = 0; Sfx.splash(0.7);
    if (this.main && Surfer.rideWave !== this.main) this.main = Surfer.rideWave;
    if (steep > 0.75) this.trick('Late drop', 300);
    this.say('Up and riding! <small>A / D to trim · S to stall for the barrel · W to pump</small>', 'go', 2.4);
  },
  onPump() { Sfx.stroke(); },
  ridePts(p) { this.rideScore += p; },
  trick(name, pts) {
    this.rideScore += pts;
    if (!this.bestMove || pts > this.bestMove.pts) this.bestMove = { name, pts };
    const el = $('trick');
    $('trickName').textContent = name; $('trickPts').textContent = '+' + pts.toLocaleString();
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  },
  onTubeIn() { Sfx.splash(0.3); },
  onTubeOut(t) {
    if (t < 0.35) return;
    this.bestTube = Math.max(this.bestTube, t);
    this.trick((t > 2.5 ? 'Deep tube ' : 'Tube ride ') + t.toFixed(1) + ' s', Math.round((450 * t + 220 * t * t) / 10) * 10);
  },
  onAir() { Sfx.splash(0.4); },
  onLand() { Sfx.splash(0.8); Cam.shake = 0.15; },
  onWipe(reason, wasRiding) {
    this.wipes++; Sfx.splash(1.3); Cam.shake = 0.7;
    $('underTxt').firstChild.textContent = reason.toUpperCase();
    $('under').classList.add('on');
    if (wasRiding) this.endWave(reason, true);
  },
  onSurface() { $('under').classList.remove('on'); if (this.waveIdx < WAVES || this.riding) this.respawnT = 1.4; },
  onRideEnd(reason) { this.endWave(reason, false); },
  endWave(reason, wiped) {
    if (!this.riding) return;
    this.riding = false;
    const s = Math.round(this.rideScore * (wiped ? 0.5 : 1) / 10) * 10;
    this.scores.push(s); this.total += s; this.waveIdx++;
    this.main = null; this.setT = 6; this.boreT = 3;
    this.banner = (wiped ? reason + ' — half points' : reason) + ': ' + s.toLocaleString();
    if (!wiped && this.waveIdx < WAVES) this.respawnT = 2.6;   // fade back to the lineup for the next one
    this.bannerT = 3.2;
    if (this.waveIdx >= WAVES) this.endT = 3.2;
  },
  over() {
    this.state = 'over';
    const nb = this.total > this.best;
    if (nb) { this.best = this.total; try { localStorage.setItem('swellline.best', String(this.best)); } catch (e) { /* ignore */ } }
    $('sTotal').textContent = this.total.toLocaleString();
    $('sBest').textContent = Math.max(0, ...this.scores).toLocaleString();
    $('sTube').textContent = this.bestTube.toFixed(1) + ' s';
    $('sSpeed').textContent = Math.round(this.topSpeed * 3.6) + ' km/h';
    $('sMove').textContent = this.bestMove ? this.bestMove.name : '—';
    $('sWipes').textContent = this.wipes;
    $('newbest').style.display = nb ? 'block' : 'none';
    $('overHead').textContent = this.total > 6000 ? 'PUMPING' : this.total > 2500 ? 'GOOD SESH' : 'KEEP PADDLING';
    $('over').classList.remove('hide'); $('hud').classList.remove('on'); $('under').classList.remove('on'); document.body.classList.remove('playing');
  },

  /* ---------------- HUD ---------------- */
  prompt() {
    const S = Surfer, P = S.pos, q = S.q || {};
    if (this.bannerT > 0) return [this.banner, 'go'];
    if (this.flashT > 0) return [this.flash, this.flashCls];
    if (S.mode === 'wipe' || S.mode === 'duck' || S.mode === 'air') return ['', ''];
    if (S.mode === 'ride' || S.mode === 'popup') return S.covered ? ['', ''] : ['', ''];
    if (this.missedT > 0) return ['Missed it <small>press Space as the wave lifts you · next one coming</small>', 'warn'];
    if (this.waveIdx >= WAVES || this.respawnT > 0) return ['', ''];
    if (S.canPop()) return ['POP UP! <small>Space</small>', 'go'];
    const m = this.main;
    if (m && m.zw < P.z + 2) {
      const d = P.z - m.zw;
      if (S.popArm > 0) return ['Ready… <small>you\'ll pop up as it takes you</small>', 'go'];
      if (d < 15) return ['Here it comes — Space! <small>press now: you pop up as it lifts you</small>', 'go'];
      return ['Set wave coming… <small>' + Math.round(d) + ' m · get ready to press Space</small>', ''];
    }
    return ['In the lineup <small>a set is on its way</small>', ''];
  },
  hud() {
    const S = Surfer;
    const ride = this.riding || S.mode === 'air';
    $('waveNo').textContent = Math.min(this.waveIdx + 1, WAVES) + ' / ' + WAVES;
    $('waveSub').textContent = ride ? 'riding' : S.mode === 'wipe' ? 'held down' : 'in the lineup';
    $('total').textContent = this.total.toLocaleString();
    $('best').textContent = 'BEST ' + this.best.toLocaleString();
    $('speed').firstChild.textContent = Math.round(S.speed() * 3.6);
    $('waveScore').classList.toggle('on', ride);
    $('wsVal').textContent = Math.round(this.rideScore).toLocaleString();
    $('tube').classList.toggle('on', S.inTube && S.tubeT > 0.2);
    $('tubeT').textContent = S.tubeT.toFixed(1) + ' s';
    const [txt, cls] = this.prompt();
    const el = $('prompt');
    if (el._t !== txt) { el.innerHTML = txt; el._t = txt; }
    el.className = cls;
    this.map();
  },
  map() {
    const c = $('map'), g = c.getContext('2d'), W = c.width, H = c.height, P = Surfer.pos;
    const z0 = -150, z1 = SEA.SHORE + 12, X = 90;
    const sy = (z) => (z - z0) / (z1 - z0) * H, sx = (x) => W / 2 + (x - P.x) / X * (W / 2);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(222,196,150,.75)'; g.fillRect(0, sy(SEA.SHORE), W, H);
    g.fillStyle = 'rgba(95,240,224,.16)'; g.fillRect(0, sy(SEA.LINEUP[0]), W, sy(SEA.LINEUP[1]) - sy(SEA.LINEUP[0]));
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.setLineDash([5, 6]); g.beginPath(); g.moveTo(0, sy(SEA.ZB)); g.lineTo(W, sy(SEA.ZB)); g.stroke(); g.setLineDash([]);
    g.font = '600 15px system-ui'; g.fillStyle = 'rgba(95,240,224,.8)'; g.fillText('LINEUP', 6, sy(SEA.LINEUP[0]) + 16);
    const st = Ocean._P;
    for (const w of Ocean.waves) {
      if (w.zw < z0 || w.zw > z1) continue;
      for (let i = 0; i < W; i += 4) {
        const x = P.x + (i - W / 2) / (W / 2) * X;
        Ocean.stage(w, x, st);
        g.fillStyle = st.foamAmt > 0.4 ? 'rgba(255,255,255,.9)' : st.lam > 0.05 ? '#ffb85c' : w.main ? 'rgba(120,220,255,.9)' : 'rgba(120,200,240,.5)';
        g.fillRect(i, sy(w.zw) - 1.5, 4, 3 + st.H);
      }
    }
    const hx = Surfer.hx(), hz = Surfer.hz(), px = sx(P.x), py = sy(P.z);
    g.strokeStyle = '#ffd36a'; g.lineWidth = 3; g.beginPath(); g.moveTo(px, py); g.lineTo(px + hx * 14, py + hz * 14); g.stroke();
    g.fillStyle = '#ffd36a'; g.beginPath(); g.arc(px, py, 5, 0, TAU); g.fill();
  }
};

/* ---------------- camera look (player-controlled orbit offset) ---------------- */
const Look = {
  yaw: 0, pitch: 0, zoom: 1, idle: 99, id: null, x: 0, y: 0,
  drag(dx, dy) { this.yaw -= dx * 0.008; this.pitch = clamp(this.pitch + dy * 0.006, -0.6, 1.1); this.idle = 0; },
  wheel(d) { this.zoom = clamp(this.zoom * Math.exp(d * 0.0012), 0.45, 3); this.idle = 0; },
  recenter() { this.yaw = 0; this.pitch = 0; this.zoom = 1; this.idle = 99; }
};
(function lookSetup() {
  const c = $('gl');
  c.addEventListener('pointerdown', (e) => {
    if (Game.state !== 'play' || Look.id !== null) return;
    Look.id = e.pointerId; Look.x = e.clientX; Look.y = e.clientY; c.setPointerCapture(e.pointerId);
  });
  c.addEventListener('pointermove', (e) => {
    if (e.pointerId !== Look.id) return;
    Look.drag(e.clientX - Look.x, e.clientY - Look.y); Look.x = e.clientX; Look.y = e.clientY;
  });
  const end = (e) => { if (e.pointerId === Look.id) Look.id = null; };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('wheel', (e) => { if (Game.state === 'play') { e.preventDefault(); Look.wheel(e.deltaY); } }, { passive: false });
})();

/* ---------------- input ---------------- */
const Input = {
  keys: new Set(), act: false, touch: { on: false, x: 0, y: 0, id: null, ox: 0, oy: 0 }, btn: false,
  read() {
    const k = this.keys, t = this.touch;
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let up = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0, down = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    if (t.on) {
      const dx = clamp(t.x / 52, -1, 1), dy = clamp(t.y / 52, -1, 1);
      steer = Math.abs(dx) > 0.15 ? dx : 0; up = Math.max(0, -dy) > 0.25 ? Math.min(1, -dy * 1.3) : 0; down = dy > 0.3 ? dy : 0;
    }
    const In = { steer, up, down, actionPressed: this.act, action: k.has('Space') || this.btn };
    this.act = false;
    return In;
  }
};
// steering sign: the camera looks along the board, so "right" on the keys turns the board to screen-right
function steerSign() { return -1; }

addEventListener('keydown', (e) => {
  if (e.repeat && e.code === 'Space') { e.preventDefault(); return; }
  Input.keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  Sfx.start();
  if (Game.state === 'menu') { Game.start(); return; }
  if (Game.state === 'over') { if (e.code === 'KeyR' || e.code === 'Space' || e.code === 'Enter') Game.start(); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
  if (e.code === 'KeyR') { Game.start(); return; }
  if (e.code === 'KeyM') { Sfx.toggle(); return; }
  if (e.code === 'KeyC') { Look.recenter(); return; }
  if (e.code === 'Space') Input.act = true;
});
addEventListener('keyup', (e) => Input.keys.delete(e.code));
addEventListener('blur', () => Input.keys.clear());
function togglePause() {
  if (Game.state === 'play') { Game.state = 'pause'; $('pause').classList.remove('hide'); }
  else if (Game.state === 'pause') { Game.state = 'play'; $('pause').classList.add('hide'); }
}

(function touchSetup() {
  const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');
  const zone = $('stickZone'), stick = $('stick'), knob = $('knob'), t = Input.touch;
  zone.addEventListener('pointerdown', (e) => {
    t.on = true; t.id = e.pointerId; t.ox = e.clientX; t.oy = e.clientY; t.x = t.y = 0;
    stick.style.display = 'block'; stick.style.left = e.clientX + 'px'; stick.style.top = (e.clientY - zone.getBoundingClientRect().top) + 'px';
    knob.style.transform = ''; zone.setPointerCapture(e.pointerId);
  });
  zone.addEventListener('pointermove', (e) => {
    if (!t.on || e.pointerId !== t.id) return;
    t.x = clamp(e.clientX - t.ox, -60, 60); t.y = clamp(e.clientY - t.oy, -60, 60);
    knob.style.transform = `translate(${t.x}px,${t.y}px)`;
  });
  const end = (e) => { if (e.pointerId !== t.id) return; t.on = false; stick.style.display = 'none'; };
  zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  const b = $('actBtn');
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); Input.act = true; Input.btn = true; b.classList.add('down'); });
  const up = () => { Input.btn = false; b.classList.remove('down'); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  $('pauseBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); togglePause(); });
  for (const id of ['menu', 'over', 'pause']) $(id).addEventListener('pointerdown', () => {
    Sfx.start();
    if (Game.state === 'menu' || Game.state === 'over') Game.start();
    else if (Game.state === 'pause') togglePause();
  });
})();

/* ---------------- loop ---------------- */
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min((now - last) / 1000, 0.1); last = now;
  const In = Input.read();
  In.steer *= steerSign();
  if (Game.manual) return;           // a test harness is stepping and drawing
  // fixed steps keep the physics identical at any frame rate
  while (dt > 1e-4) { const h = Math.min(dt, 1 / 60); Game.update(h, In); In.actionPressed = false; dt -= h; }
  Gfx.frame(Game.state === 'menu' || Game.state === 'over' ? null : Surfer);
  if (Game.state === 'play') Game.hud();
}
try {
  Gfx.init($('gl'));
  Game.init();
  requestAnimationFrame(frame);
} catch (err) {
  const f = $('fatal'); f.style.display = 'block'; f.textContent = 'Could not start: ' + (err && err.message || err);
  console.error(err);
}
addEventListener('error', (e) => { const f = $('fatal'); f.style.display = 'block'; f.textContent += '\n' + e.message; });
