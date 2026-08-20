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


# ─── REST & API helpers ───────────────────────────────────────

API_BASE_URL = _CFG.get("api_base_url", "https://school-cart-manager.vercel.app/api/agent")

def _api_post(endpoint, payload):
    try:
        url = API_BASE_URL
        payload["endpoint"] = endpoint
        r = requests.post(url, json=payload, timeout=10, verify=False)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.error(f"API POST {endpoint}: {e}")
        return None

def _get(path, params=None):
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}",
                         headers=HEADERS, params=params, timeout=10, verify=False)
        r.raise_for_status(); return r.json()
    except Exception as e:
        log.error(f"GET {path}: {e}"); return None

def _post(path, data):
    try:
        r = requests.post(f"{SUPABASE_URL}/rest/v1/{path}",
                          headers=HEADERS, json=data, timeout=10, verify=False)
        r.raise_for_status()
        if r.status_code == 204 or not r.text.strip():
            return True
        return r.json()
    except Exception as e:
        log.error(f"POST {path}: {e}"); return None

def _patch(path, data, params=None):
    try:
        r = requests.patch(f"{SUPABASE_URL}/rest/v1/{path}",
                           headers=HEADERS, json=data, params=params, timeout=10, verify=False)
        r.raise_for_status()
        if r.status_code == 204 or not r.text.strip():
            return True
        return r.json()
    except Exception as e:
        log.error(f"PATCH {path}: {e}"); return None

def _delete(path, params=None):
    try:
        r = requests.delete(f"{SUPABASE_URL}/rest/v1/{path}",
                            headers=HEADERS, params=params, timeout=10, verify=False)
        r.raise_for_status()
        if r.status_code == 204 or not r.text.strip():
            return True
        return r.json()
    except Exception as e:
        log.error(f"DELETE {path}: {e}"); return None

def _rpc(fn, params):
    try:
        r = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}",
                          headers=HEADERS, json=params, timeout=10, verify=False)
        r.raise_for_status()
        if r.status_code == 204 or not r.text.strip():
            return True
        return r.json()
    except Exception as e:
        log.error(f"RPC {fn}: {e}"); return None


# ─── מחשב ─────────────────────────────────────────────────────

def get_device_id_by_asset_tag(asset_tag):
    res = _api_post("get_device_id", {"assetTag": asset_tag})
    if res and res.get("device_id"):
        return res["device_id"]
    try:
        rows = _get("devices", {"asset_tag": f"eq.{asset_tag}", "select": "id"})
        return rows[0]["id"] if rows else None
    except Exception:
        return None

def get_active_loan(asset_tag):
    res = _api_post("active-loan", {"assetTag": asset_tag})
    if res is None:
        return "OFFLINE"
    loan = res.get("loan")
    if loan and isinstance(loan, dict):
        if "device_id" not in loan and res.get("device_id"):
            loan["device_id"] = res.get("device_id")
        loan["registered"] = True
        return loan

    # If no active loan, check registration status
    registered = res.get("registered", True)
    if not registered:
        return {"unregistered": True, "registered": False}

    return {
        "unborrowed": True,
        "registered": True,
        "device_id": res.get("device_id"),
        "cart_name": res.get("cart_name", ""),
        "device_number": res.get("device_number")
    }

def log_digital_login(loan_id, device_id):
    """רושם כניסה דיגיטלית של התלמיד דרך ה-API"""
    log_event(device_id, loan_id, "digital_login")

def log_digital_logout(loan_id, device_id):
    """רושם יציאה דיגיטלית ונעילה של המחשב דרך ה-API"""
    log_event(device_id, loan_id, "digital_logout")

def heartbeat(device_id, battery_level=None, is_charging=None):
    payload = {"deviceId": device_id}
    if battery_level is not None: payload["batteryLevel"] = battery_level
    if is_charging is not None: payload["isCharging"] = is_charging
    _api_post("heartbeat", payload)

def save_battery_before_sleep(device_id, battery_level):
    """שמור רמת סוללה לפני שינה דרך ה-API"""
    _api_post("save_battery", {"deviceId": device_id, "batteryLevel": battery_level})

def get_last_battery(device_id):
    """שלוף רמת סוללה אחרונה לפני שינה מה-API"""
    res = _api_post("get_last_battery", {"deviceId": device_id})
    return res.get("battery") if res else None

def log_event(device_id, loan_id, event_type, payload=None):
    _api_post("heartbeat", {
        "deviceId": device_id,
        "loanId": loan_id,
        "eventType": event_type,
        "payload": payload or {}
    })


# ─── מורים ────────────────────────────────────────────────────

def is_teacher(national_id: str) -> dict | None:
    """מחזיר רשומת מורה אם ת.ז. שייכת למורה פעיל באמצעות API מאובטח"""
    res = _api_post("verify-id", {"action": "verify_teacher", "nationalId": national_id})
    if res and res.get("isTeacher"):
        return res.get("teacher")
    return None


# ─── שיעורים ──────────────────────────────────────────────────

def get_active_lesson_by_code(lesson_code: str) -> dict | None:
    """מחזיר שיעור פעיל לפי קוד דרך ה-API"""
    res = _api_post("lesson", {"action": "get_by_code", "lessonCode": lesson_code})
    if not res or not res.get("lesson"): return None
    lesson = res["lesson"]
    server_now = res.get("server_now") or (datetime.utcnow().isoformat() + "Z")

    return {
        "lesson_id":       lesson["id"],
        "end_time":        lesson["end_time"],
        "is_locked":       lesson["is_locked"],
        "teacher_name":    lesson.get("teacher_name", ""),
        "subject":         lesson.get("subject", ""),
        "minutes_remaining": lesson.get("minutes_remaining", 0),
        "server_now":      server_now,
    }

def get_active_lesson_by_id(lesson_id: str) -> dict | None:
    """מחזיר פרטי שיעור פעיל לפי מזהה UUID דרך ה-API"""
    res = _api_post("lesson", {"action": "get_by_id", "lessonId": lesson_id})
    if not res or not res.get("lesson"): return None
    lesson = res["lesson"]
    server_now = res.get("server_now") or (datetime.utcnow().isoformat() + "Z")

    return {
        "lesson_id":       lesson["id"],
        "end_time":        lesson["end_time"],
        "is_locked":       lesson["is_locked"],
        "teacher_name":    lesson.get("teacher_name", ""),
        "subject":         lesson.get("subject", ""),
        "minutes_remaining": lesson.get("minutes_remaining", 0),
        "server_now":      server_now,
    }

def join_lesson(lesson_id, loan_id, device_id, student_id) -> bool:
    """מצרף מחשב לשיעור + מעדכן lesson_id בהשאלה דרך ה-API"""
    res = _api_post("lesson", {
        "action": "join",
        "lessonId": lesson_id,
        "loanId": loan_id,
        "deviceId": device_id,
        "studentId": student_id
    })
    return bool(res and res.get("success"))

def disconnect_student_from_lesson(loan_id, student_id, lesson_id=None) -> bool:
    """מנתק תלמיד משיעור באופן מאובטח דרך ה-API"""
    res = _api_post("lesson", {
        "action": "disconnect",
        "lessonId": lesson_id,
        "loanId": loan_id,
        "studentId": student_id
    })
    return bool(res and res.get("success"))

def check_pre_assigned_lessons(national_id: str) -> list:
    """בודק האם התלמיד משויך לשיעור פעיל דרך ה-API"""
    res = _api_post("lesson", {"action": "check_pre_assigned", "nationalId": national_id})
    if res and res.get("lesson"):
        l = res["lesson"]
        return l if isinstance(l, list) else [l]
    return []

def get_teacher_active_lessons(teacher_id: str) -> list:
    """שולף את כל השיעורים הפעילים של המורה דרך ה-API (מוודא שזמן השיעור טרם חלף)"""
    try:
        api_root = API_BASE_URL.replace("/agent", "")
        url = f"{api_root}/teacher"
        r = requests.post(url, json={"action": "list", "teacherId": teacher_id}, timeout=10, verify=False)
        r.raise_for_status()
        data = r.json()
        if data and data.get("lessons"):
            now_iso = datetime.utcnow().isoformat()
            active_list = []
            for l in data["lessons"]:
                if l.get("status") == "active":
                    end_t = l.get("end_time")
                    if end_t and str(end_t).replace("Z", "") < now_iso:
                        continue
                    active_list.append(l)
            return active_list
    except Exception as e:
        log.error(f"Error fetching teacher active lessons: {e}")
    return []

def update_teacher_lesson_status(lesson_id: str, is_locked: bool = None, duration_minutes: int = None, status: str = None) -> dict | None:
    """מעדכן סטטוס שיעור (הקפאה/הפשרה/הארכה/סיום) דרך ה-API"""
    try:
        api_root = API_BASE_URL.replace("/agent", "")
        url = f"{api_root}/teacher"
        payload = {"action": "update_status", "lessonId": lesson_id}
        if is_locked is not None: payload["isLocked"] = is_locked
        if duration_minutes is not None: payload["durationMinutes"] = duration_minutes
        if status is not None: payload["status"] = status
        r = requests.post(url, json=payload, timeout=10, verify=False)
        r.raise_for_status()
        data = r.json()
        if data and data.get("lesson"):
            return data["lesson"]
    except Exception as e:
        log.error(f"Error updating teacher lesson status: {e}")
    return None

def create_teacher_lesson(teacher_id: str, subject: str = "שיעור", duration_minutes: int = 45, is_locked: bool = False) -> dict | None:
    """יוצר שיעור חדש עבור המורה דרך ה-API"""
    try:
        api_root = API_BASE_URL.replace("/agent", "")
        url = f"{api_root}/teacher"
        payload = {
            "action": "create",
            "teacherId": teacher_id,
            "subject": subject,
            "minutes": duration_minutes,
            "isLocked": is_locked
        }
        r = requests.post(url, json=payload, timeout=10, verify=False)
        r.raise_for_status()
        data = r.json()
        if data and data.get("lesson"):
            return data["lesson"]
    except Exception as e:
        log.error(f"Error creating teacher lesson: {e}")
    return None

def get_teacher_portal_token(teacher_id: str) -> str | None:
    """שולף טוקן כניסה חד-פעמי ומאובטח (60s) לפורטל המורים"""
    try:
        api_root = API_BASE_URL.replace("/agent", "")
        url = f"{api_root}/teacher"
        r = requests.post(url, json={"action": "generate_token", "teacherId": teacher_id}, timeout=8, verify=False)
        r.raise_for_status()
        data = r.json()
        if data and data.get("token"):
            return data["token"]
    except Exception as e:
        log.error(f"Error generating teacher portal token: {e}")
    return None


# ─── Strikes ──────────────────────────────────────────────────
 
def add_charge_strike(student_id: str, device_id: str, loan_id: str) -> int:
    """מוסיף strike דרך ה-API ומחזיר את המספר החדש"""
    res = _api_post("add_strike", {"studentId": student_id, "deviceId": device_id, "loanId": loan_id})
    return res.get("count", 0) if res else 0

def reset_charge_strikes(student_id: str, device_id: str = None, loan_id: str = None):
    """מאפס strikes דרך ה-API (כשהתלמיד חיבר לחשמל)"""
    _api_post("reset_strikes", {"studentId": student_id, "deviceId": device_id, "loanId": loan_id})

def get_student_strikes(student_id: str) -> int:
    """שולף כמות strikes דרך ה-API"""
    res = _api_post("get_strikes", {"studentId": student_id})
    return res.get("strikes", 0) if res else 0


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
        self.is_connected = False
        self._reconnect_event = threading.Event()

    def start(self):
        self._running = True
        self._reconnect_event.clear()
        threading.Thread(target=self._run_loop, daemon=True).start()

    def stop(self):
        self._running = False
        self.is_connected = False
        if self._ws:
            try: self._ws.close()
            except: pass
        self._reconnect_event.set() # Wake up reconnect sleep immediately

    def trigger_reconnect(self):
        """מאפשר לעורר את החיבור מחדש באופן מיידי (למשל כשהאינטרנט חוזר)"""
        log.info(f"Realtime {self.channel}: Reconnect triggered immediately")
        self._reconnect_event.set()

    def _next_ref(self):
        self._ref += 1; return str(self._ref)

    def _run_loop(self):
        delay = 15
        while self._running:
            start_time = time.time()
            try:
                self._connect()
            except Exception as e:
                log.error(f"Realtime {self.channel}: {e}")
            
            if self._running:
                # If connected for more than 30 seconds, reset backoff delay
                if time.time() - start_time > 30:
                    delay = 15
                else:
                    delay = min(delay * 2, 300)
                
                log.info(f"Realtime {self.channel}: reconnecting in {delay}s")
                self._reconnect_event.clear()
                self._reconnect_event.wait(timeout=delay)

    def _connect(self):
        import websocket
        ws_url = (SUPABASE_URL.replace("https://", "wss://")
                  + f"/realtime/v1/websocket?apikey={SUPABASE_KEY}&vsn=1.0.0")

        def on_open(ws):
            self.is_connected = True
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

        def _on_error(ws, e):
            self.is_connected = False
            log.error(f"WS err: {e}")

        def _on_close(ws, c, m):
            self.is_connected = False
            log.info(f"WS closed: {c}")

        self._ws = websocket.WebSocketApp(
            ws_url,
            on_open=on_open, on_message=on_message,
            on_error=_on_error,
            on_close=_on_close,
        )
        self._ws.run_forever(sslopt={"cert_reqs": ssl.CERT_NONE})

    def _hb_loop(self, ws):
        while self._running:
            time.sleep(25)
            try:
                ws.send(json.dumps({"topic": "phoenix", "event": "heartbeat",
                                    "payload": {}, "ref": self._next_ref()}))
            except: break
