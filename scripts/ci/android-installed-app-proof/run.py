#!/usr/bin/env python3
"""HOSTED INSTALLED-APP PROOF ONLY: drive one booted emulator through every
receipt row and write receipts.json + screenshots under $EVIDENCE.

Runs inside reactivecircus/android-emulator-runner after preflight passed. The
installed app is the debug proof APK; posts go through the app-process driver
(InstalledAppProofRunner, command socket via `adb forward`), UI is driven with
`input`/`uiautomator dump` — the same taps a person makes. Every row records
PASS/FAIL with the measured facts; a row that cannot be exercised records
BLOCKED with its cause. The script never stops at the first failure: one run
must yield the whole matrix (each hosted attempt is expensive).

Usage: run.py <staged-dir> <evidence-dir> <candidate-root>
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import time
import traceback
import xml.etree.ElementTree as ET

import pngtools

STAGED, EVIDENCE, ROOT = sys.argv[1:4]
os.makedirs(EVIDENCE, exist_ok=True)
MANIFEST = json.load(open(os.path.join(STAGED, "manifest.json")))
PKG = MANIFEST["app_package"]
DRIVER = MANIFEST["driver_package"]
RUNNER = f"{DRIVER}/com.localoperator.mobile.installedproof.InstalledAppProofRunner"
API = int(subprocess.run(["adb", "shell", "getprop", "ro.build.version.sdk"], capture_output=True, text=True).stdout.strip())
HUB = "http://127.0.0.1:54832"
TENANT = "ten_0123456789abcdef"
ACCOUNT = "acct_self_0001"  # sub of the mock's synthetic TEAM_BRIDGE_FIXTURE_TOKEN
CATALOGUE = json.load(open(os.path.join(ROOT, "src/i18n/catalogues/en/mobile.notifications.json")))
PLACEHOLDER = CATALOGUE["mobile.notifications.category.message_placeholder"]
NOTICE = CATALOGUE["mobile.notifications.preferences.bridge_system_off"]
NOTICE_OPEN = CATALOGUE["mobile.notifications.preferences.bridge_system_open"]
SECRET_PREVIEW = "Synthetic preview 7f3a lockscreen"
# Bodies the mock's default thread carries in EVERY conversation
# (tools/mock-team-bridge.ts `thread`). One on screen = the thread's messages
# rendered, not just its header (#304 UX R3 U9: warm-tap frames on API 29/31
# showed header + composer and an empty body).
THREAD_MARKERS = ("I checked the API contract", "How is the new messaging surface")
# Mean Rec. 709 luma of a full 1080x2400 open-shade frame. Measured on run
# 44267910444 (n=12 shade frames, API 29/31/36): dark 42.5-51.8, light
# 182.5-208.9 — and API 29's "dark" frames at 204.5/207.2, the defect design
# R3 D4.4 found. 120 sits between the observed dark max and light min.
DARK_MAX_LUMA = 120.0
receipts: list[dict] = []


def log(msg: str) -> None:
    print(f"[api{API}] {msg}", flush=True)


def adb(*args: str, check: bool = False, timeout: int = 60) -> str:
    p = subprocess.run(["adb", *args], capture_output=True, text=True, timeout=timeout)
    if check and p.returncode:
        raise RuntimeError(f"adb {' '.join(args)}: {p.stderr.strip()}")
    return p.stdout


def sh(cmd: str, **kw) -> str:
    return adb("shell", cmd, **kw)


def shot(name: str) -> str:
    path = os.path.join(EVIDENCE, f"api{API}-{name}.png")
    with open(path, "wb") as f:
        subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=f, check=True, timeout=30)
    return os.path.basename(path)


def save(name: str, text: str) -> str:
    path = os.path.join(EVIDENCE, f"api{API}-{name}")
    open(path, "w").write(text)
    return os.path.basename(path)


def record(row: str, result: str, detail, files=()) -> None:
    receipts.append({"row": row, "api": API, "result": result, "detail": detail, "files": list(files)})
    log(f"{result} {row}: {json.dumps(detail)[:600]}")


def driver(op: str, **kw):
    with socket.create_connection(("127.0.0.1", 54833), timeout=30) as s:
        s.sendall((json.dumps({"op": op, **kw}) + "\n").encode())
        data = b""
        while not data.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
    reply = json.loads(data or b'{"ok":false,"error":"no reply"}')
    if not reply.get("ok"):
        raise RuntimeError(f"driver {op}: {reply.get('error')}")
    return reply["result"]


def ui() -> list[dict]:
    for _ in range(3):
        sh("uiautomator dump /sdcard/lop-ui.xml >/dev/null 2>&1")
        raw = adb("exec-out", "cat", "/sdcard/lop-ui.xml")
        if raw.strip().startswith("<?xml"):
            nodes = []
            for n in ET.fromstring(raw).iter("node"):
                b = [int(x) for x in re.findall(r"\d+", n.get("bounds", "[0,0][0,0]"))]
                nodes.append({"text": n.get("text", ""), "desc": n.get("content-desc", ""),
                              "id": n.get("resource-id", ""), "cls": n.get("class", ""),
                              "checked": n.get("checked"), "pkg": n.get("package", ""),
                              "x": (b[0] + b[2]) // 2, "y": (b[1] + b[3]) // 2, "b": b})
            return nodes
        time.sleep(1)
    return []


def find(nodes, *, text=None, contains=None, id_suffix=None):
    for n in nodes:
        label = n["text"] or n["desc"]
        if text is not None and label == text:
            return n
        if contains is not None and contains in label:
            return n
        if id_suffix is not None and n["id"].endswith(id_suffix):
            return n
    return None


def wait_for(pred, timeout=30.0, step=1.0):
    end = time.time() + timeout
    while time.time() < end:
        value = pred()
        if value:
            return value
        time.sleep(step)
    return None


def tap(n) -> None:
    sh(f"input tap {n['x']} {n['y']}")


def focus() -> str:
    out = sh("dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'")
    return out.strip()


def open_shade() -> None:
    sh("cmd statusbar expand-notifications")
    time.sleep(2)


def close_shade() -> None:
    sh("cmd statusbar collapse")
    time.sleep(1)


def home() -> None:
    sh("input keyevent KEYCODE_HOME")
    time.sleep(1.5)


def bridge(conv: str, msg: str, title: str, text: str, sender: dict | None, group: bool, members: int,
           subtitle: str | None = None) -> dict:
    body = {"v": 1, "type": "team_bridge_message", "tenant_id": TENANT, "conversation_id": conv,
            "message_id": msg, "seq": 1}
    if sender:
        body["sender"] = sender
    body["conv"] = {"group": group, "members": members}
    data = {"title": title, "message": text, "channelId": "team-bridge",
            "tag": f"tb:{conv}:{msg}", "body": json.dumps(body)}
    # Production sends the channel line as `subtitle` ("#channel · Org", ADR
    # 0010 §2); expo maps data["subtitle"] to the content's subText, which the
    # decorator uses as the conversation title / shortcut label for groups.
    if subtitle:
        data["subtitle"] = subtitle
    return data


ADA = {"kind": "person", "initials": "A", "tone": 2,
       "photo": {"url": f"{HUB}/push-avatar/ada", "nonce": "proofnonce0123456789AB"}}
BEN = {"kind": "person", "initials": "BC", "tone": 5}
AGENT = {"kind": "agent", "tone": 3}
# Synthetic ILLUSTRATED faces (fixtures/make_faces.py; served by hub.ts on the
# same nonce gate). Two distinct faces so a two-sender channel shows whether
# each row carries its own sender (#304 design R3 D3, UX R3 U7).
MIA = {"kind": "person", "initials": "MS", "tone": 1,
       "photo": {"url": f"{HUB}/push-avatar/mia", "nonce": "proofnonce0123456789AB"}}
KENJI = {"kind": "person", "initials": "KS", "tone": 6,
         "photo": {"url": f"{HUB}/push-avatar/kenji", "nonce": "proofnonce0123456789AB"}}
# Each face's flat background (make_faces.py FACES[*].bg): a cluster of it in a
# row's avatar column says WHOSE face that row draws.
FACE_BG = {"mia": (92, 141, 214), "kenji": (238, 180, 72)}
# Initials-only senders (design R3 D4.2): wide Latin, CJK, Arabic, and a person
# with no usable initials (the silhouette). Initials follow the cloud's rule —
# at most two letter/number code points (BridgePushPayload.cleanInitials).
INITIALS_SENDERS = [
    ("bcv_dm_mw", "Mei Wang", {"kind": "person", "initials": "MW", "tone": 0}, "Proof initials wide MW"),
    ("bcv_dm_lihua", "李华", {"kind": "person", "initials": "李华", "tone": 4}, "Proof initials CJK"),
    ("bcv_dm_ahmad", "أحمد", {"kind": "person", "initials": "أ", "tone": 7}, "Proof initials Arabic"),
    ("bcv_dm_anon", "Rowan", {"kind": "person", "tone": 2}, "Proof initials silhouette"),
]
GENERAL_SUBTITLE = "#general · Example Org"


def frame_luma(name: str) -> float:
    return round(pngtools.read(os.path.join(EVIDENCE, name)).mean_luminance(8), 1)


def set_theme(dark: bool, label: str) -> dict:
    """Switch night mode and PROVE the shade follows, by its pixels.

    API 29 kept a light shade after `cmd uimode night yes` (run 44267910444;
    Android 10's UiModeManagerService.setNightMode does update the global
    configuration, so the stale part is SystemUI's already-inflated views).
    When the probe frame disagrees with the request on API < 30, SystemUI is
    restarted (`am force-stop`; it is persistent, so the system relaunches it)
    so it inflates under the new configuration. Every step taken and the
    measured luma are returned for the receipt; nothing is assumed."""
    want = "dark" if dark else "light"
    out: dict = {"want": want, "steps": []}
    sh(f"cmd uimode night {'yes' if dark else 'no'}")
    out["steps"].append(f"cmd uimode night {'yes' if dark else 'no'}")
    time.sleep(2)
    out["uimode"] = sh("cmd uimode night").strip()

    def probe(n: int) -> float:
        open_shade()
        name = shot(f"theme-probe-{label}-{want}-{n}")
        close_shade()
        return frame_luma(name)
    luma = probe(1)
    if (luma < DARK_MAX_LUMA) != dark and API < 30:
        before = sh("pidof com.android.systemui").strip()
        sh("am force-stop com.android.systemui")
        after = wait_for(lambda: (lambda p: p if p and p != before else None)(sh("pidof com.android.systemui").strip()),
                         timeout=60, step=2)
        time.sleep(6)
        out["steps"].append("am force-stop com.android.systemui (restart under new uiMode)")
        out["systemui_pid"] = [before, after]
        luma = probe(2)
    out["probe_luma"] = luma
    out["applied"] = (luma < DARK_MAX_LUMA) == dark
    return out


def row_crops(frame: str, markers: list[str], nodes: list[dict], label: str) -> list[dict]:
    """Crop each notification row holding a marker text out of `frame`.

    The row is the smallest SystemUI row node whose bounds
    contain the marker's centre (a grouped child is smaller than its group);
    without one, a 300 px band around the marker. Each crop also counts the
    two synthetic faces' background pixels in the row's leading 30% (where
    the conversation avatar sits), so a row drawing the OTHER sender's face is
    a number, not only a picture."""
    img = pngtools.read(os.path.join(EVIDENCE, frame))
    # API 31/36 dumps name the row; API 29's do not, but each row's own
    # `backgroundNormal` spans it (run 44267910444 shade dumps).
    rows = [n for n in nodes if n["id"].endswith(":id/expandableNotificationRow")
            or n["id"].endswith(":id/backgroundNormal")]
    out = []
    for i, marker in enumerate(markers):
        hit = find(nodes, contains=marker)
        entry: dict = {"marker": marker, "found": bool(hit)}
        if hit:
            box = [r["b"] for r in rows if r["b"][0] <= hit["x"] <= r["b"][2] and r["b"][1] <= hit["y"] <= r["b"][3]]
            b = min(box, key=lambda b: (b[2] - b[0]) * (b[3] - b[1])) if box else [0, hit["y"] - 150, img.width, hit["y"] + 150]
            crop = img.crop(*b)
            name = f"api{API}-row-{label}-{i + 1}.png"
            pngtools.write(os.path.join(EVIDENCE, name), crop)
            lead = crop.crop(0, 0, max(1, crop.width * 3 // 10), crop.height)
            entry.update({"bounds": b, "file": name, "from_row_node": bool(box),
                          "face_px": {k: colour_px(lead, v) for k, v in FACE_BG.items()}})
        out.append(entry)
    return out


def colour_px(img, rgb, tol: int = 18) -> int:
    c, n = img.channels, 0
    for row in img.rows:
        for x in range(0, img.width * c, c):
            if abs(row[x] - rgb[0]) <= tol and abs(row[x + 1] - rgb[1]) <= tol and abs(row[x + 2] - rgb[2]) <= tol:
                n += 1
    return n


def expand_first(nodes: list[dict], near: str | None = None) -> bool:
    """Tap one expand control: the one nearest the `near` text's row, else the
    first. One tap per dump: a tap reflows the shade, so other controls'
    coordinates from the same dump are stale."""
    controls = [n for n in nodes if n["id"].endswith(":id/expand_button")
                or n["id"].endswith("expand_button_touch_container")]
    if not controls:
        return False
    anchor = find(nodes, contains=near) if near else None
    pick = min(controls, key=lambda n: abs(n["y"] - anchor["y"])) if anchor else controls[0]
    tap(pick)
    time.sleep(1.5)
    return True


def bridge_records(active) -> list[dict]:
    return [a for a in active if (a.get("tag") or "").startswith("tb:") or (a.get("group") or "").startswith("tb:")]


def start_driver() -> subprocess.Popen:
    adb("forward", "tcp:54833", "tcp:54833", check=True)
    proc = subprocess.Popen(["adb", "shell", "am", "instrument", "-w", "-r", "-e", "mode", "serve", RUNNER],
                            stdout=open(os.path.join(EVIDENCE, f"api{API}-instrument-{int(time.time())}.log"), "w"),
                            stderr=subprocess.STDOUT)

    def ping():
        try:
            return driver("ping")
        except Exception:
            return None
    ident = wait_for(ping, timeout=90, step=2)
    if not ident:
        raise RuntimeError("driver never answered ping")
    return proc


def row(name):
    def deco(fn):
        def wrapped(*a, **kw):
            # One app crash must not take out every later row (API 36, run
            # 44233625482): re-establish the driver and record that it was needed.
            try:
                driver("ping")
            except Exception:
                try:
                    start_driver()
                    record(f"driver restarted before: {name}", "FAIL",
                           {"cause": "app process gone (see logcat for FATAL EXCEPTION)"})
                except Exception as e:
                    record(name, "FAIL", {"error": f"driver restart failed: {e}"})
                    return None
            try:
                return fn(*a, **kw)
            except Exception as e:  # one row's failure never hides the others
                record(name, "FAIL", {"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]})
        return wrapped
    return deco


def main() -> int:
    adb("logcat", "-c")
    # No Metro, no external network: only the adb-reversed loopback hub.
    adb("reverse", "--remove-all")
    adb("reverse", "tcp:54832", "tcp:54832", check=True)
    sh("svc wifi disable; svc data disable")
    if API >= 33:
        sh(f"pm grant {PKG} android.permission.POST_NOTIFICATIONS")
    sh("cmd uimode night no")
    sh("settings put global heads_up_notifications_enabled 1")

    start_driver()
    ident = driver("ping")
    ok = ident["target"] == PKG and ident["driver"] == DRIVER and ident["receiver"] == "dev.localoperator.teambridge.LoNotificationsService"
    record("runtime identity (driver targets app; app receiver is LoNotificationsService)", "PASS" if ok else "FAIL", ident)

    # Fixture readiness: the embedded entry ran and the real app reached the
    # loopback hub. Without both, no later row means anything.
    def ready():
        log_ = adb("logcat", "-d", "-s", "ReactNativeJS:*")
        hits = json.loads(subprocess.run(["curl", "-s", f"{HUB}/__proof/requests"], capture_output=True, text=True).stdout or "[]")
        return ("LOP_INSTALLED_PROOF_FIXTURE_54832 entry" in log_ and any("/v1/messaging/" in h["path"] for h in hits)) and hits
    hits = wait_for(ready, timeout=120, step=3)
    record("fixture readiness (embedded entry + app requests to loopback hub; wifi/data off)",
           "PASS" if hits else "FAIL", {"hub_requests": len(hits or []), "paths": sorted({h["path"] for h in hits or []})[:12]})
    if not hits:
        save("logcat-readiness.txt", adb("logcat", "-d"))
        return 1

    lease = driver("lease", account=ACCOUNT)
    origin = driver("origin", origin=HUB)
    record("harness seeds (disclosed: no FCM token, so registration never sets these)", "PASS" if lease and origin == HUB else "FAIL",
           {"presentation_lease_current": lease, "hub_origin": origin})
    home()

    rows_posts()
    rows_shade()
    rows_dumpsys()
    # Before the channel row: that row turns the channel off and on, and the
    # restored importance is the user's, not the app's HIGH default.
    rows_heads_up()
    rows_channel()
    rows_warm_and_foreground()
    rows_unread_zero()
    rows_cold()
    # Both clear the app's notifications first, so each frame holds only its
    # scenario's rows (design R3 D3/D4.2).
    rows_multi_sender()
    rows_initials()
    # LAST: setting a PIN leaves a keyguard/bouncer that covered every later UI
    # row in run 44233625482 (API 29); nothing runs after it.
    rows_lock()
    return 0


@row("posts: 2 same-thread + 1 other-thread + session alert → two Bridge groups")
def rows_posts():
    out = [
        driver("post", data=bridge("bcv_general", "m_proof_1", "Ada", "Proof preview A1", ADA, True, 4, GENERAL_SUBTITLE)),
        driver("post", data=bridge("bcv_general", "m_proof_2", "Ben Carter", "Proof preview A2", BEN, True, 4, GENERAL_SUBTITLE)),
        driver("post", data=bridge("bcv_group", "m_proof_3", "Aida (Ben)", "Proof preview B1", AGENT, True, 3)),
        driver("post", data={"title": "Agent finished", "message": "Session proof alert",
                             "tag": "s-proof-1", "body": json.dumps({"type": "session_complete", "sessionId": "s_proof"})}),
    ]
    # Presence is judged on the settled shade, not each post's own 8 s wait:
    # API 31 (run 44233625482) showed the first post (the one fetching a photo)
    # after its wait expired, then present in the shade. 45 s bounds that.
    tags = {o["identifier"] for o in out}
    active = wait_for(lambda: (lambda a: a if tags <= {x.get("tag") for x in a} else None)(driver("active")),
                      timeout=45, step=1) or driver("active")
    for o in out:
        o["present_after_settle"] = any(a.get("tag") == o["identifier"] for a in active)
    save("active-after-posts.json", json.dumps(active, indent=2))
    groups = sorted({a["group"] for a in bridge_records(active) if a.get("group")})
    session = [a for a in active if a.get("tag") == "s-proof-1"]
    ok = all(o["present_after_settle"] for o in out) and len(groups) == 2 and bool(session)
    record("posts: 2 same-thread + 1 other-thread + session alert → two Bridge groups", "PASS" if ok else "FAIL",
           {"posted": out, "bridge_groups": groups, "session_present": bool(session)}, ["active-after-posts.json"])
    adorn = [{k: a.get(k) for k in ("tag", "template", "messages", "hasLargeIcon", "shortcutId", "number", "channel")}
             for a in bridge_records(active)]
    styled = [a for a in adorn if (a["template"] or "").endswith("MessagingStyle")]
    hub_avatar = [h for h in json.loads(subprocess.run(["curl", "-s", f"{HUB}/__proof/requests"], capture_output=True, text=True).stdout)
                  if h["path"] == "/push-avatar/ada"]
    record("avatar/initials adornment (MessagingStyle children; avatar fetch on loopback)",
           "PASS" if styled else "FAIL", {"children": adorn, "avatar_requests": len(hub_avatar)})


@row("shade collapsed/expanded light/dark")
def rows_shade():
    files = []
    expand_found: dict = {}
    themes: dict = {}
    for dark in (False, True):
        theme = "dark" if dark else "light"
        themes[theme] = set_theme(dark, "shade")
        open_shade()
        files.append(shot(f"shade-collapsed-{theme}"))
        themes[theme]["collapsed_luma"] = frame_luma(files[-1])
        nodes = ui()
        save(f"shade-{theme}-ui.json", json.dumps(nodes))
        exp = find(nodes, id_suffix=":id/expand_button") or find(nodes, id_suffix="expand_button_touch_container")
        expand_found[theme] = bool(exp)
        if exp:
            tap(exp)
            time.sleep(1.5)
        files.append(shot(f"shade-expanded-{theme}"))
        close_shade()
    themes["restore"] = set_theme(False, "shade-restore")
    # Four frames AND a group expand control found in both themes; otherwise
    # "expanded" would be a second copy of the collapsed frame. AND each
    # frame's measured luma matches its theme (design R3 D4.4: API 29's "dark"
    # frames were light).
    luma_ok = (themes["light"]["collapsed_luma"] >= DARK_MAX_LUMA and themes["dark"]["collapsed_luma"] < DARK_MAX_LUMA)
    record("shade collapsed/expanded light/dark",
           "PASS" if len(files) == 4 and all(expand_found.values()) and luma_ok else "FAIL",
           {"expand_control_found": expand_found, "themes": themes, "dark_max_luma": DARK_MAX_LUMA}, files)
    # Launcher app badge: the channel must allow a badge and the app must hold
    # active Bridge notifications; the home frame shows the launcher's dot.
    home()
    tb = next((c for c in driver("channels") if c["id"] == "team-bridge"), {})
    live = len(bridge_records(driver("active")))
    record("app badge (channel showBadge + launcher home capture)", "PASS" if tb.get("showBadge") and live else "FAIL",
           {"team_bridge_showBadge": tb.get("showBadge"), "active_bridge_records": live}, [shot("home-badge")])


@row("lock screen hides sensitive content")
def rows_lock():
    # #304 UX R3 U8: run 44267910444 passed this row on the older "Operator"
    # agent alert alone — m_proof_lock was never shown (the driver restart
    # before this row relaunched the app in front, and nothing checked the
    # post). Now: background the app, clear every app notification, post ONE
    # fresh Bridge message, require it present, and require the lock screen to
    # show the app's row while that notification — named by its key — is the
    # only one the app holds (a group summary aside).
    home()
    driver("cancelAll")
    sh("locksettings set-pin 1234")
    sh("settings put secure lock_screen_show_notifications 1")
    sh("settings put secure lock_screen_allow_private_notifications 0")
    lock = driver("post", data=bridge("bcv_lockproof", "m_proof_lock", "Ben Carter", SECRET_PREVIEW, BEN, True, 3,
                                      "#lockproof · Example Org"), waitMs=15000)
    tag = lock["identifier"]
    active = driver("active")
    others = [a.get("tag") for a in active if a.get("tag") != tag and not a.get("isGroupSummary")]
    sh("input keyevent KEYCODE_SLEEP")
    time.sleep(2)
    sh("input keyevent KEYCODE_WAKEUP")
    time.sleep(3)
    keyguard = sh("dumpsys window policy | grep -iE 'showing=|isKeyguardShowing|mShowingLockscreen'").strip()
    dump = sh("dumpsys notification --noredact", timeout=120)
    key = next(iter(re.findall(r"key=(\S*\|" + re.escape(tag) + r"\|\d+)", dump)), None)
    frame = shot("lockscreen-hidden")
    nodes = ui()
    files = [frame, save("lockscreen-ui.json", json.dumps(nodes)), save("lockscreen-dumpsys-notification.txt", dump)]
    labels = " | ".join(n["text"] or n["desc"] for n in nodes)
    app_rows = sum(1 for n in nodes if (n["text"] or n["desc"]) == "Operator")
    # Design R3 D4.6: the rows were minimised ("Operator · 2m") so the public
    # version's placeholder line was never drawn. Expand the row and capture.
    expanded = expand_first(nodes, near="Operator")
    after = ui() if expanded else nodes
    files += [shot("lockscreen-expanded"), save("lockscreen-expanded-ui.json", json.dumps(after))]
    labels_after = " | ".join(n["text"] or n["desc"] for n in after)
    leaked = SECRET_PREVIEW in labels or SECRET_PREVIEW in labels_after
    placeholder = PLACEHOLDER in labels or PLACEHOLDER in labels_after
    sh("locksettings clear --old 1234")
    sh("wm dismiss-keyguard")
    time.sleep(2)
    # The placeholder string is recorded, not asserted: the OS may draw its own
    # redaction for a PRIVATE notification (API 29, run 44233625482).
    ok = lock["present"] and not others and bool(key) and app_rows >= 1 and not leaked
    record("lock screen hides sensitive content", "PASS" if ok else "FAIL",
           {"lock_post": lock, "notification_key": key, "other_app_notifications": others,
            "keyguard": keyguard, "app_rows_on_lockscreen": app_rows, "secret_preview_visible": leaked,
            "row_expanded": expanded, "placeholder_text_visible": placeholder, "ui_nodes": len(nodes)}, files)


@row("dumpsys notification shortcuts/channels")
def rows_dumpsys():
    files = [save("dumpsys-notification.txt", sh("dumpsys notification --noredact", timeout=120)),
             save("dumpsys-shortcut.txt", sh(f"dumpsys shortcut {PKG}", timeout=120))]
    channels = driver("channels")
    shortcuts = driver("shortcuts")
    files += [save("channels.json", json.dumps(channels, indent=2)), save("shortcuts.json", json.dumps(shortcuts, indent=2))]
    tb = next((c for c in channels if c["id"] == "team-bridge"), None)
    # Redaction is per notification: children must be VISIBILITY_PRIVATE (0)
    # with a publicVersion. The channel's own lockscreenVisibility is recorded,
    # not asserted: API 29 reported -1000 (no override) although the app asks
    # for PRIVATE (run 44233625482).
    children = [a for a in bridge_records(driver("active")) if not a.get("isGroupSummary")]
    private = bool(children) and all(a.get("visibility") == 0 and a.get("hasPublicVersion") for a in children)
    ok = tb is not None and tb["importance"] >= 4 and private
    record("dumpsys notification shortcuts/channels", "PASS" if ok else "FAIL",
           {"team_bridge_channel": tb, "children_private_with_public_version": private,
            "children": len(children), "shortcut_ids": [s["id"] for s in shortcuts]}, files)
    conv = [s for s in shortcuts if s["id"].startswith("tb:")]
    # Published = a tb: shortcut exists AND a live notification names it as its
    # shortcutId (what makes Android 11+ treat it as a conversation).
    linked = sorted({a.get("shortcutId") for a in driver("active") if a.get("shortcutId")} & {s["id"] for s in conv})
    detail = {"shortcuts": conv, "notification_linked": linked}
    if API == 31:
        record("API 31 conversation shortcut published", "PASS" if linked else "FAIL", detail)
    else:
        record(f"conversation shortcuts on API {API} (informational)", "PASS" if API < 30 or linked else "FAIL", detail)


def channel_importance() -> int | None:
    return next((c["importance"] for c in driver("channels") if c["id"] == "team-bridge"), None)


def toggle_channel_switch() -> bool:
    nodes = ui()
    sw = next((n for n in nodes if n["cls"].endswith("Switch") and n["pkg"].startswith("com.android.settings")), None)
    if not sw:
        return False
    tap(sw)
    time.sleep(1.5)
    return True


def scroll_find(text: str, tries: int = 8):
    for _ in range(tries):
        nodes = ui()
        hit = find(nodes, text=text) or find(nodes, contains=text[:40])
        if hit:
            return hit
        sh("input swipe 540 1600 540 700 300")
        time.sleep(1)
    return None


@row("channel off → in-app notice → exact channel page → on → Back clears notice")
def rows_channel():
    detail: dict = {}
    files = []
    home()
    sh(f"am start -a android.settings.CHANNEL_NOTIFICATION_SETTINGS --es android.provider.extra.APP_PACKAGE {PKG} "
       "--es android.provider.extra.CHANNEL_ID team-bridge")
    time.sleep(3)
    files.append(shot("channel-page-before-off"))
    detail["switch_tapped_off"] = toggle_channel_switch()
    detail["importance_after_off"] = channel_importance()
    sh(f"am start -a android.intent.action.VIEW -d localoperator://settings {PKG}")
    time.sleep(5)
    notice = scroll_find(NOTICE)
    detail["notice_shown"] = bool(notice)
    files.append(shot("settings-notice-shown"))
    button = scroll_find(NOTICE_OPEN, tries=2) if notice else None
    detail["handoff_button"] = bool(button)
    if button:
        tap(button)
        time.sleep(3)
        detail["handoff_focus"] = focus()
        page = ui()
        detail["handoff_page_mentions_channel"] = bool(find(page, text="Team Bridge"))
        detail["handoff_is_settings"] = any(n["pkg"] == "com.android.settings" for n in page)
        files.append(shot("handoff-channel-page"))
        detail["switch_tapped_on"] = toggle_channel_switch()
        detail["importance_after_on"] = channel_importance()
        sh("input keyevent KEYCODE_BACK")
        time.sleep(4)
        detail["back_focus"] = focus()
        nodes = ui()
        detail["notice_after_back"] = bool(find(nodes, contains=NOTICE[:40]))
        files.append(shot("settings-after-back"))
    ok = (detail.get("importance_after_off") == 0 and detail["notice_shown"] and detail.get("handoff_is_settings")
          and detail.get("handoff_page_mentions_channel") and (detail.get("importance_after_on") or 0) > 0
          and PKG in detail.get("back_focus", "") and detail.get("notice_after_back") is False)
    record("channel off → in-app notice → exact channel page → on → Back clears notice", "PASS" if ok else "FAIL", detail, files)


@row("warm tap opens thread (messages rendered)")
def rows_warm_and_foreground():
    home()
    driver("post", data=bridge("bcv_general", "m_proof_warm", "Ada", "Proof warm tap target", ADA, True, 4, GENERAL_SUBTITLE))
    open_shade()
    target = wait_for(lambda: find(ui(), contains="Proof warm tap target"), timeout=10)
    files = [shot("warm-shade")]
    if not target:
        record("warm tap opens thread", "FAIL", {"error": "notification row not found in shade"}, files)
        return
    tap(target)
    tapped = time.time()
    time.sleep(5)
    nodes = ui()
    opened = bool(find(nodes, contains="general")) and PKG in focus()
    files.append(shot("warm-tap-thread"))
    # The header alone passed rounds 1-3 while the body stayed empty on API
    # 29/31 (#304 UX R3 U9). Wait for a message body from the mock's thread,
    # then capture the SETTLED frame and its UI dump. 45 s: the hub had
    # answered /messages within 1 s in run 44267910444, and the empty body was
    # still empty ~12 s later; well past that separates lag from "never".
    settled = wait_for(lambda: (lambda n: n if any(find(n, contains=m) for m in THREAD_MARKERS) else None)(ui()),
                       timeout=45, step=2)
    rendered_after = round(time.time() - tapped, 1) if settled else None
    files.append(shot("warm-tap-thread-settled"))
    files.append(save("warm-tap-thread-ui.json", json.dumps(settled or ui())))
    record("warm tap opens thread (messages rendered)", "PASS" if opened and settled else "FAIL",
           {"focus": focus(), "thread_label_found": opened, "messages_rendered": bool(settled),
            "rendered_s_after_tap": rendered_after, "markers": THREAD_MARKERS}, files)
    if not opened:
        return
    # Foreground on #general: same-thread post suppressed, other-thread banner shown.
    same = driver("post", data=bridge("bcv_general", "m_proof_fg_same", "Ben Carter", "Proof fg same", BEN, True, 4,
                                      GENERAL_SUBTITLE),
                  expectAbsent=True, waitMs=5000)
    other = driver("post", data=bridge("bcv_group", "m_proof_fg_other", "Aida (Ben)", "Proof fg other", AGENT, True, 3), waitMs=4000)
    banner = shot("foreground-other-thread-banner")
    record("foreground: other-thread banner vs same-thread suppression",
           "PASS" if (not same["present"] and other["present"]) else "FAIL", {"same_thread": same, "other_thread": other}, [banner])


@row("Bridge unread→0 removes Bridge group; session alert stays")
def rows_unread_zero():
    before = driver("active")
    subprocess.run(["curl", "-s", f"{HUB}/__proof/unread?zero=1"], check=True, capture_output=True)
    home()
    sh(f"monkey -p {PKG} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1")

    def cleared():
        act = driver("active")
        return act if not bridge_records(act) else None
    after = wait_for(cleared, timeout=90, step=3) or driver("active")
    save("active-after-unread-zero.json", json.dumps(after, indent=2))
    session = any(a.get("tag") == "s-proof-1" for a in after)
    ok = bool(bridge_records(before)) and not bridge_records(after) and session
    home()
    open_shade()
    frame = shot("shade-after-unread-zero")
    close_shade()
    record("Bridge unread→0 removes Bridge group; session alert stays", "PASS" if ok else "FAIL",
           {"bridge_before": len(bridge_records(before)), "bridge_after": len(bridge_records(after)), "session_stays": session},
           [frame, "active-after-unread-zero.json"])
    subprocess.run(["curl", "-s", f"{HUB}/__proof/unread?zero=0"], check=True, capture_output=True)


@row("cold tap opens thread")
def rows_cold():
    try:
        cold_tap()
    finally:
        # The tap cold-started the app WITHOUT the instrumentation, so the
        # command socket is gone. Restart it here, as an expected step, so the
        # next row's crash detector does not record it as an app crash (run
        # 44267910444 logged "driver restarted before: lock screen" for this).
        # `am instrument` restarts the app process; home() leaves it backgrounded.
        restarted = False
        try:
            driver("ping")
        except Exception:
            start_driver()
            restarted = True
        home()
        log(f"driver after cold rows: restarted={restarted}")


def cold_tap():
    home()
    driver("post", data=bridge("bcv_group", "m_proof_cold", "Ben Carter", "Proof cold tap target", BEN, True, 3))
    try:
        driver("die")
    except Exception:
        pass
    dead = wait_for(lambda: not sh(f"pidof {PKG}").strip(), timeout=15)
    open_shade()
    target = wait_for(lambda: find(ui(), contains="Proof cold tap target"), timeout=10)
    files = [shot("cold-shade")]
    if not (dead and target):
        record("cold tap opens thread", "FAIL", {"process_dead": bool(dead), "row_found": bool(target)}, files)
        return
    adb("logcat", "-c")
    tap(target)
    opened = wait_for(lambda: find(ui(), contains="Launch planning") and PKG in focus(), timeout=40, step=2)
    files.append(shot("cold-tap-thread"))
    record("cold tap opens thread", "PASS" if opened else "FAIL",
           {"process_dead_before_tap": True, "pid_after": sh(f"pidof {PKG}").strip(), "focus": focus()}, files)
    if not opened:
        return
    # Dwell (#304 UX R3): the thread must still be there >= 5 s after the
    # activity is Displayed, not bounce to the list or home once JS settles.
    # `opened` is observed after Displayed by construction (the header is on
    # screen), so 6 s from here is >= 6 s after Displayed.
    displayed = [l for l in adb("logcat", "-d", "-s", "ActivityTaskManager:I", "ActivityManager:I").splitlines()
                 if "Displayed" in l and PKG in l]
    time.sleep(6)
    nodes = ui()
    still = bool(find(nodes, contains="Launch planning")) and PKG in focus()
    content = any(find(nodes, contains=m) for m in THREAD_MARKERS)
    dwell = [shot("cold-tap-dwell"), save("cold-tap-dwell-ui.json", json.dumps(nodes))]
    record("cold tap: thread still shown >= 5 s after Displayed", "PASS" if still and content else "FAIL",
           {"displayed_log": displayed[-2:], "dwell_s_after_open": 6, "thread_header": still,
            "messages_rendered": content, "focus": focus()}, dwell)
    # Back from a notification-opened thread: it must leave the thread (to the
    # app's list, or out of the app). Where it lands is recorded for UX to
    # judge; the assertion is only "not still on the thread, no crash".
    sh("input keyevent KEYCODE_BACK")
    time.sleep(3)
    after = ui()
    on_thread = any(find(after, contains=m) for m in THREAD_MARKERS)
    where = focus()
    back = [shot("cold-back-from-thread"), save("cold-back-ui.json", json.dumps(after))]
    crashed = "FATAL EXCEPTION" in adb("logcat", "-d", "-s", "AndroidRuntime:E")
    record("Back from notification-opened thread", "PASS" if not on_thread and not crashed else "FAIL",
           {"left_thread": not on_thread, "lands_in_app": PKG in where, "focus": where, "app_crash": crashed,
            "app_pid": sh(f"pidof {PKG}").strip()}, back)


@row("heads-up banner from home (every API)")
def rows_heads_up():
    # Design R3 D4.5: only API 31's frame held a banner. Posting from the
    # launcher (the app backgrounded, so no foreground suppression applies) on
    # a fresh conversation (its first child alerts: GROUP_ALERT_CHILDREN) and
    # capturing at once catches the banner inside its on-screen window.
    home()
    close_shade()
    text = "Proof heads-up banner"
    res = driver("post", data=bridge("bcv_dm_heads", "m_proof_heads", "Mia Sato", text, MIA, False, 2), waitMs=8000)
    frame = shot("heads-up")
    nodes = ui()
    shown = find(nodes, contains=text)
    files = [frame, save("heads-up-ui.json", json.dumps(nodes))]
    if shown:
        files += [c["file"] for c in row_crops(frame, [text], nodes, "heads-up") if c.get("file")]
    record("heads-up banner from home (every API)", "PASS" if res["present"] and shown else "FAIL",
           {"posted": res, "banner_text_on_screen_with_shade_closed": bool(shown)}, files)


def scenario_frames(label: str, markers: list[str], expand_near: str | None) -> dict:
    """Light, then dark: shade frame (+expanded if asked), per-row crops."""
    out: dict = {}
    for dark in (False, True):
        theme = "dark" if dark else "light"
        t = set_theme(dark, label)
        open_shade()
        nodes = ui()
        if expand_near:
            t["expanded"] = expand_first(nodes, near=expand_near)
            nodes = ui()
        frame = shot(f"{label}-{theme}")
        save(f"{label}-{theme}-ui.json", json.dumps(nodes))
        t["frame"] = frame
        t["frame_luma"] = frame_luma(frame)
        t["rows"] = row_crops(frame, markers, nodes, f"{label}-{theme}")
        close_shade()
        out[theme] = t
    out["restore"] = set_theme(False, f"{label}-restore")
    return out


def frames_files(frames: dict) -> list[str]:
    files = []
    for theme in ("light", "dark"):
        files.append(frames[theme]["frame"])
        files += [r["file"] for r in frames[theme]["rows"] if r.get("file")]
    return files


@row("multi-sender channel: each row shows its own sender (light + after theme switch)")
def rows_multi_sender():
    # #304 UX R3 U7 / design R3 D3: in a two-sender channel the older row drew
    # the newer sender's face (API 31 after a theme switch; API 36 at once).
    # Two senders, each with a DIFFERENT synthetic face, in one channel with a
    # real subtitle; per-row crops in light and again after the theme switch
    # re-inflates the rows. Each crop counts both faces' background pixels in
    # the avatar column: a row may show its own face or a conversation icon,
    # never the other sender's face.
    home()
    driver("cancelAll")
    subtitle = "#design · Example Org"
    posts = [("m_ms_mia", "Mia Sato", MIA, "Proof multi from Mia", "mia"),
             ("m_ms_kenji", "Kenji Sato", KENJI, "Proof multi from Kenji", "kenji")]
    posted = [driver("post", data=bridge("bcv_design", mid, name, text, who, True, 5, subtitle), waitMs=10000)
              for mid, name, who, text, _ in posts]
    # Let the alerting row join its group before the light capture (design
    # R3: the light pass, ~12 s after posting, still showed separate cards).
    time.sleep(12)
    active = driver("active")
    markers = [p[3] for p in posts]
    frames = scenario_frames("multi-sender", markers, expand_near=markers[0])
    wrong = []
    for theme in ("light", "dark"):
        for (_, _, _, text, own), r in zip(posts, frames[theme]["rows"]):
            other = "kenji" if own == "mia" else "mia"
            if not r.get("found"):
                wrong.append({"theme": theme, "row": text, "problem": "row not found"})
            elif r["face_px"][other] > r["face_px"][own] and r["face_px"][other] >= 200:
                wrong.append({"theme": theme, "row": text, "problem": f"shows {other}'s face", "face_px": r["face_px"]})
    themes_ok = all(frames[t]["applied"] for t in ("light", "dark"))
    ok = all(p["present"] for p in posted) and themes_ok and not wrong
    record("multi-sender channel: each row shows its own sender (light + after theme switch)", "PASS" if ok else "FAIL",
           {"posted": posted, "wrong_rows": wrong, "themes_applied": themes_ok, "frames": frames,
            "bridge_records": [{k: a.get(k) for k in ("tag", "shortcutId", "conversationTitle", "title", "messages",
                                                       "hasLargeIcon", "isGroupSummary")} for a in bridge_records(active)],
            "shortcuts": [s for s in driver("shortcuts") if s["id"] == "tb:bcv_design"]},
           frames_files(frames))


@row("initials senders: wide, CJK, Arabic, silhouette (light + dark)")
def rows_initials():
    # Design R3 D4.2: no frame showed wide (MW), non-Latin or missing
    # initials. One DM each, so the conversation avatar IS the sender's.
    home()
    driver("cancelAll")
    posted = [driver("post", data=bridge(conv, f"m_{conv}", name, text, who, False, 2), waitMs=10000)
              for conv, name, who, text in INITIALS_SENDERS]
    time.sleep(8)
    markers = [s[3] for s in INITIALS_SENDERS]
    frames = scenario_frames("initials", markers, expand_near=None)
    found = all(r.get("found") for t in ("light", "dark") for r in frames[t]["rows"])
    themes_ok = all(frames[t]["applied"] for t in ("light", "dark"))
    ok = all(p["present"] for p in posted) and found and themes_ok
    record("initials senders: wide, CJK, Arabic, silhouette (light + dark)", "PASS" if ok else "FAIL",
           {"posted": posted, "senders": [{"title": s[1], "initials": s[2].get("initials")} for s in INITIALS_SENDERS],
            "all_rows_cropped": found, "themes_applied": themes_ok, "frames": frames}, frames_files(frames))


if __name__ == "__main__":
    code = 1
    try:
        code = main()
    except Exception as e:
        record("harness", "FAIL", {"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]})
    finally:
        save("logcat.txt", adb("logcat", "-d", timeout=120))
        json.dump(receipts, open(os.path.join(EVIDENCE, f"receipts-api{API}.json"), "w"), indent=2)
        failed = [r for r in receipts if r["result"] != "PASS"]
        print(f"api{API}: {len(receipts) - len(failed)}/{len(receipts)} rows PASS")
        try:
            driver("finish")
        except Exception:
            pass
    sys.exit(1 if failed or code else 0)
