# libb-ur-r2 - mobile.library (Urdu) - round 2 (delta) independent audit

**Verdict: passed** - 0 BLOCKER, 0 MAJOR. 31/31 keys. Auditor: i18n-auditor, session 2e0f57f5a781, model anthropic/claude-sonnet-5-5 (no fallback observed). Independent of the translator.

Audited text: `src/i18n/catalogues/ur/mobile.library.json` sha256 `6f7cd3c398ed2a2b8545baec51d25ca1818159c863a682bc83ae292efb153917`; en `710ec289379787f8d86cac0ea4b5d029df02ea3e577ac86e3ab6f80a3a343382`; context `bb7b6a5cb68ea0281b3aa3b4eb2ab3031986d15546e99e91bae48d50fbe853bc`. File mtime/hash checked at start and end of the run: unchanged.

## Round 1 is superseded
`libb-ur` recorded `changes_requested` on a 29-key text (sha256 `22e5cf3611f379dc53ff724228bf8b2ad6e68f218d3138e82fcc9617a91298ce`). Its findings were applied afterwards and two keys added, so that bundle attests text that no longer exists. Keys changed since: browse.no_tags, detail.seen_in, editor.new_tag_placeholder, editor.tag_limit. Keys added: discard_not_saved, discard_confirm. This round replaces it; the round-1 files are untouched.

## Round-1 findings, compared byte-for-byte with the file (audit.log, last section)
- libb-ur-1 MAJOR `editor.new_tag_placeholder` - fixed: `topic-name` (also allowlisted in IDENTICAL_BY_DESIGN.ur).
- libb-ur-2 MAJOR `detail.seen_in` - fixed: «ان گفتگوؤں میں دیکھا گیا».
- libb-ur-3 MAJOR `browse.no_tags` - fixed: «... منظم کرتے وقت ٹیگ شامل کرتی ہے۔» (gender-invariant participle; Librarian still the only Latin run, space-bounded, sentence ends on Arabic-script ۔).
- libb-ur-4 MINOR `editor.tag_limit` - fixed: «ایک اثاثے پر ٹیگز کی حد {limit} ہے۔».

## New keys, judged against library-detail.tsx:914-929 and dialog.tsx
- `discard_not_saved` «نام، تفصیل اور ٹیگز میں کی گئی تبدیلیاں محفوظ نہیں ہوں گی۔» - PASS. States the consequence (the edits are lost), keeps all three fields, uses «تبدیلیاں» as the title and «محفوظ» as `mobile.common.save` («محفوظ کریں»), full stop ۔, no Latin run, no bidi hazard.
- `discard_confirm` «چھوڑ دیں» - PASS. Reads as discard, is not `mobile.common.cancel` («منسوخ کریں»), so the destructive button and the dialog's Cancel cannot be confused; fits a button. MINOR libb-ur-r2-1: «چھوڑیں» would match the title and core's own confirmation.

## Mechanical (audit.log)
31 keys = en key set = sidecar key set; valid JSON; `generate.ts --check` current (180 keys); NFC-stable, no leading/trailing space; 0 Cf/Cc/bidi/zero-width characters; placeholders `{limit}`, `{count}` byte-identical; no ASCII `.`; sentence keys end in the locale's stop, `discard_title` in the locale's question mark; no non-ASCII digits.

## Composed strings at 0/1/2/21 (rendered through src/i18n/messages.ts)
`filters_count` and `tag_limit` carry a labelled count, no plural arms (sidecar), so the sentence stays grammatical at every value; see audit.log for all eight renders. Only limit=12 and count>0 occur at the call sites.

## Out-of-catalogue observation (libb-ur-r2-2)
Neither new key has a `t()` call site: library-detail.tsx:917-919 still passes the English literals `body="The name, description and tags you changed will not be saved."` and `confirmLabel="Discard"`, and src/ui/components/dialog.tsx:190 (scrim label :132) hard-codes `"Cancel"` rather than `mobile.common.cancel`. Until wired, a Urdu user sees an English body and English buttons under a translated title. Not a defect of this text; the coder must wire it.
