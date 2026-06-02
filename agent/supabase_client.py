"""
supabase_client.py - v3
פונקציות נוספות: שיעורים, מורים, סוללה, strikes
"""

import requests, json, os, sys, threading, time, logging
from datetime import datetime
import ssl
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

log = logging.getLogger(__name__)

if getattr(sys, 'frozen', False):
    _DIR = os.path.dirname(sys.executable)
else:
    _DIR = os.path.dirname(os.path.abspath(__file__))

def load_obfuscated_config(filepath):
    with open(filepath, "rb") as f:
        data = f.read()
    try:
        return json.loads(data.decode("utf-8-sig"))
    except Exception:
        key = b"CartAgentSecureKey2026!"
        decrypted = bytes(data[i] ^ key[i % len(key)] for i in range(len(data)))
        return json.loads(decrypted.decode("utf-8"))

_CFG = load_obfuscated_config(os.path.join(_DIR, "config.json"))

SUPABASE_URL = _CFG["supabase_url"]
SUPABASE_KEY = _CFG["supabase_key"]
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


# ─── REST helpers ─────────────────────────────────────────────

def _get(path, params=None):
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}",
                         headers=HEADERS, params=params, timeout=10)
        r.raise_for_status(); return r.json()
    except Exception as e:
        log.error(f"GET {path}: {e}"); return None

def _post(path, data):
    try:
        r = requests.post(f"{SUPABASE_URL}/rest/v1/{path}",
                          headers=HEADERS, json=data, timeout=10)
        r.raise_for_status(); return r.json()
    except Exception as e:
        log.error(f"POST {path}: {e}"); return None

def _patch(path, data, params=None):
    try:
        r = requests.patch(f"{SUPABASE_URL}/rest/v1/{path}",
                           headers=HEADERS, json=data, params=params, timeout=10)
        r.raise_for_status(); return r.json()
    except Exception as e:
        log.error(f"PATCH {path}: {e}"); return None

def _rpc(fn, params):
    try:
        r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}",
                          headers=HEADERS, json=params, timeout=10)
        r.raise_for_status(); return r.json()
    except Exception as e:
        log.error(f"RPC {fn}: {e}"); return None


# ─── מחשב ─────────────────────────────────────────────────────

def get_device_id_by_asset_tag(asset_tag):
    rows = _get("devices", {"asset_tag": f"eq.{asset_tag}", "select": "id"})
    return rows[0]["id"] if rows else None

def get_active_loan(asset_tag):
    devs = _get("devices", {"asset_tag": f"eq.{asset_tag}", "select": "id,device_number,cart_id"})
    if not devs: return None
    did = devs[0]["id"]
    loans = _get("device_loans", {"device_id": f"eq.{did}", "status": "eq.active",
                                   "checkin_at": "is.null",
                                   "select": "id,student_id,checkout_at,digital_login_at,lesson_id"})
    if not loans: return None
    loan = loans[0]
    stu = _get("students", {"id": f"eq.{loan['student_id']}",
                             "select": "id,national_id,name,class_name,grade,charge_strikes"})
    if not stu: return None
    s = stu[0]

    # Fetch per-cart charge tracking setting
    enable_tracking = True
    if devs[0].get("cart_id"):
        cart_opts = _get("carts", {"id": f"eq.{devs[0]['cart_id']}", "select": "enable_charge_tracking"})
        if cart_opts:
            enable_tracking = cart_opts[0].get("enable_charge_tracking", True)

    return {
        "loan_id":       loan["id"],
        "device_id":     did,
        "device_number": devs[0]["device_number"],
        "checkout_at":   loan["checkout_at"],
        "lesson_id":     loan.get("lesson_id"),
        "student_id":    s["id"],
        "national_id":   s["national_id"],
        "student_name":  s["name"],
        "class_name":    s.get("class_name", ""),
        "grade":         s.get("grade", ""),
        "charge_strikes": s.get("charge_strikes", 0),
        "enable_charge_tracking": enable_tracking,
    }

def log_digital_login(loan_id, device_id):
    now = datetime.utcnow().isoformat() + "Z"
    _patch("device_loans", {"digital_login_at": now}, {"id": f"eq.{loan_id}"})
    _patch("devices", {"status": "active", "last_seen": now}, {"id": f"eq.{device_id}"})

def log_digital_logout(loan_id, device_id):
    now = datetime.utcnow().isoformat() + "Z"
    _patch("device_loans", {"digital_logout_at": now}, {"id": f"eq.{loan_id}"})
    _patch("devices", {"status": "locked", "last_seen": now}, {"id": f"eq.{device_id}"})

def heartbeat(device_id, battery_level=None, is_charging=None):
    now = datetime.utcnow().isoformat() + "Z"
    data = {"last_seen": now}
    if battery_level is not None: data["battery_level"] = battery_level
    if is_charging   is not None: data["is_charging"]   = is_charging
    _patch("devices", data, {"id": f"eq.{device_id}"})

def save_battery_before_sleep(device_id, battery_level):
    """שמור רמת סוללה לפני שינה – לשימוש בהשוואה בהתעוררות"""
    now = datetime.utcnow().isoformat() + "Z"
    _patch("devices", {"last_battery_level": battery_level,
                        "last_battery_recorded": now},
           {"id": f"eq.{device_id}"})

def get_last_battery(device_id):
    """שלוף רמת סוללה אחרונה לפני שינה מה-DB"""
    rows = _get("devices", {"id": f"eq.{device_id}",
                             "select": "last_battery_level,last_battery_recorded,battery_level"})
    return rows[0] if rows else None

def log_event(device_id, loan_id, event_type, payload=None):
    _post("event_log", {"device_id": device_id, "loan_id": loan_id,
                         "source": "agent", "event_type": event_type,
                         "payload": payload or {}})


# ─── מורים ────────────────────────────────────────────────────

def is_teacher(national_id: str) -> dict | None:
    """מחזיר רשומת מורה אם ת.ז. שייכת למורה פעיל באמצעות RPC מאובטח"""
    res = _rpc("verify_teacher_id", {"entered_id": national_id})
    if res and res.get("is_valid"):
        return {"id": res.get("teacher_id"), "name": res.get("teacher_name")}
    return None


# ─── שיעורים ──────────────────────────────────────────────────

def get_active_lesson_by_code(lesson_code: str) -> dict | None:
    """
    מחזיר שיעור פעיל לפי קוד + זמן שרת לחישוב offset.
    מחזיר: {lesson_id, end_time, server_now, is_locked, teacher_name, minutes_remaining}
    """
    rows = _get("active_lessons",
                {"lesson_code": f"eq.{lesson_code}", "select": "*"})
    if not rows: return None
    lesson = rows[0]

    # שלוף server NOW() לחישוב offset מדויק באמצעות RPC
    server_now = _rpc("get_server_time", {})
    if not server_now:
        server_now = datetime.utcnow().isoformat() + "Z"

    return {
        "lesson_id":       lesson["id"],
        "end_time":        lesson["end_time"],
        "is_locked":       lesson["is_locked"],
        "teacher_name":    lesson.get("teacher_name", ""),
        "subject":         lesson.get("subject", ""),
        "minutes_remaining": lesson.get("minutes_remaining", 0),
        "server_now":      server_now,
    }

def get_lesson_server_time(lesson_id: str) -> dict | None:
    """
    שולף end_time + approximation של NOW() מצד השרת.
    עובד ע"י קריאת end_time ומחשב elapsed מאז start_time.
    """
    rows = _get("lessons", {"id": f"eq.{lesson_id}",
                             "select": "end_time,start_time,status,is_locked"})
    if not rows: return None
    return rows[0]

def join_lesson(lesson_id, loan_id, device_id, student_id) -> bool:
    """מצרף מחשב לשיעור + מעדכן lesson_id בהשאלה"""
    result = _post("lesson_participants", {
        "lesson_id":  lesson_id,
        "loan_id":    loan_id,
        "device_id":  device_id,
        "student_id": student_id,
    })
    if result:
        _patch("device_loans", {"lesson_id": lesson_id}, {"id": f"eq.{loan_id}"})
    return bool(result)

def get_lesson_status(lesson_id: str) -> dict | None:
    """בדיקה תקופתית של סטטוס שיעור (ל-polling fallback)"""
    rows = _get("lessons", {"id": f"eq.{lesson_id}",
                             "select": "status,is_locked,end_time"})
    return rows[0] if rows else None

def check_pre_assigned_lessons(national_id: str) -> list:
    """
    בודק האם התלמיד משויך לשיעור פעיל אחד או יותר.
    מחזיר רשימה של שיעורים: [{lesson_id, lesson_code, subject, teacher_name, end_time, server_now, is_locked}]
    """
    res = _rpc("get_pre_assigned_active_lesson", {"entered_id": national_id})
    if res and isinstance(res, list):
        return res
    return []


# ─── Strikes ──────────────────────────────────────────────────

def add_charge_strike(student_id: str, device_id: str, loan_id: str) -> int:
    """מוסיף strike ומחזיר את המספר החדש"""
    rows = _get("students", {"id": f"eq.{student_id}", "select": "charge_strikes"})
    if not rows: return 0
    new_count = (rows[0].get("charge_strikes") or 0) + 1
    _patch("students", {"charge_strikes": new_count}, {"id": f"eq.{student_id}"})
    log_event(device_id, loan_id, "charge_strike_added", {"strike_count": new_count})
    return new_count

def reset_charge_strikes(student_id: str, device_id: str = None, loan_id: str = None):
    """מאפס strikes (כשהתלמיד חיבר לחשמל)"""
    now = datetime.utcnow().isoformat() + "Z"
    _patch("students", {"charge_strikes": 0, "last_charged_at": now},
           {"id": f"eq.{student_id}"})
    if device_id:
        log_event(device_id, loan_id, "charge_strike_reset")

def get_student_strikes(student_id: str) -> int:
    rows = _get("students", {"id": f"eq.{student_id}", "select": "charge_strikes"})
    return rows[0].get("charge_strikes", 0) if rows else 0


# ─── Realtime WebSocket ───────────────────────────────────────

class RealtimeSubscription:
    """מאזין לשינויים בטבלה דרך Supabase Realtime"""

    def __init__(self, table, record_filter, event_type="UPDATE",
                 on_change=None, channel_name=None):
        self.table        = table
        self.filter       = record_filter   # e.g. "id=eq.xxx"
        self.event_type   = event_type
        self.on_change    = on_change
        self.channel      = channel_name or f"rt-{table}-{record_filter}"
        self._ws          = None
        self._running     = False
        self._ref         = 0

    def start(self):
        self._running = True
        threading.Thread(target=self._run_loop, daemon=True).start()

    def stop(self):
        self._running = False
        if self._ws:
            try: self._ws.close()
            except: pass

    def _next_ref(self):
        self._ref += 1; return str(self._ref)

    def _run_loop(self):
        while self._running:
            try: self._connect()
            except Exception as e: log.error(f"Realtime {self.channel}: {e}")
            if self._running:
                log.info(f"Realtime {self.channel}: reconnecting in 15s")
                time.sleep(15)

    def _connect(self):
        import websocket
        ws_url = (SUPABASE_URL.replace("https://", "wss://")
                  + f"/realtime/v1/websocket?apikey={SUPABASE_KEY}&vsn=1.0.0")

        def on_open(ws):
            ws.send(json.dumps({
                "topic": f"realtime:{self.channel}",
                "event": "phx_join",
                "payload": {"config": {"postgres_changes": [{
                    "event":  self.event_type,
                    "schema": "public",
                    "table":  self.table,
                    "filter": self.filter,
                }]}},
                "ref": self._next_ref(),
            }))
            threading.Thread(target=self._hb_loop, args=(ws,), daemon=True).start()

        def on_message(ws, msg):
            try:
                data = json.loads(msg)
                if data.get("event") == "postgres_changes" and self.on_change:
                    record = data.get("payload", {}).get("data", {}).get("record", {})
                    self.on_change(record)
            except Exception as e:
                log.error(f"Realtime msg error: {e}")

        self._ws = websocket.WebSocketApp(
            ws_url,
            on_open=on_open, on_message=on_message,
            on_error=lambda ws, e: log.error(f"WS err: {e}"),
            on_close=lambda ws, c, m: log.info(f"WS closed: {c}"),
        )
        self._ws.run_forever()

    def _hb_loop(self, ws):
        while self._running:
            time.sleep(25)
            try:
                ws.send(json.dumps({"topic": "phoenix", "event": "heartbeat",
                                    "payload": {}, "ref": self._next_ref()}))
            except: break
