# Independent French delta audit — `mobile.session_health` (`fr29sm2`)

**Verdict: `changes_requested` — SH-01 remains MAJOR (0 BLOCKER, 1 MAJOR).**

Previous round: [`fr29sh1`](../fr29sh1/report.md). Current scope is the single changed French value and exact namespace parity, not a fresh full-language review. Actual model: `kimi/k3.1-pro`, reached through harness quota fallbacks from `anthropic/claude-sonnet-5-5` and `openai/gpt-6-astra`. Independent of the translator; no translation/MT service or back-translation used.

## Actual input and delta

The actual file contains `Envoyer rouvre (dossier personnel)…`, not the malformed illustrative wording in the delegation brief. The real English is **“Send to reopen in your home folder…”**; its context requires that sending reopen the ended session **in the user’s home folder on the computer**.

The English and context hashes are unchanged from `fr29sh1`. The Git index holds the round-1 French bytes with the exact recorded SHA-256 `c28f177062c2a1a2d30a11e3167e40be0ae6d87f10f963fce762840fc2a6404c`. Comparing those bytes to the worktree proves that **only `mobile.session_health.ended_placeholder` changed**: the other 10 values, all 11 keys, and their order are unchanged. No key was added or dropped. English and context are unchanged.

## SH-01 — MAJOR — `mobile.session_health.ended_placeholder`

**Current:** `Envoyer rouvre (dossier personnel)…`

### Fit: fixed

The JSON-decoded value is **35 Unicode code points / 35 terminal cells**, including one for U+2026, within the **36-cell** budget by one cell. Its UTF-8 representation is 37 bytes; byte count is not the budget method. All characters are printable, non-combining and not East Asian wide/fullwidth, so code points and cells agree here.

### Meaning and idiom: not fixed

The bare indicative `rouvre` is itself natural concise French for “sending reopens [it]”: `Envoyer rouvre…` can stand without an explicit subject, with the session supplied by the ended-conversation context. Adding `la` is smoother but not grammatically mandatory.

The unresolved defect is the **detached, ownerless parenthetical**. `Envoyer rouvre (dossier personnel)…` no longer contains `dans votre`, so it does not grammatically identify the home folder as the destination of reopening. `dossier personnel` may instead be understood as a personal folder or a project folder. It does not reliably convey the source’s possessive **`your home folder`**, nor the context’s location **on the computer**. This is a clarity/accuracy defect in safety-adjacent pre-send copy, not a demand to use the informal word `perso`.

The current value is better than the 44-cell predecessor on fit, but worse on destination/possessive clarity. It does not close SH-01.

## Replacement to ship

**`Envoyer la rouvre dans ~…` — 25 cells.**

This keeps the formal register, makes `la` explicitly refer to the session, and uses the established `~` home-directory notation as the unambiguous destination. The preposition `dans` restores the relationship that the parenthetical omits. It preserves the final ellipsis and makes no success/response promise. `~` is a technical path token and remains English/ASCII as required.

If product copy forbids Unix home notation even for this developer-facing app, the longer plain-language alternative is `Envoyer la rouvre dans votre dossier personnel…` (46 cells), which **cannot** satisfy the 36-cell budget; no merely cosmetic parenthetical should be accepted as equivalent. Among strings that satisfy the stated budget and unambiguously mean the user’s home folder, `Envoyer la rouvre dans ~…` is the one I would ship.

The earlier `Envoyer la rouvre (dossier perso)…` (34 cells) is not preferred now: it has the same detached-parenthetical weakness, and `perso` is too spoken for this safety-adjacent string. The current wording is not preferable merely because it uses the more formal `personnel`.

## Mechanical check and evidence limits

`npm run -s i18n:check` passed: generated catalogue current at 143 keys / 10 namespaces; 284 string findings all baselined, zero new. Independent JSON/key checks passed; the changed value has no ICU arguments, markup, bidi controls, combining marks or wide glyphs. This is a one-value delta audit, not rendered evidence of pixel fit or a new second independent high-visibility pass. No catalogue file was edited by this audit.

`audit.log` records the actual reads, hashes, counts, index comparison and validator execution. The requested bundle path is retained here: `i18n/audits/evidence/fr/mobile.session_health/fr29sm2/`.
