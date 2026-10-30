# Independent Chinese audit — `mobile.session_health` (`zh29a3`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT; unresolved blocker/major count = 0.** All 11 entries were read and judged key by key, including the ended-conversation placeholder with executed width measurement.

- **Auditor:** `i18n-auditor` (lopdev team), session `6de17b1d6bbd`. **Actual model: `radient/auto`**; fallback trail `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (provider-quota HTTP 429, disclosed). All judgements here were produced under `radient/auto`.
- **Translator:** a different agent, model `radient/auto` as supplied by the requesting manager; not observed; not model-diverse (same served model) — disclosed.
- **Second independent pass:** job `9855d3d26399` (label `zh-group-a-second-pass`), read all group-A keys without this auditor's findings; result recorded in `record.json`.
- **Inputs:** en `727b7e4977b3954637af9b5f8310c3bb892ebf9d9ecebc483db4c1aa7be4fe0f` · context `df99892225c85921be703c29c2689c5fe1c74f1d5cc02e1c1bfe9e1c838af310` · zh-CN `6aa79b07cf32bce319c71a44ef47eb99c7a70b26e4eea228c9bdd72ab7e126d3`.
- No human native-speaker review and **no rendered frame**; widths are executed CoreText metrics plus the field's own geometry.

## Mechanical result

- `node scripts/i18n/generate.ts --check` → catalogue current (143 keys, 10 namespaces); `node scripts/i18n/check-strings.ts` → 284 baselined, 0 new. (`pnpm i18n:check` cannot run here — pnpm refuses a hoisted directory at the symlinked `node_modules`; the scripts were run directly, disclosed in `audit.log`.)
- JSON valid; keys exactly 11/11/11 (en / zh-CN / context). No key added or dropped.
- No placeholders, no ICU structures, no markup, no code spans/commands/flags/paths/identifiers. No bidi or control characters. Full-width punctuation only; `——` is the correct double em dash; every sentence that is a sentence ends in `。`; the accessibility hint (`control_hint`) carries no final stop. No `请`, `您` or `！`.
- The Resume failure sentence agrees with the button it sits under: this wave renders Resume as `恢复` (`relay.chrome.session.resume` = `恢复`, `relay.chrome.session.resuming` = `正在恢复……`), and `resume_refused` / `resume_refused_title` / `resume_no_route` all use `恢复`.

## Test (c) — `ended_placeholder` fits the field, at 100 % **and** 200 %

- **Current:** `发送即可重新打开……` — 10 characters, **20 cells**, trailing U+2026 twice (kept, as the sidecar requires).
- The field is a one-line placeholder by construction: `composer.tsx:907` passes `placeholderMaxLines={1}`. Type is `text-body` 16 pt (24 pt at 200 % text scale; `textarea.tsx` documents the field's own type), so a CJK glyph is 1 em = 16 px at 100 % and 32 px at 200 %.
- Executed CoreText measurement (system font; the app's own stack falls back to it for CJK — Figtree is not installed here, disclosed):
  - current, 100 %: **152.13 px**; 200 %: **281.45 px**;
  - worst case if the fallback face draws U+2026 full-width (as PingFang does): 10 × 16 = **160 px** at 100 %, 10 × 32 = **320 px** at 200 %;
  - the field holds **≈324 px at 390 pt** (the figure this audit was given; the sidecar records ≈348 px). Every measurement is inside it, including the worst case at 200 %.
- For comparison, measured on the same instrument: English `Send to reopen in your home folder…` 266.74 px / **494.42 px** (clips at 200 % — the sidecar says so, and the French wave recorded the English clipping from 150 %), French shipped `Envoyer rouvre…` 120.67 px / 222.34 px.
- A destination-carrying alternative — `发送即可在主目录中重新打开……` — is **30 cells**, 231.51 px at 100 % but **433.18 px at 200 %**: it passes the 36-cell budget and still clips the one-line field at large text. That is exactly the trade-off the French wave settled (`fr29sm4` passed `Envoyer rouvre…`, destination dropped, after changing its fit instrument from cells to measurement). The destination is not lost to the reader: `relay.health.ended_detail` in this same wave says *"历史记录已保留。发送消息或点击“恢复”，即可在主目录中重新打开。"*
- **Conclusion: clean.** The shorter form is the only honest form that survives 200 % text, it matches the approved French precedent for the same key, and the omitted destination is carried by the adjacent health sentence. This is the opposite of the French `SH-01` defect (44 cells, clipped syntax); nothing here needs remediation.

## Per-key judgement

| Key | Role | Verdict |
|---|---|---|
| `control_hint` | help | clean — `说明此状态的含义，以及现在发送会怎样`: promises an explanation of the state and of what a send does now, nothing more; no final stop. |
| `menu_label` | button (accessible name) | clean — `会话操作` is the concise name of the overflow button; glossary `会话`. |
| `menu_hint` | button (accessible hint) | clean — `打开会话菜单` describes opening the menu, no full stop. |
| `menu_title` | heading | clean — `会话`, one short noun, not the conversation's name; glossary term. |
| `reopening` | status | clean — `正在重新打开——可能需要几秒。` names the wait (`几秒`), promises no success, uses the double em dash and a full stop for a full sentence. |
| `still_reopening` | status | clean — `仍在重新打开——尚未就绪。` preserves still-pending and not-yet-up; `就绪` is the right "come up" for a daemon, and it does not read as a silent failure or a success. |
| `resume_refused_title` | heading | clean — `无法恢复`, terse failure title, no full stop, agrees with the `恢复` button. |
| `resume_refused` | status | clean — `此会话刚才无法恢复。重试即可。` keeps the retryable failure and the "just now" bound; `重试即可` is core's own register for "try again" (`即可` appears throughout core's committed zh-CN, e.g. `relay.chrome.session.empty_hint` *"发送消息即可开始"*), and it does not promise the retry succeeds. |
| `resume_gone` | status | clean — `此会话已不存在。` A relay 404 means the stored session is gone; the sidecar's own words are "the conversation is gone", core renders "gone" as `已不存在` (`relay.asks.card.gone`), and the sentence invites no retry. `已不存在` is stronger than a literal "no longer saved" but it states the 404 fact, not a permanent-deletion claim about the transcript. |
| `resume_no_route` | status | clean — `连接电脑后才能恢复此会话。` names the missing prerequisite, does not blame the session. |
| `ended_placeholder` | help (placeholder) | clean — measured above. |

## Second pass (independent, reconciled)

The independent reviewer (job `9855d3d26399`, `radient/auto` after the same quota descent) agreed on every mechanical check and on the measurements — it put the current form at 144–160 px at 100 % and 288–320 px at 200 %, against this audit's measured 152.13 / 281.45 px and 320 px full-width worst case — but recorded the missing destination as a **MINOR**, on the view that the sidecar names the home folder as what the placeholder is *for*. This audit declines it, for a measured reason: the destination-carrying form is **433.18 px at 200 %** against the ~324 px one-line field, i.e. it clips, while the current form is the only candidate that fits at both scales; the wave has already recorded the destination one line away in `relay.health.ended_detail`, and the French wave passed the same shape (`fr29sm4`). That trade-off is stated here with its numbers, which is the recording the reviewer asked for.

## Notes and limits

- No human native-speaker review; **no rendered frame**. The 200 % conclusion rests on executed text metrics and the app's own type scale, not on a captured screenshot.
- Measurement font is the system UI font (Figtree is not installed on this machine); for CJK the fallback face's advance is exactly 1 em, and the worst-case full-width ellipsis is included above.
- Translator provenance is as supplied by the requesting manager; the run was not observed.
- `audit_notes_not_execution_log`: prose is judgement; `audit.log` holds the actual commands and their output.
