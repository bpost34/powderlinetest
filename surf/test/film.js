// Render a bot-played session in real time and save a frame every N seconds.
// node surf/test/film.js <outdir> [seconds] [every]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), out = process.argv[2] || '/tmp/surffilm';
const secs = +(process.argv[3] || 60), every = +(process.argv[4] || 3), stage = process.argv[5] || '';
fs.mkdirSync(out, { recursive: true });
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(d); });
}).listen(8769);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('http://127.0.0.1:8769/surf/'); await pg.waitForTimeout(600);
  await pg.addScriptTag({ path: path.join(__dirname, 'bot.js') });
  // drive the game clock ourselves at 1/30 s per frame so slow software GL still plays at game speed
  await pg.evaluate(`(() => { Game.manual = true; Game.start(); window.__bst = {}; window.__t = 0;
    window.TUBE = '${stage}' === 'tube'; if ('${stage}' === 'set' || '${stage}' === 'setL' || TUBE) { Ocean.reset(); Surfer.reset(0, -121); Surfer.yaw = 0; const pk = '${stage}' === 'setL' ? 5 : -5; Game.main = Ocean.spawn({ zw: SEA.ZB - 30, H0: 3.1, xPeak: pk, vp: 6.5, main: true }); Game.sideSign = pk < 0 ? 1 : -1; Surfer.sitMode = true; Game.snapCam(); }
    if ('${stage}' === 'deep') { Ocean.reset(); const w = Ocean.spawn({ zw: -125, H0: 3.2, xPeak: 0, vp: 6.5, main: true, sec: 0 }); Ocean.t = w.tb0 + 2.5; w.zw = SEA.ZB + 5.2 * 2.5;
      const x = 6.5 * (2.5 - 0.45); Surfer.reset(x, w.zw + 1.3); Surfer.mode = 'ride'; Surfer.rideWave = w; Game.main = w; Game.riding = true; Surfer.yaw = 0.92; Surfer.vx = 6.6; Surfer.vz = 5.2; V3.set(Game.camDir, 1, 0, 0); Game.tubeCam = 1; Surfer.step(1/60, {steer:0,up:0,down:0,actionPressed:false}); Game.snapCam(); }
    if ('${stage}' === 'pocket') { Ocean.reset(); const w = Ocean.spawn({ zw: -125, H0: 3.1, xPeak: 0, vp: 6.5, main: true, sec: 0.3, ph: 0 }); Ocean.t = w.tb0 + 2.2; w.zw = SEA.ZB + 5.2 * 2.2;
      const x = 6.5 * 2.2 - 0.4; Surfer.reset(x, w.zw + 1.6); Surfer.mode = 'ride'; Surfer.rideWave = w; Game.main = w; Game.riding = true; Surfer.yaw = 0.95; Surfer.vx = 7; Surfer.vz = 5.2; V3.set(Game.camDir, 1, 0, 0); Game.snapCam(); }
    window.__step = (n) => { for (let i = 0; i < n; i++) { const In = botInput(__t, __bst); Game.update(1/60, In); __t += 1/60; } Gfx.frame(Surfer); Game.hud(); }; })()`);
  let k = 0;
  for (let t = 0; t < secs; t += every) {
    await pg.evaluate(`__step(${Math.round(every * 60)})`);
    const info = await pg.evaluate(`Surfer.mode + ' ' + Game.camMode + ' z' + Surfer.pos.z.toFixed(0)`);
    const f = path.join(out, String(k++).padStart(3, '0') + '.png');
    await pg.screenshot({ path: f });
    console.log(f, (t + every).toFixed(0) + 's', info);
  }
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close(); srv.close();
})();
