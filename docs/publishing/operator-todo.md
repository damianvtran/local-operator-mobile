# Store submission — parked runbook

**Status: PARKED at the operator's call (2026-10-09).** Publishing will happen
under the operator's **legal entity** (which already holds a D-U-N-S number), not
under the individual team `SHA2U6KT7V` that signs the desktop app. Nothing here
runs until the operator says go.

**No agent-side blocker remains.** Nothing in this file gates any other work: the
app's non-store work, and the Radient-side items (account deletion, the mobile
OAuth `client_id`), proceed independently.

---

## Resume checklist — Apple (entity path), in order

1. **Enrol the entity in the Apple Developer Program** as an organization. Needs:
   the existing **D-U-N-S number**, legal authority to bind the entity, a work
   email on the entity's domain and a public website on it. Published lead time:
   **1–2 weeks** (manual legal-entity verification). Membership is 99 USD/year.
   The individual team `SHA2U6KT7V` stays as-is for the desktop app's Developer ID
   signing; it is **not** the publishing identity.
2. **Create the Team API key** (new team): App Store Connect → *Users and Access* →
   *Integrations* → *App Store Connect API* → *Team Keys* → Generate (Admin role
   required). Record the **Team ID** (*Membership details*), the **Key ID**, the
   **Issuer ID**, and download the `.p8` — once, it cannot be downloaded again.
   These four become `APPLE_TEAM_ID`, `APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER_ID`,
   `APPLE_ASC_PRIVATE_KEY_BASE64` in the `release` environment
   (`docs/ci.md` "Secrets").
   *Not the desktop's notarization credential* — that is an app-specific password
   and cannot upload to TestFlight.
3. **iOS-only release path** — `RELEASE_PLATFORMS=ios` is already set as a
   repository variable, and the release workflow's platform selection is fixed in
   the same change set as this file, so a `v*` tag builds and publishes iOS only
   and cannot fail on the parked Play secrets. Verify with a dry-run dispatch
   before the first real tag.
4. **TestFlight**, then **App Store submission** — review notes, demo mode and
   the § E answers from `checklist.md`; expect a review round for the demo-mode
   request (Apple 2.1(a)).

## Resume checklist — Google Play (organization path)

Only after its own decision; nothing is prepared in the consoles yet.

1. **Play Console organization account** — D-U-N-S, organization name/address,
   organization phone and website, a contact, and the 25 USD one-time fee
   (Google's required-information page, read 2026-10-09).
2. **Upload keystore** — agent-side procedure is prepared and **not executed**
   (`android-keystore-procedure.md` in the mobile programme's notes); it generates
   the key, sets the four `ANDROID_*` secrets, and hands the operator a record.
3. **Service-account JSON** → `PLAY_SERVICE_ACCOUNT_JSON_BASE64`: Play Console →
   *Account details* → note the Cloud Project ID → enable the Google Play
   Developer API there → create a service account → *Keys → Add key → JSON* →
   Play Console → *Users and permissions → Invite new users* with the service
   account's email. Play also wants **one manual build upload** before the API
   can publish.
4. Then set `RELEASE_PLATFORMS=ios,android`; the release gate will then require
   the Android credentials and fail loudly if any is absent.

**Testing note for whichever account type is used:** Google requires *personal*
developer accounts created after **2023-11-13** to run a closed test with
**12 testers opted in continuously for 14 days** before production access
(Google's testing-requirements page, read 2026-10-09). Organization accounts sit
outside that page's scope.

---

## Already done — no action on resume

- `release` environment created with its two deployment rules (branch `main`,
  tag `v*`; custom branch policies enabled, which is what makes the tag rule
  possible).
- Repository variable `RELEASE_PLATFORMS=ios`.
- Android upload-keystore procedure prepared, deliberately not executed.
- `store/` metadata exists (13 files, iOS and Android); every file still carries
  `DRAFT — not submitted. Remove this line before uploading`. The metadata's
  content pass is independent of accounts and can continue.

## Out of scope of this park (still moving)

- **Radient-side: account deletion and the mobile OAuth `client_id`** — required
  by both stores eventually, and product work regardless of when submission
  resumes.
- The app's feature work: perf first-paint, push + STT + LAN, parity fixes.
- No store-frame recapture for submission while parked.
