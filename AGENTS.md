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
- **The tag is the release; the version is never bumped in a repository.** Cut a
  `vX.Y.Z` tag on `main` once a release window's work is merged — the version and
  the asset names derive from the ref (`scripts/ci/version.ts`; `docs/ci.md`,
  "Versioning"). There is no bump pull request, and `app.config.ts`'s version is
  a placeholder that is never edited to release. The one file a release may need
  in a pull request is `release/build-number.txt`, and only when the release
  job's floor check asks for it (`docs/ci.md`, "Versioning").
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

## Native interaction design

For conversation, navigation, composer or sheet changes, read
[`docs/design/native-interaction-guidelines.md`](docs/design/native-interaction-guidelines.md)
alongside the existing design kit. It records identity provenance, native
geometry, draft/queue/privacy boundaries and the rendered-evidence gate.

## Internationalization: mandatory policy

**No NEW hardcoded user-facing copy ships, and no feature ships in English only.**
The tree is not clean yet: `i18n:check` reports 285 literals (271 distinct entries) baselined in
`scripts/i18n/strings-baseline.json` that predate the runtime, and six of the
eight supported languages have no catalogue. The gate is a ratchet — it fails a
pull request that adds copy no key owns and cannot be made to grow — not a claim
that everything is already keyed.

- **Look the copy up; never hardcode it.** Every user-facing string — JSX text,
  `accessibilityLabel`, `placeholder`, `title`, toast, dialog, empty state,
  error body — is a catalogue key rendered through `t()` from `src/i18n`.
  English is just another catalogue; there is no direct-string path.
- **Every key, every supported language.** `SUPPORTED_LOCALES` in
  [`src/i18n/locale.ts`](src/i18n/locale.ts) is the machine-readable manifest of
  languages: read it, do not infer the set from the catalogue directories. Every
  new or changed key must exist in every locale there that is not in
  `NOT_YET_SHIPPED_LOCALES`,
  and a supported locale with no catalogue is listed in
  `NOT_YET_SHIPPED_LOCALES` as a deliberate, reviewed decision —
  `src/i18n/__tests__/locales.test.ts` fails a supported locale that is neither
  shipped nor explicitly pending. A feature is not done until it is localized in
  every shipped language; English-only is a missing feature, not a follow-up.
- **The gate is two checks.** `npm run -s i18n:check` runs
  `scripts/i18n/generate.ts --check` — the generated catalogue projection must
  match the JSON authoring source, every message must parse, and every
  non-English catalogue directory must define exactly the English keys,
  namespace by namespace, so a key missing from any locale THAT HAS A DIRECTORY
  fails. A supported locale with no directory is not compared at all (today:
  `es`, `zh-CN`, `ru`, `vi`, `ur`, `hi`), so a key added to `en` alone is green; that
  is the deliberate ship-wave decision, and it is why the app is not held to
  core's "every key in every language in `languages.json`" rule yet. Then
  `scripts/i18n/check-strings.ts`, which fails on a NEW user-facing literal that
  no catalogue key owns, **within the three rules `scan-strings.ts` states**:
  prose in JSX text, a fixed list of user-facing JSX attributes, and a multi-word
  literal in a `*-copy.ts` module. Its blind spots are real and green CI is not
  proof against them: it does not understand JSX expressions inside template
  literals, does not flag bare string literals in ordinary modules (a sentence in
  a plain `.ts` file, a `title:` object property, an `Alert.alert` argument), and
  does not look at attributes outside its list. Review those by eye. Its baseline
  is shrink-only, enforced in three places: `--update` removes entries and
  refuses to add any; the check FAILS when the baseline file contains an entry
  that the pull request's base copy does not (it compares against the base SHA
  in a `pull_request` run, `git merge-base origin/main HEAD` locally, and fails
  closed in CI if it cannot read the base); and an entry without an `owner` and a
  `payoff` fails. Hand-editing the baseline therefore does not pass.
- **An exemption is for what must NOT be translated.** Commands, flags, paths,
  identifiers, developer diagnostics and tool or model names stay English by
  design — that is the only legitimate exception. A baseline entry is not by
  itself an exemption, and none can be added: the growth check above fails a new
  entry, so a literal that genuinely must stay English is handled by changing the
  scanner rule deliberately (`scan-strings.ts`, in review) rather than by
  appending to the baseline. Every entry that exists carries an `owner` and a
  `payoff` (the condition that removes it), enforced by the check. The 271 entries
  that predate this rule carry one owner for the whole set — `damianvtran`,
  recorded as a group, not researched per literal — and one shared payoff; the
  owner of an entry is whoever keys it.
- **Where copy lives, and how keys are named.** One JSON file per namespace:
  `src/i18n/catalogues/<locale>/mobile.<area>.json`, with translator context in
  the sibling `mobile.<area>.context.json` sidecar. **The namespace is the file
  stem** (`mobile.schedules`). A key is `<namespace>.<name>` or
  `<namespace>.<group>.<name>`: it MUST begin with its namespace and a dot, the
  remainder is one or two non-empty lower_snake_case segments, and the group is
  OPTIONAL — a flat key is legal (`mobile.account_routing.reload`), as is a
  grouped one (`mobile.schedules.count.wakes`). Use a group when a namespace has
  clusters of related keys, not otherwise. Keys are fully qualified, semantic and
  immutable, because the namespace is a file-layout and review-boundary decision,
  not a second argument to `t()`. `generate.ts` enforces this
  (`scripts/i18n/key-shape.ts`): a key that violates it fails generation.
- **Preserve the message exactly.** Placeholders, ICU plural/select arms and the
  source text's structure survive translation unchanged; a message that drops an
  argument or rewrites an arm fails generation.
- **English is the floor, and it brings English rules.** A preference with no
  shipped catalogue renders the English source — the sentence, never the key and
  never an empty string — and that fallback is formatted with ENGLISH plural and
  format rules, because the locale used to format a message is the one the text
  came from, not the one the reader prefers.
- **Technical and model-facing text stays English.** Prompts sent to the relay
  or the model, command lines, flags, log lines and identifiers are English by
  design.
- **The agent's own conversation follows the reader by instruction, not by
  catalogue.** The app translates its interface; it does not translate an
  assistant's prose. The model answers in the user's language because its
  instructions say so.

HOWTO — adding a key, adding a locale, RTL: [`docs/i18n.md`](docs/i18n.md).

## Writing

- Comment the **why** — the constraint, the context, the decision — not what the
  code already says.
- Docs are written for a public audience: use `~/` rather than absolute
  home-directory paths, cite sources with links (and the date you read them when
  they may change), and leave out anything specific to one person's setup.
- Copy that users see follows the Local Operator voice: plain, direct, and
  honest about state. Never describe a feature as shipped before it is.
