# Native draft recovery

## Authority, not a display name

Native recovery is supported only for personal Radient Local Operator tunnels.
Every admission obtains `GET https://api.radienthq.com/v1/me` with the CURRENT
access bearer, `cache: no-store`, explicit HTTP `Cache-Control: no-store, no-cache` and
`Pragma: no-cache`, `redirect: error`, and no ambient cookies. The HTTP directives
are required because Expo57 native fetch does not forward the `cache` option.
The authenticated server verifies the access JWT and reads its account from the
database. The client requires nonempty `account.id` and `account.tenant_id`, and
`identity.account_id === account.id`. It never uses an email, display label,
decoded ID-token claim, saved computer entry or hostname as account proof.

The authenticated recovery tuple is `[1, control-plane origin, account.id,
account.tenant_id, personal-owner, tunnelId, exact relay origin, local-operator]`.
An organization context, custom server, OpenCode tunnel, unknown route fields,
failed request or incomplete identity document cannot open recovery. The current
route/admission epoch must still match after every asynchronous boundary. A
network failure leaves ordinary sign-in usable, with a fresh dispatch generation
and no restored private work. A saved tuple is comparison metadata, never offline
permission to recover.

Server contract inspected in `radient-ml/agent-server` at `785b84ad` (2026-11-03):
`internal/routes/routes.go` `/v1/me`, `internal/controllers/auth.go`
`MeHandlerEcho`, `internal/models/auth.go` `AuthUser`/`Account`, and
`internal/responses/auth.go` `MeResponse`.

## Storage and installation boundary

All native draft, command and startup persistence uses platform AES-256-GCM
(`expo-crypto`). Each write obtains a fresh platform-generated 12-byte nonce and
authenticates the installation ID, format version, family and exact storage-key
digest. Both the value and its index key are encrypted. Files, pending revisions,
predecessor revisions and backups contain ciphertext, not draft text or images.
Numbered immutable revision commits preserve the last complete ciphertext if a
pending write is interrupted. Corrupt committed latest bytes are refused, never
rolled back to a version that might repeat work. Legacy plaintext private
families have no authenticated owner and are deleted rather than imported.

Only the small install ID/key record lives in SecureStore, with
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no shared/synchronized group and no biometric
prompt. A random sentinel in `Paths.cache` must match that record before it can
be used. iOS Keychain survival after uninstall is NOT authorization: an absent,
corrupt or mismatched sentinel first destroys the fixed-service key and owned
ciphertext, verifies deletion, then creates and reads back a new sentinel and
key. It never reconstructs the sentinel from a Keychain item or ciphertext.
**OS cache eviction intentionally loses recovery** for the same privacy reason.
Missing/locked keys and authentication-tag failures have no plaintext fallback.

Expo57's native photo picker necessarily creates a transient plaintext COPY in
`Paths.cache/ImagePicker` before returning base64 bytes. This is not the user's
Photos original. Successful/invalid selections synchronously await removal of
ONLY a proven direct-child cache file in `finally`; unowned/ambiguous URIs are
refused, never deleted. Startup and privacy cleanup drain active picker operations
and sweep ONLY the dedicated ImagePicker directory before admission, covering a
process killed before JavaScript received the URI. Late results cannot attach to
another owner. This removes retained photo-picker copies; it does not claim that the
platform SDK never creates temporary plaintext. Photos originals and document
provider files are never swept.

Android SecureStore backup exclusions must be verified in generated/packaged
native artifacts, not inferred from source configuration.

## Expiry, reauthentication, logout and discard

An authentication expiry synchronously closes publication and dispatch. Already
accepted sealed draft writes are drained; no fresh request can read the vault
using its saved authority. Reauthentication has a distinct durable cleanup marker:
withdraw publication → drain sealed writes → finish the existing command/private
and startup cleanup → retain ONLY committed sealed draft recovery and its key →
fresh account and destination proof → import the editor. Interrupted cleanup is
completed before later admission. A failed cleanup keeps admission closed.

A successful same-authority proof may restore only text/images into an empty
editor. Recovery does not import a continuation ID, outbox queue, session creation
state, model/folder selection or dispatch generation, and never sends. A session
editor's SID comes from the currently opened authenticated conversation, not from
a recovered record. Typing while restoration is pending wins over recovered text.
A different account/tenant/tunnel/backend destroys the prior vault/key before new
private state becomes visible. Ordinary native generations can be reused across
restart only with a fresh matching trusted tuple; generation-backed storage is
not a bypass around failed recovery proof.

Explicit logout/forget performs the existing privacy purge PLUS vault/key
cryptographic erasure, attempts all deletions and propagates failure. Clearing a
draft writes/removes its recovery slot too, so discard or an acknowledged send
cannot resurrect a predecessor. Recovery entries expire seven days after their
last saved edit; this retention limit is separate from token expiry, which does
not itself delete a draft. Web retains its existing storage behavior and does
not enable this native cross-login recovery feature.

Failed accepted checkpoints retain only an in-memory retry operation. Reauthentication
retries/drains these before purging the ordinary generation; if that still fails,
no admission or last-copy purge is allowed. Explicit logout still attempts every
erasure. Merely reading/restoring a draft does not renew its retention timestamp.

Native record removal commits an authenticated null tombstone before pruning old
revisions. The tombstone remains authoritative even when predecessor deletion is
interrupted; ordinary corrupt-latest reads never roll back. Explicit discard can
retire corrupt history without reading/adopting it. Unknown locked-store or marker
I/O failures quarantine existing ciphertext/key without treating a read error as
proof of reinstall. Positively missing/corrupt/mismatched installation pairs still
require verified reset before minting a new installation.

## Validation boundaries

Targeted Node tests cover the trusted schema/route/epoch fences, real AES-GCM
AAD/key/tag negatives, installation bootstrap/read-back failures, revision
interruptions, same/different-owner vault transitions, discard, retention expiry,
reauthentication cleanup ordering and fresh draft-only startup restoration.
These are source tests, not native Keychain/FileSystem/crypto bridge proof.
The dedicated native proof must drive the real provider/editor, use real native
storage and sockets with allowlisted synthetic identity fixtures, and record
restart/reinstall, ciphertext-only scans, no-send evidence and rendered states.
Synthetic fixture E2E does not claim live production OAuth/TLS identity validation.
