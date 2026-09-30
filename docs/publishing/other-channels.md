# Every other way to get this app onto a phone

The App Store and Google Play are the two routes that need a whole document each
(`apple-app-store.md`, `google-play.md`). This is everything else: beta
channels, sideloading, F-Droid, the web target, the tablet and desktop surfaces
a phone app inherits, and the regional stores that are usually a waste of time.

Ordered by how much they are worth to **this** app, not by how big the store is.

---

## 1. TestFlight (iOS beta)

- Internal testers: up to **100** members of the team who hold the Account
  Holder, Admin, App Manager, Developer or Marketing role, with optional
  automatic distribution of new builds.
- External testers: up to **10,000**, invited by email or by public link; the
  first build in a group must be **approved by App Review for TestFlight**, and
  builds are sent for review automatically once added to a group.
- Testers can use up to **30 devices** each; up to **100 builds** can be shared
  at once; crash reports and screenshot feedback come back into App Store
  Connect.
- Apps using TestFlight "cannot be distributed to testers in exchange for
  compensation of any kind, including as a reward for crowd-sourced funding"
  (App Review Guideline 2.2), and a beta "should be intended for public
  distribution and should comply with the App Review Guidelines".
- Export compliance must be answered for the build before testers can install.

<https://developer.apple.com/testflight/> and
<https://developer.apple.com/app-store/review/guidelines/> (read 2026-09-29).

**What it is for here:** TestFlight is the only way to find out whether the
**demo mode** (see `apple-app-store.md` § 3.1) actually convinces someone who has
never run Local Operator. Put the reviewer-facing demo build in external
TestFlight, hand the public link to people who do not own a computer running
`lop`, and watch where they stop. That is cheaper than a rejection, and the same
build is what goes to App Review.

**Caveat:** a TestFlight build is signed against a distribution profile and
expires after **90 days**. A tester who is "opted in" to a beta is not a
long-term addressable audience; for a product with monthly releases, treat
TestFlight as a review rehearsal, not a release channel.

---

## 2. Play internal and closed testing

- **Internal testing**: up to 100 testers, no gate, available before app setup is
  complete, builds usually visible within seconds. Internal testing is
  **exempt from the Data safety form**.
- **Closed testing**: the gate for new personal accounts (12 testers × 14
  continuous days, see `google-play.md` § 2). Organization accounts skip it.
- **Open testing**: only after production access.
- Testers need a Google or Google Workspace account; test links can take hours
  to appear; feedback does not affect the public rating.

<https://support.google.com/googleplay/android-developer/answer/9845334>
(read 2026-09-29).

**What it is for here:** internal testing is the fastest loop that exists for
this app — a build is installable minutes after upload, with no review. Use it
for the first run of every release candidate. Internal testing also gives the
**pre-launch report** for free, including an accessibility pass, which is the
cheapest automated evidence available before submission.

---

## 3. GitHub Releases (APK) and Obtainium

This repository is MIT-licensed and public, so a signed APK attached to a GitHub
Release is a legitimate distribution channel — and the one that needs no store,
no review, no account, and no revenue share.

**How users keep it updated.** [Obtainium](https://github.com/ImranR98/Obtainium)
(20.1k stars, read 2026-09-29) installs and updates apps straight from their
release pages, supports GitHub and direct APK links, and pushes a notification
when a new release appears. It also has an app-specific "HTML" fallback for
anything else that returns a download. **A GitHub Release with an attached APK is
therefore a supported update channel**, and it is what many users of
self-hostable developer tools will choose.

**What this obliges us to do:**

- Attach a **release-signed APK** (not only an AAB) to every GitHub Release, and
  keep the filename and the signing key stable across releases. Obtainium tracks
  by pattern, and an APK signed by a different key cannot install over it.
- Produce a **per-ABI or a universal APK**; Play hands devices a split APK set,
  but a sideloaded install takes one file.
- The **upload-key vs app-signing-key split** (see `google-play.md` § 3) is what
  makes this safe: the artifact published on GitHub is signed with the key users
  have, and Play's key stays Google-managed.
- A sideloaded app receives **no** Play services: no Play Integrity, no
  install-referrer, no store updates. The app must work with none of them
  (it does — the relay needs only HTTP and SSE; see `docs/relay/`).

**Android developer verification makes this the interesting case.** From
**2026-09-30**, an app from an unregistered developer cannot be installed on a
certified device in Brazil, Indonesia, Singapore and Thailand, expanding
globally in 2027. Registering the package name through Play Console covers apps
distributed **outside** Play as well; registering through the **Android Developer
Console** covers apps distributed exclusively outside Play, and with a
**limited distribution** account that registration is free and needs no
government ID but is capped at **20 devices**. Full details, with the exact
rules and dates, are in `google-play.md` § 4.

**Recommendation:** register the package name as a full-distribution account
(§ 4 there), attach signed APKs to GitHub Releases, and document Obtainium in
the README as the supported way to stay current. It costs one line of
maintenance per release and serves the audience that will not install a store
build.

---

## 4. F-Droid

F-Droid is the canonical alternative store for free software on Android, and
this app's licence (MIT) is not the obstacle. Its **Inclusion Policy**
(<https://f-droid.org/en/docs/Inclusion_Policy/>, read 2026-09-29>) is.

What we satisfy already: FOSS-only applies to our code; a distinct application ID
from a domain we own is advised and we would do it; the app is actively
maintained; it is functional and implements what the description says.

What we would have to clear:

| F-Droid rule | Our position | Verdict |
| --- | --- | --- |
| "The implementation of proprietary tracking or advertising libraries and analytics tools such as Google Play Services and Firebase and Crashlytics … are strictly forbidden" | The app must ship with **no** Firebase, no Play Services, no crash SDK, no analytics SDK. This constrains the dependency list in the ADR, not just the build flavour | **Satisfiable, and a real constraint** |
| "Prebuilt binaries should only come from authorized trusted sources" — Maven Central, Google Maven, OSS Sonatype, OSS JFrog, JitPack, Clojars | A React Native or Expo dependency tree resolves almost entirely from Maven Central and Google Maven. Prebuilt car/Flutter/Hermes binaries get explicit permission | **Satisfiable** |
| "must not download additional executable binary files (e.g. add-ons, auto-updates, etc.) without explicit user consent", where consent must be opt-in and must explain that the user is bypassing F-Droid's checks | The app **never** does this: it is a client, not a runtime that fetches code to execute. The *desktop* app writes its own tools, but that runs on the user's computer and is not shipped in this binary | **Satisfiable** |
| "Applications should provide native features and enhancements when it wraps a website" | The app renders the relay's structured API natively rather than wrapping the existing web client — this is also the App Store 4.2 argument | **Satisfiable, and worth documenting for both reviewers** |
| "The App should be useful to end users. Demo applications shouldn't be included" | It is useless without a computer running `lop`, which is the same fact as the App Store's demo-mode problem | **Not a blocker, but the description must say so** |
| Anti-Feature: **Non-Free Network Services** — "promotes or depends entirely on a proprietary network service" | The Radient tunnel is a proprietary hosted service. But the app also takes **any self-hosted tunnel or URL plus the relay password**, and the relay itself is MIT | **Likely labelled, not excluded** |
| Anti-Feature: **Tethered Network Services** — "would not be applied if there is a simple configuration option that allows pointing the app to a running instance of an alternative, publicly available, self-hostable server solution" | That exemption is written for exactly this architecture | **Not applied** |

**Reproducible builds** (<https://f-droid.org/en/docs/Reproducible_Builds/>,
read 2026-09-29) are where the effort is. F-Droid rebuilds the app from source and
publishes it under its own signature; where the upstream build is not bit-for-bit
reproducible it can instead verify a **developer-signed** APK against a recipe
(`Binaries:` plus `AllowedAPKSigningKeys`), and the APK must be identical apart
from the signature — which requires signing with `apksigner` and a clean
toolchain. React Native's Hermes bytecode and Android's resource compilation are
the usual suspects if a rebuild does not match; the practical answer is to
publish **both** signatures ("Publish both (upstream) developer-signed and
F-Droid-signed APKs") so users arriving from GitHub and from F-Droid both get
updates.

**Recommendation:** do not gate the launch on F-Droid. Ship Play + GitHub
Releases first, add an `fdroiddata` metadata recipe once one release is out, and
expect the first reproducible-build attempt to take real time. F-Droid also
declares itself "under threat" from Android developer verification and campaigns
at <https://keepandroidopen.org/> — the 2027 global expansion (§ 3) is a risk to
this channel that is outside our control, so it should never be the only way to
install the app.

---

## 5. A PWA / web target

The relay already ships a **web client** (`~/local-operator/local_operator/mobile/web`)
that this app is meant to supersede on phones. That means a third surface is
already in the world, and it should be treated as the deliberate **fallback**
rather than an accident:

- It requires no store, no review, no account and no install.
- It works on iOS, Android, desktop and anything else with a browser.
- It cannot do the things this app exists for: real background updates, platform
  sign-in, and an interface designed for a phone rather than adapted to one.

A PWA is **not** a substitute for the apps, and should not be marketed as one:
iOS PWAs cannot receive push notifications as reliably as a native app (and none
at all in some configurations), cannot be discovered in a store, and cannot hold
a background connection. Push is a v1 non-goal for the relay
(`~/local-operator/docs/mobile.md`, "Non-goals (v1)"), which makes the native
app *more* necessary, not less.

**Recommendation:** keep the web client working and link it from the README as
the zero-install option. Do not build a manifest-and-service-worker PWA in this
repository — the Vite web client in the Local Operator repo is the one to
improve, and duplicating it here would split the relay's UI across two
repositories.

---

## 6. Tablets, ChromeOS, and "Designed for iPad"

These are not separate stores; they are form factors a phone app inherits, and
each one has a rule that decides whether the app works on it.

- **Android tablets and foldables:** from **Android 16 (API 36)**, manifest
  orientation locks, `resizeableActivity`, `minAspectRatio` and
  `maxAspectRatio` are **ignored** on displays with smallest width ≥ 600dp, and
  the framework will remove the opt-out entirely in **API 37**. Portraits locks
  on tablets stop working. See `google-play.md` § 8.
  <https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability>
  (read 2026-09-29).
- **Chromebooks:** same store listing, separate screenshot set; Play expects at
  least four large-screen screenshots
  (<https://support.google.com/googleplay/android-developer/answer/9866151>).
- **macOS via "Designed for iPad":** by default, most iPhone and iPad apps are
  published **automatically** to the Mac App Store for Apple silicon Macs and to
  Apple Vision Pro, using the same metadata
  (<https://developer.apple.com/app-store/submitting/>).
  Play the consequence forward: this app's whole purpose is to reach a computer
  running Local Operator. Publishing the *client* to the Mac App Store puts a
  control surface for that computer onto that computer, where the desktop app
  and the TUI already are, and it does so without review of whether that is a
  good experience. **Turn it off** in App Store Connect's availability settings
  unless there is a deliberate reason to keep it.

---

## 7. Regional and OEM stores

| Store | Worth it? | Why |
| --- | --- | --- |
| **Amazon Appstore** | **No** | "Amazon Appstore on Android has been discontinued" — support ended **2025-08-20**, and apps downloaded from it "will not be guaranteed to operate on Android devices". It survives on Fire TV and Fire tablets only. <https://developer.amazon.com/apps-and-games/blogs/2025/02/upcoming-changes-to-amazon-appstore-for-android-devices-and-coins-program> (read 2026-09-29) |
| **Samsung Galaxy Store** | **Later, maybe** | A real store with a real review process (Galaxy Seller Portal, self-check list, Content Publish API) and its own signing arrangement — uploading an AAB means Galaxy Store manages the signing key. It is also one of the seven stores in Google's verification rollout, so package registration matters there too. It buys a slice of Android users, and it costs a second review pipeline and a second set of assets. Dedupe the work through fastlane-compatible metadata first |
| **Huawei AppGallery** | **No, for now** | Requires HMS rather than Google services on the devices that need it, which would mean a second build flavour for a client whose audience is developer-oriented. Revisit only if a specific market asks |
| **Aptoide, APKPure, Uptodown, APKMirror** | **No** | They redistribute APKs, often re-signed or repackaged. Publishing to GitHub Releases (which Obtainium already supports) reaches the same audience without handing a signed artifact to a third party. Note that Obtainium's own source list includes several of them, so coverage already exists indirectly |
| **F-Droid and IzzyOnDroid** | **F-Droid later; IzzyOnDroid is the cheaper first step** | IzzyOnDroid tracks GitHub Releases automatically, so it costs a submission rather than a reproducible build. It appears in Obtainium's source list, which is how users discover it |

**Recommendation:** Play + App Store + GitHub Releases at launch. Add
IzzyOnDroid (cheap, automated from GitHub Releases) and Galaxy Store (real
audience, but a second review pipeline) only once the release process is boring.
Do not pursue Amazon, Huawei or the APK mirrors at all.

---

## 8. What "release" means across all of these

One artifact inventory serves every channel above, and getting it wrong is how a
release goes half-shipped:

| Channel | Artifact | Signing | Updated by |
| --- | --- | --- | --- |
| App Store | `.ipa` uploaded to App Store Connect | Apple distribution profile | App Review, then phased release |
| TestFlight | same `.ipa` | same | automatic per build |
| Google Play | `.aab` | **upload key**; Play re-signs with the app signing key | Play, per track |
| F-Droid | rebuilt or verified APK | F-Droid **and/or** developer key | F-Droid index |
| GitHub Releases | APK (and the source tag) | **release key = the upload key** | the user, via Obtainium |
| Web | static assets served by the relay | n/a | the desktop app update |

The consequence to plan for: the **upload key must be one stable key** shared by
Play uploads, GitHub Releases and any F-Droid `AllowedAPKSigningKeys` entry.
Losing it means losing the ability to update sideloaded installs, and on Play it
can be reset only because Play holds the real app signing key.

Signed artifacts, keys and keystores never enter this repository (see
`AGENTS.md`); they live in CI secrets, never in this repository. The CI side of
that is section F of `docs/publishing/checklist.md`.
