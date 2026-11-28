# Radient Guard on the phone

Radient Guard is Team-plan guardrail analytics that the **Local Operator host**
enforces, whatever surface the member is on (terminal, desktop app, phone). The
per-organization switch is a backend setting the host applies; a member's
consent is the host's own signed act. This page is what the phone does about it
and the relay contract it needs from the host.

**Status: the routes live in the Local Operator host, not here.** The host's relay
twin is slice L2d (local-operator PR #4662); its design note,
`docs/design/guard-relay-twin.md` in that repository, is the source of truth for
every route, body and error code, and this page only records what the phone does
with them (the relay contract is never changed from this repository). Until a host
ships that twin the phone works against a mock (`tools/mock-relay/guard.ts`),
shows a calm "unavailable" line on any computer that does not advertise
`features.guard`, and makes **zero Guard requests** there. The twin is the relay
twin of the desktop plane's routes (`local_operator/server/models/desktop_guard.py`,
slice L2c).

## What the phone is, and is not

- It **shows** the host's account of the state (the indicator, what is shared,
  which computer) and **relays** the member's answer to the host over the
  existing authenticated relay channel.
- It **never grants.** The answer it sends is `{request_digest,
  disclosure_digest}` read from the card the member actually saw, or a bare
  decline. The host recomputes both digests from its queued record, refuses a
  mismatch before signing, signs with its own key and sends the one grant to
  Radient (RFC section 5.2, 5.2.2).
- It **never speaks to Radient's `/v1/guard/*`.** No code in the app names that
  path (`src/relay/__tests__/guard-endpoints.test.ts` scans the source).
- It **can stop but never start**: Settings offers "Stop sharing" and "Share
  again" (which only re-raises the host's prompt and grants nothing); "Share"
  exists only on the consent card.
- It sends and requests **no notification** (RFC section 5.2.3). The request is
  an item drawn in the inbox from the Guard status read, not a notification-store
  row, plus a row in Settings. `src/features/guard/guard-no-push.test.ts` pins
  that for this feature's source. The host must likewise send no push for Guard.
- It never appears in `session/[id]`: a consent request is about a computer, not
  a turn, and it never interrupts one.

## Connection states and live refresh

`useGuardAvailability` (`src/features/guard/use-guard.ts`) gates every Guard
request: `unknown` (no list frame yet), `offline`, `unsupported` (no
`features.guard`) and `degraded` make **zero** requests. `degraded` is a route
with an unhealthy live stream; Settings says "Reconnecting to your computer…"
there, not "Connect to a computer", because a route exists.

Guard sends no push, so while the inbox or Settings is open the phone re-reads
the host's status silently: when the app returns to the foreground and every 20 s
while it is in the foreground and the screen is focused
(`src/features/guard/guard-refresh.ts`). The read is skipped while a first read, a
write or an open consent card is in flight, a failed refresh keeps the last good
view, and a non-Team account does not re-fetch the trial card. Nothing polls
without `features.guard`.

## Surfaces

| Surface | File | Shows |
| --- | --- | --- |
| Inbox | `src/features/notifications/guard-inbox.tsx` (wired in `notifications.tsx`) | A pinned "Radient Guard" row while the host says a request is waiting: title, reason line, **Review**. Draws nothing otherwise. |
| Consent card | `src/features/guard/guard-views.tsx` (`GuardConsentSheet`) | The RFC section 15.4' C4 card: reason, per-scope lines, "never sent", visibility, "runs in the background". Buttons: Don't share / Decide later / Share (widening: Keep current / Decide later / Share the new items). |
| Settings | `src/features/settings/guard-section.tsx` | Per-org indicator (sections 5.3, 13.3'), what is shared, this computer, Stop sharing (C2 confirm), Share again, the non-Team card (section 14'). |

Presentation safety (RFC section 5.2.3): the card opens only when the member
presses Review (arrival never opens it or takes focus); the non-sharing answer is
first and nothing is pre-selected; closing the card is "Decide later" and sends
nothing; input in the first 500 ms after the card is **interactive** (the sheet
has finished rising, not merely when its state opened) is ignored; a card
whose scopes the app cannot describe withholds every answer button.

Round-2 behaviours worth knowing before changing this code (PR #402):

- **The sheet is full height with up to three title lines**, so the privacy
  sentences get room instead of a 120 pt window on a small phone and the title
  keeps the asking org's name at 200 % text. Share is never gated on scrolling.
- **A 200 is believed only when it answers THIS act**: the card's own approval id
  and tenant, and `granted` for a share / `denied` for a decline. Anything else is
  reconciled against the host's status, never worded from the button.
- **"Keep current" on a widening keeps sharing** what was already agreed (the host
  and the twin do), so the phone never says "Not sharing" for it; the status
  re-read paints the real indicator. (Core's TUI maps this the same wrong way at
  `guard_view.py:739`: a core follow-up.)
- **Opening a card another surface already answered** reconciles instead of saying
  "changed": the member reads "Answered on the desktop app · Guard: sharing with
  X" (existing catalogue strings only).
- **Org names are sanitised on parse** (`src/contracts/display-name.ts`): control
  and bidi characters are removed (ZWNJ/ZWJ kept), whitespace collapsed, 80 code
  points. The host already does this; the phone does not rely on it.
- **The non-Team CTA opens only `https://console.radienthq.com`** (an exact host,
  not the `*.radienthq.com` zone, which holds user-controlled tunnel hosts).

## The relay twin (the host's contract, as the phone reads it)

Same bodies and models as the desktop plane, cookie-gated like every `/api/*`
route (a request without the relay cookie answers `401`). Capability:
`capabilities.features.guard` (truthy), republished by the relay; absent means
"older host".

| Route | Answer |
| --- | --- |
| `GET /api/guard` | `GuardStatus` (L2c, unchanged). Local facts only: zero network, for every account. |
| `GET /api/guard/non-team-card` | `GuardNonTeamCard` (L2c) **plus optional `role`**. The one network read (team-trial eligibility); failure degrades to `{trial_days:null, org:null, url}`. `404 guard_not_applicable` for an account with a Team org. |
| `POST /api/guard/orgs/{tenant}/revoke` | `GuardRevokeResult` (L2c). No body. |
| `POST /api/guard/orgs/{tenant}/share-again` | `GuardShareAgainResult` (L2c). No body. |
| `GET /api/guard/consents/{approval_id}` | `GuardConsentCard` (new, below). |
| `POST /api/guard/consents/{approval_id}/accept` | Body `{request_digest, disclosure_digest}` (closed: any other key is `422`). The host performs the typed `guard_consent` approve-operation, the same call the desktop's `approve-operation` makes, and answers `{approval_id, state:"granted", tenant}`. |
| `POST /api/guard/consents/{approval_id}/decline` | No body. The host's ordinary `deny`. Answers `{approval_id, state:"denied", tenant}`. |

```
GuardConsentCard {
  approval_id, state ("requested" while answerable), tenant, org,
  reason, widening, asked_scopes[],         // what Share would grant: all or nothing
  request_digest, disclosure_digest,        // "sha256:<64 hex>", echoed by accept
  signable: bool, refusal?: string          // false when this host will not sign it
}
```

Errors the phone acts on (the host's full table is in `guard-relay-twin.md` §1):

| Answer | Meaning to the phone |
| --- | --- |
| `404 approval_not_found`, any `410`, a code-less `404` | The request is gone: "changed", re-read. |
| `409 approval_decision_conflict`, `409 approval_expired` | The host KEPT the card but it is already settled (another device answered, or it expired): "changed", re-read. |
| `409 guard_consent_expected_mismatch`, `guard_consent_payload_invalid`, `credential_operation_mismatch` | A digest is not the card's: "changed", re-read. |
| `404 guard_unavailable` (also `guard_not_applicable`, `guard_org_unknown`) | Guard is not available here / the org is unknown. **Not** "the request changed": the phone says it could not read or save, and re-reads the status. |
| `409 guard_not_sharing` on revoke | It already stopped; the phone re-reads and says so through the indicator. |
| `409 guard_answer_not_admitted` (share-again) | Not retryable from the phone: the host withholds it (`can_answer: false`) and the phone already hides "Share again". |
| `409 guard_consent_not_granted` | Signed but the grant did not land. The answer is reconciled against a fresh `GET /api/guard`; "Share" re-sends the same card's two digests. |
| anything else on an answer | Reconciled against a fresh `GET /api/guard` before the phone says whether the choice was saved. |

### Differences from the L2c desktop contract

1. **Consent routes are new.** L2c has no consent read or answer route (the
   desktop answers through `GET /v1/desktop/approvals` + `approve-operation` /
   `deny`). The phone needs a Guard-only door that exposes only `guard_consent`
   cards, so the relay does not become a general approvals proxy.
2. **`GuardNonTeamCard.role`** (`owner` | `admin` | `member` | null) is an
   additive optional field. L2c's card has no role, so the section 14' variants
   (owner CTA, admin "ask your owner", member nothing) cannot be decided from it.
   Absent, the phone shows the core TUI's card with its CTA.
3. **Capability** is `features.guard` on the relay (L2c: desktop-only).
4. Nothing else differs: `GuardStatus`, `GuardOrg`, `GuardPrompt`,
   `GuardRevokeResult` and `GuardShareAgainResult` are consumed unchanged, with
   enums read as open strings (a state or scope this build does not know is
   handled, never fatal).

### Host-side requirements (for the slice that adds the twin)

- The relay must call the same engine functions as L2c; no second implementation.
- A relay `accept` must keep the generic bodiless approve refused for
  `guard_consent` and must verify both digests against the record on disk before
  any signature (RFC section 5.9: a `disclosure_digest` that is not the queued
  prompt's is refused before signing).
- The relay must answer `accept` only for a card the host filed; the phone's
  cookie is the member's paired channel, not a grant.
- No push notification, notification-store row or badge may be raised for Guard.
- A non-Team account must produce zero `/v1/guard/*` requests from the host when
  the phone reads `GET /api/guard`; only `non-team-card` may reach the network,
  and only the team-trial eligibility endpoint.

## Copy and translation

All strings are the `mobile.guard.*` catalogue
(`src/i18n/catalogues/*/mobile.guard.json`). The RFC section 15.4' wording is
mirrored key for key from the core TUI catalogue (`tui.guard.*`), whose
translations were audited there; 69 values are copied byte for byte. The other 21
strings are phone-authored (19 phone-only, 2 adapted from core: `indicator_waiting`
and `prompt_background`, which say Settings where core says `/guard`). Their
non-English values were written by the translator agent against the core
glossary, the per-locale style guides and the core's own words for the same
concepts (computer, guardrail, share, answer), and carry translator receipts
under `i18n/receipts/`; **they still need an independent audit pass** before
they are treated as final in `fr`, `es`, `zh-CN`, `ru`, `vi`, `hi` and `ur`.

The revoke confirm names the backup window from the host's `backup_days` (never
a literal) and omits the trace-detail sentence when the host did not measure it.
