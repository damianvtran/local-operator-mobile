#!/usr/bin/env python3
"""Write record.json for the M2 fr delta audit bundle (hashes computed, not typed)."""
import hashlib
import json
import os

D = "i18n/audits/evidence/fr/m2-expression-literals/delta-r2-c4024b49"


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


art = {
    "audit-delta-fr.md": sha(f"{D}/audit-delta-fr.md"),
    "audit.log": sha(f"{D}/audit.log"),
}
tools = {n: sha(f"{D}/tools/{n}") for n in ("checks.py", "run.sh")}

record = {
    "schema": 1,
    "audit_id": "m2d-fr-r2",
    "locale": "fr",
    "namespace": "m2-expression-literals",
    "namespaces_covered": [
        "src/i18n/catalogues/fr/mobile.computers.json (4 keys)",
        "src/i18n/catalogues/fr/mobile.session.json (15 keys)",
        "src/i18n/catalogues/fr/mobile.settings.json (14 keys)",
    ],
    "audit_date": "2026-11-11",
    "audit_timestamp_utc": "2026-11-12T01:37:21Z start of scripted run (local date 2026-11-11, EST)",
    "kind": "round 2 DELTA audit - PR #236 M2 expression-literal slice, scope 3af477ee..c4024b49",
    "review_stage": "post-remediation delta: case-only change to diagnostics.stream_degraded; ctx exception ruled on",
    "key_count": 33,
    "value_count": 33,
    "project": "damianvtran/local-operator-mobile",
    "pr": 236,
    "worktree": "/Users/damian/local-operator-mobile/.worktrees/i18n-m2-scanner (manager-owned, read-only for this audit)",
    "base_commit": "3af477ee5dd7eee5fe7b1fac36d5fd0d07918f3a",
    "head_commit": "c4024b497a4db3118aae70d8bb132301ea3ab097",
    "delta_statement": (
        "Exactly one of the 33 fr values changed between base and head: "
        "mobile.settings.diagnostics.stream_degraded 'Ne repond pas' -> 'ne repond pas' (case only; same "
        "length; casefold-equal). Proven by the git diff of the three catalogue files, a per-key comparison "
        "of both heads, and a reversion proof that reproduces the base target33 hash. The other 32 values are "
        "byte-identical and were retained on their round-1 verdicts; the mechanical layer was re-run over all 33."
    ),
    "keys_changed": ["mobile.settings.diagnostics.stream_degraded"],
    "keys_changed_outside_group_in_fr": [],
    "input_hashes": {
        "target": {
            "path": "src/i18n/catalogues/fr/mobile.{computers,session,settings}.json - 33 key/value pairs as sorted-key JSON",
            "sha256": "b9b0983185785a946c134b60994062a76bab8dfbd19cda325c9450bebf892860",
            "form": "json.dumps(sorted pairs, ensure_ascii=False) with DEFAULT separators - the fr auditor's canonical form",
            "sha256_compact": "d6e4a0db35ef13ebc181e1366762506fad333e94414996df475eff413db0392f",
            "sha256_at_base": "9aecf8f17941b4a1a7dac4c363ba40d7ad82572b61a05f41b8ad1f9d9c18ae0f",
            "sha256_at_base_compact": "9cc6f790904f9d3ef302645c772a38888cd099fdba10c150a986d6f86090bb30",
            "file_sha256": {
                "src/i18n/catalogues/fr/mobile.computers.json": "c3015755e033b3fca2236ffee8d967df3c25ccff96ee85aad0bd9457cd5b6135",
                "src/i18n/catalogues/fr/mobile.session.json": "62ea762bca7f9b47a2c5fa02bdc30e97dc9f2755c00b5c6a7d4a6588875f8aa7",
                "src/i18n/catalogues/fr/mobile.settings.json": "c21961f4c2f71587dfdfc6794c0a2c2429963e7fcfed3272d3686601aa247eff",
            },
        },
        "en": {
            "path": "src/i18n/catalogues/en/mobile.{computers,session,settings}.json - same 33 keys",
            "sha256": "008f9a49490adbde68808c0db487a471f87d3236b79ab9282205796964ad8b98",
            "form": "same canonical form, DEFAULT separators",
            "sha256_compact": "c326a93f9f2d61a15e4cd6a169e542ca22f0232504e75979b9a92458c29d3528",
            "note": "identical at base and head - no English source value changed in this delta",
            "file_sha256": {
                "src/i18n/catalogues/en/mobile.computers.json": "713827837aab9d75611441155d50522ccce9d8b410d88c1b7bd27e528776aff3",
                "src/i18n/catalogues/en/mobile.session.json": "8df14a0d12ef0386a3115c55dcdf7976e7234b9e82a79279741985e11aa716d3",
                "src/i18n/catalogues/en/mobile.settings.json": "d7e1d85b68773871a578791ad57e0a08e421a220738e561b9e09ce22f9aee23d",
            },
        },
        "context": {
            "path": "src/i18n/catalogues/en/mobile.{computers,session,settings}.context.json - role+note for the same 33 keys",
            "sha256": "3227926233850015fd08bd75df7645d4b3f88c16e370eccdeb6497fc35523305",
            "sha256_at_base": "c08984e3269537e6c35bde77aff0d3754dd46ecb974c8e9d108df7c315dce2d4",
            "changed_since_base": [
                "mobile.session.tray.context_short (note)",
                "mobile.session.tray.context_short_estimate (note)",
            ],
            "note": "the two note edits are the round-1 remediation of the short-form rule; they carry no user-facing copy",
        },
        "style_guides": {
            "paths": [
                "i18n/style-guides/fr.md (core repo ~/local-operator)",
                "i18n/glossary.md (core repo)",
                "docs/i18n.md (this repo)",
            ],
            "note": "read as the authority for register, kept-English list, spacing and width exceptions; not hashed because the core repo is not part of this PR's audited bytes",
        },
        "bundle_reference": {
            "path": "i18n/audits/evidence/fr/m2-expression-literals/final.json",
            "sha256": "1db648167ce217cbacc3cc35a805ffece233627141180c2813dd2a525ab7c0bf",
            "note": "still equals the PRE-delta 33 values; it therefore differs from shipped bytes on exactly the one key this report attests. Not edited to fake agreement.",
        },
    },
    "call_sites_read": [
        "app/(app)/session/[id].tsx:130-150 (contextFact; `narrow` = viewportWidth < 340, D17)",
        "app/(app)/session/[id].tsx:918-926 (trayFacts.context), :997-1008 (activity band), :1690-1698 (More sheet row), :1635 (contextLabel)",
        "src/features/session/components/status-tray.tsx:26-60 (StatusTrayFacts.context, statusTraySummary join)",
    ],
    "mechanical": {
        "validator_generate_check": "exit 0 - catalogue.gen.ts is current (684 keys, 21 namespaces)",
        "validator_check_strings": "exit 0 - 212 findings, all baselined; 0 new",
        "placeholders": "names and multiplicity identical to en for all 33 keys",
        "icu": "no plural/select message in this group in either language; no CLDR category question arises for fr",
        "structural_tokens": "·, ↑, ↓ counts equal to source; U+202F before % present in the four tray values",
        "encoding": "all values NFC, no empty strings, no padding, no ASCII apostrophe, no bidi control characters",
        "negative_control": "six in-memory mutations each flagged (placeholder rename, glyph dropped, trailing pad, case regression, identical-to-en, U+202F dropped) and the mutated pair set hashes differently; nothing written",
    },
    "findings": [
        {
            "id": "m1",
            "severity": "MINOR",
            "gating": False,
            "key": "mobile.session.tray.context_short (en sidecar note)",
            "problem": (
                "The note's premise is inverted: it says the short form only renders in full-width rows "
                "(value cell 318 pt at 390 pt wide) so brevity is not needed, but the short form is selected at "
                "viewportWidth < 340 and paints the narrow activity band, while the 390 pt sheet cell renders the "
                "FULL form. The same note is the stated basis for moving es and vi to full forms (20 and 18 cells), "
                "longer than the 17-cell string D17 says wraps that band."
            ),
            "suggested": "Restore the true justification (band under 340 pt, D17) and route the es/vi consequence to design/QA.",
        },
        {
            "id": "n1",
            "severity": "NIT",
            "gating": False,
            "key": "mobile.session.tray.context_short, mobile.session.tray.context_short_estimate",
            "problem": "ctx is accepted as a width exception but is not on the fr guide's kept-English list and is not recorded where fr exceptions live.",
            "suggested": "One line in core i18n/style-guides/fr.md recording the exception and the values it covers.",
        },
        {
            "id": "n2",
            "severity": "NIT",
            "gating": False,
            "key": "mobile.settings.diagnostics.stream_degraded (en sidecar note)",
            "problem": "'one word' is unsatisfiable in fr (3 words) and in es/ru/vi/ur as shipped.",
            "suggested": "Soften to 'one word where the language allows; no final full stop'. Value accepted as shipped.",
        },
    ],
    "ctx_exception_ruling": {
        "decision": "accepted_as_named_width_exception",
        "grounds": (
            "The short form is selected at viewportWidth < 340 and painted in the activity band beside the cost and "
            "the subagents chip, where the full word wraps the band to two lines (design round 2, D17). fr's full "
            "form is 17 cells (estimate 25) and no shorter French wording exists; fr already abbreviates the estimate "
            "natively ('estim.'), and 'ctx' is the consonant skeleton of 'contexte' as much as of 'context'."
        ),
        "not_grounds": (
            "Not accepted merely because the designer did not gate it. Had the narrow slot really been a 318-pt "
            "full-width cell, the full form would fit and a change would have been required."
        ),
        "condition": "record the exception in core i18n/style-guides/fr.md (n1)",
    },
    "audit_notes_not_execution_log": (
        "Judgments, severity calls and the ctx ruling are mine. Command output is in audit.log only; reads of call "
        "sites, sidecars and the core style guide are cited in the report but were not all replayed as commands."
    ),
    "artifacts": {
        "audit-delta-fr.md": {"path": f"{D}/audit-delta-fr.md", "sha256": art["audit-delta-fr.md"]},
        "audit.log": {"path": f"{D}/audit.log", "sha256": art["audit.log"]},
        "tools_sha256": tools,
        "scratch_only": True,
        "tracked_path_intended": "i18n/audits/evidence/fr/m2-expression-literals/delta-r2-c4024b49/ (not committed: this lane is read-only)",
    },
    "auditor": {
        "agent": "i18n-auditor",
        "session": "413dca6f8baa",
        "model": "deepseek/deepseek-flash",
        "actual_model_source": "session header ('Model: deepseek/deepseek-flash'); no model-switch notice and no fallback seen in this session",
        "fallback_used": False,
        "independent_from_translator_session": True,
        "translator": "i18n-translator / openai/gpt-6.1-sol (per i18n/audits/evidence/NOTE-m2-expression-literals.md)",
        "independent_from_earlier_fr_auditors": True,
        "target_locale_native_fluency": "fr - reasoning only, no MT service, no back-translation tool",
    },
    "ledger_command": (
        "none exists in this repository at c4024b49: package.json exposes i18n:generate, i18n:catalogue:check, "
        "i18n:strings:check and i18n:check only, and there is no ledger writer or ledger file. Nothing was written to "
        "any ledger; the status lives in this record and in the report."
    ),
    "current_report_verdict": {
        "status": "passed",
        "unresolved_blocker_major_count": 0,
        "detached_counts": {"blocker": 0, "major": 0, "minor": 1, "nit": 2},
        "finding_ids": ["m1", "n1", "n2"],
        "gate": "passed = no BLOCKER or MAJOR remains; m1/n1/n2 do not gate",
    },
    "deferred_not_re_raised": ["D3", "vi F3", "hi H-R1", "hi H-R2", "zh-CN MINOR-1", "Q2", "M3"],
    "posted_to_pr": False,
}

path = os.path.join(D, "record.json")
with open(path, "w") as f:
    f.write(json.dumps(record, indent=1, ensure_ascii=False) + "\n")
print("wrote", path)
print("report sha256:", art["audit-delta-fr.md"])
print("log sha256   :", art["audit.log"])
print("note len     :", len(
    "fr M2 33-key delta 3af477ee..c4024b49 (PR236 r2): stream_degraded case-only fix verified, 32 values byte-identical, ctx accepted as width exception (D17); 0B/0M/1m/2n; record+report i18n/audits/evidence/fr/m2-expression-literals/delta-r2-c4024b49/"))
