# POWDER LINE

A from-scratch WebGL2 snowboarding game — procedural endless mountain, carve physics,
tricks (spins, flips, grabs), slalom gates. No engine, no assets, no build step.

**Play:** https://bpost34.github.io/powderlinetest/

- Desktop: keyboard (A/D carve, W tuck/front flip, S brake/back flip, Space ollie, J K L ; grabs),
  right/middle-drag to orbit the camera, wheel to zoom.
- Phone/tablet: on-screen steering pad and buttons; optional tilt steering (toggle on the start screen).

`dist/powder-line.html` is the whole game in one self-contained file (double-click to play offline).
Rebuild it after changes with `python3 tools/build_single.py`. Headless tests: `python3 test/harness.py`
(needs `pip install quickjs`).

## SWELL LINE (surf)

A sister game in [`surf/`](surf/) — same no-engine WebGL2 approach, but on water.
**Play:** https://bpost34.github.io/powderlinetest/surf/

- You start sitting in the lineup facing the beach. When a set stands up behind you the rider strokes into it;
  press Space (early is fine — it waits) and you pop up as it lifts you.
- Ride: A/D carve, W pump, S stall to let the curl catch you for the barrel, Space off the lip for an air.
- The coastline repeats endlessly along the shore, and the reef is long: a full ride lasts about half a minute.
- Three waves a session; tubes score the most. Touch: drag the left half to steer/paddle, ACTION button.

The breaking wave is a swept cross-section (`surf/js/ocean.js`): back → crest → lip → curtain → wall → trough,
so the barrel genuinely overhangs and the rider physics uses the same surface you see.
The open sea's wind chop, glitter and whitecaps are a Tessendorf FFT ocean (`surf/js/fft.js`) ported to WebGL2
from [web-ocean](https://github.com/noniv/web-ocean) by Maksymilian Dendura (MIT; notice kept in the file);
browsers without float render targets fall back to procedural ripples.
`python3 tools/build_single.py surf` writes `dist/swell-line.html`. Headless checks:
`node surf/test/ride.js` (physics), `node surf/test/session.js` (a bot plays a full session in Chromium).
