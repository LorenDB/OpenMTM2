# Handoff: VR cab reconstruction

Paste everything below the line into a new session started in `/home/loren/code/OpenMTM2`.

---

You are continuing work on **OpenMTM2**, an open reimplementation of Monster Truck Madness 2 (retail 2.00.42) that runs in the browser on the player's own install. Read `AGENTS.md`, `docs/VR.md` (the headset spec, including "The cab"), `docs/ARCHITECTURE.md` (the "headset" section), and `src/game/vr/cab.js` (the pure cab rules) before changing anything.

## Rules that matter

- Clean room: a `re/` dir is git-ignored and must never be published, copied into `src/`, or quoted in commits. It does not exist on this machine. Facts from the local install go into the docs first (`docs/VR.md`), then the code is written from the docs. **No game data in the repository**: read the install, never copy it in.
- The stock install is at `~/games/mtm2` (a symlink to the real folder). Tests that need it use `tests/helpers/stock.mjs` and skip without it.
- File formats and the simulation belong in OpenPhotex, vendored read-only at `src/vendor/openphotex/`. Never edit it. Nothing in this task should need format changes: crops come from already-decoded panels at run time via canvas `drawImage`.
- Only `src/render/**` imports three.js. `src/worker/**` and `src/game/**` (except `game/input/`) must not touch the DOM or three.js, so they run under Node in tests. Pure cab rules live in `src/game/vr/`; drawing lives in `src/render/xr/`. Units in game code are feet, seconds, radians.
- Tests: `node --test "tests/*.test.mjs"` (Node 22.18+; this machine has v24). Every behaviour taken from the docs gets a test. New imports must be plain static strings (`tests/app-files.test.mjs` enforces this for the offline copy crawler).
- Writing: no em dashes in docs, comments or READMEs. Commit only when the user asks, with no co-author or attribution trailers.
- Do not chase the Torture Pit autopilot sim failure (`tests/sim-session.test.mjs`): it fails on the clean tree too and is not a priority.

## State

`main` is 7 commits ahead of `origin/main` (there is no `upstream` remote; `origin/main` is upstream). From oldest:

1. `3de019c` 6DOF VR mode (Muse).
2. `ab945a0` VR cab style option: `cabStyle` `model`/`panels`; the stock panels hung as a box (Muse).
3. `ab59b90` modeled cab from the layout rects: wheel mount follows the dash, stalk, shift light, mirror frame (Muse).
4. `4393c9d` detailed reconstruction from the stock art: gated shifter plate, switch box, bottle, net, tread, braces, clamps, rear box (Muse).
5. `ca48a9a` second art pass (GLM): warning panels, fuel sticker, aux bank behind the plate, art-cropped net/headliner/skin/foam textures, leaning painted pillars, peaked rear frame, riveted skin, dome light, extinguisher, fuse box, bucket seat.
6. `2a87622` correctness fixes (GLM): skinned quads needed UVs, clamp collars follow the pillar lean, dash layers sort by distance, net hung from the window brace, seat pedestal.
7. `103ce76` mirror glass backing, gauge housings clear of the faces (GLM).

**Uncommitted on top of that (2026-10-09): the modelled cab was rebuilt from the pictures' own camera.** Read `docs/VR.md` from "The cab" through "The stock panels" before touching it; the short version:

- The four panels are one cab seen from the eyes with a focal length of 240 px (90 degrees tall, 106 wide), a quarter turn apart. `src/game/vr/cab.js` has that camera (`panelRay`, `panelPoint`, `panelPixel`, `panelFacing`). The earlier cab mapped the dash at about 60 degrees and made the cage as wide as the body; rendered from the eye it looked nothing like the art.
- `src/game/vr/cab-cage.js` is the cage and fittings as read off the pictures: every member is "this pixel of this panel, on this plane". `src/render/xr/vr-cab.js` builds it (13k triangles, 25 draw calls) with `src/render/xr/cab-kit.js`. The lower walls are the pictures themselves, texture coordinates taken through the camera; fittings are cut out again in front.
- `CAB_SCALE` (1.25) is the one number for "too tight" or "too toy-like": the art fixes directions, not size.
- The shifter plate stands by the driver's right hand, not at the layout's rectangle (which is over the gauge bank). The game's gear readout is printed under the dash where the game prints it.
- The stock panels box (`cabStyle: panels`) is hung through the same camera now, instead of 90 degrees per picture.
- The cab is unlit and dims with the weather (`update`'s `light`, from `weatherScene.lightLevel()`).

The work: `src/game/vr/cab.js` (needles, the pictures' camera, the layout's pieces), `src/game/vr/cab-cage.js` (the cage), both tested in `tests/vr-cab.test.mjs`; `src/game/vr/panels.js` (the panels box, `tests/vr-panels.test.mjs`); `src/render/xr/vr-cab.js` and `cab-kit.js` (the modelled cab), `src/render/xr/vr-panels.js` (the stock-art box), wired in `src/render/xr/race-vr.js` and `src/ui/screens/race.js`, options in `src/ui/options-panel.js` and the in-headset VR options menu. Spec in `docs/VR.md` ("The cab", "Options", "The HUD").

Known-good: 243 tests, 242 pass (the 1 fail is the pre-existing sim flake above); the headless smoke test builds/updates/disposes both cab styles on 8 stock trucks x both looks (rerun: `/tmp/opencode/smoke-vr-cab.mjs`, needs three.js resolvable, see below).

## On this machine

- GPG signing hangs headless. Commit with `GIT_EDITOR=true git -c commit.gpgsign=false commit -m "..."`; rebase with `GIT_EDITOR=true git -c commit.gpgsign=false rebase --continue`.
- `three@0.169.0` lives in `/tmp/opencode/node_modules` (npm has network). The smoke test needs it resolvable: `ln -sfn /tmp/opencode/node_modules node_modules && node /tmp/opencode/smoke-vr-cab.mjs; rm node_modules`. Scratch scripts in `/tmp/opencode/` (art extraction, measurement, color sampling); extracted PNGs in `/tmp/opencode/cockpit/`.
- ImageMagick (`magick`) and Python PIL are available for art inspection; `Read` opens images.
- **Look at the cab before changing it.** `/tmp/opencode/cab-harness/` renders the real `vr-cab.js` with the real art in headless Chromium, from the eye through the pictures' camera, beside the stock panels: `node dump-art.mjs h/art.json` once (and `dump-body.mjs h/bodies.json BIGFOOT.TRK ...` for body shells), then `node shoot.mjs '{"prefix":"n"}' && ./cmp.sh n` writes `out/cmp-n-a.png` and `-b.png`; `shoot.mjs views.json` and `final.json` take headset-like, leaning and in-body shots; `sketch.mjs <spec>` overlays candidate tubes on the panels; `tiles.py` and `rowscan.py` measure the art. It needs `playwright-core` (it imports one from a scratch `node_modules`; fix the path in `shoot.mjs` if that is gone) and the Chromium under `~/.cache/ms-playwright`. `/tmp` does not survive a reboot: rebuild it from this description if it is missing.

## What to do next (ranked)

1. **Sign-off in a headset.** The cab now matches the pictures from the eye, but only flat renders have been seen. Judge `CAB_SCALE`, bars this near the head, the pictures on the lower walls as the head moves, and the shifter's place.
2. **Live mirror.** The mirror is frame + dark glass. A live view needs a second render of the scene each frame (`src/ui/screens/race.js` already renders a mirror target for the flat cockpit). Real work, real payoff in the cab view.
3. **A modelled shifter lever** in place of the frame art's flat one, moving through the gate with the gear.
4. **The left side's front corner.** The left panel's columns 500 to 640 (dark tubes, a padded bar, grey shapes under the dash) are not understood and are left as plain tread plate.
5. **Harness straps, pedals.** No picture shows them: the port's own if done.
6. Sync with `origin/main` if it moved (`git fetch`, rebase the local stack onto it, resolving the `cockpit-art.js`/`race.js`-style overlaps the same way: keep both endpoints).
