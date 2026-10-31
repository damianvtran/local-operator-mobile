# Vietnamese audit — `mobile.computers` (group B)

- **Audit ID:** `vi30c1`
- **Locale / namespace:** `vi` / `mobile.computers` (10 keys)
- **Date:** 2026-10-30
- **Audited head:** `31f2ae46f45d7b579fc704bd1ba8f3a6dcc7856b` on `feat/i18n-vietnamese`
- **Worktree:** `/Users/damian/workspace/vi-wave`
- **Auditor:** `i18n-auditor` (lopdev team), session `0156ce9c9f5e`, model `radient/auto`. Independence: different agent/session from the translator; not the author of these bytes. Second independent reading pass: reviewer subagent, job `4ac043e37ef7`, model `radient/auto`. No human native-speaker review is claimed.
- **Verdict:** **passed** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT.

The paragraphs below are the audit's narrative. The `input` hashes, gate exits and the final status live in `record.json`; this file is not the source of record for the verdict.

## Inputs

| Role | Path | SHA-256 |
|---|---|---|
| English source | `src/i18n/catalogues/en/mobile.computers.json` | `356f10123aa96d48169552395506cd9b1f2e3b50955bfd363624fd2371930643` |
| Context / role notes | `src/i18n/catalogues/en/mobile.computers.context.json` | `3ac04e8333c94e9d419a144bcf08b3ce40ea54b88acc153a9caa1789ba40b6a5` |
| Vietnamese target | `src/i18n/catalogues/vi/mobile.computers.json` | `ff1fa7f6b5294c2a240bd5af5827aad0c86989be42ebb4a6fbfed2c1edc7e0a1` |

(These are the hashes printed by `audit-run.sh`; `record.json` carries the same values.)

## Mechanical

- Repo validator (`generate.ts --check`): exit 0, key parity 10/10, all messages parse.
- Structural verifier: 10 keys, 0 problems, all NFC, key order identical to English, tabs/trailing newline/no BOM/CRLF.
- No placeholders and no ICU plural/select nodes in this namespace, so there is no placeholder/arm surface to compare.

## Rendered strings (production runtime, vi)

| Key | ACTUAL rendered string | Reading |
|---|---|---|
| `mobile.computers.add` | `Thêm máy tính` | add a computer |
| `mobile.computers.added.stays_listed` | `Máy tính trước vẫn được giữ trên điện thoại này, nên bạn có thể chuyển lại từ danh sách máy tính.` | the previous computer stays on this phone, so you can switch back from the list |
| `mobile.computers.badge.active` | `hoạt động` | active |
| `mobile.computers.badge.connecting` | `đang kết nối` | connecting |
| `mobile.computers.connecting` | `Đang kết nối…` | connecting… |
| `mobile.computers.none_on_phone` | `Chưa có máy tính nào trên điện thoại này.` | no computer on this phone yet |
| `mobile.computers.password_placeholder` | `Mật khẩu từ lop mobile` | the password from `lop mobile` |
| `mobile.computers.section.not_connected` | `Trong tài khoản Radient của bạn, chưa kết nối` | on your Radient account, not connected |
| `mobile.computers.section.on_phone` | `Trên điện thoại này` | on this phone |
| `mobile.computers.switch` | `Chuyển máy tính` | switch computer |

## Judgement

- **`máy tính`** is the established Vietnamese term for the paired computer; core's committed vi uses it in the same sense (`relay.notifications.detail.missing.body`: "máy tính này không còn giữ nó"). The glossary has no separate row for it, so this is the term of record.
- **`add` / `switch`** are verb + noun labels, sentence case, no final stop. Vietnamese has no article, so "a computer" is correctly `máy tính`; both fit a button.
- **Badges** are lower case and state-shaped: `hoạt động` (active), `đang kết nối` (connecting). Vietnamese cannot render "connecting" as one word; the progressive `đang` is the state marker, and the pair stays parallel. `connecting` keeps the ellipsis character (`…`), as the note requires.
- **`none_on_phone`** is a full sentence with a final stop, matching the note; `Chưa … nào` is the standard Vietnamese negative existential.
- **`password_placeholder`** keeps the command `lop mobile` byte-identical; `Mật khẩu từ` is the natural "password from".
- **`section.not_connected`** keeps the product name `Radient` and reads as a section header: "In your Radient account, not connected" — the comma is the header's own separator; no subject is needed because the section's rows are computers. `section.on_phone` is the parallel "On this phone".
- **`added.stays_listed`**: `Máy tính trước vẫn được giữ trên điện thoại này` says the previous computer is still kept here, and the second clause names the computer list the reader returns through. The note's reassurance ("it stays listed") is carried; `Máy tính trước` makes the pronoun "It" explicit. Accepted as written; no finding.
- **Register**: `bạn` appears only in possessive/blocking positions (`của bạn`, `bạn có thể`), never as a vocative; no `!`; sentence case; no `Vui lòng`.

## Every key in the group

All ten are listed in the rendered table above; each is `pass` for accuracy, idiom, register and fit. No key is missing, added, or structurally divergent.

## Terminology / glossary against core's committed Vietnamese

None of the seven tracked terms (`mốc`, `bộ giám sát`, `giám sát`, `lần thức dậy`, `hàng đợi`, `bản nháp`, `thư mục home`) occurs in this namespace. The relevant term is `máy tính` for computer, which matches core. **Divergences: 0.**

## Fit / width

No `maxCells`/`maxChars` hint exists for this namespace. Code-point lengths: `added.stays_listed` 97 vs 77 (1.26), `section.not_connected` 45 vs 38 (1.18), `none_on_phone` 41 vs 31 (1.32), `badge.active` 9 vs 6, `badge.connecting` 12 vs 10. The two section headers and the help sentence wrap (no `numberOfLines` clamp); the badges sit in an unconstrained pill. No word reaches 18 characters. No overflow risk found.

## What I could not verify

- No rendered frame (no `browser` tool, no simulator capture); width claims are code-point reasoning against the components' clamps, not pixels.
- No human native-speaker review; the second pass is another LLM agent (independence by agent/session, not model diversity).
- `t()` on the real branch still renders English for `vi` (pending ship); the strings above come from the byte-identical scratch copy with the harness-only `SHIPPED_LOCALES` flip.
