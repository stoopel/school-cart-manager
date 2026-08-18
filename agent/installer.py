r"""
installer.py - Graphical Installer for CartAgent.
Performs automatic computer name parsing, registers system configuration on Supabase,
deploys executables to C:\Program Files\CartAgent, installs driver, and configures Shell.
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
import ssl
import base64
import tempfile
import atexit

import urllib3

# Disable insecure request warnings from urllib3 when bypassing SSL validation
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def save_obfuscated_config(filepath, config_dict):
    """
    Saves the config dictionary to a file in an encrypted (obfuscated) format
    using symmetric XOR with a static secret key.
    """
    data = json.dumps(config_dict, ensure_ascii=False, indent=2).encode("utf-8")
    key = b"CartAgentSecureKey2026!"
    encrypted = bytes(data[i] ^ key[i % len(key)] for i in range(len(data)))
    with open(filepath, "wb") as f:
        f.write(encrypted)

def load_obfuscated_config(filepath):
    """
    Reads config.json. First tries to parse it as plain UTF-8 JSON.
    If that fails, decrypts it using XOR with a static secret key.
    """
    with open(filepath, "rb") as f:
        data = f.read()
    try:
        # Fallback for plain text development JSON
        return json.loads(data.decode("utf-8-sig"))
    except Exception:
        # Decrypt using static XOR key
        key = b"CartAgentSecureKey2026!"
        decrypted = bytes(data[i] ^ key[i % len(key)] for i in range(len(data)))
        return json.loads(decrypted.decode("utf-8"))

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
                self.config_template = load_obfuscated_config(template_path)
        except Exception:
            pass

        # Supabase configs
        self.sb_url = self.config_template.get("supabase_url", "")
        self.sb_key = self.config_template.get("supabase_key", "")
        self.api_base_url = self.config_template.get("api_base_url", "https://school-cart-manager.vercel.app/api/agent")

        # Automatically parsed computer values
        self.detected_cart_id = ""
        self.detected_device_num = ""
        self.detected_asset_tag = ""
        self.detected_cart_name = ""
        self._detect_system_values()

        self._build_ui()

    def _detect_system_values(self):
        try:
            # Parse PC Name (Format: school-specific 440297-עגלהא05 or fallback CART-03-05)
            pc_name = socket.gethostname()
            self.detected_asset_tag = pc_name
            
            # Check school format: e.g. 440297-עגלהא05 or 440297-עגלה112
            if "440297-" in pc_name:
                suffix = pc_name.split("440297-", 1)[1]
                m = re.search(r"^(.*?)(0*\d{1,2})$", suffix)
                if m:
                    raw_cart_name = m.group(1).strip()
                    device_num = int(m.group(2))
                    
                    self.detected_cart_name = raw_cart_name
                    self.detected_device_num = str(device_num)
                    
                    cart_id_match = re.search(r"\d+", raw_cart_name)
                    if cart_id_match:
                        self.detected_cart_id = cart_id_match.group(0)
                    else:
                        hebrew_mapping = {"א": "1", "ב": "2", "ג": "3", "ד": "4", "ה": "5", "ו": "6", "ז": "7", "ח": "8", "ט": "9", "י": "10"}
                        last_char = raw_cart_name[-1] if raw_cart_name else ""
                        self.detected_cart_id = hebrew_mapping.get(last_char, "1")
                    return
            
            # Fallback regex search: e.g. CART-(\d+)-(\d+)
            m = re.search(r"CART-?(\d+)-?(\d+)", pc_name.upper())
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

        # Cart Name (System)
        tk.Label(self.form_frame, text="שם עגלה מערכתי:", font=self.font_label, bg=BG_CARD, fg=TEXT_MAIN, anchor="w").grid(row=0, column=0, sticky="ew", pady=(0, 4))
        self.ent_cart_name = tk.Entry(self.form_frame, bg="#0f172a", fg=TEXT_MAIN, bd=1, relief="flat", insertbackground=TEXT_MAIN, font=self.font_label, highlightbackground=BORDER, highlightthickness=1)
        self.ent_cart_name.insert(0, self.detected_cart_name)
        self.ent_cart_name.grid(row=1, column=0, sticky="ew", padx=(0, 15), pady=(0, 20), ipady=5)

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

        # Admin Passcode (Needed for creating new carts securely)
        tk.Label(self.form_frame, text="קוד מנהל (להקמת עגלה חדשה):", font=self.font_label, bg=BG_CARD, fg=TEXT_MAIN, anchor="w").grid(row=2, column=1, sticky="ew", pady=(0, 4))
        self.ent_admin_code = tk.Entry(self.form_frame, bg="#0f172a", fg=TEXT_MAIN, bd=1, relief="flat", insertbackground=TEXT_MAIN, font=self.font_label, highlightbackground=BORDER, highlightthickness=1, show="*")
        self.ent_admin_code.grid(row=3, column=1, sticky="ew", pady=(0, 20), ipady=5)

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
            res = requests.get(f"{self.sb_url}/rest/v1/carts?select=id,name", headers=headers, timeout=5, verify=False)
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
        self.device_num = self.ent_device_num.get().strip()
        self.asset_tag = self.ent_asset_tag.get().strip()
        self.cart_name = self.ent_cart_name.get().strip()
        self.admin_code = self.ent_admin_code.get().strip()

        if not self.cart_name or not self.device_num or not self.asset_tag:
            messagebox.showwarning("שדות חסרים", "אנא מלא את שם העגלה המערכתי, מספר הלפטופ ותג הנכס.")
            return

        if not self.admin_code:
            messagebox.showwarning("קוד מנהל חסר", "יש להזין קוד מנהל כדי להתחיל בהתקנה.")
            return

        # Verify admin code locally
        import hashlib
        mapping = {
            'ש': 'a', 'ד': 's', 'ג': 'd', 'כ': 'f', 'ע': 'g', 'י': 'h', 'ח': 'j', 'ל': 'k', 'ך': 'l', 'ף': ';',
            'ק': 'w', 'ר': 'e', 'א': 'r', 'ט': 't', 'ו': 'y', 'ן': 'u', 'ם': 'i', 'פ': 'o', ']': 'p',
            'ז': 'z', 'ס': 'x', 'ב': 'c', 'ה': 'v', 'נ': 'b', 'מ': 'n', 'צ': 'm', '/': 'q'
        }
        translated = "".join(mapping.get(c, c) for c in self.admin_code)
        
        target_hash = self.config_template.get("admin_code_hash", "")
        hash_orig = hashlib.sha256(self.admin_code.encode('utf-8')).hexdigest()
        hash_trans = hashlib.sha256(translated.encode('utf-8')).hexdigest()
        
        if hash_orig != target_hash and hash_trans != target_hash:
            messagebox.showerror("קוד מנהל שגוי", "קוד מנהל המערכת שהוקלד אינו נכון. ההתקנה לא תתחיל.")
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
            
            # 1. Register/update device in Supabase database FIRST (CRITICAL PRE-REQUISITE)
            self.log("[*] Registering laptop configuration in Supabase database...")
            device_registered = self._register_in_supabase()
            if device_registered:
                self.log("[OK] Laptop successfully registered in database.")
            else:
                self.log("[ERROR] Database registration failed! Aborting installation.")
                self.root.after(0, lambda: messagebox.showerror("שגיאת רישום", "התקנת המערכת נעצרה:\nלא ניתן היה למצוא או ליצור את העגלה המבוקשת בשרת.\n\nאנא ודא שחיבור האינטרנט תקין ושם העגלה נכון."))
                self.root.after(0, lambda: self.btn_cancel.config(state="normal"))
                return

            local_dir = r"C:\Program Files\CartAgent"
            
            # 2. Create deployment folder in Program Files
            self.log("[*] Creating Program Files deployment folder...")
            if not os.path.exists(local_dir):
                os.makedirs(local_dir, exist_ok=True)
            self.log(f"[OK] Directory created: {local_dir}")

            # 3. Create local config.json
            self.log("[*] Deploying configuration config.json...")
            self.config_template["asset_tag"] = self.asset_tag
            self.config_template["cart_name"] = self.cart_name
            # Set target server details
            local_config_path = os.path.join(local_dir, "config.json")
            save_obfuscated_config(local_config_path, self.config_template)
            self.log("[OK] Configuration saved securely (encrypted).")

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
            subprocess.run(["taskkill", "/F", "/IM", "cart_watchdog.exe"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            subprocess.run(["taskkill", "/F", "/IM", "cart_agent.exe"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            time.sleep(0.5)

            for src_name, dest_name in files_to_copy:
                src_path = os.path.join(script_root, src_name)
                dest_path = os.path.join(local_dir, dest_name)
                if os.path.exists(src_path):
                    shutil.copy2(src_path, dest_path)
                    self.log(f"[OK] Deployed {dest_name}")
                else:
                    if src_name in ["cart_agent.exe", "cart_watchdog.exe", "uninstaller.exe"]:
                        raise FileNotFoundError(f"קובץ ליבה קריטי חסר במתקין: {src_name}")
                    self.log(f"[WARNING] Optional file {src_name} not found in installer root.")

            # 5. Create empty agent.log and set permissions for all users
            self.log("[*] Setting up write permissions for agent.log...")
            log_file_path = os.path.join(local_dir, "agent.log")
            try:
                with open(log_file_path, "a") as lf:
                    pass
                res_acl = subprocess.run(
                    ["icacls", log_file_path, "/grant", "*S-1-5-32-545:M"],
                    capture_output=True, text=True, errors="ignore",
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
                if res_acl.returncode == 0:
                    self.log("[OK] Write permissions granted for agent.log to all users.")
                else:
                    self.log(f"[WARNING] Failed to set permissions: {res_acl.stderr or res_acl.stdout}")
            except Exception as ex:
                self.log(f"[WARNING] Permissions setup failed: {ex}")

            # 6. Check and Install Interception Driver
            self.log("[*] Verifying keyboard kernel protection driver status...")
            needs_reboot = self._verify_and_install_driver(local_dir)

            # 7. Task Manager policies removed by admin request
            self.log("[OK] Task Manager policies bypass active.")

            # 8. Configure custom user shell registry keys
            self.log("[*] Registering system shell to CartAgent...")
            self._register_system_shell(local_dir)

            self.log("[OK] Core deployment complete.")
            
            # Start Watchdog immediately
            watchdog_exe = os.path.join(local_dir, "cart_watchdog.exe")
            if os.path.exists(watchdog_exe):
                subprocess.Popen([watchdog_exe], cwd=local_dir, creationflags=subprocess.CREATE_NO_WINDOW)
                self.log("[OK] Launched CartAgent background security watchdog.")

            # 9. Finished installation
            self.root.after(0, lambda: self._show_finish_dialog(needs_reboot))

        except Exception as e:
            self.log(f"[ERROR] Installation crashed: {e}")
            self._rollback_installation()
            self.root.after(0, lambda: [
                messagebox.showerror("שגיאה בהתקנה", f"ההתקנה נכשלה עקב שגיאה:\n{e}\n\nכל השינויים שבוצעו במחשב בוטלו והמערכת שוחזרה למצבה המקורי."),
                self.btn_cancel.config(state="normal")
            ])

    def _rollback_installation(self):
        self.log("[*] Rollback: Reverting all system changes due to failure...")
        try:
            # 1. Kill any launched processes
            subprocess.run(["taskkill", "/F", "/IM", "cart_watchdog.exe"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
            subprocess.run(["taskkill", "/F", "/IM", "cart_agent.exe"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
        except Exception:
            pass

        # 2. Restore Registry Shell to original default (Explorer.exe)
        self.log("[*] Rollback: Restoring default Windows Shell...")
        try:
            # Remove from active user SID under HKEY_USERS
            res = subprocess.run(["powershell", "-Command", "(Get-CimInstance Win32_ComputerSystem).UserName"], capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
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
                    try:
                        key = winreg.OpenKey(winreg.HKEY_USERS, reg_path, 0, winreg.KEY_ALL_ACCESS)
                        winreg.DeleteValue(key, "Shell")
                        winreg.CloseKey(key)
                    except WindowsError:
                        pass
        except Exception:
            pass

        try:
            # Remove from HKEY_CURRENT_USER
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows NT\CurrentVersion\Winlogon", 0, winreg.KEY_ALL_ACCESS)
            winreg.DeleteValue(key, "Shell")
            winreg.CloseKey(key)
        except WindowsError:
            pass

        # 3. Re-enable Task Manager
        self.log("[*] Rollback: Re-enabling Task Manager...")
        try:
            key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Policies\System")
            winreg.SetValueEx(key, "DisableTaskMgr", 0, winreg.REG_DWORD, 0)
            winreg.CloseKey(key)
        except Exception:
            pass

        # 4. Delete deployed folder
        self.log("[*] Rollback: Cleaning deployed folder...")
        local_dir = r"C:\Program Files\CartAgent"
        if os.path.exists(local_dir):
            for i in range(3):
                try:
                    shutil.rmtree(local_dir)
                    break
                except Exception:
                    time.sleep(0.5)
        self.log("[OK] Rollback completed. System restored to original state.")


    def _register_in_supabase(self):
        try:
            if not self.sb_url or not self.sb_key:
                return False
            
            headers = {
                "apikey": self.sb_key,
                "Authorization": f"Bearer {self.sb_key}",
                "Content-Type": "application/json",
            }
            
            self.log(f"[*] Checking if cart '{self.cart_name}' exists in database...")
            
            # 1. Resolve cart row by name or display_name (supports Hebrew & English)
            cart_res = requests.get(f"{self.sb_url}/rest/v1/carts?or=(name.eq.{self.cart_name},display_name.eq.{self.cart_name})&select=id", headers=headers, timeout=5, verify=False)
            cart_uuid = None
            
            if cart_res.status_code == 200:
                carts = cart_res.json()
                if carts:
                    cart_uuid = carts[0]["id"]
                    self.log(f"[OK] Found existing cart with ID: {cart_uuid}")
                else:
                    self.log("[*] Cart not found. Attempting to create new cart securely...")
                    if not self.admin_code:
                        self.log("[ERROR] Admin passcode is required to create a new cart!")
                        return False
                    
                    rpc_payload = {
                        "p_name": self.cart_name,
                        "p_admin_code": self.admin_code
                    }
                    
                    create_res = requests.post(f"{self.sb_url}/rest/v1/rpc/create_cart_securely", json=rpc_payload, headers=headers, timeout=5, verify=False)
                    
                    if create_res.status_code == 200:
                        cart_uuid = create_res.json()
                        self.log(f"[OK] New cart successfully created with ID: {cart_uuid}")
                    else:
                        err_msg = create_res.json().get("message", create_res.text) if create_res.content else create_res.text
                        self.log(f"[ERROR] Failed to create new cart: {err_msg}")
                        return False
            else:
                self.log(f"[ERROR] Failed to query carts table: Status {cart_res.status_code}")
                return False
            
            # 2. Register device securely via API (with fallback to RPC)
            self.log(f"[*] Registering device '{self.asset_tag}' (Number {self.device_num}) securely...")
            
            api_url = getattr(self, "api_base_url", None) or "https://school-cart-manager.vercel.app/api/agent"
            if api_url:
                try:
                    api_payload = {
                        "endpoint": "register_device",
                        "assetTag": self.asset_tag,
                        "cartId": cart_uuid,
                        "deviceNumber": int(self.device_num)
                    }
                    api_res = requests.post(api_url, json=api_payload, timeout=8, verify=False)
                    if api_res.status_code == 200 and api_res.json().get("success"):
                        self.log(f"[OK] Device successfully registered in database via API!")
                        return True
                except Exception as api_err:
                    self.log(f"[*] API register fallback to RPC: {api_err}")

            rpc_device_payload = {
                "p_asset_tag": self.asset_tag,
                "p_cart_id": cart_uuid,
                "p_device_number": int(self.device_num)
            }
            
            device_res = requests.post(f"{self.sb_url}/rest/v1/rpc/register_device_securely", json=rpc_device_payload, headers=headers, timeout=5, verify=False)
            
            if device_res.status_code == 200 and device_res.json() is True:
                return True
            else:
                err_msg = device_res.json().get("message", device_res.text) if device_res.content else device_res.text
                self.log(f"[ERROR] Failed to register device in database: {err_msg}")
                return False
                
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
                subprocess.run([inst_path, "/install"], cwd=local_dir, capture_output=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
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
            res = subprocess.run(["powershell", "-Command", "(Get-CimInstance Win32_ComputerSystem).UserName"], capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
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
            raise RuntimeError(f"שגיאה קריטית ברישום מפתח ה-Shell Watchdog במערכת: {ex}")

    def _show_finish_dialog(self, needs_reboot):
        if needs_reboot:
            ans = messagebox.askyesno(
                "התקנה הושלמה בהצלחה!", 
                "התוכנה הותקנה בהצלחה!\n\nלצורך הפעלת דרייבר ההגנה החדש ברמת הקרנל,\nחובה לבצע הפעלה מחדש (Reboot) למחשב.\n\nהאם ברצונך לבצע הפעלה מחדש של המחשב כעת?"
            )
            if ans:
                subprocess.run(["shutdown", "/r", "/t", "0"], creationflags=subprocess.CREATE_NO_WINDOW)
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
    # Check if already installed before UAC prompt
    installed_path = r"C:\Program Files\CartAgent\cart_agent.exe"
    if os.path.exists(installed_path):
        root = tk.Tk()
        root.withdraw()
        ans = messagebox.askyesno(
            "עדכון גרסה",
            "מערכת CartAgent כבר מותקנת על מחשב זה.\n\nהאם ברצונך לבצע עדכון גרסה / התקנה מחדש?"
        )
        if not ans:
            sys.exit(0)

    # Request Admin elevation right at start
    if not ctypes.windll.shell32.IsUserAnAdmin():
        ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, " ".join(sys.argv), None, 1)
        sys.exit(0)

    app = InstallerGUI()
    app.run()
