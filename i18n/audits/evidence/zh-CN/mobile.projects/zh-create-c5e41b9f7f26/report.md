# zh-CN mobile.projects audit — blocked

Auditor: translation-auditor, openai/gpt-6.1-terra, session c5e41b9f7f26; translator job 9c9b184d11aa.

Scope: 17 create/status keys. English catalogue and contextual sidecar were read; **0 target keys were read**. Namespace verdict: blocked, no translation verdict.

The sanctioned public-copy reader refused both the whole zh-CN catalogue and a keyed request because the worktree catalogue differs from HEAD. Redaction policy section 4 requires committed copy before this route can serve it; the refusal was not bypassed. The context sidecar was not routable (non-string values), and was read directly after marker scanning. Have the implementer commit the translation, then re-run the independent audit at that committed HEAD.

No translation findings are asserted; accuracy, register, examples, statuses, placeholders, glossary, and width remain unchecked. No tests, Node, installs, browser or rendered checks were run.
