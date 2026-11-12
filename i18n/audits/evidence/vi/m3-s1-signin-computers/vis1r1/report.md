# Independent translation audit — Vietnamese (`vi`), mobile M3 slice S1 (sign-in + computers)

- **Audit id:** `m3s1-vi-r1` · **kind:** first (independent) audit · **date:** 2026-11-12
- **Locale:** `vi` · **Namespace:** `mobile.computers` + `mobile.signin` (M3 S1, 44 keys)
- **Head audited:** `1796c3a5c46f5ecead1fa0abbb8c6eda36a7a9ce` (English-first worktree, base `origin/main` 9e193b57)
- **Draft audited:** `draft-vi-s1.json` sha256 `ee370439647b04e77654c7261dc2d8ed08034bef6396f9f20539a314265d8a4f`
- **Brief:** `translation-brief-s1.json` sha256 `531e6edd8e5f9af58d9bf2aa2b8b5d352da1f8fb27bac229213a549cb902487f`
- **Auditor:** `i18n-auditor`, model `deepseek/deepseek-flash` (per session header; no fallback observed), instance `767cf0660db6`, session `675090271c24`
- **Independence:** different session and instance from the translator (`b7ec0d6c43dd`, `deepseek/deepseek-flash`). Native-fluent reader of `vi`. No MT service, no back-translation, no translation API — every judgement is a reading of the Vietnamese text against the English, the style guide, the glossary and the shipped `vi` copy.
- **Verdict:** **passed** — 0 BLOCKER, 0 MAJOR, 1 MINOR, 4 NIT (`unresolved_blocker_major_count: 0`).

## What was read, in the order the brief requires

1. `i18n/style-guides/vi.md` (`e4901497…b227888`) and `i18n/glossary.md` (`0eb34437…a962f8`), both from `~/local-operator` `origin/main` @ `8459804f56dd704d5c3a680ef68f53b7182786ab` — so the 2026-10-11 wave-2 calls (em dash, «hủy»/«xóa» orthography, NFC, `setup → thiết lập`, `relay → chuyển tiếp`, `cost → chi phí`) are the binding text, not memory.
2. English catalogues + `role`/`note` sidecars: `en/mobile.computers.json` (`f0b7ee28…b40109`), `en/mobile.signin.json` (`2fc23f0a…d20252`), `en/mobile.computers.context.json` (`93a3f18e…3e6e6a`), `en/mobile.signin.context.json` (`1e9dc9d9…96f56`). **No `maxCells`/`maxChars` hint exists for any of these 44 keys** — the sidecars carry role and note only, so fit had to be judged from the call sites.
3. Shipped `vi` copy for terminology: `vi/mobile.computers.json` (45 keys), `vi/mobile.signin.json` (18 keys), plus `mobile.common`, `mobile.chrome`, `mobile.settings`, `mobile.notifications`, `mobile.oauth`, `mobile.agent_avatar`.
4. Call sites, for width and composition: `src/features/auth/computers.tsx`, `tunnel-paths.tsx`, `sign-in.tsx`, `welcome.tsx`, with the supporting `src/ui/components/badge.tsx`, `button.tsx`, `section-header.tsx` and the `mono-label` token (size 11, tracking 0.06).
5. The translator's notes **after** forming my own view of every key.

## Mechanical results (all pass, executed here)

- **The repo's own validator**, run on a scratch copy of `src/i18n` + `scripts/i18n` (the English-first worktree was never written to): `generate.ts` writes and `--check` reports `734 keys, 21 namespaces, argument types from en, es, fr, hi, ru, ur, vi, zh-CN`, exit 0. The generated `LOCALISED_MESSAGES.vi` block holds all 44 audited values **byte-identical to the draft, 0 mismatches** — no English fallback for any of them.
- **Negative controls** (so the pass is not vacuous): dropping `{reach}`, breaking `{status` and adding an unknown key each exit 1 and name the `vi` file (see `audit.log`).
- **Independent parse** with the repo's own parser (`parseMessage` imported from `src/i18n/messages.ts`, run through the worktree's `tsx`): 44/44 values parse; **placeholder names AND kinds identical** to English for every key (`status` text ×4, `name`/`status`/`reach` text ×3); **ICU structure identical**; raw placeholder tokens byte-identical and in order; **no plural/select in this slice**, so no CLDR category work exists to get wrong (and `vi` is `other`-only per the glossary); key set and order identical to the brief (44/44, none extra, none reordered); valid JSON; **NFC** throughout; no ASCII `...`; no space before punctuation; no doubled spaces; full-stop and ellipsis parity with English; **no English word from the source carried into any value**.
- **Kept-English tokens present, all permitted:** `Local Operator` ×1, `Radient` ×7 strings, `URL` ×1, and `{status}` (runtime value).
- **Byte-identical to English:** exactly one key, `mobile.computers.row.a11y` (`{name}, {status}, {reach}`) — three substitutions and two commas, no translatable word. The translator's "judged identical" list is therefore correct **and** complete.

## Linguistic audit — every key read

Covered all 44 values against accuracy, polarity/safety, idiom, register, terminology and fit. Per-key verdicts are omitted where the value is clean (43 of 44); the five non-clean readings are the findings below.

**Accuracy / safety.** The three negations in `remove.body` survive («Máy tính, đường hầm của nó và tài khoản của bạn đều không bị ảnh hưởng»), the billing warning keeps its refusal («sẽ bị từ chối»), the destructive confirm is one verb («Xóa») with the local-only scope in the body, and the cancellation reassurance keeps its polarity («Không có gì thay đổi trên tài khoản của bạn»). No added claims, no dropped negation, nothing unsafe.

**Register / idiom.** «bạn» used sparingly (possessive in the paragraphs, absent from badges, buttons and a11y labels), terse sentence case, bare-verb buttons («Xóa», «Làm mới», «Bắt đầu lại», «Thử ngay»), «Cứ thử lại» carries *anyway* idiomatically, «Đang chờ Radient đưa máy tính của bạn vào danh sách…» is native rather than literal («liệt kê» would be formal). No «Quý khách», no «anh/chị», no Title Case, no "!".

**Terminology.** Conforms with shipped `vi` copy throughout: máy tính, đường hầm, đăng nhập, phiên, tác nhân, trình duyệt, tài khoản, thanh toán, truy cập từ xa, thiết lập, tuyến, Làm mới, Xóa, hoạt động / đang kết nối / phản hồi / thu hồi. One string names the relay without «máy chủ» (finding 1). `Bản dựng` for *build* is already shipped copy (`vi/mobile.notifications.json:31`), so it is consistent, not an invention.

**Fit.** Worst badge pair (14 + 13 chars) is ≈ 240 px at mono-label 11 px against ≈ 358 px content width on a 390 pt phone (English pair ≈ 196 px); badges have no `numberOfLines`, so a long pair wraps inside its badge rather than truncating — no clipping, no ellipsis. Longest strings are the two card paragraphs (184 / 165 chars) in wrapping help text. `paths.own_title` (1.50×) is also a `SectionHeader`, which uppercases and wraps — acceptable, same behaviour as English. Button labels wrap (`labelLines` unset).

**RTL.** Not applicable (`vi` is LTR).

## Findings

| id | severity | key | gist |
|---|---|---|---|
| m3s1-vi-r1-1 | MINOR | `mobile.computers.paths.radient_body` | relay named «chuyển tiếp» alone while the shipped copy and this draft's own `unavailable_alt` say «máy chủ chuyển tiếp»; suggest «mật khẩu của máy chủ chuyển tiếp» |
| m3s1-vi-r1-2 | NIT | `mobile.computers.not_harness` | *harness* noun dropped; consistent with shipped `harness_help`; ship and record the per-locale decision |
| m3s1-vi-r1-3 | NIT | `mobile.signin.intro` | «không bao giờ thấy mật khẩu» → «không bao giờ nhận được mật khẩu» states the privacy fact more precisely |
| m3s1-vi-r1-4 | NIT | `mobile.signin.welcome.body` | «Mã nguồn» narrows *code* to *source code*; promise intact; keep |
| m3s1-vi-r1-5 | NIT | `mobile.computers.own_tunnel_instead` | «Chuyển sang …» swaps the verb, so the two buttons into `/own-tunnel` name different actions; optional alignment |

Current text, problem and suggested wording for each are in `receipt.json`.

## Rulings the manager asked for

- **`ur` / `zh-CN` style-guide rulings:** not mine — this task is `vi`. For `vi` the punctuation ruling is already binding and **followed**: em dash written " — " with spaces, ellipsis `…` (U+2026) on both shimmering lines, «hủy»/«xóa» first-vowel orthography, NFC.
- **The "judged identical" list:** correct and complete (verified independently — one key only, `row.a11y`).
- **Glossary proposals:** `harness` → agree with the product-name precedent, but it must be *recorded* as a per-locale decision, never a silent omission; `billing → thanh toán` agree (record beside `cost → chi phí`); `provisioning → đang thiết lập` agree for the badge, recorded so a later surface does not reach for «cấp phát».

## Programme note (not a `vi` defect)

`mobile.computers.wait.tunnel_status` inserts `{status}`, which `connector-wait.ts:181` fills with Radient's own word (`found.status`, e.g. `active`). That token is English in **every** locale, including `vi`, by explicit brief instruction. Translation alone therefore cannot fully satisfy "no English anywhere" on this one wait-panel line; that is a programme-level decision (keep Radient's word vs map it per locale), not something this slice's translator or auditor can fix.

## Where the evidence is

All of it is in this session's scratchpad, under `/Users/damian/.local-operator/sessions/675090271c24/scratchpad/audit/`: `receipt.json` (the record), `report.md` (this file), `audit.log` (real commands and their actual output), `vi-mech.mts` (the parse harness), `merge-vi.py` / `control.py` (scratch validator scaffolding and negative controls), `draft-vi-s1.copy.json` (byte-identical copy of the audited draft, same sha256), `repo-vi-only/` (the validator scratch copy). **No file in `~/local-operator-mobile/.worktrees/i18n-m3-s1` was written, staged or committed.**

The tracked bundle (`record.json` + `audit.log` + `report.md`) and the ledger row are the implementer/manager step, as the lane brief requires; the receipt carries the exact row text (note is 243 characters, under the 280 limit). Proposed tracked path: `i18n/audits/evidence/vi/mobile.computers+mobile.signin/m3s1-vi-r1/` — this slice spans two namespaces, which the repo's per-namespace directories do not express, so the manager should confirm the placement.
