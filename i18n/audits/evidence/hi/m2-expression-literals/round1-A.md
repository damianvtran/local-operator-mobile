# hi audit — slice M2 (native phone-app expression literals), lane A, ROUND 1

- **Locale:** `hi` (Hindi, Devanagari, LTR)
- **Lane:** A (independent). Lane B is a separate auditor/record; I did not look for it.
- **Key group:** the 27 keys of `m2-prep/keys27.json` — `mobile.settings` 14 (account/status/diagnostics words, incl. `account.app_name`), `mobile.computers` 4 (wait panel, fallback name, connected-to), `mobile.session` 9 (tray context ×4, region cues ×3, video title, session fallback).
- **Translator under audit:** `i18n-translator` / `openai/gpt-6.1-sol` (named in the brief). I did not translate these and cannot edit them; this file states problems and better wording only. No translation/MT service was used to compare or back-translate — every judgement below is reasoning from the source, the shipped catalogues and the call sites.
- **Auditor:** `i18n-auditor`, session `bed9a9e791ca`, served model **`deepseek/deepseek-flash`** — the model in this session's header. **No fallback model was used**; `actual_model_source` = session header, not a fallback switch.
- **Date:** 2026-11-11.

## Verdict

**clean-with-findings** — 0 BLOCKER, 0 MAJOR, **4 MINOR**, **2 NIT**.

No key is unsafe, no meaning is inverted or omitted, no placeholder or ICU construct is broken, no key is missing or added, no stray English survives outside the allowed product names. Ledger status for `hi` + this group is therefore **`passed`** (the rule: `passed` only if no BLOCKER or MAJOR remains). The MINORs are remediation material for the single batched wave; none of them blocks.

Two of the four MINORs (`region.below_labels`, `region.more_below`) are one defect class on one surface and could be fixed in one pass.

## Inputs and provenance

| Input | Path | sha256 |
|---|---|---|
| English source + context (27 keys) | `…/sessions/3ef6295a5545/scratchpad/m2-prep/keys27.json` | `5a87db85aa45931827154dd6da772dba269eb824e57e8e7faf5d76cdcce02e1e` |
| Translation under audit | `…/sessions/3ef6295a5545/scratchpad/m2-prep/hi.v1.json` | `b399886745568752b430bb6bdcc2b4d8f70dc96d83bfee575e120cccda4936bf` |
| M1 audited reference (same screens) | `…/sessions/3ef6295a5545/scratchpad/m1-prep/hi.v2.json` | `b140cdcdc116c4b42518b063cfd7854e8ec61ab646462a007367b430d63ad2b7` |
| hi style guide | `~/local-operator/i18n/style-guides/hi.md` | `82292dc8d13fcc93dc752457719264aed3cc20bb65ecfaba0f0e5a31f4cb40d5` |
| en style guide | `~/local-operator/i18n/style-guides/en.md` | `c967c91037be79a7b184b3288b8c0326a261e4adae95b7db06d83e96f8ea6ec7` |
| glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| mobile i18n HOWTO | `~/local-operator-mobile/.worktrees/i18n-app-scan/docs/i18n.md` | `e27c2a881b5d1ad3232af7e046f8b5d2a7fa26b389dcf1f6da9d79d7f3f9f827` |

Heads read while auditing: mobile worktree `ae0b2ae7bec5ad8b653cfda99c80ab193e9e7b3f` (branch `feat/i18n-app-scan-english-closure`); M2 wiring branch `feat/i18n-app-scan-expression-literals` @ `b6b890e0e1e0f69a87d29475d9d69ac1d22033b1` (`d349df3c` + `b6b890e0`); core `b42471d3935c`.

I verified the English source on the branch is byte-identical to `keys27.json`'s `english` for all 27 keys, and that the shipped `hi` catalogues still hold the English placeholder for each of them (the M2 branch's pending-translation state) — so the candidate is a genuine replacement, not an override of an existing hi wording.

Nothing in this file is a deletion/move of another session's work: the candidate was read with the `read` tool and staged read-only into this session's scratch (`…/bed9a9e791ca/scratchpad/m2-au-hi-A/`); no repo file and no ledger was touched, per the slice directive.

## What I ran (execution, not notes)

Script kept at `…/bed9a9e791ca/scratchpad/m2-au-hi-A/validate.mjs`; it imports **the mobile repo's own parser**, `src/i18n/messages.ts` (`parseMessage` / `formatMessage` / `pluralCategory`) — the single parser the catalogue generator and the runtime read — so "valid ICU" here means valid to the code that ships, not to my own regex.

1. **Key set, order, empties** (the repo parser + `JSON.parse`):
   ```
   keys: source=27 candidate=27 order-equal=true
   missing: [] extra: []
   non-string/empty values: []
   ```
2. **Placeholder names AND kinds vs source**, per key, via `parseMessage().params`:
   ```
   PARITY DIFFS: 0
   ```
   (`{baseUrl}`, `{host}`, `{percent}`×4, `{labels}`, `{name}` all present with the same kind `text`; no plural/select in this group, so there are no CLDR arms to check — `Intl.PluralRules("hi")` categories `one/other` are not exercised by any of the 27.)
3. **Render every message** with sample arguments (`percent=42`, `host`, `baseUrl`, `labels="todo · subagent"`, `name="आपके कंप्यूटर"`), checking for a leftover brace, `undefined` or `NaN`:
   ```
   MECHANICAL: no problems
   ```
   The full render of all 27 values is reproduced by re-running `node validate.mjs` in this directory; two of them are quoted as evidence in the findings.
4. **Script/punctuation/hazard scan** per value: NFC normalisation, zero-width/bidi controls, Devanagari digits, `!`, double spaces, ASCII full stop after Devanagari, `कृपया`, and glyph parity for `·`, `↑`, `↓`, `%`, parentheses against the English source —
   ```
   MECHANICAL: no problems   (0 hits in every class)
   ```
5. **English-identical scan:** only `mobile.settings.account.app_name` = `Local Operator` (required byte-identical, and it is used solely to derive avatar initials at the call site); nothing else identical.
6. **Width budget** with a cell estimator on the hi guide's optimistic model (combining marks 0, spacing matras 0.5, wide glyphs 2), English vs Hindi, per key — see the fit section.
7. **Call-site reads** (read-only, `git show`): `src/features/settings/settings.tsx` (account card lines 289–325, `ConnectionPill` usage 352, diagnostics row 588–600, `statusFor` 714–755, `streamWord` 758–771, `DiagnosticRow` render), `src/features/auth/computers.tsx` (wait panel 272–273, added panel 633–645), `app/(app)/session/[id].tsx` (`contextFact` 130–147, tray band 990–1010, region cue 1392–1405, `REGION_LABEL` 1101–1106, `fallback_name` 680).
8. **Shipped-vocabulary recount** (not trusting any claim): all 22 shipped `hi` catalogue files (mobile) + `local_operator/i18n/catalogues/hi/*` (core) grepped for each term I judged on. Numbers are quoted in the findings.

## Terminology conformance (recounted, pass)

| Term / concept | Authority | Used in candidate | Recount |
|---|---|---|---|
| context | shipped mobile `mobile.chrome.composer.row_usage` = **संदर्भ** | संदर्भ ×4 | core hi also uses संदर्भ 8×; ✓ |
| session | glossary + hi guide = **सत्र** | सत्र | ✓ |
| offline | core hi = **ऑफ़लाइन** (nukta) | ऑफ़लाइन ×2 | core 3×, mobile 0× before this slice; nukta kept per the guide's nukta rule ✓ |
| connecting | core **कनेक्ट हो रहा** 10×, **जुड़ रहा** 0×; mobile hi **कनेक्ट हो** 7×, **जुड़ रहा** 1× | जुड़ रहा | divergence — MINOR H-A-01 |
| "not answering" | shipped `relay.chrome.session.subtitle.not_answering` = **उत्तर नहीं दे रहा** (byte-identical) | उत्तर नहीं दे रहा | ✓ exact match to the relay wording the sidecar asks for |
| sign-in phrase | shipped `mobile.settings.account.signed_in` = **साइन इन है**; `mobile.team_bridge.gate.signed_out` = **Team Bridge में साइन इन करें** | Radient में साइन इन नहीं है | ✓ the `X में साइन इन` pattern is shipped |
| tunnel | shipped = **टनल** (feminine: "टनल … बंद कर देती है") | आपकी Radient टनल | ✓ feminine agreement correct |
| relay / route / stream | shipped `रिले`, `रूट`, `स्ट्रीम` | रूट ✓ (स्ट्रीम not used here) | ✓ |
| computer | shipped **कंप्यूटर** | कंप्यूटर ×4 | ✓ |
| idle | core hi renders "Idle" as **आइडल** (8×) | निष्क्रिय | deliberate native divergence — NIT H-A-06 |
| live | core `relay.health.live` = **ऑनलाइन**; mobile `badge.active` = **सक्रिय** | सक्रिय | pairs with निष्क्रिय inside this enum; recorded, not filed |
| video | shipped `वीडियो {name} चलाएँ` | वीडियो | ✓ |
| product names | `Local Operator`, `Radient` Latin | both Latin, unchanged | ✓ no other English anywhere |

Register/formality: आप throughout, no तुम/तू, no `कृपया`, no `!`, polite imperative `करें` in the scroll cues, danda `।` for every full stop, `?`/`!` untouched (none present). No Devanagari digits. No ZWJ/ZWNJ, no manual bidi controls (LTR locale — not applicable, and none found).

## Fit (measured, not guessed)

Cell estimate per key (hi vs en, same estimator), narrowest surfaces first:

| key | en cells | hi cells | delta |
|---|---|---|---|
| `mobile.session.tray.context_short` | 13 | 14 | +1 |
| `mobile.session.tray.context_short_estimate` | 20 | 23 | +3 |
| `mobile.session.region.below_labels` | 24 | 26.5 | +2.5 |
| `mobile.session.region.more_below` | 21 | 23.5 | +2.5 |
| `mobile.session.region.end` | 14 | 18.5 | +4.5 |
| `mobile.settings.status.not_answering` | 13 | 13 | 0 |
| `mobile.computers.added.connected_to` | 19 | 19 | 0 |
| `mobile.settings.account.route_direct` | 30 | 20.5 | −9.5 |
| `mobile.computers.wait.host_answering` | 106 | 75.5 | −30.5 |

Consequences checked at the call sites, not assumed:

- The account card's second line is `numberOfLines={1}` + tail ellipsis; `route_radient` (17.5) and `route_direct` (20.5) are both **shorter** than the English they replace, so no new truncation.
- `ConnectionPill` carries `maxWidth: "100%"`, `min-w-0` and wraps (its own comment records a 554 pt measurement at 200 % that forced exactly this); every status value here is ≤ the English width, so pill fit is not at risk.
- Diagnostics values render in `text-mono-sm` with `LTR_WRITING`; Devanagari in that mono cell already ships (`mobile.settings.diagnostics.route_direct` = "सीधा रिले"), so this is not a new glyph risk.
- The activity band (`flex-wrap`, under 340 pt for the `_short` forms) is the one tight surface: `context_short` is +1 cell over the English narrow form and `context_short_estimate` +3. That is small, and the sidecar explicitly allows the full word when a language has no short form — recorded as NIT H-A-05 rather than a fit defect.

## Findings

### MINOR

**H-A-01 · MINOR · `mobile.settings.diagnostics.stream_connecting`** — non-standard verb for the state the row above already names with the product's own word.
Current: `जुड़ रहा`
Problem: this value is the Diagnostics **Stream** row on Settings, one screen below the Status row that says `कनेक्ट हो रहा है…` (`mobile.computers.connecting`) for the very same moment. Programme vocabulary counts, recounted here: core hi `कनेक्ट हो रहा` **10×** vs `जुड़ रहा` **0×**; mobile hi `कनेक्ट हो` **7×** vs `जुड़ रहा` **1×** (that one is `mobile.chrome.home.reconnecting`, "reconnecting"). `जुड़ रहा` is understandable but reads as "joining", and it is the only place the diagnostics enum breaks with the connect vocabulary its four siblings and the pill above use.
Suggested: `कनेक्ट हो रहा`

**H-A-02 · MINOR · `mobile.computers.wait.host_answering`** — copula dropped from the sentence that carries the whole explanation.
Current: `{host} पर आपके कंप्यूटर के जवाब का इंतज़ार है। रूट तैयार होने का मतलब यह नहीं कि कंप्यूटर चालू है।`
Problem: `…मतलब यह नहीं कि…` without `है` is spoken-Hindi ellipsis. In written product copy — and this line exists to teach a distinction the user will otherwise get wrong ("a provisioned route ≠ a machine that is up") — the standard form is `मतलब यह नहीं है कि`. Second, minor: the fronted locative `{host} पर` attaches to `इंतज़ार` ("at host X we are waiting") rather than to `कंप्यूटर` ("your computer at host X"). It survives because the host *is* where the computer is, but the source's point is which machine is being waited on.
Suggested: `{host} पर मौजूद आपके कंप्यूटर के जवाब का इंतज़ार है। रूट तैयार होने का मतलब यह नहीं है कि कंप्यूटर चालू है।`

**H-A-03 · MINOR · `mobile.settings.account.route_radient`** — status line left as a bare postpositional fragment while its sibling is a full clause.
Current: `आपकी Radient टनल से`
Problem: the English pair is "Through your Radient tunnel" / "Connected directly to {baseUrl}", and Hindi normally needs the verb the English can elide: the sibling renders `सीधे {baseUrl} से कनेक्ट है`. Read alone under the account name, `आपकी Radient टनल से` trails off on `से` with nothing for it to attach to. (Feminine agreement `आपकी … टनल` is correct and matches shipped `टनल … कर देती है`.)
Suggested: `Radient टनल से कनेक्ट है` — 27 cells, inside the English 27; the row ellipsizes, and `आपकी` can stay if the team prefers it (`आपकी Radient टनल से कनेक्ट है`, 30 cells ≈ the English length).

**H-A-04 · MINOR · `mobile.session.region.below_labels` and `mobile.session.region.more_below`** — `नीचे` twice inside one cue line; `और है` missing `भी`.
Current: `नीचे {labels} · नीचे स्क्रॉल करें ↓` / `नीचे और है · नीचे स्क्रॉल करें ↓`
Problem: both cues put the direction word in front of the labels *and* again in front of the action, so the rendered line reads `नीचे tasks · status · नीचे स्क्रॉल करें ↓` (the `{labels}` payload reaches the message already joined, verified at the call site: `hiddenRegionLabels.join(" · ")`). Standard Hindi for "there is more below" is `नीचे और भी है`; `नीचे और है` reads clipped. One `नीचे` is enough — the arrow already says the direction, and the instructions to keep `·` and `↓` are respected either way.
Suggested: `{labels} नीचे · स्क्रॉल करें ↓` (or, if the label list must lead with the locative: `नीचे {labels} · स्क्रॉल करें ↓`) and `नीचे और भी है · स्क्रॉल करें ↓`.

### NIT

**H-A-05 · NIT · `mobile.session.tray.context_short`, `mobile.session.tray.context_short_estimate`** — the under-340 pt forms are byte-identical to the full forms.
Current: `{percent}% संदर्भ` (same as `context`) / `{percent}% संदर्भ (अनुमानित)` (same as `context_estimate`)
Problem: those two keys exist only to be narrower (D17: the full word wrapped the activity band at <340 pt), so as shipped they buy nothing; measured +1 and +3 cells over the English narrow forms. The sidecar's rule — "use the language's own short form or the full word if none exists" — permits exactly this, which is why it is a NIT and not a fit MAJOR: `संदर्भ` (≈5 cells) is already cheaper than English "context" (7).
Suggested: accept as-is, or, if the manager wants the narrow form to actually narrow, `{percent}% संदर्भ (अनुमान)` — the parenthetical noun keeps the parentheses and the meaning of "(est.)" at 4 fewer cells. No change requested for the full-length pair; `(अनुमानित)` there is correct and idiomatic.

**H-A-06 · NIT · `mobile.settings.diagnostics.stream_idle`** — native word where core ships a loan.
Current: `निष्क्रिय`
Problem: core hi renders "Idle" as `आइडल` (8 occurrences). `निष्क्रिय` is not wrong — it means "inactive", it is used once in core, and inside this enum it pairs cleanly with `सक्रिय` for "live", which `आइडल` would not. Recording the divergence so the wave's ledger note does not look like an accident; no change requested.
Suggested: keep `निष्क्रिय` (alternative if uniformity is preferred: `आइडल`).

## Per-key result (all 27)

`ok` = accurate, idiomatic, glossary-conformant, mechanically clean.

| Key | Verdict |
|---|---|
| `mobile.settings.account.not_signed_in` | ok (`Radient में साइन इन नहीं है` — `X में साइन इन` is shipped; negates the shipped `साइन इन है` cleanly) |
| `mobile.settings.account.route_radient` | H-A-03 |
| `mobile.settings.account.route_direct` | ok (`सीधे {baseUrl} से कनेक्ट है`, `{baseUrl}` untouched and LTR) |
| `mobile.settings.status.no_connection` | ok (`अभी कनेक्शन नहीं`; `अभी` carries "yet"; fits the one-line card and the wrapping pill) |
| `mobile.settings.status.not_connected` | ok (`कनेक्ट नहीं` — matches shipped `…, कनेक्ट नहीं` and `यह सत्र अभी कनेक्ट नहीं है`) |
| `mobile.settings.status.offline` | ok (`ऑफ़लाइन`, core spelling, nukta kept) |
| `mobile.settings.status.not_answering` | ok (`उत्तर नहीं दे रहा` — byte-identical to the shipped relay subtitle the sidecar says to match; masculine `-रहा` agrees with सत्र/कंप्यूटर) |
| `mobile.settings.status.connected` | ok (`कनेक्ट है`, the positive of the shipped pair) |
| `mobile.settings.diagnostics.stream_idle` | H-A-06 (ok, recorded) |
| `mobile.settings.diagnostics.stream_connecting` | H-A-01 |
| `mobile.settings.diagnostics.stream_live` | ok (`सक्रिय`; pairs with `निष्क्रिय`) |
| `mobile.settings.diagnostics.stream_degraded` | ok (`बाधित` — "impaired"; no programme precedent either way, and it is not misleading next to the readable `उत्तर नहीं दे रहा` in the Status row) |
| `mobile.settings.diagnostics.stream_offline` | ok |
| `mobile.computers.wait.host_answering` | H-A-02 |
| `mobile.computers.wait.answering` | ok (`आपके कंप्यूटर के जवाब का इंतज़ार है।` — matches shipped `बातचीत का इंतज़ार…` phrasing and the `जवाब` used for a computer answering) |
| `mobile.computers.added.fallback_name` | ok (`आपके कंप्यूटर` — oblique, which is exactly the case `से` needs) |
| `mobile.session.tray.context` | ok |
| `mobile.session.tray.context_short` | H-A-05 |
| `mobile.session.tray.context_estimate` | ok (`(अनुमानित)`, parentheses kept) |
| `mobile.session.tray.context_short_estimate` | H-A-05 |
| `mobile.session.region.end` | ok (`अंत · ऊपर स्क्रॉल करें ↑`, `·` and `↑` kept, lower-case not applicable) |
| `mobile.session.region.below_labels` | H-A-04 (`{labels}` kept unchanged, `·` and `↓` kept) |
| `mobile.session.region.more_below` | H-A-04 |
| `mobile.session.video.title_fallback` | ok (`वीडियो`, shipped) |
| `mobile.session.fallback_name` | ok (`सत्र`, glossary) |
| `mobile.settings.account.app_name` | ok (`Local Operator` byte-identical; only feeds `initialsOf`) |
| `mobile.computers.added.connected_to` | ok (`{name} से कनेक्ट हो गया।` — `कनेक्ट हो गया` is shipped in `save_refused.title`; with the oblique fallback the sentence is `आपके कंप्यूटर से कनेक्ट हो गया।`, which is grammatical and unambiguous, and `X से कनेक्ट` = "connected to X" is the shipped pattern in `mobile.chrome.home.connecting`) |

## Considered and cleared (evidence, so the next reader does not re-litigate)

- **`connected_to` + `fallback_name` case agreement** — the risk the sidecar warns about (`mind grammatical case/article`) is met, not dodged: the fallback is in the **oblique** (`आपके कंप्यूटर`), so `…से कनेक्ट हो गया।` needs no adjustment. A user-set Devanagari name in the nominative would need the oblique, but `appeared?.name` is the computer's name from Radient (host-derived, normally Latin, where the postposition is indifferent), and no translation can fix an arbitrary name.
- **`संदर्भ` twice-width claim** — checked against the band's real behaviour (`flex-wrap`, wrapping pill/quiet line), not assumed: see H-A-05's numbers.
- **Mixed copula across the status enum** (`कनेक्ट है` has `है`; `कनेक्ट नहीं`, `अभी कनेक्शन नहीं`, `उत्तर नहीं दे रहा`, `ऑफ़लाइन` do not) — normal for Hindi status pills, and `उत्तर नहीं दे रहा` is *required* to be byte-identical to the shipped relay subtitle. Not filed.
- **`सक्रिय` for "live"** — collides with `mobile.computers.badge.active` = `सक्रिय` and diverges from core `relay.health.live` = `ऑनलाइन`, but inside this five-word enum it is the only choice that pairs with `निष्क्रिय`; the two never contradict on screen. Not filed.
- **`बाधित` for "degraded"** — no precedent (0 in core, 0 in mobile) but the concept is carried by the sibling key, and "बाधित" is the shortest honest Hindi word for an impaired link. Not filed.
- **Devanagari in the mono diagnostics cell** and in a wrapping pill — both already ship (`सीधा रिले`; pill wrap measured upstream). Not filed.
- **English-identical values** — only `app_name`, which the sidecar requires to be identical and which never renders. Not filed.

## Second independent pass (high-visibility group)

The manager asked for a second pass on settings/onboarding copy. I re-read all 27 values as rendered output (not as JSON), against each call site's constraints, and re-checked punctuation, register and settlement against core *and* mobile hi catalogues. **Pass 2 produced no new candidate findings** and changed no severity — the four MINORs and two NITs above are what two passes agree on. It did produce one adjacent product defect, below, which is outside the 27 keys and outside my lane to fix.

## Adjacent defect found while reading call sites (NOT a finding against this candidate)

`app/(app)/session/[id].tsx` builds the `{labels}` argument for `mobile.session.region.below_labels` from a hardcoded English map:

```ts
const REGION_LABEL: Record<RegionKey, string> = {
    working: "activity", subagents: "agents", todos: "tasks", strip: "status",
};
```

so even with a perfect Hindi `below_labels`, the cue renders as **`नीचे tasks · status · नीचे स्क्रॉल करें ↓`** — English payload inside a Hindi sentence. The translator did the right thing (the sidecar says keep `{labels}` unchanged); the map needs its own keys, or the scanner's blind spot will keep hiding it. Worth a look by whoever owns the M2 branch: it is the same class of defect this slice exists to remove.

## Ready-to-use ledger note (not written by me)

Per the slice directive I wrote no repo file and no ledger row. For whoever records it, `hi` + this group → status **`passed`**, and a note that fits 280 characters:

```
M2 lane A: 27 keys clean — 0 BLOCKER/MAJOR, 4 MINOR (stream_connecting verb, host_answering copula, route_radient fragment, region नीचे ×2) + 2 NIT (ctx narrow forms, आइडल/निष्क्रिय). Mechanical: repo parser, 0 placeholder diffs.
```
