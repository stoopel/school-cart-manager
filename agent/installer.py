"""
installer.py - Graphical Installer for CartAgent.
Performs automatic computer name parsing, registers system configuration on Supabase,
deploys executables to C:\\Program Files\\CartAgent, installs driver, and configures Shell.
"""

import tkinter as tk
from tkinter import font as tkfont
from tkinter import messagebox
import os
import sys
import time
import re
import socket
import json
import shutil
import ctypes
from ctypes import wintypes
import subprocess
import winreg
import threading
import requests

BG = "#0f172a"
BG_CARD = "#1e293b"
BG_INPUT = "#1e293b"
ACCENT = "#3b82f6"
ACCENT_HOVER = "#2563eb"
SUCCESS = "#22c55e"
ERROR = "#ef4444"
TEXT_MAIN = "#f8fafc"
TEXT_DIM = "#94a3b8"
BORDER = "#334155"

class InstallerGUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("CartAgent Setup")
        self.root.configure(bg=BG)
        self.root.geometry("640x520")
        self.root.resizable(False, False)

        # Center the window
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = (sw - 640) // 2
        y = (sh - 520) // 2
        self.root.geometry(f"+{x}+{y}")

        # Parse local configuration template if exists
        self.config_template = {}
        try:
            template_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
            if os.path.exists(template_path):
                with open(template_path, "r", encoding="utf-8-sig") as f:
                    self.config_template = json.load(f)
        except Exception:
            pass

        # Supabase configs
        self.sb_url = self.config_template.get("supabase_url", "")
        self.sb_key = self.config_template.get("supabase_key", "")

        # Automatically parsed computer values
        self.detected_cart_id = ""
        self.detected_device_num = ""
        self.detected_asset_tag = ""
        self.detected_cart_name = ""
        self._detect_system_values()

        self._build_ui()

    def _detect_system_values(self):
        try:
            # Parse PC Name (Format: e.g. CART-03-05 or similar)
            pc_name = socket.gethostname().upper()
            self.detected_asset_tag = pc_name
            
            # Simple regex search: e.g. CART-(\d+)-(\d+)
            m = re.search(r"CART-?(\d+)-?(\d+)", pc_name)
            if m:
                cart_num = int(m.group(1))
                device_num = int(m.group(2))
                self.detected_cart_id = str(cart_num)
                self.detected_device_num = str(device_num)
                self.detected_cart_name = f"עגלה {cart_num}"
            else:
                self.detected_cart_id = "1"
                self.detected_device_num = "1"
                self.detected_cart_name = "עגלה א"
        except Exception:
            self.detected_cart_id = "1"
            self.detected_device_num = "1"
            self.detected_asset_tag = "A-001"
            self.detected_cart_name = "עגלה א"

    def _build_ui(self):
        self.font_title = tkfont.Font(family="Segoe UI", size=20, weight="bold")
        self.font_sub = tkfont.Font(family="Segoe UI", size=10)
        self.font_label = tkfont.Font(family="Segoe UI", size=11, weight="bold")
        self.font_btn = tkfont.Font(family="Segoe UI", size=12, weight="bold")
        self.font_log = tkfont.Font(family="Consolas", size=9)

        # Title Section
        tk.Label(self.root, text="🚀 התקנת CartAgent", font=self.font_title, bg=BG, fg=TEXT_MAIN).pack(pady=(25, 5))
        tk.Label(self.root, text="מערכת נעילת מסך ואבטחה מנוהלת לעגלות מחשבים", font=self.font_sub, bg=BG, fg=TEXT_DIM).pack(pady=(0, 20))

        # Main Card Panel
        self.card = tk.Frame(self.root, bg=BG_CARD, bd=1, highlightbackground=BORDER, highlightthickness=1)
        self.card.place(relx=0.08, rely=0.18, relwidth=0.84, relheight=0.64)

        self._build_form_inputs()

        # Log Terminal (Hidden by default, used during execution)
        self.txt_log = tk.Text(self.card, bg="#020617", fg=TEXT_MAIN, font=self.font_log, state="disabled", bd=0, padx=12, pady=12)

        # Bottom Button Frame
        self.btn_frame = tk.Frame(self.root, bg=BG)
        self.btn_frame.place(relx=0.08, rely=0.85, relwidth=0.84, relheight=0.10)

        self.btn_cancel = tk.Button(
            self.btn_frame, text="ביטול", font=self.font_btn, bg=BG_INPUT, fg=TEXT_MAIN,
            activebackground="#334155", activeforeground=TEXT_MAIN, bd=0, cursor="hand2", command=self.root.destroy
        )
        self.btn_cancel.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 10))

        self.btn_install = tk.Button(
            self.btn_frame, text="התחל התקנה", font=self.font_btn, bg=ACCENT, fg=TEXT_MAIN,
            activebackground=ACCENT_HOVER, activeforeground=TEXT_MAIN, bd=0, cursor="hand2", command=self.start_installation
        )
        self.btn_install.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=(10, 0))

    def _build_form_inputs(self):
        self.form_frame = tk.Frame(self.card, bg=BG_CARD, padx=25, pady=20)
        self.form_frame.pack(fill=tk.BOTH, expand=True)

        # 4 Grid configuration rows
        self.form_frame.columnconfigure(0, weight=1)
        self.form_frame.columnconfigure(1, weight=1)

        # Cart ID
        tk.Label(self.form_frame, text="מזהה עגלה (מערכת):", font=self.font_label, bg=BG_CARD, fg=TEXT_MAIN, anchor="w").grid(row=0, column=0, sticky="ew", pady=(0, 4))
        self.ent_cart_id = tk.Entry(self.form_frame, bg="#0f172a", fg=TEXT_MAIN, bd=1, relief="flat", insertbackground=TEXT_MAIN, font=self.font_label, highlightbackground=BORDER, highlightthickness=1)
        self.ent_cart_id.insert(0, self.detected_cart_id)
        self.ent_cart_id.grid(row=1, column=0, sticky="ew", padx=(0, 15), pady=(0, 20), ipady=5)

        # Device Number
        tk.Label(self.form_frame, text="מספר מחשב (לפטופ):", font=self.font_label, bg=BG_CARD, fg=TEXT_MAIN, anchor="w").grid(row=0, column=1, sticky="ew", pady=(0, 4))
        self.ent_device_num = tk.Entry(self.form_frame, bg="#0f172a", fg=TEXT_MAIN, bd=1, relief="flat", insertbackground=TEXT_MAIN, font=self.font_label, highlightbackground=BORDER, highlightthickness=1)
        self.ent_device_num.insert(0, self.detected_device_num)
        self.ent_device_num.grid(row=1, column=1, sticky="ew", pady=(0, 20), ipady=5)

        # Asset Tag
        tk.Label(self.form_frame, text="תג נכס (Asset Tag):", font=self.font_label, bg=BG_CARD, fg=TEXT_MAIN, anchor="w").grid(row=2, column=0, sticky="ew", pady=(0, 4))
        self.ent_asset_tag = tk.Entry(self.form_frame, bg="#0f172a", fg=TEXT_MAIN, bd=1, relief="flat", insertbackground=TEXT_MAIN, font=self.font_label, highlightbackground=BORDER, highlightthickness=1)
        self.ent_asset_tag.insert(0, self.detected_asset_tag)
        self.ent_asset_tag.grid(row=3, column=0, sticky="ew", padx=(0, 15), pady=(0, 20), ipady=5)

        # Cart Name
        tk.Label(self.form_frame, text="שם עגלה (תצוגה):", font=self.font_label, bg=BG_CARD, fg=TEXT_MAIN, anchor="w").grid(row=2, column=1, sticky="ew", pady=(0, 4))
        self.ent_cart_name = tk.Entry(self.form_frame, bg="#0f172a", fg=TEXT_MAIN, bd=1, relief="flat", insertbackground=TEXT_MAIN, font=self.font_label, highlightbackground=BORDER, highlightthickness=1)
        self.ent_cart_name.insert(0, self.detected_cart_name)
        self.ent_cart_name.grid(row=3, column=1, sticky="ew", pady=(0, 20), ipady=5)

        # Supabase Connection status indicator
        self.lbl_status = tk.Label(self.form_frame, text="בדיקת חיבור לשרת...", font=self.font_sub, bg=BG_CARD, fg=TEXT_DIM)
        self.lbl_status.grid(row=4, column=0, columnspan=2, sticky="w", pady=(15, 0))
        
        # Trigger background check
        threading.Thread(target=self._check_supabase_connection, daemon=True).start()

    def _check_supabase_connection(self):
        try:
            if not self.sb_url or not self.sb_key:
                self.root.after(0, lambda: self.lbl_status.config(text="⚠️ שגיאה: פרטי Supabase חסרים בקובץ config.json!", fg=ERROR))
                return

            headers = {"apikey": self.sb_key, "Authorization": f"Bearer {self.sb_key}"}
            res = requests.get(f"{self.sb_url}/rest/v1/carts?select=*", headers=headers, timeout=5)
            if res.status_code == 200:
                self.root.after(0, lambda: self.lbl_status.config(text="✓ חיבור לשרת Supabase תקין ומאומת.", fg=SUCCESS))
            else:
                self.root.after(0, lambda: self.lbl_status.config(text=f"⚠️ שגיאה: שרת Supabase החזיר סטטוס {res.status_code}", fg=ERROR))
        except Exception as e:
            self.root.after(0, lambda: self.lbl_status.config(text=f"⚠️ שגיאה: אין גישה לשרת ({e})", fg=ERROR))

    def log(self, msg):
        self.txt_log.config(state="normal")
        self.txt_log.insert(tk.END, msg + "\n")
        self.txt_log.see(tk.END)
        self.txt_log.config(state="disabled")
        self.root.update()

    def start_installation(self):
        # Gather form variables
        self.cart_id = self.ent_cart_id.get().strip()
        self.device_num = self.ent_device_num.get().strip()
        self.asset_tag = self.ent_asset_tag.get().strip()
        self.cart_name = self.ent_cart_name.get().strip()

        if not self.cart_id or not self.device_num or not self.asset_tag:
            messagebox.showwarning("שדות חסרים", "אנא מלא את מזהה העגלה, מספר הלפטופ ותג הנכס.")
            return

        # Swap UI panels
        self.form_frame.pack_forget()
        self.txt_log.pack(fill=tk.BOTH, expand=True)
        self.btn_install.config(state="disabled")
        self.btn_cancel.config(state="disabled")

        # Run installation in thread
        threading.Thread(target=self._run_install_thread, daemon=True).start()

    def _run_install_thread(self):
        try:
            self.log("[*] Starting installation processes...")
            local_dir = r"C:\Program Files\CartAgent"
            
            # 1. Create deployment folder in Program Files
            self.log("[*] Creating Program Files deployment folder...")
            if not os.path.exists(local_dir):
                os.makedirs(local_dir, exist_ok=True)
            self.log(f"[OK] Directory created: {local_dir}")

            # 2. Register/update device in Supabase database
            self.log("[*] Registering laptop configuration in Supabase database...")
            device_registered = self._register_in_supabase()
            if device_registered:
                self.log("[OK] Laptop successfully registered in database.")
            else:
                self.log("[WARNING] Direct database write skipped or failed. Continuing...")

            # 3. Create local config.json
            self.log("[*] Deploying configuration config.json...")
            self.config_template["asset_tag"] = self.asset_tag
            self.config_template["cart_name"] = self.cart_name
            # Set target server details
            local_config_path = os.path.join(local_dir, "config.json")
            with open(local_config_path, "w", encoding="utf-8") as f:
                json.dump(self.config_template, f, ensure_ascii=False, indent=2)
            self.log("[OK] Configuration saved successfully.")

            # 4. Copy executable files
            if getattr(sys, 'frozen', False):
                script_root = sys._MEIPASS
            else:
                script_root = os.path.dirname(os.path.abspath(__file__))
            files_to_copy = [
                ("cart_agent.exe", "cart_agent.exe"),
                ("interception.dll", "interception.dll"),
                ("install-interception.exe", "install-interception.exe"),
                ("cart_watchdog.exe", "cart_watchdog.exe"),
                ("uninstaller.exe", "uninstaller.exe")
            ]
            
            # Kill running agent processes to avoid file-locks during overwriting
            subprocess.run(["taskkill", "/F", "/IM", "cart_watchdog.exe"], capture_output=True)
            subprocess.run(["taskkill", "/F", "/IM", "cart_agent.exe"], capture_output=True)
            time.sleep(0.5)

            for src_name, dest_name in files_to_copy:
                src_path = os.path.join(script_root, src_name)
                dest_path = os.path.join(local_dir, dest_name)
                if os.path.exists(src_path):
                    shutil.copy2(src_path, dest_path)
                    self.log(f"[OK] Deployed {dest_name}")
                else:
                    self.log(f"[WARNING] Optional file {src_name} not found in installer root.")

            # 5. Check and Install Interception Driver
            self.log("[*] Verifying keyboard kernel protection driver status...")
            needs_reboot = self._verify_and_install_driver(local_dir)

            # 6. Re-enable task manager policies or set proper limits
            try:
                key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Policies\System")
                winreg.SetValueEx(key, "DisableTaskMgr", 0, winreg.REG_DWORD, 1)
                winreg.CloseKey(key)
                self.log("[OK] Locked Task Manager policies.")
            except Exception:
                pass

            # 7. Configure custom user shell registry keys
            self.log("[*] Registering system shell to CartAgent...")
            self._register_system_shell(local_dir)

            self.log("[OK] Core deployment complete.")
            
            # Start Watchdog immediately
            watchdog_exe = os.path.join(local_dir, "cart_watchdog.exe")
            if os.path.exists(watchdog_exe):
                subprocess.Popen([watchdog_exe], cwd=local_dir)
                self.log("[OK] Launched CartAgent background security watchdog.")

            # 8. Finished installation
            self.root.after(0, lambda: self._show_finish_dialog(needs_reboot))

        except Exception as e:
            self.log(f"[ERROR] Installation crashed: {e}")
            self.root.after(0, lambda: messagebox.showerror("שגיאה בהתקנה", f"ההתקנה נכשלה עקב שגיאה:\n{e}"))

    def _register_in_supabase(self):
        try:
            if not self.sb_url or not self.sb_key:
                return False
            
            headers = {
                "apikey": self.sb_key,
                "Authorization": f"Bearer {self.sb_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates"
            }
            
            # 1. Resolve cart row
            cart_res = requests.get(f"{self.sb_url}/rest/v1/carts?id=eq.{self.cart_id}", headers=headers, timeout=5)
            if cart_res.status_code == 200 and not cart_res.json():
                # Cart row not exists, create it
                cart_payload = {"id": int(self.cart_id), "name": self.cart_name, "school_name": self.config_template.get("school_name", "בית ספר")}
                requests.post(f"{self.sb_url}/rest/v1/carts", json=cart_payload, headers=headers, timeout=5)
            
            # 2. Insert/upsert laptop device
            laptop_payload = {
                "asset_tag": self.asset_tag,
                "cart_id": int(self.cart_id),
                "device_number": int(self.device_num),
                "status": "available",
                "is_charging": True,
                "battery_level": 100
            }
            
            upsert_res = requests.post(
                f"{self.sb_url}/rest/v1/laptops",
                json=laptop_payload,
                headers=headers,
                timeout=5
            )
            return upsert_res.status_code in [200, 201]
        except Exception as e:
            self.log(f"[WARNING] Database registration failed: {e}")
            return False

    def _verify_and_install_driver(self, local_dir):
        # Standard paths checking
        driver_exists = os.path.exists("C:\\Windows\\System32\\drivers\\interception.sys")
        
        # Checking services registry or sys files
        if driver_exists:
            self.log("[OK] Kernel-Level keyboard protection driver is already active.")
            return False
        
        self.log("[*] Kernel-Level driver is not active. Starting automated driver setup...")
        inst_path = os.path.join(local_dir, "install-interception.exe")
        if os.path.exists(inst_path):
            try:
                self.log("[*] Executing install-interception.exe /install...")
                subprocess.run([inst_path, "/install"], cwd=local_dir, capture_output=True, check=True)
                self.log("[OK] Protection driver successfully deployed to OS.")
                return True
            except Exception as e:
                self.log(f"[ERROR] Driver installation failed: {e}")
                return False
        else:
            self.log("[WARNING] Driver installer not found. Driver-level locks will fallback to Low-Level Win32 hooks.")
            return False

    def _register_system_shell(self, local_dir):
        watchdog_exe = os.path.join(local_dir, "cart_watchdog.exe")
        
        # 1. Clean elevated admin registry override if present
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Winlogon", 0, winreg.KEY_ALL_ACCESS)
            winreg.DeleteValue(key, "Shell")
            winreg.CloseKey(key)
        except WindowsError:
            pass

        # 2. Get active logged-in user SID dynamically
        try:
            res = subprocess.run(["powershell", "-Command", "(Get-CimInstance Win32_ComputerSystem).UserName"], capture_output=True, text=True)
            logged_user = res.stdout.strip()
            if logged_user and "\\" in logged_user:
                logged_user = logged_user.split("\\")[-1]
            
            if logged_user:
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
                    reg_path = f"{user_sid}\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon"
                    key = winreg.OpenKey(winreg.HKEY_USERS, reg_path, 0, winreg.KEY_ALL_ACCESS)
                    winreg.SetValueEx(key, "Shell", 0, winreg.REG_SZ, f'"{watchdog_exe}"')
                    winreg.CloseKey(key)
                    self.log(f"[OK] Registered Shell as watchdog in registry for user SID ({logged_user}).")
                    return
        except Exception as e:
            self.log(f"[WARNING] User SID lookup failed: {e}. Registering in standard HKCU context instead...")

        # Fallback to current process registry Winlogon Shell context
        try:
            key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Winlogon")
            winreg.SetValueEx(key, "Shell", 0, winreg.REG_SZ, f'"{watchdog_exe}"')
            winreg.CloseKey(key)
            self.log("[OK] Registered Shell in standard user hive.")
        except Exception as ex:
            self.log(f"[ERROR] Registry shell writing crashed: {ex}")

    def _show_finish_dialog(self, needs_reboot):
        if needs_reboot:
            ans = messagebox.askyesno(
                "התקנה הושלמה בהצלחה!", 
                "התוכנה הותקנה בהצלחה!\n\nלצורך הפעלת דרייבר ההגנה החדש ברמת הקרנל,\nחובה לבצע הפעלה מחדש (Reboot) למחשב.\n\nהאם ברצונך לבצע הפעלה מחדש של המחשב כעת?"
            )
            if ans:
                subprocess.run(["shutdown", "/r", "/t", "0"])
        else:
            messagebox.showinfo(
                "התקנה הושלמה בהצלחה!",
                "תוכנת CartAgent הותקנה בהצלחה והחלה לפעול ברקע.\nלא נדרש אתחול של המחשב."
            )
        self.root.destroy()
        sys.exit(0)

    def run(self):
        self.root.mainloop()

if __name__ == "__main__":
    # Request Admin elevation right at start
    if not ctypes.windll.shell32.IsUserAnAdmin():
        ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
        sys.exit(0)

    app = InstallerGUI()
    app.run()
