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

- Paddle out (W) through the whitewater, duck diving (Space) just before each line of foam hits.
- Sit in the lineup; when a set comes, turn to face the beach (A/D), paddle about two seconds before it
  reaches you, and pop up (Space) once it's carrying you.
- Ride: A/D carve, W pump, S stall to let the curl catch you for the barrel, Space off the lip for an air.
- Three waves a session; tubes score the most. Touch: drag the left half to steer/paddle, ACTION button.

The breaking wave is a swept cross-section (`surf/js/ocean.js`): back → crest → lip → curtain → wall → trough,
so the barrel genuinely overhangs and the rider physics uses the same surface you see.
`python3 tools/build_single.py surf` writes `dist/swell-line.html`. Headless checks:
`node surf/test/ride.js` (physics), `node surf/test/session.js` (a bot plays a full session in Chromium).
