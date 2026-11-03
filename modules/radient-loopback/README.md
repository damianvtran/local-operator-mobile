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

Source/JS tests are not native proof. Successful compilation, rendered interaction,
independent review/QA/UX/design and native receipts are required before claiming
cross-platform sign-in works. This implementation does not publish to Google Play.
