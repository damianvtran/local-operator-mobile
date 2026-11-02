# Independent French audit — `mobile.session_health` (`fr29sh1`)

**Verdict: `changes_requested` — 0 BLOCKER, 1 MAJOR (`SH-01`), 0 MINOR, 0 NIT.**

Independent current-byte value audit by `i18n-auditor`; translator was a different agent/session. **Actual model: `kimi/k3.1-pro`**, harness temporary quota fallback from `anthropic/claude-sonnet-5-5` (with an intervening `openai/gpt-6-astra` switch). No human native-speaker review, rendered frame, translation/MT service, or back-translation is claimed.

## Scope and mechanical result

Eleven current keys. Mid-audit, `ended_placeholder` moved here from `relay.health`; the report and hashes bind the **final eleven-key namespace**, not the earlier ten-key brief. HEAD `4500723be18a94e53cde39a6f3f9ee1aca92ddb5`, MERGE_HEAD `d5babfa1854416265df06ba9a78609348db7f13d`. Values are audited; a later key-shape migration may change names.

`npm run -s i18n:check` passed. JSON is valid with unique keys and exact 11/11/11 English/context/French parity. All values parse and render through the real `parseMessage`/`renderFor` path to their exact French bytes. There are no ICU arguments, plural/select arms, markup, code spans, commands, flags, paths, or identifiers. No bidi controls, wide glyphs, or combining marks occur. Apostrophes are U+2019 and sentence case is consistent. The second independent pass (reviewer job `cb8315ae0e76`, actual model `kimi/k3.1-pro`, harness quota fallback) independently returned the same input hashes and the placeholder MAJOR.

## Every-key language audit

| Key | Result | Accuracy, idiom, safety, and fit judgement |
|---|---|---|
| `mobile.session_health.control_hint` | PASS | `Affiche ce que signifie cet état et ce qu’un envoi fait maintenant` promises only an explanation of state and current send behaviour, not an extra action. Natural accessibility hint; terminal full stop acceptable in a spoken sentence. |
| `mobile.session_health.menu_label` | PASS | `Actions de la session` is the concise, correct accessible name for session actions. No translation of a product identifier. |
| `mobile.session_health.menu_hint` | PASS | `Ouvre le menu de la session` accurately describes opening the menu; compact and idiomatic. |
| `mobile.session_health.menu_title` | PASS | `Session` is the glossary term and correct one-noun sheet title. Identical English/French is intentional, not an omitted translation. It needs the repository's narrow intentional-identical test exemption, separately disclosed below. |
| `mobile.session_health.reopening` | PASS | `Réouverture — cela peut prendre quelques secondes` preserves an in-progress reopen and an approximate wait, with no success promise. Terse status register and spaced em dash correct. |
| `mobile.session_health.still_reopening` | PASS | `Réouverture toujours en cours — elle n’est pas encore revenue` preserves still-pending and not-yet-up. `elle` refers naturally to the session; no implication that reopening silently failed or already succeeded. |
| `mobile.session_health.resume_refused_title` | PASS | `Reprise impossible` is an idiomatic, concise failure title consistent with `Reprendre`/`Reprise…`. It does not blame the user or claim permanent deletion. |
| `mobile.session_health.resume_refused` | PASS | `Cette session n’a pas pu être rouverte pour le moment. Réessayez.` preserves a retryable failure and vous imperative; no promise the retry works. Consistent with the adjacent Resume flow. |
| `mobile.session_health.resume_gone` | PASS | `Cette session n’est plus enregistrée` matches the Past sessions fact and gives no useless retry invitation. No softening into temporary unavailability. |
| `mobile.session_health.resume_no_route` | PASS | `Connectez un ordinateur pour reprendre cette session` exactly follows established `Connectez un ordinateur pour…` catalogue terminology and names the missing prerequisite rather than blaming the session. |
| `mobile.session_health.ended_placeholder` | **SH-01 MAJOR** | 44 cells against the 36-cell budget and awkwardly elliptical French. See finding below. |

## Finding

### SH-01 — MAJOR — `mobile.session_health.ended_placeholder` (fit and idiomatic completeness)

**Current:** `Envoyer rouvre dans votre dossier personnel…`

Two defects converge on this high-visibility safety/action hint:

1. **Measured budget failure.** Python/Unicode cell measurement gives **44 cells**, including one for the final U+2026; all characters are single-cell. English is 35 cells; the sidecar budget is **36**, so French is **8 cells over**. This is not UTF-8 byte counting (46 bytes) or an estimate.
2. **Unidiomatic omission of the object.** `Envoyer rouvre…` leaves the thing being reopened implicit in a way that reads clipped/calqued rather than like finished product copy. `la` restores the natural reference to the session.

The fit risk is real, not dismissed as harmless wrapping. `composer.tsx` passes `placeholderMaxLines={1}` and requires a stable one-line resting box. `textarea.tsx` clamps the placeholder's height contribution and documents why the former wrapping/clamping overlay was removed; on web it swaps an empty capped field to a single-line input specifically to ellipsize overflow. A cell count is not a pixel-width proof, so no precise clipping viewport or native-rendered result is claimed. Nevertheless the source explicitly budgets this string, the UI constrains it to one line, and an eight-cell excess plus clipped-sounding syntax warrants correction.

**Exact replacement:** `Envoyer la rouvre (dossier perso)…`

Measured **34 cells**, within the 36-cell budget. `la` naturally refers to the session; `dossier perso` is a compact, intelligible form of the user's home folder already used by the former core French placeholder. It preserves the fact that sending reopens, the destination, and the final ellipsis, without promising delivery or a response. This is a language/width remediation recommendation; rendered validation remains for the implementer/design/QA gates.

The independent second pass also selected this replacement and severity.

## Repository tests, separately disclosed

The final targeted run returned **150 passed / 4 failed**. Relevant to this namespace: expected count still says 10 although the current source has 11; `menu_title` is absent from the narrow `IDENTICAL_BY_DESIGN` allowlist; and `health-copy.ts` resolves `t()` at module scope contrary to the call-time locale rule. The fourth failure is relay.health's stale 9-key expectation. These do not erase or replace SH-01 and are not counted as extra language findings. Full output is in `audit.log`.

## Evidence and ledger

The bundle records final hashes, the second-pass model, and actual commands. This mobile repository has no ledger file or audit-ledger command, so no CLI receipt is claimed. `record.json.ledger.ledger_row_proposed` explicitly marks the suggested row unwritten, references this record, and fits the 280-character note cap. No local evidence README exists; the canonical core evidence contract guided the bundle layout.
