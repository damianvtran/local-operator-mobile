# Hindi (`hi`) — `mobile.projects` — round 2 (delta re-audit)

| | |
|---|---|
| Locale | `hi` |
| Namespace | `mobile.projects` (15 keys) |
| File group | B (four namespaces, 77 keys: this one + `mobile.schedules`, `mobile.computers`, `mobile.notifications`) |
| Round | 2 — same-history delta re-audit |
| Parent audit | `hi30p1` (`i18n/audits/evidence/hi/mobile.projects/hi30p1/`) |
| Audited head | `d4e31b1915b558171ded41501c741568f0854f3f` on `feat/i18n-hindi` |
| Worktree | `/Users/damian/workspace/hi-wave` |
| Date | 2026-10-30 |
| Auditor | `i18n-auditor` (lopdev), session `4d508455ed51`, served model `radient/auto` (fallbacks disclosed in `record.json`) |
| Verdict | **passed** — 0 BLOCKER, 0 MAJOR; one MINOR recorded, non-gating |

## Scope

Round 1 raised four findings here (HI-B-8 MINOR, HI-B-9 MINOR, HI-B-10 NIT,
HI-B-11 NIT) and passed the namespace. The implementer applied HI-B-8, HI-B-9 and
HI-B-10 in `d4e31b1` and took HI-B-11's first option (leave as shipped). Three
keys changed; the other twelve are byte-identical to the audited round-1 bytes
(the transcript proves it by reproducing `hi30p1`'s `input_hashes.target.sha256`,
`c2e2a904…53be55`). The English source and its sidecar are unchanged.

## Findings: resolution

| ID | Severity | Key | Resolution | Evidence |
|---|---|---|---|---|
| HI-B-8 | MINOR | `draft_kept_note` | **resolved byte-exactly** | `…सुरक्षित रखा गया। कुछ नया शुरू करने के लिए फ़ील्ड खाली करें।` |
| HI-B-9 | MINOR | `session_state.filed_by` | **resolved byte-exactly** | `द्वारा दर्ज` |
| HI-B-10 | NIT | `write_receipt` | **resolved** | `deleted {मिटाया गया}` in **all three** kind arms; zero `deleted {हटाया गया}` left |
| HI-B-11 | NIT | `write_receipt` | **left as shipped** (the record's own option 1) | `“{subject}”` kept in all three arms |

"Byte-exactly" means the shipped value equals the string in `hi30p1/record.json`
under that finding's `replacement`, compared with `==` in `delta_resolve.py`.

## The receipt, every kind arm re-read (HI-B-10)

All 24 `kind × action` combinations were rendered through the app's own
`renderFor()` (raw tag `hi`) and read. The verb arms are identical in all three
kind arms, so the table is the verb; the full sentence wraps it as
`“{subject}” प्रोजेक्ट …` / `“{subject}” पड़ाव …` / `“{subject}” …`:

| action | rendered verb | note |
|---|---|---|
| created | बनाया गया | "was made" |
| completed | पूरा किया गया | "was completed" |
| reopened | फिर खोला गया | "was reopened" |
| added | जोड़ा गया | "was added" |
| updated | अपडेट किया गया | "was updated" |
| removed | हटाया गया | "was removed" |
| deleted | **मिटाया गया** | "was erased" — the distinction round 1 asked for |
| other | अपडेट किया गया | unknown code falls back, as English does |

Composed examples, one per kind arm:

```
project    “beta” प्रोजेक्ट मिटाया गया।
milestone  “beta” पड़ाव मिटाया गया।
other      “beta” मिटाया गया।
```

All three read correctly. The pair is grounded in core's own committed Hindi,
which uses `मिटाना` for an irreversible delete (`wire.slash.delete`: "इस बातचीत
को हमेशा के लिए मिटाएँ; पुष्टि माँगता है") and `हटाना` for dismissing or removing
(`tui.notifications.hint_dismiss`, `hint_clear`, `relay.chrome` "हटाएँ" — 80
occurrences of `हटा-` against two of `मिटा-` in the whole catalogue). So the pair
now mirrors the English removed/deleted pair on core's own terms, and the kind
noun (`प्रोजेक्ट` / `पड़ाव`) keeps the two apart even in the `other` fallback. Agreement is masculine in every arm,
which is the grammatical gender of both `प्रोजेक्ट` and `पड़ाव`, and of the
subject-less fallback.

## New MINOR raised by the delta (non-gating)

**HI-B-12 (MINOR, newly raised by this delta — the key itself is unchanged)**

* Key: `mobile.projects.delete_body` (changed neighbour: `write_receipt`'s
  `deleted` arm).
* Current question: `{name} हटाएँ? प्रोजेक्ट की पंक्ति हमेशा के लिए चली जाएगी। …`
* Receipt now: `“{name}” प्रोजेक्ट मिटाया गया।`
* Problem: the same irreversible action is named with two different verbs inside
  one flow. The user is asked `हटाएँ` ("remove") and then told `मिटाया गया`
  ("was erased"). Before `d4e31b1` both said `हटाया/हटाएँ`, so the split is a
  consequence of the fix, not a pre-existing defect. Core's own split makes the
  confirmation the odd one: `wire.slash.delete` renders a permanent delete as
  `मिटाएँ; पुष्टि माँगता है`, while `हटाएँ` is core's dismiss/remove verb
  (`tui.notifications.hint_dismiss`). `हटाएँ` here is also the verb the milestone
  *remove* uses (`remove_milestone_body`), which is exactly the removed/deleted
  collapse HI-B-10 set out to break.
* Suggested wording: `{name} मिटाएँ? प्रोजेक्ट की पंक्ति हमेशा के लिए चली जाएगी। उससे जुड़े सत्रों और उनकी ट्रांसक्रिप्ट को छुआ नहीं जाएगा।`
* Why not MAJOR: meaning, polarity and the destructive warning are all intact —
  the sentence still says the row goes for good. It reads, it is simply two
  words for one act. Not gating; a one-word alignment whenever this namespace is
  next touched.

Related fact, **not** a finding: the delete dialog's own title and confirm button
are hard-coded English literals (`project-detail.tsx`, `title="Delete project"`,
`confirmLabel="Delete"`), baselined in `scripts/i18n/strings-baseline.json` and
identical in every locale. That is an app-level coverage gap outside the
catalogue, and it is one more reason the sentence's `हटाएँ` is the odd one out.

## `filed_by`, corrected composition (HI-B-9)

My round-1 note described the fragment as joining the session name inline. That
is wrong at this head and the correction matters for the wording:
`linkedSessionState()` returns the fragment into its **own** `Text` block below
the session label (`project-detail.tsx:437-443`), so a coordination row renders

```
work-a
द्वारा दर्ज
```

two lines, with no `·` separator. `द्वारा दर्ज` under the name still composes as
`work-a द्वारा दर्ज` ("filed by work-a") — the postposition belongs to the
preceding name, which is the standard Hindi order — and it is the same shape as
the sibling states in that slot (`गायब`, `नहीं चल रहा`): a short status fragment.
The old `दर्ज किया` was a finite verb fragment that could not attach to a filer;
this can.

## Mechanical

* `node scripts/i18n/generate.ts --check` → exit 0.
* `node scripts/i18n/check-strings.ts` → exit 0, 284 baselined, 0 new.
* Independent structural verifier, all 77 group-B keys → 0 problems, 1 accounted
  escalation (in `mobile.schedules`, not here); placeholder name sets, select
  arms and per-arm placeholders identical to English; every plural node carries
  `one` + `other`; key order identical to English; NFC clean; no controls.
* Verifier negative controls 8/8 as expected.
* `vitest run src/i18n src/features/schedules src/features/projects` → 7 files,
  188 tests passed, exit 0. `tsc --noEmit` exit 0.
* Width: `“beta” प्रोजेक्ट मिटाया गया।` is 20 cells against English's 23;
  `द्वारा दर्ज` is 7 against `filed by`'s 8. Nothing grew against the source.

## Honest limits

One independent auditor on this delta; no second pass and no rendered frame are
claimed. The destructive strings were re-read as source and rendered through the
runtime, not screenshotted.
