# vi / mobile.account_routing — independent audit (vi30a4)

- **Locale:** `vi` · **Namespace:** `mobile.account_routing` · **Keys:** 14 (14 source, 14 context notes)
- **Audited:** 2026-10-30 at branch `feat/i18n-vietnamese`, HEAD `31f2ae46f45d7b579fc704bd1ba8f3a6dcc7856b` (the vi directory is untracked at this head; its bytes are pinned by the hash below)
- **Auditor:** i18n-auditor (lopdev team), session `8bfd6a5224bd`, **actual model `radient/auto`** — fallback chain anthropic/claude-sonnet-5-5, openai/gpt-6-astra, kimi/k3.1-pro, radient/auto disclosed in `record.json`
- **Independence:** Different agent, different session and different context from the translator. Not model-diverse: the served model radient/auto is the translator's served model too; disclosed, not closed. No human native-speaker review and no rendered frame are claimed.
- **Inputs:** `src/i18n/catalogues/en/mobile.account_routing.json` `34fa87b25d0f65b8…` · `src/i18n/catalogues/en/mobile.account_routing.context.json` `2103f8d2a4f3b649…` · `src/i18n/catalogues/vi/mobile.account_routing.json` `1cdcd6db23024bee…`
- **Verdict:** **passed — 14/14 clean; 11 of 14 are byte-identical to core's committed vi for the same English, and the mobile-only 3 match its vocabulary**

Fourteen values, all clean. Eleven English values are byte-identical to core's `relay.account_policy.*` and every one carries the same Vietnamese bytes as core's committed vi; the three mobile-only strings (`disconnected`, `reload`, `title`) are written in the same vocabulary. Error copy neither overstates failure nor softens the scope restriction.

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

- `máy chủ chuyển tiếp` for “relay” adds `máy chủ` to the glossary's `chuyển tiếp`. It is core's own committed rendering of this identical sentence, and the relay is the server in this context; changing it here alone would create drift.
- `Thay đổi chỉ áp dụng cho máy tính này.` — the restriction survives translation exactly; `chỉ` carries “only”.
- `Hãy` + bare verb in the error sentences, bare verbs on the buttons — the same split as `mobile.session_health`.

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

It raised one NIT (`rejected`: `chưa được lưu` reads "not saved yet"), while noting the string is byte-identical to core's
`relay.account_policy.rejected`. **Recorded, not changed:** the wave's value comes from core, and changing one client alone
splits the surfaces the mirror rule keeps aligned.

