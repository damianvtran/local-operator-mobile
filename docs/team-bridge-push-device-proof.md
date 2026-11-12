# Team Bridge push — device proof

The one test that proves Team Bridge push works: a real message from a real teammate reaching a
real phone. Green unit tests prove the app's logic; only this proves the feature. Run it once the
credentials in [`docs/publishing/push-setup.md`](publishing/push-setup.md) ("Status", steps 1–6)
exist, on **one iOS device (TestFlight build)** and **one Android device (internal or release
build carrying FCM)**. Until then every row below is **UNVERIFIED**.

Who runs it: the operator plus whoever owns the TestFlight / Play internal track. Record the
evidence each step names; paste it into the pull request or release that claims the feature, with
tokens, emails and tenant ids redacted (`AGENTS.md`, "Secrets and personal data").

Every log line quoted here is from agent-server at the production tag (`19fae26b`). File references
are to that tree, so a changed line is easy to find.

## Before you start

| Need | Why |
| --- | --- |
| **Two Radient accounts in one organization**: the *reader* (signed in on the phone) and the *sender* (desktop `lop`, or a teammate). | The hub **never pushes a person about their own message** (`internal/models/bridge_push.go`, recipient rule: "never the sender's account"). Sending from the phone's own account proves nothing. |
| At least two conversations both accounts belong to (a DM and a channel). | Steps 4 and 5 need "another thread" and "the same thread". |
| Read access to agent-server logs. | Steps 0, 1 and 3 read them. |
| A build after the credential work: Android carrying `google-services.json`; iOS with Push Notifications on the App ID. | Android: the CI log of the build shows `google-services.json written for com.localoperator.mobile`, not the `::notice::… building WITHOUT FCM` line (`scripts/ci/google-services.ts`). |

## Steps

### 0. The cloud is armed

Restart (or read the last boot of) agent-server.

- **Expect:** `Team Bridge push: apns_configured=true fcm_configured=true` (`cmd/server/main.go`).
- **Evidence:** the boot line, timestamped. `false` on either side means that platform's devices are
  skipped silently by the push job — stop and fix the credential first.

### 1. Register

On the phone: install the build, sign in to Radient, then Settings → Notifications → **Enable
notifications** and allow the OS prompt. Background the app and bring it back (registration runs
on launch and on every foreground once permission is granted; it never prompts by itself).

- **Expect:** `PUT /v1/messaging/push/devices` answering **200** "Push device registered"
  (`internal/controllers/messaging_push.go`), and one row for the reader's account in the
  `bridge_push_devices` collection with `platform` `ios` or `android` and, on iOS,
  `environment: production` (every release build registers production — `src/team-bridge/push.ts`).
- **Evidence:** the request line with status from the access log or trace, and the row's
  `platform`, `environment`, `app_version`, `last_seen_at` (never the `token` or `token_hash`).
- **Failure reading:** no request at all on Android = the build has no FCM config (token read
  failed, the app stays quiet by design). 429 = the device-write rate limit; wait and retry.

### 2. Send

From the *sender* account (desktop `lop` signed in as the sender, or the teammate's own app), post
a plain message in a conversation the reader belongs to and has on `all` (the default).

- **Expect, in agent-server logs** (`internal/services/bridge_push_job.go`):
  `bridge push: outbox_id=<id> conversation_id=<id> outcome=sent http_status=200` per device, then
  `bridge push: outbox_id=<id> conversation_id=<id> outcome=<state> count=<n>` for the row with
  `n` ≥ 1. `outcome=invalid_token` means the token was rejected and deleted (re-run step 1);
  on iOS, repeated `outcome=transient http_status=403` (403 is classed transient and retried,
  `classifyAPNSBridgePush`) usually means the key's environment does not match the device's
  (`BadEnvironmentKeyInToken`, see push-setup "One APNs key"); `outcome=auth` means the `.p8`
  could not sign a token.
- **Evidence:** both log lines (ids redacted).

### 3. Delivery in each app state

Repeat step 2 three times:

| App state on the phone | Expect | Evidence |
| --- | --- | --- |
| **Killed** (swiped away) | OS banner: title = sender, subtitle = conversation + organization, body = preview. | Screenshot of the banner / lock screen. |
| **Background** | Same banner. | Screenshot. |
| **Foreground, on ANOTHER thread or the list** | In-app banner shown with sound. | Screen recording or screenshot. |
| **Foreground, watching the SAME thread** | **No** banner, no sound; the message just appears in the thread (`foregroundBehaviour`, `src/team-bridge/push.ts`). | Screen recording showing the message arrive silently. The server log still shows `outcome=sent` — suppression is on the phone. |

### 4. Tap lands on the message

Tap a banner from step 3 (once from killed, once from background).

- **Expect:** the app opens that conversation and anchors on the pushed message (its `message_id`
  / `seq`), even when it is not the newest; from a cold start it waits for Radient sign-in to
  restore, then lands there.
- **Evidence:** screenshot of the landed thread scrolled to that message, and which
  message was sent.

### 5. Badge

Leave three conversations unread from the sender (one message each, plus a second message in one
of them), then open and close the app.

- **Expect:** the icon badge equals the account's unread total as the drawer's Bridge badge shows it
  (the hub's `GET /v1/messaging/unread?scope=account` `total`; muted conversations excluded). Reading
  a conversation lowers it on return to the home screen. Pushes never set the badge themselves (no
  `aps.badge`, `internal/clients/bridge_push.go`), so while the app is **killed** the badge does not
  move until the next launch or foreground — expected, not a failure.
- **Evidence:** home-screen screenshots before and after reading one conversation, beside the
  in-app number. Android: note the launcher; badge support varies by launcher (ADR 0006 §5).

### 6. Mute and mention-only

In a channel: thread → bell (Conversation notifications) → **Mute**. Send from the sender. Then bell → **Mentions only**; send once
without and once with an @-mention of the reader.

- **Expect:** mute → no banner, and the badge drops by that conversation's unread (muted
  conversations leave the account total). Mentions → no banner for the plain message, a banner for
  the mention (a structured human mention; body text is never scanned — `bridge_push.go` recipient
  rule). On the server, a skipped recipient produces no `outcome=sent` line for that device.
- **Evidence:** the bell sheet showing the mode, the absence/presence of banners (screenshots), and
  the job lines for the three sends.

### 7. Sign-out revokes

Settings → Sign out of Radient on the phone. Send again from the sender.

- **Expect:** `DELETE /v1/messaging/push/devices/<install_id>?generation=<n>` answering **204**
  before the sign-out completes; the reader's device row is gone (a tombstone fences a late
  re-registration); the next send produces no `outcome=sent` for that device and **no banner**
  arrives. The icon badge is cleared on sign-out.
- **Evidence:** the DELETE request line with status, the device query returning no row, the job
  line, and a home-screen screenshot with no badge.

## Result table

Copy into the PR/release; fill one column per platform.

| Step | iOS | Android |
| --- | --- | --- |
| 0 cloud armed | UNVERIFIED | UNVERIFIED |
| 1 register (200) | UNVERIFIED | UNVERIFIED |
| 2 send (`outcome=sent`) | UNVERIFIED | UNVERIFIED |
| 3 killed / background / foreground-other / same-thread silent | UNVERIFIED | UNVERIFIED |
| 4 tap → message anchor | UNVERIFIED | UNVERIFIED |
| 5 badge = unread total | UNVERIFIED | UNVERIFIED |
| 6 mute / mention-only | UNVERIFIED | UNVERIFIED |
| 7 sign-out revocation | UNVERIFIED | UNVERIFIED |
