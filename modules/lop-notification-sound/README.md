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
- Android API 29+ publishes atomic private files through the non-exported
  `NotificationSoundProvider`. Its exact URI is
  `content://${applicationId}.notification-sounds/v1/<FULL-SHA>.wav`.
  NotificationManagerService grants the channel URI to notification rendering
  recipients; no exported provider, storage permission, or hardcoded SystemUI
  grant is used. The provider additionally enforces the caller's exact READ
  grant, rejects writes and noncanonical/traversal URIs, and opens final files
  read-only. It needs neither JS nor network access when the OS starts the
  process for a sound read. API 28 and earlier retain built-in fallback.
- Stable addressing is essential: Android resurrects a deleted channel without
  updating its immutable sound URI. Re-caching the same SHA now restores the
  same full-SHA address without historical MediaStore rows or per-retired-SHA
  metadata. Live prefix-collision checks and the wire/channel `c_<sha16>` names
  are unchanged. Byte eviction unlinks private final/pending files and deletes
  the channel after remote withdrawal. A previously open descriptor may finish
  after unlink; later opens fail until the same SHA is republished.
- Recovery visits only the dedicated private sound directory, reaps partials
  and unindexed final files before new writes, and retains indexed invalid slots
  for readiness withdrawal/accounting. The persistent final-file cap is 8 MiB;
  the one <=2 MiB receive stage and one <=2 MiB publication temporary file are
  bounded transient overhead, not a promise of <=8 MiB instantaneous disk use.
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
- Android: actual private file, effective full-SHA channel sound URI from
  `getNotificationChannelsAsync`/NotificationManager, inventory after restart,
  eviction unlinks final bytes and the channel, same-SHA re-cache restores the
  byte-identical URI, and a local notification uses it.
- Native commit failure must leave `sound_custom_ready` false; failed remote
  withdrawal must leave the old file/channel present. Real pushes need S7.
- The provider permission matrix needs a separate unprivileged receiver APK:
  no grant must fail, an exact READ grant must allow only that SHA, write and
  other-SHA reads must fail. A test-only manifest with URI grants disabled must
  fail the same system-consumer path. Do not ship that negative-control manifest.
- Actual background and normally terminated-app notifications must exercise NMS
  grants on API 29 and a modern supported Android. Do not force-stop the app:
  force-stop suppresses ordinary push delivery too. Real sound/audibility and
  same-SHA channel restoration remain device gates, not assumed from source.
- Clean disposable installs are required for new-provider proof: an unshipped
  dev build with old MediaStore-backed channels cannot have its immutable URI
  repaired just by recreating that channel. No operator data is reset, and no
  released MediaStore implementation/migration is claimed.

## Native instrumentation and platform sources

The framework-only `NotificationSoundTestRunner` adds no runner dependency.
`android.yml` compiles `:lop-notification-sound:assembleDebugAndroidTest` beside
its normal debug build and uploads `notification-sound-native-tests`. Compilation
is not execution. On an isolated emulator/disposable library test APK, run:

```
adb install -r <notification-sound-native-tests.apk>
adb shell am instrument -w \
  dev.localoperator.sound.test/dev.localoperator.sound.NotificationSoundTestRunner
```

Require **7/7 checks passed**, no failure statuses and instrumentation result -1.
The runner performs real atomic publication/open/unlink, manifest checks,
malformed/traversal/query URI and write-mode denials, injected exact-read-grant
policy checks, same-SHA channel restoration/URI equality, an allocation-shaped
negative control retaining an old channel URI, and crash cleanup. It never plays
sound or touches a non-test installation. Its injected permission policy is NOT
proof of NMS issuing a grant to a separate UID. The allocation fixture is NOT a
claimed reproduction of the original MediaStore code; see the device matrix.

Architect source decision (2026-11-05) checked Android 10/API 29 as well as
current AOSP. Platform basis, not device results:

- [Deleted-channel restoration preserves sound](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-10.0.0_r1/services/core/java/com/android/server/notification/PreferencesHelper.java#L636-L691).
- [Channel sound participates in grantable URIs](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-10.0.0_r1/services/core/java/com/android/server/notification/NotificationRecord.java#L1217-L1272).
- [NMS grants READ to rendering recipients](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-10.0.0_r1/services/core/java/com/android/server/notification/NotificationManagerService.java#L6547-L6625).
- [Non-exported providers can serve temporary URI-granted callers](https://developer.android.com/guide/topics/manifest/provider-element#exported).
- [API 30+ `hasUserSetSound`](https://developer.android.com/reference/android/app/NotificationChannel#hasUserSetSound()) distinguishes an explicit user override. Mute/overrides are never overwritten; readiness does not promise audibility over user mute, DND or OS volume.

There is no new app settings UI, user-facing copy, playback preview, service
extension, or second notification handler in this change.
