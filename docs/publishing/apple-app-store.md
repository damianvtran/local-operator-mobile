# Publishing on the App Store

Every requirement Apple places on this app before it can ship on the App Store,
as of **2026-09-29**, with the rule that decides each one and the date it took
effect.

Read this before planning a submission, not before writing code: several of the
items below (bundle ID, the privacy manifest, the review-access path, the
account-deletion path) are cheap to design in and expensive to retrofit.

**Sources.** Apple's pages move — guideline text was revised on 2026-02-06 and
again on 2026-06-08, and the age-rating questionnaire gained questions in July
2026. Every claim below carries the URL it came from; where a date is stated it
is the date Apple states, not the date this file was written. Anything not
sourced from an Apple page is marked as an inference or an open question.

---

## 1. Program and App Store Connect setup

| Step | What it is | Source |
| --- | --- | --- |
| Apple Developer Program | 99 USD per membership year; prices vary by region | <https://developer.apple.com/programs/enroll/> (read 2026-09-29) |
| Enrollment as an organization | Needs a **legal entity** that can enter contracts (no DBAs or trade names), a **D-U-N-S Number** from Dun & Bradstreet, a work email on the organization's domain, and a publicly reachable website on that domain | same |
| Enrollment as an individual | Legal name, Apple Account with 2FA, legal age of majority; the personal legal name becomes the App Store seller name | same |
| Seller name | Whatever is enrolled is what shows on the product page; it can be changed later but not cheaply | same |
| App record | Name (≤ 30 chars), subtitle (≤ 30), bundle ID (**cannot change after the first build upload**), SKU (cannot change), primary category, privacy policy URL (required for iOS and macOS), copyright | <https://developer.apple.com/help/app-store-connect/reference/app-information/app-information> (read 2026-09-29) |

**Decision for this app:** enroll as the organization (Radient Inc.) rather than
an individual. Guideline 5.1.1(ix) says apps in highly regulated fields "should
be submitted by a legal entity"; a remote-control client that reaches a user's
own computer and a paid tunnel service is not in that list, but an
organization account is what a downstream DSA trader declaration, a Google Play
organization account, and the MIT-licensed product's public identity all point
at anyway. It also needs the D-U-N-S number, which is the long pole (up to 30
days).

**Register the bundle ID before the first build.** `com.radienthq.localoperator`
is the shape to use if the seller is Radient Inc.; changing it later means a new
app record and losing the review history. This must be agreed before CI signs
anything.

---

## 2. Toolchain and SDK minimums

| Requirement | Effective | Source |
| --- | --- | --- |
| Uploads must be built with **Xcode 26 or later** and an **iOS/iPadOS 26 (or macOS/tvOS/visionOS/watchOS 26)** SDK | since **2026-04-28** | <https://developer.apple.com/news/upcoming-requirements/?id=04282026a> (read 2026-09-29) |
| iOS/iPadOS apps must target **iOS 13 or later** | since **2026-09-09** | <https://developer.apple.com/news/upcoming-requirements/?id=0992026a> (read 2026-09-29) |
| Uploads must be built with the **iOS 27 / iPadOS 27 SDK** (and the corresponding 27 SDKs for other platforms) and target **iOS 15 or later** | starting **2027-04** | <https://developer.apple.com/app-store/submitting/> (read 2026-09-29) |

**What this means for CI.** The GitHub-hosted `macos-26-arm64` runner image
(`Image Version: 20260907.0351.1`) ships Xcode **26.6 (default)**, 26.5, 26.4.1,
26.3, 26.2, 26.1.1, 26.0.1 — so the April 2026 floor is satisfiable on a hosted
runner today, with no self-hosted machine
(<https://github.com/actions/runner-images/blob/main/images/macos/macos-26-arm64-Readme.md>,
read 2026-09-29). The `macos-15-arm64` image also carries 26.x but defaults to
16.4, so an unpinned `macos-latest` is a trap: pin the image and select Xcode
explicitly (`sudo xcode-select -s /Applications/Xcode_26.6.app`). Plan for the
April 2027 floor by tracking the `macos-27` image rather than pinning to 26.x
forever.

**Minimum deployment target.** Set it to what the toolchain and the app's own
APIs require, not to iOS 13. The iOS 13 floor is Apple's *upload* requirement;
the app's own floor is a product decision, and a 2026-era SwiftUI client has no
reason to support iOS 13.

Also, from Apple's submission page: "Make sure your apps and games work as
expected on Apple devices running the latest OS releases." New OS releases are
the recurring maintenance cost here, not the submission gates.

---

## 3. The guidelines that actually decide this app

Apple's App Review Guidelines page states **Last Updated: June 8, 2026**
(<https://developer.apple.com/app-store/review/guidelines/>, read 2026-09-29).
Quoted text below is from that page.

### 3.1 Guideline 2.1 — Completeness, and the review-access problem

> "Make sure your app has been tested on-device for bugs and stability before you
> submit it, and include demo account info (and turn on your back-end service!)
> if your app includes a login. If you are unable to provide a demo account due
> to legal or security obligations, you may include a built-in demo mode in lieu
> of a demo account with prior approval by Apple. Ensure the demo mode exhibits
> your app's full features and functionality."

This is **the hardest requirement in this file**, and it is a design requirement,
not a submission chore.

A reviewer cannot run Local Operator. They have no computer with `lop` installed,
no Radient account, and no tunnel. Every meaningful screen in this app is behind
that: session list, transcript, approvals, composer, subagents, past sessions.
A reviewer who sees a login wall and an empty state will reject on 2.1 —
"we will reject incomplete app bundles" — or on 2.3.1(a), which requires all new
functionality to be "described with specificity in the Notes for Review section"
and "accessible for review".

Three options, in the order they should be considered:

1. **Demo mode (recommended).** A built-in, no-network mode that renders the
   real UI against a bundled fixture transcript: a session list with two or three
   sessions, one live session with a transcript streaming, an approval card and
   an ask card pending, a subagent to drill into, a to-do list mid-flight, a past
   session to search, and a model sheet. The web client already carries fixtures
   for exactly these screens (`local_operator/mobile/web/src/fixtures`), so the
   content can be shared rather than invented.
   - Guideline 2.1(a) grants the demo-mode route only "if you are unable to
     provide a demo account **due to legal or security obligations**", and
     requires **prior approval by Apple**. So the request has to name the
     obligation, not a preference: a demo account on a relay we host would mean
     exposing a live agent executing code on a machine we control to an unknown
     reviewer — a security obligation we cannot accept — which is why a demo
     mode is the applicable route rather than the convenient one. That approval
     is asked for in the review notes, and the review notes have to say it in
     those terms. Budget a review round for it.
   - The same demo mode earns its keep twice: it is also the fixture for the
     design and UX harnesses in `docs/ux/`, and the only way screenshots can be
     captured on a machine with no tunnel.
2. **Demo account on a hosted relay.** Cheaper to build only if a
   `lop mobile` daemon run by us, behind a tunnel we own, with the relay password
   in the review notes, is acceptable. It is not: it exposes a live agent
   executing code on a machine we control, to an unknown reviewer, and a reviewer
   typing into the composer runs real turns against our model budget.
3. **Sign-in details for the Radient path only.** Fails 2.1 on its own: the
   reviewer is inside the app but sees zero sessions, because a Radient account
   does not give them a computer running `lop`.

**Ship option 1, and say so in the review notes in one sentence that names the
security obligation, not the convenience**: a demo account would require exposing
a live agent executing code on a machine we control, so 2.1(a)'s security route
is the applicable one.

### 3.2 Guideline 4.2 — Minimum functionality

> "Your app should include features, content, and UI that elevate it beyond a
> repackaged website. If your app is not particularly useful, unique, or
> 'app-like,' it doesn't belong on the App Store."

The risk here is real and specific: Local Operator already ships a phone-facing
**web client** served by the relay. A reviewer who discovers that will ask whether
the app is a wrapper. Three things answer it, and all three have to be true in
the build, not in the pitch:

- The app renders the relay's structured API natively (session state, tool calls,
  diffs, approvals) rather than loading the web client's HTML;
- it does work the web client cannot (native sign-in, background refresh,
  platform notifications, deep links into a session);
- it holds state across reconnects itself, rather than depending on a page load.

4.2.3(i) also applies: "Your app should work on its own without requiring
installation of another app to function." Installing the desktop app is,
strictly, required for the app to be *useful* — but the app itself runs, shows
the demo/first-run experience, and can be pointed at any relay. The same shape
(free companion client, host app required for real value) is common on the App
Store. Nothing to do beyond making the empty state honest.

### 3.3 Guideline 4.2.7 — Remote desktop clients

> "(a) The app must only connect to a user-owned host device that is a personal
> computer or dedicated game console owned by the user, and both the host device
> and client must be connected on a local and LAN-based network."

Read literally, clause (a) would make this app impossible: the whole point of the
Radient tunnel is that the phone is *not* on the same LAN.

**The app is not a remote desktop client, and the submission should say so.**
4.2.7 governs an app that "acts as a mirror of specific software or services
rather than a generic mirror of the host device" — i.e. it puts a remote *screen*
on the phone. This app renders no screen: it talks to the relay's HTTP/SSE API
and draws its own native UI from structured events (transcript entries, tool
calls, approval requests). The distinction matters because it is also the reason
no other guideline in that family bites:

- 4.7 (mini apps, plug-ins, downloaded software) — the app does not download or
  execute code; the user's *computer* does, and that code never enters the
  binary. Note the tension with 2.5.2 below.
- 4.3(b) spam — a client for a service is not a template variant, and the app is
  not in one of the named crowded categories.

**Where it does bite:** the agent writes and runs code on the user's computer, and
the app displays that code. Apple's 2.5.2 says apps "may not download, install, or
execute code which introduces or changes features or functionality of the app".
The app does none of those things — the code runs on the host and the app only
*renders text* — but a reviewer may ask. The answer is one sentence in the review
notes: the app is a read/write client for a remote API; no executable content
reaches the device.

### 3.4 Guideline 4.8 — Login services

> "Apps that use a third-party or social login service (such as Facebook Login,
> Google Sign-In, Log In with X, Sign In with LinkedIn, Login with Amazon, or
> WeChat Login) to set up or authenticate the user's primary account with the app
> must also offer as an equivalent option another login service" with three
> properties: it limits data collection to name and email, it lets users keep
> their email private, and it does not collect interactions for advertising
> without consent.

Two exemptions in the same guideline matter here:

> "Your app exclusively uses your company's own account setup and sign-in
> systems."
>
> "Your app is a client for a specific third-party service and users are required
> to sign in to their mail, social media, or other third-party account directly
> to access their content."

**Reading, and the risk.** The app's sign-in is *Radient's own* account system,
reached through Radient's console — which happens to federate to Google and
Microsoft upstream. Radient publishes both the app and the account system, so the
first exemption applies on its face: this is not Google Sign-In bolted into a
third-party app, it is `console.radienthq.com` in an authentication session.

The reviewer risk is that the *flow* looks like "Sign in with Google" — the
console's login screen offers Google and Microsoft buttons
(the Radient console's `user-console/src/components/auth/login-component.tsx`, read
2026-09-29). Two things reduce it, and both are worth having anyway:

- **The app does not require a Radient account.** The relay path (custom tunnel
  URL + relay password) works with no Radient account at all, and the guide
  for a fresh user should offer it first. This satisfies 5.1.1(v)'s "if your app
  doesn't include significant account-based features, let people use it without a
  login."
- **Sign in through `ASWebAuthenticationSession`, never an embedded WebView.**
  Google's OAuth policy blocks WebView user-agents outright, so an embedded
  webview will also fail in practice. Apple's own guidance is the same mechanism
  (`ASWebAuthenticationSession`), and 5.1.1(vii) requires `SafariViewController`
  to be visible rather than obscured when it presents web content.

**Open question for the operator:** whether to add Sign in with Apple to remove
4.8 from the argument entirely. It costs an Apple-specific backend change
(Radient would have to accept an Apple identity) and does not clearly buy
anything, given the exemption. Recommendation: **do not**, but record the
decision so it is not relitigated at review time; if Apple pushes back, adding it
is a scoped Radient change, not an app rewrite.

### 3.5 Guideline 5.1.1(v) — Account deletion

> "(v) Account Sign-In: If your app doesn't include significant account-based
> features, let people use it without a login. **If your app supports account
> creation, you must also offer account deletion within the app.**"

Apple's supporting guidance
(<https://developer.apple.com/support/offering-account-deletion-in-your-app/>,
read 2026-09-29) adds the practical details:

- The deletion option must be easy to find, typically in account settings.
- It must delete the whole account record, not merely deactivate it.
- **"If people need to visit a website to finish deleting their account, include
  a link directly to the page on your website where they can complete the
  process."** — an in-app link to a working web deletion page satisfies the
  requirement.
- All users, in every region, must be able to delete their account.

**This app supports account creation.** The Radient console serves
`/signup` and the login page's own title is "Radient - Sign in or create an
account"
(the Radient console's `user-console/src/app/signup/page.tsx`, `.../login/page.tsx`,
read 2026-09-29). A user can therefore create an account from inside the app's
sign-in flow.

**Finding (blocking): there is no reachable account-deletion path today.**
Grepping the console's `main` for a delete-account UI or API returns nothing —
the Radient console's `user-console/src/app/dashboard/{account,settings}/page.tsx` have no
delete control and Radient's `agent-server/internal/routes/routes.go` exposes
no `DELETE` for the user's own account (read 2026-09-29). Meanwhile the public
FAQ already tells users to "Use Delete Account in the console"
(the Radient site's `radient-site/src/data/faq.ts`, `id: "deleteAccount"`, read
2026-09-29). **The FAQ describes a control that does not exist in the code.**
That is a live product defect independent of this app, and it lands squarely on a
gate that would fail review.

What has to happen, in order, before an iOS submission:

1. Radient ships account deletion (in-app in the console, or a
   `radienthq.com/account-deletion` web page that does it end-to-end without
   sending the user back to the app). This is a **separate repository's** change
   and is outside this stream's paths.
2. The app links to it from an account screen, in the app, in every region.
3. The Google Play Data safety form gets the same URL (see
   `docs/publishing/google-play.md` § 5).

Until step 1 lands, this app cannot be submitted to either store. It should be
tracked as the programme's first blocking dependency, not discovered at review.

### 3.6 Guideline 3.1.1 / 3.1.3 — Radient credits and the payments rules

Guideline 3.1.1 requires in-app purchase for anything that "unlock[s] features or
functionality within your app", and forbids "license keys, augmented reality
markers, QR codes, cryptocurrencies and cryptocurrency wallets" as substitutes.

Guideline 3.1.3 then carves out the exemptions, and two are load-bearing here:

> **3.1.3(f) Free Stand-alone Apps:** "Free apps acting as a stand-alone
> companion to a paid web based tool (i.e. VoIP, Cloud Storage, Email Services,
> Web Hosting) do not need to use in-app purchase, provided there is no
> purchasing inside the app, or calls to action for purchase outside of the
> app."

> **3.1.3:** "Apps in this section cannot, within the app, encourage users to use
> a purchasing method other than in-app purchase, **except for apps on the United
> States storefront** and as set forth in 3.1.1(a) and 3.1.3(a). Developers can
> send communications outside of the app to their user base about purchasing
> methods other than in-app purchase."

And 3.1.1(a) / 3.1.3(a) confirm the current US position:

> "These entitlements are not required for developers to include buttons,
> external links, or other calls to action in their United States storefront
> apps."

**The US exception is real but guarded, and Apple is actively trying to undo
it.** The exemption exists because the district court found Apple in contempt and
barred fees on link-outs; the Ninth Circuit upheld the contempt finding; Apple
filed its opening merits brief at the Supreme Court on **2026-09-14**, asking the
Court to reverse or vacate, with argument expected in **2027**
(<https://www.macrumors.com/2026/09/14/apple-supreme-court-contempt-ruling/>,
read 2026-09-29). A design that depends on the US storefront exception is
therefore exposed to a ruling that reverses it.

**The design that survives all of it:** treat the app as 3.1.3(f)'s free
companion, and never put purchasing in it.

- The app **never sells credits, never shows a price, never renders a "buy" or
  "top up" button, and never links to a checkout** — in any storefront.
- Tunnel setup happens on the computer, where it already does: the operator runs
  `lop tunnel billing/create/install/connect` (or `/mobile enable` in the TUI).
  The phone app *discovers* tunnels that already exist. When it finds none, the
  empty state says what to do **on the computer** — that is setup guidance for a
  companion client, not a call to action to purchase, but it is close enough to
  the line that the copy should be reviewed (see the note below).
- The app may *display* a balance or plan state it reads from the API, because
  that is information about a service the user already has. Displaying a number
  is not selling one.

**Copy risk to settle deliberately, not by accident.** 3.1.3(f)'s exemption is
lost if the app contains "calls to action for purchase outside of the app". A
string like "Set up a tunnel — plans from $X at radienthq.com" is a purchase
call to action in any storefront, including the US, because 3.1.3(f) has no US
carve-out. The safe phrasing points at the computer and describes a task, not a
purchase: name the command, say it runs on the machine running the agents, and
say nothing about price. Store copy in `store/` follows this rule.

### 3.7 Guideline 1.2 — User-generated content and AI output

> "Apps with user-generated content or social networking services must include:
> A method for filtering objectionable material from being posted to the app; A
> mechanism to report offensive content and timely responses to concerns; The
> ability to block abusive users from the service; Published contact information
> so users can easily reach you."
>
> (2026-02-06 revision) "apps with random or anonymous chat are subject to the 1.2
> User-Generated Content guideline"
> (<https://developer.apple.com/news/?id=d75yllv4>).

**Position: 1.2 does not apply to this app, and the reason must be stated
plainly.** There is no second user. Every transcript the app renders was produced
by an agent running on the user's own computer, for that user; nothing is
"posted", distributed, or visible to a subset of other users. The app is
single-tenant by construction — one relay, one password (or one Radient account),
one owner.

Consequences to hold:

- Do **not** add any sharing, publishing, or multi-user surface without
  revisiting 1.2 and Google Play's UGC policy (`docs/publishing/google-play.md`
  § 5). A "share this session" feature turns this from a client into a UGC app
  and drags in moderation requirements that are disproportionate to a personal
  tool.
- The AI-output angle is answered the same way: Apple has no separate
  "AI-generated content" guideline. Play **does** have an AI-Generated Content
  policy requiring in-app reporting for AI output — see the Play doc, where the
  same single-tenant argument is made, and note that Play's policy is about
  content generated *by models in the app*, which this app does not do.

### 3.8 Guideline 2.3 — Accurate metadata

- 2.3.1(a): "All new features, functionality, and product changes must be
  described with specificity in the Notes for Review section in App Store
  Connect (generic descriptions will be rejected) and accessible for review."
- 2.3.3: "Screenshots should show the app in use, and not merely the title art,
  login page, or splash screen."
- 2.3.7: app names ≤ 30 characters; keywords must not pack trademarked terms or
  other apps' names; subtitles must not "make unverifiable product claims".
- 2.3.8: metadata must be appropriate for all audiences even if the app is rated
  higher.

All four are covered by the demo mode: without it, 2.3.3 cannot even be
satisfied, because a screenshot of an empty session list is a screenshot of a
login page or an empty state.

### 3.9 Guideline 2.5.1 — Public APIs and current OS

"Apps may only use public APIs and must run on the currently shipping OS."
Nothing here is unusual, with one caveat: the app talks to a loopback listener
during Radient sign-in (see § 6). Loopback sockets are public API and permitted
on iOS; the Local Network privacy prompt applies to LAN and Bonjour traffic, not
to loopback. If a future feature discovers the desktop app over the LAN, that
changes: it needs `NSLocalNetworkUsageDescription` and Bonjour service types, and
is a different review conversation
(<https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy>
— note this page is JavaScript-gated and could not be read by a text fetcher on
2026-09-29; re-read it in a browser before relying on the LAN case).

---

## 4. Privacy

### 4.1 Privacy nutrition labels (App Store Connect)

Required to submit a new app or an app update. Definitions from
<https://developer.apple.com/app-store/app-privacy-details/> (read 2026-09-29):

> "**Collect** refers to transmitting data off the device in a way that allows
> you and/or your third-party partners to access it for a period longer than what
> is necessary to service the transmitted request in real time."

That definition is the whole analysis for this app, and it produces an
unusually good answer:

| Data | Does the app collect it? | Why |
| --- | --- | --- |
| Transcript text, tool output, file paths, code the agent writes | **No** | It travels from the user's own computer, through the user's own relay/tunnel, to the user's own device. It is not transmitted *to us* and we cannot access it. |
| Relay password / tunnel credentials | **No** | Stored in the device keychain; used to authenticate to the user's endpoint. |
| Radient account identifier (name, email) | **Yes — linked to the user** | Obtained from the Radient token endpoint at sign-in, used to list the user's tunnels. Disclose as Identifiers / Contact Info, purpose App Functionality. |
| Crash logs, diagnostics | **Only if we add a crash reporter** | Do not add one. Apple's own collection does not fall on us. |
| Usage analytics / product interaction | **Only if we add analytics** | Do not add analytics in v1. It converts a clean label into three disclosures and buys little at this scale. |

**Recommendation: ship with the smallest label that is true** — contact info and
user ID for the Radient sign-in path, App Functionality purpose, no tracking, no
advertising, no analytics. Re-read the "optional disclosure" criteria before
deciding a data type is optional: the list is conjunctive ("Data types must meet
all criteria in order to be considered optional for disclosure"), and
"Collection of the data occurs only in infrequent cases that are not part of your
app's primary functionality" is not satisfied by sign-in, which is primary
functionality. Disclose the account identity; do not claim "Data Not Collected"
for the whole app while it holds an account identity.

Apple also requires the privacy policy URL in App Store Connect **and** a link
inside the app — see `docs/publishing/checklist.md` for the candidate URLs and
their status.

### 4.2 Privacy manifest (`PrivacyInfo.xcprivacy`)

<https://developer.apple.com/documentation/bundleresources/privacy-manifest-files>
(read 2026-09-29). One file per app and per third-party SDK, named exactly
`PrivacyInfo.xcprivacy`, with four top-level keys:

- `NSPrivacyTracking` — Boolean. Ours: `false`.
- `NSPrivacyTrackingDomains` — only when tracking is `true`. Ours: empty/absent.
- `NSPrivacyCollectedDataTypes` — must agree with the nutrition labels above.
  Ours: the Radient account identity only.
- `NSPrivacyAccessedAPITypes` — the required-reason API declarations. This is the
  one that fails uploads when it is wrong.

**Required-reason APIs.** Since **2024-05-01**, apps that use a required-reason
API without declaring a reason are "aren't accepted by App Store Connect"
(<https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api>,
read 2026-09-29). The categories and the reason codes this app is most likely to
need, from
<https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype>
(read 2026-09-29):

| Category | Code | When it applies to us |
| --- | --- | --- |
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | Any use of `UserDefaults`/`NSUserDefaults` for our own app's data — session ids, last-selected relay, UI state. Almost certainly needed. |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1`, `3B52.1` | Only if the app stats files it stores in its container, or files the user picked. `C617.1` covers the app container. |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | Only if the app measures elapsed time with `mach_absolute_time()` for timers or reconnect backoff. A reconnect-with-backoff implementation plausibly does. |
| `NSPrivacyAccessedAPICategoryDiskSpace` | `85F4.1`, `E174.1` | Only if the app reads free space. Avoid. |
| `NSPrivacyAccessedAPICategoryActiveKeyboards` | — | Not applicable. |

Each entry is a dictionary with `NSPrivacyAccessedAPIType` and
`NSPrivacyAccessedAPITypeReasons`. The reasons are binding: the declared reason
constrains what the data may be used for, and `CA92.1` for example "does not
permit reading information that was written by other apps or the system".

**How to get this right instead of guessing:** generate Xcode's privacy report
from the archive (Product → Archive → Generate Privacy Report). It aggregates the
app's declarations and every SDK's. The manifest should be written from that
report, and the report should be attached to the release PR as evidence. Do not
hand-write the list from this table.

### 4.3 Third-party SDK requirements

<https://developer.apple.com/support/third-party-SDK-requirements/> (read
2026-09-29): SDKs on Apple's published list **must** ship a privacy manifest, and
**signatures are required where they are used as binary dependencies**. The list
is long and includes the usual suspects (Alamofire, Firebase*, GoogleSignIn,
Lottie, OneSignal, RealmSwift, SDWebImage, SnapKit, …) plus the Flutter/React
Native/Capacitor bridges (`Flutter`, `Capacitor`, `hermes`, `React*`-adjacent
entries such as `hermes`, `path_provider*`, `shared_preferences_ios`,
`connectivity_plus`, `device_info_plus`, `url_launcher_ios`, `webview_flutter_wkwebview`,
`file_picker`, `geolocator_apple`, `image_picker_ios`, `package_info_plus`,
`share_plus`, `video_player_avfoundation`, `wakelock`, `sqflite`, `Starscream`,
`Kingfisher`, `SnapKit`, …). "Any version of a listed SDK, as well as any SDKs
that repackage those on the list, are included in the requirement."

**This is a toolchain decision, not a publishing chore, and it should be fed into
the ADR in `docs/adr/`.** A React Native or Flutter build pulls in several listed
SDKs by default; each one must be manifest-complete and (as a binary dependency)
signed. A Swift/SwiftUI app with no third-party SDKs has an empty problem. That
asymmetry is a real input to the toolchain choice, and it is cheaper to weigh now
than to discover at upload.

### 4.4 App Tracking Transparency

Not applicable, and it should stay that way: the app does not track. If analytics
or attribution is added later, ATT becomes mandatory for tracking across apps and
websites and the nutrition labels change with it
(<https://developer.apple.com/app-store/app-privacy-details/>).

### 4.5 Accessibility Nutrition Labels

<https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels>
(read 2026-09-29): voluntary today, "over time, you'll be required to share
accessibility support details to submit new apps and app updates to the App
Store." Labels are claimed per device for VoiceOver, Voice Control, Larger Text,
Dark Interface, Differentiate Without Color Alone, Sufficient Contrast, Reduced
Motion, Captions, Audio Descriptions. They appear on the product page on iOS 26+
and later.

Not blocking, but cheap to be ready for, and directly relevant to a transcript
UI: VoiceOver on a streaming transcript, Dynamic Type up to 200%, and a dark
interface are all claims the design system in `design/` should be able to make
truthfully. Treat the label list as an acceptance checklist for the transcript
screen, and claim nothing until it has been driven with VoiceOver on a device.

---

## 5. Export compliance

<https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations>
and
<https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance>
(read 2026-09-29).

- Every upload is subject to US export law if it is distributed outside the US and
  Canada, regardless of where the developer is.
- Set `ITSAppUsesNonExemptEncryption` in the Info.plist to skip the encryption
  questions on every submission. Set it to `NO` only if the app uses no
  encryption **or only exempt forms**.
- "Typically, the use of encryption that's built into the operating system — for
  example, when your app makes HTTPS connections using `URLSession` — is exempt
  from export documentation upload requirements, whereas the use of proprietary
  encryption is not."

**Our case.** TLS via `URLSession` is exempt. The question is whether anything
else is in the binary: the keychain (OS-provided, exempt), any custom crypto
(none), and any third-party library that implements its own cipher or TLS stack
(decide per dependency — this is another reason the SDK count matters).
The keychain is exactly the kind of thing where "we only use the system's
crypto" has to be true of every dependency, not just our code.

**Recommendation:** `ITSAppUsesNonExemptEncryption = NO` once the dependency list
is verified clean, and keep the check in CI (a build step that fails when a new
binary dependency appears would be ideal but is not required). If a non-exempt
dependency ever enters, the app needs an annual self-classification report to BIS
or a CCATS classification — the doc above links the BIS reporting page.

France is a separate import/export regime worth knowing about if distribution
includes it: "The main items of control for France are Secure Storage, Secure
Communications, and Security Anti-Virus applications." A secure-storage app is
arguably in scope; re-read that page before shipping to France at scale.

---

## 6. Age rating

**The system changed in 2026 and the answers are now required.**

- Since **2026-01-31**, ratings across the App Store were recalculated under the
  new system; developers were required to answer the updated questionnaire
  "to avoid an interruption when submitting your app updates"
  (<https://developer.apple.com/news/upcoming-requirements/?id=07242025a>, read
  2026-09-29).
- Since **September 2026**, the questionnaire's new social-media questions are
  required when submitting new apps or updates
  (<https://developer.apple.com/news/?id=07242025a>-adjacent item, "Age rating
  questionnaire now includes social media questions", 2026-07-09, read
  2026-09-29).
- Categories are now content descriptors, in-app controls, and **capabilities**:
  Parental Controls, Age Assurance, Unrestricted Web Access, User-Generated
  Content, Social Media, Social Media Disabled for Users Under 13, Messaging and
  Chat, Advertising; plus mature themes, medical/wellness, sexuality, violence,
  chance-based activities
  (<https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions>,
  read 2026-09-29).

**Answers for this app, and why each is defensible:**

| Question | Answer | Reasoning |
| --- | --- | --- |
| Unrestricted web access | **No** | There is no embedded browser for general browsing. Links open in the system browser. The sign-in web session is authentication, not browsing. Note that claiming "Yes" pulls the rating to 16+. |
| User-Generated Content | **No** | "the broad distribution of content created by users as a component of the app's intended user experience" (§ 3.7 above). Single-tenant; nothing is distributed. |
| Social Media | **No** | No feed, no amplification, no interaction with others' content. |
| Messaging and Chat | **No** | The transcript is a conversation with an agent on the user's own computer, not with another person. |
| Advertising | **No** | No ads, none planned. |
| Everything else | **No** | No violence, sexuality, gambling, substances, medical content. |

Expected rating: **4+** on the new scale, assuming the app genuinely has no
unrestricted web access and the transcript UI does not surface the agent's raw
output in a way that would qualify as user-generated content distribution. If the
transcript can display arbitrary content the *user's computer* produced — which it
can — that is not a rating input, but it is why parental-controls-adjacent claims
should stay out of the store copy.

**Regional overlays to expect** (same reference page):

- **France**: a 17+ Apple global rating displays an additional 18+ regional rating.
- **Australia, Korea**: extra regional ratings for games and simulated gambling.
  Not applicable, but the mechanism exists and the app's category matters.
- **Brazil**: MJSP-issued ratings update the app's regional rating.
- **Texas**: since a court ruling lifted an injunction on **SB 2420**, the law
  applies (Apple's notice of **2026-06-03**, effective **2026-06-04**): age
  assurance and parent/guardian consent for minors under 18 for downloads,
  in-app purchases, and "significant changes", with revocation and a server
  notification. Developers get age category data through the **Declared Age
  Range API** and use the **Significant Change API** under PermissionKit
  (<https://developer.apple.com/news?id=sg176nne>, read 2026-09-29).
- **Utah, Louisiana, Brazil, Australia, Singapore** have comparable age-assurance
  obligations; Apple's tools were updated in beta on **2026-02-24**
  (<https://developer.apple.com/news/>, "Age requirements for apps distributed in
  Brazil, Australia, Singapore, Utah, and Louisiana", 2026-02-24, read
  2026-09-29).

**What this means for us.** The app has no meaningful age-gated content and no
purchases, so the practical obligation is small — but "significant change" is a
developer judgement, and shipping a new feature that changes what the app does
for a minor's approved app on a Texas device is a case Apple asks us to decide.
Assign it to whoever owns the release checklist (see `docs/publishing/checklist.md`),
rather than assuming it never applies.

---

## 7. European Union: DSA trader status

<https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/>
(read 2026-09-29).

- **Since 2025-02-17, apps without trader status are removed from the App Store
  in the EU** until trader status is provided and verified
  (<https://developer.apple.com/news/upcoming-requirements/?id=02172025a>).
- Every developer must declare trader status, even if they do not distribute in
  the EU.
- The declaration requires contact information (address, phone, email) that Apple
  **publishes on the product page** in all 27 EU territories, verified by 2FA on
  both email and phone, plus documentation proving the business name and address.
- The DSA definition: a trader is anyone acting "for purposes relating to his or
  her trade, business, craft or profession". Radient Inc. sells a paid tunnel
  service and is plainly a trader. Declaring "not a trader" is not an option if
  the app is monetised in any way, and would also tell EU consumers that consumer
  protection law does not apply.
- Additional EU business terms take effect **2026-10-01** (Attachment 14 of the
  Developer Program License Agreement): adjusted commission rates, the Core
  Technology Commission replacing the Core Technology Fee, apps allowed to offer
  alternative payment options alongside Apple In-App Purchase, and expanded
  qualifications for alternative marketplaces
  (<https://developer.apple.com/news/>, "Changes for apps in the European Union",
  2026-08-18, read 2026-09-29).

**Decision: declare trader status for Radient Inc., and budget for the contact
details being public.** This is an operator decision only in the sense that
someone has to supply a verifiable business address; the declaration itself is
not optional.

---

## 8. Device support

### 8.1 iPad

- Guideline 2.4.1: "iPhone apps should run on iPad whenever possible. We
  encourage you to consider building apps so customers can use them on all of
  their devices."
- Screenshot requirements make this concrete: 13" iPad screenshots are
  **"Required if app runs on iPad"**, and if the app runs on iPhone but 6.9"
  screenshots are provided, 6.5" is not required
  (<https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications>,
  read 2026-09-29).

**Recommendation: support iPad properly.** A transcript-plus-composer layout is
better, not worse, on a bigger screen, and the alternative — an iPhone-only app
running letterboxed — is a worse product and an extra reviewer conversation. If
iPad is supported, its screenshots are mandatory; budget for capturing them.

### 8.2 Mac and Apple Vision Pro ("Designed for iPad")

Apple's submission page states that "Most iPadOS and iOS apps can run unmodified
on Apple Vision Pro and on Mac computers with Apple silicon", and that
"By default, your compatible apps are published automatically on the App Store
for Apple Vision Pro or Mac using the metadata you've already provided"
(<https://developer.apple.com/app-store/submitting/>, read 2026-09-29).

**Decision required.** Default-on means the app appears on the Mac App Store as
an iPad app with no work and no separate review, and it will be *bad* there: a
phone layout in a desktop window, reaching a relay that is running on the same
machine, competing with the desktop app the user already has. Turn it off
deliberately (Manage availability) unless someone wants to ship an "app on the
same Mac as the relay" experience. Whatever the answer, make it a decision with a
line in the release checklist, not a default nobody looked at.

---

## 9. Assets

### 9.1 App icon

- **Icon Composer in Xcode** is the current tool: "You can create your app icon
  using Icon Composer or add your app icon to an asset catalog within your Xcode
  project" (<https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon>,
  read 2026-09-29).
- Sizes and design rules
  (<https://developer.apple.com/design/human-interface-guidelines/app-icons>, read
  2026-09-29): iOS/iPadOS/macOS icons are **1024×1024** square, layered —
  a background layer plus one or more foreground layers — and take on Liquid
  Glass "specular highlights, refraction, and translucency". Give square layers
  and let the system mask; "Providing layers with pre-defined masking negatively
  impacts specular highlight effects and makes edges look jagged."
- **Appearances**: default, dark, clear (light and dark), tinted (light and dark).
  The system generates variants you do not provide, but "Keep your icon's
  features consistent across appearances" and "Use your light app icon as the
  basis for your dark icon." Alternate app icons each need their own variants.
- Do not bake in specular highlights, drop shadows, bevels, blurs or glows — the
  system supplies them and custom ones conflict.
- HIG page history confirms the current guidance is the **2026-06-08** revision,
  "Refined guidance for Liquid Glass".
- Existing brand assets that seed this: `docs/assets/brand/` in this repository,
  plus `local-operator-ui/resources/*` and the site's favicon/apple-touch-icon set.
- **Nothing on the icon is a hard blocker, but the layered-source requirement is
  real**: a flat 1024 PNG works ("Although you can provide a flattened image for
  your icon, layers give you the most control"), so the brand kit in `design/`
  should aim for layers rather than a flat export if time allows.

### 9.2 Screenshots

From
<https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications>
(read 2026-09-29): **one to 10** screenshots per size, `.jpeg`/`.jpg`/`.png`,
**no alpha channel or transparency**.

| Slot | Sizes | Required? |
| --- | --- | --- |
| iPhone 6.9" (iPhone Air, 18 Pro Max, 17 Pro Max, 16 Pro Max/Plus, 15 Pro Max/Plus, 14 Pro Max) | 1260×2736, 1290×2796, or 1320×2868 (portrait) | Provide this and 6.5" is not required |
| iPhone 6.5" | 1284×2778 or 1242×2688 | "Required if app runs on iPhone and screenshots for 6.9" display aren't provided" |
| iPhone 6.3" (17 Pro, 17, 16 Pro, 16, 15 Pro, 15, 14 Pro) | 1179×2556 (portrait) | optional |
| iPhone Duo | 1398×2034 (outer), 2007×2853 (inner) | "Support for uploading assets for this device in App Store Connect will be available later this year" |
| iPad 13" (Pro M5/M4, Air M4/M3/M2) | 2064×2752 or 2048×2732 (portrait) | **Required if app runs on iPad** |
| iPad 11" | 1488×2266, 1668×2420/2388, 1640×2360 | optional (falls back to 13") |
| Mac | 1280×800, 1440×900, 2560×1600, 2880×1800 (16:10) | Required for Mac apps |
| Apple TV / Vision Pro / Watch | — | Not applicable |

**Practical plan:** capture at **6.9"** (1320×2868 covers the current Pro Max
class) and **iPad 13"**, in **light and dark**, from the demo mode. Roughly four
to six shots: session list with a live session; a streaming transcript with a
tool call expanded; an approval card; the composer with the model sheet open;
past sessions with search. Fewer, better shots beat eight screenshots of the same
screen.

**Capture method on this project's machines.** There is no Xcode and no simulator
here (`AGENTS.md`, "Build host assumptions"). Screenshots of the real app
therefore come from CI (a simulator job that drives the UI and saves
`screenshot`s), or from a contributor with a Mac. Do not fake them with a WebView
render — 2.3.3 requires screenshots of the app in use.

### 9.3 App previews

Optional; video screen captures of the app only, up to three per localization per
device size, with narration and overlays allowed
(2.3.4; preview specs at
<https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications>).
Good candidate for a later pass: a 20-second capture of an approval arriving and
being answered is the single clearest explanation of what this app is. Not
required for launch.

### 9.4 New product-page assets (fall 2026)

Apple is adding product-page header and search-result assets
("Get ready for new creative assets on the App Store", **2026-08-05**, read
2026-09-29), with templates and best practices. Optional, but it is the cheapest
discoverability work available for a niche developer tool, and the design kit
already produces the kind of imagery they want. Out of scope for this stream.

---

## 10. TestFlight

<https://developer.apple.com/testflight/> (read 2026-09-29):

- Up to **100 builds** at a time, multiple builds testable at once.
- **Internal testers**: up to 100 team members with Account Holder, Admin, App
  Manager, Developer, or Marketing roles. Can auto-distribute new builds.
- **External testers**: up to **10,000**, invited by email or a **public link**
  (with criteria such as device type and OS version). **The first build must be
  approved by App Review for TestFlight**; builds are submitted for review
  automatically once added to a group, and "Significant updates to your beta
  build should be submitted to TestFlight App Review before being distributed".
- Testers can use up to 30 devices; screenshots and crash feedback come back
  through the TestFlight app.
- Guideline 2.2: "Demos, betas, and trial versions of your app don't belong on
  the App Store — use TestFlight instead." Apps using TestFlight "cannot be
  distributed to testers in exchange for compensation of any kind".
- Beta builds also need export compliance answered for the build
  (<https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds>).

**Practical consequence for review-access (§ 3.1):** TestFlight is how the demo
mode and the review notes get exercised *before* the first App Review
submission. Put the reviewer-facing demo build in external TestFlight, have
someone who has never seen the app open it cold, and only then submit.

---

## 11. Submission and release mechanics

- **Phased release** (iOS/macOS/tvOS): 1% / 2% / 5% / 10% / 20% / 50% / 100%
  over seven days to users with automatic updates; anyone can still download the
  new version manually; pausable for a total of 30 days; removed on
  stop-sale or membership lapse
  (<https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases>,
  read 2026-09-29). Available for version updates, not the first release.
  **Use it for the first few releases of a client that people depend on to reach
  a machine they are not sitting at.**
- **Review notes field**: up to **4,000 bytes**, any language; must include
  specific descriptions of new functionality (2.3.1(a)) and the demo-account or
  demo-mode explanation (2.1)
  (<https://developer.apple.com/help/app-store-connect/reference/app-information/app-information>).
- **App Review Information** also carries a contact (name, email, phone in
  international format) and an optional attachment.
- Metadata field limits, all from the same two reference pages:
  name 30, subtitle 30, keywords 100 **bytes** (each keyword longer than two
  characters), promotional text 170, description 4,000, "What's New" 4,000
  (required for updates, not the first version), copyright required.
- **Timing:** review status is visible in App Store Connect; a future release date
  holds the app back even after approval; "it can take up to 24-hours for your app
  to appear on all selected storefronts".
- **Bug-fix submissions**: for an already-shipped app, "bug fixes will not be
  delayed over guideline violations except for those related to legal or safety
  issues" — ask for that process in App Store Connect rather than waiting.

---

## 12. Where this leaves the submission

Blocking, in order:

1. **Account deletion does not exist** (§ 3.5) — needs a Radient-side change
   before either store. This is the programme's critical path.
2. **Demo mode** (§ 3.1) — without it, 2.1 and 2.3.3 cannot be satisfied. It is
   also the fixture source for screenshots and the UX harnesses.
3. **Bundle ID and organization enrollment** (§ 1) — the D-U-N-S number has a
   lead time.
4. **Privacy manifest generated from Xcode's report** (§ 4.2), with the
   required-reason codes decided by what the code actually calls.
5. **Export compliance declared** (§ 5), `ITSAppUsesNonExemptEncryption` set,
   dependency list verified.

Needs an operator decision (stated as a decision, with what would change it):

- **Whether to offer Sign in with Apple.** Recommendation: no — the 4.8
  exemption plausibly applies and the app also works with no Radient account at
  all. Change it if App Review pushes back, or if the account system ever stops
  being Radient's own.
- **Whether the app appears on the Mac App Store** as a "Designed for iPad" app.
  Recommendation: turn it off; it is a bad fit while the relay runs on that same
  Mac.
- **Whether iPad is supported.** Recommendation: yes; it costs a layout and buys
  a better product, and the screenshots are mandatory if the answer is yes.
- **Whether to declare trader status for Radient Inc.** Recommendation: yes,
  which makes a verifiable business address public on the EU product page.
