import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function FocusInput({ label, type, required, value, onChange, placeholder, autoFocus }) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.85rem', marginBottom: 6, fontWeight: 600 }}>{label}</label>
      <input
        type={type}
        required={required}
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          background: 'rgba(255,255,255,0.04)',
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
  const [user, setUser] = useState(null)
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  // מאזינים לשינויים במצב החיבור של Supabase
  useEffect(() => {
    // בדיקה ראשונית של סשן קיים
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setIsAuthenticated(true)
        setUser(session.user)
      }
    })

    // האזנה לשינויים עתידיים (חיבור, התנתקות וכו')
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setIsAuthenticated(true)
        setUser(session.user)
      } else {
        setIsAuthenticated(false)
        setUser(null)
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
          setSuccessMsg('מנהל נרשם בהצלחה! כעת ניתן להתחבר.')
          // מעביר אוטומטית למצב התחברות ומנקה סיסמה
          setMode('login')
          setPassword('')
        }
      }
    } catch (err) {
      setError(err.message || 'אירעה שגיאה בלתי צפויה')
    } finally {
      setLoading(false)
    }
  }

  if (isAuthenticated) {
    return children
  }

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
            {mode === 'login' ? 'התחבר לחשבון מנהל כדי להמשיך' : 'רישום חשבון מנהל חדש במערכת'}
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
            {loading ? '⏳ מבצע פעולה...' : mode === 'login' ? 'התחבר למערכת' : 'צור חשבון מנהל'}
          </button>
        </form>
      </div>
    </div>
  )
}
