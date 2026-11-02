# Independent French delta audit — `mobile.session_health` (`fr29sm3`)

**Verdict: `passed` — SH-01 resolved (0 BLOCKER, 0 MAJOR).**

Actual model: `kimi/k3.1-pro`, reached through harness quota fallbacks from `anthropic/claude-sonnet-5-5` and `openai/gpt-6-astra`. Independent of the translator; no translation/MT service or back-translation used. This is a narrow final audit of `mobile.session_health.ended_placeholder`, not a new full-namespace or second independent high-visibility pass.

## Inputs and stated constraint

The English source is **“Send to reopen in your home folder…”**. Its sidecar says this is the placeholder in the empty message field of an ended conversation, that sending reopens the session in the user's home folder on the computer, and that the budget is **36 cells**, with a final U+2026. The related health-sheet sidecar makes the destination contrast explicit: the user's home directory, **not** its original project folder.

The manager explicitly refused the earlier `~` recommendation as developer shorthand in user-facing mobile copy. That refusal is a binding product-copy constraint for this audit, not a defect in the current string. No shell token is proposed again.

## Candidate history

| Candidate | Cells | Result |
|---|---:|---|
| `Envoyer rouvre dans votre dossier personnel…` | 44 | Rejected: 8 over budget; initial audit also found the opening clipped. |
| `Envoyer rouvre (dossier personnel)…` | 35 | Rejected: fits, but the detached parenthetical loses the grammatical destination and `your`. |
| `Rouvre dans votre dossier personnel…` | **36** | **Accepted.** Fits exactly, restores `dans votre`, and has no technical token. |

The superseded proposal `Envoyer la rouvre dans ~…` was 25 cells but is disallowed by the explicit `~` refusal.

Counts are JSON-decoded Unicode cell counts, with U+2026 as one cell. All characters in the three main candidates are printable, non-combining and not East Asian wide/fullwidth, so code-point and cell counts agree. UTF-8 byte counts are 46, 37 and 38 respectively; bytes are not the fit metric.

## Four checks

### 1. Fit — pass

The current value is **exactly 36 cells**, therefore within the 36-cell budget by zero spare cells. It retains the required final ellipsis. The real field sets `placeholderMaxLines={1}`, so this is a useful budget check, not rendered pixel proof.

### 2. Subject-less fragment — acceptable here

`Rouvre dans votre dossier personnel…` is a compact, natural placeholder fragment: the ended session supplies the implicit object of `rouvre`, and the empty message box supplies the action context. It reads as “Reopens in your home folder…”, not as a command to the user. The explicit destination avoids the earlier clipped `Envoyer rouvre…` opening, and no subject or object pronoun is grammatically required in this condensed UI construction.

The English `Send to reopen in your home folder…` explicitly encodes the send action. French is less explicit about sending, but the placeholder is visible only inside the empty message box, where typing and sending are the field's established action. The full sentence in `relay.health.ended_detail` — `Envoyez un message ou touchez « Reprendre » pour rouvrir la session dans votre dossier personnel.` — retains the complete explanation. The placeholder does not promise delivery, a reply, or successful reopening.

### 3. “Home folder” versus project folders — unambiguous enough

`votre dossier personnel` is a grammatical destination with an explicit owner and is the same wording used by the full health-sheet sentence. In this product context, **personal/home folder** contrasts with a folder belonging to a project; it does not read as “your project folder.” Unlike the rejected parenthetical, `dans votre dossier personnel` directly says where reopening occurs. The full sheet is available if the user needs the explicit computer/original-project distinction.

### 4. Best compliant string — yes

No concrete alternative fits 36 cells, contains no shell/technical token, and is more idiomatic while retaining both the reopening meaning and the unambiguous `your home` destination.

Two measured non-preferred alternatives confirm the trade-off rather than improve it:

- `Rouvre dans votre dossier d’accueil…` is also 36 cells, but `dossier d’accueil` is less natural here and can suggest a welcome/landing folder; the catalogue already consistently uses `dossier personnel` in the health sheet.
- `Rouvre dans le dossier utilisateur…` is 35 cells, but is more impersonal/system-sounding and drops the source's direct `your`.

Removing `votre`, replacing the destination with a detached parenthetical, or using `~` would each reintroduce a defect already rejected in this sequence. **Ship the current value and close SH-01.**

## Mechanical and recording limits

From the mobile repository root, `npm run -s i18n:check` exited 0: generated catalogue current at 143 keys / 10 namespaces; 284 string findings all baselined, zero new. JSON and exact 11/11/11 key/order parity passed. The current value has no ICU arguments, markup, bidi controls, combining marks or wide glyphs.

The mobile repository has no `i18n/ledger.json`, no audit-ledger package script, and no local evidence README. `docs/i18n.md` records the audit in the pull request. Consequently this bundle contains a proposed, **unwritten** ledger row; no CLI ledger receipt is claimed. No catalogue or other repository file was edited by this audit.
