# Account-routing native proof actors and source contract

This is a **manual targeted iOS evidence producer**, not the full E2E gate, an
Android runtime pass, a release job or permission to run on a developer's Mac.
The source allocation itself authorizes only offline tests/mocks. Execution
requires a separately allocated hosted CI run after independent source review
and QA. No source-only result below is a native result.

## Sources and actors

- `scripts/ci/account-routing-proof-contract.ts`: immutable inputs, actual public
  URL validator, artifact/run/identity checks, staged ordering and observed
  hierarchy facts. It never duplicates routing/default/choice tables.
- `scripts/ci/account-routing-ios-proof.ts`: executable coordinator, private
  canonical facade, owned Bonjour/simulator/native producer and actual flows.
- `scripts/ci/account-routing-proof-host.ts`: admitted-host fence, isolated child
  environment, deadlines, credential-free command logs and exact group reaping.
- `scripts/ci/account-routing-proof-flows.ts`: actual touch/a11y steps using the
  unchanged app's identifiers/copy and the existing public own-tunnel helper.
  The actor emits one named JSON-as-YAML flow and an exact one-file workspace
  config in owned runner temp. It NEVER selects the global `flows/*.yaml` set.
- `tools/mock-relay/account-routing-{identity,gate}.ts`: coherent nonce/slot
  transport and bounded response gates. The `.localhost` browser/default remains
  unchanged; `.local` exists only in explicitly admitted hosted macOS proof.
- `scripts/ci/account-routing-{bootstrap,artifact}.py`: explicit base-dependency
  setup and stdlib-only archive/plist/Mach-O/embedded-JS validation. Neither
  imports a credential client or installs an SDK.

The **writer** freezes one tooling-only delta. Independent **code/QA actors**
check source and negative controls before an **execution owner** allocates any
remote run. The execution owner reads the actual prerequisite receipt BEFORE
advancing stages. Independent **QA/design/UX actors** inspect actual native
wire/config/frame/hierarchy artifacts, not a source screenshot or green Node
suite. They alone close their respective native gates. A source pass is not
merge/release readiness.

## Frozen inputs (public provenance)

| Input | Identity |
|---|---|
| Unchanged product source / 14 English keys | `c67e79b09c24c0776292e857cadf7e6973b0144e` |
| Actual BASE source | `34b8340da2baa764016896367f58d0fc4b3c51d3` |
| Reusable successful iOS Release simulator run | `38805568113` |
| Existing `ios-simulator` artifact | `12008351088`, 33,947,890 bytes |
| Archive SHA256 | `18254a69eec01605aa0ccca0d39c50f98a3be73a2086dbc918ec40f7b63c903e` |
| Actual CoreC1 public source | `c1b7083a5371d60aa4ad58dbb54fd30d1a25857c` |
| Actual facade Git blob | `b08458247ac5babb43acd696c44bc3630e01d787` |
| Canonical payload fixture SHA256 | `ff4f4b39f7f12cf8fa8bf546f0ef4aa7c91b3bd2e4ad63ce48cafbb22b8297a0` |
| Unchanged BASE/candidate public URL validator SHA256 | `283961844829832e854ac98c72bf3f9405f0fc5212ab356a6393559ac8f25993` |
| Existing Maestro driver | `2.11.0` |

These are validation requirements, not evidence that an archive was downloaded,
a name resolved or an app ran during the source allocation. Metadata may expire:
wrong/missing/expired artifact, run/head/digest mismatch or unsafe ZIP fails
before native installation. No replacement artifact is guessed. No BASE SDK
build is added. The embedded asset paths/hashes, actual plist version/build,
Mach-O simulator platform and installed app bytes are observed, not inferred
from `ios-simulator` or `main.jsbundle` names.

CoreC1 has **23 declared base requirements and no uv.lock**. On an allocated
runner only, the coordinator clones that exact PUBLIC source anonymously and
uses the already provisioned Python>=3.12 to explicitly create its private
base-only environment. The authoritative requirement list, its hash and actual
resolved versions are recorded; this is NOT a claim of locked Python resolution.
No project/extras/provider/SDK installation or operator config is used. An
unreceipted/stale environment is refused instead of silently repaired.

## Manual staged interface — not dispatch authorization

The existing E2E workflow exposes `proof_mode: account-routing-ios-proof` and
`proof_stage: preflight | setup | full`. Normal/default `full` PR/main/nightly
and S15 job membership is unchanged and truth-table-tested. Only this explicit
manual mode selects the new macOS job; it does not fan out web/Android/nightly
jobs. Unknown modes/stages fail closed. Its summary is explicitly NOT full E2E.
The targeted job adds only `actions: read` for the pinned public artifact; no
signing, release, store, new secrets or permission-write surface exists.

Within that admitted job, package scripts are the stable executable interface:

```sh
pnpm e2e:account-routing-proof --stage preflight
pnpm e2e:account-routing-proof --stage setup
pnpm e2e:account-routing-proof --stage full
```

These commands intentionally refuse an operator/self-hosted/non-macOS/non-manual
context. Do not spoof their admission environment locally. Node dependencies
come from the normal existing frozen pnpm lock; `verifyDepsBeforeRun=error`
prevents an implicit recovery install. There is no new dependency/version/lock.

| Stage | Job bound | Must actually pass before advancing | Forbidden work |
|---|---:|---|---|
| preflight | 10 min | exact native/product/base source, real validator/consent controls, explicit CoreC1 bootstrap, actual private facade/socket/source-counter doctor, artifact/run/archive/plist/Mach-O/JS identity, stock owned `dns-sd -P`, actual OS DNS and native-mode 401/403/422/cookie controls | no simulator, Maestro or candidate SDK producer |
| setup | 20 min total | all above; existing installed runtime selection, fresh owned simulator, pinned Maestro version/help/device/gesture smoke, verified BASE install + actual installed JS identity, public own-tunnel form/consent/login303 and OS jar sessions200, connected Light/Dark BEFORE frames | no candidate SDK compilation |
| full | 75 min total | all setup prerequisites; ONE existing iOS Release simulator producer, version/build/native-config/prebuild determinism checks, actual candidate/installed embedded JS, native matrix below | no second BASE/candidate build, Android runtime claim, store/signing/release |

Setup/full reuse the verified archive and receipted Python dependency resolution
from the job's cheap preflight, then revalidate live source/name/transport
prerequisites. Their shared start marker keeps bounds cumulative. Cleanup has a
reserved margin and bounded exact process-group/owned-UDID teardown on failure.
A failed dependency/source/URL/DNS/artifact/form/jar/driver control STOPS before
candidate compilation. There is no fallback to shared localhost/IP, lookup
header override, `/etc/hosts`, TLS/allowlist/profile relaxation or administrator
operation. Only the owned nonce service is advertised; no laptop LAN mDNS is run
by source tests.

## Required runtime matrix and evidence meaning

All rows below describe **future actual admitted execution**, not a pass during
source review. The backend choices/defaults/labels/values come ONLY from the
real CoreC1 facade and fresh ConfigManager processes, never a phone enum.

| Surface/state | Executable actor / discriminator | Required actual artifact or side effect |
|---|---|---|
| Connected BASE before | actual BASE install, existing public custom-URL helper, real insecure-choice consent, Settings Light/Dark | baseline section absent; first/settled native PNGs, observed plist/Mach-O/JS and OS-jar login303→sessions200 |
| Native transport auth negatives | Node HTTP over actual unique `.local` DNS, not a header/IP stand-in | unauth/wrong-password401, wrong-origin403, invalid422 with unchanged canonical value; host-only own-cookie attrs; production/duplicate-cookie collisions401; no values logged |
| All three backend policies | actual metadata iteration; touch each draft, duplicate-gesture save, fresh-process disk GET | selected value, saved confirmation, exactly one PATCH per intent, config SHA and new-process readback |
| Draft | native choose only | unchanged PATCH count, actual unsaved copy/frame |
| Pending / duplicate press | real in-flight request held by owned fixture gate | saving frame, exactly ONE pending response and ONE committed write |
| Rejected | authenticated fixture write refusal403 | rejected copy, no false saved confirmation; Reload policy is GET-only |
| Unconfirmed AFTER commit | actual CoreC1 write then socket drop | private config changed, unknown outcome/no saved copy, Reload policy GET readback, no second PATCH |
| A→B pending write | actual public saved-route edit/form to B while A response is held | A target derived distinct from B, B selected metadata; release A only after B visible; no stale saved/value on B |
| A→B retired read | hold A GET, capture loading, public form switch B, then release A | actual pending A read, distinct values, B remains B after retired response |
| Old backend / malformed | actual selected-computer GET404 or malformed wire envelope | unavailable/load-error frames, reachable GET retry and canonical recovery |
| Disconnect/reconnect | stop/restart ONLY owned fixture on same owned port/name | disconnected native state, eventual canonical re-read on reconnection |
| Empty/no selected computer | actual saved-tunnel removal with existing confirmation; real public form reconnect | disconnected section, no persisted-profile injection, real reconnected policy |
| Appearance | actual app Light/Dark and 200% text controls | phone-size first/settled PNGs and raw hierarchy/observed metrics |
| Geometry/fonts/RTL | actual Maestro hierarchy fields only | coordinate/font exposure is reported truthfully; no source-token pixel guesses. RTL is explicitly unexercised, NOT approved. Independent native visual/UX review remains required |

The coordinator emits per-run URL/time/hostname/cookie NAME+scope and owned
publisher identity. It observes private OS jar request-name presence only,
never operator cookies or cookie values. Uploaded evidence is limited to
credential-free receipts/command logs/wire traces/native PNGs/hierarchies, not
venvs, dependency trees, raw Maestro text logs, app containers or whole runner
HOME. Owned fixture credentials are redacted across complete pipe streams.
No real provider inference, paid quota, account/store/config changes or browser
are involved.

## Offline source controls

```sh
# Existing dependencies, private HOME/config/scratch; no hidden pnpm recovery.
node_modules/.bin/vitest run scripts/ci/account-routing-proof.test.ts \
  tools/mock-relay/account-routing-identity.test.ts \
  tools/mock-relay/account-routing-gate.test.ts --maxWorkers=1 --no-file-parallelism
python3 scripts/ci/account-routing-artifact-test.py
node_modules/.bin/tsc --noEmit -p tsconfig.tools.json
```

The offline tests use real production URL validation but MOCK stage operations;
ZIP/plist/Mach-O fixtures are synthetic stdlib files. They exercise stale
metadata, unsafe members/symlinks/case collisions, device-not-simulator binaries,
unknown stages/modes, operator-context refusal, failed-prerequisite ordering,
lease expiry/release and old-guard accidental fanout. They do NOT start mDNS,
resolve native hosts, download an artifact, bootstrap Python, boot a simulator,
run an SDK, launch a browser or dispatch CI. The small `scripts/tsconfig.json`
reuses existing Node tooling semantics for Vite8/Oxc collection; the original
app/root type gates and product bytes remain unchanged.
