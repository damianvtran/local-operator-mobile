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
  sideloaded installs keep updating (`google-play.md` § 3; the cross-channel rule
  is `checklist.md` F4, sourced to `other-channels.md` § 8).

## Execution plan

1. **Storage path outside every repository** — the operator decides where; a
   directory of their own with `chmod 700` is the convention, not a path this
   document dictates.
2. **Generate ONE password**, without printing it — `umask 077`,
   `openssl rand -base64 24`, written to a file. **A PKCS12 keystore ignores a
   separate key password**: `keytool` accepts `-keypass` and stores nothing of
   it, so a distinct `ANDROID_KEY_PASSWORD` would not unlock the key at signing
   time. This was proven on a real JDK 21 — the store password recovers the key,
   a distinct key password throws `UnrecoverableKeyException`, and **both
   `keytool -list` and the release workflow's decode check still pass**, so the
   failure would surface first at Gradle signing. Use the same value for store
   and key; the four CI names stay four names, with the password duplicated.
3. **Generate the keystore** with `keytool -genkeypair`: RSA **4096** (floor is
   2048), validity **10000 days**, alias `local-operator-upload`,
   `-storetype PKCS12`, DN set to the project identity, and both passwords read
   from the **same** file via `-storepass:file` / `-keypass:file`.
4. **Verify** — `keytool -list -keystore … -storepass:file …` lists the alias and
   prints the certificate; confirm the RSA size and validity end date. This is the
   same assertion `release.yml` performs after decoding the secret.
5. **Base64 into CI** — the keystore into `ANDROID_KEYSTORE_BASE64` and the one
   password into **both** `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_PASSWORD`
   (`base64 -i <keystore> | tr -d '\n'` piped **straight into**
   `gh secret set --env release …`; never through a shell variable that could be
   echoed). Same pattern for the Play JSON, later.
6. **Verify from CI's side** — the `credentials` step must print
   `present: … (N bytes)` for each name. A `present-but-empty` line means a
   truncated paste; redo that one.
7. **Hand the operator their record** — the keystore file plus alias, the
   password, creation date, DN, the keystore's `SHA-256`, where the CI secrets
   live, and the reset note. Suggested destination: their own password manager.

## What must never happen

A keystore or password in a commit, a PR body, a chat message, or a terminal
echo. If one is ever printed, rotate: generate a new keystore and reset the upload
key in Play Console — cheap while nothing is published, which is why the first
Play upload should follow this procedure, not precede it.

## Definition of done

The four Android names present in `gh secret list --env release`, the keystore
verified locally, the operator's record delivered, and the release `credentials`
gate green for `android` once `RELEASE_PLATFORMS` includes it.
