"""
lockscreen.py - v3
מסך נעילה עם two-step login (ת.ז. + קוד שיעור), טיימר שיעור, Wi-Fi, FreezeMode.
"""

import tkinter as tk
from tkinter import font as tkfont
import subprocess
import os
from datetime import datetime
import ctypes
from ctypes import wintypes
import winreg

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

# Win32 Constants for Low-Level Keyboard Hook
WH_KEYBOARD_LL = 13
VK_TAB = 0x09
VK_ESCAPE = 0x1B
VK_LWIN = 0x5B
VK_RWIN = 0x5C
VK_CONTROL = 0x11
VK_SHIFT = 0x10

class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(wintypes.ULONG))
    ]

_keyboard_hook = None
_callback_ptr = None

def _low_level_keyboard_proc(nCode, wParam, lParam):
    if nCode >= 0:
        vkCode = lParam.contents.vkCode
        
        # Whitelist of allowed keys to unlock the PC:
        # - Backspace: 0x08
        # - Enter: 0x0D
        # - Escape: 0x1B
        # - Shift: 0x10, LSHIFT: 0xA0, RSHIFT: 0xA1
        # - Digits 0-9: 0x30 to 0x39
        # - Letters A-Z (English/Hebrew keyboard keys): 0x41 to 0x5A
        # - Numpad digits 0-9: 0x60 to 0x69
        
        is_allowed = (
            vkCode == 0x08 or
            vkCode == 0x0D or
            vkCode == 0x1B or
            vkCode in (0x10, 0xA0, 0xA1) or
            (0x30 <= vkCode <= 0x39) or
            (0x41 <= vkCode <= 0x5A) or
            (0x60 <= vkCode <= 0x69)
        )
        
        if not is_allowed:
            return 1 # BLOCK all other keys (Alt, Win, Ctrl, Fn, F1-F12, etc.)
            
    return user32.CallNextHookEx(None, nCode, wParam, lParam)

# Keep reference to callback
HOOKPROC = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_int, wintypes.WPARAM, ctypes.POINTER(KBDLLHOOKSTRUCT))

def install_keyboard_hook():
    global _keyboard_hook, _callback_ptr
    if _keyboard_hook is not None:
        return
    _callback_ptr = HOOKPROC(_low_level_keyboard_proc)
    h_mod = kernel32.GetModuleHandleW(None)
    _keyboard_hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, _callback_ptr, h_mod, 0)

def uninstall_keyboard_hook():
    global _keyboard_hook, _callback_ptr
    if _keyboard_hook is not None:
        user32.UnhookWindowsHookEx(_keyboard_hook)
        _keyboard_hook = None
        _callback_ptr = None

def set_task_manager_enabled(enabled: bool):
    try:
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Policies\System")
        winreg.SetValueEx(key, "DisableTaskMgr", 0, winreg.REG_DWORD, 0 if enabled else 1)
        winreg.CloseKey(key)
    except Exception:
        pass

BG = "#0a0f1e"; BG_CARD = "#131929"; BG_INPUT = "#1e2840"
ACCENT = "#3b82f6"; ACCENT_DARK = "#1d4ed8"
SUCCESS = "#22c55e"; ERROR = "#ef4444"; WARNING = "#f59e0b"
TEXT_MAIN = "#f1f5f9"; TEXT_DIM = "#94a3b8"; TEXT_NUM = "#60a5fa"
BORDER = "#2d3f5e"


class LockScreen:
    def __init__(self, on_unlock, config: dict):
        self.on_unlock = on_unlock
        self.config = config
        self.loan_data  = None
        self.entered_id = ""
        self._unlocked  = False
        self._frozen    = False
        self._step      = 1        # 1=ת.ז.  2=קוד שיעור
        self._verify         = lambda x: None
        self._verify_lesson  = lambda x: None

        self.root = tk.Tk()
        self._setup_window()
        self._build_ui()
        self._start_clock()

    # ── Window setup ──────────────────────────────────────────

    def _setup_window(self):
        r = self.root
        r.title("מסך נעילה")
        r.configure(bg=BG)
        r.attributes("-fullscreen", True)
        r.attributes("-topmost", True)
        r.resizable(False, False)
        r.overrideredirect(True)
        r.bind("<Alt-F4>", lambda e: "break")
        r.bind("<Alt-Tab>", lambda e: "break")
        r.protocol("WM_DELETE_WINDOW", lambda: None)
        r.focus_force()
        install_keyboard_hook()
        set_task_manager_enabled(False)

    # ── UI Build ──────────────────────────────────────────────

    def _build_ui(self):
        self.font_title   = tkfont.Font(family="Segoe UI", size=28, weight="bold")
        self.font_sub     = tkfont.Font(family="Segoe UI", size=14)
        self.font_device  = tkfont.Font(family="Segoe UI", size=13)
        self.font_clock   = tkfont.Font(family="Segoe UI", size=36, weight="bold")
        self.font_date    = tkfont.Font(family="Segoe UI", size=13)
        self.font_label   = tkfont.Font(family="Segoe UI", size=15)
        self.font_display = tkfont.Font(family="Segoe UI", size=32, weight="bold")
        self.font_btn     = tkfont.Font(family="Segoe UI", size=20, weight="bold")
        self.font_small   = tkfont.Font(family="Segoe UI", size=11)

        main = tk.Frame(self.root, bg=BG)
        main.place(relx=0, rely=0, relwidth=1, relheight=1)
        self._build_left_panel(main)
        self._build_right_panel(main)

    def _build_left_panel(self, parent):
        left = tk.Frame(parent, bg=BG, width=700)
        left.pack(side=tk.LEFT, fill=tk.Y, padx=(80, 0))
        left.pack_propagate(False)

        tk.Frame(left, bg=BG, height=120).pack()

        tk.Label(left, text="🏫 " + self.config.get("school_name", "בית הספר"),
                 font=self.font_title, bg=BG, fg=TEXT_MAIN).pack(anchor="w")

        tk.Label(left, text=f"מחשב {self.config.get('asset_tag','')}  |  {self.config.get('cart_name','')}",
                 font=self.font_device, bg=BG, fg=TEXT_DIM).pack(anchor="w", pady=(8, 0))

        tk.Frame(left, bg=BORDER, height=1).pack(fill="x", pady=40)

        self.lbl_clock = tk.Label(left, text="", font=self.font_clock, bg=BG, fg=ACCENT)
        self.lbl_clock.pack(anchor="w")

        self.lbl_date = tk.Label(left, text="", font=self.font_date, bg=BG, fg=TEXT_DIM)
        self.lbl_date.pack(anchor="w", pady=(4, 0))

        # טיימר שיעור
        self.lbl_timer = tk.Label(left, text="", font=self.font_clock, bg=BG, fg=WARNING)
        self.lbl_timer.pack(anchor="w", pady=(12, 0))

        self.lbl_timer_label = tk.Label(left, text="", font=self.font_small, bg=BG, fg=TEXT_DIM)
        self.lbl_timer_label.pack(anchor="w")

        # ── Wi-Fi Section ──────────────────────────────────────
        tk.Frame(left, bg=BORDER, height=1).pack(fill="x", pady=(30, 20))

        wifi_row = tk.Frame(left, bg=BG)
        wifi_row.pack(anchor="w")

        self.wifi_dot = tk.Label(wifi_row, text="●", font=self.font_sub, bg=BG, fg=ERROR)
        self.wifi_dot.pack(side=tk.LEFT)

        self.wifi_label = tk.Label(wifi_row, text="בודק חיבור...",
                                   font=self.font_small, bg=BG, fg=TEXT_DIM)
        self.wifi_label.pack(side=tk.LEFT, padx=(8, 16))

        self.wifi_btn = tk.Button(
            wifi_row, text="📶  בחר רשת Wi-Fi", font=self.font_small,
            bg=BG_INPUT, fg=TEXT_DIM, activebackground="#2a3550",
            activeforeground=TEXT_MAIN, bd=0, padx=12, pady=6,
            cursor="hand2", relief="flat", command=self._open_wifi_panel,
        )
        self.wifi_btn.pack(side=tk.LEFT)

        tk.Frame(left, bg=BG).pack(expand=True)

        tk.Label(left, text="מערכת ניהול השאלת מחשבים",
                 font=self.font_small, bg=BG, fg=TEXT_DIM).pack(anchor="w", pady=(0, 40))

    def _build_right_panel(self, parent):
        right = tk.Frame(parent, bg=BG_CARD)
        right.pack(side=tk.RIGHT, fill=tk.Y)

        inner = tk.Frame(right, bg=BG_CARD)
        inner.pack(expand=True, padx=60, pady=60)

        self.lbl_title = tk.Label(inner, text="הקש את תעודת הזהות שלך",
                                   font=self.font_label, bg=BG_CARD, fg=TEXT_MAIN,
                                   wraplength=380, justify="center")
        self.lbl_title.pack(pady=(0, 8))

        self.lbl_subtitle = tk.Label(inner, text="", font=self.font_sub,
                                      bg=BG_CARD, fg=TEXT_DIM,
                                      wraplength=380, justify="center")
        self.lbl_subtitle.pack(pady=(0, 24))

        disp_frame = tk.Frame(inner, bg=BG_INPUT, padx=20, pady=18)
        disp_frame.pack(fill="x", pady=(0, 24))

        self.lbl_display = tk.Label(disp_frame, text="", font=self.font_display,
                                     bg=BG_INPUT, fg=TEXT_NUM, anchor="center")
        self.lbl_display.pack(fill="x")

        self._build_numpad(inner)

        self.btn_submit = tk.Button(
            inner, text="✔  אישור", font=self.font_btn,
            bg=ACCENT, fg="white", activebackground=ACCENT_DARK,
            bd=0, padx=20, pady=14, cursor="hand2", command=self._on_submit,
        )
        self.btn_submit.pack(fill="x", pady=(12, 0))

        self.lbl_status = tk.Label(inner, text="", font=self.font_sub,
                                    bg=BG_CARD, fg=TEXT_DIM,
                                    wraplength=380, justify="center")
        self.lbl_status.pack(pady=(16, 0))

        self.root.bind("<Key>", self._on_key)
        self.root.bind("<Return>", lambda e: self._on_submit())
        self.root.bind("<BackSpace>", lambda e: self._on_backspace())
        self.root.bind("<Escape>", lambda e: self._on_back())

    def _build_numpad(self, parent):
        pad = tk.Frame(parent, bg=BG_CARD)
        pad.pack()
        for row in [["7","8","9"],["4","5","6"],["1","2","3"],["⌫","0",""]]:
            rf = tk.Frame(pad, bg=BG_CARD)
            rf.pack()
            for ch in row:
                if ch == "":
                    tk.Frame(rf, bg=BG_CARD, width=90, height=70).pack(
                        side=tk.LEFT, padx=5, pady=5)
                elif ch == "⌫":
                    tk.Button(rf, text=ch, font=self.font_btn,
                              bg=BG_INPUT, fg=WARNING, bd=0, width=3, height=1,
                              cursor="hand2", command=self._on_backspace,
                              activebackground="#2a3550", activeforeground=WARNING,
                    ).pack(side=tk.LEFT, padx=5, pady=5, ipadx=12, ipady=12)
                else:
                    tk.Button(rf, text=ch, font=self.font_btn,
                              bg=BG_INPUT, fg=TEXT_MAIN, bd=0, width=3, height=1,
                              cursor="hand2", command=lambda c=ch: self._on_digit(c),
                              activebackground="#2a3550", activeforeground=TEXT_NUM,
                    ).pack(side=tk.LEFT, padx=5, pady=5, ipadx=12, ipady=12)

    # ── Clock ─────────────────────────────────────────────────

    def _start_clock(self):
        self._update_clock()

    def _update_clock(self):
        if self._frozen:
            return
        now = datetime.now()
        self.lbl_clock.config(text=now.strftime("%H:%M:%S"))
        days = ["שני","שלישי","רביעי","חמישי","שישי","שבת","ראשון"]
        self.lbl_date.config(text=f"יום {days[now.weekday()]}, {now.strftime('%d/%m/%Y')}")
        self.root.after(1000, self._update_clock)

    # ── Numpad logic ──────────────────────────────────────────

    def _on_digit(self, ch):
        max_len = 4 if self._step == 2 else 9
        if len(self.entered_id) < max_len:
            self.entered_id += ch
            display = self.entered_id if self._step == 2 else "●" * len(self.entered_id)
            self.lbl_display.config(text=display)

    def _on_backspace(self):
        self.entered_id = self.entered_id[:-1]
        display = self.entered_id if self._step == 2 else "●" * len(self.entered_id)
        self.lbl_display.config(text=display)

    def _on_key(self, event):
        if event.char.isdigit():
            self._on_digit(event.char)

    def _on_submit(self):
        if not self.entered_id:
            return
        val = self.entered_id
        self.entered_id = ""
        self.lbl_display.config(text="")
        if self._step == 1:
            self._verify(val)
        else:
            self._verify_lesson(val)

    def _on_back(self):
        """ESC בשלב 2 – חזרה לשלב 1"""
        if self._step == 2:
            self._step = 1
            self.entered_id = ""
            self.lbl_display.config(text="")
            self.lbl_title.config(text="הקש את תעודת הזהות שלך", fg=TEXT_MAIN)
            self.lbl_subtitle.config(text=self.loan_data.get('student_name','') if self.loan_data else "")
            self.show_status("")

    # ── Wi-Fi ─────────────────────────────────────────────────

    def update_wifi_status(self, connected: bool, label: str = None):
        """נקרא מ-Thread חיצוני לעדכון אינדיקטור ה-Wi-Fi"""
        color = SUCCESS if connected else ERROR
        text  = label or ("מחובר לאינטרנט ✓" if connected else "אין חיבור לאינטרנט")
        self.root.after(0, lambda: [
            self.wifi_dot.config(fg=color),
            self.wifi_label.config(text=text, fg=color if connected else TEXT_DIM),
        ])

    def _open_wifi_panel(self):
        """פותח את תפריט בחירת הרשתות של Windows"""
        # מוריד topmost זמנית כדי שתפריט Windows יופיע מעל
        self.root.attributes("-topmost", False)
        try:
            os.system("start ms-availablenetworks:")
        except Exception:
            subprocess.Popen(["explorer.exe", "ms-availablenetworks:"])
        # מחזיר topmost אחרי 10 שניות
        self.root.after(10000, lambda: self.root.attributes("-topmost", True))

    # ── Public API ────────────────────────────────────────────

    def set_verify_callback(self, cb):
        self._verify = cb

    def set_lesson_verify_callback(self, cb):
        self._verify_lesson = cb

    def set_loan_info(self, loan_data: dict | None):
        self.loan_data = loan_data
        self.root.after(0, self._apply_loan_state)

    def _apply_loan_state(self):
        if self.loan_data:
            name  = self.loan_data.get("student_name", "")
            klass = self.loan_data.get("class_name", "")
            self.lbl_title.config(text="הקש את תעודת הזהות שלך", fg=TEXT_MAIN)
            self.lbl_subtitle.config(text=f"המחשב הוצא על שם: {name} | כיתה {klass}")
            self.btn_submit.config(state="normal")
        else:
            self.lbl_title.config(text="מחשב זה אינו רשום להשאלה", fg=WARNING)
            self.lbl_subtitle.config(text="פנה לתחנת העגלה כדי לרשום את ההשאלה תחילה.")
            self.btn_submit.config(state="disabled")

    def show_status(self, msg: str, color: str = TEXT_DIM):
        self.root.after(0, lambda: self.lbl_status.config(text=msg, fg=color))

    def show_lesson_code_prompt(self):
        """מעבר לשלב 2 – הכנסת קוד שיעור"""
        self._step = 2
        self.entered_id = ""
        def _do():
            self.lbl_display.config(text="")
            self.lbl_title.config(text="הכנס קוד שיעור (4 ספרות)", fg=ACCENT)
            self.lbl_subtitle.config(text="קבל את הקוד מהמורה שלך")
            self.lbl_status.config(text="")
        self.root.after(0, _do)

    def show_lesson_ended(self):
        """מציג הודעת סיום שיעור"""
        self._step = 1
        def _do():
            self.lbl_title.config(text="⏰ השיעור הסתיים", fg=WARNING)
            self.lbl_subtitle.config(text="החזר את המחשב לתחנת העגלה וחבר לחשמל. 🔌")
        self.root.after(0, _do)

    def update_lesson_timer(self, time_str: str):
        """עדכון טיימר השיעור (מ-thread חיצוני)"""
        def _do():
            if time_str:
                self.lbl_timer.config(text=time_str)
                self.lbl_timer_label.config(text="נשאר בשיעור")
            else:
                self.lbl_timer.config(text="")
                self.lbl_timer_label.config(text="")
        self.root.after(0, _do)

    def unlock(self, student_name: str):
        self._unlocked = True
        self.show_status(f"ברוך הבא, {student_name}! 🎉", SUCCESS)
        self.root.after(2000, self._do_unlock)

    def _do_unlock(self):
        uninstall_keyboard_hook()
        set_task_manager_enabled(True)
        self.root.attributes("-topmost", False)
        self.root.withdraw()
        if self.on_unlock:
            self.on_unlock()

    def relock(self, message: str = "המחשב ננעל מחדש"):
        """נועל חזרה – נקרא כשהשאלה נסגרת מרחוק"""
        self._unlocked = False
        self.entered_id = ""
        install_keyboard_hook()
        set_task_manager_enabled(False)
        def _do():
            self.lbl_display.config(text="")
            self.root.deiconify()
            self.root.attributes("-topmost", True)
            self.root.focus_force()
            self.lbl_status.config(text=message, fg=WARNING)
        self.root.after(0, _do)

    # ── Freeze / Unfreeze ─────────────────────────────────────

    def freeze(self):
        """עצור עדכוני UI לחיסכון במשאבים (מצב Idle)"""
        self._frozen = True

    def unfreeze(self):
        """חדש עדכוני UI לאחר התעוררות"""
        self._frozen = False
        self._update_clock()
        self.root.after(0, self.root.focus_force)

    def run(self):
        self.root.mainloop()

    def destroy(self):
        uninstall_keyboard_hook()
        set_task_manager_enabled(True)
        try:
            self.root.destroy()
        except Exception:
            pass
