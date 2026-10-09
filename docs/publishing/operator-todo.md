# Operator to-do — the days-to-weeks items

One sheet, in dependency order, for the work only a human with account access can
do. **Apple first; Google Play is parked** (see the parked section at the end).

Each row: **what to do · where · expected lead time · what it unblocks.**
Sources are cited with the date they were read; where a lead time is a range, the
range is the published one, not an estimate.

---

## 0. Confirm the Apple account you are shipping under

**What:** the app ships under the **existing individual enrolment** — the local
signing identity is `Developer ID Application: Damian Tran (SHA2U6KT7V)`, and the
desktop app already signs and notarizes with that team. Two things to confirm in
the console, because only it can settle them:

1. **The team id is `SHA2U6KT7V`** and the account holding it is the one you want.
2. **The Developer Program membership is active for App Store distribution.** A
   Developer ID certificate evidences a paid membership at issue time — the
   certificate on this machine is valid to **2031-09-17** — but *membership
   status* is only shown in App Store Connect. Do not assume it; look.

**Where:** <https://appstoreconnect.apple.com> → *Business* / *Agreements*, and
the Apple Developer account's *Membership details*.

**Lead time:** minutes.

**Unblocks:** everything Apple below. If the membership turns out to be lapsed,
renewal comes first and every date on this sheet moves with it.

**The trade-off, plainly:** an individual enrolment shows the **operator's
personal legal name as the App Store seller**. That is acceptable for this
release; if an organization seller is wanted later, the route is an **App
Transfer** to an organization account (which then needs a D-U-N-S number), not a
change of this account's type.

---

## 1. Create the App Store Connect API key (the four `APPLE_*` secrets)

**What:** two things from the same account — the **Team ID** (`SHA2U6KT7V`, from
*Membership details*) which becomes `APPLE_TEAM_ID`, and a **Team API key** which
supplies the other three: `APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER_ID` and
`APPLE_ASC_PRIVATE_KEY_BASE64`.

**Exact path** (Apple's current documentation, read 2026-10-09):

1. <https://appstoreconnect.apple.com> → **Users and Access**.
2. **Integrations** tab → **App Store Connect API** in the left column.
3. Select the **Team Keys** tab. *(Generating a team key requires the Admin role
   on the account.)*
4. **Generate API Key** / the **+** button.
5. Give it a name and pick its role under Access — it must be able to manage
   signing assets and upload builds.
6. **Generate.**
7. **Download API Key** — the `.p8` is downloadable **once**; Apple keeps no copy.
   Note the **Key ID** and the **Issuer ID** shown beside it.

**Not the same credential as the desktop app's.** The desktop CI notarizes with
an **app-specific password** (`APPLE_ID_PASSWORD`-style secret) against a
Developer ID identity. That credential **cannot** upload to TestFlight and cannot
manage signing assets; TestFlight and App Store submission need the API key
above. Two credentials, two purposes.

**Lead time:** minutes.

**Unblocks:** iOS signing and export, the TestFlight upload, and — once
submitted — App Review.

**Hand-over:** the `.p8` and the two ids go to the agents out-of-band. They are
written into the `release` environment's secrets and never printed in a
transcript or a commit.

---

## 2. Sequence from here (iOS-first)

1. **TestFlight** — the release workflow uploads the signed IPA; the operator
   invites external testers (a handful of people who have never run `lop`
   qualifies, `checklist.md` G1).
2. **App Store submission** — with the review notes, the demo mode and the § E
   answers in `checklist.md`; then the App Review round.
3. **Play** — parked, see below.

**One dependency that is not a console step:** `checklist.md` **A8** — account
deletion does not exist in Radient (no console control, no API), and both stores
require it once account creation is possible in the app. It is the critical path
for submission and lives in a different repository. **A10** (the OAuth
`client_id` for the mobile app) is the same kind of item and sits beside it.
Neither waits on the operator.

---

## Parked — Google Play (not being pursued now)

Parked deliberately. Kept here so nothing has to be re-derived when it is picked
up; **no operator action until then**.

- **The Android build and CI path stays as it is.** The internal Android job is
  already *skipped* (not failed) when its secrets are absent, so nothing reds.
- **When Play is unparked**, the required artifacts are: the Play Console
  organization account (D-U-N-S, organization name/address/phone/website, $25
  one-time fee; Google's required-information page, read 2026-10-09), the upload
  keystore (agent-side procedure ready, see the appendix) and the service-account
  JSON (`PLAY_SERVICE_ACCOUNT_JSON_BASE64`).
- **The service-account path for later** (fastlane's canonical setup, read
  2026-10-09): Play Console → *Account details* → note the Google Cloud Project
  ID → enable the **Google Play Developer API** in that project → create a
  service account in that project → *Keys → Add key → JSON* → back in Play
  Console, **Users and permissions → Invite new users**, paste the service
  account's email, grant the release permissions. Play also wants **one build
  uploaded manually** before the API can publish.
- **Testing requirement to remember:** Google requires personal developer
  accounts created after **2023-11-13** to run a **closed test with 12 testers
  opted in continuously for 14 days** before production access (Google's app
  testing requirements page, read 2026-10-09). Organization accounts are outside
  that page's scope. If a personal account is used, budget the 14 days.

---

## Where the credentials go

Straight into the repository's **`release` environment** as environment secrets —
the nine names and the reason are in `docs/ci.md` "Secrets". The environment and
its two deployment rules (branch `main`, tag `v*`) were configured by the agents
on 2026-10-09; only the values are missing, and only the four Apple ones are
needed for the iOS-first path.

---

## Appendix — already done or agent-side, no operator action

- **`release` environment rules** — created 2026-10-09 (branch `main`, tag `v*`,
  custom branch policies enabled, which is what makes the tag rule possible).
- **iOS-only release path** — the release workflow currently requires every
  credential for both platforms; a PR makes it build and publish what the
  configured platforms say (Apple first), so a tag will not fail on the parked
  Play secrets.
- **Android upload keystore procedure** — prepared but **not executed**; only
  needed when Play is unparked or signed Android artifacts are wanted for the
  GitHub Release. Password handling is scripted so nothing is ever printed.
- **Store metadata** — exists in `store/` (13 files, iOS and Android), all still
  carrying `DRAFT — not submitted` markers that must be removed before upload.
