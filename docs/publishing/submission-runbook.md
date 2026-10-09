# Store submission — parked runbook

**Status: PARKED at the operator's call (2026-10-09).** Both stores. Publishing
will happen under the operator's **legal entity** — Radient Inc. as named in
`checklist.md` A1 — which already holds a **D-U-N-S number**. It will **not** be
published under the individual team `SHA2U6KT7V` that signs the desktop app.

**Resume trigger: the operator says go.** Until then nothing in this file runs.
This file supersedes, for the parked period: `checklist.md` F2's `.p12` line (the
pipeline signs via `-allowProvisioningUpdates`, see § "iOS signing" below) and
`docs/ci.md`'s old "`environment: release` protects nothing yet" action item —
the environment and its rules now exist, and that section says so.

**"No agent-side blocker" means for the *park* itself.** Two in-repository items
must be settled before the first tag, and both are listed in the resume
checklist: the **bundle ID** and the **app record**.

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
2. **Settle the bundle ID** before anything is uploaded. It cannot change after
   the first upload (`checklist.md` B1) and `app.config.ts:46` still carries the
   placeholder `com.localoperator.mobile`. Pick the real reverse-DNS id for the
   entity and change it in `app.config.ts` in a PR. The Android package name
   (B2) is the same string.
3. **Confirm the App Store Connect app record** exists for that bundle ID (or
   create it), and confirm the **Program License Agreement** is accepted for the
   new team (the acceptance on the old account does not transfer) — `checklist.md`
   A5.
4. **Create the Team API key**: `https://appstoreconnect.apple.com` → **Users and
   Access** → **Integrations** → **App Store Connect API** → **Team Keys**
   (<https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api>).
   Two preconditions the page states: the **Account Holder must have requested API
   access** for the team first, and generating a team key requires an **Admin**
   account. Record the **Team ID** (*Membership details*), the **Key ID**, the
   **Issuer ID**, and download the `.p8` — **once**; Apple keeps no copy.
   These become the four `APPLE_*` secrets in the `release` environment
   (`docs/ci.md` "Secrets"): `APPLE_TEAM_ID`, `APPLE_ASC_KEY_ID`,
   `APPLE_ASC_ISSUER_ID`, `APPLE_ASC_PRIVATE_KEY_BASE64`. The key's role must be
   able to manage signing assets and upload builds.
   **iOS signing, for the record:** this pipeline uses `-allowProvisioningUpdates`
   with that key, so no `.p12` or provisioning profile is carried as a secret
   (that is why `checklist.md` F2's `.p12` line is superseded). The desktop app's
   notarization credential is a different thing again — an app-specific password
   against a Developer ID identity, which is not what this pipeline uses.
5. **Land the release workflow's platform selection** — see the platform note
   below. `RELEASE_PLATFORMS=ios` is already set as a repository variable, but
   nothing reads it until that PR merges.
6. **The first tag is the credential check.** `credentials` runs first on every
   release and fails there, naming the missing variable, before any build or
   upload — so a mis-set secret costs one re-tag, not a half-release. (A
   `workflow_dispatch` dry run also exists, but it takes an existing tag, and the
   repository has none yet.)
7. **TestFlight**, then **App Store submission** — review notes, demo mode and
   the § E answers in `checklist.md`; expect a review round for the demo-mode
   request (Apple 2.1(a)). While the entity is being enrolled, the remaining
   Apple-path items in `checklist.md` § A can proceed in parallel: A6 (EU DSA
   trader status), A7 (legal review of the store copy — `store/`, which still
   carries `DRAFT — not submitted` markers that must be removed), A8 (account
   deletion, below) and A10.

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

## The platform variable and the platform-selection fix

`RELEASE_PLATFORMS` is a **repository variable** holding a comma-separated list:
`ios`, `android`, or `ios,android`. Unset/empty means `ios`. A PR from branch
`fix/release-platforms` changes `release.yml` so the `credentials` job checks only
the enabled platforms' secrets, the platform jobs are skipped when not enabled,
and `publish` tolerates a skipped platform (today a `v*` tag requires **all
nine** credentials and fails on the parked Play secrets). Link this file to that
PR once it lands. Tag runs are unaffected until then: do not cut a release tag
before it merges.

---

## Already done — no action on resume

- `release` environment created (2026-10-09) with its two deployment rules:
  branch `main` and tag `v*`. Custom branch policies are enabled, which is what
  makes a tag rule possible at all.
- Repository variable `RELEASE_PLATFORMS=ios` (2026-10-09).
- Android upload-keystore procedure written down (`docs/publishing/android-keystore.md`),
  deliberately not executed.
- `store/` metadata exists: 13 files (iOS and Android). Every one still carries
  `DRAFT — not submitted. Remove this line before uploading`. Its content pass is
  independent of accounts and can continue while parked.

## Store assets — produced, parked with the work

- **26 frames verified off `main`** (the `02da0334` tree): App Store 6.9" ×9
  (1320×2868), **iPad 13" ×9 (2064×2752)**, Play ×8 (1080×1920), plus
  `MANIFEST.sha256` and raw captures. They live in the parity lane's `store-shots`
  worktree (`design/store-screenshots/out/`, gitignored by design) and its
  scratchpad mirror.
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
  1290×2796**, or 440×956 → 1320×2868); and `capture --target frames --check`
  asserts sizes only, so it cannot catch a silent font fallback — add a
  rendered-font assertion.
- **Template facts:** the compose pipeline is committed and fixed (vendored
  `@font-face`, PR #70); the per-shot caption copy is editable in one re-render;
  the iPad caption rhythm wants ~16 px loosening; the spec colophon on each frame
  is a decide-once item at the re-shoot. Play caps screenshots at 8 per device
  type; Apple wants 1–10 per size at the 6.9" class.

## Out of scope of this park (still moving)

- **Radient-side: account deletion and the mobile OAuth `client_id`** — required
  by both stores eventually, and product work regardless of when submission
  resumes.
- The app's feature work: perf first-paint, push + STT + LAN, parity fixes.
- No store-frame recapture for submission while parked.
