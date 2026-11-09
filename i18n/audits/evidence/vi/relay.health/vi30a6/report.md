# vi / relay.health — independent audit (vi30a6)

- **Locale:** `vi` · **Namespace:** `relay.health` · **Keys:** 8 (8 source, 8 context notes)
- **Audited:** 2026-10-30 at branch `feat/i18n-vietnamese`, HEAD `31f2ae46f45d7b579fc704bd1ba8f3a6dcc7856b` (the vi directory is untracked at this head; its bytes are pinned by the hash below)
- **Auditor:** i18n-auditor (lopdev team), session `8bfd6a5224bd`, **actual model `radient/auto`** — fallback chain anthropic/claude-sonnet-5-5, openai/gpt-6-astra, kimi/k3.1-pro, radient/auto disclosed in `record.json`
- **Independence:** Different agent, different session and different context from the translator. Not model-diverse: the served model radient/auto is the translator's served model too; disclosed, not closed. No human native-speaker review and no rendered frame are claimed.
- **Inputs:** `src/i18n/catalogues/en/relay.health.json` `65e8c90187268d8e…` · `src/i18n/catalogues/en/relay.health.context.json` `b23f770b852c8f3e…` · `src/i18n/catalogues/vi/relay.health.json` `e8a1f7174f992883…`
- **Verdict:** **passed — 8/8 values byte-identical to core's committed vi at origin/main (0f8e3d101116)**

Mirror verification, not a fresh translation: every value in this namespace was compared with core's COMMITTED Vietnamese (`git show origin/main:local_operator/i18n/catalogues/vi/relay.health.json`), value by value, with SHA-256 of each value. 8 of 8 are byte-identical, and the English side matches core's English for the same keys. Nothing was re-translated and nothing was edited.

## Method

Everything below was executed, not inferred; the raw output is `audit.log` beside this report.

- `npm run -s i18n:check` → exit 0 (generated projection current; strings ratchet unchanged).
- The repository's own parser and renderer (`src/i18n/messages.ts`, `src/i18n/runtime.ts`) imported from the worktree and driven per key:
  placeholder surfaces compared on both sides, ICU arms compared, every value rendered and round-tripped.
- `renderFor(key, {}, "vi")` answers the **English source** at this head, because `vi` is still in `NOT_YET_SHIPPED_LOCALES`;
  the vi bytes were therefore read through the same `formatMessage(parseMessage(text), params, "vi")` pair `renderFor` calls
  once it has a localized string. The fallback itself is logged as an observed control, not assumed.
- Unicode and typography swept per value: NFC, combining marks, spacing, edge whitespace, ellipsis form, quotes, bidi controls.
- Widths measured with CoreText/AppKit (system font) at the app's token sizes against the boxes read from `home-splash.tsx`/`home-copy.ts` at 320 pt.
- Negative controls run for every detector (a renamed placeholder, a plural with no `other` arm, decomposed diacritics, a double space,
  an unterminated plural, an over-wide filler): all fired. ICU's `other` fallback was verified separately so that a missing-arm control
  cannot be confused with correct ICU behaviour.

## Findings

None. No BLOCKER, no MAJOR, no MINOR, no NIT.

## Considered and accepted

- All eight values byte-identical to core's committed vi at origin/main, and all eight English values identical to core's too.
- `Đang hoạt động` for the terse `Live` status is longer than English, but the mirror rule owns the wording; it is noted as a fit observation only, not a change request.

## Limits

- No native-speaker review and no rendered frame: the fit claims are measured text advances, not screenshots.
- The translator's run was not observed; its identity is as supplied by the requesting manager.
- Branch state: At this head src/i18n/catalogues/vi/ is untracked and vi sits in NOT_YET_SHIPPED_LOCALES, so `npx vitest run src/i18n src/features/home` fails exactly one assertion — catalogues.test.ts 'ships no locale the runtime cannot render' expects the catalogue directories to equal SHIPPED_LOCALES. That is the guard working as designed; it clears when the wave flips the shipped set after every audit passes. Shipping vi also requires a measured `vi` entry in SUGGESTION_CHAR_BUDGET (Record<ShippedLocale, number>) and removal of vi from NOT_YET_SHIPPED_LOCALES. `npx tsc --noEmit` exits 0 at this head.
