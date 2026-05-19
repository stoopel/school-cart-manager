"""
watchdog.py - Mutual watchdog for CartAgent.
Keeps cart_agent.exe running and exits gracefully when uninstalling.lock is detected.
"""

import os
import sys
import time
import subprocess

LOCK_FILE = r"C:\Program Files\CartAgent\uninstalling.lock"
AGENT_PATH = r"C:\Program Files\CartAgent\cart_agent.exe"

def is_agent_running():
    try:
        r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq cart_agent.exe"], capture_output=True, text=True)
        return "cart_agent.exe" in r.stdout
    except Exception:
        return True # Fallback to true to prevent infinite spawn storm on error

def main():
    # Loop indefinitely
    while True:
        # 1. Exit if the uninstallation lock file exists
        if os.path.exists(LOCK_FILE):
            sys.exit(0)

        # 2. Check if cart_agent.exe is running, if not - launch it
        if not is_agent_running():
            if os.path.exists(AGENT_PATH):
                try:
                    subprocess.Popen([AGENT_PATH], cwd=os.path.dirname(AGENT_PATH))
                except Exception:
                    pass

        # Wait 2 seconds before the next check
        time.sleep(2)

if __name__ == "__main__":
    main()
