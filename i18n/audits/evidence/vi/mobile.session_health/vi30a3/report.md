# vi / mobile.session_health — independent audit (vi30a3)

- **Locale:** `vi` · **Namespace:** `mobile.session_health` · **Keys:** 11 (11 source, 11 context notes)
- **Audited:** 2026-10-30 at branch `feat/i18n-vietnamese`, HEAD `31f2ae46f45d7b579fc704bd1ba8f3a6dcc7856b` (the vi directory is untracked at this head; its bytes are pinned by the hash below)
- **Auditor:** i18n-auditor (lopdev team), session `8bfd6a5224bd`, **actual model `radient/auto`** — fallback chain anthropic/claude-sonnet-5-5, openai/gpt-6-astra, kimi/k3.1-pro, radient/auto disclosed in `record.json`
- **Independence:** Different agent, different session and different context from the translator. Not model-diverse: the served model radient/auto is the translator's served model too; disclosed, not closed. No human native-speaker review and no rendered frame are claimed.
- **Inputs:** `src/i18n/catalogues/en/mobile.session_health.json` `727b7e4977b39546…` · `src/i18n/catalogues/en/mobile.session_health.context.json` `df99892225c85921…` · `src/i18n/catalogues/vi/mobile.session_health.json` `2ffbacd81c2240cb…`
- **Verdict:** **passed — 11/11 clean; state copy is accurate, the destructive-free set is safe, and `mở lại` is used consistently for reopen/resume**

Eleven values, all clean. The refusal and gone states say what happened without blaming the reader or implying data loss; `mở lại` carries reopen/resume consistently across this namespace and the relay chrome; the em dash spacing, ellipsis character and sentence-final stops follow the guide.

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

- `Vẫn đang mở lại — phiên chưa lên.` — `chưa lên` (“hasn't come up”) is colloquial but idiomatic for a service; it reads terse, not sloppy, and matches the screen's other status lines.
- `resume_refused` and `ended_placeholder` keep the same `mở lại` verb as the `relay.chrome` Resume button, so the reader sees one word for one action.
- `thư mục home` keeps “home” Latin, consistent with core's treatment of path-level names.

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

It raised one MINOR (`ended_placeholder`: drop `trong thư mục home` to match fr/es/zh-CN/ru). **Rejected here:** the vi
string is 259 pt against English's 266.7 pt, so vi is shorter than the source it translates; dropping the destination would
lose information English keeps, and the 200 % clip it cites belongs to the English source, not to this translation.

