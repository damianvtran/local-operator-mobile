"""QA r1 mobile #344 (reused from UI #1977 r2 rig): seed an isolated config with Team Bridge cards + display_bodies rows
through core #4238's own store APIs (helpers from its test module, as core QA did)."""
import hashlib, json, os, sys, time
from pathlib import Path
WT = "~/local-operator/.worktrees/qa-344-core"
sys.path.insert(0, WT)
import tests.unit.team_bridge.test_card_body as T
from local_operator.team_bridge.display_bodies import DisplayBodyStore
from local_operator.team_bridge.store import _owner_key

root = Path(os.environ["LOCAL_OPERATOR_CONFIG_DIR"])
assert str(root).endswith("scratchpad/qa/cfg2"), root
SHORT = ("**Hello** from Ola — can you check the _release_ notes before Friday?\n\n"
         "- confirm the `v0.108` changelog\n- link: [release board](https://example.com/board)")
LONG = "## Release checklist\n\n" + "\n".join(
    f"{i}. Line {i}: the quick brown fox jumps over the lazy dog, then checks item `{i}`." for i in range(1, 31))
h = lambda s: hashlib.sha256(s.encode()).hexdigest()
store = T._enroll(root)
T._sign_in_radient(root)
owner = T._owner()
key = _owner_key(owner)
disp = DisplayBodyStore(root)


def local(mid, body):
    assert disp.record(key, message_id=mid, conversation_id=T.CONVERSATION_ID, body=body,
                       body_sha256=h(body), sender_kind="human", source="turn"), mid


local("bcmsg_admit001", SHORT)
local("bcmsg_long0001", LONG)
local("bcmsg_dele0001", "this body was later deleted on the hub")
store.persist_hold(owner, "bcmsg_held0001", "model_hold")
store.persist_hold(owner, "bcmsg_heldt001", "provider_error")
coal = [f"bcmsg_coal{i:04d}" for i in range(23)]
for i, mid in enumerate(coal):
    local(mid, f"Coalesced message **{i + 1}** of 23.")
# #4278 QA seeding note: T._write_card writes  rows the phone history never
# replays. Persist through the core Transcript API instead (the live path's row shape).
import asyncio
from local_operator.session.transcript import Transcript
from local_operator.harness.types import CustomMessage, Message
from local_operator.harness.message_types import TEAM_BRIDGE_MESSAGE_TYPE
cards = [("e_admit", ["bcmsg_admit001"]), ("e_long", ["bcmsg_long0001"]), ("e_held", ["bcmsg_held0001"]),
         ("e_heldt", ["bcmsg_heldt001"]), ("e_refused", ["bcmsg_refu0001"]), ("e_deleted", ["bcmsg_dele0001"]),
         ("e_offline", ["bcmsg_offl0001"]), ("e_coal", coal)]
seqmap = {}
msgs = [Message(role="user", content=[{"type": "text", "text": "Watch for Team Bridge messages from Ola."}])]
for i, (eid, ids) in enumerate(cards):
    seq = 100 + 10 * i
    seqmap[eid] = seq
    msgs.append(CustomMessage(id=eid, custom_type=TEAM_BRIDGE_MESSAGE_TYPE, attribution="user", details=T._details(ids, seq=seq)))
asyncio.run(Transcript(root / "sessions" / T.SESSION).append_messages(msgs))
json.dump(seqmap, open(os.environ["QA_SEQMAP"], "w"))
print("seeded", T.SESSION, seqmap)
