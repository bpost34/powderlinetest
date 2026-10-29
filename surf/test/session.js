// Plays a whole session in the browser with a bot driving the real Game loop (no rendering):
// paddle out, duck dive the whitewater, wait in the lineup, turn, paddle, pop up, ride. ×3 waves.
// node surf/test/session.js [seed]
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..');
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': p.endsWith('.js') ? 'text/javascript' : 'text/html' }); r.end(d); });
}).listen(8768);
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 800, height: 450 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('http://127.0.0.1:8768/surf/'); await pg.waitForTimeout(800);
  await pg.addScriptTag({ path: path.join(__dirname, 'bot.js') });
  const out = await pg.evaluate(`(() => {
    globalThis.TRACE = false; globalThis.T0 = 35.5; globalThis.T1 = 41; const log = [], S = Surfer; let t = 0, lastMode = '', lastPrompt = '';
    const wrap = (k) => { const f = Game[k].bind(Game); Game[k] = (...a) => { log.push(t.toFixed(1) + ' ' + k + ' z' + S.pos.z.toFixed(0) + ' st' + S.stamina.toFixed(2) + ' ' + a.map(x => typeof x === 'number' ? x.toFixed(2) : String(x).replace(/<small>.*$/, '')).join(' ')); return f(...a); }; };
    ['onDuck','onWashed','onDuckedUnder','onPopUp','trick','onWipe','onRideEnd','over'].forEach(wrap);
    Game.manual = true; Game.start(); Game.state = 'play';
    const dt = 1 / 60; const bst = {}; let offN = 0, frames = 0;
    for (let i = 0; i < 60 * 420 && Game.state === 'play'; i++, t += dt) {
      const P = S.pos, q = S.q || {}, In = botInput(t, bst);
      Game.update(dt, In);
      if (i % 300 === 0 && t > 20 && t < 80) log.push(t.toFixed(0) + ' DBG mode ' + S.mode + ' z ' + P.z.toFixed(0) + ' main ' + !!Game.main + ' riding ' + Game.riding + ' setT ' + Game.setT.toFixed(1) + ' resp ' + Game.respawnT + ' endT ' + Game.endT + ' waves ' + Ocean.waves.length);
      if (i % 10 === 0) {       // is the rider on screen? (project through the camera)
        Cam.set(16 / 9); const v = Cam.vp, x = P.x, y = P.y + 0.6, z = P.z;
        const cw = v[3] * x + v[7] * y + v[11] * z + v[15], nx = (v[0] * x + v[4] * y + v[8] * z + v[12]) / cw, ny = (v[1] * x + v[5] * y + v[9] * z + v[13]) / cw;
        const off = cw <= 0 || Math.abs(nx) > 0.95 || Math.abs(ny) > 0.95;
        if (off) { offN++; if (offN === 1 || offN % 30 === 0) log.push(t.toFixed(1) + ' OFFSCREEN mode ' + S.mode + ' cam ' + Game.camMode + ' ndc ' + nx.toFixed(2) + ',' + ny.toFixed(2) + ' w ' + cw.toFixed(1)); }
        frames++;
      }
      if (globalThis.TRACE && i % 9 === 0 && t > (globalThis.T0||40) && t < (globalThis.T1||140)) log.push(t.toFixed(0) + ' z ' + P.z.toFixed(1) + ' yaw ' + (S.yaw % 6.283).toFixed(2) + ' v ' + S.vz.toFixed(2) + ' in ' + JSON.stringify(In) + ' mode ' + S.mode + ' y ' + P.y.toFixed(2) + ' H ' + (q.H||0).toFixed(2) + ' vx ' + S.vx.toFixed(1) + ' foam ' + (q.foam||0).toFixed(2) + ' zr ' + (q.wave ? (P.z - q.zw).toFixed(1) : '-') + ' zT ' + (q.wave ? (q.zT - q.zw).toFixed(1) : '-') + ' last ' + S.lastHit + ' wid ' + (q.wave ? q.wave.id : '-'));
      if (S.mode !== lastMode) { log.push(t.toFixed(1) + ' mode ' + S.mode + ' z ' + P.z.toFixed(0)); lastMode = S.mode; }
      const [pr] = Game.prompt(); const pp = (pr || '').replace(/<small>.*$/, '');
      if (pp !== lastPrompt) { if (pp) log.push(t.toFixed(1) + ' prompt: ' + pp); lastPrompt = pp; }
    }
    log.push('offscreen samples ' + offN + '/' + frames); log.push('END state ' + Game.state + ' waves ' + Game.waveIdx + ' scores ' + Game.scores.join(',') + ' total ' + Game.total + ' t ' + t.toFixed(0));
    return log.join('\\n');
  })()`);
  console.log(out);
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close(); srv.close();
})();
