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
        ("dwExtraInfo", ctypes.c_size_t)
    ]

# Keyboard hook globals
_keyboard_hook = None
_callback_ptr = None

# Interception Driver structures, variables & globals
class InterceptionKeyStroke(ctypes.Structure):
    _fields_ = [
        ('code', ctypes.c_ushort),
        ('state', ctypes.c_ushort),
        ('information', ctypes.c_uint)
    ]

class InterceptionMouseStroke(ctypes.Structure):
    _fields_ = [
        ('state', ctypes.c_ushort),
        ('flags', ctypes.c_ushort),
        ('rolling', ctypes.c_short),
        ('x', ctypes.c_int),
        ('y', ctypes.c_int),
        ('information', ctypes.c_uint)
    ]

class InterceptionStroke(ctypes.Union):
    _fields_ = [
        ('mouse', InterceptionMouseStroke),
        ('key', InterceptionKeyStroke)
    ]

_interception_dll = None
_interception_context = None
_interception_thread = None
_interception_running = False

# Scan Code Set 1 Whitelist for CartAgent input:
# - Escape: 0x01
# - Backspace: 0x0E
# - Enter: 0x1C
# - Left/Right Shift: 0x2A, 0x36
# - Digits 0-9: 0x02 to 0x0B
# - Letters A-Z: 0x10-0x19, 0x1E-0x26, 0x2C-0x32
# - Numpad Digits: 0x4F, 0x50, 0x51, 0x4B, 0x4C, 0x4D, 0x47, 0x48, 0x49, 0x52
ALLOWED_SCAN_CODES = {
    0x01, 0x0E, 0x1C, 0x2A, 0x36,
    0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B,
    0x4F, 0x50, 0x51, 0x4B, 0x4C, 0x4D, 0x47, 0x48, 0x49, 0x52,
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19,
    0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26,
    0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x32
}

def load_interception():
    global _interception_dll
    if _interception_dll is not None:
        return _interception_dll
    
    import os, sys
    paths = []
    if getattr(sys, 'frozen', False):
        paths.append(os.path.join(sys._MEIPASS, "interception.dll"))
    paths.extend([
        "interception.dll",
        r"C:\Program Files\CartAgent\interception.dll",
        r"C:\Program Files\Veyon\interception.dll",
        r"C:\Program Files\Veyon\3rdparty\interception\interception.dll"
    ])
    
    for path in paths:
        if os.path.exists(path):
            try:
                dll = ctypes.CDLL(path)
                
                # Configure API Signatures
                dll.interception_create_context.restype = ctypes.c_void_p
                dll.interception_destroy_context.argtypes = [ctypes.c_void_p]
                dll.interception_destroy_context.restype = None
                
                dll.interception_set_filter.argtypes = [
                    ctypes.c_void_p,
                    ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_int),
                    ctypes.c_ushort
                ]
                dll.interception_set_filter.restype = None
                
                dll.interception_wait.argtypes = [ctypes.c_void_p]
                dll.interception_wait.restype = ctypes.c_int
                
                dll.interception_receive.argtypes = [
                    ctypes.c_void_p,
                    ctypes.c_int,
                    ctypes.POINTER(InterceptionStroke),
                    ctypes.c_uint
                ]
                dll.interception_receive.restype = ctypes.c_int
                
                dll.interception_send.argtypes = [
                    ctypes.c_void_p,
                    ctypes.c_int,
                    ctypes.POINTER(InterceptionStroke),
                    ctypes.c_uint
                ]
                dll.interception_send.restype = ctypes.c_int
                
                _interception_dll = dll
                return dll
            except Exception as e:
                pass
    return None

def _interception_thread_proc():
    global _interception_context, _interception_running
    try:
        dll = _interception_dll
        context = _interception_context
        
        is_keyboard_proto = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_int)
        is_keyboard_func = is_keyboard_proto(dll.interception_is_keyboard)
        
        dll.interception_set_filter(context, is_keyboard_func, 0xFFFF)
        stroke = InterceptionStroke()
        
        while _interception_running:
            device = dll.interception_wait(context)
            if not _interception_running:
                break
            if device <= 0:
                continue
            
            res = dll.interception_receive(context, device, ctypes.byref(stroke), 1)
            if res > 0:
                scan_code = stroke.key.code
                if scan_code in ALLOWED_SCAN_CODES:
                    dll.interception_send(context, device, ctypes.byref(stroke), 1)
                else:
                    # BLOCK key by ignoring it and not sending it to the OS
                    pass
    except Exception:
        pass

def _low_level_keyboard_proc(nCode, wParam, lParam):
    if nCode >= 0:
        try:
            kbd_struct = KBDLLHOOKSTRUCT.from_address(lParam)
            vkCode = kbd_struct.vkCode
            
            # Whitelist of allowed keys to unlock the PC:
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
        except Exception:
            pass
            
    return user32.CallNextHookEx(None, nCode, wParam, lParam)

# Keep reference to callback with proper 64-bit types
HOOKPROC = ctypes.WINFUNCTYPE(wintypes.LPARAM, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)

# Set Win32 argtypes/restype for full type safety on 64-bit systems
user32.SetWindowsHookExW.argtypes = [ctypes.c_int, HOOKPROC, wintypes.HINSTANCE, wintypes.DWORD]
user32.SetWindowsHookExW.restype = wintypes.HHOOK

user32.CallNextHookEx.argtypes = [wintypes.HHOOK, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
user32.CallNextHookEx.restype = wintypes.LPARAM

def install_keyboard_hook():
    global _keyboard_hook, _callback_ptr
    global _interception_context, _interception_thread, _interception_running
    
    # 1. Attempt kernel-level blocking via Veyon's Interception driver first
    dll = load_interception()
    if dll is not None:
        try:
            context = dll.interception_create_context()
            if context:
                _interception_context = context
                _interception_running = True
                import threading
                _interception_thread = threading.Thread(target=_interception_thread_proc, daemon=True)
                _interception_thread.start()
                return
        except Exception:
            pass
            
    # 2. Fall back to standard type-safe low-level hook if driver is not active/installed
    if _keyboard_hook is not None:
        return
    _callback_ptr = HOOKPROC(_low_level_keyboard_proc)
    _keyboard_hook = user32.SetWindowsHookExW(WH_KEYBOARD_LL, _callback_ptr, None, 0)

def uninstall_keyboard_hook():
    global _keyboard_hook, _callback_ptr
    global _interception_context, _interception_thread, _interception_running
    
    # 1. Stop Interception driver context
    if _interception_context:
        try:
            _interception_running = False
            _interception_dll.interception_destroy_context(_interception_context)
        except Exception:
            pass
        _interception_context = None
        _interception_thread = None
        
    # 2. Stop fallback hook
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



def start_explorer():
    try:
        res = subprocess.run(["tasklist", "/fi", "IMAGENAME eq explorer.exe"], capture_output=True, text=True)
        if "explorer.exe" not in res.stdout:
            subprocess.Popen("explorer.exe", shell=True)
    except Exception:
        try:
            subprocess.Popen("explorer.exe", shell=True)
        except Exception:
            pass

BG = "#0a0f1e"; BG_CARD = "#131929"; BG_INPUT = "#1e2840"
ACCENT = "#3b82f6"; ACCENT_DARK = "#1d4ed8"
SUCCESS = "#22c55e"; ERROR = "#ef4444"; WARNING = "#f59e0b"
TEXT_MAIN = "#f1f5f9"; TEXT_DIM = "#94a3b8"; TEXT_NUM = "#60a5fa"
BORDER = "#2d3f5e"

# ── Win32 System Tray Icon Constants & Functions ──────────────
NIM_ADD = 0x00000000
NIM_DELETE = 0x00000002
NIF_ICON = 0x00000002
NIF_TIP = 0x00000004
IDI_SHIELD = 32518

class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("hWnd", wintypes.HWND),
        ("uID", wintypes.UINT),
        ("uFlags", wintypes.UINT),
        ("uCallbackMessage", wintypes.UINT),
        ("hIcon", wintypes.HICON),
        ("szTip", ctypes.c_wchar * 128),
        ("dwState", wintypes.DWORD),
        ("dwStateMask", wintypes.DWORD),
        ("szInfo", ctypes.c_wchar * 256),
        ("uTimeoutOrVersion", wintypes.UINT),
        ("szInfoTitle", ctypes.c_wchar * 64),
        ("dwInfoFlags", wintypes.DWORD),
    ]

_tray_nid = None

def show_tray_icon(hwnd=None):
    global _tray_nid
    try:
        shell32 = ctypes.windll.shell32
        user32 = ctypes.windll.user32
        
        user32.LoadIconW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR]
        user32.LoadIconW.restype = wintypes.HICON
        
        h_icon = user32.LoadIconW(None, ctypes.cast(IDI_SHIELD, wintypes.LPCWSTR))
        if not h_icon:
            h_icon = user32.LoadIconW(None, ctypes.cast(32512, wintypes.LPCWSTR))
            
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = hwnd
        nid.uID = 1
        nid.uFlags = NIF_ICON | NIF_TIP
        nid.hIcon = h_icon
        nid.szTip = "CartAgent - Security System Running"
        
        shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid))
        _tray_nid = nid
    except Exception as e:
        print(f"Error adding tray icon: {e}")

def remove_tray_icon():
    global _tray_nid
    if _tray_nid:
        try:
            shell32 = ctypes.windll.shell32
            shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(_tray_nid))
            _tray_nid = None
        except Exception:
            pass


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
        show_tray_icon(r.winfo_id())
        self._check_uninstall_loop()
        self._check_watchdog_loop()

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
        self.pad_frame = tk.Frame(parent, bg=BG_CARD)
        self.pad_frame.pack()
        for row in [["7","8","9"],["4","5","6"],["1","2","3"],["⌫","0",""]]:
            rf = tk.Frame(self.pad_frame, bg=BG_CARD)
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
        if event.char.isalnum():
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
        start_explorer()
        if self.on_unlock:
            self.on_unlock()

    def relock(self, message: str = "המחשב ננעל מחדש"):
        """נועל חזרה – נקרא כשהשאלה נסגרת מרחוק"""
        self._unlocked = False
        self.entered_id = ""
        def _do():
            install_keyboard_hook()
            set_task_manager_enabled(False)
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
        def _do():
            self._update_clock()
            self.root.focus_force()
        self.root.after(0, _do)

    def run(self):
        self.root.mainloop()

    def destroy(self):
        remove_tray_icon()
        uninstall_keyboard_hook()
        set_task_manager_enabled(True)
        start_explorer()
        try:
            self.root.destroy()
        except Exception:
            pass

    def _check_uninstall_loop(self):
        import os, sys
        lock_file = r"C:\Program Files\CartAgent\uninstalling.lock"
        if os.path.exists(lock_file):
            self.destroy()
            sys.exit(0)
        self.root.after(500, self._check_uninstall_loop)

    def _check_watchdog_loop(self):
        import os, subprocess
        lock_file = r"C:\Program Files\CartAgent\uninstalling.lock"
        if os.path.exists(lock_file):
            return
        try:
            r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq cart_watchdog.exe"], capture_output=True, text=True)
            if "cart_watchdog.exe" not in r.stdout:
                watchdog_path = r"C:\Program Files\CartAgent\cart_watchdog.exe"
                if os.path.exists(watchdog_path):
                    subprocess.Popen([watchdog_path])
        except Exception:
            pass
        self.root.after(3000, self._check_watchdog_loop)

    def show_lesson_selection(self, lessons: list, on_select):
        """מציג מסך בחירת שיעור מתוך רשימה לתלמיד ששויך למספר שיעורים במקביל"""
        self._step = 3  # שלב בחירה
        def _do():
            # hide numpad, display, and submit button
            self.lbl_display.master.pack_forget()
            if hasattr(self, 'pad_frame'):
                self.pad_frame.pack_forget()
            self.btn_submit.pack_forget()
            
            self.lbl_title.config(text="בחר את השיעור שלך", fg=ACCENT)
            self.lbl_subtitle.config(text="שויכת למספר שיעורים פעילים במקביל. בחר אחד:")
            self.lbl_status.config(text="")
            
            # create selection container
            self.select_frame = tk.Frame(self.lbl_title.master, bg=BG_CARD)
            self.select_frame.pack(fill="x", pady=20)
            
            # Add a button for each lesson
            for lesson in lessons:
                lbl = f"📚 {lesson.get('subject', 'שיעור')} ({lesson.get('teacher_name', 'מורה')})"
                btn = tk.Button(
                    self.select_frame, text=lbl, font=self.font_sub,
                    bg=BG_INPUT, fg=TEXT_MAIN, activebackground="#2a3550",
                    activeforeground=TEXT_NUM, bd=1, relief="solid", highlightthickness=0,
                    padx=15, pady=12, cursor="hand2", anchor="w",
                    command=lambda l=lesson: [self.clear_selection_screen(), on_select(l)]
                )
                btn.pack(fill="x", pady=6)
                
            # Add a cancel button to go back to T.Z. input
            btn_cancel = tk.Button(
                self.select_frame, text="❌ ביטול וחזרה", font=self.font_small,
                bg="rgba(239,68,68,0.15)", fg="#fca5a5", activebackground="#3d2121",
                bd=0, padx=15, pady=8, cursor="hand2",
                command=self.cancel_lesson_selection
            )
            btn_cancel.pack(fill="x", pady=(20, 0))
            
        self.root.after(0, _do)

    def clear_selection_screen(self):
        if hasattr(self, 'select_frame') and self.select_frame:
            try:
                self.select_frame.destroy()
            except Exception:
                pass
            self.select_frame = None

    def cancel_lesson_selection(self):
        self.clear_selection_screen()
        self._step = 1
        self.entered_id = ""
        
        # restore widgets
        self.lbl_display.master.pack(fill="x", pady=(0, 24))
        if hasattr(self, 'pad_frame'):
            self.pad_frame.pack()
        self.btn_submit.pack(fill="x", pady=(12, 0))
        
        self.lbl_title.config(text="הקש את תעודת הזהות שלך", fg=TEXT_MAIN)
        self.lbl_subtitle.config(text=f"המחשב הוצא על שם: {self.loan_data.get('student_name', '')} | כיתה {self.loan_data.get('class_name', '')}" if self.loan_data else "")
        self.lbl_display.config(text="")
        self.show_status("")
