package com.example.cartkiosk

import android.os.Bundle
import android.view.View
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.view.WindowManager

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var batteryReceiver: BroadcastReceiver? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT

        // 0. Advanced Lock Screen Bypass (Keyguard Dismiss)
        try {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            keyguardManager.requestDismissKeyguard(this, null)
        } catch (e: Exception) {
            android.util.Log.e("Kiosk", "Failed to setup keyguard dismiss: ${e.message}")
        }

        // 1. Enable Fullscreen Immersive Mode using modern WindowCompat APIs
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        // Start dynamic battery monitoring for screen wake control
        registerBatteryMonitor()

        // 2. Initialize and Configure WebView
        webView = WebView(this).apply {
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                    // Force opening links inside the WebView, never escape to external browser
                    return false
                }

                @Deprecated("Deprecated in Java")
                override fun onReceivedError(
                    view: WebView?,
                    errorCode: Int,
                    description: String?,
                    failingUrl: String?
                ) {
                    super.onReceivedError(view, errorCode, description, failingUrl)
                    android.widget.Toast.makeText(
                        this@MainActivity,
                        "שגיאת טעינה: $description",
                        android.widget.Toast.LENGTH_LONG
                    ).show()
                }

                override fun onReceivedSslError(
                    view: WebView?,
                    handler: android.webkit.SslErrorHandler?,
                    error: android.net.http.SslError?
                ) {
                    // Proceed on SSL errors (e.g. self-signed certificates or proxy configurations)
                    handler?.proceed()
                }
            }
            
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                    android.util.Log.d("WebViewConsole", consoleMessage?.message() ?: "")
                    return true
                }

                override fun onPermissionRequest(request: android.webkit.PermissionRequest?) {
                    request?.grant(request.resources)
                }
            }

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true   // Required for LocalStorage caching
                databaseEnabled = true     // Required for modern React/IndexedDB state engines
                allowFileAccess = true
                allowContentAccess = true
                useWideViewPort = false
                loadWithOverviewMode = false
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }

            // Load the school cart manager station loan interface
            loadUrl("https://school-cart-manager.vercel.app/station")
        }

        setContentView(webView)

        // 3. Authorized Kiosk Mode Setup (Device Owner Lock Task Mode)
        try {
            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val adminName = ComponentName(this, KioskDeviceAdminReceiver::class.java)
            
            if (dpm.isDeviceOwnerApp(packageName)) {
                // 3a. Auto-grant Camera permission so the user never sees a system dialog prompt
                try {
                    dpm.setPermissionGrantState(
                        adminName,
                        packageName,
                        android.Manifest.permission.CAMERA,
                        DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED
                    )
                } catch (e: Exception) {
                    android.util.Log.e("Kiosk", "Failed to grant camera permission: ${e.message}")
                }

                // 3b. Whitelist our package for locking
                dpm.setLockTaskPackages(adminName, arrayOf(packageName))
                
                // 3c. Configure lock task features to completely disable recent apps and notification pull-down
                try {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                        // Value 0 disables Home, Overview (Recent Apps), Notifications, Keyguard, and all global actions.
                        dpm.setLockTaskFeatures(adminName, 0)
                    }
                } catch (e: Exception) {}

                // 3d. Disable system UI status bar expansion
                try {
                    dpm.setStatusBarDisabled(adminName, true)
                } catch (e: Exception) {}
                
                // 3e. Disable keyguard lock screen features
                try {
                    dpm.setKeyguardDisabled(adminName, true)
                } catch (e: Exception) {}
                
                // 3f. Disable physical volume adjustments completely
                try {
                    dpm.addUserRestriction(adminName, android.os.UserManager.DISALLOW_ADJUST_VOLUME)
                } catch (e: Exception) {}

                // 3g. Lock the tablet to this app
                startLockTask()
            }
        } catch (e: Exception) {}

        // 4. Fallback Runtime Camera Permission Request (Ensures absolute reliability)
        try {
            if (checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(android.Manifest.permission.CAMERA), 101)
            }
        } catch (e: Exception) {}

        // 5. Prevent Back Button Exit (Secure Kiosk Mode - 100% blocked under all circumstances to lock cart view)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Do nothing, absolutely blocking back button and back gestures
            }
        })
    }

    private fun registerBatteryMonitor() {
        batteryReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent == null) return
                
                val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                if (level != -1 && scale != -1) {
                    val batteryPct = level * 100 / scale.toFloat()
                    
                    if (batteryPct >= 10.0f) {
                        // Keep screen on continuously when battery >= 10%
                        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        android.util.Log.d("KioskBattery", "Battery is $batteryPct%. Keeping screen awake.")
                    } else {
                        // Allow screen to turn off when battery < 10%
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        android.util.Log.w("KioskBattery", "Battery is low ($batteryPct%). Allowing screen sleep.")
                    }
                }
            }
        }
        registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    }

    override fun onDestroy() {
        super.onDestroy()
        batteryReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (e: Exception) {}
        }
    }

    override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean {
        val keyCode = event.keyCode
        if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP || 
            keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN) {
            // Consume physical volume key presses so they do absolutely nothing
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            // Re-apply immersive fullscreen mode when window regains focus
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            controller.hide(WindowInsetsCompat.Type.systemBars())
        }
    }
}
