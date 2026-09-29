# Summary

What does this pull request change, and why?

- Kind of change (feature, fix, refactor, docs, CI, …):
- Key changes:

<!-- Say in one line whether the change is user-visible; the release owner uses
     it to write the release notes. Do NOT change the app version here — only a
     `chore(release):` pull request does that. -->

User impact: <none | one-line description of what a user will notice>

## Related issues

- Closes #…

## Impact

- Breaking changes (relay contract, stored data, settings):
- New or updated dependencies (and why):
- Security or privacy implications (credentials, tokens, network, logging):

## Evidence

Show that it works by running the real thing, not only the test suite.

- Commands or steps you ran, and their actual output — including failure cases
  (wrong password, expired session, dropped connection).
- For anything someone can see: before/after screenshots, light and dark, at a
  phone size.
- If something could not run locally (for example a native build), say so and
  link the CI run that covers it.

## Checklist

- [ ] Commits follow Conventional Commits.
- [ ] I reviewed my own diff.
- [ ] Tests were added or updated where the change has behaviour to test.
- [ ] The evidence above comes from a real run.
- [ ] No version bump — only a `chore(release):` pull request changes the version.
- [ ] No secrets, tokens, signing material, or real tunnel hostnames are committed or shown.
- [ ] Docs are updated where behaviour or setup changed.
