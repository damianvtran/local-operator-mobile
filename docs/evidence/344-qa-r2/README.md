# QA round 2 — local-operator-mobile #344 (head b196798e)

Scratch evidence for `### QA report — round 2`. Not product code.

- `frames/` — 390×844 @3x CDP captures of the exported web build of b196798e.
  - `new-d2-<theme>-d2-{a,rail,b,c,d}.png`: D2 (collapsed → rail → expanded end → +2 rAF after Show less → +700 ms) on relay :4398. Strips: `d2-<theme>-strip.png`.
  - `key-d2-light-*`: same D2 sequence with Show less pressed by a real Enter key.
  - `new-m1-live-*`: Q2, two live deliveries on the new relay (echo arm, then notice arm). Strip: `live-new-strip.png`.
  - `old-m1-live-*`: the same two shapes on the 0.107.3 relay. Strip: `live-old-strip.png`.
- `results/` — probe JSON (password redacted), driver timelines (`m1-r2new.json`, `m1-r2old.json`) and `d3-contrast.txt`, which holds the pixel-sampled rail contrast.
- `rig/` — `capture2.mjs` (derived from the r1 `capture.mjs`), `m1_driver2.py`, `live2.sh`, and `lop_fake.py` (unchanged from r1).
