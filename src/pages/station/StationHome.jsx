import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TakeLaptop   from './TakeLaptop'
import ReturnLaptop from './ReturnLaptop'
import './station.css'

export default function StationHome() {
  const { cartId } = useParams()
  const navigate = useNavigate()
  
  const [cartsList, setCartsList] = useState([])
  const [cart, setCart] = useState(null)
  const [stats, setStats] = useState({ available: 0, taken: 0 })
  const [mode, setMode] = useState(null)   // null | 'take' | 'return'
  const [clock, setClock] = useState(new Date())

  // Kiosk Authentication State
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [passcode, setPasscode] = useState('')
  const [authError, setAuthError] = useState('')

  // 1. Clock timer
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // 2. Load list of active carts
  useEffect(() => {
    loadCartsList()
  }, [])

  async function loadCartsList() {
    const { data } = await supabase
      .from('carts')
      .select('id, name, display_name, location')
      .is('deleted_at', null)
      .order('name')
    setCartsList(data ?? [])
  }

  // 3. Handle cart loading & validation when cartId changes
  useEffect(() => {
    validateAndLoadCart()
  }, [cartId])

  async function validateAndLoadCart() {
    if (!cartId) {
      setCart(null)
      setIsAuthorized(false)
      setAuthLoading(false)
      return
    }

    setAuthLoading(true)
    setAuthError('')

    // Fetch cart details
    const { data: cartData, error } = await supabase
      .from('carts')
      .select('id, name, display_name, location, allow_manual_entry, enable_charge_tracking')
      .eq('id', cartId)
      .is('deleted_at', null)
      .single()

    if (error || !cartData) {
      setCart(null)
      setIsAuthorized(false)
      setAuthLoading(false)
      setAuthError('עגלה לא נמצאה')
      return
    }

    setCart(cartData)

    // Check LocalStorage auth code
    const auths = JSON.parse(localStorage.getItem('kiosk_auths') || '{}')
    const storedCode = auths[cartId]

    if (!storedCode) {
      setIsAuthorized(false)
      setAuthLoading(false)
      return
    }

    // Validate the stored code against the database via RPC
    const { data: isValid } = await supabase.rpc('verify_kiosk_code', {
      p_cart_id: cartId,
      p_code: storedCode
    })

    if (isValid) {
      setIsAuthorized(true)
    } else {
      // Stored token is invalid (changed by admin), clean up
      delete auths[cartId]
      localStorage.setItem('kiosk_auths', JSON.stringify(auths))
      setIsAuthorized(false)
    }
    setAuthLoading(false)
  }

  // Realtime subscription for stats update
  useEffect(() => {
    if (!cart) return
    loadStats()

    const interval = setInterval(loadStats, 30000)

    const channel = supabase
      .channel(`station-home-realtime-${cart.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_loans' }, () => {
        loadStats()
      })
      .subscribe()

    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [cart])

  async function loadStats() {
    if (!cart) return
    const { data } = await supabase
      .from('cart_status')
      .select('*')
      .eq('id', cart.id)
      .single()
    if (data) {
      setStats({
        available: data.available_devices ?? 0,
        taken: data.active_loans ?? 0
      })
    }
  }

  // Validate entered passcode
  async function handleVerifyAuth(e) {
    if (e) e.preventDefault()
    if (passcode.length < 4) return

    setAuthLoading(true)
    setAuthError('')

    const { data: isValid, error } = await supabase.rpc('verify_kiosk_code', {
      p_cart_id: cart.id,
      p_code: passcode
    })

    if (error) {
      setAuthError('שגיאה בחיבור לשרת: ' + error.message)
      setAuthLoading(false)
      return
    }

    if (isValid) {
      // Save in localStorage
      const auths = JSON.parse(localStorage.getItem('kiosk_auths') || '{}')
      auths[cart.id] = passcode
      localStorage.setItem('kiosk_auths', JSON.stringify(auths))

      setIsAuthorized(true)
      setPasscode('')
    } else {
      setAuthError('קוד גישה שגוי. אנא נסה שוב.')
      setPasscode('')
    }
    setAuthLoading(false)
  }

  // Keypad click handlers
  function handleKeyPress(num) {
    setAuthError('')
    if (passcode.length < 6) {
      setPasscode(passcode + num)
    }
  }

  function handleBackspace() {
    setPasscode(passcode.slice(0, -1))
  }

  function handleClear() {
    setPasscode('')
  }

  // Auto-submit when passcode length is 4 or more
  useEffect(() => {
    if (passcode.length >= 4 && cart) {
      handleVerifyAuth()
    }
  }, [passcode])

  function onDone() {
    setMode(null)
    loadStats()
  }

  function handleLogoutStation() {
    if (!confirm('האם לנתק תחנה זו? יהיה צורך להזין את קוד הקיוסק מחדש.')) return
    if (cart) {
      const auths = JSON.parse(localStorage.getItem('kiosk_auths') || '{}')
      delete auths[cart.id]
      localStorage.setItem('kiosk_auths', JSON.stringify(auths))
    }
    setIsAuthorized(false)
  }

  const timeStr = clock.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  const dateStr = clock.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

  // 1. Loading Screen
  if (authLoading && !passcode) {
    return (
      <div className="station-root" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ borderTopColor: 'var(--station-accent)', width: 50, height: 50 }} />
        <div style={{ color: 'var(--station-text)', marginTop: 20, fontSize: '1.1rem', fontWeight: 600 }}>אנא המתן, בודק אבטחה...</div>
      </div>
    )
  }

  // 2. Select Cart Screen (if no cartId in URL)
  if (!cartId) {
    return (
      <div className="station-root" style={{ padding: 40, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: '4rem', marginBottom: 12 }}>🏫</div>
          <h1 style={{ color: 'var(--station-text)', fontSize: '2.4rem', fontWeight: 900, marginBottom: 8 }}>בחירת עגלת מחשבים</h1>
          <p style={{ color: 'var(--station-muted)', fontSize: '1.1rem' }}>בחר את העגלה הפיזית המשויכת לעמדה זו כדי לפתוח את הקיוסק</p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 20,
          width: '100%',
          maxWidth: 900,
          justifyContent: 'center'
        }}>
          {cartsList.map(c => (
            <button
              key={c.id}
              onClick={() => navigate(`/station/${c.id}`)}
              style={{
                background: 'var(--station-card)',
                border: '2px solid var(--station-border)',
                borderRadius: 20,
                padding: '24px 30px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.25s',
                fontFamily: 'inherit',
              }}
              onMouseOver={e => {
                e.currentTarget.style.borderColor = 'var(--station-accent)';
                e.currentTarget.style.transform = 'translateY(-3px)';
              }}
              onMouseOut={e => {
                e.currentTarget.style.borderColor = 'var(--station-border)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{ fontSize: '3rem', marginBottom: 16 }}>🛒</div>
              <h3 style={{ color: 'var(--station-text)', fontSize: '1.4rem', margin: '0 0 8px 0', fontWeight: 800 }}>{c.display_name || c.name}</h3>
              {c.location && <p style={{ color: 'var(--station-muted)', margin: 0, fontSize: '0.9rem' }}>📍 {c.location}</p>}
            </button>
          ))}

          {cartsList.length === 0 && (
            <div className="empty-state" style={{ gridColumn: '1/-1', background: 'var(--station-card)', border: '1px dashed var(--station-border)', borderRadius: 20, padding: 40 }}>
              <div className="empty-icon">🛒</div>
              <p style={{ color: 'var(--station-text)' }}>לא נמצאו עגלות פעילות במערכת.</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 3. Cart selected but NOT Authorized (Show Passcode screen)
  if (!isAuthorized) {
    return (
      <div className="station-root" style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>


        <div className="station-panel" style={{ maxWidth: 400, boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: '3.5rem', marginBottom: 12 }}>🛡️</div>
            <h2 style={{ color: 'var(--station-text)', fontSize: '1.6rem', fontWeight: 800, margin: 0 }}>אימות קוד קיוסק</h2>
            <p style={{ color: 'var(--station-muted)', fontSize: '0.9rem', marginTop: 8 }}>
              עבור עגלה: <strong>{cart?.display_name || cart?.name}</strong>
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Dots Display */}
            <div style={{
              display: 'flex', justifyContent: 'center', gap: 16,
              background: 'rgba(255,255,255,0.03)', border: '1.5px solid var(--station-border)',
              borderRadius: 16, padding: '20px 0', minHeight: 70, boxSizing: 'border-box'
            }}>
              {[...Array(4)].map((_, i) => (
                <div 
                  key={i} 
                  style={{
                    width: 16, height: 16, borderRadius: '50%',
                    background: i < passcode.length ? 'var(--station-warning)' : 'rgba(255,255,255,0.1)',
                    boxShadow: i < passcode.length ? '0 0 10px var(--station-warning)' : 'none',
                    transition: 'all 0.15s ease'
                  }} 
                />
              ))}
            </div>

            {authError && (
              <div className="station-error" style={{ fontSize: '0.85rem', padding: '10px 16px' }}>
                ⚠️ {authError}
              </div>
            )}

            {/* Custom Numpad */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleKeyPress(String(num))}
                  className="station-key"
                  style={{ padding: '16px 0', fontSize: '1.6rem' }}
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={handleClear}
                className="station-key delete"
                style={{ padding: '16px 0', fontSize: '1.1rem', color: 'var(--station-danger)' }}
              >
                נקה
              </button>
              <button
                type="button"
                onClick={() => handleKeyPress('0')}
                className="station-key"
                style={{ padding: '16px 0', fontSize: '1.6rem' }}
              >
                0
              </button>
              <button
                type="button"
                onClick={handleBackspace}
                className="station-key delete"
                style={{ padding: '16px 0', fontSize: '1.5rem', color: 'var(--station-muted)' }}
              >
                ⌫
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 4. Cart selected AND Authorized (Show main Kiosk portal)
  if (mode === 'take')   return <TakeLaptop cart={cart} onDone={onDone} />
  if (mode === 'return') return <ReturnLaptop cart={cart} onDone={onDone} />

  return (
    <div className="station-root">
      {/* Header */}
      <div className="station-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div className="station-school">🏫 {cart ? (cart.display_name || cart.name) : 'תחנת עגלה'}</div>
        </div>
        <div className="station-clock">
          <div className="station-time">{timeStr}</div>
          <div className="station-date">{dateStr}</div>
        </div>
      </div>

      {/* Main */}
      <div className="station-main">
        <div className="station-welcome">
          <h1>ברוכים הבאים!</h1>
          <p>לפני לקיחת מחשב יש להירשם</p>
        </div>

        <div className="station-actions">
          <button className="station-btn station-btn-take" onClick={() => setMode('take')}>
            <span className="station-btn-icon">📥</span>
            <span className="station-btn-label">לקחתי מחשב</span>
            <span className="station-btn-sub">רישום והזדהות</span>
          </button>

          <button className="station-btn station-btn-return" onClick={() => setMode('return')}>
            <span className="station-btn-icon">📤</span>
            <span className="station-btn-label">החזרתי מחשב</span>
            <span className="station-btn-sub">סריקת QR / מספר</span>
          </button>
        </div>
      </div>

      {/* Footer stats */}
      <div className="station-footer">
        <div className="station-stat">
          <span className="station-stat-value" style={{ color: 'var(--station-success)' }}>{stats.available}</span>
          <span className="station-stat-label">זמינים</span>
        </div>
        <div className="station-stat-divider" />
        <div className="station-stat">
          <span className="station-stat-value" style={{ color: 'var(--station-warning)' }}>{stats.taken}</span>
          <span className="station-stat-label">נלקחו</span>
        </div>
      </div>
    </div>
  )
}
