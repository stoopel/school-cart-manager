"""
uninstaller.py - Graphical Uninstaller for CartAgent.
Removes processes, restores original Windows Shell, removes driver, and cleans directory.
"""

import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox
import os
import sys
import time
import ctypes
from ctypes import wintypes
import subprocess
import winreg
import json

BG = "#0f172a"
BG_CARD = "#1e293b"
BG_INPUT = "#334155"
ACCENT = "#3b82f6"
ERROR = "#ef4444"
SUCCESS = "#22c55e"
TEXT_MAIN = "#f8fafc"
TEXT_DIM = "#94a3b8"

class UninstallerGUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("CartAgent Uninstaller")
        self.root.configure(bg=BG)
        self.root.geometry("520x360")
        self.root.resizable(False, False)
        
        # Center the window
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = (sw - 520) // 2
        y = (sh - 360) // 2
        self.root.geometry(f"+{x}+{y}")

        self._build_ui()

    def _build_ui(self):
        self.font_title = tkfont.Font(family="Segoe UI", size=18, weight="bold")
        self.font_sub = tkfont.Font(family="Segoe UI", size=11)
        self.font_btn = tkfont.Font(family="Segoe UI", size=11, weight="bold")
        self.font_log = tkfont.Font(family="Consolas", size=9)

        # Title Label
        tk.Label(self.root, text="❌ הסרת CartAgent", font=self.font_title, bg=BG, fg=TEXT_MAIN).pack(pady=(30, 10))
        
        # Warning card
        card = tk.Frame(self.root, bg=BG_CARD, bd=0)
        card.place(relx=0.08, rely=0.25, relwidth=0.84, relheight=0.45)

        self.lbl_info = tk.Label(
            card, 
            text="תוכנה זו תסיר לחלוטין את ה-Agent ממחשב זה,\nתשחזר את תפריטי המערכת ותנקה את הדרייברים.", 
            font=self.font_sub, bg=BG_CARD, fg=TEXT_DIM, justify="center"
        )
        self.lbl_info.pack(pady=(15, 10))

        # Entry for admin password
        self.lbl_pwd = tk.Label(card, text="הקש סיסמת מנהל מערכת לאישור ההסרה:", font=self.font_sub, bg=BG_CARD, fg=TEXT_MAIN)
        self.lbl_pwd.pack(pady=(5, 2))
        
        self.ent_pwd = tk.Entry(card, bg=BG, fg=TEXT_MAIN, bd=1, show="●", relief="flat", insertbackground=TEXT_MAIN, font=self.font_sub, justify="center")
        self.ent_pwd.pack(pady=(0, 10), ipady=4, ipadx=20)
        self.ent_pwd.focus_force()

        # Log Terminal (Hidden by default, shown during install)
        self.txt_log = tk.Text(card, bg="#020617", fg=TEXT_MAIN, font=self.font_log, state="disabled", bd=0, padx=10, pady=10)
        
        # Action Buttons
        self.btn_frame = tk.Frame(self.root, bg=BG)
        self.btn_frame.place(relx=0.08, rely=0.78, relwidth=0.84, relheight=0.15)

        self.btn_cancel = tk.Button(
            self.btn_frame, text="ביטול", font=self.font_btn, bg=BG_INPUT, fg=TEXT_MAIN,
            activebackground="#475569", activeforeground=TEXT_MAIN, bd=0, cursor="hand2", command=self.root.destroy
        )
        self.btn_cancel.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 10))

        self.btn_uninstall = tk.Button(
            self.btn_frame, text="הסר תוכנה", font=self.font_btn, bg=ERROR, fg=TEXT_MAIN,
            activebackground="#b91c1c", activeforeground=TEXT_MAIN, bd=0, cursor="hand2", command=self.start_uninstallation
        )
        self.btn_uninstall.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=(10, 0))

    def log(self, msg):
        self.txt_log.config(state="normal")
        self.txt_log.insert(tk.END, msg + "\n")
        self.txt_log.see(tk.END)
        self.txt_log.config(state="disabled")
        self.root.update()

    def start_uninstallation(self):
        # 0. Verify admin password
        entered = self.ent_pwd.get().strip()
        if not entered:
            messagebox.showwarning("שדה חסר", "אנא הקש סיסמת מנהל מערכת כדי לאשר את ההסרה.")
            return

        # Try to load config.json
        config = {}
        config_paths = [
            r"C:\Program Files\CartAgent\config.json",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json"),
            "config.json"
        ]
        for path in config_paths:
            if os.path.exists(path):
                try:
                    with open(path, "r", encoding="utf-8-sig") as f:
                        config = json.load(f)
                    break
                except Exception:
                    pass

        admin_code = config.get("admin_code", "")
        admin_code_hash = config.get("admin_code_hash", "")

        is_correct = False
        if admin_code_hash:
            import hashlib
            hashed = hashlib.sha256(entered.encode('utf-8')).hexdigest()
            if hashed == admin_code_hash:
                is_correct = True
        elif admin_code:
            if entered == admin_code:
                is_correct = True
        else:
            # Fallback to default check
            import hashlib
            hashed = hashlib.sha256(entered.encode('utf-8')).hexdigest()
            default_hash = "b8b8eb83374c0bf3b1c3224159f6119dbfff1b7ed6dfecdd80d4e8a895790a34" # admin2024
            if hashed == default_hash or entered == "admin2024":
                is_correct = True

        if not is_correct:
            messagebox.showerror("שגיאה", "סיסמת מנהל שגויה! ההסרה נדחתה.")
            return

        self.btn_uninstall.pack_forget()
        self.btn_cancel.pack_forget()
        self.lbl_info.pack_forget()
        self.lbl_pwd.pack_forget()
        self.ent_pwd.pack_forget()
        self.txt_log.pack(fill=tk.BOTH, expand=True)

        self.log("[*] Starting uninstallation process...")
        self.root.update()
        
        # 1. Create the uninstall flag file
        local_dir = r"C:\Program Files\CartAgent"
        lock_file = os.path.join(local_dir, "uninstalling.lock")
        try:
            if not os.path.exists(local_dir):
                os.makedirs(local_dir, exist_ok=True)
            with open(lock_file, "w") as f:
                f.write("uninstalling")
            self.log("[OK] Placed uninstall flag file.")
        except Exception as e:
            self.log(f"[WARNING] Failed to write lock file: {e}")

        # 2. Wait for mutual watchdogs to read flag and exit
        self.log("[*] Waiting for processes to exit gracefully...")
        time.sleep(1.5)

        # 3. Kill processes forcefully just in case
        try:
            subprocess.run(["taskkill", "/F", "/IM", "cart_watchdog.exe"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            subprocess.run(["taskkill", "/F", "/IM", "cart_agent.exe"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            self.log("[OK] Terminated processes.")
        except Exception:
            pass

        # 4. Restore original Windows Shell Registry entries
        self.log("[*] Restoring Windows Shell Registry values...")
        self.restore_registry_shell()

        # 5. Uninstall Interception Keyboard Driver
        self.log("[*] Uninstalling Interception driver (Kernel)...")
        self.uninstall_driver()

        # 6. Re-enable Task Manager
        self.log("[*] Re-enabling Task Manager...")
        self.re_enable_task_mgr()

        self.log("[OK] Uninstallation complete.")
        
        # 7. Create cleanup batch file and exit
        self.trigger_folder_deletion()

    def restore_registry_shell(self):
        # 1. Clean default HKCU Winlogon Shell if written
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Winlogon", 0, winreg.KEY_ALL_ACCESS)
            winreg.DeleteValue(key, "Shell")
            winreg.CloseKey(key)
            self.log("[OK] Removed Current User Shell override.")
        except WindowsError:
            pass

        # 2. Resolve SID and clean user registry hive
        try:
            # Get physical logged-in user
            res = subprocess.run(["powershell", "-Command", "(Get-CimInstance Win32_ComputerSystem).UserName"], capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
            logged_user = res.stdout.strip()
            if logged_user and "\\" in logged_user:
                logged_user = logged_user.split("\\")[-1]
            
            if logged_user:
                # Find SID under HKLM ProfileList
                profile_key_path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList"
                profile_key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, profile_key_path)
                
                user_sid = None
                i = 0
                while True:
                    try:
                        subkey_name = winreg.EnumKey(profile_key, i)
                        subkey = winreg.OpenKey(profile_key, subkey_name)
                        try:
                            val, _ = winreg.QueryValueEx(subkey, "ProfileImagePath")
                            if val.split("\\")[-1] == logged_user:
                                user_sid = subkey_name
                                winreg.CloseKey(subkey)
                                break
                        except WindowsError:
                            pass
                        winreg.CloseKey(subkey)
                        i += 1
                    except WindowsError:
                        break
                winreg.CloseKey(profile_key)
                
                if user_sid:
                    # Access HKEY_USERS SID hive
                    reg_path = f"{user_sid}\\Software\Microsoft\Windows NT\\CurrentVersion\\Winlogon"
                    try:
                        key = winreg.OpenKey(winreg.HKEY_USERS, reg_path, 0, winreg.KEY_ALL_ACCESS)
                        winreg.DeleteValue(key, "Shell")
                        winreg.CloseKey(key)
                        self.log(f"[OK] Removed Shell override for active user SID ({logged_user}).")
                    except WindowsError:
                        pass
        except Exception as e:
            self.log(f"[WARNING] Could not restore user SID shell: {e}")

    def uninstall_driver(self):
        inst_path = r"C:\Program Files\CartAgent\install-interception.exe"
        if os.path.exists(inst_path):
            try:
                # Run driver uninstaller
                subprocess.run([inst_path, "/uninstall"], cwd=r"C:\Program Files\CartAgent", capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
                self.log("[OK] Executed Interception driver uninstaller.")
                self.log("[IMPORTANT] System reboot is required to completely unload driver.")
            except Exception as e:
                self.log(f"[WARNING] Failed to run driver uninstaller: {e}")
        else:
            self.log("[*] Driver uninstaller executable not found. Skipping.")

    def re_enable_task_mgr(self):
        try:
            key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Policies\System")
            winreg.SetValueEx(key, "DisableTaskMgr", 0, winreg.REG_DWORD, 0)
            winreg.CloseKey(key)
            self.log("[OK] Re-enabled Task Manager access.")
        except Exception:
            pass

    def trigger_folder_deletion(self):
        # Create a self-deleting cleanup batch file in %TEMP%
        temp_dir = os.environ.get("TEMP", "C:\\Windows\\Temp")
        batch_path = os.path.join(temp_dir, "cartagent_cleanup.bat")
        
        batch_content = f"""@echo off
timeout /t 2 > nul
rmdir /s /q "C:\\Program Files\\CartAgent"
del "%~f0"
"""
        try:
            with open(batch_path, "w") as f:
                f.write(batch_content)
            
            # Start the batch file in a new window/process
            subprocess.Popen([batch_path], shell=True, creationflags=subprocess.CREATE_NO_WINDOW)
            self.log("[OK] Triggered final folder deletion.")
        except Exception as e:
            self.log(f"[WARNING] Failed to write cleanup batch file: {e}")

        # Show success message
        messagebox.showinfo("הסרה הושלמה", "תוכנת CartAgent הוסרה בהצלחה מהמחשב!\nמומלץ לבצע הפעלה מחדש (Reboot) של המחשב להשלמת הסרת הדרייבר.")
        self.root.destroy()
        sys.exit(0)

    def run(self):
        self.root.mainloop()

if __name__ == "__main__":
    # Ensure run as administrator to delete files in Program Files and modify HKEY_USERS
    if not ctypes.windll.shell32.IsUserAnAdmin():
        # Re-run as Administrator
        ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
        sys.exit(0)
        
    app = UninstallerGUI()
    app.run()
