# Audit — `mobile.session.user_message.show_more` / `show_less` · locale `fr`

Audit ID: `fr-showmore-20261111` · Date: 2026-11-11
Auditor: i18n-auditor (lopdev team), session `d31b329cb4f3`, model `deepseek/deepseek-flash`
Actual model source: this session's header; no fallback notice appeared.
Independent from translator session `b765f5790e10` / `anthropic/claude-sonnet-5-5`: YES.
Read-only audit: no repo edit, commit, push or PR post was made.

## Scope correction (confirmed here, not assumed)

The brief described these keys as English-only in PR #237. They are not.
At `8fdfb2e9` (PR #237 head, `integrate/mobile-batch-1111`) all seven locales carry a
value, added by `0beb4dd3` ("fix(transcript): show more/less …", the #235 coder) and
merged via `efdf8883` — not by a translator and not audited. `origin/main`
(`fa2bc5e0`) does not have the keys at all, so the shipped bytes are exactly the
#237 pair. Both pairs were audited.

## Pairs under audit

| pair | show_more | show_less | cells |
| --- | --- | --- | --- |
| (a) #237-shipped | `Afficher plus` | `Afficher moins` | 13 / 14 |
| (b) translator candidate | `Voir plus` | `Voir moins` | 9 / 10 |
| English source | `Show more` | `Show less` | 9 / 9 |

Width budget given: ~14 cells at a 320 pt column. Both pairs fit; the shipped pair
sits exactly at 14 on `show_less`.

Canonical hashes — `json.dumps(pair, sort_keys=True, ensure_ascii=False,
separators=(",",":"))`, UTF-8, no trailing newline:

- en: `26d065694437406a3aebff2dd163d08f6d1b3afa1ad51701630f2e4ab6ec9022` (105 bytes)
- fr #237-shipped: `b4a592728fecec52f8bfe3cb010517d9a835caad43d1677de8b05cfde81f5ae7` (114 bytes)
- fr candidate: `414aed772811e5e22f06baf238f926bf8f8c8ba407d40c1061317d00d8e9d23d` (106 bytes)

Input file hashes at `8fdfb2e9` (sha256 of the blob):

- `src/i18n/catalogues/en/mobile.session.json` `143508157b6d768367a4efe2a6edd41574dcd034bac5fa4aa879f3f70aab77b0`
- `src/i18n/catalogues/en/mobile.session.context.json` `ccfcb74f0e1a44c5ac1e2e45c02c5adea137bf4692c1567150124107ecb05102`
- `src/i18n/catalogues/fr/mobile.session.json` `a761ff1fb470a77cc1b53920fdb318ba727bb645ed3040802e3136cfc449fc95`

## Recommendation

**Ship (a), the #237-shipped pair `Afficher plus` / `Afficher moins`.**
No change to the #237 values is needed, so for `fr` the follow-on PR is a no-op:
drop `fr` from the follow-on slice rather than replacing the shipped bytes.

Why, in precedent order (shipped `origin/main` fr catalogue):

| key | English | fr shipped |
| --- | --- | --- |
| `mobile.session.subagents_hint` | Show the subagents | **Afficher** les sous-agents |
| `mobile.computers.show_details` | Show details | **Afficher** les détails |
| `mobile.signin.show_diagnostics` | Show sign-in details | **Afficher** les détails de connexion |
| `mobile.notifications.filter_label` | Show | **Afficher** |
| `mobile.schedules.show_less.wakes` | Show fewer wakes | **Afficher moins** de réveils |
| `mobile.schedules.show_less.monitors` | Show fewer monitors | **Afficher moins** de surveillances |
| `mobile.home.queue.view` | **View** queued messages | **Voir** les messages en attente |
| `mobile.team_bridge.profile.open` | **View** profile for {name} | **Voir** le profil de {name} |
| `mobile.computers.hide_details` | Hide details | Masquer les détails |

The fr corpus already splits Show → `Afficher` (six shipped keys), View → `Voir`
(two), Hide → `Masquer` (five), and `show_less` — the same concept as this key — is already
`Afficher moins …`. `Voir plus` re-uses the verb the corpus reserves for View and
would be the only Show rendering in the fr catalogue that does not say `Afficher`.

The candidate's recorded rationale — `Afficher plus` "rejected as longer" — does not
hold: it measures 13 cells against the 14-cell budget, and the control is not a pill.
In `user-message-clamp.tsx` it is a full-width `Pressable` (`w-full
items-center justify-center`, `minHeight: TOUCH_FLOOR`) whose label is centred
`text-meta` (12 px, weight 500, `design/tokens/tailwind-preset.js`): `Afficher
moins` measures ≈ 88 px at 12 px against a bubble that is ~270 pt wide at a 320 pt
column, so neither pair is near overflow, at 1× or with the app's text scale raised.

## Findings — pair (a), #237-shipped

None. 0 BLOCKER / 0 MAJOR / 0 MINOR / 0 NIT.

- Meaning and register correct: infinitival imperative used as a button, exactly the
  corpus idiom (`Afficher les détails`); neutral register, `vous` not implicated.
- Matched antonym pair, distinct strings, unambiguous as an expand/collapse toggle
  (the control is not a static label: `accessibilityState={{ expanded }}` and
  `accessibilityRole=button` carry the state, so the two words need only name the
  direction).
- Not a calque; not English; sentence case; no final stop; no punctuation that
  would require an espace fine insécable.
- Width within budget, geometry measured above.

## Findings — pair (b), translator candidate

Verdict: **clean-with-findings** — 0 BLOCKER / 0 MAJOR / **1 MINOR** / 0 NIT.
Do not ship it for `fr`.

- **MINOR (terminology consistency)** `show_more`/`show_less` = `Voir plus` /
  `Voir moins`. Both renderings are native, idiomatic French for a text expander and
  I would not call either wrong in isolation; the defect is corpus-level. `Voir` is
  the fr rendering of *View* in the two shipped keys in the table, and `Show` is
  `Afficher` in the six above; this pair would be the exception, and it replaces a shipped pair
  that is already consistent, for no width gain that the layout needs.
  **Suggested wording: keep `Afficher plus` / `Afficher moins`.**
  What would change my mind: a recorded fr locale call in
  `i18n/style-guides/fr.md` standardising expand/collapse on `Voir plus` / `Voir
  moins` (a defensible call on pure idiom — it is the dominant pattern on French
  consumer UIs) applied corpus-wide, not one control at a time.

Nothing else: the candidate passes every mechanical check (below) and the pair reads
as a control, not a label.

## Mechanical evidence

Repo validator (`node scripts/i18n/generate.ts --check`, run from a scratch mirror of
`8fdfb2e9`; the checkout on disk is an older branch, so `git archive 8fdfb2e9 src/i18n
scripts package.json tsconfig.json` was extracted to scratch and never written back):

- baseline, untouched mirror: `catalogue.gen.ts is current (653 keys, 21 namespaces,
  argument types from en, es, fr, hi, ru, ur, vi, zh-CN)`, exit 0.
- candidate injected into `fr/mobile.session.json`, regenerated:
  `--check` exit 0 — key parity, ICU parse, placeholder parity and staleness all
  green. (A PR applying either pair must regenerate `catalogue.gen.ts`.)
- validator negative controls (in the mirror): empty value → FAIL "must be a
  non-empty string"; dropped key → FAIL "disagrees with the English source —
  missing: …show_less"; extra parameter `{count}` → FAIL parameter parity;
  unbalanced `{` → FAIL "not a valid message". **Blind spot proven:** `show_more` set
  to `Show more` in fr → generate **passes** (exit 0). The repo gate is structural
  and does not detect English left in a catalogue, so the English-leftover check has
  to come from the audit, which is why the independent checker below exists.

Independent checker (`scratchpad/lo-fr-audit/check_pair.py`, 31 assertions per pair;
JSON validity, exact key set, non-empty, no edge/double space, placeholder names and
ICU brace balance, no markup/backtick/code tokens, Latin-script-only for fr, NFC, no
bidi controls (U+061C, U+200E/F, U+202A–E, U+2066–9), no final stop and stop parity
with English, not identical to English, toggle halves distinct, cells ≤ 14):

- en vs en (identical allowed): PASS 29/29.
- pair (a): PASS 31/31. pair (b): PASS 31/31.
- Negative controls, each must FAIL — all 11 bit: empty value, `Show more` leftover,
  Cyrillic character injected, U+202B injected, trailing space, 21-cell overflow,
  injected `{count}`, final full stop, dropped key, identical toggle halves, NFD
  (decomposed `é`). "Control rows that failed to bite: 0".

ICU/plural: neither key carries a placeholder, plural or select arm in English, and
neither pair introduces one — so no CLDR category set applies to this slice.

RTL: not applicable to `fr`; no bidi control characters in either pair, and the
corpus rule (direction is layout, never a string property) is respected by both.

## Provenance and process notes

- The candidate file `followon-show-more/fr.json` and its note are the lane owner's
  transcription of the translator's report (its own note says
  "not independently audited"); the values I audited are the transcribed pair, and
  hash (b) above pins exactly those bytes.
- Evidence bundle for a tracked record would go at
  `i18n/audits/evidence/fr/mobile.session/fr-showmore-20261111/{record.json,audit.log}`
  with `locale=fr`, `namespace=mobile.session`, `key_count=2`, `status=passed`,
  `unresolved_blocker_major_count=0`, the hashes above and the finding id
  `FR-SM-1`. **Not created:** this slice is read-only (no repo write, so no
  ledger/evidence commit), and the mobile repo has no ledger CLI to run. Whoever
  records it should keep the note to ≤ 280 chars, e.g.:
  `fr mobile.session show_more/less: #237-shipped Afficher plus/moins CLEAN, keep; candidate Voir plus/moins 1 minor (Afficher=Show x6, Voir=View); evidence i18n/audits/evidence/fr/mobile.session/fr-showmore-20261111; hashes b4a5927…/414aed7…`.
- Retained in session scratch only (temporary): the mirror, `gen.log`,
  `check_pair.py`, `fr.head.json`. Nothing durable was written.

## Final counts

| pair | status | BLOCKER | MAJOR | MINOR | NIT |
| --- | --- | --- | --- | --- | --- |
| (a) #237-shipped `Afficher plus` / `Afficher moins` — **recommended** | passed (clean) | 0 | 0 | 0 | 0 |
| (b) candidate `Voir plus` / `Voir moins` | clean-with-findings, not shipped | 0 | 0 | 1 | 0 |
