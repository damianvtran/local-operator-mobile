"""QA r2 mobile #344 (Q2 retest): TWO live Team Bridge deliveries into an idle session.

Derived from the r1 m1_driver.py. Real `lop mobile serve` relay (new: core origin/main with
only the hub wire faked; old: installed 0.107.3); a real session runtime warmed with core
`engage_runtime(WarmErrand)`; the connector's own `deliver_wake` with the `_deliver_card`
sender_display shape. Delivery 1 lands in a runtime whose phone fold has not seen a
frontend-state publication (expected: `peer_message` echo arm, peer_cycles absent).
Delivery 2 lands after the woken turn settled (expected, if the fold flipped peer_cycles=1:
the `notice` arm with custom_kind). Every SSE row carrying a delivery's message id is
logged with its SHAPE (kind, id, sender.source, custom_kind, receipt present) so the
report states which arm each card took, from the wire, not by inference.
"""
import asyncio, hashlib, json, os, sys, time
from pathlib import Path

WT = "/home/ec2-user/local-operator/.worktrees/qa-344-core"
sys.path.insert(0, WT)
import httpx  # noqa: E402
import tests.unit.team_bridge.test_card_body as T  # noqa: E402
from local_operator.team_bridge.display_bodies import DisplayBodyStore  # noqa: E402
from local_operator.team_bridge.store import _owner_key  # noqa: E402

ROOT = Path(os.environ["LOCAL_OPERATOR_CONFIG_DIR"])
assert "/scratchpad/qa344r2/qa/cfg-m1" in str(ROOT), ROOT
RELAY = os.environ["QA_RELAY"]
PW = Path(os.environ["QA_PW_FILE"]).read_text().strip()
SID = T.SESSION
TAG = os.environ.get("QA_TAG", "r2")
MIDS = [f"bcmsg_{TAG}a{int(time.time()) % 100000}", f"bcmsg_{TAG}b{int(time.time()) % 100000}"]
BODIES = {MIDS[0]: "**Live A** — first card from Ola, delivered while the session was idle.",
          MIDS[1]: "**Live B** — second card from Ola, after the woken turn settled."}
OUT = Path(os.environ["QA_M1_OUT"])
SETTLE_S = float(os.environ.get("QA_SETTLE_S", "20"))
t0 = time.monotonic()
events: list[dict] = []
seen: dict[str, asyncio.Event] = {m: asyncio.Event() for m in MIDS}
entry: dict[str, str] = {}


def ev(kind, **kw):
    e = {"t_ms": round((time.monotonic() - t0) * 1000, 1), "wall": round(time.time(), 3), "kind": kind, **kw}
    events.append(e)
    print(json.dumps(e), flush=True)


def shape(row: dict) -> dict:
    d = row.get("details") or {}
    s = d.get("sender") or {}
    return {"id": row.get("id"), "kind": row.get("kind"), "custom_type": row.get("custom_type"),
            "custom_kind": d.get("custom_kind"), "sender_source": s.get("source"),
            "sender_has_receipt": "bridge_receipt" in s, "row_has_receipt": "bridge_receipt" in d,
            "text_head": (row.get("text") or "")[:60]}


async def watcher(client: httpx.AsyncClient):
    async with client.stream("GET", f"{RELAY}/api/sessions/{SID}/events", timeout=None) as r:
        ev("sse_open", status=r.status_code)
        async for line in r.aiter_lines():
            data = line[5:] if line.startswith("data:") else line
            if "peer_cycles" in data:
                try:
                    pc = json.loads(data)
                    found = []

                    def wpc(o):
                        if isinstance(o, dict):
                            if "peer_cycles" in o:
                                found.append(o["peer_cycles"])
                            for v in o.values():
                                wpc(v)
                        elif isinstance(o, list):
                            for v in o:
                                wpc(v)
                    wpc(pc)
                    if found and entry.get("_pc") != str(found):
                        entry["_pc"] = str(found)
                        ev("sse_peer_cycles", values=found)
                except ValueError:
                    pass
            for mid in MIDS:
                if mid not in line or seen[mid].is_set():
                    continue
                rows = []
                try:
                    obj = json.loads(data)

                    def walk(o):
                        if isinstance(o, dict):
                            if isinstance(o.get("id"), str) and "kind" in o and mid in json.dumps(o):
                                rows.append(shape(o))
                            for v in o.values():
                                walk(v)
                        elif isinstance(o, list):
                            for v in o:
                                walk(v)
                    walk(obj)
                except ValueError:
                    pass
                ev("sse_row_seen", mid=mid, rows=rows)
                if rows:
                    entry[mid] = rows[-1]["id"]
                seen[mid].set()
                if rows:
                    b = await client.get(f"{RELAY}/api/sessions/{SID}/bridge-cards/{entry[mid]}/body")
                    ev("body_on_mount", mid=mid, entry_id=entry[mid], status=b.status_code, body=b.text[:200])


async def deliver(mid: str, seq: int):
    from local_operator.team_bridge.connector.wake import deliver_wake

    key = _owner_key(T._owner())
    body = BODIES[mid]
    ok = DisplayBodyStore(ROOT).record(key, message_id=mid, conversation_id=T.CONVERSATION_ID, body=body,
                                       body_sha256=hashlib.sha256(body.encode()).hexdigest(),
                                       sender_kind="human", source="turn")
    ev("display_body_recorded", mid=mid, ok=ok)
    details = T._details([mid], seq=seq)
    sender_display = {"sender_name": "Ola", "bridge_receipt": details["bridge_receipt"],
                      "bridge_receipt_source": details["bridge_receipt_source"]}
    ev("deliver_start", mid=mid)
    res = await deliver_wake(T._owner(), details["text"], session_id=SID, config_dir=ROOT,
                             sender_display=sender_display)
    ev("deliver_done", mid=mid, result=str(res)[:200])


async def main():
    from local_operator.session.runtime.launch import WarmErrand, engage_runtime

    async with httpx.AsyncClient(follow_redirects=False) as client:
        r = await client.post(f"{RELAY}/login", data={"password": PW})
        ev("login", status=r.status_code)
        out = await engage_runtime(SID, "", WarmErrand(), config_dir=ROOT)
        ev("warm", outcome=str(getattr(out, "state", out)))
        await asyncio.sleep(3)
        w = asyncio.create_task(watcher(client))
        await asyncio.sleep(2)
        for i, mid in enumerate(MIDS):
            await deliver(mid, seq=int(os.environ.get("QA_SEQ", "960")) + i)
            try:
                await asyncio.wait_for(seen[mid].wait(), 30)
            except TimeoutError:
                ev("sse_row_never_seen", mid=mid)
            await asyncio.sleep(1)
            if entry.get(mid):
                b = await client.get(f"{RELAY}/api/sessions/{SID}/bridge-cards/{entry[mid]}/body")
                ev("body_after_1s", mid=mid, status=b.status_code, body=b.text[:200])
            if i == 0:
                ev("settle_wait", seconds=SETTLE_S)
                await asyncio.sleep(SETTLE_S)
        w.cancel()
    OUT.write_text(json.dumps({"mids": MIDS, "entries": {m: entry.get(m) for m in MIDS}, "events": events}, indent=1))


asyncio.run(main())
