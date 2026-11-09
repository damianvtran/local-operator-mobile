# Urdu project creation and status audit

Auditor: translation-auditor; model: openai/gpt-6.1-terra; session: 37d4a14cbda7. Independent from translator job c9c413086a50. Commit 52e26313ca7b7f628b2fb70a42d0a11cf1cc6a4d.

## Findings

- **Minor — `mobile.projects.status.archived`**: current `محفوظ شدہ`; proposed `آرکائیو شدہ`. The current wording commonly means saved/preserved and does not distinguish archiving from ordinary saving; the proposed loanword names the lifecycle state more explicitly.
- **Minor — `mobile.projects.status.qa`**: current `معیار کی جانچ`; proposed `QA` only if product terminology permits, otherwise retain the accurate wording and verify chip layout on a rendered narrow device. English `qa` is two characters and the translation is 13 Unicode code points, so its selectable chip may wrap or crowd its neighbors; no overflow has been demonstrated.

## Verdict

- `mobile.projects.create`: **clean**, 10 keys; the identifier `my-project` and tag examples `ios, q4` retain valid ASCII syntax and separators. The formal imperative is consistent across the two action/instruction strings examined.
- `mobile.projects.status`: **findings**, 7 keys; archived clarity and QA chip-width risk as above. `planning` is also longer than English in code points (11 vs 8) and should be included in the same rendered check, without asserting overflow.
- **Overall: changes/checks recommended; 17 key pairs read.** All 34 per-key public-copy calls succeeded. None of the 17 source or target values contains a placeholder, ICU branch, number/date skeleton, or markup token; ICU/plural preservation is not applicable to this slice. Examples contain embedded Latin and punctuation; they are byte-identical to English, but their visual ordering in an RTL UI requires a rendered check. No browser, tests, Node, installs, or translation edits were used. No whole-namespace consistency conclusion is claimed beyond this 17-key slice.

Context: scanned English context sidecar read directly under explicit authorization; only creation keys and status role notes apply. Screenshots and actual chip widths were not measured.
