import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../../lib/supabase'

const STEPS = { SCAN: 'scan', CONFIRM: 'confirm', SUCCESS: 'success' }

export default function ReturnLaptop({ cart, onDone }) {
  const [step, setStep]         = useState(STEPS.SCAN)
  const [scanMode, setScanMode] = useState('qr')
  const [loan, setLoan]         = useState(null)
  const [device, setDevice]     = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [devices, setDevices]   = useState([])
  const scannerRef = useRef(null)

  useEffect(() => {
    if (cart?.allow_manual_entry === false && scanMode !== 'qr') {
      setScanMode('qr')
    }
  }, [cart, scanMode])

  useEffect(() => {
    if (cart) {
      loadDevices()

      // Realtime subscription to refresh device return availability status in real-time
      const channel = supabase
        .channel(`return-realtime-${cart.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'device_loans' }, () => {
          loadDevices()
        })
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }
  }, [cart])

  async function loadDevices() {
    const { data: devs } = await supabase
      .from('devices')
      .select('*')
      .eq('cart_id', cart.id)
      .is('deleted_at', null)
      .order('device_number')

    const { data: activeLoans } = await supabase
      .from('device_loans')
      .select('device_id')
      .eq('status', 'active')
      .is('checkin_at', null)

    const activeLoanIds = new Set(activeLoans?.map(l => l.device_id) ?? [])

    setDevices((devs ?? []).map(d => ({
      ...d,
      isBorrowed: activeLoanIds.has(d.id)
    })))
  }

  // QR Scanner – מצלמה קדמית (facingMode: user) לטאבלט מורכב על קיר
  useEffect(() => {
    if (step !== STEPS.SCAN || scanMode !== 'qr') return
    const qrCode = new Html5Qrcode('qr-reader-return')
    scannerRef.current = qrCode
    qrCode.start(
      { facingMode: 'user' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      async (decodedText) => {
        if (scannerRef.current) {
          try {
            await scannerRef.current.stop()
          } catch (e) {
            console.error('Error stopping scanner inside success callback:', e)
          }
          scannerRef.current = null
        }
        onQRSuccess(decodedText)
      },
      () => {} // שגיאות סריקה – מתעלמים
    ).catch(err => console.error('Camera error:', err))
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {})
        scannerRef.current = null
      }
    }
  }, [step, scanMode])

  async function onQRSuccess(decodedText) {
    await lookupDevice(decodedText)
  }

  async function safeSetScanMode(newMode) {
    if (scanMode === 'qr' && scannerRef.current) {
      try {
        await scannerRef.current.stop()
      } catch (e) {
        console.error('Error stopping scanner on mode switch:', e)
      }
      scannerRef.current = null
    }
    setScanMode(newMode)
  }

  async function safeGoBack() {
    if (scanMode === 'qr' && scannerRef.current) {
      try {
        await scannerRef.current.stop()
      } catch (e) {
        console.error('Error stopping scanner on back action:', e)
      }
      scannerRef.current = null
    }
    onDone()
  }

  async function lookupDevice(deviceIdOrNumber) {
    setErrorMsg('')
    const isUUID = /^[0-9a-f-]{36}$/i.test(deviceIdOrNumber)
    let dev
    if (isUUID) {
      const { data } = await supabase.from('devices').select('*').eq('id', deviceIdOrNumber).eq('cart_id', cart.id).single()
      dev = data
    } else {
      const { data } = await supabase.from('devices').select('*').eq('cart_id', cart.id).eq('device_number', Number(deviceIdOrNumber)).single()
      dev = data
    }

    if (!dev) { setErrorMsg('מחשב לא נמצא בעגלה זו.'); return }

    // Find active loan
    const { data: activeLoan } = await supabase
      .from('device_loans')
      .select('*, students(name, class_name)')
      .eq('device_id', dev.id)
      .eq('status', 'active')
      .is('checkin_at', null)
      .single()

    if (!activeLoan) {
      setErrorMsg(`מחשב מס' ${dev.device_number} כבר מוחזר או לא נלקח.`)
      return
    }

    setDevice(dev)
    setLoan(activeLoan)
    setStep(STEPS.CONFIRM)
  }

  async function confirmReturn() {
    const { error } = await supabase
      .from('device_loans')
      .update({ checkin_at: new Date().toISOString(), status: 'returned', return_method: 'cart_station' })
      .eq('id', loan.id)

    if (error) { setErrorMsg('שגיאה בהחזרה. נסה שנית.'); return }
    setStep(STEPS.SUCCESS)
    setTimeout(() => onDone(), 1500)
  }

  function duration(from) {
    const mins = Math.floor((Date.now() - new Date(from)) / 60000)
    if (mins < 60) return `${mins} דקות`
    return `${Math.floor(mins/60)} שעות ו-${mins%60} דקות`
  }

  // ─── STEP: SCAN ─────────────────────────────
  if (step === STEPS.SCAN) return (
    <div className="station-flow">
      <div className="station-flow-header">
        <button className="station-back-btn" onClick={safeGoBack}>← חזרה</button>
        <span className="station-flow-title">📤 החזרת מחשב</span>
      </div>
      <div className="station-flow-body">
        {cart?.allow_manual_entry !== false && (
          <div className="flex gap-3">
            <button className={`btn ${scanMode === 'qr' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => safeSetScanMode('qr')}>📷 סריקת QR</button>
            <button className={`btn ${scanMode === 'number' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => safeSetScanMode('number')}>🔢 הקלדת מספר</button>
          </div>
        )}

        {errorMsg && <div className="station-error">{errorMsg}</div>}

        {scanMode === 'qr' ? (
          <div className="station-panel" style={{ maxWidth: 420 }}>
            <div className="station-panel-title">סרוק את ה-QR Code על המחשב המוחזר</div>
            <div className="station-qr-area">
              <div id="qr-reader-return" />
            </div>
          </div>
        ) : (
          <div className="station-panel">
            <div className="station-panel-title">בחר מספר מחשב להחזרה</div>
            <div className="station-numgrid">
              {devices.map(d => (
                <button
                  key={d.id}
                  className={`station-numkey${!d.isBorrowed ? ' returned' : ''}`}
                  onClick={() => d.isBorrowed && lookupDevice(String(d.device_number))}
                  disabled={!d.isBorrowed}
                  style={!d.isBorrowed ? { opacity: 0.4, cursor: 'not-allowed', background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.2)' } : {}}
                >
                  {d.device_number}
                  {!d.isBorrowed && <div style={{ fontSize: '0.65rem', color: '#10b981', marginTop: 2 }}>בעגלה</div>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  // ─── STEP: CONFIRM ───────────────────────────
  if (step === STEPS.CONFIRM) return (
    <div className="station-flow">
      <div className="station-flow-header">
        <button className="station-back-btn" onClick={() => { setStep(STEPS.SCAN); setLoan(null); setDevice(null); }}>← חזרה</button>
        <span className="station-flow-title">אישור החזרה</span>
      </div>
      <div className="station-flow-body">
        <div className="station-panel" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>💻</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--station-text)', marginBottom: 6 }}>
            מחשב מס' {device?.device_number}
          </div>
          <div style={{ fontSize: '1rem', color: 'var(--station-muted)', marginBottom: 24 }}>
            {cart?.display_name || cart?.name}
          </div>

          <div className="station-result-info" style={{ textAlign: 'right' }}>
            <div>👤 <strong>{loan?.students?.name}</strong> – {loan?.students?.class_name}</div>
            <div>🕐 נלקח ב-{new Date(loan?.checkout_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</div>
            <div>⏱️ משך: {duration(loan?.checkout_at)}</div>
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
            <button className="btn btn-success btn-lg" onClick={confirmReturn}>✅ אשר החזרה</button>
            <button className="btn btn-ghost btn-lg" onClick={() => { setStep(STEPS.SCAN); setLoan(null); setDevice(null); }}>ביטול</button>
          </div>
        </div>
      </div>
    </div>
  )

  // ─── STEP: SUCCESS ───────────────────────────
  if (step === STEPS.SUCCESS) return (
    <div className="station-flow">
      <div className="station-flow-body" style={{ gap: 16 }}>

        {/* Success panel */}
        <div className="station-panel">
          <div className="station-result">
            <div className="station-result-icon">✅</div>
            <div className="station-result-name">הוחזר בהצלחה!</div>
            <div className="station-result-info">
              <div>💻 מחשב מס' <strong>{device?.device_number}</strong> – {cart?.display_name || cart?.name}</div>
              <div>👤 {loan?.students?.name}</div>
              <div>⏱️ משך שימוש: {duration(loan?.checkout_at)}</div>
            </div>
          </div>
        </div>

        {/* Charging reminder – very prominent */}
        <div style={{
          background: 'linear-gradient(135deg, #f59e0b22, #f97316, #f97316, #f59e0b22)',
          border: '3px solid #f97316',
          borderRadius: 20,
          padding: '28px 24px',
          textAlign: 'center',
          animation: 'pulse 2s infinite',
        }}>
          <div style={{ fontSize: '4rem', marginBottom: 8 }}>🔌</div>
          <div style={{
            fontSize: '1.8rem', fontWeight: 900,
            color: '#fff', marginBottom: 8, lineHeight: 1.2,
          }}>
            חבר את המחשב לחשמל!
          </div>
          <div style={{ fontSize: '1.1rem', color: 'rgba(255,255,255,0.85)' }}>
            אנא חבר את כבל הטעינה עכשיו לפני שתלך
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: '0.9rem', color: 'var(--station-muted)', marginTop: 8 }}>
          חוזר לתחנה מיד...
        </div>

      </div>
    </div>
  )
}
