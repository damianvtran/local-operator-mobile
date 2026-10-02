# The audit canary

`node e2e/run-canary.ts` captures this page twice and audits both halves:

- `/defects/defects` — a page that **declares its own defects**, each marked with
  `data-defect="U-xx"` so the canary can assert the audit caught it.
- `/clean/clean` — the same page with every defect corrected, so a run that
  fails everything cannot pass the second direction either.

An instrument that cannot fail is worthless, so this fixture exists to make the
audit **fail on purpose**.

## Why `biome.json` sits here

The defects are the point: a 16×16 control, a 480 px block inside a 320 px
viewport, colour-only status, clipped text, low-contrast ink, and inline styles
that name the CSS variables under test. Formatting or linting this page would
"fix" exactly what the audit exists to detect.

So the page is excluded from Biome by the nested config in this directory, rather
than repaired. It is a nested config (`"root": false`) because the repository's
root `biome.json` belongs to the app-scaffold change, and this keeps the
exclusion in the same tree as the fixture.

Two constraints this directory carries:

- **No comments in the nested `biome.json`.** A `//` comment there makes Biome
  report *"Found a nested root configuration, but there's already a root
  configuration"* and exit non-zero on every run — measured, not assumed. The
  reason for the exclusion lives in this file instead.
- **This reads correctly only with the defects present.** Editing them to satisfy
  a linter or a formatter breaks the canary, and the canary's passing verdict is
  what every design and UX round in this programme is measured against.
