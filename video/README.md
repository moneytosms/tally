# tally launch film

A 42 s, 1920x1080, 30 fps launch film built entirely in code. No screen recordings, no stock assets.

- `scene.html` / `scene.css` / `scene.js`: every frame is a pure function of time. `window.seek(t)` renders the exact state at `t` seconds (no rAF, no CSS transitions).
- `timeline.cjs`: shared timings (scenes, stamps, punch, kolam morph, flips). Used by the scene and the score so sound effects line up with picture.
- `music.mjs`: procedural score and SFX, written to `video/out/music.wav`.
- `render.mjs`: Playwright seeks and screenshots every frame, then ffmpeg encodes.
- `fonts/`: Anek Latin and Anek Devanagari variable woff2 (wght + wdth axes), copied from `@fontsource-variable`.

## Re-render

```bash
node video/music.mjs && node video/render.mjs
```

Outputs go to `site/public/video/`: `tally-launch.mp4` (H.264 + AAC), `tally-launch.webm` (VP9 + Opus), `tally-launch-poster.jpg`.
Frames are written to a temp dir (set `TALLY_VIDEO_TMP` to change it). Needs `playwright` (with Chromium) and `ffmpeg`. A full render takes about 3 minutes.

Preview stills and a contact sheet without a full render:

```bash
node video/render.mjs --samples 1,6.5,13.7,20.6,26.8,38
```

## Music

The music is procedurally generated in this repo (raag Bhupali, tanpura-style drone, plucked melody, soft tabla-style thumps, SFX). It contains no third-party audio or samples and is MIT like the rest of the repo.
