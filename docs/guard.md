# Radient Guard on the phone

Radient Guard is Team-plan guardrail analytics that the **Local Operator host**
enforces, whatever surface the member is on (terminal, desktop app, phone). The
per-organization switch is a backend setting the host applies; a member's
consent is the host's own signed act. This page is what the phone does about it
and the relay contract it needs from the host.

**Status: the relay routes below do not exist on any host yet.** The phone ships
against this proposal and a mock (`tools/mock-relay/guard.ts`), shows a calm
"unavailable" line on any computer that does not advertise `features.guard`, and
makes **zero Guard requests** there. It cannot work end to end until a host
slice adds the relay twin of the desktop plane's routes
(`local_operator/server/models/desktop_guard.py`, slice L2c).

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

## Surfaces

| Surface | File | Shows |
| --- | --- | --- |
| Inbox | `src/features/notifications/guard-inbox.tsx` (wired in `notifications.tsx`) | A pinned "Radient Guard" row while the host says a request is waiting: title, reason line, **Review**. Draws nothing otherwise. |
| Consent card | `src/features/guard/guard-views.tsx` (`GuardConsentSheet`) | The RFC section 15.4' C4 card: reason, per-scope lines, "never sent", visibility, "runs in the background". Buttons: Don't share / Decide later / Share (widening: Keep current / Decide later / Share the new items). |
| Settings | `src/features/settings/guard-section.tsx` | Per-org indicator (sections 5.3, 13.3'), what is shared, this computer, Stop sharing (C2 confirm), Share again, the non-Team card (section 14'). |

Presentation safety (RFC section 5.2.3): the card opens only when the member
presses Review (arrival never opens it or takes focus); the non-sharing answer is
first and nothing is pre-selected; closing the card is "Decide later" and sends
nothing; input in the first 500 ms after the card renders is ignored; a card
whose scopes the app cannot describe withholds every answer button.

## The relay twin (proposed contract)

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

Errors the phone understands: `404`/`410` and the codes
`guard_consent_expected_mismatch`, `guard_consent_payload_invalid`,
`credential_operation_mismatch` mean "the request changed or was answered" (the
phone re-reads and says so); `409 guard_not_sharing` on revoke means it already
stopped; anything else on an answer is reconciled against a fresh
`GET /api/guard` before the phone says whether the choice was saved.

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
translations were audited there; those values are copied byte for byte. The 20
phone-specific strings are new and were translated by the coder agent only:
**they need an independent audit pass** before the strings are treated as final
in `fr`, `es`, `zh-CN`, `ru`, `vi`, `hi` and `ur` (the key list is in the pull
request).

The revoke confirm names the backup window from the host's `backup_days` (never
a literal) and omits the trace-detail sentence when the host did not measure it.
