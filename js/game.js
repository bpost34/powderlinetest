/* =====================================================================
   game.js — state machine, input, scoring, HUD, main loop.
   ===================================================================== */
'use strict';

/* tiny DOM helper (used everywhere) */
const $ = (id) => document.getElementById(id);

/* ---------------- X / Y button abilities ----------------
   Three abilities, two buttons — the rider picks which two (Controls editor:
   tap X or Y to cycle). Keyboard has all three on E / Q / F.
     butter : hold on the snow for a nose/tail press (stick keeps the balance)
     pump   : press into a dip / transition / roller up-slope for speed
     stomp  : press just before touchdown for a firmer, more forgiving landing */
const ABILITIES = ['butter', 'pump', 'stomp'];
const ABILITY_LABEL = { butter: 'press', pump: 'pump', stomp: 'stomp' };
const Buttons = {
  KEY: 'powderline.buttons',
  map: { X: 'butter', Y: 'pump' },
  load() {
    try {
      const m = JSON.parse(localStorage.getItem(this.KEY) || 'null');
      if (m && ABILITIES.includes(m.X) && ABILITIES.includes(m.Y) && m.X !== m.Y) this.map = m;
    } catch (e) { }
    this.sync();
  },
  /* next ability on this button; if the other button has it, they swap */
  cycle(btn) {
    const other = btn === 'X' ? 'Y' : 'X';
    const next = ABILITIES[(ABILITIES.indexOf(this.map[btn]) + 1) % ABILITIES.length];
    if (next === this.map[other]) this.map[other] = this.map[btn];
    this.map[btn] = next;
    try { localStorage.setItem(this.KEY, JSON.stringify(this.map)); } catch (e) { }
    this.sync();
  },
  sync() {
    for (const b of ['X', 'Y']) {
      const el = document.querySelector('#x' + b + ' small'); if (el) el.textContent = ABILITY_LABEL[this.map[b]];
    }
    for (const el of document.querySelectorAll('[data-ability]')) el.textContent = ABILITY_LABEL[this.map[el.dataset.ability]];
  }
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
      KeyN: 'atmos', Backquote: 'debug', KeyJ: 'Indy', KeyK: 'method', KeyL: 'mutegrab', Semicolon: 'stale',
      KeyE: 'butter', KeyQ: 'pump', KeyF: 'stomp'
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
      if (Game.editingLayout) { if (e.code === 'Escape') TouchLayout.closeEditor(); return; }
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
      // flick mode: direction keys are flicks during a run
      if (Flick.on && Game.state === 'play') {
        const FD = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
        if (Flick.steering === 'auto') { FD.KeyA = [-1, 0]; FD.KeyD = [1, 0]; }       // otherwise A / D steer
        if (FD[e.code]) { Flick.key(FD[e.code][0], FD[e.code][1]); return; }
      }
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
    // No browser zoom while playing. iOS Safari ignores user-scalable=no, so a thumb on
    // the stick plus one on a button can read as a pinch; Safari's own gesture events
    // can be cancelled (Apple, Safari Web Content Guide), and so can stray touch drags
    // (except inside the rider panel, which scrolls). Double-tap zoom is blocked too.
    const noZoom = (e) => e.preventDefault();
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, noZoom, { passive: false });
    document.addEventListener('touchmove', (e) => {
      if (e.target.closest && e.target.closest('.rscroll')) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    document.addEventListener('dblclick', noZoom, { passive: false });

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
    hold('xA', 'jump'); hold('xB', 'grabB'); hold('xX', 'btnX'); hold('xY', 'btnY');
    Buttons.load();
    Flick.load();
    const sb = $('styleBtn');
    for (const t of ['pointerdown', 'touchstart', 'mousedown']) sb.addEventListener(t, (e) => e.stopPropagation());
    sb.addEventListener('click', (e) => { e.stopPropagation(); Flick.toggle(); sb.blur(); });
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

    TouchLayout.init();

    // one-finger swipe on open screen orbits the camera (same spring-back as the mouse)
    const canvas = $('gl');
    let camId = null, lx = 0, ly = 0;
    Flick.bindPointer(canvas);
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || camId !== null || (Flick.on && Game.state === 'play')) return;   // flicks own the screen
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
    // B (touch / controller): one grab button — the stick direction when you press it
    // picks the grab: neutral or up = Indy, down = stale, left = method, right = mute
    const grabB = !!this.down.grabB || Pad.grabB;
    if (grabB && !this._grabB) {
      const gx = this.touchSteer !== null ? this.touchSteer : (Pad.steer !== null ? Pad.steer : target);
      this._grabType = Math.abs(gx) > 0.45 ? (gx < 0 ? 'method' : 'mute') : (sy > 0.4 ? 'stale' : 'Indy');
    }
    this._grabB = grabB;
    this.grab = this.down.method ? 'method' : this.down.Indy ? 'Indy'
      : this.down.stale ? 'stale' : this.down.mutegrab ? 'mute' : grabB ? this._grabType : Pad.grab;
    // X / Y abilities (whichever the rider assigned), plus their keyboard keys
    const held = (ab) => !!this.down[ab] || ((this.down.btnX || Pad.btnX) && Buttons.map.X === ab)
      || ((this.down.btnY || Pad.btnY) && Buttons.map.Y === ab);
    const pumpNow = held('pump'), stompNow = held('stomp');
    const pump = pumpNow && !this._pumpPrev, stomp = stompNow && !this._stompPrev;
    this._pumpPrev = pumpNow; this._stompPrev = stompNow;
    const j = this.jumpRelease; this.jumpRelease = false;
    return { steer: this.steer, brake: this.brake, tuck: this.tuck, jump: j, charge: this.releaseCharge,
             flipFwd: Math.max(this.down.tuck ? 1 : 0, fwd), flipBack: Math.max(this.down.brake ? 1 : 0, back), grab: this.grab,
             butter: held('butter'), pump, stomp };
  }
};

/* ---------------- FLICK MODE (easy / accessibility control style) ----------------
   The board carves on autopilot (gates, park features, pipe walls). The rider only:
     tap / A / Space      ollie on the snow · grab in the air
     flick ↑ / ↓          front / back flip      (in the air)
     flick ← / →          360 spin               (in the air) · 180 to switch stance (on the snow)
     flick diagonal       flip + spin together
   Touch: flick anywhere on screen. Controller: flick the left stick. Keyboard: tap the
   arrows / WASD (two at once for a diagonal). Each trick auto-completes before touchdown;
   a flick with too little air left is ignored, so flick mode never crashes you. */
const FLICK_STYLES = ['off', 'auto', 'assist', 'manual'];
const FLICK_LABEL = { off: 'Classic', auto: 'Flick · autopilot', assist: 'Flick · assisted', manual: 'Flick · manual steer' };
const Flick = {
  on: false,
  steering: 'auto',    // auto: autopilot steers · assist: autopilot nudged by tilt/stick · manual: you steer
  pending: null,       // flick waiting for the next frame: {x, y}
  tap: false,          // tap waiting: ollie (snow) or grab (air)
  airGrab: false,
  _keyVec: null, _keyT: 0, _padArmed: true,

  style() { return this.on ? this.steering : 'off'; },
  load() {
    let v = 'off';
    try { v = localStorage.getItem('powderline.flick') || 'off'; } catch (e) { }
    if (v === '1') v = 'auto';                       // older saves
    if (v === '0' || !FLICK_STYLES.includes(v)) v = 'off';
    this.on = v !== 'off'; if (this.on) this.steering = v;
    this.sync();
  },
  /* the menu button cycles Classic → autopilot → assisted → manual */
  toggle() {
    const next = FLICK_STYLES[(FLICK_STYLES.indexOf(this.style()) + 1) % FLICK_STYLES.length];
    this.on = next !== 'off'; if (this.on) this.steering = next;
    try { localStorage.setItem('powderline.flick', next); } catch (e) { }
    this.sync();
  },
  sync() {
    const b = document.body.classList;
    b.toggle('flick', this.on);
    b.toggle('flickSteer', this.on && this.steering !== 'auto');      // touch: show the steering stick
    const el = $('styleBtn'); if (el) { el.textContent = 'Controls: ' + FLICK_LABEL[this.style()]; el.classList.toggle('on', this.on); }
    if (typeof Game !== 'undefined' && Game.P) Game.loadBest();      // Classic and Flick bests are separate
    const h = $('flickHint');
    if (h) h.textContent = (this.on && this.steering !== 'auto' ? 'steer: stick / tilt · ' : '') + 'tap ollie / grab · flick ↑↓ flip · ←→ spin (on snow: switch)';
  },

  /* snap a direction to 8-way (components 0 / ±1) */
  fire(dx, dy) {
    const m = Math.hypot(dx, dy) || 1, x = dx / m, y = dy / m;
    this.pending = { x: Math.abs(x) > 0.38 ? Math.sign(x) : 0, y: Math.abs(y) > 0.38 ? Math.sign(y) : 0 };
  },

  /* keyboard: collect a second direction key within 70 ms for diagonals */
  key(dx, dy) {
    if (!this._keyVec) {
      this._keyVec = { x: 0, y: 0 };
      this._keyT = setTimeout(() => { const v = this._keyVec; this._keyVec = null; this.fire(v.x, v.y); }, 70);
    }
    this._keyVec.x += dx; this._keyVec.y += dy;
  },

  /* controller: a quick stick deflection from the centre is a flick */
  pad(x, y) {
    const m = Math.hypot(x || 0, y || 0);
    if (m < 0.3) this._padArmed = true;
    else if (m > 0.78 && this._padArmed) { this._padArmed = false; this.fire(x, y); }
  },

  /* touch / mouse gestures on the open screen */
  bindPointer(canvas) {
    let g = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.on || Game.state !== 'play') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), fired: false };
    });
    window.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id || g.fired) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (Math.hypot(dx, dy) >= 34 && performance.now() - g.t < 320) { g.fired = true; this.fire(dx, dy); }
    });
    const up = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const d = Math.hypot(e.clientX - g.x, e.clientY - g.y);
      if (!g.fired && d < 16 && performance.now() - g.t < 380) this.tap = true;
      g = null;
    };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', () => { g = null; });
  },

  /* rewrite this frame's input: autopilot steering + gestures */
  apply(inp, P) {
    // controller flicks: left stick when the autopilot steers, right stick otherwise
    if (this.steering === 'auto') { if (Pad.steer !== null || Pad.stickY) this.pad(Pad.steer || 0, Pad.stickY || 0); }
    else if (Pad.rx || Pad.ry) this.pad(Pad.rx || 0, Pad.ry || 0); else this._padArmed = true;
    // steering: inp.steer arrives as the rider's own (stick / tilt / keys)
    const user = inp.steer || 0;
    if (P.airborne) { inp.steer = 0; P.lean = 0; }          // flick mode: spins only come from flicks
    else if (this.steering === 'auto') inp.steer = Autopilot.steer(P);
    else if (this.steering === 'assist') inp.steer = clamp(Autopilot.steer(P) * 0.6 + user * 0.8, -1, 1);
    else inp.steer = user;
    inp.tuck = 0; inp.flipFwd = 0; inp.flipBack = 0; inp.butter = false; inp.pump = false; inp.stomp = false;
    inp.brake = 0;
    // ---- easy speed + air: tuck to a cruising speed, pump every compression,
    //      and pop an ollie off every launch (lips, ramps, rails, kicker tops) ----
    const lv = Level.cur.id, cap = lv === 'pipe' ? 15.5 : lv === 'park' ? 19 : 23;   // m/s: pipe ~56 km/h, park ~68, mountain ~83
    if (!P.airborne) {
      this._popped = false;
      inp.tuck = P.speed < cap ? 1 : 0;
      if (P.speed > cap + 4) inp.brake = 0.5;
      // pump compressions, but only up to the cruising speed (a pump on a big landing
      // or a pipe transition can add 10+ m/s — uncapped it snowballs into 40 m airs)
      if (P.load > 1.15 && P.speed < cap - 0.5) { inp.pump = true; inp.pumpMax = cap + 1 - P.speed; }
      if ((lv === 'mountain' || lv === 'zen') && Autopilot.atKickerTop(P)) { inp.jump = true; inp.charge = 0.3; }
    } else if (!this._popped && P.airTime < 0.08 && P.coyote > 0) {
      // launch + a light ollie = noticeably more air (a full-charge pop on top of a lip launch is ~20 m)
      this._popped = true;
      if (lv !== 'pipe') { inp.jump = true; inp.charge = 0.12; }   // the pipe's height comes from the speed
    }
    let f = this.pending; this.pending = null;
    if (f && !P.airborne && f.y < 0 && !f.x) { inp.jump = true; inp.charge = 0.6; f = null; }    // flick up on snow = ollie
    if (f && !f.x && !f.y) f = null;
    inp.flick = f;
    if (this.tap) {
      this.tap = false;
      if (P.airborne) this.airGrab = true; else { inp.jump = true; inp.charge = 0.6; }
    }
    if (!P.airborne) this.airGrab = false;
    if (this.airGrab) inp.grab = inp.grab || 'Indy';
  }
};

/* the autopilot line: gates on the mountain, features in the park, wall to wall in the pipe */
const Autopilot = {
  side: 1, _lastKick: null,
  /* on the mountain, ollie right at a natural kicker's top (rollers are absorbed otherwise) */
  atKickerTop(P) {
    const s0 = Math.floor((P.pos.z + 40) / SEG);
    for (let i = 0; i < 3; i++) {
      const k = featureAt(s0 + i - 1);
      if (!k || k.kind !== 'kicker' || k === this._lastKick) continue;
      if (P.pos.z > k.z - 1.6 && P.pos.z < k.z + 0.4 && Math.abs(P.pos.x - k.x) < k.rad * 0.7) { this._lastKick = k; return true; }
    }
    return false;
  },
  steer(P) {
    const lv = Level.cur, z = P.pos.z;
    // aim at a target POINT (tx, tz): heading = straight at it, not a fixed look-ahead,
    // so a gate 150 m away is a gentle drift rather than a hard cut across the slope
    let tx, tz = z + clamp(P.speed * 1.4, 10, 30), maxOff = 0.95;
    if (lv.id === 'pipe') {
      const lip = PIPE.B + PIPE.R;
      if (P.pos.x * this.side > lip - 1.6) this.side = -this.side;       // reached this wall: go for the other
      tx = this.side * (lip + 2); tz = z + 10; maxOff = 1.3;      // a shallower line up the wall: ~5 m airs, not the 7 m ceiling every hit
    } else if (lv.id === 'park') {
      tx = 0;
      for (const f of PARK_FEATURES) if (f.k === 'table' && f.z + f.up > z + 6 && f.z < z + 80) { tx = f.x; tz = Math.max(tz, f.z + f.up * 0.5); break; }
    } else {
      const g = lv.gates ? Gates.upcoming() : null;
      if (g && g.z > z + 4 && g.z - z < 200) { tx = g.x; tz = g.z; }
      else tx = centerX(tz) + Math.sin(z * 0.045) * 7;                    // easy S-carves down the fall line
      const c = centerX(tz), lim = (lv.clearHalf || PISTE_HALF) - 6;     // stay inside the tree line
      tx = clamp(tx, c - lim, c + lim);
    }
    // don't cut more than ~55° off the fall line (keeps the speed up on the mountain)
    const fall = Math.atan2(centerX(z + 30) - centerX(z), 30);
    let want = Math.atan2(tx - P.pos.x, Math.max(tz - z, 6));
    if (lv.id !== 'pipe') want = fall + clamp(angDelta(fall, want), -maxOff, maxOff);
    const head = P.speed > 1 ? Math.atan2(P.vel.x, P.vel.z) : P.yaw;
    return clamp(angDelta(want, head) * 2.2, -1, 1);
  }
};

/* ---------------- movable touch controls ----------------
   Each cluster (stick, A/B/X/Y) has a grip above it: press and hold ~0.3 s until
   it lights up, then drag the cluster anywhere and let go. Positions are saved
   per orientation as fractions of the screen (so they suit any phone size);
   "Reset controls" on the pause screen restores the defaults. */
const TouchLayout = {
  KEY: 'powderline.touchLayout',
  HOLD_MS: 300,
  saved: {},
  orient() { return innerWidth > innerHeight ? 'land' : 'port'; },

  init() {
    try { this.saved = JSON.parse(localStorage.getItem(this.KEY) || '{}') || {}; } catch (e) { this.saved = {}; }
    for (const id of ['gStick', 'gAbxy']) this.bind($(id));
    window.addEventListener('resize', () => this.apply());
    // menu → "Controls": arrange the clusters before riding
    const stop = (el) => { for (const t of ['pointerdown', 'click', 'touchstart', 'mousedown']) el.addEventListener(t, (e) => e.stopPropagation()); };
    const cb = $('ctrlBtn');
    stop(cb); cb.addEventListener('click', () => { this.openEditor(); cb.blur(); });
    stop($('layoutBar'));
    $('lDone').addEventListener('click', () => this.closeEditor());
    $('lReset').addEventListener('click', () => this.reset());
    const rb = $('pLayout');
    rb.addEventListener('pointerdown', (e) => e.stopPropagation());
    rb.addEventListener('click', (e) => { e.stopPropagation(); this.reset(); rb.blur(); });
    this.apply();
  },

  /* place every group: saved centre (fractions of the screen) or the CSS default */
  apply() {
    const b = document.body.classList;
    if (!b.contains('playing') && !b.contains('editLayout')) return;   // hidden: nothing to measure yet
    const o = this.saved[this.orient()] || {};
    for (const id of ['gStick', 'gAbxy']) {
      const g = $(id), c = o[id];
      if (!c) { g.style.left = g.style.top = g.style.right = g.style.bottom = ''; continue; }
      this.place(g, c[0] * innerWidth, c[1] * innerHeight);
    }
  },

  /* centre a group at (x, y), kept fully on screen (grip included) */
  place(g, x, y) {
    const w = g.offsetWidth, h = g.offsetHeight, pad = 8;
    x = clamp(x, w / 2 + pad, innerWidth - w / 2 - pad);
    y = clamp(y, h / 2 + 34, innerHeight - h / 2 - pad);
    g.style.right = g.style.bottom = 'auto';
    g.style.left = (x - w / 2) + 'px'; g.style.top = (y - h / 2) + 'px';
    return [x, y];
  },

  bind(g) {
    const grip = g.querySelector('.tgrip');
    let id = null, timer = 0, moving = false, dx = 0, dy = 0, last = null, sx = 0, sy = 0, dragged = false;
    const end = (e) => {
      clearTimeout(timer);
      // editor: a tap that didn't drag, on X or Y, cycles that button's ability
      if (Game.editingLayout && id !== null && !dragged && e && e.type === 'pointerup') {
        for (const b of ['X', 'Y']) {
          const r = $('x' + b).getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { Buttons.cycle(b); break; }
        }
      }
      dragged = false;
      if (moving && last) {
        const o = this.saved[this.orient()] || (this.saved[this.orient()] = {});
        o[g.id] = [last[0] / innerWidth, last[1] / innerHeight];
        try { localStorage.setItem(this.KEY, JSON.stringify(this.saved)); } catch (e) { }
      }
      id = null; moving = false; last = null;
      grip.classList.remove('armed'); g.classList.remove('moving');
    };
    // editor: grab the whole cluster straight away (no hold needed)
    g.addEventListener('pointerdown', (e) => {
      if (!Game.editingLayout) return;
      e.preventDefault(); e.stopPropagation();
      try { g.setPointerCapture(e.pointerId); } catch (_) { }
      id = e.pointerId; moving = true; g.classList.add('moving');
      sx = e.clientX; sy = e.clientY; dragged = false;
      const r = g.getBoundingClientRect();
      dx = e.clientX - (r.left + r.width / 2); dy = e.clientY - (r.top + r.height / 2);
    });
    g.addEventListener('pointermove', (e) => {
      if (!Game.editingLayout || e.pointerId !== id || !moving) return;
      if (!dragged && Math.hypot(e.clientX - sx, e.clientY - sy) < 8) return;   // still a tap
      dragged = true;
      last = this.place(g, e.clientX - dx, e.clientY - dy);
    });
    g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
    grip.addEventListener('pointerdown', (e) => {
      if (Game.editingLayout) return;               // the group handler takes it
      e.preventDefault(); e.stopPropagation();
      try { grip.setPointerCapture(e.pointerId); } catch (_) { }
      id = e.pointerId;
      const r = g.getBoundingClientRect();
      dx = e.clientX - (r.left + r.width / 2); dy = e.clientY - (r.top + r.height / 2);
      grip.classList.add('armed');
      timer = setTimeout(() => { moving = true; g.classList.add('moving'); }, this.HOLD_MS);   // hold to unlock
    });
    grip.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id || !moving) return;
      last = this.place(g, e.clientX - dx, e.clientY - dy);
    });
    grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    grip.addEventListener('lostpointercapture', end);
  },

  openEditor() {
    if (Game.state !== 'menu' || Game.customizing) return;
    Game.editingLayout = true;
    document.body.classList.add('editLayout');
    this.apply();
  },
  closeEditor() {
    Game.editingLayout = false;
    document.body.classList.remove('editLayout');
    Game.menuAt = performance.now();               // the Done tap mustn't start a run
  },

  reset() {
    delete this.saved[this.orient()];
    try { localStorage.setItem(this.KEY, JSON.stringify(this.saved)); } catch (e) { }
    this.apply();
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
  customizing: false,
  editingLayout: false,          // touch-control layout editor open (menu only)            // rider colour panel open (menu only; render.js frames the rider)
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
    this.syncLengths();
    this.startY = this.P.pos.y;
    this.lastZ = this.P.pos.z;
  },

  /* ---------------- levels ---------------- */
  spawnZ() { return Level.cur.spawnZ || 0; },

  /* run length per level (3 options; saved per level) */
  lenIdx(id) {
    const def = Level.defs[id]; if (!def || !def.lengths) return -1;
    let i = def.defaultLength || 0;
    try { const v = localStorage.getItem('powderline.len.' + id); if (v !== null && def.lengths[+v]) i = +v; } catch (e) { }
    return i;
  },
  setLength(id, i) {
    const def = Level.defs[id]; if (!def || !def.lengths || !def.lengths[i]) return;
    try { localStorage.setItem('powderline.len.' + id, String(i)); } catch (e) { }
    this.syncLengths();
    if (Level.cur === def) this.selectLevel(id, true);         // rebuild the course at the new length
  },
  syncLengths() {
    for (const box of document.querySelectorAll('.lens')) {
      const def = Level.defs[box.dataset.for], cur = this.lenIdx(box.dataset.for);
      if (!box.children.length) {
        def.lengths.forEach((L, i) => {
          const em = document.createElement('em');
          em.textContent = L.label;
          // a chip sets the length; it must not also count as "tap the card to ride"
          em.addEventListener('pointerdown', (e) => e.stopPropagation());
          em.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); Audio.init(); this.setLength(box.dataset.for, i); });
          box.appendChild(em);
        });
      }
      [...box.children].forEach((em, i) => em.classList.toggle('on', i === cur));
    }
  },

  selectLevel(id, force) {
    const def = Level.defs[id]; if (!def) return;
    const changed = force || Level.cur !== def;
    Level.cur = def;
    if (def.setLength) def.setLength(this.lenIdx(id));
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

  /* best scores are kept per level, per run length and per control mode (Classic vs Flick) */
  bestKey() {
    const d = Level.cur, fl = Flick.on ? '.flick' : '';
    if (d.lengths) return 'powderline.best.' + d.id + '.' + d.lengths[this.lenIdx(d.id)].key + fl;
    return (d.id === 'mountain' ? 'powderline.best' : 'powderline.best.' + d.id) + fl;
  },
  modeTag() { return Flick.on ? 'FLICK' : 'CLASSIC'; },
  loadBest() {
    let saved = 0;
    try { saved = +(localStorage.getItem(this.bestKey()) || 0); } catch (e) { saved = 0; }
    this.best = isFinite(saved) ? saved : 0;
    $('best').textContent = 'BEST ' + this.best.toLocaleString() + ' · ' + this.modeTag();
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
    TouchLayout.apply();                       // controls are visible now: sizes are measurable
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
    else if (this.state === 'pause') { this.state = 'play'; $('pause').classList.add('hide'); document.body.classList.add('playing'); TouchLayout.apply(); Audio.resume(); }
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

  /* flick mode: 180 on the snow to switch stance */
  onSwitch(sw) {
    const pts = Math.round(25 * this.combo);
    this.score += pts; this.comboTimer = Math.max(this.comboTimer, 3);
    this.showTrick(sw ? 'Ground 180 · switch' : 'Ground 180 · regular', pts);
  },
  onFlickTooLow() { this.msg('TOO LOW', 500); },

  /* butter / press finished: a clean hold scores and feeds the combo; a slip breaks it */
  onPress(type, t, clean, spin) {
    if (!clean) { this.msg('SLIPPED', 900); this.combo = 1; this.comboTimer = 0; Pad.rumble(0.5, 0.3, 140); return; }
    if (t < 0.4 && !spin) return;
    const pts = Math.round((40 + t * 110 + (spin || 0) * 0.9) * this.combo);   // butter spins: 180 → +162
    this.score += pts;
    this.bestHit = Math.max(this.bestHit, pts);
    if (t >= 1) { this.combo = Math.min(this.combo + 1, 12); }
    this.comboTimer = 5.5;
    Audio.trick(1);
    this.showTrick((type === 'nose' ? 'Nose' : 'Tail') + ' Press' + (spin ? ' ' + spin : '') + ' ' + t.toFixed(1) + 's', pts);
  },

  /* stomped landing: well-timed press just before touchdown */
  onStomp() {
    this.score += Math.round(50 * this.combo);
    this.msg('STOMPED!', 900);
    Pad.rumble(0.9, 0.5, 160);
  },

  gameOver(finished) {
    this.state = 'over'; this.overAt = performance.now();
    const L = Level.cur.lengths ? ' · ' + Level.cur.lengths[this.lenIdx(Level.cur.id)].label : '';
    $('overTitle').textContent = (finished ? 'Run complete · ' : 'Run over · ') + Level.cur.name + L + ' · ' + (Flick.on ? 'Flick' : 'Classic');
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
      $('newbest').textContent = '★ new personal best · ' + (Flick.on ? 'Flick' : 'Classic');
      $('newbest').style.display = 'block';
    } else $('newbest').style.display = 'none';
    $('best').textContent = 'BEST ' + this.best.toLocaleString() + ' · ' + this.modeTag();
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
      const flipName = (flips === 1 ? '' : (['', '', 'Double ', 'Triple '][flips] || flips + '× ')) + (a.flip > 0 ? 'Backflip' : 'Frontflip');
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
    if (Flick.on) Flick.apply(inp, P);
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
    if (P.press && this.comboTimer > 0) this.comboTimer = Math.max(this.comboTimer, 0.75);   // a press keeps the line alive
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
    // press balance meter
    const pm = $('pressMeter');
    pm.classList.toggle('on', !!P.press);
    if (P.press) {
      this.put('pressLabel', (P.press.type === 'nose' ? 'NOSE' : 'TAIL') + ' PRESS ' + P.press.t.toFixed(1) + 's');
      $('pressNeedle').style.left = (50 + clamp(P.press.bal, -1, 1) * 46) + '%';
      pm.classList.toggle('warn', Math.abs(P.press.bal) > 0.65);
    }
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
        if (Input.anyKey) { Input.anyKey = false; if (!Game.customizing && !Game.editingLayout) Game.start(); }
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
