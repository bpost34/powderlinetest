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
