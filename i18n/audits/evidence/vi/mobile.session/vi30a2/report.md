# vi / mobile.session — independent audit (vi30a2)

- **Locale:** `vi` · **Namespace:** `mobile.session` · **Keys:** 2 (2 source, 2 context notes)
- **Audited:** 2026-10-30 at branch `feat/i18n-vietnamese`, HEAD `31f2ae46f45d7b579fc704bd1ba8f3a6dcc7856b` (the vi directory is untracked at this head; its bytes are pinned by the hash below)
- **Auditor:** i18n-auditor (lopdev team), session `8bfd6a5224bd`, **actual model `radient/auto`** — fallback chain anthropic/claude-sonnet-5-5, openai/gpt-6-astra, kimi/k3.1-pro, radient/auto disclosed in `record.json`
- **Independence:** Different agent, different session and different context from the translator. Not model-diverse: the served model radient/auto is the translator's served model too; disclosed, not closed. No human native-speaker review and no rendered frame are claimed.
- **Inputs:** `src/i18n/catalogues/en/mobile.session.json` `8539005ad9785ec1…` · `src/i18n/catalogues/en/mobile.session.context.json` `6e8d32e62d787a2c…` · `src/i18n/catalogues/vi/mobile.session.json` `74f5b1adcbba89c3…`
- **Verdict:** **passed — 2/2 clean; `Chi tiết cuộc trò chuyện` matches the destination title and `dòng làm việc` is core's committed term**

Two values, both clean. `Chi tiết cuộc trò chuyện` is the destination screen's own title and is repeated verbatim in `mobile.home.options.fixed`, which is the recognition the context note asks for. The status-tray hint uses core's committed `dòng làm việc` for “working line”, `tác vụ` for tasks and the glossary's `tác nhân con` for subagents.

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

- `Chi tiết cuộc trò chuyện` — capitalised mid-sentence by design: it names a screen and must stay identical wherever that screen is named (the context note says so).
- `Mở dòng làm việc, tác vụ và tác nhân con` — the accessibility hint is an action plus three objects; natural, and no preposition is needed in Vietnamese.

## Limits

- No native-speaker review and no rendered frame: the fit claims are measured text advances, not screenshots.
- The translator's run was not observed; its identity is as supplied by the requesting manager.
- Branch state: At this head src/i18n/catalogues/vi/ is untracked and vi sits in NOT_YET_SHIPPED_LOCALES, so `npx vitest run src/i18n src/features/home` fails exactly one assertion — catalogues.test.ts 'ships no locale the runtime cannot render' expects the catalogue directories to equal SHIPPED_LOCALES. That is the guard working as designed; it clears when the wave flips the shipped set after every audit passes. Shipping vi also requires a measured `vi` entry in SUGGESTION_CHAR_BUDGET (Record<ShippedLocale, number>) and removal of vi from NOT_YET_SHIPPED_LOCALES. `npx tsc --noEmit` exits 0 at this head.


## Second independent pass (this audit's own request, per the high-visibility rule)

The manager's brief asks for a second independent reading of high-visibility copy (onboarding, errors, settings). A blind pass
ran as a separate `reviewer` subagent (job `3d25b56e136a`) over all four group-A namespaces, without access to this audit's
findings. Both runs served **radient/auto** (the same fallback chain), so independence is by agent, session and context, not by
model.

Its verdict: **clean — no BLOCKER, no MAJOR; 3 MINOR + 2 NIT** across the four namespaces.

It raised nothing against this namespace.

