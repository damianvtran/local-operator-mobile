# Push setup — the operator's console work, and the slices that follow

Two halves, and the boundary between them is the whole point of this file:

1. **Operator steps** — console work a human with account access must do, in Google Cloud and in
   Apple's developer console. Nothing here can be done by an agent, and nothing here is done yet.
2. **Implementation steps that follow** — the code. **None of it is implemented**, in any
   repository, at any layer.

Read beside [ADR 0006](../adr/0006-push-and-ack-sync.md), which carries the reasoning this runbook
executes, and [`docs/push-plan.md`](../push-plan.md), which carries the slice table and owners.
The cloud lane's operational note is [`docs/push-cloud-ops.md`](../push-cloud-ops.md); this file is
the setup path, and where the two meet the note governs operations and this one governs first-time
setup.

## The decision this runbook implements

**Operator, 2026-10-29: allow FCM only — add Firebase to the EXISTING Radient Google Cloud project
for push.** On every other axis the answer is no: state stays in MongoDB Atlas, Google sign-in stays
the Google Cloud project + Identity Toolkit, Microsoft sign-in stays the Azure tenant, and there is
**no Firebase database, auth or hosting**. The Firebase involvement is exactly three things — a
`firebase:enabled` label on the project, shared IAM and billing (Blaze if the project is billed),
and an FCM send credential the cloud holds. iOS push is APNs directly, with a `.p8` key held by the
cloud and never by the app.

Two facts survived the decision and are not softened by it, because they are why it was a decision
at all: **Android background push arrives via FCM through Play services** (ADR 0006 §5), and
**using FCM requires registering the Google Cloud project with Firebase**. Accepting the ADR
settles the transport; it does not build it.

---

## Part 1 — Operator steps

Three artefacts come out of Part 1, and every later step depends on them:

| Artefact | Comes from | Held by | Never in the repository |
| --- | --- | --- | --- |
| `firebase:enabled` on the project | Firebase registration | Google Cloud project | — (a label, no file) |
| APNs `.p8` + its **key id** and **team id** | Apple developer console | the cloud's secret store | the `.p8` file, always |
| FCM service-account **JSON key** | Google Cloud console | the cloud's secret store | the JSON, always |

### 1. Register Firebase on the existing Google Cloud project

**Where.** Either path reaches the same state:

- Firebase console (<https://console.firebase.google.com>) → **Create a project** → in the project
  setup, pick the **existing Google Cloud project** rather than letting it mint a new one; or
- Firebase CLI: `firebase projects:addfirebase <PROJECT_ID>`, which the CLI reference describes as
  adding "Firebase resources and enables Firebase services in an existing Google Cloud project"
  ([Firebase CLI reference](https://firebase.google.com/docs/cli), read 2026-10-29; the console route
  is the same operation by hand).

**What to name it.** Nothing — the project keeps its existing name, project ID and project number.
Do **not** create a second project for push: the decision is "the existing project", and a second
one would split IAM, billing and the credential story for no gain.

**What changes, and it is only this.** Firebase "automatically adds to your project a label of
`firebase:enabled` within the IAM & Admin > Labels page of the Google Cloud console"; "IAM
permissions and roles for the project are shared across Firebase and Google Cloud … Any access a
project member (that is, a principal) has to your Google Cloud project will also apply to your
Firebase project (and vice-versa)"; and "If billing is enabled on your Google Cloud project, then
your Firebase project will be on Firebase's pay-as-you-go Blaze pricing plan" ([Understand Firebase
projects](https://firebase.google.com/docs/projects/learn-more), read 2026-10-29). Billing is
**shared, not new** — the project's existing billing account now also covers Firebase, and the FCM
send quota is what that buys.

**What proves it took.** Google Cloud console → **IAM & Admin → Labels** shows `firebase:enabled`
on the project. Nothing else on the project's data, identity or hosting surface changes, and no
Firebase product is enabled by this step: enabling one (Firestore, Auth, Hosting, Functions) is what
the decision forbids, so treat any such prompt as a thing to decline.

**Never committed.** Nothing — but the registration is what makes step 3's credential possible, so
record in the change ticket *when* it was done and by whom, because the label is the only audit
trail Google gives it.

### 2. Create the APNs `.p8` key, and record its key id and team id

This is iOS's send credential. It is separate from FCM: **APNs is not routed through Firebase** in
this design (ADR 0006 §5), so a project with no iOS traffic still needs this key the day iOS push
ships.

**Where.** Apple developer console → **Certificates, Identifiers & Profiles → Keys → the add
button (+)**, then choose **Apple Push Notification service (APNs)** and configure the key
([Create a private key to access a service](https://developer.apple.com/help/account/keys/create-a-private-key/),
read 2026-10-29). The required role is **Account Holder or Admin** — a developer-role account
cannot see the Keys section, which is the usual reason this step stalls.

- **Key type: Team Scoped.** The ADR records why this is not a choice worth making the other way:
  an APNs key "is **team-scoped by design** — one key sends to *any* app in that Apple Developer
  team — so the only scoping is `apns-topic` fixed to the bundle id" (ADR 0006 §5;
  [`docs/push-cloud-ops.md`](../push-cloud-ops.md) § 5). It is one key for the team, not one per app.

**What to name it.** A name that says what it is and who holds it, e.g. `Radient cloud push`. The
name is cosmetic; the **Key ID** is not, and Apple shows it on the key's detail page.

**What artefact results.** A text file with a `.p8` extension, plus two identifiers that must be
recorded beside it:

- the **Key ID** (from the key's detail page);
- the **Team ID** (from **Membership details** in the same console).

Apple offers the file at creation. **Download it then, store it, and treat a lost key as a
rotation** rather than as a recoverable one: the console does not hand the same key out twice.

**The capability and the entitlement are a different thing, and they belong to the app id.** The
key is the *sender's* credential; whether an app may *receive* is decided by its App ID and profile:
enable **Push Notifications** on the bundle's App ID (Identifiers → the App ID → Capabilities), which
is what puts the `aps-environment` entitlement into the provisioning profile the build signs with.
The ADR reads the entitlement as build configuration, not a console secret: the Expo config plugin
sets it to `development` and Xcode flips it to `production` in an archive, with
`UIBackgroundModes: remote-notification` for the background wake (ADR 0006 §5, "Capability and
account work, per store"). **So: do not add the `.p8` to the app, and do not make the app id's
capability depend on it** — they are unrelated artefacts that happen to share a console.

**Never committed.** The `.p8` itself, its contents, and the key id/team id **as a pair alongside a
live key**. `.p8` and `.p12` are called out by name in [`AGENTS.md`](../../AGENTS.md) § "Secrets and
personal data" ("Never commit tokens, passwords, API keys, signing keys, keystores (`*.jks`,
`*.keystore`), certificates (`*.p12`, `*.p8`)"). Key id and team id alone are non-secret
identifiers, and the ADR's credential row treats them as part of the credential
(`Credentials` row, §2.2) — keep them with the key, in the store, not in this repository.

### 3. Create the FCM send credential, and put it in the cloud's secret store

**Where.** Google Cloud console → **IAM & Admin → Service Accounts → Create service account**, in
the project step 1 registered.

**What to name it.** A name that cannot be mistaken for a user or a runtime identity, e.g.
`fcm-send`. The email it gets is the identity the cloud authenticates as.

**The role.** **Firebase Cloud Messaging API Admin** (`roles/firebasecloudmessaging.admin`), granted
on the project in **IAM & Admin → IAM**. Google's own page for the send path assigns exactly this
role: "In the target project, assign the Firebase Cloud Messaging API Admin role to the email
address for the service account" ([Send a message using FCM HTTP v1
API](https://firebase.google.com/docs/cloud-messaging/send/v1-api), read 2026-10-29). **Nothing
else.** The account sends and nothing more — no storage, no datastore, no Firebase management role —
which is what keeps "allow FCM only" true at the IAM layer and not just on paper. The ops note
states the same restriction operationally: "The FCM account *is* scopeable, to the send role only"
([`docs/push-cloud-ops.md`](../push-cloud-ops.md) § 5).

**What artefact results.** A **JSON key**: on the service account → **Keys → Add key → Create new
key → JSON**. The file that downloads is the credential.

**Where it goes.** The cloud's secret store — **not** this repository, and **not** CI. Both halves
of that are already decided in-repo: "The APNs `.p8` and the FCM service account live in the
platform's secret store, readable only by the worker's runtime identity, with audited break-glass;
the app build needs only the client config files, so CI holds neither"
([`docs/push-cloud-ops.md`](../push-cloud-ops.md) § 5, quoted by ADR 0006 §5). Record the secret's
**name** and which runtime identity may read it in the change ticket; the requirement is *readable
only by the worker's runtime identity, with audited break-glass*, and the store's own mechanism for
that is the store's business.

**Never committed.** The JSON file itself, in any form — raw, a base64 blob, an environment variable
pasted into a workflow, a log line, a screenshot or a pull-request comment. It goes into the secret
store and nowhere else: this key can send push to every user of the app, so a copy outside the store
widens the blast radius the ops note already records as team-wide.

**On secret names: this repository names none, and that is deliberate.** [`docs/ci.md`](../ci.md)
enumerates the **release** environment's secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_*`,
`PLAY_SERVICE_ACCOUNT_JSON_BASE64`, …) and none of them is a push credential — the FCM key and the
APNs key are the cloud's, and CI holds neither (above). The Android build input the ADR requires,
`google-services.json`, "from a CI secret — never committed" (ADR 0006 §5), becomes a CI secret only
when the Android app slice lands: **name it then, in `docs/ci.md`, with the slice that needs it.**
Do not invent a name here for a file no workflow reads yet, and do not add one to
`scripts/ci/check-secrets.ts` in advance of the job that requires it.

### What is deliberately *not* on this list

- **No new Google Cloud project.** The decision is the existing one.
- **No Firebase app registration for the iOS build.** APNs is direct; a Firebase iOS app would add a
  `GoogleService-Info.plist` the app does not need and a second path to the same device.
- **No `google-services.json` in the repository.** It arrives by slice (Part 2), from CI, when the
  Android app code that reads it exists.
- **No Firebase data product of any kind** — no Firestore, Realtime Database, Firebase Auth or
  Hosting. A prompt to enable one is a prompt to decline.
- **No credential in the app, ever.** The `.p8` and the service-account JSON are the cloud's; the
  app's own registration token is the only push artefact the app holds.

---

## Part 2 — Implementation steps that follow

**Every item below is unimplemented.** They are listed so the operator steps above have a
destination, not to describe code that exists. Slice ids, owners and exit criteria are
[`docs/push-plan.md`](../push-plan.md)'s; this section says what each one is and that it is not
built.

### 2.1 Daemon-side worker — **unimplemented** (core; `local-operator`)

The worker the ADR specifies: a cursor-bearing process on the machine that watches the attention
store for the three delta reads, composes the payload (**the machine is the only composer**), and
emits on the frozen route with a content-derived idempotency key, retrying three times over ~2
minutes on the same key and dropping with one log line. It owns the persisted `emit_id` for a
digest window and it never writes the delivery/claim tables (ADR 0006 §2.1, §3.4; `attention.py`
paths are pinned there). **Nothing in `local_operator/**` implements this today.**

### 2.2 Cloud-side accept / queue / fan-out — **unimplemented** (Radient; proposal, no repository access)

The three routes and the machinery behind them: forward-registration ingest, event ingest that
validates and enqueues and answers **`202 {emit_id, accepted_at}`** (never a synchronous per-device
result), the durable queue and its worker, fan-out to APNs/FCM, the 14-day delivery record, the
tombsstone-on-revocation row behaviour, the account-side revoke surface, the credential heartbeat,
and the grant's life (ADR 0006 §3.1; [`docs/push-cloud-ops.md`](../push-cloud-ops.md) § 3). The
cloud **composes nothing** — no payload class of its own, no alert text, no `aps.badge`. Every route
here is marked *(proposal)* in the ADR because this repository cannot read that code: **it is not
implemented anywhere this repository can see.**

### 2.3 Client registration and permission flow — **unimplemented** (this repository)

The in-app half: request the notification permission at the moment the user asks for notifications
rather than at launch, obtain the device token from APNs or FCM, register it with the cloud for the
computer the app is paired to, re-register on rotation, surface the per-device state the ADR defines
(five states with the shared precedence, §4), and read the machine on every open so a push is never
the source of truth. Includes the Settings → Notifications surface ADR 0006 § "Amends" describes as
*a specification to build* — no such surface exists on `main`, and quiet hours and "when a session
needs a decision" are not shipped in v1. **No registration, permission or notifications module exists
in `src/` today.**

### 2.4 FOSS flavour without the notifications module — **unimplemented** (this repository)

A build flavour that compiles the notifications module out entirely, so a distribution with no
Google Play services and no Firebase linkage ships from the same tree. ADR 0006 §5 makes it a slice
with its own build and an exit criterion of its own ("CI proves the default flavour is the only one
with the module"); the app must state plainly that notifications need the Radient login (§2.4,
`docs/publishing/other-channels.md`). **No flavour, build flag or module boundary for this exists
today.**

---

## How to read the state of this work

- **Decided:** the transport, and the boundary of Firebase's involvement — ADR 0006, Status
  **Accepted (2026-10-29)**.
- **Done:** nothing in Part 1 and nothing in Part 2. The three artefacts are console work the
  operator has not done; the four slices are unstarted.
- **The gate to watch:** the ADR's own words, unchanged by acceptance — a green build proves the app
  still builds, and only an exercised push (an event on a real machine reaching a real device, and
  the machine still authoritative when the push is late or absent) proves the feature. That test does
  not exist yet either.
