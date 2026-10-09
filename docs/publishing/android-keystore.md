# Android upload keystore — generation and hand-over

**Status: prepared, not executed.** Run only when Play is unparked (see
`submission-runbook.md`), or when signed Android artefacts are wanted. No keystore
exists yet.

The operator supplies nothing for this: agents generate it, and the operator keeps
a copy for their records, out-of-band.

## Why these rules

- `AGENTS.md` forbids keystores and `.env` files in the repository; `docs/ci.md`
  "Secrets" carries the nine names and where they live.
- The keystore and its passwords must never appear in a transcript, a commit, a
  chat message, or `ps`. Every command below either writes to a file under
  `umask 077` or reads a value from a file — none echoes one.
- Play App Signing is on, so this is an **upload key**: if it is lost, Google can
  reset it (`google-play.md` § 3). That is the recovery path, not a reason to be
  casual about the passwords.
- The same upload key must serve Play, GitHub Releases and any F-Droid entry, so
  sideloaded installs keep updating (`google-play.md` § 3/§ 8).

## Execution plan

1. **Storage path outside every repository** — convention
   `~/Documents/keys/local-operator/` (`chmod 700`).
2. **Generate passwords without printing them** — `umask 077`,
   `openssl rand -base64 24`, one file per value (store password, key password).
3. **Generate the keystore** with `keytool -genkeypair`: RSA **4096** (floor is
   2048), validity **10000 days**, alias `local-operator-upload`,
   `-storetype PKCS12`, DN set to the project identity, passwords via
   `-storepass:file` / `-keypass:file`.
4. **Verify** — `keytool -list -keystore … -storepass:file …` lists the alias and
   prints the certificate; confirm the RSA size and validity end date. This is the
   same assertion `release.yml` performs after decoding the secret.
5. **Base64 into CI** — `base64 -i <keystore> | tr -d '\n'` piped **straight
   into** `gh secret set --env release ANDROID_KEYSTORE_BASE64`; never through a
   shell variable that could be echoed. Same for the passwords and, later, the
   Play JSON.
6. **Verify from CI's side** — the `credentials` step must print
   `present: … (N bytes)` for each name. A `present-but-empty` line means a
   truncated paste; redo that one.
7. **Hand the operator their record** — the keystore file plus alias, both
   passwords, creation date, DN, the keystore's `SHA-256`, where the CI secrets
   live, and the reset note. Suggested destinations: their password manager (or
   `lop secret store` for the password values).

## What must never happen

A keystore or password in a commit, a PR body, a chat message, or a terminal
echo. If one is ever printed, rotate: generate a new keystore and reset the upload
key in Play Console — cheap while nothing is published, which is why the first
Play upload should follow this procedure, not precede it.

## Definition of done

The four Android names present in `gh secret list --env release`, the keystore
verified locally, the operator's record delivered, and the release `credentials`
gate green for `android` once `RELEASE_PLATFORMS` includes it.
