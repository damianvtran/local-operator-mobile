# Independent French audit — `relay.chrome` (`fr29rc1`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT.**

Independent current-byte value audit by `i18n-auditor`, separate from the translator. **Actual model: `kimi/k3.1-pro`**, temporary harness fallback after `anthropic/claude-sonnet-5-5` quota failure, with an intervening `openai/gpt-6-astra` switch. No human native-speaker review, rendered frame, translation/MT service, or back-translation is claimed.

## Scope and mechanical result

Four current keys, HEAD `4500723be18a94e53cde39a6f3f9ee1aca92ddb5`, MERGE_HEAD `d5babfa1854416265df06ba9a78609348db7f13d`. The mid-merge key-shape migration can change names later; this audit binds the current values and hashes.

`npm run -s i18n:check` passed. JSON is valid with unique keys and exact 4/4/4 English/context/French parity. All four values parse and render through the app's actual `parseMessage`/`renderFor` path to their exact French bytes. No ICU arguments, plural/select arms, markup, code spans, flags, paths, identifiers, or bidi controls occur. There are no French double-punctuation sites or apostrophes in these four values. All are short single-cell Latin-script labels; `Ne répond pas` is 13 cells, `Terminée` 8, `Reprendre` 9, and `Reprise…` 8, with no context width budget exceeded.

The second independent pass (reviewer job `cb8315ae0e76`, actual model `kimi/k3.1-pro`, harness quota fallback) returned the same hashes and no findings.

## Every-key language audit

| Key | Result | Accuracy, idiom, safety, and fit judgement |
|---|---|---|
| `relay.chrome.session.subtitle.not_answering` | PASS | `Ne répond pas` is the established, natural status for a live process not answering. It does not claim the session ended or that a send will queue. Feminine agreement with `session` is correct. |
| `relay.chrome.session.subtitle.ended` | PASS | `Terminée` is the correct feminine status and matches the ended-state wording in relay.health and core. It states ended, not deleted, and leaves resumability/history to the detailed explanation. |
| `relay.chrome.session.resume` | PASS | `Reprendre` is the prescribed glossary/catalogue imperative for this button. It matches both references in `relay.health` exactly, so the action has one name across the flow. |
| `relay.chrome.session.resuming` | PASS | `Reprise…` is concise in-flight terminology consistent with `Reprendre`; it indicates a requested but unfinished resume, not completed reopening. Final single-character ellipsis U+2026 is preserved. |

## Findings

None. No BLOCKER or MAJOR remains.

## Core adoption

Executed comparisons show each of the four mobile French values equals its counterpart in core `origin/main:local_operator/i18n/catalogues/fr/relay.chrome.json`. This is **value equality for the four assigned keys**, not a claim that the mobile four-key file is byte-identical to core's whole 84-key catalogue or has identical whitespace.

Reuse is right: these are shared state/action labels for the same relay behaviour, and the sidecars expressly require verbatim adoption so the clients cannot name one state or action differently. The values are also consistent with the rest of the mobile French catalogue and the safety copy that references them. Adoption does not replace independent review; each value was judged against its English and context above.

## Repository tests, separately disclosed

The final targeted test run returned **150 passed / 4 failed** elsewhere: two stale key-count expectations, a missing intentional-identical `Session` allowlist entry, and module-scope locale resolution in `health-copy.ts`. No Chrome-specific test failure occurred and no translation issue is hidden by this result. Actual output is in `audit.log`.

## Evidence and ledger

`record.json` carries the final input hashes and actual model provenance; `audit.log` is executed output, not notes. This mobile repository has no `i18n/ledger.json`, no audit-ledger command, and no local evidence README, so no ledger receipt is claimed. The proposed row under `record.json.ledger` is explicitly unwritten, references this record path, and has a note within 280 characters. The canonical core evidence contract supplied the bundle structure.
