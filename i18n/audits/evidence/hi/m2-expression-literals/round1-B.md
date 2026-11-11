# M2 hi lane B — verdict: clean-with-findings (0 BLOCKER, 0 MAJOR, 4 MINOR, 3 NIT)
Auditor model: anthropic/claude-sonnet-5-5 (as served; no fallback).
Mechanical: 27/27 keys, order == keys27.json; placeholders {baseUrl},{host},{percent},{labels},{name} identical; no empties; NFC; no bidi/ZW controls; glyphs ·↑↓()% counts match; danda on all full-sentence keys, none elsewhere; only English-identical = app_name (deliberate).
Findings in the main message.

## Findings
- MINOR session.region.more_below "नीचे और है · नीचे स्क्रॉल करें ↓": "और है" has no noun (rows hidden); suggest "नीचे और पंक्तियाँ · स्क्रॉल करें ↓".
- MINOR session.region.below_labels "नीचे {labels} · नीचे स्क्रॉल करें ↓": नीचे twice in one pill; suggest "नीचे: {labels} · स्क्रॉल करें ↓". region.end: "अंत · स्क्रॉल करें ↑" (drop redundant ऊपर, arrow carries it). Shipped catalogue has no स्क्रॉल precedent (0 hits) — no conflict.
- MINOR settings.diagnostics.stream_connecting "जुड़ रहा": shipped English-"connecting" keys use "कनेक्ट हो रहा" (computers.badge.connecting, computers.connecting, chrome.home.connecting, relay.health.reconnecting); "जुड़" only in "फिर जुड़ रहा". Suggest "कनेक्ट हो रहा" (same Settings screen as Status "कनेक्ट है").
- MINOR settings.diagnostics.stream_idle "निष्क्रिय": shipped uses it for schedules.state.dormant, and "Idle" is आइडल (relay.chrome.session.subtitle.idle). Suggest "आइडल". stream_live "सक्रिय" collides with computers.badge.active; relay.health.live "Live"=ऑनलाइन (also pairs with ऑफ़लाइन). Prefer "ऑनलाइन" (or accept; shipped projects.sessions.live also uses सक्रिय).
- MINOR session.tray.context_short(_estimate) identical to full forms; "(अनुमानित)" is longer than English "(est.)" and the full form already wraps <340pt (design D17), so the narrow variant does not narrow. Suggest context_short_estimate "{percent}% संदर्भ (अनु.)"; short non-estimate fine as-is (no Hindi abbreviation).
- NIT computers.wait.host_answering: "provisioned" -> "तैयार" is loose; "रूट बन जाने का मतलब…" ; "{host} पर मौजूद आपके कंप्यूटर के जवाब का इंतज़ार है" avoids reading "{host} पर" as the waiting place.
- NIT stream_degraded "बाधित" ok for "open but not answering"; "धीमा/अनुत्तरदायी" not better. No change needed.
- NIT wiring (not translation): video.tsx:172 / agent/[jobId].tsx:92 still build `Back to ${parentName}` in English, so the Hindi "सत्र" lands in an English sentence.
## Checked OK
connected_to "{name} से कनेक्ट हो गया।" + fallback "आपके कंप्यूटर" -> "आपके कंप्यूटर से कनेक्ट हो गया।" grammatical (oblique, postposition से); a real name also reads fine. not_answering == relay.chrome.session.subtitle.not_answering ("उत्तर नहीं दे रहा"). not_connected == mobile.home.picker.not_connected. route_radient fem. टनल "आपकी" agrees; "रूट"/"टनल"/"कंप्यूटर"/"सत्र"/"वीडियो"/"संदर्भ"/"कनेक्ट" match shipped and M1. Register आप-neutral, no imperatives to user other than स्क्रॉल करें.
