# Independent French audit — `relay.health` (`fr29rh1`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT.**

This is an independent, current-byte value audit by `i18n-auditor`, not the translator. **Actual model: `kimi/k3.1-pro`**, selected by the harness as a temporary fallback after `anthropic/claude-sonnet-5-5` quota failure; the model-switch notice also passed through `openai/gpt-6-astra`. No human native-speaker review, rendered frame, translation/MT service, or back-translation is claimed.

## Scope and pin

Eight current keys. During this audit the unfinished mid-merge branch moved `ended_placeholder` to `mobile.session_health`; this report binds the **final eight-key namespace**, not the superseded nine-key brief. HEAD `4500723be18a94e53cde39a6f3f9ee1aca92ddb5`, MERGE_HEAD `d5babfa1854416265df06ba9a78609348db7f13d`. All three verdicts concern values at the input hashes in `record.json`; a future key-shape change may rename keys without changing this value judgement.

The second independent pass was reviewer job `cb8315ae0e76`, actual model `kimi/k3.1-pro` (its harness model-switch notice, quota fallback). It independently returned the same eight hashes and no finding in this namespace. Its optional shortening of `reconnecting_detail` was considered but **not adopted as a finding**: the current wording makes the phone's automatic reconnection explicit and is natural French; brevity alone is not a defect.

## Mechanical result

`npm run -s i18n:check` passed on the final assigned bytes: generated catalogue current, 143 keys in 10 namespaces; string ratchet unchanged. Independent JSON parsing found unique keys and exact 8/8/8 English/context/French parity. All eight values parse through the app's `parseMessage`, have no arguments, plural/select arms, markup, code spans, flags, paths, or identifiers, and return their exact French bytes through `renderFor`. No CLDR arms are needed in this namespace.

Every apostrophe is U+2019. The semicolon and internal guillemet spaces are U+202F. Em dashes are spaced. There are no bidi controls, combining marks, wide glyphs, or product/technical-token substitutions. Status labels `En ligne` (8 cells) and `Reconnexion` (11) are within their 16-cell budgets; the longer explanations have no width caps and are ordinary wrapping help text.

## Every-key language audit

| Key | Result | Accuracy, idiom, safety, and fit judgement |
|---|---|---|
| `relay.health.live` | PASS | `En ligne` accurately names live/reachable operation, not an instant reply or merely an active/idle state. Compact native status; no final stop; fits. |
| `relay.health.live_detail` | PASS | `S’exécute sur votre ordinateur — vos messages lui parviennent tout de suite` keeps the computer as the running host and says messages reach **it** promptly. It does not promise an agent reply. Elliptical status-sheet opening is idiomatic and matches the fragmentary English. |
| `relay.health.reconnecting` | PASS | `Reconnexion` is the standard concise automatic-reconnection state, without an unwanted ellipsis; fits. |
| `relay.health.reconnecting_detail` | PASS | The lost link belongs to **this phone**, automatic retries continue, the session **may** still run, and sending **may** fail until reconnection. No queueing or delivery guarantee is introduced. `continue d’essayer de se reconnecter` is explicit, idiomatic vous-register product copy; semicolon typography correct. |
| `relay.health.dropped_detail` | PASS | `n’arrive pas à joindre` preserves inability rather than permanent loss; `échoue aussitôt` preserves immediate send failure; `votre texte reste dans la zone de saisie` preserves draft retention. It neither says the send queues nor that the text was delivered. |
| `relay.health.quiet_detail` | PASS | `ne répond plus` and the uncertain `peut-être occupée ou bloquée` match stopped-responding/busy/stuck. A reported failure can still arrive later (`peut … arriver malgré tout`), with no unconditional delivery promise. `Réessayer ne l’enverra pas en double` preserves the source's same-command retry-deduplication statement and does not generalize it to a new send. |
| `relay.health.ended_detail` | PASS | History retained; vous imperative; sending or `Reprendre` reopens in the home folder. The quoted label matches `relay.chrome.session.resume` exactly, and `dossier personnel` retains the home-directory destination. No claim of reopening in the original project. |
| `relay.health.ended_send_failed` | PASS | Keeps both ended state and failed reopen, the retry action, and the top-status route. `Terminée` and `Reprendre` match the Chrome labels byte-exactly. Guillemets and U+202F are correct; no blame or false success promise. |

## Findings

None. No BLOCKER or MAJOR remains.

## Adoption from core

For every one of these eight keys, the mobile English **value** equals core `origin/main:local_operator/i18n/catalogues/en/relay.health.json`, and the mobile French **value** equals core `origin/main:local_operator/i18n/catalogues/fr/relay.health.json`. The executed per-key comparisons are in `audit.log`. Formatting/indentation of whole JSON files is not the claim: the eight string pairs are identical.

Adopting rather than freshly translating is sound here: the mobile context deliberately specifies the same safety semantics, and reuse prevents two clients from drifting on immediate failure, uncertain delivery, same-command retry deduplication, or Resume. The shared core Chrome labels also match. Reuse is not a substitute for this audit: all eight were independently judged against their mobile sidecars.

Core `origin/main` has deleted `relay.health.ended_placeholder`; this eight-key file correctly does not adopt a French value for that deleted key. The mobile-only placeholder is judged separately in `fr29sh1`.

## Repository tests, separately disclosed

The requested validator passes, but `npx vitest run src/i18n/__tests__ src/features/session/health.test.ts src/features/session/composer.test.ts` returned **150 passed / 4 failed** on the final run. Two failures are stale expected counts (9 and 10 instead of the current 8 and 11); one is the missing `mobile.session_health.menu_title` intentional-identical allowlist entry; one is module-scope `t()` in `health-copy.ts`, conflicting with the runtime's call-time locale rule. These are repository/code convergence issues, not hidden translation passes. Actual output is in `audit.log`; no catalogue or test was edited by this auditor.

## Evidence and ledger

`record.json` carries hashes and provenance; `audit.log` is actual executed output, not notes. The mobile repository has no `i18n/ledger.json`, no audit-ledger command, and no local evidence README. It therefore cannot record the RFC's core CLI row here. The proposed, explicitly unwritten row is in `record.json.ledger`; its note references this tracked record path and remains within 280 characters. The core `i18n/audits/evidence/README.md` contract was used for bundle structure; no claim is made that a mobile README exists.
