# Team Bridge on mobile

Team Bridge is a hub-backed messaging surface, separate from the sessions on a
computer. A phone signed in to Radient reads `/v1/messaging/*` directly from
`https://api.radienthq.com`, using the existing `lop` OAuth access token. Picking
a computer, minting a tunnel session and keeping a laptop awake are **not**
prerequisites. The computer relay and its completion-notification contract do not
change.

## Admission and navigation

Team Bridge is available from the conversations drawer, the computer picker and
the welcome screen. The entry opens a gate until `/v1/messaging/status` answers.
The admission order mirrors the desktop's `teamBridgeEligibility`: signed out,
unsupported contract version, unavailable service, then missing organization
entitlement. Only an eligible Radient organization opens the messaging chrome.
Organizations with retained endpoints can appear read-only beside eligible ones.

A person row is that person's DM. Opening a row sends no create request; the
first nonempty message creates the DM and then sends. The composer retains the
created conversation id after a failed send and retains the same `client_ref`
when retrying the same text. Lost responses therefore do not produce duplicate
DMs or duplicate messages. Chiefs of staff use the directory's current agent
name and endpoint rather than a hardcoded agent identity.

The wire schemas are independent of the relay's generated contract. Optional
built-in, directory-agent, thread and reaction fields are additive; older hubs
remain readable. The fixtures follow the response structs in agent-server
`internal/responses/bridge.go` and `bridge_conversation.go` at `321a7be` (read
2026-10-21); built-in channels and directory agents are explicitly optional.

## Plan guidance and store policy

The plan gate names the Radient Team plan and explains channels, DMs, chiefs of
staff and notifications. It **does not create a checkout**.

Native iOS **and Android** show neutral text: “Manage your plan in the Radient
console.” They do not expose a purchase link. The publishing policies already
recorded in [Apple §3.6](publishing/apple-app-store.md) and
[Google Play §7](publishing/google-play.md) choose a free companion-app posture
without purchase steering. A web build can offer “Upgrade to Team”, opening the
console's existing `/dashboard/team` page (TeamPlanCard → UpgradeTeamDialog).
Changing the native posture requires an explicit store-policy decision, not a
new in-app billing flow. No store submission or listing work accompanies this
feature.

## Push contract (additive to ADR 0006 §3.2)

The legacy `completion`, `attention` and `digest` types remain computer-bound.
Team Bridge adds `type: "team_bridge_message"`, version `v: 1`, with:

```json
{
  "v": 1,
  "type": "team_bridge_message",
  "tenant_id": "ten_example",
  "conversation_id": "bcv_example",
  "message_id": "bcm_example",
  "seq": 7
}
```

It deliberately has **no `computer` or relay `conversation` handle**. A tap opens
`/team-bridge/<tenant_id>/<conversation_id>`, retaining the destination while
Radient authentication restores. It never waits for a relay. Unknown versions,
unsafe path segments and malformed destinations are ignored.

The hub supplies the OS alert: title = sender, subtitle = channel/group/DM plus
organization, body = short plain-text preview. This is a new privacy boundary:
**APNs/FCM receive that preview**, unlike ADR 0006's content-free computer
completion alerts. The hub's durable outbox holds identifiers only. Message
bodies, device tokens and provider response bodies must not appear in logs.
The icon badge remains app-managed; pushes never set `aps.badge`.

For expo-notifications 57 the APNs data object goes under top-level `body` (not
`data`); Android uses a data-only FCM v1 message whose `body` value is the JSON
string above. All FCM data values are strings. The native package's
`NotificationRecords.swift` and `NotificationSerializer.java` map both into
`notification.request.content.data`.

The device registers directly with the hub on launch/foreground when Radient is
signed in and OS permission is already granted. The permission prompt stays an
explicit Settings action, never a mount effect. Sign-out attempts deregistration
before the OAuth grant is retired. Device PUT and DELETE requests carry a
**persisted monotonic `generation`** (DELETE uses a query parameter). The hub
retains a revocation/incarnation fence: an older authenticated PUT cannot
recreate a row after a newer DELETE, even when the original HTTP outcome was
unknown. The phone also serializes admitted registration before removal, pins
cleanup to its original account, and refuses mutations when incarnation storage
fails. Cleanup has a 35-second ceiling (up to two 15-second hub requests); a
network failure is still best effort and must not be described as guaranteed
provider revocation. Token rotation re-registers through the same queue.

Pushes for the currently watched, focused,
active thread are quiet; other Team Bridge messages may show a foreground
banner. Non-Team-Bridge pushes retain expo's previous no-handler behaviour.

### Release dependencies

The companion agent-server push PR supplies device registration, the
transactional outbox and provider fan-out. That worker remains dark unless the
existing Team Bridge gate **and** provider credentials permit delivery. Native
push additionally needs an appropriately signed iOS build / Android Firebase
build configuration and registered device. No feature flag, organization
membership, consent receipt, deployment or credential was changed by this PR.

## People: photos and profile cards

Display only. The directory (`GET /v1/messaging/directory`) carries each
member's `profile` and a relative, hash-pinned `avatar_url`
(agent-server `docs/ACCOUNT-PROFILE.md`). Both are optional, so an older hub
parses unchanged and the rows keep their initials. Conversation participants
do not carry them; the directory is the one source.

- **Photos** are read with the Radient bearer from
  `GET /v1/accounts/{id}/avatar?v=<hash>&size=64|256` (`client.avatarBytes`)
  and shown from an in-memory `data:` URI. A provider URL is never requested.
  Rows read 64 px; the card reads 256 px. A 404, a network failure or bytes
  that do not decode leave the initials in place, and a failure is remembered
  so a list never re-requests it per render (`src/team-bridge/avatars.ts`).
- **The cache** is in memory, keyed by account + hash + size, bounded in
  entries and bytes, and owned by the account-keyed provider: an account
  change or sign-out drops it and retires reads still in flight.
- **The profile card** opens from a person's photo, or from a message author's
  photo or name. It shows the photo, the hub-resolved name, a Person or Agent
  badge (an agent reads "Aida (Ben)" and names its owner), title, description
  and the person's local time when their timezone is known and valid. Its
  Message action uses the existing DM navigation: an existing DM opens,
  otherwise a draft opens and the DM is created on first send.
- **Pronouns are not shown.** The hub sends them; the app deliberately strips
  the field at parse time so no screen can render it.

## Verification and evidence limits

The implementation has Node unit tests for schemas/client refusal paths,
eligibility, sections/DM identity, day dividers/runs, paging, account-epoch
isolation, refresh retirement, optimistic read reconciliation, first-send
idempotency, payload parsing and foreground policy. Run the affected set:

```sh
node_modules/.bin/vitest run src/team-bridge \
  src/features/team-bridge src/features/auth/radient-access.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsc --noEmit -p tsconfig.tools.json
```

A deliberately opted-in **web-only** fixture export can exercise the real UI and
HTTP client without any real credentials:

```sh
EXPO_PUBLIC_TEAM_BRIDGE_FIXTURES=1 CI=1 node_modules/.bin/expo export \
  --platform web --output-dir <session-scratch>/web-export
node tools/mock-team-bridge.ts <session-scratch>/web-export 18743
```

Use the harness browser tool at
`http://127.0.0.1:18743/__phone?case=populated&theme=light`; `theme=dark` selects
dark. Cases: `signed_out`, `update_required`, `unavailable`, `plan_required`,
`empty`, `loading`, `error`, `populated`; add `thread=1` for history. The iframe
is a real 390×844 CSS-pixel viewport, scaled for display in the capture host. The
fixture path is compiled out unless explicitly enabled, refuses non-loopback
origins and never reads the real OAuth accessor. Stop the owned server and close
the owned browser tab after captures.

**Not native evidence:** this host has Xcode Command Line Tools only;
`xcrun simctl list devices available` fails because `simctl` is unavailable, and
there is no Android SDK/emulator. Installing SDKs is forbidden as a side effect
by AGENTS.md. Therefore no local simulator screenshot, keyboard-on-device proof
or received APNs/FCM push is claimed. The normal PR workflows build native
artifacts; their actual result must be read before any native claim. Browser
fixtures cannot prove receipt from a push provider. A real-device push check
remains a release dependency until signing/Firebase/provider credentials are
provisioned and delivery is observed.
