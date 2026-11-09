# Device-local OAuth callback transport

Radient's existing `lop` registration permits explicit-port HTTP loopback redirects.
Neither an iOS custom-scheme session nor an Android Custom Tab can be assumed to
intercept those redirects. These adapters bind a real literal `127.0.0.1` listener
before the authorization URL is constructed; authorization and token exchange use
the **same** resulting ephemeral-port redirect. PKCE and state remain owned by the
shared connection layer. No OAuth-server registration or external bounce is added.

## Android lifecycle and security contract

- `prepare(copy)` binds the listener and starts the five-minute attempt deadline.
  The keyed, currently resolved copy contains `received`, `returnLabel`, `invalid`
  and `direction`; no account, code or state belongs in it.
- `open(authorizeUrl, redirectUri)` validates the prepared redirect/state and opens
  a real installed Custom Tabs provider through a non-exported management activity.
  No provider is an explicit failure; it never falls back to an embedded WebView.
- The parser accepts only `GET`, the exact literal Host/port and `/callback`, a
  single matching state, and a code/error. It never reflects the request query.
  Admission is serialized with cancellation so a late request cannot resurrect
  an abandoned attempt. Headers are bounded to 4096 bytes; at most eight peers
  are admitted to two workers. Each connection has both an idle timeout and an
  absolute five-second lifetime, including time queued before a worker reads it.
- A matching callback closes the listener immediately, even if the browser
  disconnects before reading its response. The validated result stays in memory
  until browser return, explicit cancellation, activity destruction or deadline.
  A rejected peer does not consume the attempt. Cleanup is idempotent.
- The tab is launched without `NEW_TASK`. Automatic same-task `CLEAR_TOP` return
  is attempted, but Android/browser background and cross-UID rules can restrict
  it. The completion page therefore offers a localized **Return to Local Operator**
  user gesture. Its package-targeted `intent://oauth-return` control contains
  **no code, state, token or account**. The exported return activity cannot supply
  an auth result: only the previously validated in-memory flow can do that.
  `Referrer-Policy: no-referrer` and HTML escaping apply to the completion page.
- Back/X before an accepted callback is cancellation. Timeout, module destruction
  and management-activity destruction close sockets, workers and state. Process
  restoration cannot reconstruct PKCE/state and never relaunches a stale attempt.

Only iOS and Android have native adapters. Other native platforms fail explicitly;
the existing web-client surface is separate and is not a claim that browser JS can
bind a phone's loopback port.

## Hosted acceptance, not local SDK installation

The Android proof is manual-only. Run it **after the iOS callback proof settles**
and within the release owner's native-job allocation:

```sh
gh workflow run android.yml --ref feat/android-oauth-callback -f oauth_callback_proof=true
```

The existing dispatch entry calls `android-oauth-callback-proof.yml` from that ref
and suppresses the ordinary duplicate Android build job. No signing environment
or secrets are inherited. The exact on-emulator command is:

```sh
bash scripts/ci/android-oauth-callback-proof/run.sh
```

The workflow compiles the actual app's debug APK (only Android's ephemeral debug
key; no distribution signing/Play credentials), verifies debug controls are absent
from the **built Release manifest**, and records an installed Custom Tabs provider
and its version. It does not download an arbitrary browser APK. Chrome first-run
setup and Maestro cold start precede every explicit Ready → Start handshake.

The debug-only provider/activities exercise the production Kotlin source: hostile
Host, oversized input, absolute slow-drip timeout, browser wrong state/path/method/
duplicate state followed by a valid callback, Back cancellation, the unchanged
five-minute timeout, and real management-activity destruction. Late TCP callbacks
must be refused; the original owner must be foreground with no retained auth tab.
Receipts disclose whether the explicit return gesture was used. Every mode retains
native/driver results and rendered frames even on failure; the artifact includes
the APK itself plus hashes. Fixture setup failures are not called product failures.

### Browser lifetime and timeout return

The production adapter binds a real AndroidX Custom Tabs session before launch.
Chrome's `android.support.customtabs.extra.KEEP_ALIVE` contract binds the app's
empty `OAuthKeepAliveService` while its tab covers the owner. This keeps the
loopback receiver and real five-minute deadline runnable; a bare tab has no
client lifetime binding. Chromium's `CustomTabsConnection.keepAliveForSession`
and the GoogleChrome/custom-tabs-client README's Lifecycle section define this
contract. The service must be exported to the browser UID but exposes only an
empty Binder: no auth data, callbacks, commands, extra permissions or foreground
service/notification. Session teardown unbinds; it is not persistent work.

Timeout/success return uses `CLEAR_TOP` on the recorded management activity,
which finishes the tab before releasing its owner. If that activity itself is
externally destroyed, cleanup unwinds to the recorded owner before clearing the
references. The browser's explicit, code-free return link remains a fallback;
its use is disclosed, never substituted for a native timeout pass.

The hosted fixture requires a provider-side `/clicked` receipt, a real image
request for the wrong-state callback, exactly one wrong-state rejection, then
correct top-level navigation. A missed tap is a harness failure. The driver
retains process/logcat evidence and correctly recognises Android16's `Hist  #`
spacing when checking for orphaned auth tabs.

The real-app proof embeds the existing E2E JavaScript in the debug APK and uses
an explicitly asset-loading generated Expo host. JS `dev=false` and native
packager support=false are intentional: Expo57's async-require message socket
rejects an embedded DEV bundle before the application entry executes. Only the
job-generated entry and a temporary copy of the origin-admission helper use the
explicit `EXPO_PUBLIC_ANDROID_EMBEDDED_PROOF=true` define. URL validation remains
unchanged, the original helper bytes are restored after export even on failure,
and a normal Release retains its Debug-only admission guard. Before/after helper
source is archived with the bundle. This does not enable proof hooks in normal
Release builds or require Metro; a runtime asset-URL marker must confirm loading. The proof continues through
token500/Retry, persisted picker and a grant-authenticated populated session list.

Source/JS tests are not native proof. Successful compilation, rendered interaction,
independent review/QA/UX/design and native receipts are required before claiming
cross-platform sign-in works. This implementation does not publish to Google Play.
