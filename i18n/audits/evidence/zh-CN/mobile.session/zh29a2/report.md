# Independent Chinese audit — `mobile.session` (`zh29a2`)

**Verdict: `passed` — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT; unresolved blocker/major count = 0.** Both entries were read and judged against the English, the sidecars and core's committed zh-CN.

- **Auditor:** `i18n-auditor` (lopdev team), session `6de17b1d6bbd`. **Actual model: `radient/auto`**; fallback trail `anthropic/claude-sonnet-5-5` → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto` (provider-quota HTTP 429, disclosed). All judgements here were produced under `radient/auto`.
- **Translator:** a different agent, model `radient/auto` as supplied by the requesting manager; not observed by this auditor; not model-diverse (same served model) — disclosed.
- **Second independent pass:** job `9855d3d26399` (label `zh-group-a-second-pass`), read all group-A keys without this auditor's findings; result recorded in `record.json`.
- **Inputs:** en `8539005ad9785ec14504c9f8fba86fcd7587b11185f8f2062da0eff1b1aadda8` · context `6e8d32e62d787a2c9b3c24cbba85e1bbcfba820b39840d84147afbe1038495b1` · zh-CN `544349288b1bdb27e163798fd35909b4d092668c0d0001e473e25a8ba9db9891`.
- No native-speaker review, no rendered frame.

## Mechanical result

- `node scripts/i18n/generate.ts --check` → catalogue current (143 keys, 10 namespaces); `node scripts/i18n/check-strings.ts` → 284 baselined, 0 new. (`pnpm i18n:check` cannot run in this worktree — pnpm refuses a hoisted directory at the symlinked `node_modules`; the two scripts were run directly, disclosed in `audit.log`.)
- JSON valid; keys exactly 2/2/2 (en / zh-CN / context). No key added or dropped.
- No placeholders, no ICU structures, no markup, no code spans, commands, flags, paths or identifiers. No bidi/control characters; no ASCII punctuation inside Chinese prose; no `请`, `您`, `！` or `……` defects. `status_tray.hint` correctly carries **no** final full stop (it is an accessibility hint), `conversation_details` carries none either (it is a label).
- Cell widths: `conversation_details` 8 cells; `status_tray.hint` 30 cells (a wrapping hint, no budget).

## Per-key judgement

| Key | Role | Verdict |
|---|---|---|
| `mobile.session.conversation_details` | heading / control label | clean — `对话详情` is the destination screen's own title, used as the label of the control that opens it; 4 code points, no full stop. `对话` is this wave's word for *conversation* (confirmed against `mobile.notifications.detail.*`, which renders "conversation" as `对话` while *session* stays `会话`, the glossary term). The same four characters appear byte-identically inside `mobile.home.options.fixed` (test (a), bundle `zh29a1`). |
| `mobile.session.status_tray.hint` | accessibility hint | clean — `打开工作状态行、任务和子智能体`. It describes exactly what the tray opens (`status-tray.tsx:10`: "the live working line, the task list and the subagent roster"), promises no action beyond opening it, and uses glossary `子智能体`. `工作状态行` renders the product's "working line" — the one in-progress indicator — without inventing a verb (`projection.ts:281` names it `workingLine`). No final full stop, as the sidecar requires. |

## Context (not findings)

- The label is resolved from the catalogue at the call site (`src/features/new-session/startup-transcript.tsx:52` → `t("mobile.session.conversation_details")`), so the sheet title and the sentence that names it cannot drift — the mechanism the French wave put in place after its `H-04`.
- `zh-CN` is in `NOT_YET_SHIPPED_LOCALES`; nothing here renders in this build until the locale flips.

## Second pass (independent, reconciled)

Reviewer job `9855d3d26399` (`radient/auto` after the same quota descent) read both keys without this auditor's findings and agreed: `对话详情` is the destination's own title and the wave's `对话`/`会话` split follows core's own; the tray hint describes exactly what the tray opens. No finding and no disagreement.

## Notes and limits

- No native-speaker review and **no rendered frame** are claimed.
- Translator provenance is as supplied by the requesting manager; the translator's run was not observed.
- `audit_notes_not_execution_log`: prose here is judgement; `audit.log` holds the actual commands and output.
