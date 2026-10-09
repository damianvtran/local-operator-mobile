# Operator to-do — the days-to-weeks items

One sheet, in dependency order, for the work only a human with account access can
do. Everything an agent can do is in the appendix and does not wait on this list.

Each row: **what to do · where · expected lead time · what it unblocks.**

Sources are cited with the date they were read. Where a lead time is a range, the
range is the published one, not an estimate. Read `checklist.md` for the full
programme; this sheet is the critical path only.

---

## 0. Confirm which Apple account accepted the licence agreement

**What:** the operator has accepted Apple's updated Developer Program Licence
Agreement (Attachment 14 took effect 2026-10-01). Acceptance requires an Apple
Account with *some* developer membership, and the stated position is that no
enrolment is active. Both can be true — acceptance may have been on an older or
personal account, possibly a different team.

**Where:** <https://appstoreconnect.apple.com> → *Business* / *Agreements* shows
which team holds the accepted agreement; the account name is on the top-right menu.

**Lead time:** minutes.

**Unblocks: nothing directly.** It removes the one unknown that decides whether
step 3 is a fresh enrolment or a migration, and it tells us which team id the
future API key will belong to.

---

## 1. Decide the legal seller

**What:** who appears as the seller on both stores. Recommendation, from
`apple-app-store.md` § 1 and `google-play.md` § 1: **Radient Inc., as an
organization on both stores**, which matches the privacy policy and the brand.

**Where:** a decision, not a form.

**Lead time:** immediate.

**Unblocks:** steps 2–4 — both stores bind the seller identity into the account
that holds the apps, and it cannot be changed without a transfer afterwards.

---

## 2. Get a D-U-N-S number for Radient Inc.

**What:** the free business identifier from Dun & Bradstreet. It is required by
**both** Apple organization enrolment and the Play organization account.

**Where:** <https://developer.apple.com/help/account/membership/D-U-N-S> links the
request flow; it is free, and Apple's page warns about third parties charging for
it.

**Lead time:** typically **1–5 business days** after the entity is found in
Dun & Bradstreet; allow longer if the entity is not yet listed. `checklist.md` A2
budgeted up to 30 days.

**Unblocks:** step 3 and step 4.

---

## 3. Enrol in the Apple Developer Program — organization, not individual

**What:** the membership that carries the API key and the submission.

**Trade-off, stated plainly:**

| | Individual | Organization |
|---|---|---|
| Needs | Apple Account with 2FA, payment | The above **plus D-U-N-S**, a legal entity, and a person with authority to bind it |
| Lead time | ~24–48 h after payment | **1–2 weeks** (manual legal-entity verification), plus the D-U-N-S wait |
| Seller shown on the App Store | the person's legal name | the organization's name |
| Fits this app | the privacy policy and the Radient brand say otherwise | yes — and it is what `checklist.md` A1/A3 recommend |

Membership is **99 USD/year** either way. The account type is effectively
**permanent**: an individual account cannot be converted to an organization, and
moving later means an App Transfer, so decide before the first upload. Ship under
the organization.

**Where:** <https://developer.apple.com/programs/enroll/>. The organization path
also expects a work email on the organization's domain and a publicly reachable
website on it.

**Lead time:** 1–2 weeks, from a valid D-U-N-S.

**Unblocks:** the ASC API key (step 5), TestFlight, and App Review submission.

---

## 4. Create the Google Play Console organization account

**What:** the Play developer account, as an organization.

**Required information** (Google's own list, read 2026-10-09): D-U-N-S number,
organization name and address (taken from the linked Google Payments profile),
organization phone number and website, a contact name and email, and a developer
email address and phone number. Google displays the legal name, address and
developer contact details on the store. The contact email and phone must stay
operational — Google verifies them by OTP and may use them to check the account
is active.

**Where:** <https://play.google.com/console> → create developer account. There is
a one-time **25 USD** registration fee. Identity verification follows.

**Lead time:** days for verification, plus the D-U-N-S wait.

**Unblocks:** the Play service-account JSON (step 6) and every Play upload.

**The testing rule, checked today because it decides weeks:** Google requires a
closed test with **at least 12 testers opted in continuously for 14 days** before
production access — but that requirement is scoped to **personal accounts created
after 2023-11-13** (<https://support.google.com/googleplay/android-developer/answer/14151465>,
read 2026-10-09). An **organization account skips it**, which is a second reason
the seller decision in step 1 matters: choosing a personal account adds two weeks
of closed testing plus 12 testers to the critical path (this is `checklist.md` G3,
marked "conditional" for exactly this reason). If the operator prefers a personal
account, that is a deliberate two-week trade, not a shortcut.

---

## 5. Create the App Store Connect Team API key (the four `APPLE_*` secrets)

**What:** two things from the same account — the **Team ID** (Apple Developer
account → **Membership details**, the 10-character id) which becomes
`APPLE_TEAM_ID`, and a **Team API key** which supplies the other three:
`APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER_ID` and `APPLE_ASC_PRIVATE_KEY_BASE64`.

**Exact path** (Apple's current documentation, read 2026-10-09):

1. <https://appstoreconnect.apple.com> → **Users and Access**.
2. **Integrations** tab → **App Store Connect API** in the left column.
3. Make sure the **Team Keys** tab is selected. *(Generating a team key requires
   the Admin role on the account.)*
4. **Generate API Key** / the **+** button.
5. Name it (for your reference only) and pick its **role** under Access. For this
   pipeline the key must be able to manage signing assets and upload builds.
6. **Generate.**
7. **Download API Key** — the `.p8` is downloadable **once**; Apple keeps no copy.
   Note the **Key ID** and the **Issuer ID** shown on the page.

**Lead time:** minutes, once the enrolment exists.

**Unblocks:** iOS signing, the IPA export, and the TestFlight upload in
`release.yml`.

**Hand-over:** the `.p8`, the Key ID and the Issuer ID go to the agents
out-of-band. They are then written into the `release` environment's secrets; they
never appear in a transcript, a commit, or a chat message.

---

## 6. Create the Play service-account JSON (`PLAY_SERVICE_ACCOUNT_JSON_BASE64`)

**What:** the JSON key that lets CI publish to Play. This is the credential
`fastlane supply` consumes.

**Exact path** (fastlane's canonical setup, read 2026-10-09):

1. Play Console → **Account details** → note the **Google Cloud Project ID**.
2. Enable the **Google Play Developer API** in that project:
   <https://console.developers.google.com/apis/api/androidpublisher.googleapis.com>.
3. <https://console.cloud.google.com/iam-admin/serviceaccounts> → select the
   project → **CREATE SERVICE ACCOUNT** → give it a name → copy the generated
   **email address** → **DONE**.
4. On that service account: **Manage keys → ADD KEY → Create new key → JSON →
   CREATE**; save the file.
5. Back in Play Console → **Users and permissions → Invite new users** → paste the
   service-account email → **Account permissions** → grant the release permissions
   this pipeline needs (fastlane recommends Admin (all permissions); the release
   permission may be narrowed if preferred) → **Invite user**.

**One operational note, from the same documentation:** Play needs **at least one
build uploaded manually in the console** before the API can publish to the app —
budget one hand-upload of the first AAB.

**Lead time:** under an hour, once the account exists.

**Unblocks:** every Play upload (`supply`, internal track, then production).

---

## Where the two console credentials go

Both go into the repository's **`release` environment** as environment secrets —
the nine names and the reason are in `docs/ci.md` "Secrets". The environment and
its two deployment rules (branch `main`, tag `v*`) were configured by the agents
on 2026-10-09, so only the values are missing.

---

## Appendix — already done or agent-side, no operator action

- **`release` environment rules** — created 2026-10-09 (branch `main`, tag `v*`;
  custom branch policies enabled, which is what makes the tag rule possible).
- **Android upload keystore procedure** — prepared, ready to execute the moment
  step 1's answer lands: generation, storage and hand-over are scripted so no
  password is ever printed. Needs nothing from the operator until it runs.
- **Store metadata** — exists in `store/` (13 files, iOS and Android), all still
  carrying `DRAFT — not submitted` markers that must be removed before upload.
- **Release pipeline** — on `main`; a `v*` tag builds, signs, uploads and attaches
  the artefacts. Untested by a real tag until the secrets exist.
