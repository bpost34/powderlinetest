/* =====================================================================
   game.js — state machine, input, scoring, HUD, main loop.
   ===================================================================== */
'use strict';

/* tiny DOM helper (used everywhere) */
const $ = (id) => document.getElementById(id);

/* ---------------- input ---------------- */
const Input = {
  down: {}, steer: 0, jumpEdge: false, grab: null,
  tuck: false, brake: false, anyKey: false,

  init() {
    const keyMap = {
      KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
      KeyS: 'brake', ArrowDown: 'brake', KeyW: 'tuck', ArrowUp: 'tuck',
      Space: 'jump', KeyR: 'restart', KeyP: 'pause', KeyM: 'mute',
      KeyN: 'atmos', Backquote: 'debug', KeyJ: 'Indy', KeyK: 'method', KeyL: 'mutegrab', Semicolon: 'stale'
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // Safari requires an AudioContext to be created/resumed inside the
      // user-gesture call stack — doing it from the rAF loop is blocked.
      Audio.init(); Audio.resume();
      document.body.classList.remove('pad');          // keyboard in use: show its help again
      // customise panel: its own keys only (Esc closes); nothing reaches the game,
      // and Space/arrows keep their normal meaning (press a button, scroll the panel)
      if (Game.customizing) { if (e.code === 'Escape') Customize.close(); return; }
      if (e.code === 'Space' || e.code.indexOf('Arrow') === 0) e.preventDefault();
      // shortcuts / app switching (Cmd-Tab, Ctrl-…, a bare Shift) never drop you into a run
      if (e.metaKey || e.ctrlKey || e.altKey || /^(Meta|Control|Alt|Shift|Tab|CapsLock|Escape)/.test(e.code)) {
        if (e.code === 'Escape' && (Game.state === 'over' || Game.state === 'pause')) Game.toMenu();
        return;
      }
      if (e.code === 'KeyC' && Game.state === 'menu') { Customize.open(); return; }
      const LV = { Digit1: 'mountain', Digit2: 'pipe', Digit3: 'park', Digit4: 'zen',
                   Numpad1: 'mountain', Numpad2: 'pipe', Numpad3: 'park', Numpad4: 'zen' };
      if (LV[e.code] && (Game.state === 'menu' || Game.state === 'over')) {
        Game.selectLevel(LV[e.code]);
        if (Game.state === 'over') Game.restart();
        return;
      }
      // N (atmosphere) and M (mute) are settings, not "drop in"
      if (!(Game.state === 'menu' && (e.code === 'KeyN' || e.code === 'KeyM'))) this.anyKey = true;
      const k = keyMap[e.code];
      if (!k) return;
      if (!this.down[k]) {
        if (k === 'jump') { this.jumpHeld = Game.state === 'play'; this.chargeT = 0; }   // a press that started a run never jumps
        this.onPress(k);
      }
      this.down[k] = true;
    });
    window.addEventListener('keyup', (e) => {
      const k = keyMap[e.code]; if (!k) return;
      if (k === 'jump') this.releaseJump();
      this.down[k] = false;
    });
    window.addEventListener('blur', () => { this.down = {}; this.jumpHeld = false; Cam.dragging = false; });
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') document.body.classList.remove('pad'); }, true);

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
      if (e.target.closest && e.target.closest('#rider')) return;   // let the panel scroll
      e.preventDefault();
      Cam.zoom = clamp(Cam.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 2.2);
    }, { passive: false });

    // pointer: any click drops in, like the old arcade cabinets
    const screen = $('menu');
    if (screen) screen.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;               // right/middle = camera, not "start"
      if (e.target && e.target.closest && e.target.closest('a')) return;
      if (performance.now() - Game.menuAt < 450) return;   // the tap that opened the menu
      Audio.init(); Audio.resume();   // user gesture: safe to start audio here
      this.anyKey = true;
    });
    // results: ignore taps for a moment so a finger still mashing at the crash doesn't skip the stats
    const overTap = () => Game.state === 'over' && performance.now() - Game.overAt > 650;
    $('over').addEventListener('pointerdown', (e) => { if (e.button === 0 && overTap()) Game.restart(true); });
    // fallback: some touch stacks deliver only a synthesized click for a quick tap
    $('menu').addEventListener('click', () => { if (Game.state === 'menu' && performance.now() - Game.menuAt >= 450) { Audio.init(); Audio.resume(); this.anyKey = true; } });
    $('over').addEventListener('click', () => { if (overTap()) Game.restart(true); });
    $('pause').addEventListener('pointerdown', (e) => { if (e.button === 0) Game.togglePause(); });
    // pause-screen buttons (stopPropagation so the screen's own tap-to-resume doesn't also fire)
    for (const [id, fn] of [['pResume', () => Game.togglePause()], ['pRestart', () => Game.restart(true)], ['pMenu', () => Game.toMenu()]]) {
      const b = $(id);
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); b.blur(); });
    }

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
    const ab = $('atmosBtn');
    ab.addEventListener('pointerdown', (e) => e.stopPropagation());
    ab.addEventListener('click', (e) => { e.stopPropagation(); Atmos.cycle(); ab.blur(); });
    const mb = $('muteBtn');
    mb.addEventListener('pointerdown', (e) => e.stopPropagation());   // don't start a run from the menu
    mb.addEventListener('click', (e) => { e.stopPropagation(); Audio.init(); Audio.resume(); Game.toggleMute(); mb.blur(); });
    Customize.init();
  },

  /* ---------------- touch: steering pad, buttons, swipe camera, tilt ---------------- */
  touchSteer: null,     // analog -1..1 while a thumb is on the joystick
  touchStickY: 0,       // joystick up/down: -1 = pushed forward, +1 = pulled back
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
        if (!this.down[k] && k === 'jump') { this.jumpHeld = Game.state === 'play'; this.chargeT = 0; }
        this.down[k] = true; el.classList.add('held');
      };
      const off = () => { if (k === 'jump') this.releaseJump(); this.down[k] = false; el.classList.remove('held'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
    };
    // virtual Xbox pad: A ollie, X/B/Y grabs (as on a real controller); tuck/brake live on the stick
    hold('xA', 'jump'); hold('xX', 'Indy'); hold('xB', 'method'); hold('xY', 'stale');
    const tap = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    tap('tP', () => Game.togglePause());
    tap('tR', () => { if (Game.state === 'play' || Game.state === 'pause') Game.restart(true); });
    tap('tM', () => Game.toMenu());

    // joystick: x = analog steer, y = tuck (push up) / brake (pull down);
    // in the air the same up/down throws front / back flips
    const pad = $('steerPad'), knob = $('steerKnob');
    let padId = null;
    const steerAt = (e) => {
      const r = pad.getBoundingClientRect();
      const half = Math.max(30, Math.min(r.width, r.height) / 2 - 22);
      let x = (e.clientX - (r.left + r.width / 2)) / half, y = (e.clientY - (r.top + r.height / 2)) / half;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }                       // knob stays inside the ring
      knob.style.transform = 'translate(' + (x * half).toFixed(0) + 'px,' + (y * half).toFixed(0) + 'px)';
      this.touchSteer = Math.abs(x) < 0.08 ? 0 : x;        // small dead zone
      this.touchStickY = y;
      pad.classList.toggle('fwd', y < -0.28); pad.classList.toggle('back', y > 0.28);
    };
    const release = () => {
      padId = null; this.touchSteer = null; this.touchStickY = 0; knob.style.transform = '';
      pad.classList.remove('fwd', 'back');
    };
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
    if (k === 'restart') { if (Game.state === 'play' || Game.state === 'over' || Game.state === 'pause') Game.restart(true); }
    else if (k === 'pause') Game.togglePause();
    else if (k === 'mute') Game.toggleMute();
    else if (k === 'atmos') { if (Level.cur.zen) Atmos.cycle(); }
    else if (k === 'debug') $('debug').classList.toggle('on');
  },

  /* Space / OLLIE released: jump with however long it was held */
  jumpHeld: false, chargeT: 0, jumpRelease: false, releaseCharge: 0,
  releaseJump() {
    if (this.down.jump && this.jumpHeld && Game.state === 'play') { this.jumpRelease = true; this.releaseCharge = this.chargeT; }
    this.jumpHeld = false;
  },

  sample(dt) {
    let target = (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0);
    if (this.touchSteer !== null) target = this.touchSteer;          // thumb on the pad wins
    else if (Pad.steer !== null) target = Pad.steer;                 // game controller stick
    else if (target === 0 && this.tiltOn && this.tiltSteer !== null) target = this.tiltSteer;
    this.steer = damp(this.steer, target, 11, dt);
    // joystick: push forward = tuck (front flip in the air), pull back = brake
    // (back flip), both analog. Past the dead zone they ramp to full by ~3/4 throw.
    const sy = this.touchStickY || Pad.stickY || 0;
    // controller triggers: right = tuck / front flip, left = brake / back flip
    const fwd = Math.max(clamp((-sy - 0.28) / 0.47, 0, 1), clamp((Pad.rt - 0.1) / 0.7, 0, 1)),
          back = Math.max(clamp((sy - 0.28) / 0.47, 0, 1), clamp((Pad.lt - 0.1) / 0.7, 0, 1));
    const loading = !!this.down.jump && this.jumpHeld;
    if (loading) this.chargeT += dt;
    this.brake = Math.max(this.down.brake ? 1 : 0, back);
    this.tuck = Math.max(this.down.tuck || loading ? 1 : 0, fwd);   // holding Space = tuck
    this.grab = this.down.method ? 'method' : this.down.Indy ? 'Indy'
      : this.down.stale ? 'stale' : this.down.mutegrab ? 'mute' : Pad.grab;
    const j = this.jumpRelease; this.jumpRelease = false;
    return { steer: this.steer, brake: this.brake, tuck: this.tuck, jump: j, charge: this.releaseCharge,
             flipFwd: Math.max(this.down.tuck ? 1 : 0, fwd), flipBack: Math.max(this.down.brake ? 1 : 0, back), grab: this.grab };
  }
};

/* ---------------- rider customisation panel (menu only) ---------------- */
const Customize = {
  init() {
    const pre = $('rPresets'), items = $('rItems');
    for (const name in OUTFIT_PRESETS) {
      const p = OUTFIT_PRESETS[name], c = (i) => p ? p[i] : OUTFIT_DEFAULTS[OUTFIT_ITEMS[i][0]];
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'rpre'; b.dataset.name = name;
      b.innerHTML = '<i></i>' + name;
      // jacket / pants / accent / board top
      b.firstChild.style.background = `conic-gradient(${c(0)} 0 50%, ${c(1)} 0 62.5%, ${c(7)} 0 75%, ${c(2)} 0)`;
      b.addEventListener('click', () => { Outfit.applyPreset(name); this.sync(); });
      pre.appendChild(b);
    }
    for (const [slot, label] of OUTFIT_ITEMS) {
      const l = document.createElement('label');
      l.className = 'ritem';
      l.innerHTML = '<input type="color"><span></span>';
      l.lastChild.textContent = label;
      const inp = l.firstChild;
      inp.dataset.slot = slot;
      inp.setAttribute('aria-label', label + ' colour');
      inp.addEventListener('input', () => { Outfit.pick(slot, inp.value); this.sync(); });
      items.appendChild(l);
    }
    $('rRandom').addEventListener('click', () => { Outfit.randomize(); this.sync(); });
    $('rReset').addEventListener('click', () => { Outfit.applyPreset('Classic'); this.sync(); });
    $('rDone').addEventListener('click', () => this.close());
    // nothing in the panel may reach the menu's "tap anywhere to drop in"
    const panel = $('rider');
    for (const t of ['pointerdown', 'click', 'touchstart', 'mousedown']) panel.addEventListener(t, (e) => e.stopPropagation());
    const rb = $('riderBtn');
    rb.addEventListener('pointerdown', (e) => e.stopPropagation());
    rb.addEventListener('click', (e) => { e.stopPropagation(); this.open(); rb.blur(); });
    this.sync();
  },

  /* inputs, preset highlight and the menu button's swatch follow Outfit */
  sync() {
    for (const inp of document.querySelectorAll('#rItems input')) inp.value = Outfit.hex[+inp.dataset.slot];
    const cur = Outfit.presetName();
    for (const b of document.querySelectorAll('.rpre')) b.classList.toggle('sel', b.dataset.name === cur);
    const d = document.querySelectorAll('#riderBtn .dots i');
    d[0].style.background = Outfit.hex[RS.JACKET]; d[1].style.background = Outfit.hex[RS.PANTS];
  },

  open() {
    if (Game.state !== 'menu' || Game.customizing) return;
    Game.customizing = true; Input.anyKey = false;
    document.body.classList.add('customizing');
    this.sync();
    const panel = $('rider');
    panel.classList.remove('hide');
    panel.querySelector('.rscroll').scrollTop = 0;
    panel.focus({ preventScroll: true });
  },

  close() {
    if (!Game.customizing) return;
    Game.customizing = false; Input.anyKey = false;
    Game.menuAt = performance.now();          // swallow any trailing tap on the menu
    document.body.classList.remove('customizing');
    $('rider').classList.add('hide');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
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
  lastZ: 0, startY: 0, frames: 0, fps: 60, _fpsT: 0, _mt: 0,
  menuAt: -1e9,                  // when the menu last opened (swallows that tap's trailing click)
  overAt: -1e9,                  // when the results screen appeared (tap guard)
  customizing: false,            // rider colour panel open (menu only; render.js frames the rider)
  perf: { t: 0, n: 0, warm: 0, low: 0 },     // dynamic-resolution frame-rate monitor
  frameNo: 0,                    // monotonic; never reset (chunk cache ages on it)

  boot() {
    this.P = new Player();
    this.fx = new Particles();
    try { if (localStorage.getItem('powderline.muted') === '1') Audio.setMuted(true); } catch (e) { }
    this.syncMuteBtn();
    this.buildLives();
    Sun.init();
    Atmos.load();
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
    document.body.classList.toggle('zen', !!def.zen);
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
    Atmos.refresh();
  },

  bestKey() { return Level.cur.id === 'mountain' ? 'powderline.best' : 'powderline.best.' + Level.cur.id; },
  loadBest() {
    let saved = 0;
    try { saved = +(localStorage.getItem(this.bestKey()) || 0); } catch (e) { saved = 0; }
    this.best = isFinite(saved) ? saved : 0;
    $('best').textContent = 'BEST ' + this.best.toLocaleString();
  },

  toMenu() {
    this.state = 'menu'; this._deadTimer = 0; this.menuAt = performance.now();
    Input.anyKey = false;                      // a key pressed on the results screen isn't "drop in"
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
    Audio.dropIn();
  },

  restart() {
    this.perf.t = 0; this.perf.n = 0; this.perf.warm = 0; this.perf.low = 0;   // first window is shader warm-up
    Input.jumpHeld = false; Input.jumpRelease = false;   // a key held into the run is not an ollie
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
    this.syncMuteBtn();
    try { localStorage.setItem('powderline.muted', Audio.muted ? '1' : '0'); } catch (e) { }
  },
  syncMuteBtn() {
    $('muteBtn').classList.toggle('muted', Audio.muted);
    $('muteBtn').setAttribute('aria-label', Audio.muted ? 'Unmute' : 'Mute');
  },

  togglePause() {
    if (this.state === 'play') { this.state = 'pause'; $('pause').classList.remove('hide'); document.body.classList.remove('playing'); }
    else if (this.state === 'pause') { this.state = 'play'; $('pause').classList.add('hide'); document.body.classList.add('playing'); Audio.resume(); }
  },

  /* ---------------- callbacks from player.js ---------------- */
  onCrash() {
    this.combo = 1; this.comboTimer = 0;
    this.flash = 0.45; this.desat = 1;
    this.msg('WIPEOUT', 1200);
    Pad.rumble(1.0, 0.8, 380);
    if (Level.cur.zen) return;                 // zen: brush it off and keep riding
    this.setLives(Math.max(0, this.lives - 1));
    if (this.lives <= 0) this._deadTimer = 1.1;
  },
  recover() { this.desat = 0; },
  onPump() { this.score += 15 * this.combo; },

  gameOver(finished) {
    this.state = 'over'; this.overAt = performance.now();
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
    $('trickPts').textContent = Level.cur.zen ? '' : '+' + pts.toLocaleString();
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
      if (P.landedClean && this.air.t > 0.35) Pad.rumble(clamp(this.air.t * 0.25, 0.15, 0.6), 0.35, 110);
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
    Atmos.update(P);
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

  /* HUD writes go through put(): elements are looked up once and only touched
     when the text actually changes (most values change a few times a second) */
  _hud: {},
  put(id, v, html) {
    const h = this._hud[id] || (this._hud[id] = { el: $(id), v: null });
    if (h.v === v) return;
    h.v = v;
    if (html) h.el.innerHTML = v; else h.el.textContent = v;
  },
  hud() {
    const P = this.P;
    this.gateMarker();
    this.put('dist', Math.round(this.distance) + '<span class="unit">m</span>', true);
    this.put('drop', '\u25BC ' + Math.round(Math.max(0, this.startY - P.pos.y)) + ' m drop');
    this.put('score', Math.round(this.score).toLocaleString());
    this.put('speed', Math.round(P.speed * 3.6) + '<span class="unit">km/h</span>', true);
    const fill = Math.round(clamp(P.speed / 30 * 100, 0, 100)) + '%';
    if (this._fill !== fill) { this._fill = fill; $('speedfill').style.width = fill; }
    $('combo').classList.toggle('on', this.combo > 1);
    if (this.combo > 1) this.put('combo', '\u00D7' + this.combo + ' COMBO');
    $('airtime').classList.toggle('on', P.airborne);
    if (P.airborne) this.put('airtime', P.airTime.toFixed(2) + ' s');
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
    Pad.init();
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
  // every GPU resource is gone after a context loss (iOS backgrounding can do this);
  // rebuilding it all in place isn't worth the code — a reload is clean and quick
  canvas.addEventListener('webglcontextrestored', () => location.reload());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && Game.state === 'play') Game.togglePause();
  });

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) return;
    // dynamic resolution: two consecutive 2-second windows under ~55 fps during a
    // run step the render size down (then MSAA, then detail). One slow window
    // (a GC pause, a tab switch) isn't enough on its own.
    if (Game.state === 'play' && !document.hidden && dt < 0.5) {
      const pf = Game.perf;
      pf.t += dt; pf.n++;
      if (pf.t > 2) {
        const fps = pf.n / pf.t; pf.t = 0; pf.n = 0;
        if (pf.warm++ >= 1) {
          pf.low = fps < 55 ? pf.low + 1 : 0;
          if (pf.low >= 2) { pf.low = 0; GL.degrade(); }
        }
      }
    }
    dt = Math.min(dt, 1 / 30);
    GL.time += dt;
    Game.frames++; Game._fpsT += dt; Game.frameNo++;
    if (Game._fpsT > 0.5) { Game.fps = Game.frames / Game._fpsT; Game.frames = 0; Game._fpsT = 0; }

    try {
      Pad.poll(dt);
      if (Game.state !== 'play') Audio.quiet();        // no carve/wind hiss off the snow
      if (Game.state === 'menu') {
        if (Input.anyKey) { Input.anyKey = false; if (!Game.customizing) Game.start(); }
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
        Input.anyKey = false;
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
