import { useState, useEffect } from 'react'

const HASH = 'f96c3d3bfe0eca46ca7325b995097087dd68ea6d06f9c1fd914d78704db9bea5'

export default function AdminLogin({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // בודקים אם יש כבר סשן פעיל כשהרכיב נטען
  useEffect(() => {
    if (sessionStorage.getItem('adminAuth') === 'true') {
      setIsAuthenticated(true)
    }
  }, [])

  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message)
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const inputHash = await sha256(password)
    
    if (inputHash === HASH) {
      sessionStorage.setItem('adminAuth', 'true')
      setIsAuthenticated(true)
    } else {
      setError('סיסמה שגויה')
      setPassword('')
    }
    
    setLoading(false)
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
        border: '1px solid rgba(245,158,11,0.3)',
        borderRadius: 24,
        padding: 40,
        width: '100%',
        maxWidth: 400,
        boxShadow: '0 8px 32px rgba(245,158,11,0.1)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔒</div>
          <h2 style={{ color: '#f1f5f9', margin: 0, fontSize: '1.5rem' }}>ממשק ניהול סגור</h2>
          <p style={{ color: '#94a3b8', margin: '8px 0 0', fontSize: '0.9rem' }}>הזן סיסמת מנהל כדי להמשיך</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="סיסמה..."
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.05)',
              border: '1.5px solid rgba(245,158,11,0.3)',
              borderRadius: 12,
              padding: '14px 16px',
              color: '#f1f5f9',
              fontSize: '1rem',
              boxSizing: 'border-box',
              outline: 'none',
              textAlign: 'center',
              letterSpacing: '0.2em'
            }}
          />
          
          {error && (
            <div style={{
              color: '#fca5a5',
              background: 'rgba(239,68,68,0.1)',
              padding: '8px 12px',
              borderRadius: 8,
              textAlign: 'center',
              fontSize: '0.9rem'
            }}>
              {error}
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
              background: '#f59e0b',
              color: '#fff',
              fontWeight: 700,
              fontSize: '1rem',
              cursor: 'pointer',
            }}
          >
            {loading ? 'בודק...' : 'היכנס למערכת'}
          </button>
        </form>
      </div>
    </div>
  )
}
