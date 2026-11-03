# Dedicated native draft-recovery proof

This is **not** a production launch flag or a member of the global Maestro flow
collection. `.github/workflows/stage-b-draft-proof.yml` generates exactly one
unsigned Release simulator app, `com.localoperator.mobile.stagebproof`, from an
exact PR head. A generated entry installs the synthetic HTTP transport **before**
loading the real Expo router, ConnectionProvider, composer, startup coordinator,
Expo AES, filesystem and SecureStore. Ordinary package/config source stays unchanged.

## Admission and resource boundaries

PR/synchronize runs focused source preflight only. After other native producers
settle, the manager applies `stage-b-native-approved`. Only that labeled event,
the owner actor and a same-repository head admit heavy execution; subsequent
commits require a fresh label. Permissions are read-only. No signing, publishing,
SDK/runtime download, callback-workflow change or production credential is used.
The runner requires preinstalled Xcode/iOS 26 and at least 15 GiB free, bounds
commands/output, reaps exact process groups and deletes its unique owned simulator.
The existing pinned Maestro CLI is provisioned just as in the repository E2E lane.
No local native execution is authorized by the existence of these files.

The Android backup-artifact job runs first. It reuses the normal Android CI debug
APK for the exact PR run head, generates manifest selection without Gradle, and
decodes the **packaged** legacy/cloud/device-transfer resources with preinstalled
AAPT2. A missing/ambiguous rule, SecureStore inclusion or file-domain inclusion
fails admission before the expensive iOS producer. The producer run/artifact
metadata and APK digest are retained. The normal Android PR job may build GitHub's
merge candidate; the generated head manifest and actual selected packaged rules
are explicitly compared. This is not a claim that a release APK was validated.

## Identity and fixture boundaries

Synthetic credentials are written through real SecureStorage APIs; the bootstrap
never supplies an authorization generation, trusted owner, draft, session creation
result or outbox. The real cold restore/mint/provider path must call fixed-origin
`/v1/me`. The wrapper forwards only the enumerated synthetic destinations and
credentials to real loopback sockets, retaining virtual Cookie/Origin, method,
body, cancellation and redirect semantics. Unknown/real requests fail closed.

The fixture covers opaque-token account A, another A access token, real OAuth
refresh, account B, tenant B, another Local Operator destination, 401, malformed
identity, socket failure, redirect and held responses. Successful identity replies
are deliberately cacheable: the client must issue a fresh request and send
`Cache-Control: no-store, no-cache` / `Pragma: no-cache` on the wire. Expo57 does
not forward the `cache` RequestInit field to native URLSession. Redirect target
requests are counted **before** authentication so dropping headers cannot fake a
no-follow pass. Synthetic control endpoints do not exist in the normal app.

Ordinary admission and generation-backed writes do not await this optional
proof. A null proof keeps the exact-route restart generation/outbox intact;
sealed-origin draft records remain provenance-gated. Source restart tests cover
custom, offline Radient, offline-to-online, proven mismatch and hidden cached
imports. The native positive case separately waits for the observed recovery
capability; an editable field alone is not proof readiness. A held-proof frame
now shows the usable ordinary editor, not a blocked auth/loading gate.

## Native observations (expected matrix, not a run result)

The single installed artifact is checked against compiled bundle/source/nonce
metadata and actual JS/native executable digests. Restarts require new native
PIDs. The real UI chooses a computer, types and selects a Photos asset; selection
again after cache removal proves the Photos original remains available.

The runner exercises same-owner expiry recovery, text/images, empty fresh queue
and zero session/command writes; OAuth refresh and an injected native pending
revision; proof failures; editing while proof is held; a real Computers-route
backend switch before a held old response returns; account/tenant isolation;
explicit discard/restart; real UI logout; sentinel loss with an observed surviving
native key; actual uninstall/reinstall with observed Keychain survival; committed
ciphertext corruption; and a real SecureStore wrong-key replacement. Unsupported
OS Keychain-survival behavior is a **BLOCKED** failure, never a fabricated pass.

Observer controls plant and remove a synthetic plaintext leak before trusting its
absence. Native receipts expose only counters/booleans/opaque fingerprints, never
credentials, key bytes, authority tuples, draft text or image bytes. Snapshots
wait for accepted sealed writes and check actual private files and ImagePicker
copies. Source fault tests separately cover failed checkpoint retries, interrupted
discard compaction, locked metadata reads, failed erasure and stale writer fences;
those are **source/port tests, not native syscall-failure evidence**.

Light/dark empty, populated, loading and refusal frames, consecutive settled
frames and actual driver bounds/hierarchies are retained for independent QA,
design and UX inspection. A source-green run is not native validation: no claim
of native success is made until the workflow receipt and rendered artifacts pass.
The fixture is synthetic HTTP, not live Radient OAuth/TLS or physical-device proof.

## Release handoff hold

Before release/TestFlight handoff, reuse `scripts/ci/stage-b-backup-rules.ts` on the
**main internal release APK**, record its producer/source and artifact digest,
and hold handoff if inspection fails:

```sh
node scripts/ci/stage-b-backup-rules.ts \
  --apk /path/to/main-internal/app-release.apk --aapt2 /path/to/aapt2 \
  --source <exact-main-producer-sha> --variant release \
  --output /path/to/owned-evidence/release-backup-receipt.json
```

Debug artifact inspection cannot waive this release-variant gap. Do not produce
a second Android build merely to fill the premerge evidence slot.
