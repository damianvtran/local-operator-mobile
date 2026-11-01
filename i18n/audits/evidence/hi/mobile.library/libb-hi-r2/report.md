# libb-hi-r2 - mobile.library (Hindi) - round 2 (delta) independent audit

**Verdict: passed** - 0 BLOCKER, 0 MAJOR. 31/31 keys. Auditor: i18n-auditor, session 2e0f57f5a781, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text: `src/i18n/catalogues/hi/mobile.library.json` sha256 `48235b2ffa9aa6311a27493a0301651ae87967dc99a864053a4540f429fc7367`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. File mtime/hash checked at start and end of the run: unchanged.

## Round 1 is superseded
`libb-hi` recorded `changes_requested` on a 29-key text (sha256 `50bd54a80febd6ca63e6ceaae9ea1bc6404d83b35e87cfec5e0aeb7607a34a20`). Its findings were applied afterwards and two keys added, so that bundle attests text that no longer exists. Keys changed since: editor.description, detail.missing_file, editor.new_tag_placeholder, editor.discard_title, browse.refresh, browse.more_kinds. Keys added: discard_not_saved, discard_confirm. This round replaces it; the round-1 files are untouched.

## Round-1 findings, compared byte-for-byte with the file (audit.log, last section)
- libb-hi-1 MAJOR `editor.description` - fixed: «विवरण».
- libb-hi-2 MAJOR `detail.missing_file` - fixed: «विवरण».
- libb-hi-3 MAJOR `editor.new_tag_placeholder` - fixed: `topic-name` (allowlisted in IDENTICAL_BY_DESIGN.hi).
- libb-hi-4 MINOR `editor.discard_title` - fixed: «बदलाव छोड़ें?».
- libb-hi-5 MINOR `browse.refresh` - **not applied as written**: now «ताज़ा करें» (spelling question settled), but the object «लाइब्रेरी» of 'Refresh library' is gone. Re-raised as libb-hi-r2-1 MINOR; replacement «लाइब्रेरी ताज़ा करें».
- libb-hi-6 NIT `more_kinds` - fixed: «अन्य प्रकार».

## New keys, judged against library-detail.tsx:914-929 and dialog.tsx
- `discard_not_saved` «नाम, विवरण और टैग में किए गए बदलाव सहेजे नहीं जाएँगे।» - PASS. Consequence stated, fields kept, «विवरण» now matches the editor label, «सहेजे» matches `mobile.common.save` («सहेजें»), danda । present.
- `discard_confirm` «छोड़ें» - PASS. Matches the title «बदलाव छोड़ें?» and core's tui.authoring.discard; distinct from `mobile.common.cancel` («रद्द करें»).

## Mechanical (audit.log)
31 keys = en key set = sidecar key set; valid JSON; `generate.ts --check` current (180 keys); NFC-stable, no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; placeholders `{limit}`, `{count}` byte-identical; no ASCII `.`; sentence keys end in the locale's stop, `discard_title` in the locale's question mark; no non-ASCII digits.

## Composed strings at 0/1/2/21 (rendered through src/i18n/messages.ts)
`filters_count` and `tag_limit` carry a labelled count, no plural arms (sidecar), so the sentence stays grammatical at every value; see audit.log for all eight renders. Only limit=12 and count>0 occur at the call sites.

## Out-of-catalogue observation (libb-hi-r2-2)
Neither new key has a `t()` call site: library-detail.tsx:917-919 still passes the English literals `body="The name, description and tags you changed will not be saved."` and `confirmLabel="Discard"`, and src/ui/components/dialog.tsx:190 (scrim label :132) hard-codes `"Cancel"` rather than `mobile.common.cancel`. Until wired, a Hindi user sees an English body and English buttons under a translated title. Not a defect of this text; the coder must wire it.
