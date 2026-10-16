# Private account-routing fixture

This is a **source/socket prerequisite**, not compiled iOS/Android, native-JS,
OS-cookie-jar, browser or rendered-flow evidence. No SDK, emulator, browser,
runtime or package is installed by either entry point. Native builds/flows stay
held until the independent source/fixture gates and their own prerequisites pass.

## Authority and dependencies

The optional adapter adds only `GET/PATCH /api/settings/account-routing` to the
existing `tools/mock-relay/relay.ts` fixture, so the app also retains its normal
health/list/SSE/login surface. All successful policy bodies, defaults, choices,
coercion and file writes come from the actual core `policy_payload` and
`ConfigManager`, in a **new Python process for every request**. The phone carries
no policy/default mirror. The only noncanonical bodies are named negative
transport controls (old404, malformed,403 and response loss after a real write).

Required, existing inputs:

- Node24+ (the existing mock's `node tools/mock-relay/relay.ts` execution contract),
  this checkout's already-installed locked JavaScript dependencies;
- a clean **public** `damianvtran/local-operator` checkout at
  `c1b7083a5371d60aa4ad58dbb54fd30d1a25857c`, not current moving main;
- an existing Python3.12+ interpreter/environment capable of importing that
  checkout's base dependencies. Reuse its venv locally; do not duplicate it or
  install into the operator's global runtime;
- an owned `LOCAL_OPERATOR_SCRATCHPAD` (on isolated Actions runners, `RUNNER_TEMP`
  is also accepted by the adapter), with no pre-existing unmarked fixture data.

Startup verifies core HEAD and tracked source cleanliness, actual module
`__file__`, core facade Git blob `b08458247ac5babb43acd696c44bc3630e01d787`,
whole fresh projection equality, and native fixture SHA256
`ff4f4b39f7f12cf8fa8bf546f0ef4aa7c91b3bd2e4ad63ce48cafbb22b8297a0`.
A stale source/interpreter returning plausible canned JSON must fail before a
listener starts. Never update these pins merely to make a failed preflight green.

The bridge imports only the setting facade/configuration, never constructs an
auth/credential store, and installs an audit refusal for outgoing network and
child-process I/O before importing core. Python receives an explicit private
HOME/config root and no inherited CMUX/XPC/credential environment. Local Git
source checks disable system credential helpers and terminal prompting. No
provider calls, account login, quota probes or credit activation are involved.

## One socket preflight

From this checkout, after setting the two **existing** core paths:

```sh
export LOH12_CORE_ROOT=/path/to/pinned-core-checkout
export LOH12_CORE_PYTHON=/path/to/its-existing-venv/bin/python
# Supply the runner/session-owned scratch path; never a live config directory.
export LOCAL_OPERATOR_SCRATCHPAD=/path/to/owned-scratch
node tools/mock-relay/verify-account-routing.ts
```

The parent runner must apply the repository's private environment and an owned
bounded process group (locally, the core `scripts/run_bounded.py`,90s/1024MiB).
Use `env -i` with only the paths above, private HOME/config, PATH,
`GIT_CONFIG_SYSTEM=/dev/null`, `GIT_TERMINAL_PROMPT=0`,
`GIT_ASKPASS=/bin/false` and `PYTHONDONTWRITEBYTECODE=1`. Do not inherit live
session/profile identifiers or model/provider credentials.

The preflight exercises actual HTTP auth401, foreign-origin/operator403,
canonical-invalid-body422, config-byte preservation, all backend choices,
new-process file readback, private A/B independence during a delayed request,
delayed GET, old404, malformed projection and an unknown response **after** a
real committed write. It also proves production-name cookies are ignored,
duplicate same-name parent-domain/host-only cookies are refused in either order,
shared-IP Host is refused before login, and logout cannot clear unrelated
browser storage. Fresh per-run roots/counters and credential-free wire/status
traces are recorded under the owned scratch directory. The stale-source
counterfixture is negative-only, never a positive backend or a target stub.

## Full mock launcher for a separately admitted flow

```sh
# Same private environment, pinned existing core and bounded owner as above.
LOH12_POLICY_PROFILE=a node tools/mock-relay/account-routing-server.ts
```

The ordinary mock login fixture password is unchanged and is **not printed**.
Optional trusted runner environment (not an HTTP config API):

- `LOH12_POLICY_PRIVATE_ROOT`: fresh/owned-marked scratch root; fixed A/B children
  are independent config roots. It can be reused across process restarts.
- `LOH12_POLICY_PROFILE`: `a` or `b` only.
- `LOH12_POLICY_MODE`: `normal`, `old-relay`, `malformed`, `forbid-write` or
  `drop-after-write`.
- `LOH12_POLICY_READ_DELAY_MS` / `LOH12_POLICY_WRITE_DELAY_MS`: finite0..2000ms.

Only the **new per-run advertised hostname and cookie namespace** are accepted.
It binds loopback only, emits host-only cookies (no Domain), and refuses shared
`localhost`/`127.0.0.1` and production `lop_mobile` namespace configurations.
There is no unsafe host bypass. Startup prints/writes hostname, origin, cookie
**name**/scope/time and source identity, never the password or cookie value.
SIGTERM/SIGINT shut down owned mock sockets; the supervisor must still reap the
exact process group, including any bridge child. Do not leave a server running.

**Each surface's resolution is a hard prerequisite.** The socket gate uses
actual OS DNS and connects to the unique advertised `*.localhost` hostname; it
has no header-only stand-in or shared-IP URL fallback. A pass proves that Node
runner's DNS/HTTP path, NOT Android/iOS or harness-browser resolution. Verify
the actual approved origin before any shared-profile authentication or native
dispatch. If unsupported or origin approval is unavailable, report that
narrow blocker; never silently revert to shared127, change hosts/admin settings,
read/clear real cookies or install another browser. Browser work uses only the
harness browser, one reused owned tab, closed afterward.

## Public CI / compiled-flow plan (metadata only)

No workflow is changed and no SDK dispatch is authorized by this document.
Before admitting the existing Android/iOS build pair and a bounded flow lane:

1. Pin both this PR's **frozen native head** and the public core commit above.
   Checkout core read-only into the runner's own temp root; do not use a mutable
   shared main or a credential-bearing developer HOME.
2. Resolve an existing base Python environment or explicitly allocate its
   isolated base-dependency setup. Core C1's `pyproject.toml` declares Python3.12+
   and base dependencies; **there is no uv.lock**, so do not invent a frozen
   Python resolution. Record interpreter and installed dependency versions; no
   `[all]`, browser/native/tokenizer extras or operator venv/store is needed.
   A missing dependency stops setup before SDK work, not a silent package install
   from inside this fixture. Any runner dependency setup is a separate explicit
   allocation, never a new local environment for this source pass.
3. Run the canonical socket/source preflight and all negative controls first,
   retaining import path/blob/fixture identity and real config side effects.
   Validate the actual device/app route to the unique host and cookie scope.
4. Only after that and independent round2 source/QA convergence, admit the
   manager's one standard Android+iOS build pair and bounded real native flows.
   A debug APK alone is not JS provenance and iOS startup is not a policy flow.
   Record the winning compiled JS/source identity, real selected-computer
   interactions, pending/refused/uncertain/stale-A→B paths and actual light/dark
   phone frames/geometry. Do not substitute Node/schema checks or web stills for
   this evidence. Loading/unsupported/error/populated captures remain required.
