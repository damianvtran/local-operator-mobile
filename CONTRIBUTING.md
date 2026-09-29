# Contributing to Local Operator Mobile

Thank you for your interest in contributing! Bug reports, feature ideas, documentation fixes, design feedback, and code are all welcome. By participating in this project you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md), and your contributions are licensed under its [MIT License](LICENSE).

## Project status

The project is at the research and design stage: there is no app code yet. The first pull requests record decisions — the toolchain, how the app talks to the relay, store requirements, the design kit — in [`docs/`](docs/README.md). Once the toolchain is chosen, this guide will gain setup, build, and test instructions.

Until then, the most useful contributions are:

- **Feedback on the planned features and decisions** — open an issue or comment on the relevant pull request.
- **Corrections to the docs** — especially anything about the relay, tunnels, or store requirements that is wrong or out of date.

## How changes land

Every change reaches `main` through a pull request; nobody pushes to `main` directly.

1. **Fork** the repository (or create a branch if you have write access), and branch from the latest `main`.
2. **Make the change** and commit it using [Conventional Commits](https://www.conventionalcommits.org/) — for example `feat(sessions): show the active tool in the session list` or `docs(relay): describe the SSE reconnect rule`.
3. **Open a pull request** using the template. Describe what changed and why, and include real evidence that it works (see below).
4. **Review.** Every pull request gets a code review round, and a QA pass that exercises the change end to end. Changes someone can see — layout, colour, copy, motion — also get a design review round with screenshots. Findings are answered on the pull request, one remediation round at a time, until none blocking remain.
5. **Merge.** A maintainer merges once review and CI are clean.

### Evidence, not just green tests

A passing test suite shows the code does what the test expected; it does not show the feature works. In your pull request, include proof from running the real thing:

- **Behaviour changes** — the commands or steps you ran and what actually happened, including the error and edge cases (a wrong password, an expired session, a dropped connection).
- **Visual changes** — before and after screenshots, in light and dark themes, at a phone size. Where a screen has loading, empty, error, and populated states, show each one you touched.
- **If something cannot run locally** (for example a native build), say so, and point at the CI run that covers it.

### Versions and releases

Pull requests never change the app's version number. Releases are cut by a release owner in a dedicated `chore(release):` pull request, which gathers everything merged since the last release. Say in your pull request whether the change is user-visible, so the release notes can describe it.

## Guidelines

- **Use pnpm** for JavaScript dependencies, and commit the lockfile it produces. Do not mix in npm or Yarn.
- **Never commit secrets or personal details.** No tokens, passwords, signing keys, keystores, provisioning profiles, `.env` files, or real tunnel hostnames. Use obviously fake values (for example `0123456789abcdef0123456789abcdef-lop.example.com`) in docs, tests, and fixtures.
- **Comment the why.** Explain the constraint, the context, or the decision behind non-obvious code — not what the line already says.
- **Keep changes focused.** One concern per pull request makes it faster to review and safer to revert.
- **Write for a public audience.** Docs use `~/` rather than absolute home-directory paths and leave out anything specific to one person's machine.

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/damianvtran/local-operator-mobile/issues/new/choose):

- **Bug report** — what you did, what you expected, what happened, and your device, OS version, and app version. Redact tunnel hostnames, tokens, and passwords from anything you paste.
- **Feature request** — the problem you want solved and how you imagine it working.

Security problems are the exception: report them privately as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Related projects

- [Local Operator](https://github.com/damianvtran/local-operator) — the agent runtime, including the `lop mobile` relay and `lop tunnel` connector this app talks to. Relay or tunnel bugs belong there.
- [Local Operator UI](https://github.com/damianvtran/local-operator-ui) — the desktop app.

## Questions

Open a [discussion or issue](https://github.com/damianvtran/local-operator-mobile/issues), or email [contact@local-operator.com](mailto:contact@local-operator.com).
