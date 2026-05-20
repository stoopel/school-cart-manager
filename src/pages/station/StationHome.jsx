import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TakeLaptop   from './TakeLaptop'
import ReturnLaptop from './ReturnLaptop'
import './station.css'

export default function StationHome() {
  const { cartId } = useParams()
  const [cart, setCart]   = useState(null)
  const [stats, setStats] = useState({ available: 0, taken: 0 })
  const [mode, setMode]   = useState(null)   // null | 'take' | 'return'
  const [clock, setClock] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    loadCart()
    const interval = setInterval(loadStats, 30000)

    const channel = supabase
      .channel('station-home-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_loans' }, () => {
        loadStats()
      })
      .subscribe()

    return () => {
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [cartId])

  async function loadCart() {
    if (cartId) {
      const { data } = await supabase.from('carts').select('*').eq('id', cartId).single()
      setCart(data)
    } else {
      // If no cartId, load first cart
      const { data } = await supabase.from('carts').select('*').order('name').limit(1).single()
      setCart(data)
    }
    loadStats()
  }

  async function loadStats() {
    if (!cart && !cartId) return
    const id = cartId || cart?.id
    if (!id) return
    const { data } = await supabase.from('cart_status').select('*').eq('id', id).single()
    if (data) setStats({ available: data.available_devices ?? 0, taken: data.active_loans ?? 0 })
  }

  useEffect(() => { if (cart) loadStats() }, [cart])

  function onDone() {
    setMode(null)
    loadStats()
  }

  const timeStr = clock.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  const dateStr = clock.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })

  if (mode === 'take')   return <TakeLaptop cart={cart} onDone={onDone} />
  if (mode === 'return') return <ReturnLaptop cart={cart} onDone={onDone} />

  return (
    <div className="station-root">
      {/* Header */}
      <div className="station-header">
        <div className="station-school">🏫 {cart ? (cart.display_name || cart.name) : 'תחנת עגלה'}</div>
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
