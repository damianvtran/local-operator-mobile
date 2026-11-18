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
                              "x": (b[0] + b[2]) // 2, "y": (b[1] + b[3]) // 2})
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


def bridge(conv: str, msg: str, title: str, text: str, sender: dict | None, group: bool, members: int) -> dict:
    body = {"v": 1, "type": "team_bridge_message", "tenant_id": TENANT, "conversation_id": conv,
            "message_id": msg, "seq": 1}
    if sender:
        body["sender"] = sender
    body["conv"] = {"group": group, "members": members}
    return {"title": title, "message": text, "channelId": "team-bridge",
            "tag": f"tb:{conv}:{msg}", "body": json.dumps(body)}


ADA = {"kind": "person", "initials": "A", "tone": 2,
       "photo": {"url": f"{HUB}/push-avatar/ada", "nonce": "proofnonce0123456789AB"}}
BEN = {"kind": "person", "initials": "BC", "tone": 5}
AGENT = {"kind": "agent", "tone": 3}


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
    rows_lock()
    rows_dumpsys()
    rows_channel()
    rows_warm_and_foreground()
    rows_unread_zero()
    rows_cold()
    return 0


@row("posts: 2 same-thread + 1 other-thread + session alert → two Bridge groups")
def rows_posts():
    out = [
        driver("post", data=bridge("bcv_general", "m_proof_1", "Ada", "Proof preview A1", ADA, True, 4)),
        driver("post", data=bridge("bcv_general", "m_proof_2", "Ben Carter", "Proof preview A2", BEN, True, 4)),
        driver("post", data=bridge("bcv_group", "m_proof_3", "Aida (Ben)", "Proof preview B1", AGENT, True, 3)),
        driver("post", data={"title": "Agent finished", "message": "Session proof alert",
                             "tag": "s-proof-1", "body": json.dumps({"type": "session_complete", "sessionId": "s_proof"})}),
    ]
    time.sleep(3)
    active = driver("active")
    save("active-after-posts.json", json.dumps(active, indent=2))
    groups = sorted({a["group"] for a in bridge_records(active) if a.get("group")})
    session = [a for a in active if a.get("tag") == "s-proof-1"]
    ok = all(o["present"] for o in out) and len(groups) == 2 and bool(session)
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
    for mode in ("no", "yes"):
        sh(f"cmd uimode night {mode}")
        time.sleep(2)
        theme = "light" if mode == "no" else "dark"
        open_shade()
        files.append(shot(f"shade-collapsed-{theme}"))
        nodes = ui()
        save(f"shade-{theme}-ui.json", json.dumps(nodes))
        exp = find(nodes, id_suffix=":id/expand_button") or find(nodes, id_suffix="expand_button_touch_container")
        expand_found[theme] = bool(exp)
        if exp:
            tap(exp)
            time.sleep(1.5)
        files.append(shot(f"shade-expanded-{theme}"))
        close_shade()
    sh("cmd uimode night no")
    # Four frames AND a group expand control found in both themes; otherwise
    # "expanded" would be a second copy of the collapsed frame.
    record("shade collapsed/expanded light/dark", "PASS" if len(files) == 4 and all(expand_found.values()) else "FAIL",
           {"expand_control_found": expand_found}, files)
    # Launcher app badge: the channel must allow a badge and the app must hold
    # active Bridge notifications; the home frame shows the launcher's dot.
    home()
    tb = next((c for c in driver("channels") if c["id"] == "team-bridge"), {})
    live = len(bridge_records(driver("active")))
    record("app badge (channel showBadge + launcher home capture)", "PASS" if tb.get("showBadge") and live else "FAIL",
           {"team_bridge_showBadge": tb.get("showBadge"), "active_bridge_records": live}, [shot("home-badge")])


@row("lock screen hides sensitive content")
def rows_lock():
    sh("locksettings set-pin 1234")
    sh("settings put secure lock_screen_show_notifications 1")
    sh("settings put secure lock_screen_allow_private_notifications 0")
    driver("post", data=bridge("bcv_group", "m_proof_lock", "Ben Carter", SECRET_PREVIEW, BEN, True, 3))
    sh("input keyevent KEYCODE_SLEEP")
    time.sleep(2)
    sh("input keyevent KEYCODE_WAKEUP")
    time.sleep(3)
    frame = shot("lockscreen-hidden")
    nodes = ui()
    save("lockscreen-ui.json", json.dumps(nodes))
    labels = " | ".join(n["text"] or n["desc"] for n in nodes)
    leaked = SECRET_PREVIEW in labels
    placeholder = PLACEHOLDER in labels
    sh("locksettings clear --old 1234")
    sh("wm dismiss-keyguard")
    time.sleep(2)
    # PASS needs the hidden placeholder ON the lock screen, not just absence of
    # the preview: an empty lock screen would otherwise pass vacuously.
    record("lock screen hides sensitive content", "PASS" if nodes and not leaked and placeholder else "FAIL",
           {"secret_preview_visible": leaked, "placeholder_visible": placeholder, "ui_nodes": len(nodes)}, [frame])


@row("dumpsys notification shortcuts/channels")
def rows_dumpsys():
    files = [save("dumpsys-notification.txt", sh("dumpsys notification --noredact", timeout=120)),
             save("dumpsys-shortcut.txt", sh(f"dumpsys shortcut {PKG}", timeout=120))]
    channels = driver("channels")
    shortcuts = driver("shortcuts")
    files += [save("channels.json", json.dumps(channels, indent=2)), save("shortcuts.json", json.dumps(shortcuts, indent=2))]
    tb = next((c for c in channels if c["id"] == "team-bridge"), None)
    ok = tb is not None and tb["importance"] >= 4 and tb["lockscreenVisibility"] == 0
    record("dumpsys notification shortcuts/channels", "PASS" if ok else "FAIL",
           {"team_bridge_channel": tb, "shortcut_ids": [s["id"] for s in shortcuts]}, files)
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


@row("warm tap opens thread")
def rows_warm_and_foreground():
    home()
    driver("post", data=bridge("bcv_general", "m_proof_warm", "Ada", "Proof warm tap target", ADA, True, 4))
    open_shade()
    target = wait_for(lambda: find(ui(), contains="Proof warm tap target"), timeout=10)
    files = [shot("warm-shade")]
    if not target:
        record("warm tap opens thread", "FAIL", {"error": "notification row not found in shade"}, files)
        return
    tap(target)
    time.sleep(5)
    nodes = ui()
    opened = bool(find(nodes, contains="general")) and PKG in focus()
    files.append(shot("warm-tap-thread"))
    record("warm tap opens thread", "PASS" if opened else "FAIL", {"focus": focus(), "thread_label_found": opened}, files)
    if not opened:
        return
    # Foreground on #general: same-thread post suppressed, other-thread banner shown.
    same = driver("post", data=bridge("bcv_general", "m_proof_fg_same", "Ben Carter", "Proof fg same", BEN, True, 4),
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
    tap(target)
    opened = wait_for(lambda: find(ui(), contains="Launch planning") and PKG in focus(), timeout=40, step=2)
    files.append(shot("cold-tap-thread"))
    record("cold tap opens thread", "PASS" if opened else "FAIL",
           {"process_dead_before_tap": True, "pid_after": sh(f"pidof {PKG}").strip(), "focus": focus()}, files)


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
