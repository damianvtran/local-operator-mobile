# Working on local-operator-mobile

Conventions for coding agents and humans changing this repository. They are
short on purpose: each one exists because the alternative is expensive to
discover later. Read this before your first change, and keep it portable —
nothing here should depend on one person's machine.

## What this repository is

A native iOS and Android client for the Local Operator mobile relay (`lop mobile`),
reached through a Radient personal tunnel or any tunnel/URL plus the relay
password. The relay's HTTP/SSE contract is defined in the Local Operator
repository (`docs/mobile.md`, `docs/tunnels.md`); treat that as the source of
truth and never change it from here. The toolchain is recorded in `docs/adr/`
once chosen — do not assume one before it lands.

## Commits and pull requests

- **Conventional Commits** for every commit: `feat(scope): …`, `fix(scope): …`,
  `docs(scope): …`, `chore: …`, `ci: …`, `test: …`, `refactor: …`.
- **Every change goes through a pull request.** No direct pushes to `main`. (The
  initial bootstrap commit was the single exception — an empty repository cannot
  take a pull request.)
- **Every pull request gets an agent review round and a QA pass** before merge.
  The reviewer posts `### Agent review — round <N>` with a `Reviewer:` line naming
  the reviewing agent and model and a `Scope: <base>..<head>` line; the author
  answers with `### Agent review remediation — round <N>`, marking each finding
  fixed (with commit SHA), rejected (with reason), or deferred (with reason).
  QA posts `### QA report — round <N>` from an independent run of the real app
  or build. Repeat until no blocker/major findings remain and the round was
  taken on the current head. The reviewer must be a different agent from the
  author.
- **Visual changes add a design round** (`### Design review — round <N>`,
  `D`-prefixed findings) with rendered screenshots — light and dark, phone size,
  before and after. A green test is not visual evidence.
- **Batch findings.** When several review roles run at once, collect all their
  findings into one remediation commit rather than a round per reviewer.
- **Evidence means real execution.** Show the commands you ran and their actual
  output, including failure cases (wrong password, expired token, dropped
  stream). If something genuinely cannot run where you are, say so and point at
  the CI run that covers it.
- **The tag is the release; nothing is bumped in a repository.** Cut a `vX.Y.Z`
  tag on `main` once a release window's work is merged — the version, the build
  numbers and the asset names all derive from the ref (`scripts/ci/version.ts`;
  `docs/ci.md`, "Versioning"). There is no bump pull request, and
  `app.config.ts`'s version is a placeholder that is never edited to release.
- **No automatic reviewer requests.** Do not add a `CODEOWNERS` file, and do not
  request reviewers or `@`-mention people on a pull request unless a maintainer
  asked for that review.

## Dependencies

- **pnpm only** for JavaScript/TypeScript dependencies. Commit `pnpm-lock.yaml`;
  never re-install with npm or Yarn, and never copy a `node_modules` tree.
- Add a dependency only with a reason recorded in the pull request, and prefer
  ones with an active maintainer and a compatible licence (this repository is MIT).

## Secrets and personal data

This repository is **public**.

- Never commit tokens, passwords, API keys, signing keys, keystores (`*.jks`,
  `*.keystore`), certificates (`*.p12`, `*.p8`), provisioning profiles, or
  `.env` files. Release signing runs in CI from encrypted secrets.
- Never commit a real tunnel hostname, account id, email address, or device
  name. Use obvious placeholders such as
  `0123456789abcdef0123456789abcdef-lop.example.com`.
- Never print a secret into a log, a test snapshot, a screenshot, or a pull
  request comment. Redact before you paste.
- Do not read `.env` files or credential stores to "check a value"; load them in
  a script that passes the value along without displaying it.

## Build host assumptions

- **Do not assume a local Xcode or Android SDK.** Native iOS and Android builds,
  and native end-to-end tests, run in CI (GitHub Actions). Local iteration
  should work on a machine with only Node.js and pnpm, through a web or Node
  target, so contributors without a Mac or an Android toolchain can still work.
- **Do not install simulators, emulators, SDKs, or JDKs as a side effect** of a
  script or test. If a task truly needs one, say so in the pull request.

## Scratch files and captures

- Keep scratch — probe scripts, logs, rendered frames, temporary clones — **outside
  the repository tree**, in your own temporary or session directory. Nothing
  scratch gets committed; `.gitignore` is a backstop, not a workflow.
- **Web captures use an installed Chrome, headless.** Launch it with
  `--headless=new --use-mock-keychain --password-store=basic` and a throwaway
  profile directory; set the viewport through the DevTools protocol
  (`Emulation.setDeviceMetricsOverride`) at real phone sizes. Never download a
  browser engine (no `playwright install`, no downloaded Chromium). When you are
  done, kill the browser by the exact process id you started and delete its
  profile directory.
- Do not leave windows, servers, or background processes running after a task.

## Writing

- Comment the **why** — the constraint, the context, the decision — not what the
  code already says.
- Docs are written for a public audience: use `~/` rather than absolute
  home-directory paths, cite sources with links (and the date you read them when
  they may change), and leave out anything specific to one person's setup.
- Copy that users see follows the Local Operator voice: plain, direct, and
  honest about state. Never describe a feature as shipped before it is.
