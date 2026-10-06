# Publishing on Google Play

Every requirement Google places on this app before it can ship on Google Play,
as of **2026-09-29**, with the rule that decides each one and the date it took
effect.

Google's policies are split across two surfaces that are easy to confuse: the
**Developer Program Policy** (what the app may do) and **Play Console** (the
forms and declarations you fill in). Both are cited below. Anything not sourced
from a Google page is marked as an inference or an open question.

---

## 1. Developer account

| Account type | What it needs | Notes |
| --- | --- | --- |
| **Personal** | Developer name, legal name, legal address, contact email and phone (both verified by one-time password and must stay operational), developer email | Created **after 2023-11-13** ⇒ the closed-testing gate in § 2 applies |
| **Organization** | The above, plus a **D-U-N-S number**, organization name/address/phone/website, contact name, and a developer phone shown publicly | The D-U-N-S number is free from Dun & Bradstreet but "this process can take up to 30 days", and you cannot create the account without one |

<https://support.google.com/googleplay/android-developer/answer/13628312>
(read 2026-09-29).

Google displays the legal name, legal address, developer email and (for
organizations) the developer phone number on Play. For a personal account that
monetizes, the full address is shown too.

**Decision for this app:** a **personal** account is the wrong choice twice
over — it triggers the 12-testers-for-14-days gate in § 2, and it publishes a
home address on a store listing for a public MIT-licensed product. Use an
**organization** account under Radient Inc. and start the D-U-N-S lookup now; it
is the longest lead time in this document and it is shared with the Apple
enrollment in `docs/publishing/apple-app-store.md` § 1.

---

## 2. The closed-testing gate (personal accounts created after 2023-11-13)

The single most schedule-bending rule on Play:

> "Developers with personal accounts created after November 13, 2023, must run a
> closed test for their app with a minimum of 12 testers who have been opted in
> continuously for at least 14 days. When you meet these criteria, you can apply
> for production access on the Dashboard in Play Console."

<https://support.google.com/googleplay/android-developer/answer/14151465>
(read 2026-09-29).

Consequences worth stating plainly:

- **Production access is gated, not automatic.** Uploading a build does not make
  it shippable; a closed test has to run first, and the clock only starts once
  **12 distinct testers** are opted in — not 12 installs, and not 12 accounts
  that opted in on different days.
- The 14 days must be **continuous**. A tester who leaves resets that tester.
- Internal testing has **no** such requirement (up to 100 testers, available
  before app setup is complete) — but internal testing does **not** count toward
  the gate.
- Open testing becomes available only after production access, so it cannot be
  used to satisfy the gate either.
- The pre-launch report (§ 8) and the Data safety form (§ 5) can be done during
  the closed test; do not serialise them after it.

**Organization accounts are not subject to this gate.** That is the second
reason for the decision in § 1. If the account ends up personal anyway, the
closed test is a **14-day critical path** that should start the day the first
installable build exists, and recruiting 12 testers is a task in the checklist,
not an afterthought.

---

## 3. Distribution format, signing, and package names

| Item | Rule | Source |
| --- | --- | --- |
| Format | **Android App Bundle (`.aab`)** for Play; Play generates and signs the optimized APKs | <https://support.google.com/googleplay/android-developer/answer/9842756> (read 2026-09-29) |
| Upload key | You sign the bundle with an upload key — "must be an RSA key of 2048 bits or more", stored in a Java keystore (`.jks`/`.keystore`) | same |
| App signing key | Held by Google (RSA 4096-bit if Google-generated; a custom key must be ≥ 2048-bit) and used to sign what users receive | same |
| Key reset | Google "can reset this key for you" if the **upload** key is lost or compromised; if you manage the **app signing** key yourself without Play App Signing, it cannot be reset | same |
| Quantum-ready signing | Available: hybrid classical RSA 4096-bit + post-quantum ML-DSA-65 | same |

**Consequences for CI.** The upload key and its passwords are CI secrets, never
committed (`AGENTS.md` forbids keystores and `.env` files in this repository).
Because Google holds the app signing key, a lost upload key is recoverable and a
lost self-managed signing key is not — so use Play App Signing rather than
bringing your own app signing key.

**Package name.** Register it in Play Console **before** the first upload,
because the Android developer-verification rules in § 4 allocate a contested
package name by signing key and install history.

---

## 4. Android developer verification — the 2026 rule that changes sideloading

This is new, it is live, and it affects the GitHub-Releases and F-Droid channels
in `docs/publishing/other-channels.md`, not just Play.

- Android "requires all apps to be registered by verified developers for users to
  install them on certified Android devices"
  (<https://developer.android.com/developer-verification/guides>, read 2026-09-29).
- **Next milestone: 2026-09-30** — protections begin for users installing apps
  from participating stores (**Google Play, HONOR App Market, OPPO App Market,
  Galaxy Store, Palm Store, V-Appstore, GetApps**) in **Brazil, Indonesia,
  Singapore and Thailand**, on certified devices running Android 7+
  (<https://developer.android.com/developer-verification>, read 2026-09-29).
- **2027:** expansion "globally to all apps on certified devices".
- If you do not verify and register by the deadline, "your apps will be blocked
  from being installed by users on certified Android devices in applicable
  regions" (<https://developer.android.com/developer-verification/guides/faq>).
- **Play Console is the single pane for this**: developers with a Play account
  "can use it as the single place to manage all their verification requirements,
  including for their apps distributed outside of Play". **Play App Signing
  registers apps automatically** — "If you use Play App Signing, we have the
  necessary information to securely identify your ownership"
  (<https://developer.android.com/developer-verification/guides/faq>).
- Registration is by **package name + SHA-256 certificate fingerprint**; a
  contested name is awarded by majority of known installs, then to any key with
  50+ installs, then first-come first-served
  (<https://developer.android.com/developer-verification/guides/android-developer-console>,
  read 2026-09-29).
- APIs exist to do registration in CI: the **Android Developer ID Status API**
  (check whether a package name is taken) and the **Android Developer Console
  API** (register and manage package names and keys), both supporting OAuth
  delegation.
- **ADB installs are exempt** — "you are free to install apps without
  verification with ADB" — and there is an **advanced flow** for power users:
  enable developer mode, confirm you are not being coached, restart and
  reauthenticate, wait one day, then confirm with biometrics/PIN, after which
  installs work for 7 days or indefinitely with an "unverified developer"
  warning (<https://android-developers.googleblog.com/2026/06/android-developer-verification.html>,
  read 2026-09-29).
- **Limited distribution accounts** exist for students, teachers and hobbyists:
  up to **20 devices**, no government ID, no fee, launching in 2026.

**What this means for this project**, concretely:

1. An **APK on GitHub Releases stops being installable by ordinary users** in
   the four named regions from 2026-09-30, and globally in 2027, unless the
   package is registered to a verified developer. The Obtainium/APK channel in
   `docs/publishing/other-channels.md` is therefore **not** a way to avoid
   verification — it is a way to distribute a *verified* package without Play's
   review.
2. Fixing it is cheap for us: ship through Play with Play App Signing and the
   package is registered for free, including for the Releases APK, because
   registration is per package name and key rather than per distribution
   channel.
3. Never generate a *second* signing key for the Releases APK. Two keys for one
   package name invites exactly the "sizeable cluster" arbitration in the console
   guide, and the key that loses has to rename the package.

---

## 5. Data safety and account deletion

### 5.1 The form

- **All developers** must complete the Data safety form, including apps that
  collect nothing: "Even developers with apps that do not collect any user data
  must complete this form and provide a link to their privacy policy"
  (<https://support.google.com/googleplay/android-developer/answer/10787469>,
  read 2026-09-29).
- Apps active **only** on internal testing are exempt from the form; an app is
  not exempt merely because it is in closed testing.
- Key definitions, quoted: **"Collect" means transmitting data from your app off
  a user's device**, and it explicitly includes data sent "by libraries and/or
  SDKs used in your app, irrespective of whether data is transmitted to you or a
  third-party server". **Ephemeral** processing "needs to be included in your
  form response, but … will not be disclosed in your app's Data safety section"
  when the data is only held in memory for as long as the request needs it.
  **"Sharing"** is transfer to a third party, including off-device server-to-server
  transfers, on-device transfer to another app, and transfers via an SDK — with
  stated carve-outs for **service providers**, legal obligations, user-initiated
  transfers with prominent disclosure and consent, and fully anonymized data.
- Required disclosures include whether data is **encrypted in transit** and
  whether users can **request deletion**.

### 5.2 Account deletion (the requirement that needs another repository)

> "If your app allows users to create an account from within your app, our User
> data policy requires that it must also allow users to request for their account
> to be deleted."

Play is *more* specific than Apple here: as well as an **in-app path**, the
developer must provide a **web link** where deletion can be requested without
returning to the app — "your web resource should give users a way to request that
their data be deleted without sending the user back to the app and requiring them
to re-download it to submit their request"
(<https://support.google.com/googleplay/android-developer/answer/13327111>,
read 2026-09-29). The link must be functional and in scope, the deletion must also
cover user data, and data passed to service providers must be deleted by asking
them to delete it.

Apps that offer account creation "in any part of the app experience" must offer
deletion "even if some features can be accessed without an account".

**This is the same finding as `docs/publishing/apple-app-store.md` § 3.5, and it
is worse here:** Apple accepts a link to a web page for the in-app path, but Play
requires the web resource *in addition* to the in-app path, and this app's
sign-in flow can create a Radient account (the Radient console's `user-console/src/app/signup/page.tsx`).
There is no delete-account UI or API in the console or the agent-server today
(read 2026-09-29). **Both stores are blocked on one Radient-side change.**

Note the difference in blast radius: the app itself is usable with **no Radient
account at all** (a non-Radient tunnel or custom URL plus the relay password).
That reduces the *severity* — a user can use the product without an account — but
it does not remove the requirement, because account creation is still offered.

---

## 6. Permissions and sensitive access

| Area | Rule | Source |
| --- | --- | --- |
| **Photos & video** | Apps targeting Android 13+ "may only request the `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` permissions if system pickers (like the Android Photo Picker) are not sufficient for your app to provide core functionality". Full compliance was mandatory from **2025-05-28**; non-compliant apps are subject to removal | <https://support.google.com/googleplay/android-developer/answer/14115180> (read 2026-09-29) |
| Photo picker | The Android Photo Picker is the sanctioned route; custom pickers "are not automatically qualified" and need a declaration | same |
| **Local network** | Android 16: opt-in via the `NEARBY_WIFI_DEVICES` permission. **Android 17 (targetSdk 37): mandatory** — local network is blocked by default for apps that update their target SDK, under the renamed `ACCESS_LOCAL_NETWORK` runtime permission; apps below targetSdk 37 ("legacy apps") keep an implicit grant, and Google's guidance is not to request the permission at runtime before targeting 37 | <https://developer.android.com/privacy-and-security/local-network-permission> (read 2026-10-06) |
| **Ads** | Must declare whether the app contains ads; the answer shows as a "Contains ads" label | <https://support.google.com/googleplay/android-developer/answer/9859455> (read 2026-09-29) |
| **Financial features** | **All** developers must complete the Financial features declaration, "including apps on closed testing, open testing, or production tracks", and apps with no financial features must still certify that | <https://support.google.com/googleplay/android-developer/answer/13849271> (read 2026-09-29) |

**For this app:** the image-attachment feature sends one photo into a session.
Attachments go through the **system photo picker** (`PickVisualMedia`, i.e.
`ACTION_PICK_IMAGES` on Android 13+, with the Play-services backport below it)
and the app requests **no media permission at all**: `READ_MEDIA_IMAGES`,
`READ_MEDIA_VIDEO` and both storage permissions are blocked in `app.config.ts`
(`expo-image-picker`'s own library manifest declares some of them) and asserted
ABSENT from the release merged manifest by `scripts/ci/native-config.ts`, so the
Play Photo and Video Permissions policy is not engaged. The camera is not a
feature of this app and its permission is blocked the same way. On local
network:
the Radient route reaches a tunnel over the internet, so it needs no LAN
permission; the same-Wi-Fi path (a literal private address, no tunnel — ADR 0002
§ 5) is where the project lands, and the app is configured for it — the manifest
declares `ACCESS_LOCAL_NETWORK` (inert while `targetSdk 36`; the runtime request
lands with the targetSdk-37 bump, per Google's guidance above), and the cleartext
half is `android:usesCleartextTraffic`, asserted in CI on the release merged
manifest. Localhost/loopback traffic is unaffected by the local-network project,
which is what an on-device OAuth loopback listener uses; from Android 17 the
platform also carries an implicit localhost configuration of its own.

---

## 7. Content and behaviour policies that apply

- **Payments.** Play Billing is required for in-app digital purchases unless a
  section 3/8/9 exception applies, and the steering prohibition is explicit:
  apps may not lead users to another payment method "via an app's listing … in-app
  promotions … in-app webviews, buttons, links, messaging, advertisements, or
  other calls to action; and in-app user interface flows, including account
  creation or sign-up flows".
  **US exception, in force:** "Google will not require the use of Google Play
  Billing in apps distributed on the Google Play Store, or prohibit the use of
  in-app payment methods other than Google Play Billing" for US users, since
  **2025-10-29**, with alternative-billing and external-content-link programs
  launched **2025-12-09**
  (<https://support.google.com/googleplay/android-developer/answer/15582165>,
  read 2026-09-29). Developers enrolled in those US programs must report
  transactions and pay service fees starting **2026-10-01**, with a reporting
  extension to **2026-12-01** for external content links.
  **Design consequence:** the app sells nothing. Radient credits are bought
  elsewhere; the app should not present a purchase call to action, which also
  keeps the app clear of the reporting obligations above.
- **AI-generated content.** Apps that generate content with AI must obey the
  Developer Policies, and must provide **in-app reporting or flagging** so users
  can report offensive content "without needing to exit the app"
  (<https://support.google.com/googleplay/android-developer/answer/13985936>,
  read 2026-09-29). This policy is written for apps whose *users* prompt a
  generative model inside the app. Local Operator Mobile renders text and code
  produced by a model running on **the user's own computer**, on the user's own
  machine — it is a client, not a generator. The honest reading is that the
  policy is not engaged; the defensible position if asked is that the model call
  happens outside the app, on hardware the user controls, and the output is
  visible only to that user. **Open question:** whether Google treats a client
  for a local model as an "app that generates content using AI". Ask before
  assuming; add the flagging affordance if the answer is yes.
- **User-generated content.** The UGC policy requires moderation, terms
  acceptance, in-app reporting/blocking and safeguards — but it defines UGC as
  "content that users contribute to an app, and which is visible to or accessible
  by **at least a subset of the app's users**"
  (<https://support.google.com/googleplay/android-developer/answer/9876937>,
  read 2026-09-29). This app has one user and no cross-user visibility, so it is
  not a UGC app. That stops being true the moment anything is shared, published,
  or made visible to a second person — including a "share this transcript" link.
- **Account deletion, financial declaration, content rating questionnaire, target
  audience, news declaration, government apps declaration, data safety**: all
  live on the **App content** page
  (<https://support.google.com/googleplay/android-developer/answer/9859455>).

---

## 8. Target API level, 16 KB pages, and large screens

### 8.1 Target API

| Requirement | Effective | Source |
| --- | --- | --- |
| New apps and updates for phones/tablets/foldables/Android Auto must target **Android 16 (API 36)** or higher | from **2026-08-31** | <https://developer.android.com/google/play/requirements/target-sdk> (read 2026-09-29) |
| Wear OS and Android Automotive OS: API 35+; Android TV and Android XR: API 34+ | same date | same |
| Existing apps must target **API 35+** to stay available to new users on newer devices | same date | same |
| Extension available to **2026-11-01** for non-compliant uploads | same date | same |
| Permanently private, organization-internal apps are exempt | — | same |

**Our target: `targetSdk 36` from the first upload.** Because the deadline has
already passed (2026-08-31) and the extension runs out on 2026-11-01, a new app
has no reason to start below it. It also brings the large-screen behaviour in
§ 8.3, which is a layout requirement rather than a form.

### 8.2 16 KB memory page sizes

"All apps targeting Android 15 (API level 35) and higher must support 16 KB
memory page sizes on 64-bit devices on Google Play. **Starting February 1, 2027**,
if your app updates don't support 16 KB memory page sizes, you won't be able to
release these updates"
(<https://developer.android.com/guide/practices/page-sizes>, read 2026-09-29).
The requirement applies where the app ships native libraries; NDK **r28+**
compiles 16 KB-aligned by default, and r27 and below need
`-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384`. Verify with
`zipalign -v -c -P 16 4`, whose last line reads "Verification successful".

**For this app:** if the toolchain is Flutter, React Native, or anything with a
native runtime, the libraries must be 16 KB-aligned. Add the `zipalign -P 16`
check to CI now, not in January 2027 — it is one line in the build job and it is
much cheaper to hold the invariant than to discover it two months before a hard
deadline.

### 8.3 Large screens and orientation

Android 16 (API 36) **ignores** `screenOrientation`, `resizeableActivity`,
`minAspectRatio`, `maxAspectRatio` and the `setRequestedOrientation` /
`getRequestedOrientation` values on displays with smallest width ≥ 600dp
(tablets, unfolded foldables, desktop windowing). Apps targeting API 36 "are
resizable and able to enter multi-window mode" there. There is an opt-out via
`android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`, **but** "the
Android framework will eliminate the opt-out capability in API level 37"
(<https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability>,
read 2026-09-29).

**Consequence:** a chat-style client that looks right on a phone must also work
as a two-pane layout on a tablet, and it cannot lock to portrait to avoid the
work. Plan the adaptive layout with the first screens, not as a follow-up. This
is also what makes the Chromebook/tablet screenshots in § 9 meaningful.

---

## 9. Store listing assets

| Asset | Requirement | Source |
| --- | --- | --- |
| App name | ≤ **30** characters | <https://support.google.com/googleplay/android-developer/answer/9859152> (read 2026-09-29) |
| Short description | ≤ **80** characters | same |
| Full description | ≤ **4,000** characters | same |
| App icon | **32-bit PNG with alpha, 512×512 px, ≤ 1024 KB**; must not imply ranking or price | <https://support.google.com/googleplay/android-developer/answer/9866151> (read 2026-09-29) |
| Feature graphic | **JPEG or 24-bit PNG (no alpha), 1024×500 px**; required to publish | same |
| Screenshots | Minimum **two**, across different device types; JPEG or 24-bit PNG, no alpha; **minimum dimension 320 px, maximum 3840 px**, and the maximum may be at most twice the minimum | same |
| Recommendation eligibility | For apps, at least **four** screenshots at ≥ 1080 px — 16:9 landscape (≥ 1920×1080) or 9:16 portrait (≥ 1080×1920) | same |
| Large screens | For tablets and Chromebooks, add **at least four** screenshots, **1,080–7,680 px**, 16:9 landscape or 9:16 portrait | same |
| Video | If used, **1280×720**, and monetization must be off so no third-party ad shows on Play | same |

Note the ceiling on screenshots: "The maximum dimension of your screenshot can't
be more than twice as long as the minimum dimension." A raw phone capture
(1179×2556 on a modern iPhone-size class of device) is within that; a very tall
stitched image is not.

---

## 10. Pre-launch report, tracks, and release mechanics

- **Pre-launch report** is generated automatically on bundle upload and when a
  release is saved to production, testing on real devices in Google's lab for
  **stability, Android compatibility, performance and accessibility**, with a
  crawler that taps, types and swipes for several minutes
  (<https://support.google.com/googleplay/android-developer/answer/9842757>,
  read 2026-09-29).
  **It cannot get past a sign-in screen unless you give it credentials**, and
  "you do not need to provide credentials if your app supports 'Sign-in with
  Google', (which enables the crawler to log in automatically)". For this app the
  crawler needs either the **demo mode** from
  `docs/publishing/apple-app-store.md` § 3.1 or testable credentials — and the
  same demo mode, reused, satisfies both stores. Expect accessibility findings;
  the report is the cheapest accessibility audit available before submission.
- **Tracks:** internal (up to 100 testers, no gate, available before app setup),
  closed (the gate in § 2 for new personal accounts), open (only after production
  access), production. Testers need a Google or Google Workspace account; test
  links can take hours to appear; feedback from test users does not affect the
  public rating; paid apps must be bought by testers except in internal testing
  (<https://support.google.com/googleplay/android-developer/answer/9845334>,
  read 2026-09-29).
- **Reviewer access details** must be provided in Play Console and must be
  "accessible at all times, reusable, and valid regardless of user location",
  with authentication bypassed for things like 2-step codes and OTPs. If the app
  has content behind a paywall, provide access that reaches it
  (<https://support.google.com/googleplay/android-developer/answer/15748846>,
  read 2026-09-29).
- **Age signals:** the Play Age Signals API began returning age signals for
  Brazil (2026-03-17, Digital ECA) and for Texas accounts created after
  2026-05-28 (SB 2420), with more US states to come
  (<https://developer.android.com/google/play/age-signals/overview>,
  read 2026-09-29). Not needed for a general-audience developer client today;
  revisit if the app ever carries content that needs per-age gating.

---

## 11. Where this leaves the submission

Blocking, in order:

1. **Account deletion and a web deletion resource** (§ 5.2) — the same
   Radient-side change that blocks Apple. Critical path.
2. **Organization account with a D-U-N-S number** (§ 1) — up to 30 days of lead
   time, and it removes the 14-day closed-testing gate.
3. **Package name registered to a verified developer** via Play App Signing
   (§ 4) — cheap through Play, and it keeps the GitHub-Releases APK installable.
4. **Demo mode** (§ 10) — needed for the pre-launch report crawler as well as
   App Review.
5. **`targetSdk 36`, 16 KB alignment, adaptive layout** (§ 8) — engineering
   requirements with deadlines, not preferences.

Needs an operator decision (stated as a decision, with what would change it):

- **Whether to use a personal or an organization account.** Recommendation:
  organization. Change it only if a D-U-N-S number cannot be obtained in time and
  a 14-day closed test with 12 recruited testers is acceptable instead.
- **Whether to enroll in the US alternative-billing or external-content-link
  programs.** Recommendation: no. The app sells nothing, so the programs would
  add reporting duties (fees due from 2026-10-01; external-link reporting from
  2026-12-01) for no benefit.
- **Whether to support tablets as a first-class target.** Recommendation: yes —
  Android 16 ignores portrait locks on ≥ 600dp displays, so the adaptive layout
  is not optional, and once it exists the four extra screenshots are free.
