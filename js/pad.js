/* =====================================================================
   pad.js — game controllers via the browser Gamepad API (Xbox / PlayStation
   on desktop, MFi controllers such as the GameSir G8 on iPhone/iPad).
   Polled once per frame; uses the W3C "standard" layout:
     buttons 0 A  1 B  2 X  3 Y  4 LB  5 RB  6 LT  7 RT  8 View/Back  9 Menu/Start
             12 up  13 down  14 left  15 right       axes 0,1 left stick  2,3 right
   A controller only appears after its first button press on the page.
   Gameplay input flows into the same analog path as the touch joystick
   (Input.sample reads Pad.steer / Pad.stickY / Pad.lt / Pad.rt / Pad.grab).
   ===================================================================== */
'use strict';

const PAD_DZ = 0.16;                       // radial stick dead zone
const PAD_LEVELS = ['mountain', 'pipe', 'park', 'zen'];

const Pad = {
  index: -1, prev: [], active: false,
  steer: null, stickY: 0, lt: 0, rt: 0, grab: null,
  _jump: false, _cam: false, _navT: 0, _toastT: 0,

  init() {
    window.addEventListener('gamepadconnected', (e) => {
      this.toast('🎮 ' + this.shortName(e.gamepad.id) + ' connected');
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.index) { this.index = -1; this.release(); }
      this.toast('🎮 Controller disconnected');
      document.body.classList.remove('pad');
    });
    // a finger on the screen hands control back to the touch UI
    window.addEventListener('touchstart', () => document.body.classList.remove('pad'), { passive: true, capture: true });
  },

  shortName(id) {
    const s = (id || 'Controller').replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    return s.length > 32 ? s.slice(0, 32) + '…' : (s || 'Controller');
  },

  toast(text) {
    const t = document.getElementById('padToast'); if (!t) return;
    t.textContent = text; t.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('on'), 2600);
  },

  /* the pad to read: the last one used, else the first with the standard layout */
  get() {
    const list = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!list) return null;
    if (this.index >= 0 && list[this.index] && list[this.index].connected) return list[this.index];
    for (const gp of list) if (gp && gp.connected && gp.mapping === 'standard') { this.index = gp.index; return gp; }
    for (const gp of list) if (gp && gp.connected) { this.index = gp.index; return gp; }
    return null;
  },

  /* drop anything held (pad unplugged, window blurred) */
  release() {
    if (this._jump) { Input.releaseJump(); Input.down.jump = false; this._jump = false; }
    if (this._cam) { Cam.dragging = false; Cam.releaseT = 1.0; this._cam = false; }
    this.steer = null; this.stickY = 0; this.lt = this.rt = 0; this.grab = null;
  },

  rumble(strong, weak, ms) {
    const gp = this.get();
    const a = gp && gp.vibrationActuator;
    if (!a || !a.playEffect) return;
    try { a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch (e) { }
  },

  poll(dt) {
    const gp = this.get();
    if (!gp) { if (this.active) { this.release(); this.active = false; } return; }
    const B = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    const V = (i) => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);
    const now = [];
    for (let i = 0; i < 17; i++) now[i] = B(i);
    const edge = (i) => now[i] && !this.prev[i];
    const stick = (x, y) => {                                 // radial dead zone, rescaled to 0..1
      x = x || 0; y = y || 0;
      const m = Math.hypot(x, y);
      if (m < PAD_DZ) return [0, 0];
      const k = Math.min(1, (m - PAD_DZ) / (1 - PAD_DZ)) / m;
      return [x * k, y * k];
    };
    const [lx, ly] = stick(gp.axes[0], gp.axes[1]);
    const [rx, ry] = stick(gp.axes[2], gp.axes[3]);
    const lt = V(6), rt = V(7);
    if (now.some(Boolean) || lx || ly || rx || ry || lt > 0.1 || rt > 0.1) {
      this.active = true;
      if (Game.state === 'play' || Game.state === 'menu') document.body.classList.add('pad');
      Audio.init(); Audio.resume();
    }
    const st = Game.state;
    // a button still held from the menu (A that dropped us in) must not act in the run
    if (st !== this._lastState) {
      if (st === 'play') { this._jump = now[0]; this.prev = now.slice(); }
      this._lastState = st;
    }

    if (st === 'play') {
      this.steer = lx ? lx : (now[14] ? -1 : now[15] ? 1 : null);
      this.stickY = ly || (now[12] ? -1 : now[13] ? 1 : 0);
      this.lt = lt; this.rt = rt;                               // triggers: brake / tuck (and flips in the air)
      this.grab = now[2] ? 'Indy' : now[1] ? 'method' : now[3] ? 'stale' : (now[4] || now[5]) ? 'mute' : null;
      // A = Space: hold to load, release to ollie
      if (now[0] && !this._jump && !this.prev[0]) {
        this._jump = true;
        if (!Input.down.jump) { Input.jumpHeld = true; Input.chargeT = 0; }
        Input.down.jump = true;
      } else if (!now[0] && this._jump) {
        this._jump = false; Input.releaseJump(); Input.down.jump = false;
      }
      if (edge(9)) Game.togglePause();
      if (edge(8)) Game.restart(true);
      // right stick orbits the camera (springs back like the mouse orbit)
      if (rx || ry) { Cam.dragging = true; this._cam = true; Cam.drag(rx * dt * 700, ry * dt * 520); }
      else if (this._cam) { Cam.dragging = false; Cam.releaseT = 1.0; this._cam = false; }
    } else {
      if (this._jump || this._cam || this.steer !== null) this.release();
      // menus: D-pad / left stick to choose, A to confirm, B to back out
      this._navT -= dt;
      const left = now[14] || lx < -0.6, right = now[15] || lx > 0.6;
      const nav = (left || right) && this._navT <= 0 ? (left ? -1 : 1) : 0;
      if (!left && !right) this._navT = 0;
      if (nav) this._navT = 0.28;
      if (st === 'menu' && Game.editingLayout) {
        if (edge(1) || edge(9) || edge(0)) TouchLayout.closeEditor();
      } else if (st === 'menu' && Game.customizing) {
        if (edge(1) || edge(9)) Customize.close();
        else if (edge(2)) { Outfit.randomize(); Customize.sync(); }
        else if (edge(4) || edge(5)) this.cyclePreset(edge(5) ? 1 : -1);
      } else if (st === 'menu') {
        if (nav) this.cycleLevel(nav);
        if (edge(0) || edge(9)) { Game.menuAt = -1e9; Input.anyKey = true; }
        else if (edge(3)) Customize.open();
      } else if (st === 'pause') {
        if (edge(0) || edge(9)) Game.togglePause();
        else if (edge(8)) Game.restart(true);
        else if (edge(1)) Game.toMenu();
      } else if (st === 'over') {
        if (nav) this.cycleLevel(nav);
        if (edge(0) || edge(9) || edge(8)) Game.restart(true);
        else if (edge(1)) Game.toMenu();
      }
    }
    this.prev = now;
  },

  cycleLevel(d) {
    const i = PAD_LEVELS.indexOf(Level.cur.id);
    Game.selectLevel(PAD_LEVELS[(i + d + PAD_LEVELS.length) % PAD_LEVELS.length]);
    Audio.ui(500);
  },

  cyclePreset(d) {
    const names = Object.keys(OUTFIT_PRESETS);
    const i = Math.max(0, names.indexOf(Outfit.presetName()));
    Outfit.applyPreset(names[(i + d + names.length) % names.length]);   // applyPreset saves
    Customize.sync();
  }
};
