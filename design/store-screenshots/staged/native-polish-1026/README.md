# Staged store refresh — native polish (2026-10-26)

**Status: STAGED, not the verified set.** The committed store screenshots at
`design/store-screenshots/{appstore-iphone-6.9,appstore-ipad-13,play-phone}/`
remain the verified, `capture.mjs --check`-green set. This directory holds a
refresh produced by the native-polish design pass, kept out of those paths so the
design-kit byte gate keeps passing: the frames here were composed in the
installed browser, and their bytes are not what the headless renderer emits.

| What | Count | Canvas |
|---|---|---|
| `app-captures/{iphone-max,ipad-13,play-phone}/` | 26 (9 / 9 / 8) | 1290 × 2796 / 2048 × 2732 / 1080 × 2340 |
| `frames/{appstore-iphone-6.9,appstore-ipad-13,play-phone}/` | 26 (9 / 9 / 8) | 1320 × 2868 / 2064 × 2752 / 1080 × 1920 |

All 24-bit RGB, no alpha, no retouching; `manifest.json` carries per-file size,
mode and sha256.

## Provenance

- **Recaptured at product head `94b3fc2`** — the compact-status-row change —
  iPhone 01–05/07 and Play 01–05/07, then composed at that head.
- **Retained from `3b0e048`** — iPad 01–09, iPhone 06/08/09 and Play 06/08. The
  lane's report records the source-diff argument (those screens' files are absent
  from the diff) and a pixel comparison against a same-head control rather than an
  assumption.
- **`46bd248`** — the current code head — changes only the home New-chat callback
  identity and its tests: no pixel change, so the visual source is `94b3fc2`.
- **Method** — the app's own web export was embedded in a fixed-viewport harness
  page (same-origin iframe) in the installed browser against the mock relay, and
  the repository's existing `iphone-6.9.html` / `ipad-13.html` / `play-phone.html`
  templates composed each frame. `capture-frames.mjs` was NOT used and is not
  claimed; it remains the standard method for the verified set and for future
  regenerations.

## Pending before these can replace the verified set

- Design sign-off on the staged frames (this pass is the audit input, not a claim).
- Caption wording for frames 02–09.
- The submission capture method decision (`docs/publishing/listing-screenshots.md`).
- The pre-upload content pass: no alpha, no secret or harness text, every frame
  viewed once. Nothing here has been submitted to either store.
