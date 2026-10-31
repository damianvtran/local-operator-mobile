"""Generate the four ur group-B evidence bundles from the audit's findings.

Writes ONLY under the ur-wave evidence dir (absolute) and reads the real audit.log
produced by run-audit.sh / precedent.sh / scan2.sh. Hashes are computed here from the
files on disk, never typed.
"""
import hashlib
import json
import os
import shutil

S = "<scratch>/ur-audit-b"
W = "<scratch>/ur-wave"
E = W + "/i18n/audits/evidence/ur"
C = W + "/src/i18n/catalogues/"


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


LOGSHA = sha(S + "/audit.log")
IDS = {"schedules": "ur30b1", "projects": "ur30b2", "notifications": "ur30b3", "computers": "ur30b4"}
ROUTE = (
    "Catalogue, sidecars, scripts and generate.ts read by ordinary worktree file reads and "
    "`git show origin/main:` of the core repo; NOT the read_public_copy route (refused for "
    "src/i18n/**). Context sidecars are nested JSON, not routable. No receipt claimed."
)

F = {
    "schedules": [
        dict(id="S1", severity="MAJOR", keys=["mobile.schedules.state.dormant"],
             current="غیر فعال", replacement="خوابیدہ",
             why=("Composed-screen contradiction. The monitors header reads «{count} فعال» (armed) and "
                  "dormant rows are counted in it (monitorAlerting excludes dormant, so the header stays "
                  "«5 فعال»), while the dormant row's own slot says «غیر فعال» — the literal antonym of "
                  "فعال — directly beneath. It also spends the standard Urdu word for DISABLED (core uses "
                  "غیر فعال for disabled) on the weaker state while the stronger state, disabled, is «بند». "
                  "Rendered: header «5 فعال» + dormant slot «غیر فعال» (before) vs «خوابیدہ» (after). "
                  "If خوابیدہ is judged too literary: «سویا ہوا». Not «معطل» (collides with the parked "
                  "clause's meaning)."),
             verified=("tsx repl.ts 'S1 composed BEFORE/AFTER' lines in audit.log; read of "
                       "schedules-copy.ts monitorAlerting/monitorSectionSummary; core ur grep for "
                       "غیر فعال=disabled (wire.errors.desktop.aida_disabled).")),
        dict(id="S2", severity="MAJOR", keys=["mobile.schedules.supervisor.not_running"],
             current="بیداریوں کا سپروائزر انسٹال تو ہے مگر چل نہیں رہا، اس لیے نیچے دی گئی بیداریاں نہیں چلیں گی۔",
             replacement="بیداریوں کی نگرانی کرنے والی سروس انسٹال تو ہے مگر چل نہیں رہی، اس لیے نیچے دی گئی بیداریاں نہیں چلیں گی۔",
             why=("Glossary inconsistency on one screen. The three supervisor sentences are alternatives of "
                  "one status line: unsupported/unverifiable say «بیداریوں کی نگرانی» for 'supervised', only "
                  "not_running introduces a transliterated «سپروائزر». i18n/glossary.md note 7 records, for ur, "
                  "that 'supervised' is rendered with the existing monitor word نگرانی because none of the "
                  "locales has a settled word for a supervisor unit and inventing one would give one concept "
                  "two names; core tui.schedule.notice_supervisor does the same. Replacement keeps that call, "
                  "names the thing descriptively, and agrees in gender (سروس is feminine: چل نہیں رہی)."),
             verified=("git show origin/main:i18n/glossary.md note 7; core tui.schedule.notice_supervisor; "
                       "replacement parsed and rendered via parseMessage/formatMessage in repl.ts.")),
        dict(id="S3", severity="MINOR",
             keys=["mobile.schedules.show_more.wakes", "mobile.schedules.show_more.monitors"],
             current="{hidden, plural, one {# اور بیداری دکھائیں} other {# اور بیداریاں دکھائیں}} (and the monitors twin)",
             replacement=("{hidden, plural, one {# مزید بیداری دکھائیں} other {# مزید بیداریاں دکھائیں}} ; "
                          "{hidden, plural, one {# مزید نگرانی دکھائیں} other {# مزید نگرانیاں دکھائیں}}"),
             why=("Numeral + «اور» ('21 اور بیداریاں') parses as the conjunction 'and'; the programme already "
                  "settled «مزید» for '# more' (core relay.session.tags.more: «# مزید ٹیگ / # مزید ٹیگز»). "
                  "Number agreement itself is correct at 1, 2, 21."),
             verified="render.ts at hidden=1,2,21; repl.ts after-render; core relay.session.tags.more grep."),
    ],
    "projects": [
        dict(id="P1", severity="MAJOR", keys=["mobile.projects.project_name_hint"],
             current="لمبائی 1 سے 64 حروف؛ نام میں الفبائی حروف، ہندسے، نقطہ، انڈر اسکور یا ہائفن ہو سکتے ہیں۔ خالی جگہ نہیں ہو سکتی، اور نام ہائفن سے شروع نہیں ہو سکتا۔",
             replacement="لمبائی 1 سے 64 حروف؛ نام میں صرف انگریزی حروف، 0 سے 9 تک ہندسے، نقطہ، انڈر اسکور یا ہائفن ہو سکتے ہیں۔ خالی جگہ نہیں ہو سکتی، اور نام ہائفن سے شروع نہیں ہو سکتا۔",
             why=("The sentence is 'the reader's only warning before a refusal' and must keep the allowed "
                  "characters exact (sidecar). To an Urdu reader «الفبائی حروف» means letters of the alphabet "
                  "— including their own — and «ہندسے» includes ۱۲۳. The relay accepts ONLY ASCII "
                  "(core projects._NAME_RE = ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$): control run shows "
                  "'پروجیکٹ' and '٣٤' are refused. An Urdu user is therefore invited to type exactly what "
                  "gets refused. Replacement states the alphabet (انگریزی حروف) and digits (0 سے 9) explicitly."),
             verified=("origin/main:local_operator/projects.py _NAME_RE read; repl.ts name-grammar control "
                       "(پروجیکٹ false, alpha true, ٣٤ false); replacement parsed and rendered.")),
        dict(id="P2", severity="MINOR", keys=["mobile.projects.draft_kept_note"],
             current="آپ کی پچھلی بار کی تحریر برقرار رکھی گئی ہے۔ نئی چیز شروع کرنے کے لیے خانے صاف کریں۔",
             replacement="آپ کی پچھلی بار کی تحریر برقرار رکھی گئی ہے۔ کچھ نیا شروع کرنے کے لیے خانے صاف کریں۔",
             why="«نئی چیز» is a word-for-word 'something new' calque; «کچھ نیا» is the natural Urdu.",
             verified="repl.ts render before/after."),
    ],
    "notifications": [
        dict(id="N1", severity="MINOR",
             keys=["mobile.notifications.dismiss", "mobile.notifications.detail.nothing_to_dismiss"],
             current="ہٹائیں ; اس گفتگو سے ہٹانے کے لیے کوئی اپ ڈیٹ نہیں۔",
             replacement="خارج کریں ; اس گفتگو سے خارج کرنے کے لیے کوئی اپ ڈیٹ نہیں۔",
             why=("The phone inbox mirrors the relay inbox, whose core Urdu for 'Dismiss' is «خارج کریں» "
                  "(relay.notifications.row.dismiss / confirm.dismiss / detail.dismiss); «ہٹائیں» is core's "
                  "TUI wording AND this app's word for 'remove' (milestone remove), so an icon-only a11y "
                  "label «ہٹائیں» reads as delete/remove. Not wrong, so MINOR; both attested in core."),
             verified="core ur relay.notifications.* vs tui.notifications.hint_dismiss grep in precedent.out; repl.ts render."),
    ],
    "computers": [
        dict(id="C1", severity="MINOR", keys=["mobile.computers.password_placeholder"],
             current="وہ پاس ورڈ جو lop mobile سے ملا",
             replacement="lop mobile سے ملنے والا پاس ورڈ",
             why=("Placeholder reads as a half-clause with a past-tense «ملا» ('the password that was got'); "
                  "the participle phrase is the natural placeholder form, shorter, and keeps `lop mobile` "
                  "as one intact LTR island (fribidi visual order checked for the current text; the "
                  "replacement has the same single island)."),
             verified="repl.ts render; bidi.sh fribidi output for the current string."),
    ],
}

NOTES = {
    "schedules": [
        "head.next/head.overdue render clean: «3 بیداریاں · اگلی بار 4m بعد», «1 بیداری · 2h سے تاخیر», «2 بیداریاں · اگلی بار 1h30m بعد», «21 بیداریاں · 45s سے تاخیر». No doubled postposition: ahead is «{label} بعد» and next supplies only «اگلی بار» (same wording as core tui.schedule.detail_next/due_in/due_overdue). Overdue drops «اگلی بار» exactly as the sidecar demands.",
        "truncated: oblique plural after numeral+میں سے is correct («2 گفتگوؤں میں سے»), singular «1 گفتگو میں سے»; shown agrees with the feminine گفتگو («1 … رہی ہے» / «2 … رہی ہیں»); select arms wakes→بیداریوں, other→نگرانیوں grammatical; an unknown family falls to نگرانیوں like English. Counts 0/1/2/21 all read correctly. generate.ts permits the text→plural escalation on shown/total.",
        "Plural categories: Intl.PluralRules('ur') = one/other only, 0→other; both app formatter and Intl agree (audit.log).",
        "cadence.* and due.* compose cleanly with duration tokens (ہر 1d · 3 باقی; ہر 1h30m · کوئی ڈیلیوری باقی نہیں); fribidi shows every Latin duration as an intact LTR island.",
    ],
    "projects": [
        "write_receipt: 4 kinds x 8 actions (7 codes + unknown) all rendered and read (audit.log): verb-final, correct masculine agreement for پروجیکٹ/سنگ میل/bare name, unknown kind and unknown action fall back to the 'other' arm / «اپ ڈیٹ کیا گیا». «“{subject}”» quoting is a translator addition (EN is unquoted); harmless and consistent with delete_body/remove_milestone_body.",
        "milestones.count «{total} میں سے {completed} سنگ میل»: سنگ میل is invariant in the plural, so no agreement needed at any count; joined row meta «5 میں سے 2 سنگ میل · 3 سیشنز». sessions.count one/other with سیشنز matches core usage (relay.approvals «تمام سیشنز»).",
        "English-source observation (NOT an Urdu defect, not filed as one): the relay regex also rejects a leading '.' or '_' (only [A-Za-z0-9] may start a name), but the EN hint (and the Urdu) say only 'can't start with a hyphen'. The Urdu follows the source faithfully.",
    ],
    "notifications": [
        "اطلاعات / اعلیٰ / پچھلی اپ ڈیٹس / ماخذ / پروجیکٹس all match core relay.notifications and tui.notifications precedents; no glossary violation.",
    ],
    "computers": [
        "stays_listed: EN 'It' is ambiguous; the Urdu names «پچھلا کمپیوٹر» as the sidecar and the code flow (adding a computer, 'switch back') require. Correct.",
        "Outside the catalogue: computers.tsx:654 still hard-codes the English line 'Connected to {name}.' immediately above this sentence, so the Urdu reader gets one English line on that card. Wiring/source scope, not a translation finding.",
        "badge.connecting «منسلک ہو رہا» is the same wording as the recorded relay.health.reconnecting width exception; no maxCells/maxChars hint exists in these sidecars.",
        "Test-suite signal (not a copy defect): src/i18n/__tests__/catalogues.test.ts 'ships no locale the runtime cannot render' fails with ur present but not in SHIPPED_LOCALES (68 tests, 67 pass). Wiring scope for the translator/manager.",
    ],
}

for ns, ID in IDS.items():
    en = json.load(open(f"{C}en/mobile.{ns}.json", encoding="utf8"))
    ur = json.load(open(f"{C}ur/mobile.{ns}.json", encoding="utf8"))
    cx = json.load(open(f"{C}en/mobile.{ns}.context.json", encoding="utf8"))
    d = f"{E}/mobile.{ns}/{ID}"
    os.makedirs(d, exist_ok=True)
    shutil.copy(S + "/audit.log", d + "/audit.log")
    nmaj = sum(1 for f in F[ns] if f["severity"] in ("MAJOR", "BLOCKER"))
    verdict = "changes_requested" if nmaj else "passed"
    findings = [{"id": f["id"], "severity": f["severity"], "key": " / ".join(f["keys"]),
                 "current": f["current"], "replacement": f["replacement"], "why": f["why"],
                 "verified": f["verified"]} for f in F[ns]]
    rec = {
        "schema": 1, "audit_kind": "independent_first_pass", "audit_id": ID,
        "locale": "ur", "namespace": f"mobile.{ns}", "audit_date": "2026-10-30",
        "wave": "ur wave — damianvtran/local-operator-mobile, branch feat/i18n-urdu, group B (schedules/projects/notifications/computers)",
        "audited_revision": "32c7677 (main) plus the translator's UNCOMMITTED src/i18n/catalogues/ur/ (git status in audit.log)",
        "key_count": {"en": len(en), "target": len(ur), "context": len(cx)},
        "keyset_equal": sorted(en) == sorted(ur),
        "auditor": {
            "agent": "i18n-auditor (lopdev team)", "session": "b5f20e88b803",
            "model": "anthropic/claude-sonnet-5-5", "actual_model": "anthropic/claude-sonnet-5-5",
            "actual_model_source": "Session system header names anthropic/claude-sonnet-5-5; no model-switch/fallback header was observed in this turn. Fallback: none observed.",
            "independent_from_translator_session": True,
            "independence": "Not the translator and not the group A auditor; group A bundles were not read. No human native-speaker review and no rendered device frame are claimed; renders are through the app's own parseMessage/formatMessage only.",
        },
        "route": ROUTE,
        "input_hashes": {
            "en": {"path": f"src/i18n/catalogues/en/mobile.{ns}.json", "sha256": sha(f"{C}en/mobile.{ns}.json")},
            "context": {"path": f"src/i18n/catalogues/en/mobile.{ns}.context.json", "sha256": sha(f"{C}en/mobile.{ns}.context.json")},
            "ur": {"path": f"src/i18n/catalogues/ur/mobile.{ns}.json", "sha256": sha(f"{C}ur/mobile.{ns}.json")},
        },
        "redaction_scan": {"markers_found": 0,
                           "scope": "ur+en+context for this namespace (scan.py) and the git-read style guide, glossary, core ur catalogues and projects.py (scan2.sh); both counts in audit.log"},
        "bidi_control_chars_in_target": 0,
        "mechanical": {
            "param_parity_via_parseMessage": "0 placeholder-name mismatches across all 77 group-B keys; the only kind difference is mobile.schedules.truncated shown/total text->plural, an escalation generate.ts permits",
            "generate_check": "scripts/i18n/generate.ts --check: catalogue.gen.ts is current, rc 0 (read-only mode)",
            "plural_rules": "Intl.PluralRules('ur'): 0 other, 1 one, 2 other, 21 other, 100 other; app pluralCategory agrees",
            "width": "no maxCells/maxChars hint in any group-B en context sidecar (count 0); no width finding possible",
            "scoped_vitest": "catalogues.test.ts + messages.test.ts: 67 pass, 1 fail (ur not in SHIPPED_LOCALES yet; wiring, not copy)",
        },
        "artifacts": [
            {"path": f"i18n/audits/evidence/ur/mobile.{ns}/{ID}/audit.log", "sha256": LOGSHA,
             "kind": "actual_execution_log (verbatim concatenation of three captured script runs)"},
            {"path": f"i18n/audits/evidence/ur/mobile.{ns}/{ID}/report.md", "kind": "audit report (audit notes, not an execution log)"},
        ] + ([{"path": "i18n/audits/evidence/ur/mobile.schedules/ur30b1/tools/", "kind": "the scripts that produced audit.log (shared by ur30b1..4)"}] if ns == "schedules" else []),
        "audit_notes_not_execution_log": "report.md is audit notes. Only audit.log is an execution log; the same file is copied byte-identically into ur30b1..ur30b4 because one run covered all four namespaces. Scripts are in ur30b1/tools/.",
        "findings": findings,
        "observations_not_findings": NOTES[ns],
        "current_report_verdict": {"status": verdict, "unresolved_blocker_major_count": nmaj,
                                   "finding_ids": [f["id"] for f in F[ns]]},
    }
    json.dump(rec, open(d + "/record.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)

    flagged = {}
    for f in F[ns]:
        for k in f["keys"]:
            flagged.setdefault(k, []).append(f["id"])
    cnt = lambda s: sum(1 for f in F[ns] if f["severity"] == s)
    L = [f"# ur · mobile.{ns} · {ID} — independent audit", "",
         f"**Verdict: {verdict}** · keys {len(en)}/{len(ur)} (en/ur), keyset equal: {sorted(en) == sorted(ur)} · BLOCKER 0 · MAJOR {cnt('MAJOR')} · MINOR {cnt('MINOR')} · NIT {cnt('NIT')}", "",
         "Auditor: i18n-auditor (lopdev), session b5f20e88b803, model anthropic/claude-sonnet-5-5 (no fallback observed).", "",
         f"Route: {ROUTE}", "",
         "Redaction markers: **0** · bidi/zero-width control chars in target: **0** · `generate.ts --check`: current · placeholder-name parity: 0 mismatches.", "",
         "## Findings", ""]
    if not F[ns]:
        L += ["none", ""]
    for f in F[ns]:
        L += [f"### {f['id']} — {f['severity']} — `{' / '.join(f['keys'])}`", "",
              f"- current: `{f['current']}`", f"- replacement: `{f['replacement']}`",
              f"- why: {f['why']}", f"- verified: {f['verified']}", ""]
    L += ["## Observations (not findings on the Urdu text)", ""] + [f"- {n}" for n in NOTES[ns]] + [""]
    L += ["## Per-key read (each key read against EN text, sidecar note and, where composed, its call site)", "",
          "| key | role | result |", "|---|---|---|"]
    for k in en:
        L.append(f"| `{k.replace('mobile.' + ns + '.', '')}` | {cx[k].get('role')} | {', '.join(flagged[k]) if k in flagged else 'ok'} |")
    L += ["", "Commands and their actual output: `audit.log` in this directory."]
    open(d + "/report.md", "w", encoding="utf8").write("\n".join(L) + "\n")
    print(ns, ID, verdict, nmaj, len(en), len(ur))

os.makedirs(f"{E}/mobile.schedules/ur30b1/tools", exist_ok=True)
for f in ["parity.ts", "scan.py", "dump.py", "render.ts", "repl.ts", "run-audit.sh", "precedent.sh", "scan2.sh", "bidi.sh", "mk.py"]:
    shutil.copy(f"{S}/{f}", f"{E}/mobile.schedules/ur30b1/tools/{f}")
