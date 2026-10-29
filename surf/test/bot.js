// A simple surfer bot (runs in the page): paddles out, duck dives, waits, turns, catches, trims.
// Returns raw controls (positive steer turns yaw up; Game.update takes it as is).
function botInput(t, st) {
  const S = Surfer, P = S.pos, q = S.q || {}, In = { steer: 0, up: 0, down: 0, actionPressed: false };
  st.cool = (st.cool || 0) - 1 / 60;
  const face = (yaw) => clamp(angDelta(S.yaw, yaw) * 2, -1, 1);
  if (S.mode === 'wipe') { if (st.cool <= 0) { In.actionPressed = true; st.cool = 0.25; } }
  else if (S.mode === 'prone') {
    // the game paddles for you in the lineup: just press Space once the set is close
    const m = Game.main;
    if (m && S.pos.z - m.zw < 12 && st.cool <= 0) { In.actionPressed = true; st.cool = 1.5; }
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
