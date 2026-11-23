# ADR 0010 — Team Bridge push avatars, and Android parity for OS-dependent features

- **Status:** Proposed — 2026-11-17
- **Deciders:** the operator (the Apple portal capability and the cloud capability-URL route); the
  maintaining team (everything else)
- **Decisions recorded (2026-11-17):**
  - **The S5 photo capability link is approved** by the operator (ask a-4eab), with the scoping in
    §3 and §6: an opaque server-stored nonce, re-checked at serve time. The nonce travels in the
    `Authorization` request header, never in a URL, because the WAF log keeps every request's full
    path for 30 days and redacts only headers (§6, review R2-1).
  - **Agent senders show the agent's own avatar, or an agent glyph** (manager decision, following
    the operator's words). They never show the owner's face. See §5.
- **Related:** [ADR 0006](0006-push-and-ack-sync.md) (push and ack sync),
  [ADR 0008](0008-desk-presence.md) (desk presence), [ADR 0009](0009-notification-routing-by-origin.md)
  (routing by origin); core `notification_avatar.py` (the desktop composite, Team Bridge agreement
  2026-10-28); desktop decision a-a06c (2026-10-28)

**Provenance.** Each citation is `path:line`. They were read at these revisions: this repository
`origin/main@6d1f270e`; desktop `local-operator-ui@94d96837`; core `local-operator@b42471d3`; cloud
`agent-server@origin/main 48970fd9`, read with `git show` because the shared checkout is detached and
dirty; the hosting repos `radient-environments@1cd3d37` and `radient-infra@ce41f73` (for §6's
logging analysis); and the vendored `node_modules` of this repository: `expo-notifications@57.0.21`,
`expo-secure-store@57.0.4` and `expo-modules-core@57.0.20`. This is a read-only investigation. Nothing
here was run on a device or emulator. Each claim says whether it comes from the code or still needs
a device to settle it.

## The request

> "In the team bridge mobile notifications can you also make it so that when the notification comes
> up, it shows the avatar of the sender or avatar placeholder with the local operator icon in the
> corner similar to Slack and other messaging apps, review how this is done on the local-operator-ui
> and do the same for mobile. Also check that all these functionalities would work on android and
> ensure parity"

> "I'm thinking about OS dependent stuff like notifications, we've done a bunch of work on detecting
> presence in the app, mobile notification preferences, etc make sure that those in particular can
> work on android properly"

## Summary

1. **The desktop does not use native "communication notifications".** Core draws one composite PNG
   per sender: the photo or initials on a per-person colour, the LO mark in a corner badge, and a
   marker for agents. Desktop main caches that PNG and attaches it as the notification icon. The
   phone can't reuse the composite as-is. iOS and Android both draw the app-icon badge themselves
   when the notification is a *conversation*, so the phone only needs to supply the **face** (§1, §3).
2. **The phone gets no sender identity today.** Both cloud payloads carry title, subtitle, preview
   and ids (`bridge_push.go:107-109,181-184`, `models/bridge_push.go:124-141`). No app extension and
   no custom messaging service exist. **Some cloud change is required** (§2).
3. **Recommendation, in two steps.**
   - **Step 1:** draw initials on the device. The cloud adds an additive `sender` block (`kind`,
     `initials`, `tone`) and a `conv` block (`group`, `members`) so group and channel messages
     render as groups, not DMs. iOS draws it in a Notification Service Extension and donates an
     `INSendMessageIntent`. Android draws it in an Expo presentation-delegate subclass, as
     `MessagingStyle` with a `Person` and a long-lived conversation shortcut.
   - **Step 2 (approved, a-4eab):** photos, through a short-lived capability URL that the cloud
     mints. The phone presents an opaque server-stored nonce in the `Authorization` header (never
     in the URL), and the server re-checks the recipient's access each time it serves.
   - Rejected: sharing the Radient bearer with the extension. The refresh token rotates on every use
     (`src/connection/radient-oauth.ts:507-509`), so a second process refreshing it would sign the
     reader out.
4. **Android parity has real gaps in the OS-dependent rows:**
   - **(a)** While the app is in the foreground, Android shows **no** Team Bridge banner at all, even
     for a conversation that isn't on screen. Expo skips data-only messages before the JS handler
     runs (`NotificationsHandler.kt:98-103`). iOS shows them (`team-bridge/push.ts:148-166`).
   - **(b)** Session pushes post on `IMPORTANCE_DEFAULT` channels (`native.ts:151`). On Android
     that means sound but **no heads-up banner**.
   - **(c)** Android system settings show twelve channels named after *sounds*, not categories. The
     app never reads channel state, so in-app preferences and system toggles are not kept in step.
   - **(d)** Team Bridge pushes don't group by conversation on Android. There is no `tag` and no
     group, so each message is its own notification.
   - **(e)** No Android runtime proof exists for push. PR CI builds have no FCM config
     (`app.config.ts:60-80`), and this Mac has no Android device.
   - Keystore persistence, background-safe send, AppState handling and the photo picker are sound
     in code. They still need emulator checks (§7).

## 1. Desktop today (local-operator-ui + core)

| Concern | What the code does | Citation |
|---|---|---|
| Image slot | Electron `Notification({icon})`. On macOS Electron 44 maps `icon` to a `UNNotificationAttachment` (a right-side thumbnail) and the bundle icon stays the attribution. Windows uses `appLogoOverride`, Linux uses libnotify image-data. | `src/main/team-bridge-notifier.ts:84-87, 540, 572-583` |
| Native communication notifications | **Explicitly out of scope on desktop** (decision a-a06c). | `src/main/team-bridge-notification-images.ts:1-9` |
| Who draws | Core, `GET /v1/desktop/team-bridge/accounts/{id}/notification-avatar?kind&theme&size&initials[&v&avatar_account_id]`. The desktop never decodes a remote image or holds a URL. | `src/main/desktop-media.ts:193-214, 326-341`; core `local_operator/team_bridge/notification_avatar.py:1-41` |
| Composite | 256 px canvas (64 px is a downsample). Circle-cropped photo or initials. LO mark badge at 40 % in the bottom-right with a punched gap. For `person_agent`, a 30 % agent marker top-right. | core `notification_avatar.py:76-80, 409-453` |
| Placeholder colour | `sha256(origin + "\n" + account_id)[0] % 8` into fixed light/dark palettes. Never seeded by the name, so a rename keeps the colour. `origin` is the hub base, `https://api.radienthq.com/v1`. | core `notification_avatar.py:97-125, 200-203`; `team_bridge/client.py:1172, 3810`; `env.py:67` |
| Initials | NFC. First and last word, first letter/digit of each, at most 2 code points, Unicode letters or digits. **Derived by the desktop** (`teamBridgeSenderInitials`); core only **validates** what it is sent (`valid_initials`) and, if the font lacks the script, falls back to a silhouette. *(Corrected 2026-11-17 by the S1 owner; this row first said core derived them.)* | desktop `team-bridge-notification-images.ts:119-132`; core `notification_avatar.py:189-197, 284-340` |
| Cache | Main-process memory only. 15 min for photos, 12 h for initials, 8 MiB / 128 entries, a 30 s negative TTL. Keyed viewer + auth epoch + tenant + sender + kind + variant + version + size + theme. Cleared on every auth transition. | `team-bridge-notification-images.ts:39-99, 185-213` |
| Deadline | A banner waits at most 250 ms for a photo, then posts the cached initials. A late photo is only cached and never reposts. | `team-bridge-notifier.ts:155, 520-541, 648-680` |
| Dock/taskbar count | **None.** No `setBadgeCount`, `dock.setBadge` or overlay icon anywhere in `src/main`. "Badge" on desktop means only the LO corner mark. | grep of `src/main` at the provenance revision |

The parts the phone should reuse are the **rules**: the initials rule, the palette and its seed,
"agent ≠ person", "never block delivery on a photo", and "no image bytes on disk". The PNG pipeline
itself doesn't carry over, because both mobile OSes draw the badge.

## 2. Mobile today, end to end

### 2.1 Cloud sender (agent-server)

- `ComposeBridgePushNotification` builds `Title` (the sender label, "Agent (Owner)" for agents),
  `Subtitle` ("#channel · Org") and `Preview`. **Sender identity is dropped at this point**: only the
  label survives (`internal/models/bridge_push.go:267-300`). `BridgePushData` carries `v`, `type`,
  `tenant_id`, `conversation_id`, `message_id` and `seq` (`:124-131`).
  `BridgeConversationSender.EndpointID` is `json:"-"` on purpose (`models/bridge_conversation.go:1040-1045`).
- **APNs:** `apns-push-type: alert`, priority 10. `aps.alert{title,subtitle,body}`,
  `sound: default`, `thread-id: "tb:<conversation>"`, `category: "tb.message"`. Custom data goes
  under top-level `body`. **No `mutable-content`, no badge, no collapse id**
  (`internal/clients/bridge_push.go:96-119`).
- **FCM:** **data-only**: `data{title, message, subtitle, channelId:"team-bridge", body:<json>}` and
  `android{priority: HIGH, ttl: 86400s}`. **No `tag`** (`bridge_push.go:179-185`). The keyless
  sender (workload identity) is in `internal/clients/bridge_push_wif.go`, and the shared FCM post is
  at `bridge_push.go:193-200`.
- Session pushes, for comparison: FCM `channelId: "sound.<id>"`, a `tag` equal to the collapse id,
  `collapse_key`, and HIGH priority. Attention is data-only at NORMAL priority
  (`internal/sessionpush/envelope.go:143-162`). APNs adds `thread-id`, a category and, on
  completions, `content-available` (`:100-141`).
- The avatar read route takes **only a bearer**: "no public or query-string credential is
  accepted" (`internal/routes/routes.go:918-929`). The handler is
  `internal/controllers/account_profile.go:216-265`. It serves 64/256 px and answers 404 for an
  account outside a shared active tenant.

### 2.2 App side (this repository)

- **expo-notifications plugin:** the Android small icon `ic_notification.png`, the accent colour,
  and the ten sounds (`app.config.ts:444-466`). `UIBackgroundModes: ["remote-notification"]`
  (`:242-263`).
- **No iOS Notification Service Extension, no app group, no communication entitlement.**
  `plugins/` holds only Android plugins: release signing, local network, launcher label.
- **Fastlane signs exactly one application target with one App Store profile**
  (`fastlane/Fastfile:100-155`). `scripts/ci/ios-signing.py:37-80, 145-183` validates that one
  profile and the app's entitlements. iOS builds are `expo prebuild` plus `xcodebuild`, not EAS
  (`.github/workflows/ios.yml:191,234`; `release.yml:380`).
- **Android channels:**
  - Twelve `sound.*` channels at `IMPORTANCE_DEFAULT`, created at app start
    (`src/notifications/native.ts:120-165`).
  - A `team-bridge` channel at `IMPORTANCE_HIGH`, named in English only ("Team Bridge"), created
    when the Team Bridge provider mounts (`src/team-bridge/push.ts:54-56, 169-197`;
    `provider.tsx:262`).
- **Foreground:** a single `setNotificationHandler`. It shows a Team Bridge push unless that
  conversation is on screen, and shows nothing for any other type (`team-bridge/push.ts:148-183`).
  > **Correction to ADR 0008 §3.4.** With **no** handler, Expo 57 shows nothing in the
  > foreground: iOS calls `completionHandler([])` (`expo-notifications/ios/…/NotificationCenterManager.swift:155-167`).
  > ADR 0008 §3.4 says the opposite, and `push.ts:158` is the accurate statement.
- **Taps:** cold and warm both route
  (`getLastNotificationResponseAsync` + `addNotificationResponseReceivedListener`, `native.ts:213-240`,
  `team-bridge/push.ts:235-242`). Android's `dataString` / JSON `body` is unwrapped explicitly
  (`team-bridge/push-payload.ts:16, 43-45`; `notifications/payload.ts:44-75`). The parser ignores
  unknown keys and requires `v === 1` (`push-payload.ts:55-75`), so adding a `sender` block is
  **backward compatible**.
- **Badge:** one writer, the sum of sources, set from the hub's authoritative unread count. Pushes
  never carry one (`src/notifications/app-badge.ts:1-60`).
- **In-app avatars:** the bytes are read with the bearer and shown from a `data:` URI. Agents are
  their **endpoint** identity, never the owner's photo (`src/team-bridge/avatars.ts:1-90`). In-app
  initials use a **different rule** from core: the first two words, or the first two letters of a
  single word, ASCII-letter check, no per-person colour (`src/ui/components/avatar.tsx:41-62`).

## 3. iOS mechanism

**Communication Notifications.** This is the Slack look: the sender's face, with the app icon
badged in the corner by iOS.

- **Payload:** add `"mutable-content": 1` to `aps` on bridge pushes only. Without it the extension
  never runs.
- **Extension (`NotificationService`, Swift, ~150 lines):**
  1. Parse `userInfo["body"]["sender"]`. If absent, call `contentHandler(request.content)`
     unchanged. That covers old clouds and non-bridge pushes.
  2. Build the face: a downloaded photo (step 2 only), else initials on the `tone` colour drawn
     with `UIGraphicsImageRenderer` at 3× of 40 pt.
  3. Build `INPerson(personHandle: INPersonHandle(value: <opaque sender key>, type: .unknown),
     nameComponents: nil, displayName: title, image: INImage(imageData:), contactIdentifier: nil,
     customIdentifier: <opaque sender key>)`.
  4. Build `INSendMessageIntent(recipients: <see below>, outgoingMessageType: .outgoingMessageText,
     content: nil, speakableGroupName: <group name for channels/groups, nil for DMs>,
     conversationIdentifier: "tb:<conversation>", serviceName: nil, sender: person, attachments: nil)`.
     Set `setImage(_:forParameterNamed: \.sender)`, donate it with `INInteraction(intent:,
     response: nil)` and `direction = .incoming`.
     - **DM (`conv.group == false`):** `recipients: nil`. That is Apple's one-to-one shape.
     - **Channel or group (`conv.group == true`):** iOS treats nil recipients as one-to-one and
       then hides `speakableGroupName` (Apple, "Implementing communication notifications": "For
       group message intents, provide an array that contains the other participants"). So set
       `recipients` to **one** opaque placeholder `INPerson` (`customIdentifier:
       "tb:<conversation>:others"`, no name and no id). Apple adds the reader itself ("For incoming
       communication notification donations, the system includes the current user as a recipient
       in addition to those your app provides"), so a `"tb:me"` placeholder would double-count the
       reader. Add one only if the S3 simulator stills show iOS needs it. Also set
       `intent.donationMetadata = INSendMessageIntentDonationMetadata()` with
       `recipientCount = conv.members - 1` (the active members other than the reader). Apple
       documents it as the stand-in for a full list and asks for "an accurate recipient count".
       Optionally call `setImage(_:forParameterNamed: \.speakableGroupName)` with a channel
       glyph. No member ids are sent, so this keeps the §6 rule.
     - **Settle on a simulator in S3:** a `group: true` push must show the group name and the sender
       face; a `group: false` push must show the DM layout. Screenshots of both are the acceptance.
  5. Call `contentHandler(try request.content.updating(from: intent))`. If anything throws, deliver
     the original content. **Delivery never depends on the avatar.**
- **Main app:** add `NSUserActivityTypes: ["INSendMessageIntent"]` to `Info.plist`. Add the
  `com.apple.developer.usernotifications.communication` entitlement to the **app** target.
- **Limits:** roughly 30 s of wall clock before `serviceExtensionTimeWillExpire`, which must deliver
  the original. Extension memory is tight, about 24 MB in practice. The photo is 64/256 px and at
  most 1 MiB from the hub, so it fits. Budget about 5 s for the photo fetch, then fall back to
  initials.
- **Avatar authentication for step 2** (the options asked about):

| Option | Verdict |
|---|---|
| Shared keychain access group, the extension reads the Radient grant | **Reject.** Radient rotates the refresh token on every use (`radient-oauth.ts:507-509`). An extension that refreshes races the app and can sign the reader out. Using the access token alone fails whenever it has expired. It would also re-home the grant one day after the `AFTER_FIRST_UNLOCK` keychain migration (`src/features/auth/tunnel-storage.ts:125-142`). |
| Inline bytes in the payload | **Reject.** APNs and FCM cap the payload at 4 KB, and a 64 px PNG is 3–6 KB. |
| **Short-lived capability URL** minted by the cloud per recipient device | **Step 2, approved by the operator (a-4eab, 2026-11-17).** The phone fetches a **fixed URL** (`GET /v1/push-avatars`, with no path parameter and no query) and presents an **opaque server-stored nonce** (128 random bits, base64url) as **`Authorization: PushAvatar <nonce>`**. The nonce never appears in any URL, so no URL log anywhere can hold it (§6). The server row holds (recipient account, recipient device, tenant, sender identity, avatar hash, size, expiry ≤ 15 min). A plain HMAC is rejected because it can only be verified if the request carries those ids in clear, which breaks §6. The nonce is preferred over an AEAD-sealed token for three reasons. A sealed token of four ids is about 250 characters against the 4 KB APNs/FCM budget, where the nonce is 22. A row can be revoked on sign-out. And the serve path reads the database for its re-checks anyway (§6). The row is keyed by `sha256(nonce)`, so the database never holds a usable capability, and a Mongo TTL index on `expires_at` removes rows after expiry. The route serves that one derivative only. It is a deliberate, approved exception to the "no … credential … accepted" rule at `routes.go:918-921`, and works the same way on Android. |
| **Initials rendered on the device** | **Step 1, and always the fallback.** No network and no secret. |

- **Expo integration:**
  - **Build it as an in-repo config plugin** (`plugins/with-ios-notification-service.js` plus
    `native/ios/NotificationService/*.swift`), the same pattern and testing style as the existing
    `plugins/with-android-*.js`. The plugin uses `withXcodeProject` to add an app-extension target,
    `withEntitlementsPlist` for the app, and `withInfoPlist` for `NSUserActivityTypes`.
  - Community plugins (`nikwebr/` and `tomkelsey/expo-notification-service-extension-plugin`) are
    single-maintainer forks. `@bacons/apple-targets` is better maintained but brings its own target
    conventions. Neither is needed.
  - **It works without EAS**, because prebuild generates the target. **Fastlane and CI must
    change:**
    1. `prepare_distribution` downloads a second profile for `com.localoperator.mobile.NotificationService`
       and configures that target's signing.
    2. `ios-signing.py` adds the extension to `provisioningProfiles`. It validates the extension
       profile without requiring `aps-environment`, which an extension doesn't carry. It also
       verifies the communication entitlement on the app.
    3. `scripts/ci/native-config.ts` pins the new target and entitlement so they can't be lost
       silently.
  - The "exactly one application target" check (`Fastfile:110-111`) still holds, because the
    extension is product type `app-extension`.
- **Manual operator steps (Apple Developer portal):**
  1. On App ID `com.localoperator.mobile`, enable **Communication Notifications**. **Not verified
     here.** No ASC credential was used. A read-only `GET /v1/bundleIds?filter[identifier]=com.localoperator.mobile&include=bundleIdCapabilities`
     settles it.
  2. Register App ID `com.localoperator.mobile.NotificationService`.
  3. **Regenerate** the existing App Store profile named by `LO_IOS_PROFILE_NAME`. Profiles snapshot
     capabilities, so the old one won't carry the entitlement. Then create an App Store profile for
     the extension.
  4. App Groups are **not** needed in step 1 or step 2, because the extension never reads app storage.

## 4. Android mechanism

**What Expo does today.** The FCM message is data-only, so `ExpoFirebaseMessagingService` →
`FirebaseMessagingDelegate.onMessageReceived` (`FirebaseMessagingDelegate.kt:107-114`) → in the
background, `ExpoHandlingDelegate.handleNotification` presents it if a title or text is present
(`ExpoHandlingDelegate.kt:118-148`). `ExpoNotificationBuilder` then sets title, text, subText (from
`data.subtitle`) and **`BigTextStyle`**. It sets no group, no `MessagingStyle` and no shortcut
(`ExpoNotificationBuilder.kt:92-157`). A large icon is possible only from an FCM *notification*
block's `imageUrl`, never from a data-only message (`RemoteNotificationContent.kt:25-31`). The
notification id is `data.tag ?: messageId` (`FirebaseMessagingDelegate.kt:123-130`).

**Can the payload alone do it?** No. A `notification` block would let the FCM SDK post the
notification itself while the app is backgrounded. Then neither Expo nor our code would run, we would
lose `MessagingStyle`, the shortcut and the quiet-while-watching rule, and taps would bypass Expo's
response pipeline. **Keep data-only and build on the device.**

**Recommended hook: Expo's own extension points, not a second Firebase service.**

- `NotificationsService` is `open`, with `protected open fun getPresentationDelegate()` and
  `getHandlingDelegate()` (`NotificationsService.kt:30, 615-625`). The receiver is resolved as the
  first broadcast receiver in the package that handles the action (`:387-406`).
- `ExpoPresentationDelegate` is `open`, with `protected open suspend fun createNotification()`
  (`ExpoPresentationDelegate.kt:31, 159`).
- So we add `LoNotificationsService` (in the app manifest, with Expo's receiver removed through
  `tools:node="remove"`, both by an in-repo config plugin) and `LoPresentationDelegate`:
  1. `super.createNotification(...)` builds Expo's notification. That keeps Expo's content intent,
     extras and marshalled request, so taps, `getPresentedNotificationsAsync` and
     `dismissNotificationAsync` keep working (`ExpoNotificationBuilder.kt:117-148`).
  2. If `body.type == team_bridge_message` and a `sender` is present, recover the builder with
     `Notification.Builder.recoverBuilder(context, n)` and change it. `recoverBuilder` returns a
     **platform** `android.app.Notification.Builder`, so every type below is a platform type, never
     an AndroidX `*Compat` one. Mixing them doesn't compile, or is a no-op through reflection.
     Gate by API level (the app's `minSdk` is 24, from React Native's `libs.versions.toml`):
     - **API < 28:** return Expo's notification **unchanged**, apart from `setGroup` below.
       `android.app.Person` and `MessagingStyle(Person)` don't exist there.
     - **API 28–29:** `Notification.MessagingStyle(me: android.app.Person)` with
       `addMessage(preview, sentTime, android.app.Person{name=title, icon=Icon.createWithBitmap(bitmap), key=<opaque sender key>})`,
       `setConversationTitle(subtitle)` and `setGroupConversation(conv.group)`. Android shows the
       face on the message, but there is no conversation section and no shortcut.
     - **API 30+:** everything above, plus `setShortcutId("tb:<conversation>")` and
       `setLocusId(android.content.LocusId("tb:<conversation>"))`. The notification becomes a
       *conversation* only when it carries `MessagingStyle` and a long-lived shortcut, both from 30.
     - At every level: `setGroup("tb:<conversation>")`, and the lock-screen rule in §7 row 14.
  3. On **API 30+ only**, before posting, call `ShortcutManagerCompat.pushDynamicShortcut` (the
     shortcut is a separate object, so Compat is fine here) with a **long-lived** shortcut
     for that id. It carries the same `Person`, `setLongLived(true)`, an intent that opens the app
     at the conversation deep link. **Its icon is the conversation's face, not the message's:** on
     API 31+ the shade draws the shortcut icon on every row that names the shortcut, and the
     shortcut is republished per message, so a sender face there made every row of a group show
     whoever spoke last (UX U7 / design D3, PR #304). A **DM** shortcut keeps the other person's
     face. A **group or channel** (`conv.group == true`) shortcut gets one fixed face for every
     message, lucide `Users` (the in-app group glyph) in white on the kit's light `ink-dim`
     (`#656056`, 6.2:1, no sender tone; the payload cannot tell a channel from a group). Each
     sender's face stays on the `MessagingStyle` message `Person`, with `setGroupConversation(true)`
     and the conversation title (`ConversationShortcuts.shortcutFace`). It is **not** excluded from the launcher: the platform never
     stores a shortcut marked `setExcludedFromSurfaces(SURFACE_LAUNCHER)` (AOSP
     `ShortcutPackage.pushDynamicShortcut` keeps it only as transient AppSearch state), so on
     API 33+ no conversation existed and the notification fell back to plain `MessagingStyle`
     (installed-app QA F1, PR #304, run 44247024803). The launcher's long-press menu may
     therefore list recent conversations, as it does for other messaging apps. On sign-out and
     account switch, call `removeLongLivedShortcuts` for all `tb:*` ids. They are account data.
  4. The small icon stays `ic_notification` (the LO monochrome mark, `app.config.ts:452`).
     Android 11+ draws the app badge on the conversation avatar in the shade and the Conversations
     section. That is the Slack look without drawing the LO mark ourselves.
  5. Leave `MessagingStyle` history single-message for step 1. Inline reply is a non-goal.
- **Foreground gap fix (row 1 in §7):** `LoHandlingDelegate` overrides `handleNotification`. For a
  foreground, data-only bridge message with a title, it rewraps the content as a non-remote
  `NotificationContent` so `NotificationsHandler` consults the JS handler. The JS `foregroundBehaviour`
  quiet-while-watching rule then applies on both platforms, from one implementation.
- **Grouping:** cloud FCM for bridge adds `tag: "tb:<conversation>:<message>"` (stable per message,
  for dedupe), and the device sets `setGroup("tb:<conversation>")`. That matches iOS `thread-id`.
- **The sound-channel trap:** Team Bridge stays on its own `team-bridge` HIGH channel. Its name and
  description move to i18n keys, like `soundChannelName` (`native.ts:88-111`), where they are
  English literals today (`push.ts:189-190`).

## 5. Placeholder (one rule, three renderers)

- **Computed in the cloud and sent in the payload,** so Swift and Kotlin only draw:
  - `sender.initials`: the desktop's rule exactly — local-operator-ui's `teamBridgeSenderInitials`
    derives them, and core only validates them (`valid_initials`) — (first and last word, ≤ 2
    Unicode letters or digits, NFC),
    in Go.
  - `sender.tone`: `sha256(<hub origin> + "\n" + account_id)[0] % 8`. `<hub origin>` is the
    cloud's own **configured public API base** for that hub (`https://api.radienthq.com/v1` in
    production), not a literal, because it must be the same string core uses as `origin` for that
    hub (`team_bridge/client.py:1172, 3810`). Staging and self-hosted hubs then keep desktop and
    phone colours equal. The shared fixture pins the production value and one non-production value.
  - `conv.group`: `conversation.Kind != dm`. `conv.members`: the number of
    `conversation.Members` with `State == BridgeParticipantStateActive`
    (`models/bridge_conversation.go:89`), capped at 999. Left, removed and invited rows don't
    count. Both are already in hand where the push is composed (`ComposeBridgePushNotification`,
    `models/bridge_push.go:267-300`), so no extra read is needed. The phone uses them only for
    group rendering (§3 step 4, §4 step 2).
  - **A shared fixture** (`{account_id, display_label} → {initials, tone}`, about 30 rows, including
    CJK, accents and single-word names) is checked into agent-server and asserted by Go, core's
    `test_notification_avatar.py` and this repository's tests. Drift then fails CI in each repo.
- **Palette:** the phone uses core's **light** palette (`notification_avatar.py:106-115`). The OS
  draws notification avatars outside app theming, and those tones were chosen to hold white text.
  Store it as tokens (`design/tokens`) so the Swift and Kotlin sources are generated, not
  hand-copied.
- **Agents (decided 2026-11-17, manager decision):** an agent sender shows **the agent's own
  avatar**, which is its **endpoint** avatar in step 2, matching in-app (`avatars.ts:70-76`).
  Without one, it shows an **agent glyph** (the in-app agent mark) on the tone seeded by the owner's
  account id. It never shows the owner's face. `kind: "agent"` lets the renderers choose.
  *(Corrected 2026-11-17 by the S1 owner, agent-server PR #399.)* On the wire an agent sender is
  `sender{kind: "agent", tone}` with **no `initials`** — its stored label may carry "(Owner)", whose
  letters would put the owner on the agent's face — and `tone` is seeded by the **owner's** account
  id, because an agent has no account of its own.
  > **Known difference, not changed here.** The desktop composite draws the *owner's* face plus a
  > corner agent marker (`notification_avatar.py:7-9, 441-445`). Aligning the desktop is out of
  > scope for this ADR.
- **Not in scope:** the in-app initials rule differs (`avatar.tsx:47-62`). Aligning it is a separate
  visual change.

## 6. Privacy

- The payload adds only `kind`, `initials`, `tone` and, in step 2, an opaque short-lived nonce and
  the fixed fetch URL. **No account ids or endpoint ids** go to Apple or Google. Use an opaque
  per-sender key (an HMAC of the id) for `INPerson`/`Person` identity.
- **No logging:** nothing from `title`, `preview`, `sender`, the URL or the nonce is logged in the
  extension or the delegate. The cloud's existing rule already applies
  (`models/bridge_push.go:133-135`).
- **The capability is scoped** to the recipient account, a tenant they share with the sender
  (the existing `OpenAvatar` check), one hash, one size, ≤ 15 min, and GET only. It is served
  `private, no-store`. A leaked nonce shows one org-visible face for minutes.
  - **Token:** the opaque server-stored nonce in §3, sent as `Authorization: PushAvatar <nonce>`.
    The URL, the header and the payload carry no account, tenant, endpoint or device id, in clear
    or sealed.
  - **Header, not URL:** the phone fetches the fixed `GET /v1/push-avatars`. The route is mounted
    on the bare `v1` group (`routes.go:80`), which has no auth middleware, so the handler parses
    the scheme itself. A missing header, another scheme or an unknown nonce gets the same 404 as
    every other failure, never a 401, so URLSession never sees an auth challenge. The client sends
    the header only to the origin it registered the device with, and turns redirects off (an
    `URLSessionTaskDelegate` that refuses redirection, and `followRedirects(false)` in OkHttp), so
    the nonce can't follow a redirect to another host.
  - **At rest:** the table stores `sha256(nonce)` as its unique key and looks rows up by that
    hash, the way bearer tokens are never stored. A database read therefore yields no fetchable
    capability. A Mongo TTL index on `expires_at` removes expired rows. The TTL monitor runs
    about once a minute, so the serve-time expiry check (1. below) stays authoritative.
  - **Re-checked at serve time:** no account bearer is presented, so anyone holding the nonce
    can fetch it, and checks made only at mint would outlive a tenant removal by up to the TTL. On
    every GET the handler loads the nonce row and serves **only if all of these still hold**:
    1. not expired;
    2. the recipient device registration is still active, which a sign-out removes;
    3. the recipient and the sender **still share an ACTIVE tenant**, using the same check the
       bearer route uses (`OpenAvatar`, `controllers/account_profile.go:216-265`);
    4. the sender's **current** avatar hash equals the minted one, so a replaced or removed photo
       is never served.
    Any failure answers the same `404` with no body difference. Sign-out and account switch also
    delete that device's nonce rows.
  - **Live contract (Radient S5, deployed; folded in 2026-11-18).** What the phone now relies on,
    as shipped by the cloud. Where it differs from the design above, this is authoritative:
    - **Payload:** `sender.photo = {url, nonce}` with `url` exactly
      `https://api.radienthq.com/v1/push-avatars` (no path parameter, no query) and `nonce` 22
      base64url characters (128 bits).
    - **Request:** `GET` with `Authorization: PushAvatar <nonce>`; the server matches the scheme
      case-insensitively. Redirects off; sent only to the origin the device registered with.
    - **Success:** `200`, `image/jpeg` or `image/png`, one 256 px derivative,
      `Cache-Control: private, no-store`.
    - **Every failure is `404`, never `401`** — missing or malformed header, other scheme,
      unknown, expired or revoked nonce, failed re-check — and a wrong method is also `404`, not
      `405`, so no response distinguishes the route's existence.
    - **Lifetime:** 15 minutes; the device's nonce rows are deleted on sign-out and on account
      switch.
    - **Tenant re-check:** serves when the recipient and sender **still share any tenant**, not
      necessarily the one the push came from (re-check 3 as deployed).
    - **Accepted residual S-2:** response timing may differ between a known and an unknown nonce;
      accepted by the cloud review, since the nonce is 128 random bits and short-lived.
    - **Initials** (the fallback face) follow the desktop rule (`teamBridgeSenderInitials`, §2),
      not core's validation-only path; the cloud sends them already derived.
    - **Phone conformance** (`PushAvatarFetcher.kt`, checked 2026-11-18): nonce shape validated
      and a URL with query, fragment or user info refused before any request (the path itself is
      the cloud's to choose); origin pinned to the registered hub origin
      (`RADIENT_API_BASE`) on both `java.net.URL` and OkHttp's `HttpUrl`; `followRedirects(false)`
      and `followSslRedirects(false)`; any non-`200` (so every `404`) returns null and the
      notification draws initials; a 3 s deadline; no disk cache, no logging.
  - **Logging.** The nonce is in a request header, so every log that keeps URLs is out of reach
    by construction. Each sink was checked:
    - **The AWS WAF log keeps every request's path, and redacts only headers.**
      `radient-infra@ce41f73 pulumi/radient_infra/waf.py:1762-1768` creates
      `aws.wafv2.WebAclLoggingConfiguration` into the CloudWatch group
      `aws-waf-logs-radient-prod-waf`, with 30-day retention (`config.py:149`). Its
      `tunnel_logging_filter` (`waf.py:1355-1399`) has `default_behavior: KEEP` and drops only
      tunnel-host and XSS-labelled bridge ALLOWs, so every `api.radienthq.com` record is kept with
      its URI. Its `redacted_fields` are the headers in `WAF_REDACTED_HEADERS` (`waf.py:628-634`),
      and **`authorization` is already one of them**. (Round 1 of this ADR said neither repository
      had a WAF logging configuration. That was wrong.)
    - **WAF samples** (`sampled_requests_enabled`, about 3 hours) are covered by web-ACL data
      protection, which substitutes `REDACTED` for each header in `WAF_PROTECTED_HEADERS`
      (`waf.py:723-731`, `:1734-1739`). **`authorization` is already one of those too.**
      `pulumi/tests/test_waf_data_protection.py:181-223` fails the build if the protected list
      changes or the samples become weaker than the log, and `:239-246` pins the post-apply gate
      script to the same names.
    - **Agent-server** logs the method, the redacted path, status, latency, IP and user agent, but
      no request headers (`internal/middlewares/middleware.go:186-219`). The central error handler
      logs only the redacted path (`cmd/server/main.go:2808`). The only global middleware is
      `edgeProofTag` (`main.go:3136`).
    - **Cloudflare** URL analytics and security events show the path, which is now the fixed
      `/v1/push-avatars`.
    - **Defence in depth:** S5 still adds
      `{^/v1/push-avatars/.+, "/v1/push-avatars/:token"}` to `tokenPathRules`
      (`middleware.go:74-84`), with a unit test beside
      `TestRedactRequestPathSurvivesEncodedControlBytes` for the case, slash and dot variants, so
      a buggy client that puts the nonce in the path still keeps it out of the app's logs. The
      route itself serves no subpath.
    - **Options weighed (R2-1):**
      - *Keep the path segment and add `uri_path` to `redacted_fields`* — rejected. The redaction
        applies to the whole logging configuration, so it would blank the path on every record for
        every host behind the ACL, which the runbook's path triage needs. Sample data protection
        can't cover a path at all: `FieldToProtect` accepts only `SINGLE_HEADER`, `SINGLE_COOKIE`,
        `SINGLE_QUERY_ARGUMENT`, `QUERY_STRING` and `BODY`.
      - *Keep the path segment and add a label rule plus a `logging_filter` DROP*, like the tunnel
        rule — rejected. It needs a new count rule and filter, it loses the route's ALLOW records
        from the log, and the samples would still show the nonce.
      - *Accept a logged path with a ≤ 15 min TTL* — rejected. Every nonce would sit in a 30-day
        log readable by the WAF log readers, and the cost of avoiding that is one header.
      - **Chosen: `Authorization: PushAvatar <nonce>`.** No radient-infra configuration change is
        needed, because the header is already redacted in the log and substituted in the samples,
        and the tests already pin both. The NSE and the Android delegate make the request
        themselves, so a header costs nothing.
    - **iOS caveat, and its fallback.** Apple lists `Authorization` among the reserved URLRequest
      headers: "the system may ignore the value you set, or overwrite it with its own value, or
      simply not send it". This app already sends `Authorization: Bearer` through React
      Native's NSURLSession-backed `fetch` (`src/connection/discovery.ts:218`), so in practice the
      header survives. The S5 simulator fetch returning 200 proves it, since every failure is a
      404. If the header doesn't survive, rename it to `X-Radient-Push-Avatar` and add that name to
      both `WAF_REDACTED_HEADERS` and `WAF_PROTECTED_HEADERS`, to `PROTECTED_HEADERS` in
      `test_waf_data_protection.py`, and to the post-apply gate list (`:239-246`). That is a real
      radient-infra configuration change.
- **No avatar bytes are persisted:**
  - iOS: the bytes live only in the donated intent. The system retains donated interactions;
    delete them on sign-out with `INInteraction.deleteAll`.
  - Android: the `Person` icon in the posted notification and shortcut. Remove the shortcuts on
    sign-out.
  - No disk cache in either renderer.

## 7. Android parity matrix

The legend for "Android impl.":

- **real**: an Android code path exists.
- **shared**: the same JS, with no platform branch.
- **iOS-only**: no Android path exists.
- **gap**: the code path exists but behaves differently.

The legend for "Verify":

- **E**: an emulator in CI, with the KVM/AVD infrastructure that already exists
  (`.github/workflows/android.yml:538-600`; `e2e.yml:151, 1180, 1505`, API 36).
- **D**: a real device is needed. This Mac has none, so the internal Play track or a borrowed
  device would be required.

### 7.1 OS-dependent rows (deep)

| # | Feature | Code path | Android impl. | Evidence and finding | Verify |
|---|---|---|---|---|---|
| 1 | **Push display in the background or killed state** | cloud FCM data-only (`bridge_push.go:181-184`) → Expo service → `ExpoHandlingDelegate.kt:132-138` | real | Shown when a title is present. Title, text and subText map through (`RemoteNotificationContent.kt:34-72`, `NotificationData.kt:15-62`). | E: an instrumentation test calls `onMessageReceived(RemoteMessage.Builder…)` without needing an FCM project. D: end to end. |
| 2 | **Push display in the foreground** | `ExpoHandlingDelegate.kt:124-131` → `NotificationsHandler.kt:95-103` | **gap** | **Data-only is skipped before the JS handler**, so Android shows **no banner** for a Team Bridge message in another conversation. iOS shows it (`push.ts:148-166`). The JS received-listener still fires (`NotificationsEmitter.kt:54-58`), so the badge refresh works. Fix in §4. | E: instrumentation with the app resumed, then assert `getActiveNotifications()`. |
| 3 | **FCM token registration** | `getDevicePushTokenAsync` (`native.ts:176-192`, `team-bridge/push.ts:85-95`). Token rotation via `addPushTokenListener` (`team-bridge/provider.tsx`, `use-session-push-registration.ts`). | real | It needs `google-services.json`, which only the internal-release job materialises (`app.config.ts:60-80`, `android.yml:413`). **Every PR and CI build is push-disabled by design**, so there is no automated proof of real registration. | D: an internal-track build. E is possible only with the FCM secret in an emulator job (google_apis images include Play services). |
| 4 | **Channels and importance** | `native.ts:120-165` (sound.* DEFAULT); `push.ts:186-196` (team-bridge HIGH) | **gap** | Session completion and error channels are **IMPORTANCE_DEFAULT: sound but no heads-up peek**. iOS shows a banner for the same push. The Team Bridge channel is HIGH but named in English only. The channel is created only after the Team Bridge provider mounts, and until then Expo's fallback "Miscellaneous" HIGH is used (`BaseNotificationBuilder.kt:62-75, 137-143`). | E: `dumpsys notification` channel listing. |
| 5 | **Grouping** | cloud: bridge has no `tag` and no group; session `tag` = collapse id (`envelope.go:155-160`) | **gap** for bridge | Bridge: each message is its own notification. Android auto-bundles only at 4+ notifications, per app and not per conversation. iOS groups by `thread-id: tb:<conv>`. Fix: §4 `setGroup` plus `tag`. | E. |
| 6 | **Tap-to-open deep link** | `native.ts:213-240`; `push.ts:235-242`; `payload.ts:44-75` | shared + real | Cold and warm both handled. Android `dataString`/JSON `body` handled explicitly. Expo queues responses until listeners attach (`ExpoHandlingDelegate.kt:167-173`). | E: tap via UiAutomator, then assert the route. |
| 7 | **Badge** | `app-badge.ts:1-60` → `setBadgeCountAsync` → `ShortcutBadger` (`expo-notifications/…/badge/BadgeHelper.kt:13-19`) | real, but degraded | Numbers appear only on launchers ShortcutBadger supports (Samsung, some OEMs). Pixel and AOSP show a **dot** driven by channel `showBadge`. **This is expected and acceptable.** `background-task.ts:60-68` dismisses stale notifications on both platforms. Attention wakes are NORMAL priority and deferred in Doze (`envelope.go:149-153`), so badge clears lag on an idle phone. **Android-only side effect (pre-existing):** Expo's `BadgeHelper.setBadgeCount(0)` calls `NotificationManager.cancelAll()` (`expo-notifications@57.0.21 …/badge/BadgeHelper.kt:13-17`), and `app-badge.ts:41-46` writes the summed count, 0 included. So when Team Bridge unread reaches 0 (for example, read on the desktop), **every** Local Operator notification is dismissed, session completion and error alerts included, and S2's conversation notifications too. iOS only clears the number. **Fix in S4:** on Android, never write 0 through `setBadgeCountAsync`. Dismiss only the `tb:*` notifications instead (`getPresentedNotificationsAsync` filtered on the Team Bridge payload, then `dismissNotificationAsync`), and leave the launcher dot to the channel. | D (launcher-specific). E for the dot, and E for the 0 case: post one session and one `tb:*` notification, drive unread to 0, then assert the session notification is still in `getActiveNotifications()`. |
| 8 | **POST_NOTIFICATIONS (API 33+)** | `app.config.ts:356-362`; `permission.ts:49-60`; the primer and Settings call `requestPermission` | real | Expo maps never-asked to `undetermined` and asked-and-refused to `denied` (`expo-modules-core …/PermissionsService.kt:267-276`), so the primer shows on first run. **Divergence:** Android allows a second in-app request after one refusal, but the app treats `denied` as final and points to system settings. That is conservative and not a bug. Target API 36 means no auto-prompt on channel creation. | E: `pm revoke`/`grant` plus Maestro. |
| 9 | **Notification preferences ↔ system channels** | `notification-preferences.ts:1-43`. Switches are honoured **by the sender** (daemon / hub registration). | **gap** (not in sync) | System settings list twelve sound-named channels plus "Team Bridge". Turning off "Soft pulse" mutes whichever category uses that sound. The app never reads channel state (no `getNotificationChannelAsync` in `src/`), so Settings can say "on" while the OS discards. **Recommendation:** read `getNotificationChannelAsync("team-bridge")` on foreground. If it is `NONE`, show the Team Bridge row as "Off in system settings" with a deep link (`ACTION_CHANNEL_NOTIFICATION_SETTINGS`), and don't re-PUT the registration. Don't try two-way sync: Android forbids an app from re-enabling a channel the user turned off. Sound channels stay sound channels, because ADR 0006's one-channel-per-sound is forced by Android (`sound-catalog.ts:14-26`). | E. |
| 10 | **Desk presence (ADR 0008) and origin routing (ADR 0009)** | Decided in core, desktop and cloud. The phone's only parts are the Settings row and the foreground handler (ADR 0008 §3.4, Slice 6). The origin tag is the mobile *daemon's* client tag on the computer (ADR 0009 Decision 2). | shared | **No iOS-only code on the phone side.** AppState: Android never emits `inactive`, and every consumer treats only `background` as suspension (`use-session.ts:598`, `connection-provider.tsx:1521`), so that is benign. The one OS-dependent piece is foreground presentation, which is row 2's gap. The ADR 0008 §3.4 premise is corrected in §2.2. | E for the foreground handler, after the row 2 fix. |
| 11 | **Background-safe send** | `src/features/session/outbox.ts:53-80`, `outbox-host.tsx:71` | shared JS, no native Android path | iOS: the persisted envelope plus foreground/launch resume and a silent-push drain. Android: "JS keeps running until the process is killed or Doze cuts the network". **No WorkManager and no foreground service**, so a send in flight during Doze or an app-standby restriction waits for the next open. That matches the stated iOS guarantee (resume on launch), so they are at parity, but neither platform truly sends in the background. Optional later: a `WorkManager` one-time job with a `CONNECTED` constraint that replays the persisted envelope. | E: `adb shell dumpsys deviceidle force-idle` while a send is pending, then exit Doze and assert delivery. |
| 12 | **Keystore persistence across updates** | `storage.ts:1-29, 428-466, 680-690`; `tunnel-storage.ts:125-142`; `preference-store.ts:1-27`; `native-private-store.ts:78-80` | real (expo-secure-store) | `keychainAccessible` is **ignored on Android**. A new `keychainService` is a new Keystore alias and prefs prefix, so the legacy→new copy in `getRaw` works the same way. **Survives an app update:** Keystore keys and SharedPreferences persist. **Reinstall:** iOS Keychain items survive uninstall, but Android's don't (the code already refuses iOS survivors as authority, `device-storage.ts:5-8`). **Auto Backup:** the expo-secure-store plugin defaults `configureAndroidBackup: true` and excludes its prefs (`plugin/build/withSecureStore.js:8-32`). Without that, a restored ciphertext with no key would be **silently deleted and read as `null`**, which is "signed out" and not `SecureStoreUnavailableError` (`SecureStoreModule.kt:136-166`). Keystore invalidation behaves the same way, so on Android the "locked keychain" defence never triggers and a decrypt failure means sign-in again. **Install marker in `Paths.cache`:** Android's *Clear cache* (one tap in system settings) or storage pressure erases the sealed device family (drafts, envelopes). Theme survives, because it is in `Paths.document`. | E: install → sign in → `adb install -r` an upgraded APK → assert still signed in. Clear cache → assert the theme is kept and drafts are dropped. |
| 13 | **File and photo picking** | `app.config.ts:325-362, 424-443`; PR #278 adds CAMERA, `plugins/with-android-optional-camera.js` | real | The system Photo Picker (API 33+, backported through Play services `PickVisualMedia` on older versions) needs no storage permission. The media and storage permissions are **blocked** and asserted absent by `scripts/ci/native-config.ts`. #278 makes CAMERA a runtime request at the press and makes the camera feature optional. Its Android Maestro flows (`e2e/maestro/chrome-proof/attachments*.yaml`) need to run on the emulator. | E (picker and camera on an emulator with a virtual camera). |
| 14 | **Lock-screen privacy and notification categories** | iOS: `src/notifications/categories.ts:116-124` registers each category's `categorySummaryFormat` and `previewPlaceholder`. Android: no equivalent call. The channels are created without `lockscreenVisibility`. | **gap** | iOS honours the user's "Show Previews" setting and puts the placeholder in place of the body. Android has no category concept. The nearest controls are channel `lockscreenVisibility` and the notification's `setVisibility`/`setPublicVersion`. Under S2, `MessagingStyle` shows the sender, the face and the preview on the lock screen as the user's global "sensitive content" setting allows. The summary format has no Android counterpart; `setGroup` plus the shade's own count stands in. **Decision (S2):** every `team-bridge` notification gets `setVisibility(VISIBILITY_PRIVATE)` and a `setPublicVersion` with the title "Team Bridge" and an i18n "New message" body and no sender face. The secure lock screen then shows the same content as iOS's placeholder. | E: `adb shell locksettings set-pin`, lock, then a UiAutomator dump of the keyguard asserts no preview or sender text. |

### 7.2 Other recently shipped or in-flight rows (brief)

| Feature | Android | Evidence | Verify |
|---|---|---|---|
| Clipboard image paste | shared, with caveats | `attach-clipboard.ts:20-60` probes `hasImageAsync` on compose, foreground and listener. Android 10+ allows clipboard reads only with input focus. A probe right on `AppState` `active` may run before window focus and read empty. Gboard image paste uses `commitContent`, which RN `TextInput` doesn't receive. | D (keyboard-specific). E for copy-then-probe. |
| Team Bridge scroll anchoring (#296) | unproven | The #296 reasoning is iOS MVCP (`maintainVisibleContentPosition`, `thread-screen.tsx:1071`). Android MVCP and momentum events differ. The PR's green Android check is the APK build, not runtime. | E (Maestro scroll flow on API 36). |
| 429 backoff (#297) | shared | Pure JS and HTTP. Not platform-dependent. | none beyond unit tests |
| @mentions (planned) | design risk | Edge-to-edge plus `adjustResize`: the window doesn't shrink, and the keyboard is an inset (`app.config.ts:309-320`). Android raises only `keyboardDidShow`, not `Will*` (`keyboard-frame.ts:115`, `chrome-surface.tsx:90-91`), so a suggestion strip above the keyboard lags one animation on Android. | E: screenshot of consecutive frames. |
| Liquid Glass composer | fallback by design | `chrome-surface.tsx:36-43` gates on `Platform.OS === "ios"`. Android always renders the solid surface. | E (one still). |

## 8. Slicing

| Slice | Repo / owner | Content | Acceptance |
|---|---|---|---|
| S1 cloud payload | agent-server (cloud coder) | Additive `sender{kind, initials, tone}` and `conv{group, members}` in `BridgePushData` (v stays 1). DMs send `group: false`, and the phone keeps `recipients` nil for them. APNs gets `mutable-content: 1` on bridge pushes. FCM gets `tag`. Tone is seeded from the configured hub origin (§5). The shared initials/tone fixture. | Golden payload tests updated (`push_transport_test.go:104` golden), **including its "one deliberate delta since b6c600fb" comment (`:100-102`)**, which now lists `mutable-content`, `tag`, `sender` and `conv` as deliberate deltas. Fixture rows for a DM, a group and a channel. The fixture is asserted in Go **and** core. Payload ≤ 4 KB with the maximum preview. No new logged fields. |
| S2 Android presentation | mobile (coder) | In-repo config plugin plus `LoNotificationsService`, `LoPresentationDelegate` and `LoHandlingDelegate`. `MessagingStyle`, `Person` initials bitmap, long-lived shortcut, group. Foreground fix (row 2). i18n channel name. Shortcut and intent cleanup on sign-out. | Instrumentation test on API 29 and 36 (existing KVM job) posts a synthetic `RemoteMessage`. It asserts the platform `MessagingStyle` extras and `isGroupConversation` on both. On 36 it asserts the shortcut id and locus id; on 29 it asserts there is none. It also asserts the group, the foreground show/quiet rule, row 14's `VISIBILITY_PRIVATE` plus public version, and that the tap routes. A JVM unit test pins the API-gate function for 24, 27, 28, 29 and 30. Rendered shade screenshots: before/after, light and dark. A designer round. |
| S3 iOS extension | mobile (coder) | `with-ios-notification-service` plugin, Swift NSE, `INSendMessageIntent` donation, `NSUserActivityTypes`, entitlement. Fastlane and `ios-signing.py` handle two targets. `native-config.ts` pins. | XCTest on the extension's pure parts (payload parse → `INPerson`). Simulator push via `xcrun simctl push` with `mutable-content` shows the avatar (screenshot). The signed IPA passes `verify` with the extension embedded. A TestFlight device check by the operator. |
| S4 parity fixes | mobile (coder) | **Row 7: Android badge 0 must not cancel every session notification.** Skip the 0 write on Android and dismiss only the `tb:*` notifications. Row 4 (session channels to HIGH, which needs **new channel ids** because importance is fixed at creation), row 9 (channel-state read and system-settings link), row 12 (assert the backup rules in the merged manifest in `native-config.ts`). | Unit tests plus emulator `dumpsys` assertions, including row 7's 0-unread case: a session notification survives. A UX round for the Settings row. |
| S5 photos (step 2, approved a-4eab) | agent-server, mobile and radient-infra | **agent-server:** a nonce table keyed by `sha256(nonce)`, with a TTL index on `expires_at`, and minting per recipient device. `GET /v1/push-avatars` on the bare `v1` group, reading `Authorization: PushAvatar <nonce>`, with the serve-time re-checks in §6. Nonce rows deleted on sign-out. A defence-in-depth `tokenPathRules` entry for `/v1/push-avatars/.+`. **mobile:** the extension and the delegate send the header only to the registered hub origin, with redirects off and a deadline, and fall back to initials. **radient-infra:** no WAF configuration change, because `authorization` is already log-redacted and sample-protected (§6). Add one line to the comment above `WAF_REDACTED_HEADERS` (`waf.py:602-627`) naming the push-avatar nonce as a further reason the entry must stay. If the iOS fallback in §6 is taken, this slice also adds the custom header to both tuples, the test list and the gate list. | Route tests: missing header, wrong scheme, unknown nonce, expired, signed-out device, foreign tenant, **recipient removed from the tenant after mint**, changed or removed avatar after mint → the same 404, never 401. Storage test: the stored key is the hash, and the raw nonce appears in no document. Redactor test: a nonce in the path never appears in the request log or in the `main.go:2808` error line, for case, slash and dot variants. radient-infra: `test_waf_data_protection.py` passes unchanged. Read-only live checks recorded: `aws wafv2 get-logging-configuration` shows `authorization` in `RedactedFields`, and one sampled `GET /v1/push-avatars` from `get-sampled-requests` shows `authorization` as `REDACTED` and the bare path. Device and simulator stills, including a simulator fetch that returns 200, which proves the header arrived. |
| S6 Android proof lane | mobile (QA) | Emulator jobs for rows 1, 2, 5, 6, 8, 9, 11, 12 and 13. An internal-track device pass for rows 3 and 7. | A QA matrix with actual outputs. |

**Manual operator steps:** the three Apple portal actions in §3. The S5 capability-URL exception
(a-4eab) and the agent-face rule (§5) are decided. Rows 3 and 7, and the S3 device check, can't be
verified from this Mac.

## 9. Risks to watch during rollout

- **Extension failure must never cost delivery.** Every error path in the NSE and the delegate
  delivers the original content. Treat any crash-loop telemetry from the extension as a release
  blocker.
- **Expo upgrades:** S2 subclasses `protected open` Expo internals (`createNotification`,
  `handleNotification`). Pin them with instrumentation tests so an Expo bump that changes them fails
  CI, not users.
- **Shortcut and donation leakage:** long-lived shortcuts and donated intents outlive notifications.
  Clean them up on sign-out and account switch, and test that.
- **Old clouds and old apps:** the change is additive both ways. Old apps ignore `sender`, and new
  apps without `sender` keep today's look.
- **Channel migration (S4):** new session channel ids orphan the old ones. Delete the old ids at
  start, as `LEGACY_ALERT_CHANNEL_ID` is today.
- **Capability exposure (S5):** the nonce never appears in a URL. The WAF log and the samples
  redact `Authorization`, and the database holds only its hash (§6). One regression to watch: an
  edit that drops `authorization` from `WAF_REDACTED_HEADERS` or `WAF_PROTECTED_HEADERS`. That
  would expose bearer tokens as well, and the existing tests fail on it. Keep the TTL ≤ 15 min,
  and alert if the route's 404 rate rises sharply, which would point to replay or enumeration.
- **Group rendering on iOS:** the placeholder-recipients approach (§3 step 4) depends on how iOS
  decides group versus DM. Treat the S3 simulator stills for both layouts as a release gate.
- **Unverified assumptions, and how to settle each:**
  - Communication Notifications on the App ID: the ASC read in §3.
  - The Android foreground gap (row 2): one emulator instrumentation run.
  - ShortcutBadger numbers on the operator's eventual device: a device check.
