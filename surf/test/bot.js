// A simple surfer bot (runs in the page): paddles out, duck dives, waits, turns, catches, trims.
// Returns raw controls (positive steer turns yaw up; Game.update takes it as is).
function botInput(t, st) {
  const S = Surfer, P = S.pos, q = S.q || {}, In = { steer: 0, up: 0, down: 0, actionPressed: false };
  st.cool = (st.cool || 0) - 1 / 60;
  const face = (yaw) => clamp(angDelta(S.yaw, yaw) * 2, -1, 1);
  if (S.mode === 'wipe') { if (st.cool <= 0) { In.actionPressed = true; st.cool = 0.25; } }
  else if (S.mode === 'prone') {
    const m = Game.main;
    if (m && m.zw < P.z + 1) {
      In.steer = face(0);
      if (P.z - m.zw < 10.5) In.up = 1;
      if (S.canPop()) In.actionPressed = true;
    } else {
      In.steer = face(Math.PI); In.up = P.z > SEA.LINEUP[1] - 3 ? 1 : 0;
      for (const w of Ocean.waves) {
        if (w.zw > P.z) continue;
        Ocean.profile(w, P.x, Ocean._P);
        const front = Ocean._P.zT;
        if ((Ocean._P.foamAmt > 0.3 || Ocean._P.lam > 0.1) && P.z - front < 3.0 && P.z - front > 0 && S.duckCool <= 0) In.actionPressed = true;
      }
    }
  } else if (S.mode === 'ride' || S.mode === 'popup') {
    const w = S.rideWave, dir = Math.sign(P.x - w.xPeak) || 1;
    const frac = q.wave ? (P.y - q.yT) / q.H : 0.5;
    const want = Math.atan2(dir * 7, SEA.C + clamp((frac - (S.covered ? 0.2 : 0.45)) * 8, -4, 4));   // low and deep in the tube
    const weave = Math.sin(t * 1.3) * 0.3;
    In.steer = S.mode === 'popup' ? 0 : clamp(angDelta(S.yaw, want + weave) * 2.5, -1, 1);
    const age = Ocean.age(w, P.x);
    In.down = (typeof TUBE !== 'undefined' && TUBE) ? (age < 0.3 ? 0.8 : 0) : age < -0.6 && frac > 0.35 && frac < 0.7 ? 0.5 : 0;
    In.up = age > 0.6 ? 1 : 0;
  }
  return In;
}
