# Store submission — Apple enrollment and hosted preflight

**Status (2026-11-02): Apple organization enrolled and release secrets configured;
Google Play remains parked.** The App Store Connect app record exists. This is
account setup, not signed-build evidence: archive/export remains unproven until
its first protected run. Publishing uses the organization, never the individual
desktop-signing team. Human enrollment, payment, legal-authority attestations and
agreements remain human-only; stop account work at any new login/agreement prompt.

The approved identity is **Local Operator**, bundle **`com.localoperator.mobile`**,
already matching `app.config.ts`. Keep that exact registered identity
and confirm its App Store Connect app record before any upload.
A build-only hosted preflight needs neither Apple access nor a tag (below).

---

## Resume checklist — Apple (entity path), in order

1. **Enrol the entity in the Apple Developer Program** as an organization:
   <https://developer.apple.com/programs/enroll/>. Needs the existing **D-U-N-S
   number**, legal authority to bind the entity, a work email on the entity's
   domain and a public website on it. Membership is 99 USD/year.
   **Lead time:** Apple publishes only the D-U-N-S timing — up to 5 business days
   to obtain a number, then about 2 business days for Apple to see it
   (<https://developer.apple.com/help/account/membership/D-U-N-S>); the entity
   verification itself has **no published figure** — `checklist.md` says "days to
   weeks".
2. **Register the approved bundle ID `com.localoperator.mobile`** under the
   organization before anything is uploaded. It cannot change after the first
   upload (`checklist.md` B1). The approved app name is **Local Operator**; both
   values already match `app.config.ts`, so no identity code change is needed.
   Enable **Push Notifications** on this explicit App ID: the Expo notifications
   plugin needs the matching entitlement in its profile (`push-setup.md`).
   Sender APNs keys are separate from the App Store Connect API key.
3. **Confirm the App Store Connect app record** exists for that bundle ID, or
   create it: App Store Connect → **Apps** → **+** → **New App** → platform
   iOS, the app name, primary language, the **bundle ID from step 2**, and a SKU
   of your choosing. Also confirm the **Program License Agreement** is accepted
   for the new team (the acceptance on the old account does not transfer) —
   `checklist.md` A5.
4. **Create the Team API key**: `https://appstoreconnect.apple.com` → **Users and
   Access** → **Integrations** → **App Store Connect API** → **Team Keys**
   (<https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api>).
   Generating a team key requires an **Admin** account on the team; App Store
   Connect states any remaining precondition (an API-access request) on the page
   itself when you open it. Record the **Team ID** (*Membership details*), the
   **Key ID**, the **Issuer ID**, and download the `.p8` — **once**; Apple keeps
   no copy.
   These become the four `APPLE_*` secrets in the `release` environment
   (`docs/ci.md` "Secrets"): `APPLE_TEAM_ID`, `APPLE_ASC_KEY_ID`,
   `APPLE_ASC_ISSUER_ID`, `APPLE_ASC_PRIVATE_KEY_BASE64`. **This pipeline's
   requirement** (not an Apple statement) is that the key's role can manage
   signing assets and upload builds — Admin is the role Apple requires to
   generate the key at all; App Manager is the narrower alternative if the
   console offers it.
   **Signing uses a different private key.** Also configure
   `APPLE_DIST_CERT_P12_BASE64` and `APPLE_DIST_CERT_PASSWORD`: an existing valid
   Apple Distribution certificate **with its private key**, exported as .p12.
   The configured asset was produced with OpenSSL 4.0.3 using
   `openssl pkcs12 -export -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1`
   (supply certificate/key/output paths and password securely, never in logs).
   `openssl pkcs12 -info -noout` confirmed MAC SHA1 and
   `pbeWithSHA1And3-KeyTripleDES-CBC` for both bags. These legacy PKCS#12 container
   algorithms are intentional for macOS `security import` compatibility, not
   application cryptography; do not silently replace them with PBES2/AES defaults.
   The six names are checked in both signed paths. The API `.p8` authenticates
   readonly profile download; it is not the Distribution signing identity.
   An existing App Store profile must authorize this certificate, exact bundle,
   team and production Push Notifications capability. `IOS_PROFILE_NAME` selects
   its exact name (default `Local Operator iOS App Store`); do not commit account
   or resource IDs. The shared `ios-signed-ipa` action imports the certificate into
   an ephemeral keychain, downloads the profile **readonly**, changes only the
   application target's Release signing settings, archives and exports manually,
   then checks the IPA signature, embedded profile and production entitlements.
   Cleanup always removes credentials and restores the prior keychain settings.
5. **The release workflow's platform selection is landed** — PR #75 merged
   2026-10-09. `RELEASE_PLATFORMS=ios` (a repository variable) is read by the
   `credentials` job, which now checks only the enabled platforms' secrets. See
   the platform note below.
6. **Validate before authorizing a release tag.** Use the build-only preflight
   below for native compilation/launch. Release `dry_run=true` checks only the
   version and credential presence; it requires an existing tag and skips the
   full gate, native builds and uploads. It does not validate signing. Never
   create a tag just to dry-run: pushing `v*` already starts a real release.
7. **TestFlight**, then **App Store submission** — review notes, demo mode and
   the § E answers in `checklist.md`; expect a review round for the demo-mode
   request (Apple 2.1(a)). While the entity is being enrolled, the remaining
   Apple-path items in `checklist.md` § A can proceed in parallel: A6 (EU DSA
   trader status), A7 (legal review of the store copy — `store/`, which still
   carries `DRAFT — not submitted` markers that must be removed) and A10.

## Hosted validation modes and explicit upload authorization

The **iOS** workflow has three main-only dispatch modes. With no inputs, any
reviewed branch can use the existing unsigned simulator smoke, with no secrets
or release environment:

```sh
gh workflow run ios.yml --ref <reviewed-branch-or-main>
```

It installs the pods after clean Expo prebuild, resolves the workspace, compiles
Release with `CODE_SIGNING_ALLOWED=NO`, boots/launches and captures settled frames.
The `ios-simulator` artifact includes the app, frames and selected Xcode's help;
the logs record actual Xcode/SDK/CocoaPods versions. Identify the built source by
the run head SHA. This proves neither device signing nor live OAuth/push.

After reviewed code is on **main**, validate signing without an upload:

```sh
gh workflow run ios.yml --ref main -f signed_export_only=true
```

This runs the same simulator gate, then protected credential and signed-export
jobs in `environment: release`. Both `.p12` import and readonly profile download
must work; the IPA must have a valid Apple Distribution signature, the selected
embedded App Store profile, matching bundle/team, `aps-environment=production`
and `get-task-allow=false`. The `ios-ipa` artifact is attached, but the TestFlight
step is **skipped**. Export-only takes precedence even if both inputs are true.
The environment allows only main and release tags; never loosen that rule to
obtain secrets on a PR branch.

An upload is a separate, intentional action, only after export validation:

```sh
gh workflow run ios.yml --ref main -f testflight_upload=true
```

A merge/push to main alone **does not sign or upload** while repository variable
`IOS_INTERNAL_UPLOAD` is unset (the default). Setting that variable to the exact
string `true` explicitly opts future main pushes into the existing signed/upload
lane. Review that choice before setting it. PRs and feature-branch dispatches
cannot reach signing, even with signed inputs. Tag-triggered **Release** semantics
are unchanged: a `v*` tag still builds, creates a GitHub Release and uploads.
Never use a tag or Release `dry_run` as a supposedly harmless native preflight.

`fastlane ios testflight` skips waiting for processing. Upload success is not
proof of processing, tester delivery or installation. Keep checklist A10 open
until real-device sign-in proves the `lop` loopback-client path (ADR 0002).
Google, held experimental native fixtures and other parked work stay parked.

### Archive/export signing audit

Apple's [distribution guidance](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
and [cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates)
(read 2026-11-02) distinguish provisioning authentication from signing identity.
The selected Xcode26.6 help confirms automatic signing can create provisioning
resources, but that is not proof that a fresh archive can use the template's
developer identity without a device. These lanes instead import an existing
Distribution identity and set manual signing on the app target only, not Pods.

The shared action archives a Release scheme for `generic/platform=iOS`, then
uses `xcodebuild -exportArchive` with `method=app-store-connect`, manual signing,
an explicit bundle/profile mapping and `destination=export` (never upload).
It does not pass provisioning-update/device-registration flags or create Apple
resources. The selected runner's `xcodebuild-help.txt` is retained because
Apple's [archived CLI FAQ](https://developer.apple.com/library/archive/technotes/tn2339/_index.html)
defers current flag/export-key definitions to installed `xcodebuild -help`.
The first protected export run is still required evidence; synthetic tests
and the unsigned smoke are not signed-build proof.

## Resume checklist — Google Play (organization path)

Nothing is prepared in the consoles. In order:

1. **Play Console organization account** — D-U-N-S, organization name/address,
   organization phone and website, a contact, and the one-time 25 USD fee
   (<https://support.google.com/googleplay/android-developer/answer/6112435>;
   the required-information list is at
   <https://support.google.com/googleplay/android-developer/answer/13628312>).
2. **Upload keystore** — procedure: `docs/publishing/android-keystore.md`
   (prepared; **not executed**).
3. **Service-account JSON** → `PLAY_SERVICE_ACCOUNT_JSON_BASE64`: Play Console →
   *Account details* → note the Cloud Project ID → enable the Google Play
   Developer API there → create a service account → *Keys → Add key → JSON* →
   Play Console → **Users and permissions → Invite new users**, paste the service
   account's email, and **grant the release permissions** (the invite alone is
   not enough). Play also wants **one build uploaded manually** before the API
   can publish. Path per <https://docs.fastlane.tools/actions/supply/>.
4. Set `RELEASE_PLATFORMS=ios,android`, **then** provide the five `ANDROID_*` /
   Play secrets; the release gate requires credentials for every enabled
   platform and fails loudly if one is absent.

**Testing note:** Google requires *personal* accounts created after **2023-11-13**
to run a closed test with **12 testers opted in continuously for 14 days** before
production access
(<https://support.google.com/googleplay/android-developer/answer/14151465>).
Organization accounts are outside that page's scope.

---

## The platform variable and platform selection

`RELEASE_PLATFORMS` is a **repository variable** holding a comma-separated list:
`ios`, `android`, or `ios,android`. Unset/empty means `ios`. The `credentials`
job checks only the enabled platforms' secrets, the platform jobs are skipped
when not enabled, and `publish` tolerates a skipped platform — landed in PR #75
(merged 2026-10-09). A `v*` tag with the variable at its default therefore
requires **only the six Apple signing/API secrets**; the five Play/Android names become
required once `android` is enabled.

---

## Already done — no action on resume

- `release` environment created **2026-10-04**; its two deployment rules
  (branch `main`, tag `v*`) are in place. Custom branch policies are
  enabled, which is what makes a tag rule possible at all.
- Repository variable `RELEASE_PLATFORMS=ios` (2026-10-09).
- Android upload-keystore procedure written down (`docs/publishing/android-keystore.md`),
  deliberately not executed.
- `store/` metadata exists: 13 files (iOS and Android). Every one still carries
  `DRAFT — not submitted. Remove this line before uploading`. Its content pass is
  independent of accounts and can continue while parked.

## Store assets — produced, parked with the work

- **26 frames committed in `design/store-screenshots/`** (rendered from the
  current tree on 2026-10-25; the set — counts, order, theme, captions — is
  defined in [`listing-screenshots.md`](./listing-screenshots.md)): App Store 6.9"
  ×9 (1320×2868), **iPad 13" ×9 (2064×2752)**, Play ×8 (1080×1920), plus the raw
  app captures beside them. An earlier parity lane's copy of the same 26, verified
  off the `02da0334` tree, survives in its session scratchpad,
  `~/.local-operator/sessions/0fb6ba9da093/scratchpad/appcaps/deliverable/`
  (`MANIFEST.sha256` verifies 26/26); the `store-shots` worktree that rendered
  them has been pruned.
- **The iPad class is required**, not optional: the app sets `supportsTablet: true`
  and ships two-pane layouts.
- **The pre-upload content pass is the one quality gate left on those frames.**
  13 of 26 carry harness-world text ("mock provider", `127.0.0.1:4200` where a
  computer name belongs, `nope/nope`, `sleep 20`, "Short turn N: say something
  brief", "hello relay", `n/a`). The clean ones: 01/02/05/09 in both store
  classes, AS-iPad 07, Play 01/02/05/08. Re-shoot in a production-plausible world
  (a named peer computer is fine) and re-verify with the token scan.
- **Two follow-ups for that re-shoot:** the store README's "390 × 844 at dpr 3"
  is wrong as written (the arithmetically right pairs are **430×932 @3 =
  1290×2796**, or 440×956 → 1320×2868); and `node design/preview/capture.mjs
  --target frames --check` asserted sizes only, so it could not catch a silent
  font fallback — add a rendered-font assertion.
  *Both are settled for the committed sets in `design/store-screenshots/` — the
  iPhone, iPad and Play frames alike. Their captures are `iphone-max` at 3x
  (1290 × 2796), `tablet-pro` at 2x (2048 × 2732) and `android-small` at 3x
  (1080 × 2340) — and every frame template loads the SHIPPED
  faces from `design/fonts/*.woff2`, so no sibling checkout is involved in how the
  captions render. `--target frames --check` now re-renders each committed listing
  frame on every surface and compares it — bytes where the encoder matches the
  renderer, and otherwise pixels within that surface's own tolerance from
  `frames.json` (1%, the measured drift of every surface being 1-2 levels; the
  iPad's capture is the one resampled into a smaller slot, and it needs no more
  than that) — reporting which comparison it made, how far the pixels moved, and
  how many sat outside the tolerance. So a template, capture or caption
  change fails the gate rather than shipping, and CI runs that check as its own
  hard step. A rendered-font assertion that names the face is still open as a
  separate nicety.*
  *The spec colophon is no longer on any of these frames: review round 1 removed it
  from the iPhone template, the iPad and Play templates were rendered without one,
  and the render now fails a composed frame that carries build metadata. The
  loopback route on 06–08 is still open, and it is on the checklist (C2) rather
  than only here.*
- **Template facts:** the compositor pipeline is committed and fixed (font faces
  are vendored in the repository, and `design/preview/capture.mjs --target frames`
  renders all three surfaces); the per-shot copy is in `frames.json` and re-renders
  in one command; the iPad band was authored at the iPhone's proportions scaled by
  2064/1320 and may still want ~16 px of loosening at review. Spec colophons are
  gone from every frame and the render rejects one that reappears. Play caps
  screenshots at 8 per device type; Apple wants 1–10 per size at the 6.9" class.

## Out of scope of this park (still moving)

- **Radient-side: the mobile OAuth `client_id`** — required by both stores
  eventually, and product work regardless of when submission resumes.
  Account deletion shipped **2026-10-11** (`checklist.md` A8, D3).
- The app's feature work: perf first-paint, push + STT + LAN, parity fixes.
- No store-frame recapture for submission while parked.
