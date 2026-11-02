# Store submission — Apple enrollment and hosted preflight

**Status (2026-11-02): Apple-only enrollment hold lifted; Google Play remains
parked.** The organization account is accessible, but a current license update
still needs the authorized human's acceptance before Developer resources and
App Store Connect can be used. Signing and TestFlight delivery are not ready. Publishing
will happen under the operator's **legal entity** — Radient Inc. as named in
`checklist.md` A1 — which, **per the operator (2026-10-09), already holds a
D-U-N-S number**. It will **not** be published under the individual team that
signs the desktop app.

**Human boundary:** enrollment, payment, legal-authority attestations and Apple
agreements belong to the authorized human. Stop account work at a login prompt;
never substitute the individual desktop-signing team. The release environment
exists, but its secrets and protection rules still need checking before use.

The approved identity is **Local Operator**, bundle **`com.localoperator.mobile`**,
already matching `app.config.ts`. Register that exact identity under the correct
organization and confirm its App Store Connect app record before any upload.
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
   **iOS signing is separate, not proved by those four secrets.** The pipeline
   passes the API key to `xcodebuild -allowProvisioningUpdates` and exports with
   automatic signing, but does not import a signing certificate/private key.
   Confirm generated-project automatic signing, signing-resource permissions and
   a valid identity on the fresh runner before archive/export. An API `.p8` is
   not an Apple Distribution identity. If the command-line/account route needs
   a local identity, add reviewed secure certificate/keychain setup first.
   The desktop notarization credential is a different credential again.
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

## Hosted build/validate-only native preflight (no Apple access)

Use the existing **iOS** workflow's manual dispatch, not the Release workflow:

```sh
gh workflow run ios.yml --ref <reviewed-branch-or-main>
```

This runs the unsigned **Release-configuration simulator** build, not a device
archive or App Store validation. It installs CocoaPods after clean Expo prebuild,
resolves the resulting workspace, compiles with `CODE_SIGNING_ALLOWED=NO`, boots
and launches the app, checks launch logs and captures settled frames. The
`ios-simulator` artifact contains the app and frames; inspect the run's toolchain
output and its native launch/frame summary. Use the run's head SHA to identify
what was actually built. No tag, Apple secrets, release environment, GitHub
Release or store upload is used: both secret-bearing jobs require **push to
main**, so they are skipped even for a manual dispatch selecting `main`.
A fork PR receives only the same secret-free simulator job.

A passing simulator smoke does **not** establish device signing, production
push delivery or live OAuth. Keep checklist A10 open until real-device sign-in
proves the current `lop` loopback-client path; a custom scheme is not an accepted
replacement in the server registration (ADR 0002). Do not enable held experimental
native fixtures to make the smoke pass.

### Archive/export audit and remaining signed prerequisite

Reviewed against Apple's [distribution guidance](https://developer.apple.com/documentation/xcode/distributing-your-app-for-beta-testing-and-releases)
and [cloud-managed certificate guidance](https://developer.apple.com/help/account/certificates/cloud-managed-certificates)
(2026-11-02): archive precedes distribution/export, and cloud-managed signing
requires the appropriate account permissions. The latter explicitly describes
the **Organizer** distribution workflow; it is not proof of this repository's
fresh-runner API-key-only command-line signing.

The signed lane uses a Release scheme with `generic/platform=iOS` to create an
`.xcarchive`, then `xcodebuild -exportArchive -archivePath ... -exportPath ...
-exportOptionsPlist ...` with automatic `app-store-connect` export. Apple's
[command-line FAQ](https://developer.apple.com/library/archive/technotes/tn2339/_index.html)
documents this export command and directs users to **the selected Xcode's
`xcodebuild -help`** for supported export keys. The FAQ is archived, not a current
Xcode flag reference: the preflight captures the actual hosted version and help
text so the signing owner can inspect authentication flags and export options
for that installed Xcode before enabling signed validation. No signed validation
or upload is added to this build-only entry point.

`-allowProvisioningUpdates` plus `-authenticationKeyPath`, `-authenticationKeyID`
and `-authenticationKeyIssuerID` authenticate provisioning requests; the API
key is not a certificate/private-key signing identity. The existing export
plist requests automatic signing and `destination=export`, not upload. Confirm
identity availability, capability/profile compatibility and successful archive
**and** export on the actual organization before running any store lane. The
existing `fastlane ios testflight` skips waiting for processing; upload success
is not proof that processing, tester distribution or installation completed.

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
requires **only the four `APPLE_*` secrets**; the five Play/Android names become
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
