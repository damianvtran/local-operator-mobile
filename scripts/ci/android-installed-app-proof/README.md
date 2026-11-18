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

## Limits

No FCM, production endpoint, credential or OEM launcher is exercised. The
presentation lease and hub origin a successful push registration would set are
seeded by the driver (there is no FCM token on these emulators), and each run's
receipts say so.
