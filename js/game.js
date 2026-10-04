/* =====================================================================
   game.js — state machine, input, scoring, HUD, main loop.
   ===================================================================== */
'use strict';

/* tiny DOM helper (used everywhere) */
const $ = (id) => document.getElementById(id);

/* ---------------- compat shim for earlier modules ---------------- */
/* particles need camera axes; supply them when called bare */
const _pDraw = Particles.prototype.draw;
Particles.prototype.draw = function () {
  if (arguments.length === 0) {
    const v = Cam.view;
    _pDraw.call(this, V3(v[0], v[4], v[8]), V3(v[1], v[5], v[9]));
  } else _pDraw.apply(this, arguments);
};

/* ---------------- input ---------------- */
const Input = {
  down: {}, steer: 0, jumpEdge: false, grab: null,
  tuck: false, brake: false, anyKey: false,

  init() {
    const keyMap = {
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
      KeyS: 'brake', ArrowDown: 'brake', KeyW: 'tuck', ArrowUp: 'tuck',
      Space: 'jump', KeyR: 'restart', KeyP: 'pause', KeyM: 'mute',
      Backquote: 'debug', KeyJ: 'Indy', KeyK: 'method', KeyL: 'mutegrab', Semicolon: 'stale'
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
      // Safari requires an AudioContext to be created/resumed inside the
      // user-gesture call stack — doing it from the rAF loop is blocked.
      Audio.init(); Audio.resume();
      const LV = { Digit1: 'mountain', Digit2: 'pipe', Digit3: 'park', Numpad1: 'mountain', Numpad2: 'pipe', Numpad3: 'park' };
      if (LV[e.code] && (Game.state === 'menu' || Game.state === 'over')) {
        Game.selectLevel(LV[e.code]);
        if (Game.state === 'over') Game.restart();
        return;
      }
      if (e.code === 'Escape' && (Game.state === 'over' || Game.state === 'pause')) { Game.toMenu(); return; }
      this.anyKey = true;
      const k = keyMap[e.code];
      if (!k) return;
      if (!this.down[k]) { if (k === 'jump') this.jumpEdge = true; this.onPress(k); }
      this.down[k] = true;
    });
    window.addEventListener('keyup', (e) => { const k = keyMap[e.code]; if (k) this.down[k] = false; });
    window.addEventListener('blur', () => { this.down = {}; Cam.dragging = false; });

    // camera: hold right or middle mouse button and drag to orbit; wheel zooms
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 1 && e.button !== 2) return;
      e.preventDefault();                       // no middle-click autoscroll
      Cam.dragging = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 1 && e.button !== 2) return;
      Cam.dragging = false; Cam.releaseT = 1.0;
    });
    window.addEventListener('mousemove', (e) => {
      if (!Cam.dragging) return;
      if (!(e.buttons & 6)) { Cam.dragging = false; Cam.releaseT = 1.0; return; }   // released off-window
      Cam.drag(e.movementX || 0, e.movementY || 0);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      e.preventDefault();
      Cam.zoom = clamp(Cam.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 2.2);
    }, { passive: false });

    // pointer: any click drops in, like the old arcade cabinets
    const screen = $('menu');
    if (screen) screen.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;               // right/middle = camera, not "start"
      if (e.target && e.target.closest && e.target.closest('a')) return;
      Audio.init(); Audio.resume();   // user gesture: safe to start audio here
      this.anyKey = true;
    });
    $('over').addEventListener('pointerdown', (e) => { if (e.button === 0 && Game.state === 'over') Game.restart(true); });
    // fallback: some touch stacks deliver only a synthesized click for a quick tap
    $('menu').addEventListener('click', () => { if (Game.state === 'menu') { Audio.init(); Audio.resume(); this.anyKey = true; } });
    $('over').addEventListener('click', () => { if (Game.state === 'over') Game.restart(true); });
    $('pause').addEventListener('pointerdown', (e) => { if (e.button === 0) Game.togglePause(); });

    this.initTouch();
    for (const b of document.querySelectorAll('.lvl')) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation(); Audio.init(); Audio.resume();
        Game.selectLevel(b.dataset.id); this.anyKey = true;          // tap a card = ride it
      });
    }
    const lb = $('toLevels');
    lb.addEventListener('pointerdown', (e) => e.stopPropagation());
    lb.addEventListener('click', (e) => { e.stopPropagation(); Game.toMenu(); });
    const mb = $('muteBtn');
    mb.addEventListener('pointerdown', (e) => e.stopPropagation());   // don't start a run from the menu
    mb.addEventListener('click', (e) => { e.stopPropagation(); Audio.init(); Audio.resume(); Game.toggleMute(); mb.blur(); });
  },

  /* ---------------- touch: steering pad, buttons, swipe camera, tilt ---------------- */
  touchSteer: null,     // analog -1..1 while a thumb is on the steering pad
  tiltSteer: null,      // analog -1..1 from the gyro when tilt steering is on
  tiltOn: false,

  enableTouchUI() {
    if (document.body.classList.contains('touch')) return;
    document.body.classList.add('touch');
  },

  initTouch() {
    const coarse = window.matchMedia && matchMedia('(pointer:coarse)').matches;
    if (coarse || (navigator.maxTouchPoints > 0 && !matchMedia('(hover:hover)').matches)) this.enableTouchUI();
    // a real touch anywhere also switches the UI over (e.g. touchscreen laptops)
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.enableTouchUI(); }, true);
    // iOS only unlocks Web Audio from touchend/click
    window.addEventListener('touchend', () => { Audio.init(); Audio.resume(); }, { passive: true });

    // buttons: hold-to-act, multi-touch safe (each button captures its own finger)
    const hold = (id, k) => {
      const el = $(id); if (!el) return;
      const on = (e) => {
        e.preventDefault(); e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch (_) { }
        if (!this.down[k] && k === 'jump') this.jumpEdge = true;
        this.down[k] = true; el.classList.add('held');
      };
      const off = () => { this.down[k] = false; el.classList.remove('held'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
    };
    hold('tJ', 'jump'); hold('tT', 'tuck'); hold('tB', 'brake'); hold('tG', 'Indy');
    $('tP').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Game.togglePause(); });

    // steering pad: horizontal thumb offset from the centre = analog steer
    const pad = $('steerPad'), knob = $('steerKnob');
    let padId = null;
    const steerAt = (e) => {
      const r = pad.getBoundingClientRect();
      const half = Math.max(30, r.width / 2 - 26);
      let v = clamp((e.clientX - (r.left + r.width / 2)) / half, -1, 1);
      knob.style.transform = 'translateX(' + (v * half).toFixed(0) + 'px)';
      if (Math.abs(v) < 0.08) v = 0;                       // small dead zone
      this.touchSteer = v;
    };
    const release = () => { padId = null; this.touchSteer = null; knob.style.transform = ''; };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { pad.setPointerCapture(e.pointerId); } catch (_) { }
      padId = e.pointerId; steerAt(e);
    });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === padId) steerAt(e); });
    pad.addEventListener('pointerup', release); pad.addEventListener('pointercancel', release);
    pad.addEventListener('lostpointercapture', release);

    // one-finger swipe on open screen orbits the camera (same spring-back as the mouse)
    const canvas = $('gl');
    let camId = null, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || camId !== null) return;
      camId = e.pointerId; lx = e.clientX; ly = e.clientY; Cam.dragging = true;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerId !== camId) return;
      Cam.drag((e.clientX - lx) * 1.5, (e.clientY - ly) * 1.5);
      lx = e.clientX; ly = e.clientY;
    });
    const camUp = (e) => { if (e.pointerId === camId) { camId = null; Cam.dragging = false; Cam.releaseT = 1.0; } };
    window.addEventListener('pointerup', camUp); window.addEventListener('pointercancel', camUp);

    // tilt steering toggle (menu). iOS needs requestPermission() inside the tap.
    const tb = $('tiltBtn');
    if (tb) {
      const label = () => { tb.textContent = 'Tilt steering: ' + (this.tiltOn ? 'ON' : 'OFF'); tb.classList.toggle('on', this.tiltOn); };
      tb.addEventListener('pointerdown', (e) => e.stopPropagation());   // don't also start the run
      tb.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (this.tiltOn) { this.tiltOn = false; this.tiltSteer = null; label(); return; }
        try {
          const DOE = window.DeviceOrientationEvent;
          if (DOE && typeof DOE.requestPermission === 'function') {
            if (await DOE.requestPermission() !== 'granted') { tb.textContent = 'Tilt: permission denied'; return; }
          }
        } catch (err) { tb.textContent = 'Tilt needs an https:// page'; return; }
        this.tiltOn = true; label();
        if (!this._tiltBound) { this._tiltBound = true; window.addEventListener('deviceorientation', (ev) => this.onTilt(ev)); }
        setTimeout(() => { if (this.tiltOn && this.tiltSteer === null) tb.textContent = 'Tilt: no sensor data (needs https)'; }, 1500);
      });
      label();
    }
  },

  /* Steering-wheel tilt: project "world up" into the screen plane and steer by its
     angle, so it works no matter how far back the phone is tilted or which way
     round it is held. Uses deviceorientation beta/gamma (W3C device frame). */
  onTilt(ev) {
    if (!this.tiltOn || ev.beta === null || ev.gamma === null) return;
    const b = ev.beta * Math.PI / 180, g = ev.gamma * Math.PI / 180;
    const ux = -Math.sin(g) * Math.cos(b), uy = Math.sin(b);          // world-up in device x/y
    const ang = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
    const sx = ux * Math.cos(ang) - uy * Math.sin(ang);               // ...in screen x/y
    const sy = ux * Math.sin(ang) + uy * Math.cos(ang);
    if (Math.hypot(sx, sy) < 0.2) return;                              // phone nearly flat: hold last value
    let a = -Math.atan2(sx, sy) * 180 / Math.PI;                       // + = rotated clockwise = steer right
    a = Math.abs(a) < 3 ? 0 : a - Math.sign(a) * 3;                    // 3° dead zone
    this.tiltSteer = clamp(a / 25, -1, 1);                             // full lock at ~28°
  },

  onPress(k) {
    if (k === 'restart') { if (Game.state === 'play' || Game.state === 'over') Game.restart(true); }
    else if (k === 'pause') Game.togglePause();
    else if (k === 'mute') Game.toggleMute();
    else if (k === 'debug') $('debug').classList.toggle('on');
  },

  sample(dt) {
    let target = (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0);
    if (this.touchSteer !== null) target = this.touchSteer;          // thumb on the pad wins
    else if (target === 0 && this.tiltOn && this.tiltSteer !== null) target = this.tiltSteer;
    this.steer = damp(this.steer, target, 11, dt);
    this.brake = !!this.down.brake;
    this.tuck = !!this.down.tuck;
    this.grab = this.down.method ? 'method' : this.down.Indy ? 'Indy'
      : this.down.stale ? 'stale' : this.down.mutegrab ? 'mute' : null;
    const j = this.jumpEdge; this.jumpEdge = false;
    return { steer: this.steer, brake: this.brake, tuck: this.tuck, jump: j, grab: this.grab };
  }
};

/* ---------------- game ---------------- */
const Game = {
  state: 'menu',                 // menu | play | pause | over
  P: null, fx: null,
  score: 0, distance: 0, best: 0,
  topSpeed: 0, totalAir: 0, lands: 0, bestHit: 0,
  lives: 3, combo: 1, comboTimer: 0,
  flash: 0, desat: 0, hintTimer: 14,
  air: { t: 0, spin: 0, flip: 0, grab: null, grabT: 0 },
  lastZ: 0, startY: 0, t: 0, frames: 0, fps: 60, _fpsT: 0, _mt: 0,
  frameNo: 0,                    // monotonic; never reset (chunk cache ages on it)

  boot() {
    this.P = new Player();
    this.fx = new Particles();
    try { if (localStorage.getItem('powderline.muted') === '1') Audio.setMuted(true); } catch (e) { }
    $('muteBtn').classList.toggle('muted', Audio.muted);
    this.buildLives();
    Sun.init();
    let lv = 'mountain';
    try { lv = localStorage.getItem('powderline.level') || 'mountain'; } catch (e) { }
    this.selectLevel(Level.defs[lv] ? lv : 'mountain', true);
    this.startY = this.P.pos.y;
    this.lastZ = this.P.pos.z;
  },

  /* ---------------- levels ---------------- */
  spawnZ() { return Level.cur.spawnZ || 0; },

  selectLevel(id, force) {
    const def = Level.defs[id]; if (!def) return;
    const changed = force || Level.cur !== def;
    Level.cur = def;
    try { localStorage.setItem('powderline.level', id); } catch (e) { }
    for (const b of document.querySelectorAll('.lvl')) b.classList.toggle('sel', b.dataset.id === id);
    if (changed) {
      const lod = def.lod || [40, 20, 10];
      for (let i = 0; i < LODS.length; i++) LODS[i].res = lod[i];
      World.reset(); Gates.reset(); Scenery.reset();
      const old = GL.mesh._levelDecor;
      if (old) { GL.gl.deleteVertexArray(old.vao); GL.gl.deleteBuffer(old.vb); GL.gl.deleteBuffer(old.ib); delete GL.mesh._levelDecor; }
      if (def.decor) GL.upload('_levelDecor', def.decor());
      this.P.reset(centerX(this.spawnZ()), this.spawnZ(), Level.cur.spawnSpeed);
      World.prewarm(this.P.pos.x, this.P.pos.z);
      World.update(this.P.pos.x, this.P.pos.z);
      Cam.snap(this.P);
    }
    this.loadBest();
  },

  bestKey() { return Level.cur.id === 'mountain' ? 'powderline.best' : 'powderline.best.' + Level.cur.id; },
  loadBest() {
    let saved = 0;
    try { saved = +(localStorage.getItem(this.bestKey()) || 0); } catch (e) { saved = 0; }
    this.best = isFinite(saved) ? saved : 0;
    $('best').textContent = 'BEST ' + this.best.toLocaleString();
  },

  toMenu() {
    this.state = 'menu'; this._deadTimer = 0;
    $('over').classList.add('hide'); $('pause').classList.add('hide'); $('menu').classList.remove('hide');
    $('hud').classList.remove('on');
    document.body.classList.remove('playing');
    this.P.reset(centerX(this.spawnZ()), this.spawnZ(), Level.cur.spawnSpeed);
    Cam.snap(this.P); Scenery.reset();
  },

  onGrind(t, ang) {
    if (t < 0.25) return;
    const pts = Math.round((60 + t * 240) * this.combo);
    this.score += pts;
    this.bestHit = Math.max(this.bestHit, pts);
    this.combo = Math.min(this.combo + 1, 12); this.comboTimer = 5.5;
    Audio.trick(1);
    this.showTrick(ang > 0.9 ? 'Boardslide' : '50-50 Grind', pts);
  },

  buildLives() {
    const el = $('lives'); el.innerHTML = '';
    for (let i = 0; i < 3; i++) { const d = document.createElement('i'); d.className = 'life'; el.appendChild(d); }
  },
  setLives(n) {
    this.lives = n;
    const kids = $('lives').children;
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('off', i >= n);
  },

  start() {
    Audio.init(); Audio.resume();
    $('menu').classList.add('hide');
    this.restart(true);
    Input.jumpEdge = false;           // the key that dropped us in is not an ollie
    Audio.dropIn();
  },

  restart() {
    this.score = 0; this.distance = 0; this.topSpeed = 0; this.totalAir = 0;
    this.lands = 0; this.bestHit = 0; this.combo = 1; this.comboTimer = 0;
    this.flash = 0; this.desat = 0; this.hintTimer = 14;
    this._deadTimer = 0;              // cancel any pending game-over countdown
    this.setLives(3);
    Gates.reset();
    this.fx.clear();
    this.P.reset(centerX(this.spawnZ()), this.spawnZ(), Level.cur.spawnSpeed);
    this.startY = this.P.pos.y;
    this.lastZ = this.P.pos.z;
    // the menu drift may have streamed the near field far away from z=0
    World.prewarm(this.P.pos.x, this.P.pos.z);
    World.update(this.P.pos.x, this.P.pos.z);
    Cam.snap(this.P);
    Scenery.reset();
    $('over').classList.add('hide'); $('pause').classList.add('hide');
    $('hud').classList.add('on'); $('hint').classList.remove('gone');
    this.state = 'play';
    document.body.classList.add('playing');
    Audio.resume();
  },

  toggleMute() {
    Audio.setMuted(!Audio.muted);
    if (!Audio.muted) Audio.ui(700);
    $('muteBtn').classList.toggle('muted', Audio.muted);
    $('muteBtn').setAttribute('aria-label', Audio.muted ? 'Unmute' : 'Mute');
    try { localStorage.setItem('powderline.muted', Audio.muted ? '1' : '0'); } catch (e) { }
  },

  togglePause() {
    if (this.state === 'play') { this.state = 'pause'; $('pause').classList.remove('hide'); document.body.classList.remove('playing'); }
    else if (this.state === 'pause') { this.state = 'play'; $('pause').classList.add('hide'); document.body.classList.add('playing'); Audio.resume(); }
  },

  /* ---------------- callbacks from player.js ---------------- */
  onCrash() {
    this.combo = 1; this.comboTimer = 0;
    this.flash = 0.45; this.desat = 1;
    this.setLives(Math.max(0, this.lives - 1));
    this.msg('WIPEOUT', 1200);
    if (this.lives <= 0) this._deadTimer = 1.1;
  },
  recover() { this.desat = 0; },
  onPump() { this.score += 15 * this.combo; },

  gameOver(finished) {
    this.state = 'over';
    $('overTitle').textContent = (finished ? 'Run complete · ' : 'Run over · ') + Level.cur.name;
    $('overHead').textContent = finished ? 'NICE RUN' : 'RUN DOWN';
    document.body.classList.remove('playing');
    Audio.gameover();
    const s = Math.round(this.score);
    $('sDist').textContent = Math.round(this.distance) + ' m';
    $('sScore').textContent = s.toLocaleString();
    $('sSpeed').textContent = Math.round(this.topSpeed * 3.6) + ' km/h';
    $('sTrick').textContent = Math.round(this.bestHit).toLocaleString();
    $('sAir').textContent = this.totalAir.toFixed(1) + ' s';
    $('sLands').textContent = this.lands;
    if (s > this.best) {
      this.best = s;
      try { localStorage.setItem(this.bestKey(), String(s)); } catch (e) { }
      $('newbest').style.display = 'block';
    } else $('newbest').style.display = 'none';
    $('best').textContent = 'BEST ' + this.best.toLocaleString();
    $('over').classList.remove('hide');
    $('hud').classList.remove('on');
  },

  /* ---------------- tricks ---------------- */
  evalTrick() {
    const a = this.air;
    const rot = Math.floor(Math.abs(a.spin) / Math.PI + 0.18);
    const flips = Math.floor(Math.abs(a.flip) / (Math.PI * 2) + 0.12);
    const heldGrab = a.grab && a.grabT > Math.max(0.25, a.t * 0.45);
    if (rot < 1 && flips < 1 && a.t < (Level.cur.airMin || 1.25)) return;

    const names = ['180', '360', '540', '720', '900', '1080', '1260', '1440'];
    let name = rot > 0
      ? (a.spin > 0 ? 'Frontside ' : 'Backside ') + (names[clamp(rot - 1, 0, names.length - 1)] || (rot * 180))
      : (a.label || 'Big Air');
    if (flips > 0) {
      const flipName = (['', '', 'Double ', 'Triple '][flips] || flips + '× ') + (a.flip > 0 ? 'Backflip' : 'Frontflip');
      name = rot > 0 ? name + ' ' + flipName : flipName;
    }
    if (heldGrab) name = { Indy: 'Indy ', method: 'Method ', stale: 'Stalefish ', mute: 'Mute ' }[a.grab] + name;

    let pts = rot * 130 + a.t * 95 + flips * 260;
    if (heldGrab) pts *= 1.4;
    pts = Math.round(pts * this.combo);

    this.score += pts;
    this.bestHit = Math.max(this.bestHit, pts);
    this.combo = Math.min(this.combo + 1, 12);
    this.comboTimer = 5.5;
    this.flash = Math.min(0.3, pts / 5000);
    Audio.trick(rot); if (this.combo > 2) Audio.combo(this.combo);
    this.showTrick(name, pts);
  },

  showTrick(name, pts) {
    const el = $('trick');
    $('trickName').textContent = name;
    $('trickPts').textContent = '+' + pts.toLocaleString();
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  },

  msg(text, ms) {
    const el = $('msg'); el.textContent = text; el.classList.add('on');
    clearTimeout(this._mt); this._mt = setTimeout(() => el.classList.remove('on'), ms || 1100);
  },

  /* ---------------- gates ---------------- */
  /* ---------------- trees + rocks are solid ---------------- */
  _nearT: [], _nearR: [],
  collide() {
    const P = this.P;
    if (P.crashTimer > 0 || P.invuln > 0) return;
    World.propsNear(P.pos.x, P.pos.z, 6, this._nearT, this._nearR);
    for (const t of this._nearT) {
      if (P.pos.y > t.y + 3.6 * t.sc) continue;               // sailed over it
      if (Math.hypot(t.x - P.pos.x, t.z - P.pos.z) < 0.6 * t.sc) { this.hit(t, 0.6 * t.sc); return; }
    }
    for (const r of this._nearR) {
      if (P.pos.y > r.y + 0.45 * r.sc) continue;
      if (Math.hypot(r.x - P.pos.x, r.z - P.pos.z) < 0.75 * r.sc) { this.hit(r, 0.75 * r.sc); return; }
    }
  },

  /* bounce off the obstacle (so we don't recover inside it), then wipe out */
  hit(o, rad) {
    const P = this.P;
    let dx = P.pos.x - o.x, dz = P.pos.z - o.z;
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    P.pos.x = o.x + dx * (rad + 0.3); P.pos.z = o.z + dz * (rad + 0.3);
    const sp = Math.max(3, P.speed * 0.35);
    P.vel.x = dx * sp; P.vel.z = dz * sp;
    P.crash(this.fx);
  },

  checkGates() {
    const g = Gates.upcoming(); if (!g) return;
    const p = this.P.pos;
    if (p.z > g.z) {
      const inside = Math.abs(p.x - g.x) < g.w * 0.5 + 1.2;
      if (inside) {
        g.hit = true;
        const pts = 250 * this.combo;
        this.score += pts; this.combo = Math.min(this.combo + 1, 12); this.comboTimer = 5.5;
        this.fx.gateBurst(g.x, heightAt(g.x, g.z), g.z, [1.0, 1.35, 1.15]);
        Audio.gate();
        this.showTrick('GATE', pts);
      } else {
        g.missed = true; this.combo = 1; this.comboTimer = 0;
        this.msg('GATE MISSED'); Audio.miss();
      }
    }
  },

  /* ---------------- per-frame ---------------- */
  update(dt, inp) {
    const P = this.P;
    const wasAir = P.airborne;
    if (wasAir) {
      this.air.t = P.airTime; this.air.spin = P.spin;
      this.air.flip = P.flip; this.air.grab = P.grab; this.air.label = P.airLabel;
      if (this.air.grab && P.grabTime > 0) this.air.grabT = P.grabTime;
    }

    P.step(dt, inp, this.fx);
    this.collide();
    Scenery.update(dt, P);
    this.fx.spray(P, dt);
    this.fx.powder(P, dt);
    this.fx.update(dt);

    if (!wasAir && P.airborne) { this.air.t = 0; this.air.grabT = 0; }
    if (wasAir && !P.airborne) {
      this.totalAir += this.air.t;
      if (P.landedClean) { this.lands++; this.evalTrick(); }
      this.air.grabT = 0;
    }

    World.update(P.pos.x, P.pos.z);
    // built courses end at a finish line
    if (Level.cur.finishZ && P.pos.z > Level.cur.finishZ && !(this._deadTimer > 0)) {
      this.score += 500; this.gameOver(true); return;
    }
    Gates.ensure(P.pos.z + 400);
    Gates.trim(P.pos.z);
    this.checkGates();

    const dz = P.pos.z - this.lastZ;
    if (dz > 0) { this.distance += dz; this.score += dz * 0.6; }
    this.lastZ = P.pos.z;
    this.topSpeed = Math.max(this.topSpeed, P.speed);
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 1; }
    this.flash = damp(this.flash, 0, 4, dt);
    this.desat = damp(this.desat, 0, 2.2, dt);
    if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) $('hint').classList.add('gone'); }

    if (this._deadTimer > 0) { this._deadTimer -= dt; if (this._deadTimer <= 0) this.gameOver(); }
  },

  render() {
    const P = this.P;
    P.buildPose();
    Sun.update(P.pos.x, P.pos.y, P.pos.z);
    Render.shadows(P);
    Render.scene(P, this.fx, this.state);
    Render.post(clamp(P.speed / 26, 0, 1), this.flash, this.desat);
    Render.reapChunks(this.frameNo);
  },

  /* project the next gate's banner onto the screen; pin to the edge if off-screen */
  gateMarker() {
    const el = $('gateMark'), g = Gates.upcoming(), P = this.P;
    const dz = g ? g.z - P.pos.z : -1;
    if (!g || dz < 4 || dz > 260) { el.classList.remove('on'); return; }
    const y = heightAt(g.x, g.z) + 6.4, m = Cam.vp;
    const cx = m[0] * g.x + m[4] * y + m[8] * g.z + m[12];
    const cy = m[1] * g.x + m[5] * y + m[9] * g.z + m[13];
    const cw = m[3] * g.x + m[7] * y + m[11] * g.z + m[15];
    const W = innerWidth, H = innerHeight;
    let sx, sy, edge = false;
    if (cw > 0.1) { sx = (cx / cw * 0.5 + 0.5) * W; sy = (0.5 - cy / cw * 0.5) * H; }
    else { sx = cx > 0 ? W : 0; sy = H * 0.3; edge = true; }
    const mx = 60, my = 70;
    if (sx < mx || sx > W - mx || sy < my || sy > H - 40) edge = true;
    sx = clamp(sx, mx, W - mx); sy = clamp(sy, my, H - 40);
    el.style.transform = 'translate(' + sx.toFixed(0) + 'px,' + sy.toFixed(0) + 'px) translate(-50%,-100%)';
    el.classList.add('on');
    el.classList.toggle('blue', g.i % 2 === 1);
    el.classList.toggle('edge', edge);
    $('gateDist').textContent = Math.round(Math.hypot(g.x - P.pos.x, dz)) + ' m';
  },

  hud() {
    const P = this.P;
    this.gateMarker();
    $('dist').innerHTML = Math.round(this.distance) + '<span class="unit">m</span>';
    $('drop').textContent = '\u25BC ' + Math.round(Math.max(0, this.startY - P.pos.y)) + ' m drop';
    $('score').textContent = Math.round(this.score).toLocaleString();
    $('speed').innerHTML = Math.round(P.speed * 3.6) + '<span class="unit">km/h</span>';
    $('speedfill').style.width = clamp(P.speed / 30 * 100, 0, 100) + '%';
    const c = $('combo');
    if (this.combo > 1) { c.classList.add('on'); c.textContent = '\u00D7' + this.combo + ' COMBO'; }
    else c.classList.remove('on');
    const at = $('airtime');
    if (P.airborne) { at.classList.add('on'); at.textContent = P.airTime.toFixed(2) + ' s'; }
    else at.classList.remove('on');
    if ($('debug').classList.contains('on')) {
      $('debug').innerHTML =
        this.fps.toFixed(0) + ' fps · ' + World.chunks.size + ' chunks · ' + this.fx.n + 'p<br>' +
        'v ' + P.speed.toFixed(1) + ' m/s · lean ' + P.lean.toFixed(2) + ' · load ' + P.load.toFixed(2) +
        '<br>yaw ' + (P.yaw % 6.283).toFixed(2) + ' · spin ' + P.spin.toFixed(1) +
        ' · ' + (P.airborne ? 'AIR' : 'GROUND');
    }
  }
};

/* ---------------- main ---------------- */
(function main() {
  const canvas = $('gl');
  function die(e) {
    const f = $('fatal');
    f.style.display = 'flex';
    f.textContent = (e && (e.message || e)) || 'Unknown error';
    if (window.console) console.error(e);
  }
  try {
    if (window.matchMedia && matchMedia('(pointer:coarse)').matches) {
      GL.quality = 0.75;        // caps the render resolution at 1× device pixels
      GL.shadowSize = 1024;
    }
    GL.init(canvas);
    Scenery.init(GL.quality < 1);
    GL.makeShadowMap(GL.shadowSize, GL.shadowSize);
    Game.boot();
    Input.init();
  } catch (e) { die(e); return; }

  /* Surface driver errors while they are still attributable: a GL error on the
     first frame almost always means a shader/VAO/FBO problem, and by default
     getError() errors are silent. */
  let _glErrChecked = false;
  function checkFirstFrame() {
    if (_glErrChecked) return;
    _glErrChecked = true;
    const gl = GL.gl;
    const e = gl.getError();
    if (e !== 0) {
      const names = { 0x500: 'INVALID_ENUM', 0x501: 'INVALID_VALUE', 0x502: 'INVALID_OPERATION',
        0x505: 'OUT_OF_MEMORY', 0x8CD5: 'FRAMEBUFFER_INCOMPLETE', 0x8C8A: 'INVALID_FRAMEBUFFER_OPERATION',
        0x822C: 'INVALID_INDEX', 0x84A0: 'TEXTURE_UNASSIGNED' };
      throw new Error('WebGL error after first rendered frame: ' + (names[e] || '0x' + e.toString(16)) +
        '. Shaders/FBOs/VAOs are suspect.');
    }
    if (gl.isContextLost && gl.isContextLost()) throw new Error('WebGL context was lost during init.');
  }

  window.addEventListener('resize', () => { try { GL.resize(); } catch (e) { } });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (Game.state === 'play') Game.togglePause(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && Game.state === 'play') Game.togglePause();
  });

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1 / 30);
    GL.time += dt; Game.t += dt;
    Game.frames++; Game._fpsT += dt; Game.frameNo++;
    if (Game._fpsT > 0.5) { Game.fps = Game.frames / Game._fpsT; Game.frames = 0; Game._fpsT = 0; }

    try {
      if (Game.state === 'menu') {
        if (Input.anyKey) { Input.anyKey = false; Game.start(); }
        // idle: drift down the mountain so the menu has a live backdrop
        Game.P.pos.z += dt * 7;
        if (Level.cur.finishZ && Game.P.pos.z > Level.cur.finishZ) Game.P.pos.z = Game.spawnZ();
        Game.P.pos.x = centerX(Game.P.pos.z);
        Game.P.pos.y = heightAt(Game.P.pos.x, Game.P.pos.z) + 0.2;
        Game.P.speed = 7; Game.P.updateBasis();
        Scenery.update(dt, Game.P);
        World.update(Game.P.pos.x, Game.P.pos.z);
        Cam.update(dt, Game.P, 'menu'); Cam.resolveGround();
        Game.render();
        checkFirstFrame();
        return;
      }
      if (Game.state === 'pause') { Input.anyKey = false; return; }
      if (Game.state === 'over') {
        // keep the scene alive behind the results panel
        World.update(Game.P.pos.x, Game.P.pos.z);
        Cam.update(dt, Game.P, 'over'); Cam.resolveGround();
        Game.render();
        return;
      }

      const inp = Input.sample(dt);
      Input.anyKey = false;
      Game.update(dt, inp);
      Cam.update(dt, Game.P, Game.state);
      Cam.resolveGround();
      Game.render();
      checkFirstFrame();
      Game.hud();
      Audio.update(clamp(Game.P.speed / 28, 0, 1), Math.abs(Game.P.lean), Game.P.airborne, Game.P.tuck);
    } catch (e) { die(e); }
  }
  requestAnimationFrame(frame);
})();
