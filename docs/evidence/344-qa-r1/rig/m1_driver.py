"""QA #344 r1 row M1 (from #4278 review M1): live inbound bridge card into an IDLE session.

Real path: a real `lop mobile serve` relay (core 9907020f, hub wire faked only) on cfg-m1;
a real session runtime warmed with the core launcher (`engage_runtime(WarmErrand)`), then
the connector's own `deliver_wake` (the `_deliver_card` shape: card + sender_display with
bridge_receipt/bridge_receipt_source) delivers one admitted message whose display body is
already recorded — exactly the order the connector uses. A watcher on the relay's session
SSE stream fires GET /bridge-cards/<entry>/body the instant the row first appears (what the
phone does on row mount) and again later; timings recorded against the journal write.
"""
import asyncio, hashlib, json, os, sys, time
from pathlib import Path

WT = "~/local-operator/.worktrees/qa-344-core"
sys.path.insert(0, WT)
import httpx  # noqa: E402
import tests.unit.team_bridge.test_card_body as T  # noqa: E402
from local_operator.team_bridge.display_bodies import DisplayBodyStore  # noqa: E402
from local_operator.team_bridge.store import _owner_key  # noqa: E402

ROOT = Path(os.environ["LOCAL_OPERATOR_CONFIG_DIR"])
assert str(ROOT).endswith("scratchpad/qa/cfg-m1"), ROOT
RELAY = os.environ["QA_RELAY"]
PW = Path(os.environ["QA_PW_FILE"]).read_text().strip()
SID = T.SESSION
MID = os.environ.get("QA_MID", "bcmsg_live0001")
BODY = "**Live** card from Ola — delivered while the session was idle."
OUT = Path(os.environ["QA_M1_OUT"])
t0 = time.monotonic()
events: list[dict] = []


def ev(kind, **kw):
    e = {"t_ms": round((time.monotonic() - t0) * 1000, 1), "kind": kind, **kw}
    events.append(e)
    print(json.dumps(e), flush=True)


def journal_has_row() -> list[str]:
    p = ROOT / "sessions" / SID / "transcript.jsonl"
    ids = []
    for line in p.read_text().splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if MID in line:
            ids.append(row.get("id"))
    return ids


async def watcher(client: httpx.AsyncClient, seen: asyncio.Event, entry: dict):
    async with client.stream("GET", f"{RELAY}/api/sessions/{SID}/events", timeout=None) as r:
        ev("sse_open", status=r.status_code)
        async for line in r.aiter_lines():
            if MID not in line or seen.is_set():
                continue
            # Find the entry id of the row carrying our message id in this frame.
            data = line[5:] if line.startswith("data:") else line
            eid = None
            try:
                obj = json.loads(data)

                def walk(o):
                    nonlocal eid
                    if isinstance(o, dict):
                        if eid is None and isinstance(o.get("id"), str) and MID in json.dumps(o.get("details", {})):
                            eid = o["id"]
                        for v in o.values():
                            walk(v)
                    elif isinstance(o, list):
                        for v in o:
                            walk(v)
                walk(obj)
            except ValueError:
                pass
            ev("sse_row_seen", entry_id=eid, journal_ids=journal_has_row())
            entry["id"] = eid
            seen.set()
            if eid:
                b = await client.get(f"{RELAY}/api/sessions/{SID}/bridge-cards/{eid}/body")
                ev("body_on_mount", status=b.status_code, body=b.text[:160], journal_ids=journal_has_row())


async def main():
    from local_operator.session.runtime.launch import WarmErrand, engage_runtime
    from local_operator.team_bridge.connector.wake import deliver_wake

    async with httpx.AsyncClient(follow_redirects=False) as client:
        r = await client.post(f"{RELAY}/login", data={"password": PW})
        ev("login", status=r.status_code)
        out = await engage_runtime(SID, "", WarmErrand(), config_dir=ROOT)
        ev("warm", outcome=str(getattr(out, "state", out)))
        await asyncio.sleep(3)
        seen, entry = asyncio.Event(), {}
        w = asyncio.create_task(watcher(client, seen, entry))
        await asyncio.sleep(2)
        key = _owner_key(T._owner())
        ok = DisplayBodyStore(ROOT).record(key, message_id=MID, conversation_id=T.CONVERSATION_ID, body=BODY,
                                           body_sha256=hashlib.sha256(BODY.encode()).hexdigest(),
                                           sender_kind="human", source="turn")
        ev("display_body_recorded", ok=ok)
        details = T._details([MID], seq=int(os.environ.get("QA_SEQ", "900")))
        sender_display = {"sender_name": "Ola", "bridge_receipt": details["bridge_receipt"],
                          "bridge_receipt_source": details["bridge_receipt_source"]}
        ev("deliver_start", journal_ids=journal_has_row())
        res = await deliver_wake(T._owner(), details["text"], session_id=SID, config_dir=ROOT,
                                 sender_display=sender_display)
        ev("deliver_done", result=str(res)[:200], journal_ids=journal_has_row())
        try:
            await asyncio.wait_for(seen.wait(), 30)
        except TimeoutError:
            ev("sse_row_never_seen", journal_ids=journal_has_row())
        for delay in (1, 5):
            await asyncio.sleep(delay)
            if entry.get("id"):
                b = await client.get(f"{RELAY}/api/sessions/{SID}/bridge-cards/{entry['id']}/body")
                ev(f"body_after_{delay}s", status=b.status_code, body=b.text[:160], journal_ids=journal_has_row())
        w.cancel()
    OUT.write_text(json.dumps(events, indent=1))


asyncio.run(main())
