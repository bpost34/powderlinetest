// Browser check: serve the repo, load surf/, screenshot a few staged moments, report console errors.
// node surf/test/shots.js <outdir>
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'), out = process.argv[2] || '/tmp/surfshots';
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(8766);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await pg.goto('http://127.0.0.1:8766/surf/');
  await pg.waitForTimeout(2500);
  await pg.screenshot({ path: out + '/0-menu.png' });
  const stage = async (name, js, wait = 600) => {
    await pg.evaluate(js); await pg.waitForTimeout(wait); await pg.screenshot({ path: out + '/' + name + '.png' });
  };
  await stage('1-paddle', `Game.start()`, 1500);
  // a wave pitching right in front of a rider in the lineup, seen side-on
  for (const [nm, a] of [['2-barrel-side', 0.55]]) {
    await stage(nm, `(() => { Game.start(); Ocean.reset(); Surfer.reset(0, -118); Surfer.yaw = 0;
      const w = Ocean.spawn({ zw: -125, H0: 3.1, xPeak: -6, vp: 6.5, main: true, sec: 0 }); Game.main = w; Game.sideSign = 1;
      Ocean.t = w.tb0 + ${a}; w.zw = -112 + 5.2 * ${a}; Game.state = 'pause'; Game.snapCam();
      V3.set(Cam.pos, 14, 3.5, -100); V3.set(Cam.tgt, -6, 1.2, -110); })()`);
  }
  // riding inside the tube
  await stage('3-tube', `(() => { Game.state = 'play'; Ocean.reset(); const w = Ocean.spawn({ zw: -125, H0: 3.1, xPeak: 0, vp: 6.5, main: true, sec: 0 });
      Ocean.t = w.tb0 + 3; w.zw = -112 + 5.2 * 3;  // peel point ~19.5 m from the peak
      const x = -16.5; Surfer.reset(x, w.zw + 0.5); Surfer.mode = 'ride'; Surfer.yaw = -Math.PI / 2 + 0.2; Surfer.vx = -6.5; Surfer.vz = 5.2;
      Surfer.step(1/60, {steer:0,up:0,down:0,actionPressed:false}); Game.riding = true; Game.tubeCam = 1; V3.set(Game.camDir, -1, 0, 0);
      Game.state = 'pause'; Game.camera(1/60, true); })()`);
  await stage('4-ride-open', `(() => { Ocean.reset(); const w = Ocean.spawn({ zw: -125, H0: 3.1, xPeak: 0, vp: 6.5, main: true, sec: 0 });
      Ocean.t = w.tb0 + 2; w.zw = -112 + 5.2 * 2; const x = 18; Surfer.reset(x, w.zw + 1.6); Surfer.mode = 'ride'; Surfer.yaw = Math.PI / 2 - 0.3; Surfer.vx = 7; Surfer.vz = 5.2;
      for (let i=0;i<5;i++) Surfer.step(1/60, {steer:0,up:0,down:0,actionPressed:false}); Game.tubeCam = 0; V3.set(Game.camDir, 1, 0, 0);
      Game.camera(1/60, true); })()`);
  await stage('5-from-beach', `(() => { V3.set(Cam.pos, 25, 6, -40); V3.set(Cam.tgt, 0, 1, -105); })()`);
  await stage('6-closeup-rider', `(() => { const P = Surfer.pos; V3.set(Cam.pos, P.x + 2.2, P.y + 1.4, P.z + 2.6); V3.set(Cam.tgt, P.x, P.y + 0.8, P.z); })()`);
  await stage('7-prone', `(() => { Game.state = 'play'; Ocean.reset(); Surfer.reset(0, -80); Surfer.yaw = Math.PI; Surfer.paddling = 1; Surfer.phase = 1;
      for (let i=0;i<30;i++) Surfer.step(1/60, {steer:0,up:1,down:0,actionPressed:false}); Game.state='pause';
      const P = Surfer.pos; V3.set(Cam.pos, P.x + 2.5, P.y + 1.6, P.z + 2.5); V3.set(Cam.tgt, P.x, P.y + 0.2, P.z); })()`);
  const perf = await pg.evaluate(`(() => { const t0 = performance.now(); for (let i = 0; i < 20; i++) Gfx.buildOcean(Cam.pos.x, Cam.pos.z); return ((performance.now() - t0) / 20).toFixed(2) + ' ms/buildOcean, rows ' + Gfx.oc.rows; })()`);
  console.log(perf);
  console.log(errs.length ? errs.join('\n') : 'no console errors');
  await b.close(); srv.close();
})();
