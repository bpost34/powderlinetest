# Test sims and browser checks

Dev-only scripts used while tuning POWDER LINE. Nothing here ships in the game.

## Setup

The harness needs the `quickjs` Python package. Install it locally (ignored by git):

    pip3 install --target test/sims/pylib quickjs==1.19.4
    PYTHONPATH=test/sims/pylib python3 test/harness.py

## Node physics sims (run from the repo root, pass the repo path)

    node test/sims/mc.js "$PWD"        # Monte Carlo trick land rates (Flick execution error)
    node test/sims/speed.js "$PWD"     # mountain top speeds incl. pump spam
    node test/sims/ollie.js "$PWD"     # manual ollie tap / hold heights
    node test/sims/pureflip.js "$PWD"  # flips vs stray spin from carve / stick drift
    node test/sims/press.js "$PWD"     # press balance: idle slip time, reactive hold, spin drift
    node test/sims/cx.js "$PWD"        # steepest piste bends per run length

`s_*.js` are seeded regression sims (diff output against `git archive HEAD js` extracted
elsewhere); `hop` and `railcatch` take their path differently and may need editing.

## Browser checks (headless Chrome, muted)

    python3 test/sims/serve.py .          # threaded static server on 127.0.0.1:8765
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
      --remote-debugging-port=9333 --mute-audio --user-data-dir=/tmp/pl-chrome about:blank &
    node test/sims/lmc.js out           # Flick pipe run: launch meter, planning, auto grab

Bump the `?v=` tags in index.html before browser-testing JS edits — Chrome's memory
cache keeps old scripts under the same tag.
