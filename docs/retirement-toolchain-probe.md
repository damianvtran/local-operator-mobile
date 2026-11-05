# Retirement exact-toolchain NO-TEST probe

This is a separate, manually invoked evidence lane. It is **not** a replay,
parser-action experiment, simulator check, XCTest acceptance, or repair to the
original FormatVersion 1 configuration. It does not revive the closed retained-app
attempt. Existing replay flags, deadlines, pins, and setup remain unchanged.

## Fixed authority and inputs

`retirement-toolchain-probe.py` uses only Python's standard library and existing
`retirement-replay-products.py` manifest/configuration/prepare functions. It never
calls package or retained-app preflight. Its constants pin:

- Repository: `damianvtran/local-operator-mobile`.
- Compile run: `41985836532`; runner artifact: `13398590341`.
- GitHub artifact ZIP size: `6844204` bytes.
- GitHub artifact ZIP digest:
  `861740ebe53e0ff6c6ec610c571216ffbfdeec20258b281c6e3c562458195786`.
- Compiled source: `4fff5e12296c3b6bd4ce3663988b9da8ca383227`.
- Exact standalone version response: Xcode `26.6`, build `17F113`.

Expiry, identity, size, digest, and source are checked against fixed GitHub
artifact metadata. `retirement-toolchain-acquire.py` owns metadata **and raw ZIP
download in one credentialed step**. No download action is used. It accepts only
an output-directory argument: repository, run, source, artifact ID, and API URLs
are constants, with no arbitrary URL/command/artifact inputs. An expired/missing
artifact fails closed; there is no fallback to another runner or the original app.
Checkout does not persist credentials. Workflow permissions remain only
`contents: read` and `actions: read`; the fixed child workflow has no inputs and
supports `workflow_call` from the registered iOS manual route, plus a standalone
manual trigger. No push/PR trigger or dependency installation is added.

### Independently verified raw ZIP — previous blockers resolved

The helper fetches only the fixed metadata endpoint and its `/zip` endpoint,
using the bearer only for those API requests. Automatic redirects are disabled.
Only one explicitly validated signed HTTPS URL is fetched without authorization;
it cannot redirect again. Allowed hosts are one subdomain of `blob.core.windows.net`
or `githubusercontent.com`, with an `/actions-results/` path and a nonempty `sig`
(or GitHubusercontent `token`) query parameter. Userinfo, non-443 ports, fragments,
escaped/traversal/backslash/ambiguous paths, unknown hosts and layouts fail closed.
An unexpected legitimate provider/layout requires review, not a broader fallback.

Raw download is bounded to exactly 6,844,204 bytes and independently SHA-256 hashed
against the constant **before extraction**. API metadata is not treated as byte
proof. Expiry is rechecked after download. The outer ZIP must contain exactly two
regular entries: `setup-receipt.json` (256 KiB maximum) and
`runner-products.tar.gz` (16 MiB maximum); all names, sizes, encryption and modes
are inspected before any writes. Acquisition has a 90-second total deadline,
75-second streaming budget, and at most 15-second network operations. Failure
removes partial/private inputs and emits only a fixed closed JSON record.

The raw ZIP remains private until cleanup. The credential-free probe independently
rehashes it again and binds both extracted files back to its ZIP entries, before
checking inner tar/manifest/product hashes. A self-consistent replacement
receipt/tar pair therefore cannot pass merely by updating their internal hashes.
The later probe step receives a minimal environment, with **no token**; it has no
acquisition mode. Only JSON is uploaded. These resolve the prior ZIP-byte and
split-token blockers; **hosted exact-toolchain validation remains unverified**.
No hosted execution is authorized by the existence of this workflow.

## Executable boundary and output

The child process executable is fixed to `/usr/bin/xcodebuild`. It receives only
one argument, either `-version` or `-help`, and only a minimal fixed PATH plus
DEVELOPER_DIR when present. No GitHub token, HOME, caller credentials, replay
environment, action/project/xctestrun argument, parser action, test action,
simulator command, or arbitrary executable input crosses that boundary.

Version must match before help is requested. Help is consumed privately and
reduced to booleans for these **fixed** launchRunner options:
`-xctestrun`, `-destination`, `-parallel-testing-enabled`,
`-maximum-concurrent-test-simulator-destinations`, `-only-testing`,
`-test-iterations`, and `-resultBundlePath`. A missing option is reported as
`false`; it does not prove a flag is unsupported or authorize changing replay.
A successful probe only means the bounded checks ran, not that replay will work.

Only one JSON object (at most 16 KiB) is published: fixed schema/version fields,
closed status/reason enums, fixed booleans/counts, known format version, allowlisted
version numbers, and fixed option keys. No private paths, environment keys or
values, error text, raw help, argv, archive bytes, configuration, source-derived
strings, traceback, or compile log is published. JSON is the only upload path.
Successful acquisition emits no output; its failure emits only the fixed
`acquisition` closed record into the same JSON upload path. Unexpected probe
failures close to fixed enums; a failing probe or acquisition exits 1.

## Actual-artifact compatibility preflight

Probe run `42024489713` closed before help/version because its metadata check
expected only `FormatVersion`. The actual pinned Xcode 26.6 configuration also
contains `ContainerInfo`. Validation now requires an integer (not boolean)
`FormatVersion` equal to 1, permits an optional dictionary `ContainerInfo`, and
rejects other metadata keys/types. Container values never enter evidence.

Before requesting another hosted allocation, run the **current `static_check`**
against the independently hashed, exact pinned runner archive offline—not only
`configuration()` or a hand-written fixture. The real-shape fixture includes a
sanitized `ContainerInfo`, with malformed/unknown-key refusal controls. On a
CLT-only machine, the supported result is that metadata, receipt and manifest
checks pass and execution reaches `references()` before failing on absent Xcode
platform paths. That boundary is not a full static pass or hosted-toolchain
proof; record it explicitly and remove the private artifact tree afterwards.
No retry is authorized by this preflight.

## Static checks and limits

The runner receipt's source and compile/no-build/no-test outcome are checked.
The tar hash, manifest hash, every manifest entry's hash/mode/type/link, exact
configuration hash, existing configuration checks, and FormatVersion 1 metadata
must match. The original flat schema is preserved. Every macro-bearing path is
resolved, including individual colon-separated DYLD search paths and
`__TESTROOT__`, `__TESTHOST__`, and `__PLATFORMS__`. Unknown macros, missing
references, escapes, or missing platform paths close the check. Platform paths
are resolved under DEVELOPER_DIR/Platforms (or the standard Xcode installation),
not by invoking another tool.

A throwaway same-parent private xctestrun is generated using the existing prepare
function. Its synthetic, noncredential session/bearer data follows the current
24/32-byte policy. Both environment dictionaries and every substituted path are
checked again, as are private mode 0600 and same-parent relocation. Private trees
and synthetic files are removed when the probe finishes, including failure.
The workflow additionally removes downloaded/private inputs on failure.

- Workflow: 10 minutes; probe: 120 seconds total wall deadline.
- Each standalone command: at most 15 seconds; merged stdout/stderr at most
  256 KiB, read incrementally (no unbounded communicate). Owned process groups
  are killed and the leader reaped even on timeout, excess output, or failure.
- Compressed runner tar: 16 MiB; each member: 64 MiB; total declared data:
  256 MiB; 20,000 exposed members, at most 40,000 including extension headers.
- PAX/GNU extension payloads: 16 KiB each, bounded before tarfile reads them;
  configurations/Info.plists and JSON: 256 KiB each. Regular members are copied
  in at most 64 KiB chunks; no 512 MiB unbounded member read.
- Traversal, absolute paths, link escape, hardlinks, sparse/special members,
  special mode bits, duplicate names, excessive sizes, and unknown top-level
  archive members are refused. Relative internal symlinks are created last.

## Local verification (no native command)

Run from the existing checkout; do not install dependencies. The following suite
uses only fixture archives, Python and fake xcodebuild scripts. It does **not**
validate the hosted exact toolchain:

```sh
scratch=$(mktemp -d "$HOME/workspace/toolchain-probe-tests.XXXXXX")
env -u LOCAL_OPERATOR_SCRATCHPAD TMPDIR="$scratch/" \
  python3 scripts/ci/retirement-toolchain-probe.test.py
status=$?
rmdir "$scratch"
exit "$status"
```

Mocked HTTP controls additionally cover raw ZIP hash/size verification before
extraction, wrong metadata digest/source/expiry, forbidden redirects, bearer
non-forwarding, network/stream deadlines, malformed outer ZIP names/modes/sizes,
and cleanup. They do not fetch GitHub or attest to hosted runner availability.

The suite covers exact standalone invocations, credential stripping, version
mismatch/refusal, missing-option booleans, stdout/stderr floods, deadline and
process-group teardown, expiry/source/hash/manifest failures, configuration refs,
FormatVersion 1 preservation, unsafe archives/extension headers/size bounds,
private relocation, exact JSON schema/sentinel nonleakage, and workflow/source
isolation. Fake tool execution is not native Xcode evidence.

A pure static inspection of already-extracted runner files on a CLT-only Mac can
call `static_check` without executing Xcode. Supply the fixed compile download
containing `setup-receipt.json` and `runner-products.tar.gz` (this static-only
recipe does not verify raw ZIP acquisition identity):

```sh
env -u LOCAL_OPERATOR_SCRATCHPAD python3 - /private/path/to/compile-download <<'PY'
import contextlib, importlib.util, json, pathlib, sys, tempfile
spec = importlib.util.spec_from_file_location('probe', 'scripts/ci/retirement-toolchain-probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
try:
    with tempfile.TemporaryDirectory() as private:
        result = probe.static_check(pathlib.Path(sys.argv[1]), pathlib.Path(private))
    print(json.dumps({'status': 'passed', 'static': result}))
except Exception:
    print('{"status":"closed","reason":"configuration"}')
    raise SystemExit(1)
PY
```

This may close on a CLT-only host because referenced Xcode platform paths do not
exist; that is not a configuration defect and must not be labelled hosted proof.
The local static-only recipe is not the credentialed metadata acquisition path.
For the complete lane, only after independent review **and a maintainer explicitly
authorizes dispatch**, use the already registered `ios.yml` entrypoint on the
reviewed ref. The child workflow need not be merged/registered on default to be
called from that ref. `manual-mode` validates the explicit fourth mode before the
read-only reusable probe job is eligible; all ordinary, simulator, signing,
setup and replay jobs remain unreachable. Probe mode requires proof=false, all
three replay string inputs empty, and observe_only=false. Do not pass replay
arguments. The child concurrency group has its own namespace so it cannot queue
behind its waiting parent:

```sh
# Only after independent review and explicit dispatch authorization.
gh workflow run ios.yml --ref <reviewed-ref> \
  -f mode=retirement-toolchain-probe -f retirement_proof=false
```

Do not use the existing setup workflow: it contacts the original and compiles a
runner.

## Non-goals

No original-app download, build, dependency install, simulator/emulator access,
app installation, app launch, test launch, UI action, replay, raw result bundle,
artifact-byte upload, parser-action inference, automatic dispatch, PR creation,
commit, push, or replay timeout/flag change. FormatVersion 2 conversion is not a
remediation: no structural defect of the pinned FormatVersion 1 runner has been
proven. Independent review and hosted evidence remain separate gates.
