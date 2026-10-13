import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function FocusInput({ label, type, value, onChange, placeholder, required = false, autoFocus = false }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <label style={{
        fontSize: '0.85rem',
        fontWeight: 600,
        color: focused ? '#f59e0b' : '#94a3b8',
        transition: 'color 0.2s',
        display: 'flex',
        justifyContent: 'space-between'
      }}>
        <span>{label}</span>
        {required && <span style={{ color: '#ef4444', fontSize: '0.8rem' }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          background: 'rgba(255,255,255,0.03)',
          border: focused ? '1.5px solid #f59e0b' : '1.5px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: '12px 14px',
          color: '#f1f5f9',
          fontSize: '0.95rem',
          boxSizing: 'border-box',
          outline: 'none',
          fontFamily: 'Heebo, sans-serif',
          transition: 'all 0.25s ease-in-out',
          textAlign: 'right',
          boxShadow: focused ? '0 0 10px rgba(245,158,11,0.2)' : 'none'
        }}
      />
    </div>
  )
}

export default function AdminLogin({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isApproved, setIsApproved] = useState(false)
  const [checkingApproval, setCheckingApproval] = useState(true)
  const [user, setUser] = useState(null)
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  async function verifyApproval(sessionUser) {
    if (!sessionUser) {
      setIsAuthenticated(false)
      setIsApproved(false)
      setUser(null)
      setCheckingApproval(false)
      return
    }

    setUser(sessionUser)
    setIsAuthenticated(true)
    setCheckingApproval(true)

    try {
      const { data: approved, error: rpcErr } = await supabase.rpc('is_admin_approved')
      if (!rpcErr && typeof approved === 'boolean') {
        setIsApproved(approved)
      } else {
        // Fallback: בדיקה ישירה מול טבלת allowed_admins
        const userEmail = (sessionUser.email || '').trim().toLowerCase()
        const { data: checkData } = await supabase
          .from('allowed_admins')
          .select('email')
          .ilike('email', userEmail)
          .maybeSingle()
        setIsApproved(Boolean(checkData))
      }
    } catch (err) {
      console.error('Error verifying admin approval:', err)
      setIsApproved(false)
    } finally {
      setCheckingApproval(false)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        verifyApproval(session.user)
      } else {
        setCheckingApproval(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        verifyApproval(session.user)
      } else {
        setIsAuthenticated(false)
        setIsApproved(false)
        setUser(null)
        setCheckingApproval(false)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccessMsg('')
    setLoading(true)

    try {
      if (mode === 'login') {
        const { data, error: loginErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        })
        if (loginErr) {
          setError(loginErr.message === 'Invalid login credentials' ? 'אימייל או סיסמה שגויים' : loginErr.message)
        } else if (data?.user) {
          await verifyApproval(data.user)
        }
      } else {
        if (!name.trim()) {
          setError('נא להזין שם מלא')
          setLoading(false)
          return
        }
        const { data, error: signupErr } = await supabase.auth.signUp({
          email: email.trim(),
          password: password,
          options: {
            data: {
              name: name.trim(),
            }
          }
        })
        if (signupErr) {
          setError(signupErr.message)
        } else {
          setSuccessMsg('ההרשמה נקלטה בהצלחה! חשבונך נוצר וממתין לאישור מנהל המערכת הראשי.')
          setPassword('')
          if (data?.user) {
            await verifyApproval(data.user)
          }
        }
      }
    } catch (err) {
      setError(err.message || 'אירעה שגיאה בלתי צפויה')
    } finally {
      setLoading(false)
    }
  }

  // 1. מצב בדיקת הרשאות בטעינה
  if (checkingApproval && isAuthenticated) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#060d1f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Heebo, sans-serif',
        direction: 'rtl',
        color: '#f1f5f9'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>🛡️</div>
          <h3 style={{ margin: 0, fontWeight: 700, fontSize: '1.25rem', color: '#f59e0b' }}>בודק הרשאות ניהול...</h3>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: 8 }}>מאמת את חשבונך מול רשימת המנהלים המורשים</p>
        </div>
      </div>
    )
  }

  // 2. משתמש מחובר ומאושר -> כניסה לממשק הניהול
  if (isAuthenticated && isApproved) {
    return children
  }

  // 3. משתמש מחובר אך אינו מאושר עדיין -> מסך המתנה לאישור
  if (isAuthenticated && !isApproved) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#060d1f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Heebo, sans-serif',
        direction: 'rtl',
        padding: 24,
      }}>
        <div style={{
          background: '#0d1526',
          border: '1.5px solid rgba(245,158,11,0.4)',
          borderRadius: 24,
          padding: '40px 32px',
          width: '100%',
          maxWidth: 440,
          boxShadow: '0 12px 40px rgba(245,158,11,0.15)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '3.5rem', marginBottom: 16 }}>⏳</div>
          <h2 style={{ color: '#f1f5f9', margin: '0 0 10px', fontSize: '1.5rem', fontWeight: 800 }}>
            חשבונך ממתין לאישור מנהל
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', margin: '0 0 24px', lineHeight: 1.5 }}>
            ההרשמה נקלטה בהצלחה במערכת, אך טרם הוענקה לך הרשאת ניהול פעילה.
          </p>

          <div style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
            borderRadius: 14,
            padding: '16px',
            marginBottom: 24,
            textAlign: 'right',
            fontSize: '0.9rem',
            color: '#e2e8f0',
            lineHeight: 1.6
          }}>
            <div><strong>משתמש:</strong> {user?.user_metadata?.name || 'מנהל חדש'}</div>
            <div><strong>אימייל:</strong> {user?.email}</div>
            <div style={{ marginTop: 8, color: '#f59e0b', fontWeight: 600 }}>
              🛡️ סטטוס: ממתין לאישור המנהל הראשי (Pending Approval)
            </div>
          </div>

          <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 24px', lineHeight: 1.5 }}>
            נא לפנות למנהל המערכת הראשי של בית הספר ולבקש ממנו להוסיף את כתובת המייל שלך ברשימת <strong>"מנהלים מורשים"</strong>.
          </p>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={() => verifyApproval(user)}
              style={{
                flex: 1,
                padding: '12px 0',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
                fontFamily: 'Heebo, sans-serif'
              }}
            >
              🔄 בדוק שוב
            </button>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              style={{
                flex: 1,
                padding: '12px 0',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.05)',
                color: '#94a3b8',
                fontWeight: 600,
                fontSize: '0.95rem',
                cursor: 'pointer',
                fontFamily: 'Heebo, sans-serif'
              }}
            >
              🚪 התנתק
            </button>
          </div>
        </div>
      </div>
    )
  }

  // 4. מסך התחברות / רישום רגיל
  return (
    <div style={{
      minHeight: '100vh',
      background: '#060d1f',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Heebo, sans-serif',
      direction: 'rtl',
      padding: 24,
    }}>
      <div style={{
        background: '#0d1526',
        border: '1.5px solid rgba(245,158,11,0.3)',
        borderRadius: 24,
        padding: '36px 32px',
        width: '100%',
        maxWidth: 400,
        boxShadow: '0 12px 40px rgba(245,158,11,0.15)',
        transition: 'all 0.3s ease-in-out',
      }}>
        {/* לוגו כותרת */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🛡️</div>
          <h2 style={{ color: '#f1f5f9', margin: 0, fontSize: '1.6rem', fontWeight: 800 }}>ממשק ניהול עגלות</h2>
          <p style={{ color: '#94a3b8', margin: '8px 0 0', fontSize: '0.9rem' }}>
            {mode === 'login' ? 'התחבר לחשבון מנהל כדי להמשיך' : 'רישום חשבון מנהל חדש (ממתין לאישור)'}
          </p>
        </div>

        {/* טאבים למעבר בין התחברות להרשמה */}
        <div style={{
          display: 'flex',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 12,
          padding: 4,
          marginBottom: 24,
          border: '1px solid rgba(255,255,255,0.06)'
        }}>
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); setSuccessMsg(''); }}
            style={{
              flex: 1,
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              background: mode === 'login' ? '#f59e0b' : 'transparent',
              color: mode === 'login' ? '#fff' : '#94a3b8',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
              fontFamily: 'Heebo, sans-serif'
            }}
          >
            🔑 התחברות
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(''); setSuccessMsg(''); }}
            style={{
              flex: 1,
              padding: '10px 0',
              borderRadius: 8,
              border: 'none',
              background: mode === 'signup' ? '#f59e0b' : 'transparent',
              color: mode === 'signup' ? '#fff' : '#94a3b8',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: 'pointer',
              transition: 'all 0.2s',
              fontFamily: 'Heebo, sans-serif'
            }}
          >
            📝 רישום מנהל
          </button>
        </div>

        {/* טופס */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {mode === 'signup' && (
            <FocusInput
              label="שם מלא"
              type="text"
              required={true}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="ישראל ישראלי"
            />
          )}

          <FocusInput
            label="כתובת אימייל"
            type="email"
            required={true}
            autoFocus={mode === 'login'}
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="admin@school.org"
          />

          <FocusInput
            label="סיסמה"
            type="password"
            required={true}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          
          {error && (
            <div style={{
              color: '#fca5a5',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.2)',
              padding: '10px 12px',
              borderRadius: 10,
              textAlign: 'center',
              fontSize: '0.9rem',
              lineHeight: 1.4
            }}>
              ⚠️ {error}
            </div>
          )}

          {successMsg && (
            <div style={{
              color: '#a7f3d0',
              background: 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.2)',
              padding: '10px 12px',
              borderRadius: 10,
              textAlign: 'center',
              fontSize: '0.9rem',
              lineHeight: 1.4
            }}>
              ✅ {successMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px 0',
              borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#fff',
              fontWeight: 800,
              fontSize: '1rem',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(245,158,11,0.2)',
              transition: 'all 0.2s',
              fontFamily: 'Heebo, sans-serif',
              marginTop: 8
            }}
          >
            {loading ? '⏳ מבצע פעולה...' : mode === 'login' ? 'התחבר למערכת' : 'צור חשבון מנהל (ממתין לאישור)'}
          </button>
        </form>
      </div>
    </div>
  )
}
