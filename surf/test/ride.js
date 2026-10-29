// Headless: lie in the lineup, paddle for a set wave, pop up, and trim along it with a simple bot.
// node surf/test/ride.js [xOffsetFromPeak] [stallInTube]
const load = require('./load');
const xoff = +(process.argv[2] || -3), stallTube = process.argv[3] === '1';
const c = load(['ocean', 'surfer'], `
var Fx={emit(){}};var log=[];
var Game={onDuckedUnder(){log.push('ducked')},onWashed(){log.push('washed')},onTooEarly(){log.push('too early')},onDuck(){},
 onPopUp(s){log.push('POPUP steep '+s.toFixed(2))},onPump(){},ridePts(){},trick(n,p){log.push(n+' +'+p)},onTubeIn(){log.push('TUBE in')},
 onTubeOut(t){log.push('TUBE out '+t.toFixed(2)+'s')},onAir(){log.push('air')},onLand(){log.push('land')},
 onWipe(r){log.push('WIPE '+r)},onSurface(){},onRideEnd(r){log.push('END '+r)}};
this.__g={Game,log,Surfer};`);
const { Ocean, SEA } = c.__x, { Surfer: S, log } = c.__g;
Ocean.reset(); S.reset(0, -121); S.yaw = 0;
const w = Ocean.spawn({ zw: SEA.ZB - 75, H0: 3.0, xPeak: -xoff, vp: 6.5, main: true });
const dt = 1 / 60; let t = 0, printed = 0, popped = false, dir = 0;
for (; t < 40; t += dt) {
  Ocean.update(dt);
  const q = S.q || {}; const In = { steer: 0, up: 0, down: 0, actionPressed: false };
  if (S.mode === 'prone') {
    if (!popped && w.zw > S.pos.z - 12) In.up = 1;
    if (!popped && q.wave && q.gz < -0.12 && S.vz > 0.8 * SEA.C) In.actionPressed = true;
  } else if (S.mode === 'ride' || S.mode === 'popup') {
    popped = true;
    if (!dir) dir = Math.sign(S.pos.x - w.xPeak) || 1;
    const frac = q.wave ? (S.pos.y - q.yT) / q.H : 0.5;
    // aim: along the line, a bit down when high, up when low
    // aim in the wave's frame: along the line at ~7 m/s, while the wave carries you shoreward
    const want = Math.atan2(dir * 7, SEA.C + clamp((frac - 0.5) * 8, -4, 4));
    In.steer = S.mode === 'popup' ? 0 : clamp(angDelta(S.yaw, want) * 2.5, -1, 1);
    if (stallTube) In.down = Ocean.age(w, S.pos.x) < 0.25 ? 0.9 : 0;
  }
  S.step(dt, In);
  if (t - printed > 0.5 && (w.zw > -140)) {
    printed = t; const q = S.q;
    console.log(`t ${t.toFixed(1)} ${S.mode.padEnd(6)} x ${S.pos.x.toFixed(1).padStart(6)} z ${S.pos.z.toFixed(1)} zr ${(q.wave ? S.pos.z - q.zw : 0).toFixed(1).padStart(5)} y ${S.pos.y.toFixed(2)} v ${S.speed().toFixed(1)} vz ${S.vz.toFixed(1)} age ${Ocean.age(w, S.pos.x).toFixed(2)} foam ${(q.foam||0).toFixed(2)} cov ${S.covered} ${log.splice(0).join(' | ')}`);
  }
  if (popped && S.mode === 'prone') break;
}
console.log(log.join(' | '));
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function angDelta(a, b) { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; }
