# Android installed-app notification proof

A manual, secret-free CI lane that builds a **candidate commit** (for example an
open pull request's frozen head) into the real app, installs it on emulators
(API 29, 31, 36 — serially) and records what a person would see: the
notification shade, lock screen, channel settings and taps into threads.

It exists because a library instrumentation APK can prove the notification
delegates but not the installed app: it has no launcher icon, no channels
created by the app's JavaScript, no tap router and no Team Bridge screens.

## Run it

```sh
gh workflow run android.yml --ref <harness-branch-or-main> \
  -f installed_app_proof=true -f installed_app_sha=<40-hex candidate sha>
```

`android.yml` calls `.github/workflows/android-installed-app-proof.yml`, so the
lane works from a branch before the reusable workflow is on the default branch.

## What it builds (job-local only)

`prepare-app.sh` edits the candidate checkout inside the build job and restores
it before compiling; nothing is committed or shipped:

- the web-only Team Bridge fixture seam gains one Android branch, gated on a
  define only this job sets, that points the app at a loopback mock hub with the
  mock's synthetic, unsigned token;
- a generated entry and the candidate's own `embeddedHost` make the debug APK
  load an embedded production-mode bundle (no Metro);
- a job-only `androidTest` source set adds `InstalledAppProofRunner`, signed with
  the same debug key and targeting the app package, which delivers
  `RemoteMessage`-backed notifications through `NotificationsService.receive`
  exactly as Expo's FCM delegate does.

The same job exports the candidate's **normal** bundle and checks that no proof
marker reaches it, and checks that the Release merged manifest carries no
instrumentation or driver.

## Preflight

Before any emulator boots, `preflight.py check` re-derives from the downloaded
bytes: source SHA, both APK digests, the embedded bundle digest and fixture
seam, the app package, the driver's instrumentation target and both signers.
`preflight.py selftest` then proves the refusals work: a wrong SHA, the normal
bundle (no fixture) and a driver targeting another package must each be refused.

## Fixtures and evidence rows

- `fixtures/face-*.png`: synthetic ILLUSTRATED faces (`fixtures/make_faces.py`,
  no real person), served by `hub.ts` behind the same nonce gate as the push
  photo route, so a circular crop and two different senders can be judged.
- Group posts carry a `subtitle` (`#channel · Org`), as production does.
- Dark frames are proved by pixels: each theme switch captures a shade probe
  and its mean luma must sit on the right side of 120 (measured: dark ≤ 51.8,
  light ≥ 182.5); on API < 30 SystemUI is restarted when it kept the old theme.
- Rows added for #304 round 3: warm tap waits for rendered messages; cold tap
  dwell (≥ 5 s after Displayed) and Back from the tapped thread; heads-up from
  home on every API; a two-sender channel and initials senders (wide, CJK,
  Arabic, silhouette) with per-row crops in light and after a theme switch;
  the lock row posts one fresh Bridge message onto a cleared shade and names
  its notification key, then expands the row to show the placeholder line.
- Rows changed for #304 QA round 4 (run 44284677520):
  - Photos: the proof bundle's `hubOrigin()` answers the loopback hub (the
    app's JS re-registers its origin on every start, which had replaced the
    driver's seed, so every photo was refused as cross-origin). Photo rows
    assert the `/push-avatar/*` GETs and record the registered origin.
  - Night mode on API < 30: the image locks day/night for the shell, so the
    switch is retried as root (`su 0`); `applied` needs `Night mode: yes|no`
    AND the probe luma. A dark switch that still fails is a separate `N/A`
    row (counted neither PASS nor failure), never a captured dark frame.
  - Heads-up and lock rows assert the system's own state (`dumpsys
    notification` record by tag; SystemUI's `HeadsUpEntry`), polled through a
    10 s capture window; uiautomator node hits are recorded, not required.
  - The channel handoff button is scrolled fully on screen before the tap; a
    channel left off is switched back on (recorded) so later rows still run.
  - The cold row saves the whole logcat before it clears it.
  - The two-sender channel also expands each sender's row and crops it.
- `pngtools.py`: stdlib PNG decode/crop/encode (no Pillow on the runner).

## Limits

No FCM, production endpoint, credential or OEM launcher is exercised. The
presentation lease and hub origin a successful push registration would set are
seeded by the driver (there is no FCM token on these emulators), and each run's
receipts say so.
