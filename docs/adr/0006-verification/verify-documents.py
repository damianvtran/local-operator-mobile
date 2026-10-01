"""Assert what ADR 0006 and docs/push-plan.md say about THEMSELVES — nothing about the code.

    python3 docs/adr/0006-verification/verify-documents.py [git-ref]

No argument reads the working tree; a git ref (a commit SHA, a branch) reads that tree with
``git show``, which is how the pushed head is checked before a remediation comment claims anything.
The pinned *sources* are a different job: ``resolve-citations.py`` (does the path exist and the line
resolve) and ``read-citations.py`` (does the line support the claim). This script never opens them,
so a pass here says the documents are internally consistent and say what the round claims — not that
any of it is true of ``local-operator``.
"""
import os, pathlib, subprocess, sys, textwrap
REPO = os.environ.get("LOCAL_OPERATOR_REPO", "~/local-operator")
REF = sys.argv[1] if len(sys.argv) > 1 else "WORKTREE"   # a git ref, or WORKTREE to read the files
def show(ref, path):
    if ref == "WORKTREE":
        # The worktree default reads this repository's own files, so the failure it can hit is a
        # missing/unreadable document — the same class as an unknown ref, and it exits the same way
        # rather than raising a FileNotFoundError (round 10, R10-m1 / Q-F34).
        try:
            return open(path, encoding="utf-8").read()
        except OSError as exc:
            print(f"UNUSABLE INPUT: cannot read {path} from the working tree — {exc.strerror} "
                  f"(pass a git ref as the first argument to read a pushed tree instead)",
                  file=sys.stderr)
            raise SystemExit(2)
    out = subprocess.run(["git","show",f"{ref}:{path}"],capture_output=True,text=True)
    if out.returncode != 0:
        #: An unknown ref or an unusable checkout is a SETUP error, not a failed check: exit 2 with
        #: the reason, never a CalledProcessError traceback (round 9, Q-F31).
        print(f"UNUSABLE INPUT: cannot read {ref}:{path} — {out.stderr.strip().splitlines()[-1] if out.stderr.strip() else 'no such ref or path'} (git show runs in {pathlib.Path.cwd()}; LOCAL_OPERATOR_REPO is not consulted here)",
              file=sys.stderr)
        raise SystemExit(2)
    return out.stdout
def try_read(ref, path):
    """Read a file that MAY be absent: the ref's copy in ref mode, the working tree otherwise.

    The README used to be read from the CWD even in ref mode, so validating a pushed branch from a
    different checkout could pass or fail on the WRONG tree's README (round 11, R11-m1). Every file
    this script checks now comes from the tree it names.
    """
    if ref == "WORKTREE":
        try:
            return pathlib.Path(path).read_text()
        except OSError:
            return None
    out = subprocess.run(["git", "show", f"{ref}:{path}"], capture_output=True, text=True)
    return out.stdout if out.returncode == 0 else None

has_readme = next((t for t in (try_read(REF, c) for c in
                               ("docs/adr/0006-verification/README.md", "0006-verification/README.md"))
                   if t), "")
# The ADR amends this repository's own docs/architecture.md, so the file is read rather than only
# quoted: a check that never opens the file it is about cannot fail, which is how the round-10
# assertion-failure recipe went wrong (round 11, R11-n2).
ARCH = try_read(REF, "docs/architecture.md") or ""
A = show(REF, "docs/adr/0006-push-and-ack-sync.md")
P = show(REF, "docs/push-plan.md")
af = " ".join(A.split()); pf = " ".join(P.split())
def ok_order(plan_text):  # last 9 ids ascending
    """Q17 < Q18 < ... < Q24 in the QA matrix (round 4 n1)."""
    import re as _re
    ids = [int(m) for m in _re.findall(r"^\| Q(\d+) \|", plan_text.split("## Not in this plan")[0], _re.M)][-9:]
    return ids == sorted(ids)

def has(hay, needle): return needle in hay
rows = [
 ("B1 three sites: other-channels.md:172-174", has(af,"other-channels.md`:172-174")),
 ("B1 three sites: current-relay-audit.md:220-222", has(af,"current-relay-audit.md`:220-222")),
 ("B1 three sites: architecture.md:299", has(af,"architecture.md`:299")),
 #: The row must EXIST at the ref AND carry the amendment: the pre-amendment row contains the same
 #: phrase, so asserting only the phrase proves the row is there, not that this ADR's amendment landed
 #: (round 12, review m1 / QA Q-F38). `b6ff95c` added the ADR and amended this row in one commit, so a
 #: ref carrying the document always carries the amendment.
 ("B1 the amended site carries the amendment, read at this ref",
  has(ARCH,"Push notifications (APNs/FCM)") and has(ARCH,"**Answered:**")
  and has(ARCH,"adr/0006-push-and-ack-sync.md")),
 ("B1 false 'four sites' sentence gone", not has(af,"The four sites above")),
 ("B1 seven-sites sentence present", has(af,"All seven of the sites above")),
 ("B1 web/src/store.ts:407 in the list", has(af,"#11's `attentionCount`, `web/src/store.ts:407`")),
 ("B2 mapping models/desktop_sessions.py", has(af,"`local_operator/server/models/desktop_sessions.py` → `models/desktop_sessions.py`")),
 ("B2 mapping routes/desktop_sessions.py", has(af,"`local_operator/server/routes/desktop_sessions.py` → `routes/desktop_sessions.py`")),
 ("B2 mapping utils/desktop_sessions.py", has(af,"`local_operator/server/utils/desktop_sessions.py` → `utils/desktop_sessions.py`")),
 ("B2 mapping session.py", has(af,"`local_operator/session/session.py` → `session.py`")),
 ("B2 mapping web/src/store.ts", has(af,"`local_operator/mobile/web/src/store.ts` → `web/src/store.ts`")),
 ("B2 mapping resume.py (path corrected, QA-F1)", has(af,"`local_operator/resume.py` → `resume.py`")),
 ("B2 USER_ORIGINS cited to resume.py:169", has(af,"`USER_ORIGINS` (`resume.py:169`)")),
 ("B2 _is_hidden_origin cited to resume.py:1715", has(af,"`_is_hidden_origin` (`resume.py:1715`)")),
 ("B3 pin row: pinned SHA, not origin/main", has(af,"a pinned SHA, and *not* `origin/main`")),
 ("B3 pin row: 16 commits behind, dated", has(af,"16 commits behind** it as measured on **2026-09-30**")),
 ("B3 pin row: origin/main = d5346e173", has(af,"`origin/main` = `d5346e173`")),
 ("B3 pin row: the drift is described, not cited", has(af,"app.py 40600 on current main against 40562 here") and has(af,"`:800` against `:704`")),
 ("B3 §9 distance is dated 16", has(af,"**16 commits behind** as measured 2026-09-30")),
 ("B4 slice table: no count-drop", not has(af,"count-drop") and not has(pf,"count-drop")),
 ("B4 slice table: two cursors", has(af,"two cursors + baseline")),
 ("B4 slice table: structural detection", has(af,"structural detection (`revision()` equality as the trigger")),
 ("B4 slice table: advances only on 202", has(af,"advances only on the cloud's `202`")),
 ("B5 emit bound stated honestly", has(af,"at most one emit per change") and not has(af,'exit criterion is "at most one emit per ack"')),
 ("§2.1 supersede cursor", has(af,"`AttentionStore.superseded_since(cursor)` (`attention.py:1740`)")),
 ("§2.1 revision() as trigger only", has(af,"used as the *trigger*")),
 ("§2.1 cursor advances only on accept", has(af,"advances only on emit, and \"emit\" means the cloud's accept")),
 ("§3.1 202 {emit_id, accepted_at}", has(af,"202 {\"emit_id\": \"<uuid>\", \"accepted_at\"")),
 ("§3.1 per-device result replaced", has(af,"replaces the previous\ndraft") or has(af,"replaces the previous draft")),
 ("§3.1 exclude on the wire", has(af,'"exclude": ["<device_id>"]')),
 ("§3.2 exclude row in the field table", has(af,"| `exclude` *(attention only)* |")),
 ("§3.4 heal key minted on the supersede cursor", has(af,"because a heal is read on the supersede cursor")),
 ("§2.2 ops-note retention + gap", has(af,"delivery records are kept **14 days**") or has(af,"kept **14 days**")),
 ("provenance row for the ops note (cross-PR)", has(af,"cross-PR")),
 ("QA-F1 named in the provenance intro", has(af,"QA round 1's **Q7**") and has(af,"**does not exist at the pin**")),
 ("n1 attention.py:2129-2149 in every citation (old value only in the corrections record)", af.count("2129-2149")>=3 and af.count("2129-2150")==1),
 ("n2 session-projection.ts:56-70 in every citation (old value only in the corrections record)", af.count("session-projection.ts:56-70")>=2 and af.count("session-projection.ts:61-66")==1),
 ("§1.2 one predicate named", has(af,"one predicate, named once") or has(af,"one predicate, named once (review QA Q14)")),
 ("§1.1 list payload count absent when degraded", has(af,"same `degraded` rule applies to this payload")),
 ("plan S6 structural detection", has(pf,"structural detection")),
 ("plan S7 202 accepted", has(pf,"202 {emit_id, accepted_at}")),
 ("plan Q16 publish+ack in one tick", has(pf,"publish and an ack land in the same 2 s tick")),
 ("plan Q17 heal + /seen in one tick", has(pf,"a heal lands and a relay `/seen` arrives in the same tick")),
 ("plan Q18 cloud refusal/timeout", has(pf,"a cloud refusal or timeout")),
 ("R7 the operators-only route is back, gated by the machine key", (not has(af,"there is no `unrevoke` route")) and has(af,"POST /api/push/devices/{device_id}/unrevoke → {\"ok\": true") and has(af,"X-Lop-Operator-Key")),
 ("R7 the CLI is the operator surface over loopback", has(af,"**The CLI is the operator surface**") and has(af,"needs the mobile daemon running") and has(af,"daemon_unreachable") and has(af,"operator_key_missing")),
 ("S4a asserts the machine_only DEFINITION, not the word", has(pf,"gets `403 {\"code\":\"machine_only\",\"error\":\"a device cannot restore itself — use the computer or your account\"}`") and has(pf,"adopting core PR #1864's predicate")),
 ("R4/R5 M1+M6 note re-checked at its head, three divergences", has(af,"As of **`30a0f4d`**") and has(af,"the four divergences the round named are closed") and has(af,"authority on the rate") and has(af,"The credential epoch") and has(af,"The single-route claim")),
 ("R4 M2 no deletion language anywhere", not has(pf,"deletion on revocation") and not has(pf,"removal on unpair") and not has(pf,"deletes it in the cloud") and not has(af,"unpair removal")),
 ("R4 M2 tombstones stated in the plan", has(pf,"tombstoning on revocation (`revoked_at`) and on unpair (`unpaired_at`) \u2014 the row stays")),
 ("R4 m1/QA-F3 no epoch", has(af,"**There is no credential \"epoch\"**") and has(af,"separate \"credential epoch\"")),
 ("R4 m2 gate 4 + the emit-side skip", has(af,"at least one **registered device whose credential is live**") and has(af,"the worker skips such a device entirely")),
 ("R4 m3 attribution is bound", has(af,"**Attribution is bound, not asserted**") and has(af,"moves no device's state") and has(af,"DECIDED relay shapes, not proposals")),
 ("R4 m4 the revoke-race QA row", has(pf,"| Q24 | a revoke (or unpair) lands **while an emit for that device is in flight**")),
 ("R6 the report has a named carrier and a heartbeat route", has(af,"The carrier is named, and every addition below is") and has(af,"devices: [{device_id: str, credential_live: bool") and has(af,"POST <cloud>/v1/push/credentials")),
 ("R4/R6 n1 the matrix is in order", ok_order(P)),
 ("R7 the key is re-minted per register; the 409 is only the named alternative", has(af,"minted and returned by EVERY register call") and has(af,"next authenticated register") and has(pf,"A hash would force a one-time return plus a `409 device_key_required`")),
 ("R4 n3 the flag has one home", has(af,"**not** `credential_live`, which lives in the Credential row below")),
 ("R4 n5 the account-side surface has a home", has(af,"**account-side revoke/un-revoke surface**") and has(pf,"account-side revoke/un-revoke surface")),
 ("QA-F2 rule 2 is per route", has(af,"- **Direct route.**") and has(af,"- **Radient route.**") and has(af,"`docs/relay/tunnel-edge.md`:59-76") and has(af,"the cloud both mints and refuses the grant")),
 ("QA-F4 the report is in the privacy list", has(af,"and, per **device**, whether its credential is live and when it last authenticated")),
 ("QA-F5 the declared shorthand is used", has(af,"`utils/desktop_sessions.py:368`")),
 ("QA nit-1 ack, not tick", has(af,"which are the two things an acknowledgement moves")),
 ("core lane: S2 is aggregate-only", has(pf,"`push_handle` on the **aggregate's rows only**") and has(pf,"**rejected on frame size** \u2014 do not implement it")),
 ("R6 path 3 is per route", has(af,"**Direct route — a real lever.**") and has(af,"**Radient route — not a lever.**")),
 ("R6 the rotation outage is stated exactly", has(af,"reads the password **once, when the `Gateway` is constructed**") and has(af,"heals itself at that restart")),
 ("R6 the residual and the copy are route-conditional", has(af,"**Direct route: the credential binds it.**") and has(af,"**exactly that, never the password sentence**")),
 ("R6 the grant has a life", has(af,"a record with no life cannot be implemented") and has(af,"means *the machine*, not the cloud")),
 ("R6 the note owes four items", has(af,"Four things this ADR has that the note does not carry at all") and has(pf,"four things are owed TO the note")),
 ("R6 the round-6 mappings", has(af,"`local_operator/tunnels/gateway.py` → `gateway.py`") and has(af,"`local_operator/mcp/grants.py` → `mcp/grants.py`") and has(af,"`local_operator/mobile/attach_client.py` → `attach_client.py`") and has(af,"`local_operator/mobile/tui_handle.py` → `tui_handle.py`")),
 ("R6 nit: the range includes :778", has(af,"daemon.py:778-782")),
 ("R6 the §9/provenance contradiction is resolved", has(af,"Corrections live in two places, by kind")),
 ("R7 §9 records the reversal and the two refs", has(af,"The HTTP `unrevoke` route and the `403 machine_only` refusal were **removed in round 6**") and has(af,"round 7 reversed that") and has(af,"cites **two trees**")),
 ("R6 plan Q26 the gateway hop", has(pf,"| Q26 | a registration **through the tunnel gateway**")),
 ("R6 plan Q21/Q22 are route-scoped", has(pf,"**direct route**") and has(pf,"on the **direct** route, coming back one at a time")),
 ("R6 the previously-unmapped paths are mapped", has(af,"`local_operator/mobile/auth.py` → `mobile/auth.py`") and has(af,"`local_operator/tunnels/gateway.py` → `gateway.py`") and has(af,"`local_operator/session/runtime/server.py` → `session/runtime/server.py`")),
 ("R7 the honest limit is stated, not softened", has(af,"readable by any process running as the same user") and has(af,"out of this ADR\u2019s threat model") is False and has(af,"out of this ADR's threat model")),
 ("R7 the S4a reconciliation is in the plan", has(pf,"S4a against core's implementation") and has(pf,"Residual differences, each an explicit item for the core lane")),
 ("R8 the machine→cloud literals name the FROZEN emit route", has(af,"POST <cloud>/v1/push/register") and has(af,"POST /v1/tunnels/{tunnel_id}/push/events") and has(af,"devices[].credential_expires_at") and has(af,"Idempotency-Key: <emit key, §3.4>")),
 ("R7 the QA rows Q27-Q31 exist", has(pf,"| Q27 |") and has(pf,"| Q28 |") and has(pf,"| Q29 |") and has(pf,"| Q30 |") and has(pf,"| Q31 |")),
 ("R7 the #1864 provenance row and marker exist", has(af,"PR #1864** | `d089f7e0fc0a324c38d6499290c27b2569714549`") and has(af,"`daemon.py`:4730-4770 (#1864)")),
 ("R7 the scripts document what they do not check", has(has_readme,"NOT CHECKED") or has(has_readme,"not checked")),
 ("R7 the scripts take a repo path", has(has_readme,"LOCAL_OPERATOR_REPO")),
 ("R8 the emit route is frozen in ONE spelling (no /v1/push/emit)", not has(af,"v1/push/emit") and not has(pf,"v1/push/emit")),
 ("R8 the list literal has no `environment` and shows the optionals", has(af,"\"credential_live\":true") and (not has(af,"\"environment\":\"production\""))),
 ("R8 the phone-drives-an-agent residual is stated once, in §4", has(af,"A phone holding a valid `lop_mobile` cookie can drive this machine") and has(af,"UNTESTED") and has(af,"`tool_approval_mode: auto`\ninstalls no gate at all") is False and has(af,"installs no gate at all")),
 ("R8 the unrevoke note and its results are core\u2019s", has(af,"The app must not invent a fifth wording") and has(af,"cleared the unpaired marker on")),
 ("R8 the provenance paragraph states the markers and the limits", has(af,"failure, not a default") and has(af,"What they do not check, so no reader has to guess the denominator")),
 ("R8 the residual count is corrected in the plan", has(pf,"(eight of them)") and (not has(pf,"(nine"))),
 ("R7 the state vocabulary is core's and Settings mirrors it", has(af,"push_devices.STATE_DESCRIPTIONS") and has(af,"The app must not invent a fifth wording") and has(af,"registered, and push resumes on its next authenticated read")),
 ("R7 the CLI remedy clause replaces the device sentence for the operator", has(af,"check --port or restart the daemon") and has(af,"exit 1 with no fallback and no write")),
 ("R8 the route sits behind the sibling cookie gate AND the key", has(af,"sits behind the usual cookie gate AND the key") and has(af,"restores no token and no credential") and has(af,"deletes every marker the row carries")),
 ("R7 the fact table and the guard-cell residual exist", has(pf,"The facts this ADR takes from #1864, and where each is") and has(pf,"The guard cells are NOT in #1864")),
 ("R7 the #1864 pin is described as a PR head, not main", has(af,"a PR head, not `main` and not a tag")),
 ("R8 the scripts document what they check and what they do not", has(has_readme,"Exactly what is NOT checked") and has(has_readme,"parser self-test")),
 ("R7 device_key is stored as the key itself", has(af,"the key itself, not a hash") and (not has(af,"stored machine-side as a **hash**"))),
 ("R5 M3 the key proves identity, not permission", has(af,"key proves IDENTITY, never PERMISSION")),
 ("R8 the gateway must never carry the operator key (regression guard)", has(af,"must NEVER be added to that") and has(af,"entries are lowercase") and has(pf,"Q31 as a REGRESSION GUARD")),
 ("R5 M4 the fresh-install claim is corrected", has(af,"Radient route, fresh install: NOT stopped by the grant") and has(af,"registers, is minted a grant and receives pushes") and has(af,"revoking the phone's access in the Radient account")),
 ("R5 M4 rotation lever scoped to the direct route", has(af,"rotation is a device-facing lever on the direct route only")),
 ("R7/R8 why the daemon route, not the control socket", has(af,"per-live-session-runtime") and has(af,"`attach_client.py`:889-895") and has(af,"`session/runtime/server.py`:1304-1307")),
 ("R6 the paired-device certificate is not the discriminator", has(af,"The paired-device certificate is not the discriminator") and has(af,"`daemon.py`:1626-1641")),
 ("R5 Q-F6 the kind citation is fixed", has(af,"attention.py:2047") and has(af,"What that check cannot prove") and has(af,"resolution is not *support*")),
 ("R5 Q-F7 recomputes + SENDS coalesced", has(af,"The relay RECOMPUTES it on every") and has(af,"**SENDS it COALESCED**")),
 ("R5 Q-F8 the grant has a record and a proposal marker", has(af,"| **Grant (per device)** *(cloud, proposal)* |") and has(af,"its record is §2.2's Grant row")),
 ("R8 the lapse is the expiry the cookie itself presented", has(af,"expiry the phone actually presented") and has(af,"`credential_expires_at`") and has(af,"`mobile/auth.py`:465-469") and has(af,"the TTL does not govern at all") and (not has(af,"login route when it mints"))),
 ("R5 m7 the slice row drops the listing field", has(af,"| **Conversation handle + resolve route** (§4, S2 — the per-row **listing field was rejected**")),
 ("R5 m8 the preamble is per route", has(af,"**the auth model is per route**")),
 ("R5 m9 writers and the clearing surface", has(af,"the operator surface is the only thing that ever *clears* one")),
 ("R5 m10 no dangling §4.3", not has(af,"§4.3") and has(af,"§4 path 3")),
 ("R6 the gateway allowlist is named", has(af,"`_REQUEST_HEADERS` (`gateway.py`:310-319)") and has(af,"**`X-Lop-Device` and `X-Lop-Device-Key` are stripped today**")),
 ("R5 n7 the routing record in state vocabulary", has(af,"account id → the account's registered device ids")),
 ("R5 nit-N1 the method replaces the census", has(af,"distinct `(path, line-range)` pairs") and has(af,"rather than a census")),
 ("R5 plan: S4a scopes the fresh install", has(pf,"scopes the fresh-install claim to the **direct** route")),
 ("R8 plan: S4c is the CURRENT design", has(pf,"typed `devices` block") and has(pf,"POST <cloud>/v1/push/credentials") and has(pf,"never gains `X-Lop-Operator-Key`") and (not has(pf,"stored machine-side as a **hash**"))),
 ("R5 plan: S3 freezes the new shapes", has(pf,"`X-Lop-Device-Key: <device_key>` on identifying requests")),
 ("R5 plan: Q25 the re-install permutation", has(pf,"| Q25 | a **re-installed app** whose `install_id` is new, on the **Radient** route")),
 ("R5 plan: the mint-refusal requirement", has(pf,"the **mint-refusal requirement**")),
 ("R8 plan: the lapse is exact, not arithmetic", has(pf,"the expiry the cookie itself carried")),
 ("Q1 install.py mapped", has(af,"`local_operator/mobile/install.py` → `mobile/install.py`")),
 ("Q2 retention cited (attention.py:421)", has(af,"`_SUPERSEDE_LOG_RETENTION = 256`, `attention.py:421`") and has(af,"`:423-425`") and has(af,"`:2113`")),
 ("Q2 worker response stated", has(af,"it re-baselines and says so")),
 ("Q3 detector state = triple + ack map", has(af,"the `revision()` triple *and* the `acknowledgement_map()` snapshot")),
 ("Q3 plan Q17 names the detector state", has(pf,"detector state")),
 ("Q4 settings claim scoped per branch", has(af,"while **`main` and #12** ship Appearance + Connection")),
 ("Q5a three delta reads", has(af,"its **three** delta reads") and has(af,"`:931,1186-1190`")),
 ("Q5b sequel read, names the heal", has(af,"the **sequel read** `seq > cursor` (`:1775`)") and has(af,"the only read that **names** the healed conversation") and has(af,"`attention.py:1743-1744`")),
 ("Q5 overstatement gone", not has(af,"only thing that can see a heal") and not has(af,"equality on `supersede_log.seq`")),
 ("REV register refusal", has(af,'403 {"code": "device_revoked", "error": "this device was revoked on this computer"}')),
 ("REV five states", has(af,"The five device states, and the rule that closes the stolen-phone gap")),
 ("REV rule 1 tombstone", has(af,"**A revoke TOMBSTONES.**")),
 ("REV rule 2 both conditions, per route", has(af,"**Delivery requires BOTH a registered device AND a live credential for it") and has(af,"*which*")),
 ("REV rule 3 dead token is different", has(af,"**Dead-token deletion is a DIFFERENT state (path 4), not a revoke.**")),
 ("REV rotation sets expired not revoked", has(af,"**Rotation sets `expired_at`, never `revoked_at`**")),
 ("R7 the round-6 framing is retired in §9", has(af,"control-socket framing (`control_key`) is retired with it")),
 ("REV residual stated", has(af,"**The residual, stated rather than implied.**")),
 ("REV plan row S4a (markers)", has(pf,"| **S4a** | **Device lifecycle states, one vocabulary** \u2014 live / expired (`expired_at`) / unpaired (`unpaired_at`) / revoked (`revoked_at`) / absent")),
 ("REV QA rows Q19-Q21", has(pf,"| Q19 | a device is revoked while it is live") and has(pf,"| Q20 |") and has(pf,"| Q21 |")),
 ("REV risk row updated", has(af,"against the five states, the shared precedence and the three rules")),
 ("P5 markers in the Device row", has(af,"**`revoked_at` / `unpaired_at` / `expired_at`**")),
 ("P5 precedence named", has(af,"**The precedence is `revoked` > `unpaired` > `expired`")),
 ("P5 states table has the Marker column", has(af,"| State | Marker | Token | May register again? | Entered by |") and has(af,"| **Expired** | `expired_at` |") and has(af,"| **Unpaired** | `unpaired_at` |") and has(af,"| **Absent** | \u2014 (no row at all) |")),
 ("P5 credential row: the machine owns it", has(af,"**the machine's own record**") and has(af,"**The machine owns it**")),
 ("P5 retention promoted off the note", has(af,"**Two retention rules this ADR adopts") and has(af,"dropped entirely \u2014 no marker")),
 ("P5 register route: two refusals", has(af,'403 {"code": "device_unpaired", "error": "this computer is no longer paired"}')),
 ("P5 register route: expired does not refuse", has(af,"`expired_at` does NOT refuse")),
 ("R7 X-Lop-Device-Key and the attribution header", has(af,"`X-Lop-Device-Key: <device_key>`") and has(af,"the relay resolves it to the") and has(af,"device_key_matches")),
 ("P5 list returns the state and the precedence", has(af,'"state":"live|expired|unpaired|revoked"') and has(af,'"precedence":"revoked > unpaired > expired"')),
 ("P5 how a device comes back names each act", has(af,"**How a device comes back — and none of it is the device's own doing**") and has(af,"pair this computer again")),
 ("P5 quiet-loss rule stated", has(af,"**Notifications never stop silently (this pass's second half).**") and has(af,"notifications are paused for this device until you sign in again")),
 ("P5 ADR effort row for the credential limb", has(af,"**Credential-live evaluation and the credential-change event**")),
 ("P5 plan row S4c", has(pf,"| **S4c** | **Credential-live evaluation and the credential-change event**")),
 ("P5 plan QA rows Q22/Q23", has(pf,"| Q22 |") and has(pf,"| Q23 |")),
 ("P5 plan note: vocabulary re-checked at the note head", has(pf,"`revoked_at` / `unpaired_at` / `expired_at`") and has(pf,"Re-checked at the note's head `30a0f4d`")),
]
bad = [n for n, ok in rows if not ok]
for n, ok in rows:
    print(("PASS  " if ok else "FAIL  ") + n)
print()
print(f"{len(rows)-len(bad)}/{len(rows)} checks pass; ref={REF}")
sys.exit(1 if bad else 0)
