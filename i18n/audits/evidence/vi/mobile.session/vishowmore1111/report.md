# Audit — `mobile.session.user_message.show_more` / `show_less` · locale `vi`

Independent i18n audit. Auditor is not the translator and made no repo edit.
Date: 2026-11-11. Slice: 2 keys, namespace `mobile.session`, role `button`, call site
`src/features/session/components/user-message-clamp.tsx` (PR #237, head `8fdfb2e9`).

## Identity (actual, not assumed)

| field | value |
|---|---|
| agent | i18n-auditor (lopdev team) |
| session | 622654165744 |
| model | `deepseek/deepseek-flash` |
| actual_model_source | the `Model:` line of this session's own header; no provider-fallback notice appeared in this transcript |
| independent_from_translator_session | true — translator reported as `translator` on anthropic/claude-sonnet-5-5; the #237 values were authored by the #235 coder. I observed neither run. No human native-speaker review and no rendered frame are claimed. |

## The two pairs under audit

PR #237 head **already ships vi values**, so (a) and (b) are the same bytes for this locale:

| key | English source | (a) #237-shipped vi | (b) translator candidate vi |
|---|---|---|---|
| `…show_more` | Show more | `Xem thêm` | `Xem thêm` |
| `…show_less` | Show less | `Thu gọn` | `Thu gọn` |

Verified byte-identical from `git show 8fdfb2e9:src/i18n/catalogues/vi/mobile.session.json`
(file sha256 `2ec897dd…`, equal to the GitHub-fetched copy).

**Recommendation: ship `Xem thêm` / `Thu gọn`.** Shipping it needs **no change to the #237
values**; the follow-on PR is a no-op for vi on this slice.

## Hashes

| artifact | sha256 |
|---|---|
| vi pair, sorted-key JSON `{"…show_less":"Thu gọn","…show_more":"Xem thêm"}` | `ce4f24388db3ee600b3fe9898df06829b69b48ad1876d70db9046a7ba1b92ea2` |
| #237-shipped pair, same canonicalisation | `ce4f2438…` (**identical** — one hash covers both) |
| English pair, same canonicalisation | `b285de7371f1a73b6c5adc4d70d999acbc7a6a8eea4a4057f2775c618aa5beef` |
| `src/i18n/catalogues/en/mobile.session.json` @8fdfb2e9 | `143508157b6d768367a4efe2a6edd41574dcd034bac5fa4aa879f3f70aab77b0` |
| `src/i18n/catalogues/en/mobile.session.context.json` @8fdfb2e9 | `ccfcb74f0e1a44c5ac1e2e45c02c5adea137bf4692c1567150124107ecb05102` |
| `src/i18n/catalogues/vi/mobile.session.json` @8fdfb2e9 | `2ec897dd985ff97cc6f7ba06dd6df5b2912f9be872eb0980c612fabf03e648ab` |

## 1. Mechanical — executed, not asserted

Mirror of `origin/main` (`git archive origin/main src/i18n scripts/i18n scripts/lib`, extracted to
this session's scratchpad; the repo tree was never written), with the #237 head values injected for
en + en-context + all 7 locales:

```
$ node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/i18n/generate.ts
Wrote src/i18n/catalogue.gen.ts (653 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN)
$ node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/i18n/generate.ts --check
src/i18n/catalogue.gen.ts is current (653 keys, 21 namespaces, …)
$ grep -n 'Xem thêm\|Thu gọn' src/i18n/catalogue.gen.ts
6899:		"mobile.session.user_message.show_less": "Thu gọn",
6900:		"mobile.session.user_message.show_more": "Xem thêm",
```

- Key parity: `mobile.session` = 65 en keys / 65 vi keys, sets equal, **no key added or dropped**.
- Parameter parity: both typed `NoParams` in the generated surface (en carries no placeholder; vi
  carries none). No ICU plural/select in either arm, so no CLDR-category question arises.
- Context: both keys have `role: "button"` in the en sidecar and a non-empty note (generation refuses
  a missing one).
- No markup, backticks, code, flags, identifiers, digits, `%`, `/`, parens; valid JSON; UTF-8, tab
  indent, trailing newline (generation and `--check` both pass).
- Nothing left English: neither arm equals its English source; the repo's own
  `shipped translation is still translated` gate (identical-to-English must appear in
  `IDENTICAL_BY_DESIGN_JUDGED`) therefore passes for both keys. Within `mobile.session` at #237 head
  only two values remain identical to English and neither is in this slice
  (`highlights.withheld_reasons_join`, `subagent.prompt_label`).

**Validator negative control** (proves the run discriminates): injecting `Xem thêm {count}` into the
mirror's vi value and re-running generation:

```
$ node … scripts/i18n/generate.ts ; echo $?
vi/mobile.session.json: mobile.session.user_message.show_more does not carry the source's parameters — missing: none; unexpected: count (English: none; vi: count:text)
1
```

## 2. Accuracy

`Xem thêm` = see/view more. `Thu gọn` = collapse (literally "gather compact"), the standard
Vietnamese antonym of expand for text, lists and panels. No negation or polarity slip; nothing added
or omitted. Both are safe wording for a non-destructive disclosure control; neither implies deletion
or a permanent action — the message is still the reader's own, merely re-clipped.

Semantics of each arm match the English exactly, including the "same control, opposite direction"
property: the two arms describe the two directions of one toggle, not two different objects.

## 3. Idiom and register

Both are bare verb phrases, the correct Vietnamese button form (no pronoun, no politeness particle,
no final stop), sentence case with only the first word capitalised — and consistent with the note's
"short, sentence case, no final full stop". `Xem thêm` / `Thu gọn` is the dominant pair for
in-place expansion in Vietnamese product UIs; it reads as a control, not a label, and needs no
context to be understood. No calque, no MT flavour.

## 4. Terminology — precedent from this locale's own catalogue (not taste)

| existing key | en | vi at main |
|---|---|---|
| `mobile.home.suggestion.last_turn` | Show me the last turn | **Xem** lượt gần nhất |
| `mobile.team_bridge.profile.open` | View profile for {name} | **Xem** hồ sơ của {name} |
| `mobile.computers.show_details` / `hide_details` | Show details / Hide details | Hiện chi tiết / Ẩn chi tiết |
| `mobile.schedules.show_more.monitors` / `show_less.monitors` | Show # more monitors / Show fewer monitors | Hiện thêm # giám sát / Ẩn bớt giám sát |
| `relay.transcript.turn.condensed` | Turn condensed | Lượt đã **thu gọn** |

The catalogue already renders English "Show me …" as `Xem …` in reader-facing controls, and already
uses `thu gọn` for the collapsed state of a transcript turn. `Xem thêm` / `Thu gọn` is therefore
**inside** this locale's established vocabulary, not a departure from it.

The one divergence — `mobile.schedules` prefers `Hiện thêm` / `Ẩn bớt` — is explained by the count:
those keys carry `{hidden, plural, …}` ("Hiện thêm 3 giám sát", "Ẩn bớt giám sát"), where `Ẩn bớt`
("hide some") is the accurate verb. This control has no count, and `Ẩn bớt` without one would read as
hiding a subset of one message rather than collapsing it. Judged acceptable; **no change requested**
(recorded as NIT so the decision is visible rather than re-argued).

## 5. Fit

`Xem thêm` = 8 cells, `Thu gọn` = 7 cells (East-Asian width: all narrow, precomposed Vietnamese
letters, no combining marks, so cells == chars == UTF-16 units). Budget was ~14 characters; the
English is 9 cells, i.e. vi is **shorter than the source**, so it cannot overflow anywhere English
fits. The control itself is a full-width centred `Pressable`
(`className="w-full items-center justify-center"`, `minHeight: TOUCH_FLOOR`) whose label is
`text-meta` = **12 px** (`src/ui/theme.css:117`), ≈50 px wide at 12 px, inside a full-width bubble
column on a 320 pt phone, i.e. an order of magnitude inside the space available. Vietnamese diacritics add height, not
advance width, so the only shape risk would be a taller glyph stack, and no frame was rendered to
measure it — stated as a limit of this audit, not as a passing result.

## 6. RTL

Not applicable: `vi` is LTR, Latin script. No bidi control characters, no NBSP, no non-space
whitespace, NFC-normalised (both values).

## 7. Negative control on my own checker

`vi_showmore_check.py` (this scratchpad) checks: non-empty, no surrounding/double space, not equal to
English, no English function word left in the value, no ICU braces / markup / backtick / digits / `%`
`/` parens, NFC, no bidi/NBSP, leading capital, no final full stop, ≤14 cells, two arms distinct.

```
control (candidate as shipped)          → 0 violations
M-A empty value                        → 1  (empty value)
M-B identical to English               → 2  (identical to English source; English tokens)
M-C Latin leftover "Xem more"          → 1  (untranslated English token(s) ['more'])
M-D overflow 20 cells                  → 1  (20 cells > 14 budget)
M-E final full stop                    → 1  (final full stop — source has none)
M-F NBSP                               → 2  (NBSP; non-space whitespace U+00A0)
M-G both arms "Xem thêm"               → 2  (pair not an antonym pair; values not distinct)
NEGATIVE CONTROL PASSED: control clean, all 7 mutations flagged
```

The first version of the checker **passed** `Xem more`: its English-token rule wrongly excluded words
that also appeared in the English source. The control caught that, the rule was fixed, and the run
above is the post-fix output — recorded because a checker that has never failed is not evidence.

## Verdict

Recommended pair `Xem thêm` / `Thu gọn` (= the #237-shipped pair; no replacement needed):
**clean-with-findings**, counts `{blocker: 0, major: 0, minor: 0, nit: 1}`. Ledger status `passed`.

#237-shipped pair: same bytes, so the same verdict — nothing to re-request.

NIT (no action): `vi-N1` — `mobile.session.user_message.show_less` = `Thu gọn` diverges from
`mobile.schedules.show_less.*` = `Ẩn bớt`; acceptable because those keys carry a count and this one
does not, and `thu gọn` is already this catalogue's word for a collapsed turn.

## Ledger record (for a writing session to commit — this audit is read-only)

Path: `i18n/audits/evidence/vi/mobile.session/vi1111sm1/` (`record.json` + `report.md` + this
`audit.log`). Supersedes nothing; no earlier bundle for this key pair exists on main.

```json
{
  "schema": 1,
  "audit_kind": "independent audit of the show_more/show_less follow-on slice (PR #237)",
  "audit_id": "vi1111sm1",
  "locale": "vi",
  "namespace": "mobile.session",
  "audit_date": "2026-11-11",
  "key_count": { "slice": 2, "namespace": 65, "en": 65, "target": 65 },
  "audited_revision": "8fdfb2e970299a2c0947bf42ac6224ebacd97113",
  "auditor": {
    "agent": "i18n-auditor (lopdev team)",
    "session": "622654165744",
    "model": "deepseek/deepseek-flash",
    "actual_model": "deepseek/deepseek-flash",
    "actual_model_source": "session header 'Model:' line; no provider-fallback notice in this transcript",
    "independent_from_translator_session": true,
    "independence": "Not the translator (translator on anthropic/claude-sonnet-5-5, reported; #237 values authored by the #235 coder). Neither run observed. No human native-speaker review, no rendered frame claimed."
  },
  "pairs_audited": {
    "shipped_237": { "show_more": "Xem thêm", "show_less": "Thu gọn", "sha256": "ce4f24388db3ee600b3fe9898df06829b69b48ad1876d70db9046a7ba1b92ea2" },
    "translator_candidate": { "show_more": "Xem thêm", "show_less": "Thu gọn", "sha256": "ce4f24388db3ee600b3fe9898df06829b69b48ad1876d70db9046a7ba1b92ea2" },
    "recommended": "shipped_237 == translator_candidate; no #237 change needed",
    "en_sha256": "b285de7371f1a73b6c5adc4d70d999acbc7a6a8eea4a4057f2775c618aa5beef"
  },
  "input_hashes": {
    "en": { "path": "src/i18n/catalogues/en/mobile.session.json", "sha256": "143508157b6d768367a4efe2a6edd41574dcd034bac5fa4aa879f3f70aab77b0" },
    "context": { "path": "src/i18n/catalogues/en/mobile.session.context.json", "sha256": "ccfcb74f0e1a44c5ac1e2e45c02c5adea137bf4692c1567150124107ecb05102" },
    "vi": { "path": "src/i18n/catalogues/vi/mobile.session.json", "sha256": "2ec897dd985ff97cc6f7ba6dd6df5b2912f9be872eb0980c612fabf03e648ab" }
  },
  "validator": {
    "command": "node scripts/i18n/generate.ts [--check] on an origin/main mirror + #237 values",
    "result": "653 keys, 21 namespaces; --check current; placeholder negative control exits 1"
  },
  "current_report_verdict": { "status": "clean-with-findings", "unresolved_blocker_major_count": 0, "finding_ids": ["vi-N1"] },
  "counts": { "BLOCKER": 0, "MAJOR": 0, "MINOR": 0, "NIT": 1 },
  "audit_notes_not_execution_log": "Execution log for the validator and the negative control is in audit.log; this report's other statements are reasoning."
}
```

Ledger note (≤280 chars): "Independent vi audit of show_more/show_less at #237 8fdfb2e9: shipped pair
and candidate are identical (Xem thêm / Thu gọn); generate --check 653 keys, placeholder control
fails; 0 blocker/major, 1 nit. Record: i18n/audits/evidence/vi/mobile.session/vi1111sm1."
