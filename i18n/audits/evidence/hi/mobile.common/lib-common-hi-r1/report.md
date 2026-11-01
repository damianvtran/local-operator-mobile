# Audit report — mobile.common (hi)

- **Audit ID:** lib-common-hi-r1
- **Date:** 2026-10-31
- **Auditor:** i18n-auditor (lopdev team); session `cca25211395f`; model `anthropic/claude-sonnet-5-5` (no fallback observed in the session header)
- **Independence:** not the translator of any audited file; translator session not observed. Model identity of the translator is not known to this auditor, so model diversity is neither claimed nor disclaimed.
- **Verdict:** **passed** — 6 keys, 0 BLOCKER, 0 MAJOR
- **Worktree:** `/Users/damian/.local-operator/sessions/d5aaf8ba6ba5/scratchpad/lib-wave`, detached at `4fd4ad7c` + uncommitted extraction; audited bytes are working-tree bytes identified by `input_hashes`.

## Mechanical (executed; see `audit.log`)
`node scripts/i18n/generate.ts --check` exit 0 (178 keys, 12 namespaces); key parity en=6/hi=6; no placeholders or ICU in this namespace; no control/bidi characters; no trailing full stop; valid JSON. `vitest src/i18n/__tests__/catalogues.test.ts` was also run once (57 passed, HOME redirected), output in the session, not in this log.

## Convention review
Call sites (library-screen.tsx / library-detail.tsx): `back` = quiet header text button (`router.back()`), `try_again` = outline button under an error Alert re-running a failed load, `done` = footer of the filter / sort / more-kinds sheets (closes only), `cancel` = quiet button beside Save in the details-editor sheet footer (aborts, leaves the discard dialog its own hard-coded labels), `save` = commit in that sheet, `send` = adjacent to the composer Textarea. Each rendering carries exactly that generic sense; none implies undo, destructive confirm, upload/share, restart or reset.

Collision check against the same locale's shipped catalogue (`mobile.notifications.back`, `.dismiss`, `mobile.account_routing.retry/save`): see the table in `audit.log`. `cancel` and `notifications.dismiss` are different words in this locale; `back` and `try_again` are byte-identical to the shipped `mobile.notifications.back` and `mobile.account_routing.retry`, so no screen shows two words for one action.

## Per-key
| key | English | hi | judgement |
|---|---|---|---|
| `mobile.common.back` | Back | वापस | clean |
| `mobile.common.cancel` | Cancel | रद्द करें | clean |
| `mobile.common.done` | Done | हो गया | clean |
| `mobile.common.save` | Save | सहेजें | clean |
| `mobile.common.send` | Send | भेजें | clean |
| `mobile.common.try_again` | Try again | फिर से कोशिश करें | clean |

## Findings
- **lib-common-hi-r1-m1** (MINOR) `mobile.common.try_again` — `फिर से कोशिश करें`: The core relay catalogue and the desktop UI render English 'Try again' as 'फिर कोशिश करें' (no 'से'; core relay.notifications.error.retry, ui x22), while the shipped mobile catalogue already uses 'फिर से कोशिश करें' for mobile.account_routing.retry and mobile.session_health.resume_refused. The common key matches the same-locale mobile precedent and is the more natural Hindi, so it is kept; the cross-product variance is recorded, not a defect. Verified by the same-locale vocabulary dump in audit.log.
- **lib-common-hi-r1-n1** (NIT) `mobile.common.back` — `वापस`: The desktop UI renders Back as 'पीछे' (ui.onboarding.modal.action.back); mobile.notifications.back and core relay.* use 'वापस'. The mobile/core pair wins; a bare 'वापस' is acceptable as a text button on a header.

## Observations outside this namespace (not findings here)
`src/ui/components/dialog.tsx` hard-codes `"Cancel"` and library-detail passes `confirmLabel="Discard"` and an English body to the discard dialog, so the Cancel on the translated editor sheet and the Cancel on the discard dialog above it will render in two languages in the same flow until those are extracted. Owner: the wave's coder / baseline ratchet, not this namespace.

## Route and limits
Route: ordinary worktree reads and python/json parsing; `read_public_copy` is refused for `src/i18n/**` and not used; sidecars are not routable and were read as worktree files. No receipt claimed. Redaction scan: 0 credential-shaped matches in the three audited inputs (grep count in `audit.log`). No translation API or MT service was used; judgements are reading judgements by an LLM auditor, no native-speaker review, no rendered frame captured (widths are character counts: longest value 17 code points).
