# Downloaded notification sounds (M2)

The computer owns `notifications.sound.*`. This module stores only verified
content-addressed audio, not a second preference. The app reads the paired
mobile daemon's `/api/notification-sounds` projection, fetches the selected
custom WAV with its expected full SHA256, and reports readiness through
`PUT /api/notification-sounds/cached`. It reuses the selected relay's existing
cookie/Origin policy. Device credentials go only in `X-Lop-Device` (install id)
and `X-Lop-Device-Key`, never URLs or push payloads.

See ADR 0006 §3.2: the cloud picks `sound_custom` **only** for a ready device;
otherwise `data.sound` remains the always-playable built-in fallback. Turning
sound off and selecting the system sound remain backend semantics. Computer
volume is not transmitted; the phone's OS notification volume applies.

## Storage and crash rules

- Names are `c_<sha256[:16]>.wav`; Android channels are `sound.c_<sha16>`.
  Full SHA256 is validated before native IO and again in native code. A prefix
  collision is refused, never silently assigned different content.
- The cache keeps the selected custom sound and up to four previous sounds,
  oldest-used first on eviction, at most 8 MiB including incoming bytes. A file
  is at most 2 MiB and PCM WAV at most 10 seconds. Audio receive is bounded while
  streaming, not only after allocating the body.
- iOS writes into `Library/Sounds` (the named-notification-sound search path).
  Atomic file writes and `fsync` cover audio and the index. A small Swift half
  is used to make the durable-write/readiness boundary explicit and keep the
  same crash rules as Android, without a new third-party dependency.
- Android API 29+ publishes an app-owned `MediaStore.Audio` row under
  `Notifications/LocalOperator/` with `IS_NOTIFICATION=1`. SystemUI can read
  that content URI; it cannot read a private `file://` sound. Expo's existing
  channel resolver only searches `res/raw`, so the native half creates the
  channel directly. No storage permission is requested. API 28 and earlier
  keep the built-in fallback and never advertise custom readiness.
- Native records a reserved slot **before** writing audio. Interrupted commits
  remain accounted for, but inventory marks them invalid. Inventory re-hashes
  files and checks Android channel existence/readability; an index row alone
  is not readiness. A corrupt index fails closed (it may contain claims).
- Readiness is published only after native commit and inventory validation.
  Before deletion the coordinator withdraws the digest and awaits the server's
  acknowledgement. Failed withdrawal stops deletion; failed native writes
  never add readiness. Native removal also refuses outstanding claims.
- Cache storage is shared across computers. Durable, hashed-owner claims stop
  an offline previous computer's still-advertised sounds from being evicted.
  Route retirement tries to withdraw first, then clears that owner's claim;
  it never deletes files. If old credentials have already been revoked or the
  computer is offline, those claims remain pinned. When all available slots
  are pinned the new selection honestly stays on fallback until the old
  computer can acknowledge withdrawal. This is preferable to silently breaking
  its next push. Neither the ledger nor the native index contains a credential.

App/route start, foreground, sound-setting config invalidations on the existing
SSE stream, and successful persisted push registration trigger prefetch. In-flight
invalidations coalesce into one follow-up pass. S7 still owns registration:
M2 does **not** register speculatively, and without a valid device key no custom
readiness is advertised. No background-remote-notification mode is enabled.

## Native validation preflight and remaining device gates

Before dispatching a native lane, check all of:

1. `expo-modules-autolinking resolve --platform android` discovers
   `dev.localoperator.sound.LopNotificationSoundModule`; `--platform apple`
   discovers the `LopNotificationSound` pod and `LopNotificationSoundModule`.
   A compiled dev build must resolve `requireNativeModule("LopNotificationSound")`.
   JS-source discovery is not proof the binary contains it.
2. Build source SHA must equal the reviewed head. Existing `android.yml` and
   `ios.yml` compile the module through Expo autolinking; do not duplicate their
   full suites locally. No SDK is installed by this module or its tests.
3. Use a synthetic paired daemon and synthetic device registration, never a
   live installation. Missing cookie -> 401, wrong digest -> 404, wrong device
   key -> 401. Native missing/unsupported -> no readiness PUT, built-in fallback.
4. Before claiming native success, the actual dev binary must show an inventory
   row with the expected full digest, byte count and `valid: true`, then the
   paired daemon's persisted `sound_cached` must include its stem. Remove the
   file/channel: inventory must become invalid and readiness must be withdrawn.

**Still device/simulator gates, not proved by Node mocks or Swift parsing:**

- iOS: the actual `Library/Sounds/c_<sha16>.wav` write, inventory after app
  restart, eviction, and a scheduled notification with that sound. Simulator
  can prove filesystem behavior; audibility and real APNs require a real phone.
- Android: actual MediaStore row, effective channel sound URI from
  `getNotificationChannelsAsync`/NotificationManager, inventory after restart,
  eviction deletes the row and channel, and a local notification uses it.
- Native commit failure must leave `sound_custom_ready` false; failed remote
  withdrawal must leave the old file/channel present. Real pushes need S7.
- **Same-digest eviction/re-cache on Android:** Android may restore a deleted
  channel's old immutable URI while re-inserting the same digest yields a new
  MediaStore URI. Content-addressed channel IDs prevent *different-content*
  reuse but do not guarantee stable media URIs. This module refuses readiness
  when the effective channel URI is unreadable, rather than claiming playback.
  User-chosen readable sounds or silence in Android Settings are preserved.
  Test this on a real device before claiming eviction/re-cache playback works;
  guaranteed URI preservation or a channel-generation wire change would need
  a separately approved contract decision.

There is no new app settings UI, user-facing copy, playback preview, service
extension, or second notification handler in this change.
