# Publishing checklist

One actionable list. Every item has an **owner** (`operator` = a human with
account access, `agent` = a coding agent in this repository, `CI` = the build
pipeline), whether it **blocks** a first submission, and the **source** that
decides it.

Owners matter because most of this cannot be done by an agent: account
enrollment, legal identity, and payments require a human who can accept
contracts. Agents own everything inside the repository.

Sources are the two requirement documents in this directory
(`apple-app-store.md`, `google-play.md`) and the pages those cite. Read the
parent document before acting on an item — this list says *what* and *who*, not
*how*.

**Status of the programme:** nothing below has been submitted to any store, and
most of it is not done — but the in-repository items are further along than that.
**F1** (the pinned macOS runner) and **F6** (the release workflow: tag → build → sign →
upload → attach) are in the repository, landed with [#10](https://github.com/damianvtran/local-operator-mobile/pull/10) and not yet proven by a tagged release; **F7** (the no-Xcode, no-SDK local path), **B5** (the Android launcher icons and the
512 px Play icon) and **B15** (the accessibility work, held by `pnpm contrast:check`,
the 200 % text scale and the reduced-motion handling) are done, and **B4** has its
source layers and its light, dark and tinted renders committed while the `.icon`
bundle itself is still built by hand in Icon Composer. The app exists and builds;
this list is what remains before a store will accept it, ordered so that the
long-lead items start first.

---

## A. Accounts and legal (owner: operator)

| # | Item | Blocking | Source |
| --- | --- | --- | --- |
| A1 | **Decide the legal seller.** Recommendation: Radient Inc. as an organization on both stores, not an individual. | yes | `apple-app-store.md` § 1, `google-play.md` § 1 |
| A2 | **Get a D-U-N-S number** for Radient Inc. (free from Dun & Bradstreet; up to 30 days). Needed by Apple organization enrollment **and** the Play organization account. | yes | same |
| A3 | Enroll in the **Apple Developer Program** (99 USD/year) as the organization; Apple Account with 2FA, work email on the organization domain, publicly reachable website on that domain | yes | <https://developer.apple.com/programs/enroll/> |
| A4 | Create the **Google Play Console organization account**; verify identity; keep contact email and phone operational (they are verified by OTP and shown on Play) | yes | <https://support.google.com/googleplay/android-developer/answer/13628312> |
| A5 | **Accept the Apple Developer Program License Agreement** (it was updated 2026-08-18 for EU business terms; Attachment 14 takes effect 2026-10-01) | yes | `apple-app-store.md` § 7 |
| A6 | **Decide EU DSA trader status.** Recommendation: declare trader; it publishes a verifiable business address, phone and email on the app's EU product page and requires documentation upload | yes | <https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/> |
| A7 | **Legal review of the store copy** (`store/`), especially the privacy claims, before submission. Apple's 5.1.1(i) makes the privacy policy the operative document for what the store text may say | yes | `apple-app-store.md` § 4.1 |
| A8 | **Ship account deletion in Radient.** Blocking finding: the console has no delete-account control and the API exposes none, while the public FAQ tells users to use one. Also required: a web deletion resource for Play | **yes — critical path** | `apple-app-store.md` § 3.5, `google-play.md` § 5.2 |
| A9 | **Decide the pricing posture.** Recommendation: the app stays free with **no purchasing and no purchase call-to-action** in it, which is what Guideline 3.1.3(f) requires for a free companion to a paid web tool. Tunnels and credits are set up on the computer, not the phone | yes | `apple-app-store.md` § 3.6, `google-play.md` § 7.3 |
| A10 | **Decide the Radient OAuth client_id for mobile.** The private-use scheme route is rejected today; mobile needs either a loopback listener during sign-in or a registered https/mobile callback | yes | `docs/relay/` (auth), `apple-app-store.md` § 3.8 |
| A11 | **Recruit reviewers/testers**: if the Play account ends up personal, **12 testers for 14 continuous days**; for TestFlight, a handful of people who have never run `lop` | no (personal accounts only) | `google-play.md` § 2, `other-channels.md` § 1 |

---

## B. App configuration (owner: agent, values decided with the operator)

| # | Item | Blocking | Source |
| --- | --- | --- | --- |
| B1 | **Bundle ID** agreed and registered before the first build upload — it cannot change afterwards. Suggested: `com.radienthq.localoperator` | yes | `apple-app-store.md` § 1 |
| B2 | **Android package name** agreed and registered to a verified developer (Play does this automatically for 99% of apps when Play App Signing is on) | yes | `google-play.md` § 4 |
| B3 | **Versioning scheme** — iOS `CFBundleShortVersionString` / `CFBundleVersion`, Android `versionName` / `versionCode`, both driven from one source of truth in CI; pull requests never bump the version (`AGENTS.md`) | no | `AGENTS.md` |
| B4 | **Asset catalog with a 1024×1024 primary icon**, layered for Liquid Glass (background + foreground layers authored in Icon Composer), plus dark/clear/tinted variants; **no alpha channel**, no pre-masked corners, sRGB / Display P3 | yes | `apple-app-store.md` § 9.1 |
| B5 | **Android launcher icon** and the **512×512 32-bit PNG store icon** (max 1024 KB, with alpha) | yes | `google-play.md` § 9 |
| B6 | **`ITSAppUsesNonExemptEncryption`** set correctly and the dependency list checked for non-exempt crypto; the app carries a bearer token and cookies, no custom crypto hooks | yes | `apple-app-store.md` § 5 |
| B7 | **Privacy manifest** `PrivacyInfo.xcprivacy` generated from Xcode's app privacy report, with `NSPrivacyAccessedAPIType` entries for every required-reason API actually called (UserDefaults is near-certain; file timestamps if the app reads them; boot time if a timer does) | yes | `apple-app-store.md` § 4.2 |
| B8 | **Third-party SDK manifests and signatures** verified — any dependency on Apple's published list must ship a privacy manifest and be signed by its own developer | yes | `apple-app-store.md` § 4.3 |
| B9 | **Permission usage strings**, all of them, in the voice's register. The same-Wi-Fi path (ADR 0002 § 5) ships `NSLocalNetworkUsageDescription` (CI-asserted out of the built `Info.plist`) and `ACCESS_LOCAL_NETWORK` on Android (declared; the runtime request is deferred to the `targetSdk 37` bump); if a LAN *discovery* feature is ever added, `NSBonjourServices` joins them | yes | `apple-app-store.md` § 3.9, ADR 0002 § 5 |
| B10 | **No photo-library permission.** Attachments use the platform picker (`PHPickerViewController` / Android Photo Picker); `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` are declarable only with an approved core use case and were fully enforced from 2025-05-28 | yes | `google-play.md` § 6 |
| B11 | **`targetSdk 36`**, 16 KB page-size alignment for every native library, and an **adaptive layout** that survives the loss of orientation and resizability restrictions on ≥ 600dp displays | yes | `google-play.md` § 8 |
| B12 | **Sign-in via `ASWebAuthenticationSession` (iOS) / Custom Tabs (Android)** — never an embedded WebView, because the Radient console signs in with Google and Microsoft | yes | `apple-app-store.md` § 3.8 |
| B13 | **Deep links / universal links** for a tunnel or session, if the app advertises any | no | `apple-app-store.md` § 8 |
| B14 | **iPad support decision** and the layouts it implies; "Designed for iPad" on Apple silicon Macs turned **off** | yes (decision) | `apple-app-store.md` § 8 |
| B15 | **Accessibility work**: VoiceOver labels, Dynamic Type to 200%+, adequate contrast, reduced-motion handling — required for four Android screenshot categories, and the iOS labels are separately assessed in § C | yes | `google-play.md` § 9 |

---

## C. Assets (owner: agent, with the design kit)

| # | Item | Blocking | Source |
| --- | --- | --- | --- |
| C1 | **Demo mode** that runs with no computer, no tunnel and no account, exercising the session list, transcript, approvals, composer, subagents and past sessions. This is the review-access plan (§ E) and the screenshot source. The App Review request must name the **security obligation** that 2.1(a) requires (exposing a live agent on a machine we control to an unknown reviewer), because that clause grants the demo-mode route only "due to legal or security obligations", and only with prior approval | **yes** | `apple-app-store.md` § 3.1 |
| C2 | **iOS screenshots**: 6.9" iPhone (1260×2736 or 1290×2796 or 1320×2868 portrait), **6.5" required if 6.9" is not supplied**; iPad 13" (2064×2752 / 2048×2732 portrait) required if the app runs on iPad. 1–10 images, PNG/JPG, **no alpha** | yes | `apple-app-store.md` § 9.2 |
| C3 | **Android screenshots**: at least 2 across device types (4 recommended, ≥ 1080 px, 9:16 portrait); tablet screenshots use **16:9 landscape**; all between 1080 and 7680 px, aspect ratio no more than 2:1 | yes | `google-play.md` § 9 |
| C4 | **Android feature graphic** 1024×500, JPEG or 24-bit PNG **without alpha**, and the **512×512 icon** (§ B5) | yes | `google-play.md` § 9 |
| C5 | **App preview video** (optional, iOS) and **Play promo video** (optional) — only if they show the real app | no | `apple-app-store.md` § 9.2 |
| C6 | **Copy is honest about state**: the app is in development, no shipped claims. Voice rules from the design kit; no banned words; no screenshots of an interface that does not exist | yes | `~/local-operator-site/docs/design-kit/voice.md`, `store/README` |

---

## D. Privacy and compliance documents (owner: operator + agent)

| # | Item | Blocking | Source |
| --- | --- | --- | --- |
| D1 | **Privacy policy URL** for the App Store product page and the Play listing. Radient's is live at <https://radienthq.com/privacy-policy> (verified 200, 2026-09-29). **Open question:** whether the org wants the *site's* or a dedicated *app* policy — the app adds no collection the existing policy does not already cover, so the existing one should serve | yes | `apple-app-store.md` § 4.1 |
| D2 | **Terms URL**: <https://radienthq.com/terms> (verified 200, 2026-09-29) | yes | same |
| D3 | **Account-deletion web resource**, same as A8; must work without the app installed | yes | `google-play.md` § 5.2 |
| D4 | **Support URL** that leads to real contact information — a contact page, not a repository. Radient's contact page is live: <https://radienthq.com/contact> (200, 2026-09-29). Do **not** use `local-operator.com/support`, which 404s | yes | <https://developer.apple.com/help/app-store-connect/reference/app-information/app-information> |
| D5 | **Marketing URL** — <https://local-operator.com> (200) or the docs site <https://docs.local-operator.com> (200) | no | same |
| D6 | **Privacy nutrition label** (App Store Connect) written from the same analysis as the Play Data safety form; "Data Not Collected" is only defensible if the Radient leg truly is authentication only | yes | `apple-app-store.md` § 4.1 |
| D7 | **Play Data safety form** — every declaration, the independent security review answer (play policy language; leave off unless a real MASA review exists), the deletion questions, and the same deletion URL | yes | `google-play.md` § 5 |
| D8 | **Export compliance documentation**, if any dependency turns out to use non-exempt encryption; otherwise the `Info.plist` declaration in B6 removes the per-submission question | yes | `apple-app-store.md` § 5 |
| D9 | **Age rating questionnaire** answered on both stores, including the new **social-media** questions (required for submissions from September 2026); the app has no social feed, so answer accordingly — and answer consistently with the screenshots | yes | `apple-app-store.md` § 6, `google-play.md` § 7.5 |
| D10 | **Content rights** declaration, and rights confirmed for every asset shipped (the brand kit's icons are the project's own) | yes | `apple-app-store.md` § 9 |

---

## E. Review access (owner: agent, decision with the operator)

| # | Item | Blocking | Source |
| --- | --- | --- | --- |
| E1 | **Demo mode**, or a demo account that never expires — Apple 2.1 accepts a built-in demo mode only with prior approval, and only "due to legal or security obligations". The request must name the obligation, not the convenience, or it reads as a preference and fails | yes | `apple-app-store.md` § 3.1 |
| E2 | **Review notes** (≤ 4,000 bytes) explaining what the app is, that its content is produced on the user's own computer, and how to reach every screen in demo mode. Apple requires **specific** descriptions of new functionality (2.3.1(a)). One sentence in here must state the 2.1(a) security obligation that justifies demo mode in lieu of a demo account | yes | `apple-app-store.md` § 3.1, § 11 |
| E3 | **Play reviewer access details** — reusable, location-independent, valid at all times, English | yes | <https://support.google.com/googleplay/android-developer/answer/15748846> |
| E4 | **Pre-launch report credentials** so Google's crawler can pass the sign-in screen | yes | `google-play.md` § 10 |
| E5 | **A written answer, in the notes, to the question a reviewer will ask first**: is this a remote-desktop client under 4.2.7, or something else? The app renders the relay's own API and does not mirror a screen | yes | `apple-app-store.md` § 3.3 |
| E6 | **A written answer on the AI/UGC question** (Apple 1.2, Play UGC): content is produced by the user's own agent on the user's own machine and is never distributed to other users | yes | `apple-app-store.md` § 3.4, `google-play.md` § 7.1 |

---

## F. CI and secrets (owner: CI / operator)

| # | Item | Blocking | Source |
| --- | --- | --- | --- |
| F1 | **macOS runner pinned** to a hosted image carrying Xcode ≥ 26 (`macos-26-arm64` ships Xcode 26.6 by default). Never rely on `macos-latest` resolving to an image with a qualifying SDK | yes | `apple-app-store.md` § 2 |
| F2 | **iOS signing assets as secrets**: distribution certificate (`.p12`), provisioning profile, App Store Connect API key for uploads. Never in the repository | yes | `apple-app-store.md` § 9.3 |
| F3 | **Android upload keystore as a secret**, RSA ≥ 2048 bits, plus its passwords; Play App Signing enabled so the app signing key is Google's and the upload key is resettable | yes | `google-play.md` § 3 |
| F4 | **Same upload key used for Play, GitHub Releases and any F-Droid entry** so sideloaded installs keep updating | yes | `other-channels.md` § 8 |
| F5 | **`fastlane` metadata upload** wired to `store/ios/metadata` and `store/android/metadata` (`deliver` / `supply` layouts), so listing copy is reviewed in a pull request rather than typed into a console. The upload **must strip the `DRAFT:` marker conditionally** (see `store/README.md`): `head -n +3` never removes it, and `tail -n +3` would empty a one-line field if any future file arrived unmarked | no | `store/README.md` |
| F6 | **Release workflow**: tag → build → sign → upload → attach the APK to the GitHub Release. F-Droid or IzzyOnDroid only after that is boring | yes | `other-channels.md` § 3 |
| F7 | **A no-Xcode/no-SDK local path** — the repository's own rule — so contributors and agents without a toolchain can still run the app's logic under Node or in the web target | no | `AGENTS.md` |

---

## G. Launch steps (owner: operator, executed with CI)

| # | Step | Blocking |
| --- | --- | --- |
| G1 | Submission to **TestFlight external**; a person who has never run `lop` opens it cold and completes the demo-mode walkthrough from E2 | yes |
| G2 | Play **internal test**; run the **pre-launch report**, fix what it finds, re-run | yes |
| G3 | Play **closed test** only if the account is personal (12 testers × 14 days, `google-play.md` § 2) | conditional |
| G4 | **App Store submission** with review notes, demo mode, and the § E answers | yes |
| G5 | **Play production** release, after any closed test, with the Data safety form complete | yes |
| G6 | **Phased release on iOS** for the first few versions: 1% → 2% → 5% → 10% → 20% → 50% → 100% over seven days, pausable | recommended |
| G7 | **GitHub Release** with the signed APK attached, so Obtainium users get it | recommended |
| G8 | Post-release: watch crash reports, pre-launch report state, and store ratings; keep the privacy labels and Data safety form in step with each release | yes, ongoing |

---

## The two things that are genuinely blocked on someone else

1. **A8 — account deletion does not exist in Radient.** Both stores require it
   once account creation is possible in the app. Nothing in this repository can
   fix it, and it blocks *both* first submissions.
2. **A2/A3/A4 — organization identities.** A D-U-N-S number and two developer
   program enrollments take days to weeks and require a human who can sign for
   the company. They gate every upload, and starting them late costs a fortnight.

Everything else on this list can be done by an agent, in this repository, without
anyone's permission.
