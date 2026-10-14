# Development

How to run, test, and look at this app. Prerequisites, then the three loops:
device, web, and gates.

## Prerequisites

- **Node 22.13+ or 24.3+** (Expo's floor; this repo is developed on Node 26).
- **pnpm** — the only supported package manager here. The lockfile is pnpm's, and
  a `node_modules` installed by npm or Yarn Classic is a different tree.
- Nothing else for the loops below. **No Xcode, no Android SDK, no JDK, no
  simulators, and no emulators** — this host has Command Line Tools only, and the
  repository deliberately does not require them (ADR 0001 § C6). Native builds and
  native E2E run in CI (ADR 0004).

```sh
pnpm install
```

## Run it

```sh
pnpm dev            # Expo dev server; press i / a for a device
pnpm dev:web        # the web target in a browser
```

**On a device** there are two paths, and they are not equivalent: a **development
build** (`npx expo run:ios` / `run:android`, which needs the native toolchains)
is the supported one, because it can load `expo-secure-store` and the tunnel
client's native pieces. **Expo Go** runs the JavaScript and is fine for layout
work, but it cannot exercise the parts of the app that touch the keystore — and
since SDK 57 it also requires an Expo account. Treat Expo Go as a layout preview,
not as a test.

The app needs a relay to be useful: `lop mobile serve` on the computer you want to
control, and (for anything other than a loopback URL) a `lop tunnel` connector.
With no connection the app renders its own empty states, which is what the shell
does today.

## Test and check

```sh
pnpm test           # vitest, Node environment — the pure modules
pnpm typecheck      # tsc --noEmit
pnpm lint           # biome check
pnpm theme:check    # the generated styling layer is current with the tokens
pnpm contrast:check # the design kit's own contrast contract still holds
```

`pnpm test` runs in Node on purpose, so the parts of a component worth asserting
live in plain modules (`src/ui/variants.ts`, `src/ui/tokens.gen.ts`, `src/lib/`).
A change that can only be checked by rendering needs a **frame**, not a test — see
below.

**The styling layer is generated.** Edit `design/tokens/tokens.json`, then run
`pnpm theme:build` to regenerate `src/ui/theme.css` and `src/ui/tokens.gen.ts`.
`pnpm theme:check` fails when they are stale, which is what stops the app and the
design kit drifting apart. Never hand-edit a generated file.

## Flake rules

A test that fails once in fifty runs costs more than one that fails every time: it
gets re-run, then ignored, then trusted less. These are the rules every test, probe
and CI step here follows. They prevent observed failures and related failure classes.

- **Never sleep to wait for something.** Wait on the condition — the element
  (`extendedWaitUntil` / `scrollUntilVisible` with a timeout in a Maestro flow), the
  event, the port file — with a *ceiling*. A ceiling returns the moment the thing
  happens, so raising one costs nothing on a healthy run; a sleep costs its full
  length every time and still fails on a slow one. A fixed sleep is acceptable only
  to let a negative settle ("no further request arrives"), and then it asserts an
  absence, not a presence.
- **Bound everything, and make the outer bound longer than the inner one.** Two
  nested timeouts fire in the order of their size, and the shorter one decides which
  *reason* the log shows. `launchBoundMs` in `tools/lib/chrome.ts` exists so the
  caller's bound is derived from the launcher's, not guessed beside it.
- **Do not let one failure wear another's name.** A browser that never started must
  not surface as "the wedged cell did not fail with its deadline". Assert the
  precondition first, as its own check, so the red names the cause
  (`tools/mock-relay/verify.ts`, "got a browser").
- **Unique ports, directories and ids per test.** Listen on port `0` and read the
  port back; make temp directories with `mkdtemp` under a pid-stamped root; never
  hard-code `3000`/`8081` or a path under `/tmp`. Two suites on one machine — or one
  suite twice — must not be able to collide.
- **No real wall-clock assertions.** Do not assert "took at least/under N ms" on a
  shared runner; inject the clock (`now: () => …`) or step it with fake timers. If a
  real elapsed time is the property (a deadline that must fire), assert a wide band
  and print the measured value in the failure message.
- **Reset what you set.** A test that changes `process.env`, `TZ`, the locale, the
  working directory or a module-level singleton restores it in `afterEach`, not at
  the end of the happy path — the next test file in the same worker inherits it.
- **Real child processes are fixtures with an owner.** Start them with a recorded
  pid, kill the *group*, and assert nothing survives (`reap` in `tools/lib/chrome.ts`).
  A test that leaves a process running is a flake in the next test.
- **An emulator or simulator is not a unit.** `sys.boot_completed` does not mean the
  device will stay reachable: the nightly gates on consecutive good `adb` probes
  (`scripts/ci/await-emulator-ready.sh`) before the first flow, and that gate fails
  loudly when it times out rather than retrying. The nightly's one re-run (ADR 0003)
  stays, but it is not a reason to skip the gate: a flake that "only" costs a re-run
  still hides behind a green job.
- **Never paper over a flake.** No blanket retries, no `skip`/`xfail`, no widening a
  tolerance until it passes. A retry or a longer wait is justified only for an
  *external* cause (a runner that is slow to start a browser or boot an emulator), and
  then it carries a comment naming the measurement that justified it.

`.github/workflows/flake-report.yml` reads the Actions history once a week and writes
a summary of the results that changed their mind about the same commit, and of
nightlies that only passed on their re-run (`scripts/ci/flake-report.ts` says what
counts). It reports; it never fails. Read it when a re-run "fixed" something.

## Looking at a change

A green suite says the code does what you expected; it does not say the screen
looks right — and it certainly does not say the styling arrived. During this
stream's scaffold work, `expo export --platform web` succeeded while emitting a
stylesheet with **no utility classes at all**, and the app rendered completely
unstyled. The build was happy; the screenshot was not.

```sh
pnpm export:web                                 # writes dist/
npx serve -s dist                               # or any static server
```

Then drive `dist/` in **installed** headless Chrome, never a downloaded engine:

- `--headless=new --use-mock-keychain --password-store=basic` and a throwaway
  profile — a headless Chrome under a scratch HOME with no keychain asks macOS to
  create one, which appears as a dialog on the operator's screen.
- Set the viewport with CDP `Emulation.setDeviceMetricsOverride` (**390×844 at
  dpr 3**), never `--window-size`: the flag clamps at a 500px floor and loses
  height to browser chrome.
- Set the theme with CDP `Emulation.setEmulatedMedia`
  (`prefers-color-scheme: dark|light`) — that is the OS appearance the app reads.
- Look at the PNGs. Capture **before and after**, and capture dark **and** light.
- Kill Chrome by pid and sweep your own profile; assert zero processes remain.

`~/local-operator/AGENTS.md` § "Visual validation" is the authoritative version of
that recipe, including why each flag is there.
