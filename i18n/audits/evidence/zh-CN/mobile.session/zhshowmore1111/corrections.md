# Corrections (additive; written by the coder landing this bundle, not by the auditor)

Chosen form: this adjacent file. `report.md` is a byte-for-byte copy of the auditor's report and is not edited.

1. **展开 is not shipped.** The translator scratch note (session `d5aaf8ba6ba5`, `followon-show-more/zh-CN.json` + `.notes.md`, lane-owner transcription) records `mobile.session.user_message.show_more` = `展开` (and `show_less` = `收起`), saying `展开更多` was rejected as longer. The catalogue shipped in #237 and present on `origin/main` 2b508d9d carries `显示更多` / `收起`. Verified from the bytes: see `main-bytes-check.txt` (whole file identical at 8fdfb2e9 and main). The auditor made the same observation (report.md, "What actually ships at the head"). Only `show_more` differs; `show_less` is `收起` in both.
2. The audit's subject is the shipped pair `显示更多` / `收起`. The values are unchanged from #237.
3. The translator candidate is not adopted; nothing in this PR changes any catalogue line.
