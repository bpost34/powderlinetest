/* =====================================================================
   outfit.js — the rider's colours. One RGB per palette slot (RS.* in
   meshes.js); the rider shader reads Outfit.palette as a uniform array, so
   changing a colour is instant and never rebuilds a mesh.
   The player's choice lives in localStorage ('powderline.outfit') and is
   loaded at the bottom of this file, before game.js boots.
   ===================================================================== */
'use strict';

const OUTFIT_DEFAULTS = {
  [RS.JACKET]: '#f5661a', [RS.ACCENT]: '#ffd638', [RS.PANTS]: '#1c243d', [RS.GLOVES]: '#16161b',
  [RS.HELMET]: '#2c2f38', [RS.LENS]: '#ff8a1f', [RS.BOOTS]: '#33343d', [RS.BOARD_TOP]: '#0f9ebd',
  [RS.BOARD_BASE]: '#f4efe5', [RS.BINDING]: '#1a1c24', [RS.TRIM]: '#1a1c26', [RS.MASK]: '#2a2c33'
};

/* The user-facing items, in menu order. TRIM and MASK aren't listed: they
   follow PANTS and HELMET (see derive()). */
const OUTFIT_ITEMS = [
  [RS.JACKET, 'Jacket'], [RS.ACCENT, 'Accent'], [RS.PANTS, 'Pants'], [RS.GLOVES, 'Gloves'],
  [RS.HELMET, 'Helmet'], [RS.LENS, 'Goggles'], [RS.BOOTS, 'Boots'], [RS.BOARD_TOP, 'Board top'],
  [RS.BOARD_BASE, 'Board base'], [RS.BINDING, 'Bindings']
];

/* Named looks. Order: jacket, accent, pants, gloves, helmet, lens, boots,
   board top, board base, bindings (TRIM / MASK are derived). */
const OUTFIT_PRESETS = {
  Classic: null,   // = OUTFIT_DEFAULTS
  Stealth: ['#18191d', '#2c2e35', '#111216', '#0c0c0f', '#1d1f24', '#33e4ff', '#17181c', '#1b1c21', '#33e4ff', '#0e0f12'],
  Neon: ['#7b3fe4', '#19f0c8', '#ff2d95', '#19f0c8', '#fff04a', '#ff6a00', '#2b1b4d', '#ffe14a', '#19f0c8', '#ff2d95'],
  Race: ['#f2f3f5', '#e0162b', '#c8102e', '#e0162b', '#f2f3f5', '#ffc21a', '#f2f3f5', '#e0162b', '#15171c', '#f2f3f5'],
  Forest: ['#3f5a35', '#d9a441', '#b49a70', '#5a3d26', '#2f3a2a', '#e8b04a', '#4a3322', '#6e8b3d', '#ece3cf', '#2a2a24'],
  Glacier: ['#a9d8f0', '#ffffff', '#eef3f8', '#2c4a63', '#f6f8fb', '#7a5cff', '#2c4a63', '#1c6fa8', '#a9d8f0', '#eef3f8']
};

const OUTFIT_KEY = 'powderline.outfit';
const OUTFIT_HEX = /^#[0-9a-f]{6}$/i;

const Outfit = {
  palette: new Float32Array(RS_COUNT * 3),   // linear-ish 0..1 rgb per slot (as the old vertex colours were)
  hex: {},

  /* '#rrggbb' → palette entry */
  set(slot, hex) {
    this.hex[slot] = hex;
    const n = parseInt(hex.slice(1), 16);
    this.palette[slot * 3] = ((n >> 16) & 255) / 255;
    this.palette[slot * 3 + 1] = ((n >> 8) & 255) / 255;
    this.palette[slot * 3 + 2] = (n & 255) / 255;
  },

  reset() { for (const k in OUTFIT_DEFAULTS) this.set(+k, OUTFIT_DEFAULTS[k]); },

  /* TRIM (cuffs, zips, collar) is a darker shade of the pants, MASK a shade of the helmet */
  derive() {
    this.set(RS.TRIM, hexShade(this.hex[RS.PANTS], 0.62));
    this.set(RS.MASK, hexShade(this.hex[RS.HELMET], 0.9));
  },

  /* a user edit from the customise panel: set, keep the derived slots in step, persist */
  pick(slot, hex) {
    if (!OUTFIT_HEX.test(hex)) return;
    this.set(slot, hex.toLowerCase());
    if (slot === RS.PANTS || slot === RS.HELMET) this.derive();
    this.save();
  },

  applyPreset(name) {
    const p = OUTFIT_PRESETS[name];
    if (p === undefined) return false;
    if (!p) this.reset();
    else { OUTFIT_ITEMS.forEach(([slot], i) => this.set(slot, p[i])); this.derive(); }
    this.save();
    return true;
  },

  /* the preset the current colours match exactly, or null */
  presetName() {
    for (const name in OUTFIT_PRESETS) {
      const p = OUTFIT_PRESETS[name];
      if (OUTFIT_ITEMS.every(([slot], i) => this.hex[slot] === (p ? p[i] : OUTFIT_DEFAULTS[slot]))) return name;
    }
    return null;
  },

  /* A harmonious random outfit: one base hue for the jacket, the accent near
     its complement, pants either a dark neutral or a light contrast, and the
     hardware (gloves, boots, bindings) mostly dark so the colours read. */
  randomize() {
    const r = Math.random, pickOf = (a) => a[Math.floor(r() * a.length)];
    const h = r() * 360, comp = h + 180 + (r() - 0.5) * 50;
    const darkN = () => hslHex(h + 180 + (r() - 0.5) * 60, 0.12 + r() * 0.2, 0.1 + r() * 0.09);
    const jacket = hslHex(h, 0.55 + r() * 0.35, 0.42 + r() * 0.18);
    const accent = hslHex(comp, 0.75 + r() * 0.25, 0.55 + r() * 0.12);
    const pants = r() < 0.65 ? hslHex(h + 180 + (r() - 0.5) * 80, 0.2 + r() * 0.35, 0.13 + r() * 0.12)
      : hslHex(h + (r() - 0.5) * 40, 0.1 + r() * 0.2, 0.82 + r() * 0.1);
    const helmet = pickOf([darkN(), '#f2f3f5', jacket, hslHex(h, 0.15, 0.22)]);
    const lens = hslHex(pickOf([comp, h + 120, h - 120, 30, 190]), 0.9, 0.55);
    const vals = [
      jacket, accent, pants,
      r() < 0.7 ? darkN() : accent,                 // gloves
      helmet, lens,
      darkN(),                                      // boots
      hslHex(h + pickOf([120, -120, 180, 0]), 0.6 + r() * 0.35, 0.4 + r() * 0.2),   // board top
      r() < 0.5 ? hslHex(h, 0.15, 0.9) : accent,    // board base
      r() < 0.75 ? darkN() : accent                 // bindings
    ];
    OUTFIT_ITEMS.forEach(([slot], i) => this.set(slot, vals[i]));
    this.derive();
    this.save();
  },

  /* ---------------- persistence (never let blocked storage break the game) ---------------- */
  save() {
    const o = {};
    for (const name in RS) o[name] = this.hex[RS[name]];
    try { localStorage.setItem(OUTFIT_KEY, JSON.stringify(o)); } catch (e) { }
  },

  /* defaults, then whatever valid colours were saved; true if a saved outfit was found */
  load() {
    this.reset();
    let o = null;
    try { o = JSON.parse(localStorage.getItem(OUTFIT_KEY) || 'null'); } catch (e) { o = null; }
    if (!o || typeof o !== 'object') return false;
    for (const name in RS) if (typeof o[name] === 'string' && OUTFIT_HEX.test(o[name])) this.set(RS[name], o[name].toLowerCase());
    return true;
  }
};

/* '#rrggbb' scaled towards black by f (0..1) */
function hexShade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * f).toString(16).padStart(2, '0');
  return '#' + c((n >> 16) & 255) + c((n >> 8) & 255) + c(n & 255);
}
/* hue in degrees (any range), s / l 0..1 → '#rrggbb' */
function hslHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s = Math.min(1, Math.max(0, s)); l = Math.min(1, Math.max(0, l));
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

Outfit.load();
