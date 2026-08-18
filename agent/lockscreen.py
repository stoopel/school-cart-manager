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
import threading
import time

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
_interception_filter_active = True
_wifi_panel_active = False

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

import atexit
import _ctypes

def free_interception_dll():
    global _interception_dll, _interception_context, _interception_running
    if _interception_dll is not None:
        try:
            if _interception_context:
                _interception_running = False
                try:
                    _interception_dll.interception_set_filter(_interception_context, None, 0)
                except Exception:
                    pass
                try:
                    _interception_dll.interception_destroy_context(_interception_context)
                except Exception:
                    pass
                _interception_context = None
            
            _ctypes.FreeLibrary(_interception_dll._handle)
        except Exception:
            pass
        _interception_dll = None

atexit.register(free_interception_dll)

def load_interception():
    global _interception_dll
    if _interception_dll is not None:
        return _interception_dll
    
    import os, sys
    # Priority paths: Permanent system folders first to avoid locking temp dir
    paths = [
        r"C:\Program Files\CartAgent\interception.dll",
        r"C:\Program Files\Veyon\interception.dll",
        r"C:\Program Files\Veyon\3rdparty\interception\interception.dll"
    ]
    if getattr(sys, 'frozen', False):
        paths.append(os.path.join(sys._MEIPASS, "interception.dll"))
    paths.append("interception.dll")
    
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
    global _interception_context, _interception_running, _wifi_panel_active
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
                if not _interception_filter_active:
                    # UNLOCKED: Pass 100% of keys directly to Windows without filtering
                    dll.interception_send(context, device, ctypes.byref(stroke), 1)
                    continue

                scan_code = stroke.key.code
                base_code = scan_code & 0x7F
                if _wifi_panel_active:
                    # Allow all except system keys: Alt (0x38), Ctrl (0x1D), Win (0x5B/0x5C), Tab (0x0F), Apps (0x5D), F1-F12 (0x3B-0x44, 0x57, 0x58)
                    is_system = (
                        base_code in (0x38, 0x1D, 0x5B, 0x5C, 0x0F, 0x5D) or
                        (0x3B <= base_code <= 0x44) or
                        base_code in (0x57, 0x58)
                    )
                    if not is_system:
                        dll.interception_send(context, device, ctypes.byref(stroke), 1)
                else:
                    if base_code in ALLOWED_SCAN_CODES:
                        dll.interception_send(context, device, ctypes.byref(stroke), 1)
                    else:
                        # BLOCK key by ignoring it and not sending it to the OS
                        pass
    except Exception:
        pass

def _low_level_keyboard_proc(nCode, wParam, lParam):
    global _wifi_panel_active
    if nCode >= 0:
        try:
            kbd_struct = KBDLLHOOKSTRUCT.from_address(lParam)
            vkCode = kbd_struct.vkCode
            
            if _wifi_panel_active:
                # Block only system shortcuts: Win (0x5B/0x5C), Alt (0x12), Ctrl (0x11/0xA2/0xA3), Tab (0x09), Apps (0x5D), F1-F12 (0x70-0x7B)
                is_system = (
                    vkCode in (0x5B, 0x5C, 0x12, 0x11, 0xA2, 0xA3, 0x09, 0x5D) or
                    (0x70 <= vkCode <= 0x7B)
                )
                if is_system:
                    return 1  # BLOCK
            else:
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
    global _interception_context, _interception_thread, _interception_running, _interception_filter_active
    
    _interception_filter_active = True
    
    # 1. Attempt kernel-level blocking via Interception driver first
    if _interception_context is not None:
        return  # Driver context already initialized & active
        
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
    global _interception_filter_active
    
    # 1. Disable Interception filtering (pass 100% of keys directly to Windows)
    _interception_filter_active = False
        
    # 2. Stop fallback Win32 hook
    if _keyboard_hook is not None:
        user32.UnhookWindowsHookEx(_keyboard_hook)
        _keyboard_hook = None
        _callback_ptr = None

def set_task_manager_enabled(enabled: bool = True):
    """מבטיח שה-Registry נקי ואין חסימות מנהל משימות שישארו ב-Windows"""
    try:
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Policies\System")
        try:
            winreg.DeleteValue(key, "DisableTaskMgr")
        except FileNotFoundError:
            pass
        winreg.CloseKey(key)
    except Exception:
        pass



def start_explorer():
    try:
        res = subprocess.run(["tasklist", "/fi", "IMAGENAME eq explorer.exe"], capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
        if "explorer.exe" not in res.stdout:
            subprocess.Popen("explorer.exe", shell=True, creationflags=subprocess.CREATE_NO_WINDOW)
    except Exception:
        try:
            subprocess.Popen("explorer.exe", shell=True, creationflags=subprocess.CREATE_NO_WINDOW)
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


class LessonWidget(tk.Toplevel):
    def __init__(self, parent_root, subject, teacher_name, end_time_str, on_disconnect, student_name="", class_name=""):
        super().__init__(parent_root)
        self.parent_root = parent_root
        self.subject = subject
        self.teacher_name = teacher_name
        self.student_name = student_name
        self.class_name = class_name
        self.on_disconnect = on_disconnect
        
        self.title("Lesson Widget")
        self.overrideredirect(True)
        self.attributes("-alpha", 0.75)
        self.attributes("-topmost", True)
        self.configure(bg=BG_CARD)
        
        # Don't show in taskbar
        self.wm_attributes("-toolwindow", True)
        
        # Dimensions & position
        self.width = 280
        self.height = 80
        screen_width = self.winfo_screenwidth()
        screen_height = self.winfo_screenheight()
        
        # Place initially at bottom-right (above standard taskbar height)
        self.x = screen_width - self.width - 25
        self.y = screen_height - self.height - 60
        self.geometry(f"{self.width}x{self.height}+{self.x}+{self.y}")
        
        # Outer border frame
        self.border_frame = tk.Frame(self, bg=BORDER, bd=1)
        self.border_frame.pack(fill="both", expand=True)
        
        self.main_frame = tk.Frame(self.border_frame, bg=BG_CARD)
        self.main_frame.pack(fill="both", expand=True, padx=1, pady=1)
        
        left_box = tk.Frame(self.main_frame, bg=BG_CARD)
        left_box.pack(side=tk.LEFT, fill="y", padx=10)
        
        # Small disconnect button in Hebrew: "התנתק"
        self.btn_disconnect = tk.Button(
            left_box, text="התנתק", font=tkfont.Font(family="Segoe UI", size=10, weight="bold"),
            bg=ERROR, fg="white", activebackground="#dc2626", activeforeground="white",
            bd=0, padx=8, pady=4, cursor="hand2", command=self._confirm_disconnect,
            relief="flat"
        )
        self.btn_disconnect.pack(expand=True)
        
        # Info container
        right_box = tk.Frame(self.main_frame, bg=BG_CARD)
        right_box.pack(side=tk.RIGHT, fill="both", expand=True, padx=(0, 12), pady=6)
        
        font_student = tkfont.Font(family="Segoe UI", size=9, weight="bold")
        font_sub = tkfont.Font(family="Segoe UI", size=10, weight="bold")
        font_timer = tkfont.Font(family="Segoe UI", size=8)
        
        student_txt = f"תלמיד: {self.student_name}" if self.student_name else ""
        if self.class_name:
            student_txt += f" | כיתה {self.class_name}" if not student_txt else f" ({self.class_name})"
            
        if student_txt:
            self.lbl_student = tk.Label(
                right_box, text=student_txt,
                font=font_student, bg=BG_CARD, fg=TEXT_NUM, anchor="e", justify="right"
            )
            self.lbl_student.pack(fill="x", anchor="e")
        else:
            self.lbl_student = None
        
        teacher_txt = f" | {self.teacher_name}" if self.teacher_name else ""
        self.lbl_info = tk.Label(
            right_box, text=f"{self.subject}{teacher_txt}",
            font=font_sub, bg=BG_CARD, fg=TEXT_MAIN, anchor="e", justify="right"
        )
        self.lbl_info.pack(fill="x", anchor="e")
        
        self.lbl_timer = tk.Label(
            right_box, text="מחשב את הזמן...",
            font=font_timer, bg=BG_CARD, fg=TEXT_DIM, anchor="e", justify="right"
        )
        self.lbl_timer.pack(fill="x", anchor="e")
        
        # Draggable bindings (using absolute mouse coordinates to prevent jitter)
        bind_widgets = [self, self.border_frame, self.main_frame, left_box, right_box, self.lbl_info, self.lbl_timer]
        if self.lbl_student:
            bind_widgets.append(self.lbl_student)
            
        for w in bind_widgets:
            w.bind("<Button-1>", self.start_drag)
            w.bind("<B1-Motion>", self.drag)
            
    def start_drag(self, event):
        self.drag_x = event.x_root - self.winfo_x()
        self.drag_y = event.y_root - self.winfo_y()
        
    def drag(self, event):
        x = event.x_root - self.drag_x
        y = event.y_root - self.drag_y
        self.geometry(f"+{x}+{y}")

    def _confirm_disconnect(self):
        confirm_win = tk.Toplevel(self)
        confirm_win.title("התנתקות מהשיעור")
        confirm_win.overrideredirect(True)
        confirm_win.attributes("-topmost", True)
        confirm_win.configure(bg=BG_CARD)
        
        w = 300
        h = 135
        # Center relative to parent widget
        x = self.winfo_x() - (w - self.width) // 2
        y = self.winfo_y() - h - 10
        if x < 0: x = 10
        if y < 0: y = self.winfo_y() + self.height + 10
        confirm_win.geometry(f"{w}x{h}+{x}+{y}")
        
        border = tk.Frame(confirm_win, bg=BORDER, bd=1)
        border.pack(fill="both", expand=True)
        
        main = tk.Frame(border, bg=BG_CARD, padx=15, pady=12)
        main.pack(fill="both", expand=True, padx=1, pady=1)
        
        font_bold = tkfont.Font(family="Segoe UI", size=11, weight="bold")
        font_regular = tkfont.Font(family="Segoe UI", size=10)
        
        tk.Label(
            main, text="האם אתה בטוח שברצונך להתנתק?",
            font=font_bold, bg=BG_CARD, fg=TEXT_MAIN, justify="center"
        ).pack(fill="x", pady=(0, 6))
        
        tk.Label(
            main, text="התנתקות תנעל את המחשב ותסיר אותך מהשיעור.",
            font=font_regular, bg=BG_CARD, fg=TEXT_DIM, justify="center"
        ).pack(fill="x", pady=(0, 15))
        
        btn_row = tk.Frame(main, bg=BG_CARD)
        btn_row.pack(fill="x")
        
        def do_yes():
            confirm_win.destroy()
            if self.on_disconnect:
                self.on_disconnect()
                
        def do_no():
            confirm_win.destroy()
            
        btn_yes = tk.Button(
            btn_row, text="כן, התנתק", font=font_regular,
            bg=ERROR, fg="white", activebackground="#dc2626", activeforeground="white",
            bd=0, padx=12, pady=5, cursor="hand2", command=do_yes
        )
        btn_yes.pack(side=tk.LEFT, fill="x", expand=True, padx=(0, 5))
        
        btn_no = tk.Button(
            btn_row, text="ביטול", font=font_regular,
            bg=BG_INPUT, fg=TEXT_MAIN, activebackground="#2a3550", activeforeground=TEXT_MAIN,
            bd=0, padx=12, pady=5, cursor="hand2", command=do_no
        )
        btn_no.pack(side=tk.RIGHT, fill="x", expand=True, padx=(5, 0))

    def update_timer(self, remaining_seconds):
        if remaining_seconds is None or remaining_seconds < 0:
            self.lbl_timer.config(text="")
            return
            
        if remaining_seconds > 180:
            mins = int((remaining_seconds + 59) // 60)
            self.lbl_timer.config(text=f"עוד {mins} דקות")
        else:
            m = int(remaining_seconds // 60)
            s = int(remaining_seconds % 60)
            self.lbl_timer.config(text=f"עוד {m}:{s:02d} דקות")


class TeacherWidget(tk.Toplevel):
    """
    חלון צף מתקדם וקומפקטי למורה (שלט שליטה כיתתי).
    מאפשר הצגת פרטי שיעור פעיל, מספר תלמידים מחוברים, הקפאה/הפשרה, הארכת זמן ונעילה.
    """
    def __init__(self, parent_root, teacher_name: str, teacher_id: str, on_lock):
        super().__init__(parent_root)
        self.parent_root = parent_root
        self.teacher_name = teacher_name
        self.teacher_id = teacher_id
        self.on_lock = on_lock
        
        self._running = True
        self._active_lessons = []
        self._selected_index = 0
        
        self.title("Teacher Classroom Control")
        self.overrideredirect(True)
        self.attributes("-alpha", 0.90)
        self.attributes("-topmost", True)
        self.configure(bg=BG_CARD)
        self.wm_attributes("-toolwindow", True)
        
        self.width = 330
        self.height = 145
        screen_width = self.winfo_screenwidth()
        screen_height = self.winfo_screenheight()
        
        self.x = screen_width - self.width - 25
        self.y = screen_height - self.height - 60
        self.geometry(f"{self.width}x{self.height}+{self.x}+{self.y}")
        
        # Outer border frame
        self.border_frame = tk.Frame(self, bg=ACCENT, bd=1)
        self.border_frame.pack(fill="both", expand=True)
        
        self.main_frame = tk.Frame(self.border_frame, bg=BG_CARD)
        self.main_frame.pack(fill="both", expand=True, padx=1, pady=1)
        
        # Header Row: Teacher Name + Lock PC button
        self.header_row = tk.Frame(self.main_frame, bg=BG_CARD)
        self.header_row.pack(fill="x", padx=10, pady=(6, 2))
        
        self.btn_lock_pc = tk.Button(
            self.header_row, text="🔒 נעל מחשב", font=tkfont.Font(family="Segoe UI", size=8, weight="bold"),
            bg=ERROR, fg="white", activebackground="#dc2626", activeforeground="white",
            bd=0, padx=6, pady=2, cursor="hand2", relief="flat", command=self._confirm_lock
        )
        self.btn_lock_pc.pack(side=tk.LEFT)
        
        self.lbl_teacher_title = tk.Label(
            self.header_row, text=f"👨‍🏫 מורה: {self.teacher_name}",
            font=tkfont.Font(family="Segoe UI", size=10, weight="bold"),
            bg=BG_CARD, fg=TEXT_MAIN, anchor="e", justify="right"
        )
        self.lbl_teacher_title.pack(side=tk.RIGHT, fill="x", expand=True)
        
        # Divider
        self.div = tk.Frame(self.main_frame, bg=BORDER, height=1)
        self.div.pack(fill="x", padx=8, pady=3)
        
        # Content Container (Active lesson info or idle status)
        self.content_frame = tk.Frame(self.main_frame, bg=BG_CARD)
        self.content_frame.pack(fill="both", expand=True, padx=10, pady=2)
        
        self.lbl_lesson_info = tk.Label(
            self.content_frame, text="טוען נתוני שיעור... ⏳",
            font=tkfont.Font(family="Segoe UI", size=9, weight="bold"),
            bg=BG_CARD, fg=TEXT_NUM, anchor="e", justify="right"
        )
        self.lbl_lesson_info.pack(fill="x")
        
        self.lbl_students_count = tk.Label(
            self.content_frame, text="",
            font=tkfont.Font(family="Segoe UI", size=8),
            bg=BG_CARD, fg=TEXT_DIM, anchor="e", justify="right"
        )
        self.lbl_students_count.pack(fill="x")
        
        # Controls Row
        self.ctrl_row = tk.Frame(self.main_frame, bg=BG_CARD)
        self.ctrl_row.pack(fill="x", padx=8, pady=(4, 8))
        
        self.btn_freeze = tk.Button(
            self.ctrl_row, text="⏸️ הקפא מסכים", font=tkfont.Font(family="Segoe UI", size=8, weight="bold"),
            bg="#3b82f6", fg="white", activebackground="#2563eb", activeforeground="white",
            bd=0, padx=6, pady=3, cursor="hand2", relief="flat", command=self._toggle_freeze
        )
        self.btn_freeze.pack(side=tk.RIGHT, padx=2)
        
        self.btn_extend = tk.Button(
            self.ctrl_row, text="⏱️ +15 דק'", font=tkfont.Font(family="Segoe UI", size=8),
            bg=BG_INPUT, fg=TEXT_MAIN, activebackground="#2a3550", activeforeground=TEXT_MAIN,
            bd=0, padx=6, pady=3, cursor="hand2", relief="flat", command=self._extend_lesson
        )
        self.btn_extend.pack(side=tk.RIGHT, padx=2)
        
        self.btn_end = tk.Button(
            self.ctrl_row, text="⏹️ סיים שיעור", font=tkfont.Font(family="Segoe UI", size=8),
            bg=BG_INPUT, fg="#f87171", activebackground="#2a3550", activeforeground="#f87171",
            bd=0, padx=6, pady=3, cursor="hand2", relief="flat", command=self._confirm_end_lesson
        )
        self.btn_end.pack(side=tk.RIGHT, padx=2)
        
        # Draggable bindings
        bind_widgets = [self, self.border_frame, self.main_frame, self.header_row, self.lbl_teacher_title, self.content_frame, self.lbl_lesson_info, self.lbl_students_count, self.ctrl_row]
        for w in bind_widgets:
            w.bind("<Button-1>", self.start_drag)
            w.bind("<B1-Motion>", self.drag)
            
        # Start background polling
        threading.Thread(target=self._poll_loop, daemon=True).start()
        
    def start_drag(self, event):
        self.drag_x = event.x_root - self.winfo_x()
        self.drag_y = event.y_root - self.winfo_y()
        
    def drag(self, event):
        x = event.x_root - self.drag_x
        y = event.y_root - self.drag_y
        self.geometry(f"+{x}+{y}")
        
    def _poll_loop(self):
        import supabase_client as db
        while self._running:
            try:
                lessons = db.get_teacher_active_lessons(self.teacher_id) if self.teacher_id else []
                self._active_lessons = lessons
                self.parent_root.after(0, self._render_lessons)
            except Exception:
                pass
            time.sleep(10)
            
    def _render_lessons(self):
        if not self.winfo_exists(): return
        if not self._active_lessons:
            self.lbl_lesson_info.config(text="⚪ אין שיעור פעיל כרגע", fg=TEXT_DIM)
            self.lbl_students_count.config(text="🟢 חיבור מורה פעיל (ללא הגבלת זמן)", fg=SUCCESS)
            self.btn_freeze.pack_forget()
            self.btn_extend.pack_forget()
            self.btn_end.pack_forget()
            return
            
        if self._selected_index >= len(self._active_lessons):
            self._selected_index = 0
            
        lesson = self._active_lessons[self._selected_index]
        code = lesson.get("lesson_code", "")
        subject = lesson.get("subject", "שיעור")
        parts = lesson.get("lesson_participants", [])
        part_count = len(parts) if isinstance(parts, list) else 0
        is_locked = lesson.get("is_locked", False)
        
        self.lbl_lesson_info.config(text=f"📚 {subject} | קוד: [{code}]", fg=TEXT_NUM)
        self.lbl_students_count.config(text=f"👥 {part_count} תלמידים מחוברים 💻", fg=TEXT_MAIN)
        
        if is_locked:
            self.btn_freeze.config(text="▶️ שחרר מסכים", bg=SUCCESS, activebackground="#16a34a")
        else:
            self.btn_freeze.config(text="⏸️ הקפא מסכים", bg="#3b82f6", activebackground="#2563eb")
            
        self.btn_freeze.pack(side=tk.RIGHT, padx=2)
        self.btn_extend.pack(side=tk.RIGHT, padx=2)
        self.btn_end.pack(side=tk.RIGHT, padx=2)
        
    def _toggle_freeze(self):
        if not self._active_lessons: return
        lesson = self._active_lessons[self._selected_index]
        cur_locked = lesson.get("is_locked", False)
        new_locked = not cur_locked
        import supabase_client as db
        def _bg():
            db.update_teacher_lesson_status(lesson["id"], is_locked=new_locked)
            lesson["is_locked"] = new_locked
            self.parent_root.after(0, self._render_lessons)
        threading.Thread(target=_bg, daemon=True).start()
        
    def _extend_lesson(self):
        if not self._active_lessons: return
        lesson = self._active_lessons[self._selected_index]
        cur_mins = lesson.get("duration_minutes", 45)
        new_mins = cur_mins + 15
        import supabase_client as db
        def _bg():
            db.update_teacher_lesson_status(lesson["id"], duration_minutes=new_mins)
            lesson["duration_minutes"] = new_mins
            self.parent_root.after(0, self._render_lessons)
        threading.Thread(target=_bg, daemon=True).start()
        
    def _confirm_end_lesson(self):
        if not self._active_lessons: return
        lesson = self._active_lessons[self._selected_index]
        import supabase_client as db
        def _bg():
            db.update_teacher_lesson_status(lesson["id"], status="ended")
            self._active_lessons = [l for l in self._active_lessons if l["id"] != lesson["id"]]
            self.parent_root.after(0, self._render_lessons)
        threading.Thread(target=_bg, daemon=True).start()
        
    def _confirm_lock(self):
        self._running = False
        if self.on_lock:
            self.on_lock()
        self.destroy()

    def destroy(self):
        self._running = False
        super().destroy()


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
        self._wifi_panel_active = False
        self._wifi_timer_id = None
        self._verifying = False
        self.lesson_widget = None
        self.teacher_widget = None
        self._on_disconnect_clicked = None

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

        tk.Label(left, text="🏫 " + self.config.get("school_name", "ישיבת אמית כפר גנים"),
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

        self.shutdown_btn = tk.Button(
            wifi_row, text="🔌  כיבוי מחשב", font=self.font_small,
            bg=BG_INPUT, fg=ERROR, activebackground="#dc2626",
            activeforeground="white", bd=0, padx=12, pady=6,
            cursor="hand2", relief="flat", command=self._confirm_shutdown,
        )
        self.shutdown_btn.pack(side=tk.LEFT, padx=(12, 0))

        tk.Frame(left, bg=BG).pack(expand=True)

        tk.Label(left, text="מערכת ניהול השאלת מחשבים",
                 font=self.font_small, bg=BG, fg=TEXT_DIM).pack(anchor="w", pady=(0, 40))

    def _build_right_panel(self, parent):
        right = tk.Frame(parent, bg=BG_CARD)
        right.pack(side=tk.RIGHT, fill=tk.Y)

        inner = tk.Frame(right, bg=BG_CARD)
        inner.pack(expand=True, padx=40, pady=15)

        self.lbl_title = tk.Label(inner, text="הקש את תעודת הזהות שלך",
                                   font=self.font_label, bg=BG_CARD, fg=TEXT_MAIN,
                                   wraplength=380, justify="center")
        self.lbl_title.pack(pady=(0, 4))

        self.lbl_subtitle = tk.Label(inner, text="", font=self.font_sub,
                                      bg=BG_CARD, fg=TEXT_DIM,
                                      wraplength=380, justify="center")
        self.lbl_subtitle.pack(pady=(0, 12))

        disp_frame = tk.Frame(inner, bg=BG_INPUT, padx=15, pady=8)
        disp_frame.pack(fill="x", pady=(0, 12))

        self.lbl_display = tk.Label(disp_frame, text="", font=self.font_display,
                                     bg=BG_INPUT, fg=TEXT_NUM, anchor="center")
        self.lbl_display.pack(fill="x")

        self._build_numpad(inner)

        self.btn_submit = tk.Button(
            inner, text="✔  אישור", font=self.font_btn,
            bg=ACCENT, fg="white", activebackground=ACCENT_DARK,
            bd=0, padx=20, pady=8, cursor="hand2", command=self._on_submit,
        )
        self.btn_submit.pack(fill="x", pady=(10, 0))

        self.lbl_status = tk.Label(inner, text="", font=self.font_sub,
                                    bg=BG_CARD, fg=TEXT_DIM,
                                    wraplength=380, justify="center")
        self.lbl_status.pack(pady=(8, 0))

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
                    tk.Frame(rf, bg=BG_CARD, width=72, height=52).pack(
                        side=tk.LEFT, padx=5, pady=3)
                elif ch == "⌫":
                    tk.Button(rf, text=ch, font=self.font_btn,
                              bg=BG_INPUT, fg=WARNING, bd=0, width=3, height=1,
                              cursor="hand2", command=self._on_backspace,
                              activebackground="#2a3550", activeforeground=WARNING,
                    ).pack(side=tk.LEFT, padx=5, pady=3, ipadx=8, ipady=6)
                else:
                    tk.Button(rf, text=ch, font=self.font_btn,
                              bg=BG_INPUT, fg=TEXT_MAIN, bd=0, width=3, height=1,
                              cursor="hand2", command=lambda c=ch: self._on_digit(c),
                              activebackground="#2a3550", activeforeground=TEXT_NUM,
                    ).pack(side=tk.LEFT, padx=5, pady=3, ipadx=8, ipady=6)

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
        if getattr(self, "_wifi_panel_active", False) or getattr(self, "_verifying", False):
            return
        max_len = 4 if self._step == 2 else 9
        if len(self.entered_id) < max_len:
            self.entered_id += ch
            display = self.entered_id if self._step == 2 else "●" * len(self.entered_id)
            self.lbl_display.config(text=display)

    def _on_backspace(self):
        if getattr(self, "_wifi_panel_active", False) or getattr(self, "_verifying", False):
            return
        self.entered_id = self.entered_id[:-1]
        display = self.entered_id if self._step == 2 else "●" * len(self.entered_id)
        self.lbl_display.config(text=display)

    def _on_key(self, event):
        if getattr(self, "_wifi_panel_active", False) or getattr(self, "_verifying", False):
            return
        if event.char.isalnum():
            self._on_digit(event.char)

    def _on_submit(self):
        if getattr(self, "_wifi_panel_active", False) or getattr(self, "_verifying", False):
            return
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
        if getattr(self, "_wifi_panel_active", False) or getattr(self, "_verifying", False):
            return
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
        
        def _do():
            self.wifi_dot.config(fg=color)
            self.wifi_label.config(text=text, fg=color if connected else TEXT_DIM)
                
        self.root.after(0, _do)

    def _confirm_shutdown(self):
        """פופאפ אישור לפני כיבוי המחשב"""
        confirm_win = tk.Toplevel(self.root)
        confirm_win.title("כיבוי המחשב")
        confirm_win.overrideredirect(True)
        confirm_win.attributes("-topmost", True)
        confirm_win.configure(bg=BG_CARD)
        
        w = 320
        h = 145
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        x = (screen_width - w) // 2
        y = (screen_height - h) // 2
        confirm_win.geometry(f"{w}x{h}+{x}+{y}")
        
        border = tk.Frame(confirm_win, bg=BORDER, bd=1)
        border.pack(fill="both", expand=True)
        
        main = tk.Frame(border, bg=BG_CARD, padx=20, pady=16)
        main.pack(fill="both", expand=True, padx=1, pady=1)
        
        font_bold = tkfont.Font(family="Segoe UI", size=11, weight="bold")
        font_regular = tkfont.Font(family="Segoe UI", size=10)
        
        tk.Label(
            main, text="🔌 כיבוי המחשב",
            font=font_bold, bg=BG_CARD, fg=TEXT_MAIN, justify="center"
        ).pack(fill="x", pady=(0, 6))
        
        tk.Label(
            main, text="האם אתה בטוח שברצונך לכבות את המחשב?",
            font=font_regular, bg=BG_CARD, fg=TEXT_DIM, justify="center"
        ).pack(fill="x", pady=(0, 16))
        
        btn_row = tk.Frame(main, bg=BG_CARD)
        btn_row.pack(fill="x")
        
        def do_shutdown():
            confirm_win.destroy()
            try:
                subprocess.run(["shutdown", "/s", "/f", "/t", "0"], creationflags=subprocess.CREATE_NO_WINDOW)
            except Exception:
                import os
                os.system("shutdown /s /f /t 0")
                
        def do_cancel():
            confirm_win.destroy()
            
        btn_yes = tk.Button(
            btn_row, text="כן, כבה עכשיו", font=font_regular,
            bg=ERROR, fg="white", activebackground="#dc2626", activeforeground="white",
            bd=0, padx=12, pady=5, cursor="hand2", command=do_shutdown
        )
        btn_yes.pack(side=tk.LEFT, fill="x", expand=True, padx=(0, 5))
        
        btn_no = tk.Button(
            btn_row, text="ביטול", font=font_regular,
            bg=BG_INPUT, fg=TEXT_MAIN, activebackground="#2a3550", activeforeground=TEXT_MAIN,
            bd=0, padx=12, pady=5, cursor="hand2", command=do_cancel
        )
        btn_no.pack(side=tk.RIGHT, fill="x", expand=True, padx=(5, 0))

    def _open_wifi_panel(self):
        """פותח או סוגר את ממשק בחירת הרשתות"""
        if getattr(self, '_wifi_panel_active', False):
            self.close_wifi_panel()
            return
            
        self._wifi_panel_active = True
        global _wifi_panel_active
        _wifi_panel_active = True
        self.wifi_btn.config(text="❌  סגור רשימה")
        
        # Hide existing right panel inputs
        self.lbl_display.master.pack_forget()
        if hasattr(self, 'pad_frame'):
            self.pad_frame.pack_forget()
        self.btn_submit.pack_forget()
        self.lbl_status.pack_forget()  # Hide status to prevent pushing panel down
        self.clear_selection_screen()
        
        # Create self.wifi_container in inner
        self.wifi_container = tk.Frame(self.lbl_title.master, bg=BG_CARD)
        self.wifi_container.pack(fill="both", expand=True, pady=10)
        
        # 4. Trigger scan
        self.scan_wifi_async()

    def scan_wifi_async(self):
        def run_scan():
            self.root.after(0, lambda: self.show_wifi_status_msg("סורק רשתות... ⏳"))
            
            try:
                # 1. Check current connection
                connected_ssid = None
                try:
                    res_int = subprocess.run(["netsh", "wlan", "show", "interfaces"], capture_output=True, text=True, errors="ignore", creationflags=subprocess.CREATE_NO_WINDOW)
                    
                    state_connected = False
                    for line in res_int.stdout.splitlines():
                        line = line.strip()
                        if ":" in line:
                            parts = line.split(":", 1)
                            key = parts[0].strip().lower()
                            val = parts[1].strip()
                            if "state" in key or "מצב" in key:
                                if "connected" in val.lower() or "מחובר" in val:
                                    state_connected = True
                            elif key == "ssid":
                                connected_ssid = val
                    
                    if not state_connected:
                        connected_ssid = None
                except Exception as e:
                    pass
                    
                # 2. Scan available networks
                encodings = ["cp862", "utf-8", "cp1255", "ansi"]
                stdout = ""
                for enc in encodings:
                    try:
                        res_net = subprocess.run(["netsh", "wlan", "show", "networks"], capture_output=True, text=True, encoding=enc, errors="ignore", creationflags=subprocess.CREATE_NO_WINDOW)
                        if "SSID" in res_net.stdout or "רשתות" in res_net.stdout or "interfaces" in res_net.stdout:
                            stdout = res_net.stdout
                            break
                    except Exception:
                        pass
                if not stdout:
                    res_net = subprocess.run(["netsh", "wlan", "show", "networks"], capture_output=True, text=True, errors="ignore", creationflags=subprocess.CREATE_NO_WINDOW)
                    stdout = res_net.stdout

                networks = []
                current_net = {}
                
                for line in stdout.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    if line.lower().startswith("ssid "):
                        if current_net and "ssid" in current_net:
                            networks.append(current_net)
                            current_net = {}
                        if ":" in line:
                            parts = line.split(":", 1)
                            ssid_val = parts[1].strip()
                            if ssid_val:
                                current_net = {
                                    "ssid": ssid_val,
                                    "secured": True,
                                    "connected": (ssid_val == connected_ssid)
                                }
                    elif current_net and ":" in line:
                        parts = line.split(":", 1)
                        key = parts[0].strip().lower()
                        val = parts[1].strip()
                        if "authentication" in key or "אימות" in key:
                            is_open = "open" in val.lower() or "פתוח" in val or "none" in val.lower()
                            current_net["secured"] = not is_open
                
                if current_net and "ssid" in current_net:
                    networks.append(current_net)
                
                # Deduplicate SSIDs
                unique_nets = {}
                for net in networks:
                    ssid = net["ssid"]
                    if not ssid:
                        continue
                    if ssid not in unique_nets or net["connected"]:
                        unique_nets[ssid] = net
                networks = list(unique_nets.values())
                
                # Sort: Connected first, then secured, then name
                networks.sort(key=lambda x: (not x["connected"], not x["secured"], x["ssid"].lower()))
                
                self.root.after(0, lambda: self.display_wifi_networks(networks))
            except Exception as e:
                self.root.after(0, lambda: self.show_wifi_status_msg("שגיאה בסריקת רשתות ❌"))
                
        threading.Thread(target=run_scan, daemon=True).start()

    def display_wifi_networks(self, networks):
        if not getattr(self, '_wifi_panel_active', False):
            return
            
        # Clear container
        for child in self.wifi_container.winfo_children():
            child.destroy()
            
        self.lbl_title.config(text="📶 רשתות Wi-Fi זמינות", fg=ACCENT)
        self.lbl_subtitle.config(text="בחר רשת כדי להתחבר:")
        
        # Top button row (pack FIRST at the top to prevent clipping/pushing off)
        btn_row = tk.Frame(self.wifi_container, bg=BG_CARD)
        btn_row.pack(side=tk.TOP, fill="x", pady=(0, 15))

        # Scrollable container
        canvas_frame = tk.Frame(self.wifi_container, bg=BG_CARD)
        canvas_frame.pack(side=tk.TOP, fill="both", expand=True)
        
        canvas = tk.Canvas(canvas_frame, bg=BG_CARD, bd=0, highlightthickness=0, height=160)
        scrollbar = tk.Scrollbar(canvas_frame, orient="vertical", command=canvas.yview)
        scrollable_frame = tk.Frame(canvas, bg=BG_CARD)
        
        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(
                scrollregion=canvas.bbox("all")
            )
        )
        
        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw", width=380)
        canvas.configure(yscrollcommand=scrollbar.set)
        
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        
        # Bind MouseWheel to canvas
        canvas.bind_all("<MouseWheel>", lambda e: canvas.yview_scroll(int(-1*(e.delta/120)), "units"))
        
        if not networks:
            lbl_empty = tk.Label(scrollable_frame, text="לא נמצאו רשתות אלחוטיות זמינות.", font=self.font_sub, bg=BG_CARD, fg=TEXT_DIM, pady=40)
            lbl_empty.pack(fill="x")
        else:
            for net in networks:
                item_frame = tk.Frame(scrollable_frame, bg=BG_INPUT, padx=12, pady=10)
                item_frame.pack(fill="x", pady=4, padx=5)
                
                # Hebrew layout (Right to Left): Right side: Icon + Name
                lbl_icon = tk.Label(item_frame, text="📶", font=self.font_sub, bg=BG_INPUT, fg=TEXT_MAIN)
                lbl_icon.pack(side=tk.RIGHT, padx=(0, 8))
                
                lbl_ssid = tk.Label(item_frame, text=net["ssid"], font=self.font_small, bg=BG_INPUT, fg=TEXT_MAIN, anchor="w")
                lbl_ssid.pack(side=tk.RIGHT, fill="x", expand=True)
                
                # Left side: Action Button + Lock Icon
                if net["connected"]:
                    btn_action = tk.Button(
                        item_frame, text="נתק", font=self.font_small,
                        bg="#ef4444", fg="white", activebackground="#dc2626",
                        bd=0, padx=12, pady=4, cursor="hand2",
                        command=lambda s=net["ssid"]: self.disconnect_wifi_async(s)
                    )
                    btn_action.pack(side=tk.LEFT, padx=(8, 0))
                    
                    lbl_connected = tk.Label(item_frame, text="מחובר ✓", font=self.font_small, bg=BG_INPUT, fg=SUCCESS)
                    lbl_connected.pack(side=tk.LEFT, padx=(8, 0))
                else:
                    btn_action = tk.Button(
                        item_frame, text="התחבר", font=self.font_small,
                        bg=ACCENT, fg="white", activebackground=ACCENT_DARK,
                        bd=0, padx=12, pady=4, cursor="hand2",
                        command=lambda n=net: self.on_network_click(n)
                    )
                    btn_action.pack(side=tk.LEFT, padx=(8, 0))
                    
                    if net["secured"]:
                        lbl_lock = tk.Label(item_frame, text="🔒", font=self.font_small, bg=BG_INPUT, fg=TEXT_DIM)
                        lbl_lock.pack(side=tk.LEFT, padx=(8, 0))
                        
        # Buttons are packed inside the pre-allocated btn_row at the bottom
        
        btn_refresh = tk.Button(
            btn_row, text="🔄 רענן רשימה", font=self.font_small,
            bg=BG_INPUT, fg=TEXT_MAIN, activebackground="#2a3550",
            activeforeground=TEXT_MAIN, bd=0, padx=15, pady=8, cursor="hand2",
            command=self.scan_wifi_async
        )
        btn_refresh.pack(side=tk.RIGHT, fill="x", expand=True, padx=(0, 6))
        
        btn_back = tk.Button(
            btn_row, text="❌ ביטול וחזרה", font=self.font_small,
            bg="rgba(239,68,68,0.15)", fg="#fca5a5", activebackground="#3d2121",
            bd=0, padx=15, pady=8, cursor="hand2",
            command=self.close_wifi_panel
        )
        btn_back.pack(side=tk.LEFT, fill="x", expand=True, padx=(6, 0))

    def on_network_click(self, net):
        if net["secured"]:
            self.show_password_entry(net["ssid"])
        else:
            self.connect_wifi_async(net["ssid"])

    def show_password_entry(self, ssid):
        # Clear container
        for child in self.wifi_container.winfo_children():
            child.destroy()
            
        self.lbl_title.config(text=f"התחברות אל {ssid}", fg=ACCENT)
        self.lbl_subtitle.config(text="הקלד את סיסמת הרשת")
        
        # Password field
        pwd_label = tk.Label(self.wifi_container, text="סיסמת רשת (Wi-Fi Key):", font=self.font_small, bg=BG_CARD, fg=TEXT_DIM, anchor="e")
        pwd_label.pack(fill="x", pady=(10, 2))
        
        pwd_frame = tk.Frame(self.wifi_container, bg=BG_INPUT, padx=10, pady=5)
        pwd_frame.pack(fill="x", pady=(0, 15))
        
        self.pwd_entry = tk.Entry(
            pwd_frame, font=self.font_sub, bg=BG_INPUT, fg=TEXT_MAIN,
            insertbackground=TEXT_MAIN, bd=0, show="●", justify="left"
        )
        self.pwd_entry.pack(fill="x", expand=True)
        self.pwd_entry.focus_set()
        
        # Toggle visibility button
        show_pwd_var = tk.BooleanVar(value=False)
        
        def toggle_pwd():
            if show_pwd_var.get():
                self.pwd_entry.config(show="")
            else:
                self.pwd_entry.config(show="●")
                
        chk_show = tk.Checkbutton(
            self.wifi_container, text="הצג סיסמה", font=self.font_small,
            variable=show_pwd_var, command=toggle_pwd, bg=BG_CARD, fg=TEXT_DIM,
            selectcolor=BG_INPUT, activebackground=BG_CARD, activeforeground=TEXT_MAIN,
            bd=0, highlightthickness=0
        )
        chk_show.pack(anchor="w", pady=(0, 15))
        
        # Action buttons
        btn_row = tk.Frame(self.wifi_container, bg=BG_CARD)
        btn_row.pack(fill="x", pady=(10, 0))
        
        btn_connect = tk.Button(
            btn_row, text="✔ התחבר", font=self.font_sub,
            bg=SUCCESS, fg="white", activebackground="#16a34a",
            bd=0, padx=15, pady=8, cursor="hand2",
            command=lambda: self.connect_wifi_async(ssid, self.pwd_entry.get())
        )
        btn_connect.pack(side=tk.RIGHT, fill="x", expand=True, padx=(0, 6))
        
        btn_cancel = tk.Button(
            btn_row, text="❌ ביטול", font=self.font_sub,
            bg=BG_INPUT, fg=TEXT_MAIN, activebackground="#2a3550",
            bd=0, padx=15, pady=8, cursor="hand2",
            command=self.scan_wifi_async
        )
        btn_cancel.pack(side=tk.LEFT, fill="x", expand=True, padx=(6, 0))
        
        # Binds
        self.pwd_entry.bind("<Return>", lambda e: self.connect_wifi_async(ssid, self.pwd_entry.get()))
        self.pwd_entry.bind("<Escape>", lambda e: self.scan_wifi_async())

    def connect_wifi_async(self, ssid, password=None):
        def run_connect():
            self.root.after(0, lambda: self.show_wifi_status_msg(f"מתחבר אל {ssid}... ⏳"))
            
            try:
                hex_ssid = ssid.encode('utf-8').hex()
                if password:
                    xml_content = f"""<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
	<name>{ssid}</name>
	<SSIDConfig>
		<SSID>
			<hex>{hex_ssid}</hex>
			<name>{ssid}</name>
		</SSID>
	</SSIDConfig>
	<connectionType>ESS</connectionType>
	<connectionMode>manual</connectionMode>
	<MSM>
		<security>
			<authEncryption>
				<authentication>WPA2PSK</authentication>
				<encryption>AES</encryption>
				<useOneX>false</useOneX>
			</authEncryption>
			<sharedKey>
				<keyType>passPhrase</keyType>
				<protected>false</protected>
				<keyMaterial>{password}</keyMaterial>
			</sharedKey>
		</security>
	</MSM>
</WLANProfile>
"""
                else:
                    xml_content = f"""<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
	<name>{ssid}</name>
	<SSIDConfig>
		<SSID>
			<hex>{hex_ssid}</hex>
			<name>{ssid}</name>
		</SSID>
	</SSIDConfig>
	<connectionType>ESS</connectionType>
	<connectionMode>manual</connectionMode>
	<MSM>
		<security>
			<authEncryption>
				<authentication>open</authentication>
				<encryption>none</encryption>
				<useOneX>false</useOneX>
			</authEncryption>
		</security>
	</MSM>
</WLANProfile>
"""
                
                temp_dir = os.environ.get("TEMP", "C:\\Windows\\Temp")
                if not os.path.exists(temp_dir):
                    temp_dir = "C:\\"
                temp_file = os.path.join(temp_dir, f"temp_wifi_{hex_ssid}.xml")
                
                with open(temp_file, "w", encoding="utf-8") as f:
                    f.write(xml_content)
                    
                try:
                    subprocess.run(["netsh", "wlan", "add", "profile", f"filename={temp_file}"], capture_output=True, text=True, errors="ignore", creationflags=subprocess.CREATE_NO_WINDOW)
                finally:
                    try:
                        os.remove(temp_file)
                    except Exception:
                        pass
                
                subprocess.run(["netsh", "wlan", "connect", f"name={ssid}"], capture_output=True, text=True, errors="ignore", creationflags=subprocess.CREATE_NO_WINDOW)
                
                # Poll connection status for 10 seconds
                success = False
                for _ in range(10):
                    time.sleep(1)
                    res_int = subprocess.run(["netsh", "wlan", "show", "interfaces"], capture_output=True, text=True, errors="ignore", creationflags=subprocess.CREATE_NO_WINDOW)
                    state_connected = False
                    connected_to_requested = False
                    for line in res_int.stdout.splitlines():
                        line = line.strip()
                        if ":" in line:
                            parts = line.split(":", 1)
                            key = parts[0].strip().lower()
                            val = parts[1].strip()
                            if "state" in key or "מצב" in key:
                                if "connected" in val.lower() or "מחובר" in val:
                                    state_connected = True
                            elif key == "ssid" and val == ssid:
                                connected_to_requested = True
                    if state_connected and connected_to_requested:
                        success = True
                        break
                
                if success:
                    self.root.after(0, lambda: self.on_wifi_connected_success(ssid))
                else:
                    self.root.after(0, lambda: self.on_wifi_connected_fail(ssid))
                    
            except Exception as e:
                self.root.after(0, lambda: self.on_wifi_connected_fail(ssid))
                
        threading.Thread(target=run_connect, daemon=True).start()

    def on_wifi_connected_success(self, ssid):
        if getattr(self, '_wifi_panel_active', False):
            self.close_wifi_panel()
            self.show_status(f"מחובר בהצלחה אל {ssid}! 📶", SUCCESS)

    def on_wifi_connected_fail(self, ssid):
        if getattr(self, '_wifi_panel_active', False):
            self.scan_wifi_async()
            # Display error directly in subtitle in red instead of shifting the layout via status label
            self.lbl_subtitle.config(text=f"❌ חיבור לרשת {ssid} נכשל. בדוק סיסמה.", fg=ERROR)

    def disconnect_wifi_async(self, ssid):
        def run_disconnect():
            self.root.after(0, lambda: self.show_wifi_status_msg("מתנתק... ⏳"))
            try:
                subprocess.run(["netsh", "wlan", "disconnect"], capture_output=True, text=True, errors="ignore", creationflags=subprocess.CREATE_NO_WINDOW)
                subprocess.run(["netsh", "wlan", "delete", "profile", f"name={ssid}"], capture_output=True, text=True, errors="ignore", creationflags=subprocess.CREATE_NO_WINDOW)
                time.sleep(1)
                self.root.after(0, lambda: self.scan_wifi_async())
            except Exception as e:
                self.root.after(0, lambda: self.scan_wifi_async())
                
        threading.Thread(target=run_disconnect, daemon=True).start()

    def show_wifi_status_msg(self, msg):
        if getattr(self, '_wifi_panel_active', False):
            self.lbl_subtitle.config(text=msg)

    def close_wifi_panel(self):
        self._wifi_panel_active = False
        global _wifi_panel_active
        _wifi_panel_active = False
        self.wifi_btn.config(text="📶  בחר רשת Wi-Fi")
        self.restore_current_step()

    def restore_current_step(self):
        self._wifi_panel_active = False
        global _wifi_panel_active
        _wifi_panel_active = False
        
        # Restore mousewheel
        try:
            self.root.unbind_all("<MouseWheel>")
        except Exception:
            pass
            
        # Destroy wifi container
        if hasattr(self, 'wifi_container') and self.wifi_container:
            try:
                self.wifi_container.destroy()
            except Exception:
                pass
            self.wifi_container = None
            
        self.clear_selection_screen()
        
        # Re-pack title/subtitle at the top of the card
        self.lbl_title.pack_forget()
        self.lbl_subtitle.pack_forget()
        self.lbl_title.pack(pady=(0, 4))
        self.lbl_subtitle.pack(pady=(0, 12))
        self.lbl_subtitle.config(fg=TEXT_DIM)  # Reset color in case it was changed to red on error
        
        # Restore inputs
        if self._step == 1:
            self._apply_loan_state()
        elif self._step == 2:
            self.lbl_display.master.pack(fill="x", pady=(0, 12))
            if hasattr(self, 'pad_frame'):
                self.pad_frame.pack()
            self.btn_submit.pack(fill="x", pady=(10, 0))
            self.lbl_status.pack(pady=(8, 0))
            self.lbl_title.config(text="הכנס קוד שיעור (4 ספרות)", fg=ACCENT)
            self.lbl_subtitle.config(text="קבל את הקוד מהמורה שלך", fg=TEXT_DIM)
            self.lbl_status.config(text="")
        elif self._step == 3:
            self._step = 1
            self._apply_loan_state()
        elif self._step == 4:
            self.show_teacher_locked("המורה הפסיק את השיעור זמנית. הקשב למורה. ⏸️")

    # ── Public API ────────────────────────────────────────────

    def set_verify_callback(self, cb):
        self._verify = cb

    def set_lesson_verify_callback(self, cb):
        self._verify_lesson = cb

    def set_loan_info(self, loan_data: dict | None):
        self.loan_data = loan_data
        self.root.after(0, self._apply_loan_state)

    def _apply_loan_state(self):
        self._step = 1
        self.entered_id = ""
        self.lbl_display.config(text="")
        self.lbl_timer.config(text="")
        self.lbl_timer_label.config(text="")
        self._verifying = False
        
        # Repack title and subtitle at the top of the card
        self.lbl_title.pack_forget()
        self.lbl_subtitle.pack_forget()
        self.lbl_title.pack(pady=(0, 4))
        self.lbl_subtitle.pack(pady=(0, 12))
        
        # Ensure all widgets are visible (in case they were hidden by teacher lock or selection screen)
        self.lbl_status.pack_forget()
        self.lbl_display.master.pack(fill="x", pady=(0, 12))
        if hasattr(self, 'pad_frame'):
            self.pad_frame.pack()
        self.btn_submit.pack(fill="x", pady=(10, 0))
        self.lbl_status.pack(pady=(8, 0))
        
        self.lbl_status.config(text="")
        self.clear_selection_screen()
        
        if self.loan_data and self.loan_data.get("student_name"):
            name = self.loan_data.get("student_name", "")
            klass = self.loan_data.get("class_name", "")
            self.lbl_title.config(text="הקש את תעודת הזהות שלך", fg=TEXT_MAIN)
            self.lbl_subtitle.config(text=f"המחשב הוצא על שם: {name} | כיתה {klass}", fg=TEXT_DIM)
        elif self.loan_data and self.loan_data.get("unborrowed"):
            cart = self.loan_data.get("cart_name", "")
            dev_num = self.loan_data.get("device_number")
            dev_str = f"מחשב {dev_num}" if dev_num else ""
            cart_str = f"{cart} | {dev_str}" if cart and dev_str else (cart or dev_str or "עגלת מחשבים")
            self.lbl_title.config(text="מחשב זה ממתין להשאלה בעגלה", fg=WARNING)
            self.lbl_subtitle.config(text=f"{cart_str} — פנה לתחנת הקיוסק להשאלה", fg=TEXT_DIM)
        elif self.loan_data and self.loan_data.get("unregistered"):
            asset = self.config.get("asset_tag", "")
            asset_str = f"({asset}) " if asset else ""
            self.lbl_title.config(text="🚫 מחשב זה אינו רשום במערכת", fg=ERROR)
            self.lbl_subtitle.config(text=f"תג נכס {asset_str}אינו מוגדר בעגלות בית הספר.\nיש להריץ התקנה או לפנות למנהל המחשוב.", fg=TEXT_DIM)
        else:
            self.lbl_title.config(text="מחשב זה אינו רשום להשאלה", fg=WARNING)
            self.lbl_subtitle.config(text="הקש קוד מנהל לפתיחה, או פנה לקיוסק לרישום.", fg=TEXT_DIM)

        self.btn_submit.config(state="normal")

    def set_verifying(self, state: bool):
        self._verifying = state
        def _do():
            if state:
                self.btn_submit.config(state='disabled')
                self.show_status('בודק נתונים...', '#60a5fa')
            else:
                self.btn_submit.config(state='normal')
        self.root.after(0, _do)

    def show_status(self, msg: str, color: str = TEXT_DIM):
        self.root.after(0, lambda: self.lbl_status.config(text=msg, fg=color))

    def show_lesson_code_prompt(self):
        """מעבר לשלב 2 – הכנסת קוד שיעור"""
        self._step = 2
        self.entered_id = ""
        self._wifi_panel_active = False
        def _do():
            self.clear_selection_screen()
            if hasattr(self, 'wifi_container') and self.wifi_container:
                try:
                    self.wifi_container.destroy()
                except Exception:
                    pass
                self.wifi_container = None
            
            # Repack title and subtitle at the top
            self.lbl_title.pack_forget()
            self.lbl_subtitle.pack_forget()
            self.lbl_title.pack(pady=(0, 4))
            self.lbl_subtitle.pack(pady=(0, 12))
            
            # Repack standard widgets
            self.lbl_display.master.pack(fill="x", pady=(0, 12))
            if hasattr(self, 'pad_frame'):
                self.pad_frame.pack()
            self.btn_submit.pack(fill="x", pady=(10, 0))
            self.lbl_status.pack(pady=(8, 0))
            
            self.lbl_display.config(text="")
            self.lbl_title.config(text="הכנס קוד שיעור (4 ספרות)", fg=ACCENT)
            self.lbl_subtitle.config(text="קבל את הקוד מהמורה שלך")
            self.lbl_status.config(text="")
            self.update_lesson_timer("")
            self.root.deiconify()
            self.root.lift()
            self.root.attributes("-topmost", True)
            self.root.focus_force()
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
        self._step = 1
        self.clear_selection_screen()
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
        self._verifying = False
        self.hide_lesson_widget()
        self.hide_teacher_widget()
        def _do():
            install_keyboard_hook()
            set_task_manager_enabled(False)
            self.lbl_display.config(text="")
            self.root.deiconify()
            self.root.attributes("-topmost", True)
            self.root.focus_force()
            
            # Ensure standard widgets are packed if we are in step 1 or 2
            if self._step in (1, 2):
                self.clear_selection_screen()
                if hasattr(self, 'wifi_container') and self.wifi_container:
                    try:
                        self.wifi_container.destroy()
                    except Exception:
                        pass
                    self.wifi_container = None
                
                self.lbl_title.pack_forget()
                self.lbl_subtitle.pack_forget()
                self.lbl_title.pack(pady=(0, 4))
                self.lbl_subtitle.pack(pady=(0, 12))
                
                self.lbl_display.master.pack(fill="x", pady=(0, 12))
                if hasattr(self, 'pad_frame'):
                    self.pad_frame.pack()
                self.btn_submit.pack(fill="x", pady=(10, 0))
                self.lbl_status.pack(pady=(8, 0))
                
            self.lbl_status.config(text=message, fg=WARNING)
            self.update_lesson_timer("")
            self.root.deiconify()
            self.root.lift()
            self.root.attributes("-topmost", True)
            self.root.focus_force()
        self.root.after(0, _do)

    def check_and_close_task_manager(self):
        """חוסם מנהל משימות לתלמיד ברמת חלון ללא נגיעה ב-Registry"""
        try:
            for title_or_class in ("TaskManagerWindow", "Task Manager", "מנהל המשימות"):
                hwnd = user32.FindWindowW(title_or_class if title_or_class == "TaskManagerWindow" else None,
                                          title_or_class if title_or_class != "TaskManagerWindow" else None)
                if hwnd:
                    user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE
        except Exception:
            pass

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
        self.hide_lesson_widget()
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
            r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq cart_watchdog.exe"], capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
            if "cart_watchdog.exe" not in r.stdout:
                watchdog_path = r"C:\Program Files\CartAgent\cart_watchdog.exe"
                if os.path.exists(watchdog_path):
                    subprocess.Popen([watchdog_path], creationflags=subprocess.CREATE_NO_WINDOW)
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
        self.lbl_display.master.pack(fill="x", pady=(0, 12))
        if hasattr(self, 'pad_frame'):
            self.pad_frame.pack()
        self.btn_submit.pack(fill="x", pady=(10, 0))
        
        self.lbl_title.config(text="הקש את תעודת הזהות שלך", fg=TEXT_MAIN)
        self.lbl_subtitle.config(text=f"המחשב הוצא על שם: {self.loan_data.get('student_name', '')} | כיתה {self.loan_data.get('class_name', '')}" if self.loan_data else "")
        self.lbl_display.config(text="")
        self.show_status("")

    def show_teacher_locked(self, message: str = "השיעור מושהה כעת. הקשב למורה. ⏸️"):
        """מציג מסך נעילת מורה ללא אפשרות הקשה או כפתורים"""
        self._step = 4  # שלב נעילת מורה
        def _do():
            # hide numpad, display, and submit button
            self.lbl_display.master.pack_forget()
            if hasattr(self, 'pad_frame'):
                self.pad_frame.pack_forget()
            self.btn_submit.pack_forget()
            self.clear_selection_screen()

            self.lbl_title.config(text="🔒 המסכים נעולים", fg=WARNING)
            self.lbl_subtitle.config(text=message)
            self.lbl_status.config(text="")
        self.root.after(0, _do)

    def restore_from_teacher_lock(self):
        """מחזיר את המסך למצב הקשת תעודת זהות רגיל"""
        self._step = 1
        self.entered_id = ""
        def _do():
            # restore widgets
            self.lbl_display.master.pack(fill="x", pady=(0, 12))
            if hasattr(self, 'pad_frame'):
                self.pad_frame.pack()
            self.btn_submit.pack(fill="x", pady=(10, 0))

            self.lbl_title.config(text="הקש את תעודת הזהות שלך", fg=TEXT_MAIN)
            self.lbl_subtitle.config(text=f"המחשב הוצא על שם: {self.loan_data.get('student_name', '')} | כיתה {self.loan_data.get('class_name', '')}" if self.loan_data else "")
            self.lbl_display.config(text="")
            self.lbl_status.config(text="")
        self.root.after(0, _do)

    def set_disconnect_callback(self, cb):
        self._on_disconnect_clicked = cb

    def show_lesson_widget(self, subject, teacher_name, end_time_str, student_name="", class_name=""):
        self.root.after(0, lambda: self._show_lesson_widget_inner(subject, teacher_name, end_time_str, student_name, class_name))

    def _show_lesson_widget_inner(self, subject, teacher_name, end_time_str, student_name="", class_name=""):
        self.hide_lesson_widget()
        self.lesson_widget = LessonWidget(
            self.root, subject, teacher_name, end_time_str, self._on_disconnect_clicked, student_name, class_name
        )

    def hide_lesson_widget(self):
        if self.lesson_widget:
            try:
                self.lesson_widget.destroy()
            except Exception:
                pass
            self.lesson_widget = None

    def update_lesson_widget_timer(self, remaining_seconds):
        if self.lesson_widget:
            try:
                self.lesson_widget.update_timer(remaining_seconds)
            except Exception:
                pass

    def show_teacher_widget(self, teacher_name: str, teacher_id: str, on_lock):
        self.root.after(0, lambda: self._show_teacher_widget_inner(teacher_name, teacher_id, on_lock))

    def _show_teacher_widget_inner(self, teacher_name: str, teacher_id: str, on_lock):
        self.hide_teacher_widget()
        self.teacher_widget = TeacherWidget(self.root, teacher_name, teacher_id, on_lock)

    def hide_teacher_widget(self):
        if self.teacher_widget:
            try:
                self.teacher_widget.destroy()
            except Exception:
                pass
            self.teacher_widget = None

