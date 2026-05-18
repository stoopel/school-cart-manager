"""
agent.py - v4
שיעורים + מערכת טעינה + strikes + offset זמן שרת + wake detection
"""

import json, os, sys, threading, time, socket, ctypes, logging
from datetime import datetime, timezone

from lockscreen import LockScreen
import supabase_client as db

# ── Logging ───────────────────────────────────────────────────
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent.log")
logging.basicConfig(filename=LOG_PATH, level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    _DIR = os.path.dirname(sys.executable)
else:
    _DIR = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(_DIR, "config.json"), encoding="utf-8") as f:
    CONFIG = json.load(f)

ASSET_TAG    = CONFIG["asset_tag"]
ADMIN_CODE   = CONFIG.get("admin_code", "")
HB_INTERVAL  = CONFIG.get("heartbeat_interval_sec", 60)
IDLE_TIMEOUT = CONFIG.get("idle_timeout_sec", 300)
WAKE_GAP_SEC = 30
MAX_STRIKES  = 3


# ── Windows helpers ───────────────────────────────────────────

class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

def get_idle_seconds():
    lii = _LASTINPUTINFO(); lii.cbSize = ctypes.sizeof(lii)
    ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii))
    return (ctypes.windll.kernel32.GetTickCount() - lii.dwTime) / 1000.0

def send_to_sleep():
    ctypes.windll.PowrProf.SetSuspendState(0, 1, 0)

def get_battery_info():
    """מחזיר (level: int, is_charging: bool) או (None, None)"""
    class PWR(ctypes.Structure):
        _fields_ = [("ACLineStatus", ctypes.c_byte), ("BatteryFlag", ctypes.c_byte),
                    ("BatteryLifePercent", ctypes.c_byte), ("SystemStatusFlag", ctypes.c_byte),
                    ("BatteryLifeTime", ctypes.c_ulong), ("BatteryFullLifeTime", ctypes.c_ulong)]
    s = PWR()
    ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(s))
    level = s.BatteryLifePercent if s.BatteryLifePercent != 255 else None
    charging = s.ACLineStatus == 1
    return level, charging

def is_connected():
    try:
        socket.setdefaulttimeout(3)
        socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(("8.8.8.8", 53))
        return True
    except: return False


# ── Lesson Timer ──────────────────────────────────────────────

class LessonTimer:
    """
    מנהל countdown של שיעור.
    משתמש ב-offset בין זמן שרת לזמן מקומי לדיוק מרבי.
    """
    def __init__(self, end_time_str: str, server_now_str: str = None):
        self.end_time = self._parse(end_time_str)
        if server_now_str:
            server_now  = self._parse(server_now_str)
            local_now   = datetime.now(timezone.utc)
            self.offset = (server_now - local_now).total_seconds()
        else:
            self.offset = 0.0

    def _parse(self, s):
        s = s.replace("Z", "+00:00")
        return datetime.fromisoformat(s)

    def remaining_seconds(self) -> float:
        local_now    = datetime.now(timezone.utc)
        adjusted_now = local_now + __import__('datetime').timedelta(seconds=self.offset)
        return (self.end_time - adjusted_now).total_seconds()

    def is_expired(self) -> bool:
        return self.remaining_seconds() <= 0

    def format_remaining(self) -> str:
        secs = max(0, int(self.remaining_seconds()))
        m, s = divmod(secs, 60)
        return f"{m:02d}:{s:02d}"


# ── Main Agent ────────────────────────────────────────────────

class CartAgent:

    def __init__(self):
        self.loan_data       = None
        self.device_id       = None
        self.screen          = None
        self._running        = True
        self._unlocked       = False
        self._frozen         = False
        self._lesson_data    = None   # שיעור פעיל נוכחי
        self._lesson_timer   = None   # LessonTimer
        self._rt_loan        = None   # Realtime: השאלה
        self._rt_lesson      = None   # Realtime: שיעור
        self._teacher_bypass = False  # האם נכנס מורה?

    def start(self):
        log.info(f"Agent v4 started. asset_tag={ASSET_TAG}")
        self.device_id = db.get_device_id_by_asset_tag(ASSET_TAG)
        self._refresh_loan_state("startup")

        threading.Thread(target=self._heartbeat_loop,     daemon=True).start()
        threading.Thread(target=self._wifi_loop,          daemon=True).start()
        threading.Thread(target=self._idle_loop,          daemon=True).start()
        threading.Thread(target=self._lesson_timer_loop,  daemon=True).start()

        self.screen = LockScreen(on_unlock=self._on_unlock, config=CONFIG)
        self.screen.set_verify_callback(self._verify_step1_id)
        self.screen.set_lesson_verify_callback(self._verify_step2_lesson)
        self.screen.set_loan_info(self.loan_data)
        self.screen.run()

    # ── Step 1: אימות ת.ז. ───────────────────────────────────

    def _verify_step1_id(self, entered: str):
        log.info(f"Step1 ID: {entered[:3]}***")

        # קוד אדמין
        if ADMIN_CODE and entered == ADMIN_CODE:
            log.info("Admin code – bypassing lesson")
            self._teacher_bypass = True
            self._do_unlock("מנהל מערכת")
            return

        # ת.ז. מורה
        teacher = db.is_teacher(entered)
        if teacher:
            log.info(f"Teacher login: {teacher['name']}")
            self._teacher_bypass = True
            if self.device_id:
                db.log_event(self.device_id, self.loan_data["loan_id"] if self.loan_data else None,
                             "teacher_login", {"name": teacher["name"]})
            self._do_unlock(teacher["name"])
            return

        self._teacher_bypass = False

        # אין השאלה
        if not self.loan_data:
            self.screen.show_status("פנה לתחנת העגלה לפני השימוש.", "#f59e0b")
            return

        # בדיקת strikes
        strikes = self.loan_data.get("charge_strikes", 0)
        if strikes >= MAX_STRIKES:
            self.screen.show_status(
                f"⛔ חשבונך חסום ({strikes} עבירות אי-טעינה). פנה למנהל.", "#ef4444")
            return

        if strikes == 2:
            self.screen.show_status("⚠️ אזהרה אחרונה: לא חיברת מחשב לטעינה פעמיים!", "#f59e0b")
        elif strikes == 1:
            self.screen.show_status("⚠️ שים לב: לא חיברת מחשב לטעינה בפעם הקודמת.", "#fbbf24")

        # ת.ז. תלמיד תקינה – עבור לשלב 2
        if entered != self.loan_data["national_id"]:
            name = self.loan_data["student_name"]
            self.screen.show_status(f"שגיאה: מחשב זה שייך ל-{name}.", "#ef4444")
            if self.device_id:
                db.log_event(self.device_id, self.loan_data["loan_id"],
                             "auth_failed", {"prefix": entered[:3]})
            return

        # ת.ז. נכונה → שלב 2: קוד שיעור
        self.screen.show_lesson_code_prompt()

    # ── Step 2: אימות קוד שיעור ──────────────────────────────

    def _verify_step2_lesson(self, code: str):
        log.info(f"Lesson code entered: {code}")

        lesson = db.get_active_lesson_by_code(code)
        if not lesson:
            self.screen.show_status("קוד שיעור שגוי. נסה שוב.", "#ef4444")
            return

        if lesson.get("is_locked"):
            self.screen.show_status("השיעור נעול כעת. המתן למורה.", "#f59e0b")
            return

        # הצטרף לשיעור
        self._lesson_data = lesson
        joined = db.join_lesson(
            lesson["lesson_id"],
            self.loan_data["loan_id"],
            self.loan_data["device_id"],
            self.loan_data["student_id"],
        )
        if joined:
            log.info(f"Joined lesson {lesson['lesson_id']}")
            # הגדר טיימר – offset: אנחנו יודעים כמה דקות נשאר
            mins = lesson.get("minutes_remaining", 0)
            from datetime import timedelta
            pseudo_end = datetime.now(timezone.utc) + timedelta(minutes=mins)
            self._lesson_timer = LessonTimer(
                pseudo_end.isoformat(),
                server_now_str=None
            )
            # Realtime לשיעור
            self._start_lesson_realtime(lesson["lesson_id"])
            db.log_digital_login(self.loan_data["loan_id"], self.loan_data["device_id"])
            self._do_unlock(self.loan_data["student_name"])
        else:
            self.screen.show_status("שגיאה בהצטרפות לשיעור. נסה שוב.", "#ef4444")

    # ── Unlock ────────────────────────────────────────────────

    def _do_unlock(self, name: str):
        self._unlocked = True
        self.screen.unlock(name)

    def _on_unlock(self):
        log.info("Device unlocked.")

    # ── Realtime ──────────────────────────────────────────────

    def _start_lesson_realtime(self, lesson_id: str):
        if self._rt_lesson: self._rt_lesson.stop()
        self._rt_lesson = db.RealtimeSubscription(
            table="lessons",
            record_filter=f"id=eq.{lesson_id}",
            on_change=self._on_lesson_changed,
            channel_name=f"lesson-{lesson_id}",
        )
        self._rt_lesson.start()

    def _on_lesson_changed(self, record: dict):
        status    = record.get("status", "active")
        is_locked = record.get("is_locked", False)
        log.info(f"Lesson event: status={status} locked={is_locked}")

        if status in ("ended", "cancelled"):
            self._lock_lesson_ended()
        elif is_locked and self._unlocked:
            self._lock_teacher_pause()
        elif not is_locked and not self._unlocked and not self._teacher_bypass:
            # מורה שחרר – אפשר להתחבר מחדש ללא קוד שיעור
            if self.screen:
                self.screen.relock("המורה שחרר את המסכים. המתן...")

    def _lock_lesson_ended(self):
        log.info("Lesson ended → locking")
        self._unlocked    = False
        self._lesson_data = None
        self._lesson_timer = None
        if self._rt_lesson: self._rt_lesson.stop(); self._rt_lesson = None
        if self.screen:
            self.screen.show_lesson_ended()
            self.screen.relock("השיעור הסתיים. החזר את המחשב לתחנת העגלה. 🔌")

    def _lock_teacher_pause(self):
        log.info("Teacher locked screens")
        self._unlocked = False
        if self.screen:
            self.screen.relock("המורה הפסיק את השיעור זמנית. המתן.")

    # ── Lesson Timer Loop ─────────────────────────────────────

    def _lesson_timer_loop(self):
        warned = False
        while self._running:
            time.sleep(1)
            if not self._lesson_timer or not self._unlocked:
                warned = False
                continue
            remaining = self._lesson_timer.remaining_seconds()

            # אזהרת 5 דקות
            if 0 < remaining <= 300 and not warned:
                warned = True
                mins = int(remaining // 60) + 1
                if self.screen:
                    self.screen.show_status(
                        f"⏰ השיעור מסתיים בעוד {mins} דקות! שמור את עבודתך.", "#f59e0b")

            # עדכון טיימר בממשק
            if self.screen:
                self.screen.update_lesson_timer(self._lesson_timer.format_remaining())

            # נעילה
            if self._lesson_timer.is_expired():
                log.info("Lesson timer expired – locking")
                self._lock_lesson_ended()
                warned = False

    # ── Loan refresh ──────────────────────────────────────────

    def _refresh_loan_state(self, reason=""):
        log.info(f"Refresh loan [{reason}]")
        new_loan     = db.get_active_loan(ASSET_TAG)
        old_loan_id  = self.loan_data["loan_id"] if self.loan_data else None
        new_loan_id  = new_loan["loan_id"]        if new_loan  else None

        if old_loan_id != new_loan_id:
            log.info(f"Loan changed: {old_loan_id} → {new_loan_id}")
            self.loan_data   = new_loan
            self._unlocked   = False
            self._lesson_data = None
            self._lesson_timer = None
            if self.screen:
                self.screen.set_loan_info(self.loan_data)
                self.screen.relock("מחשב זה זמין לשימוש חדש.")

    # ── Battery check on wake ─────────────────────────────────

    def _check_charging_after_wake(self):
        """משווה סוללה לפני/אחרי שינה ומחליט אם לרשום strike"""
        if not self.device_id: return

        saved   = db.get_last_battery(self.device_id)
        current, charging = get_battery_info()
        if saved is None or current is None: return

        saved_level   = saved.get("last_battery_level")
        recorded_str  = saved.get("last_battery_recorded")
        if saved_level is None or recorded_str is None: return

        # בדוק שהשינה הייתה לפחות 3 שעות
        try:
            recorded = datetime.fromisoformat(recorded_str.replace("Z", "+00:00"))
            sleep_hours = (datetime.now(timezone.utc) - recorded).total_seconds() / 3600
        except: return

        if sleep_hours < 3:
            log.info(f"Sleep too short ({sleep_hours:.1f}h) – skip charge check")
            return

        delta = current - saved_level
        log.info(f"Battery: before={saved_level}% after={current}% delta={delta:+d}% sleep={sleep_hours:.1f}h")

        # מי החזיר אחרון את המחשב?
        if delta >= 10:
            # הוטען ✅ – אפס strikes לתלמיד ששב
            if self.loan_data:
                db.reset_charge_strikes(self.loan_data["student_id"],
                                        self.loan_data["device_id"],
                                        self.loan_data["loan_id"])
                log.info("Charge reset for student")
        else:
            # לא הוטען ❌ – מצא את מי שהחזיר אחרון
            self._attribute_strike_to_last_returner()

    def _attribute_strike_to_last_returner(self):
        """מוצא את התלמיד שהחזיר אחרון ומוסיף לו strike"""
        if not self.device_id: return
        rows = db._get("device_loans", {
            "device_id": f"eq.{self.device_id}",
            "status":    "eq.returned",
            "select":    "id,student_id",
            "order":     "checkin_at.desc",
            "limit":     "1",
        })
        if not rows: return
        loan = rows[0]
        count = db.add_charge_strike(loan["student_id"], self.device_id, loan["id"])
        log.info(f"Strike added to student {loan['student_id']}: now {count} strikes")

    # ── Idle / Sleep ──────────────────────────────────────────

    def _idle_loop(self):
        last_check = time.time()
        while self._running:
            time.sleep(5)
            try:
                now     = time.time()
                elapsed = now - last_check

                if elapsed > WAKE_GAP_SEC:
                    log.info(f"Wake detected (gap={elapsed:.0f}s)")
                    self._frozen = False
                    if self.screen: self.screen.unfreeze()
                    self._check_charging_after_wake()
                    self._refresh_loan_state(f"wake {elapsed:.0f}s")

                last_check = now

                if get_idle_seconds() >= IDLE_TIMEOUT and not self._frozen:
                    log.info("Idle → sleep")
                    self._frozen = True
                    level, _ = get_battery_info()
                    if level and self.device_id:
                        db.save_battery_before_sleep(self.device_id, level)
                    if self.screen: self.screen.freeze()
                    if self._rt_lesson: self._rt_lesson.stop(); self._rt_lesson = None
                    send_to_sleep()

            except Exception as e:
                log.error(f"Idle loop: {e}")

    # ── Heartbeat ─────────────────────────────────────────────

    def _heartbeat_loop(self):
        while self._running:
            if self.device_id and not self._frozen:
                try:
                    level, charging = get_battery_info()
                    db.heartbeat(self.device_id, battery_level=level, is_charging=charging)
                except Exception as e:
                    log.error(f"Heartbeat: {e}")
            time.sleep(HB_INTERVAL)

    # ── Wi-Fi ─────────────────────────────────────────────────

    def _wifi_loop(self):
        last = None
        while self._running:
            try:
                connected = is_connected()
                if connected != last:
                    last = connected
                    log.info(f"Wi-Fi: {'on' if connected else 'off'}")
                if self.screen:
                    self.screen.update_wifi_status(connected)
            except Exception as e:
                log.error(f"Wi-Fi: {e}")
            time.sleep(10)


if __name__ == "__main__":
    try: CartAgent().start()
    except Exception as e:
        log.critical(f"Crash: {e}", exc_info=True); sys.exit(1)
