import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../../lib/supabase'

const STEPS = { ID: 'id', SCAN: 'scan', SUCCESS: 'success', ERROR: 'error' }

export default function TakeLaptop({ cart, reservation = null, onDone }) {
  const [step, setStep]         = useState(STEPS.ID)
  const [idValue, setIdValue]   = useState('')
  const [student, setStudent]   = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [strikeWarning, setStrikeWarning] = useState('')
  const [result, setResult]     = useState(null)
  const [scanMode, setScanMode] = useState('qr')  // 'qr' | 'number'
  const [devices, setDevices]   = useState([])
  const scannerRef = useRef(null)

  // Reservation Bypass States
  const [bypassCode, setBypassCode] = useState('')
  const [showBypassModal, setShowBypassModal] = useState(false)
  const [bypassPasscode, setBypassPasscode] = useState('')
  const [bypassError, setBypassError] = useState('')
  const [bypassLoading, setBypassLoading] = useState(false)
  const [isReservedError, setIsReservedError] = useState(false)
  const [reservedTeacherName, setReservedTeacherName] = useState('')

  useEffect(() => {
    if (cart?.allow_manual_entry === false && scanMode !== 'qr') {
      setScanMode('qr')
    }
  }, [cart, scanMode])

  useEffect(() => {
    if (cart) {
      loadDevices()

      // Realtime subscription to refresh device availability status in real-time
      const channel = supabase
        .channel(`take-realtime-${cart.id}`)
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
      isTaken: activeLoanIds.has(d.id)
    })))
  }

  // Keypad input
  function pressKey(k) {
    if (k === 'del') { setIdValue(v => v.slice(0, -1)); return }
    if (idValue.length >= 9) return
    setIdValue(v => v + k)
  }

    async function confirmId(customBypass) {
    setErrorMsg('')
    setIsReservedError(false)
    if (idValue.length < 5) { setErrorMsg('תעודת זהות חייבת להכיל לפחות 5 ספרות'); return }

    const codeToSend = customBypass || bypassCode || null

    try {
      const res = await fetch('/api/station', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          route: 'take-laptop',
          action: 'confirm_id',
          cartId: cart.id,
          nationalId: idValue,
          bypassCode: codeToSend
        })
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        if (json.code === 'CART_RESERVED_FOR_LESSON') {
          setIsReservedError(true)
        }
        setErrorMsg(json.error || 'תעודת זהות לא נמצאה במערכת')
        return
      }

      setStudent(json.student)
      setStrikeWarning(json.strikeWarning || '')
      setStep(STEPS.SCAN)
    } catch (err) {
      setErrorMsg('שגיאה בחיבור לשרת: ' + err.message)
    }
  }

  async function handleVerifyBypass(e) {
    if (e) e.preventDefault()
    if (bypassPasscode.length < 4) return
    setBypassLoading(true)
    setBypassError('')

    try {
      const res = await fetch('/api/station', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          route: 'verify-reservation-bypass',
          cartId: cart.id,
          code: bypassPasscode
        })
      })
      const json = await res.json()

      if (res.ok && json.isValid) {
        const code = bypassPasscode
        setBypassCode(code)
        setShowBypassModal(false)
        setBypassPasscode('')
        confirmId(code)
      } else {
        setBypassError(json.error || 'קוד אישור שגוי. יש להזין קוד מנהל או ת.ז מורה.')
        setBypassPasscode('')
      }
    } catch (err) {
      setBypassError('שגיאה באימות קוד: ' + err.message)
    } finally {
      setBypassLoading(false)
    }
  }

  // QR Scanner – מצלמה קדמית (facingMode: user) לטאבלט מורכב על קיר
  useEffect(() => {
    if (step !== STEPS.SCAN || scanMode !== 'qr') return
    const qrCode = new Html5Qrcode('qr-reader-take')
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
    await processDevice(decodedText)
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

  async function safeGoBackToId() {
    setStrikeWarning('')
    if (scanMode === 'qr' && scannerRef.current) {
      try {
        await scannerRef.current.stop()
      } catch (e) {
        console.error('Error stopping scanner on back action:', e)
      }
      scannerRef.current = null
    }
    setStep(STEPS.ID)
    setIdValue('')
  }

  async function processDevice(deviceId) {
    setErrorMsg('')
    const isUUID = /^[0-9a-f-]{36}$/i.test(deviceId)
    const payload = {
      action: 'checkout',
      cartId: cart.id,
      studentId: student.id,
      isTeacher: !!student.is_teacher,
      teacherId: student.is_teacher ? student.id : null,
      checkoutMethod: scanMode === 'qr' ? 'qr_scan' : 'manual_number',
      bypassCode: bypassCode || null,
      ...(isUUID ? { deviceId } : { deviceNumber: Number(deviceId) })
    }

    try {
      const res = await fetch('/api/station', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'take-laptop', ...payload })
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setErrorMsg(json.error || 'שגיאה ברישום ההשאלה')
        return
      }

      setResult({ device: json.device, student })
      setStep(STEPS.SUCCESS)

      setTimeout(() => onDone(), 2500)
    } catch (err) {
      setErrorMsg('שגיאה בחיבור לשרת: ' + err.message)
    }
  }

  // ─── STEP: ID ──────────────────────────────
  if (step === STEPS.ID) return (
    <div className="station-flow">
      <div className="station-flow-header">
        <button className="station-back-btn" onClick={onDone}>← חזרה</button>
        <span className="station-flow-title">📥 לקיחת מחשב</span>
      </div>
      <div className="station-flow-body">
        <div className="station-panel">
                    {reservation && (
            <div style={{
              background: 'rgba(147, 51, 234, 0.15)',
              border: '1.5px solid rgba(168, 85, 247, 0.4)',
              borderRadius: 14,
              padding: '12px 16px',
              marginBottom: 16,
              color: '#fff',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10
            }}>
              <span>🔒 משוריין לשיעור <strong>{reservation.subject}</strong> ({reservation.teacherName})</span>
              <span style={{ color: '#c084fc', fontSize: '0.8rem' }}>
                עד {new Date(reservation.endTime).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
          <div className="station-panel-title">הזן תעודת זהות</div>

          <input
            className="station-id-input"
            type="text"
            inputMode="none"
            value={idValue}
            onChange={e => setIdValue(e.target.value.replace(/\D/g, '').slice(0,9))}
            placeholder="_ _ _ _ _ _ _ _ _"
            autoFocus
          />

          {errorMsg && <div className="station-error" style={{ marginTop: 16 }}>{errorMsg}</div>}

          {isReservedError && (
            <button
              type="button"
              onClick={() => {
                setShowBypassModal(true)
                setBypassPasscode('')
                setBypassError('')
              }}
              style={{
                marginTop: 12,
                padding: '14px 20px',
                background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: 14,
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                width: '100%',
                boxShadow: '0 4px 18px rgba(124, 58, 237, 0.35)',
                transition: 'all 0.2s'
              }}
            >
              <span style={{ fontSize: '1.2rem' }}>🔑</span>
              <span>אישור חריג עם קוד מנהל / מורה</span>
            </button>
          )}

          <div className="station-keypad">
            {['1','2','3','4','5','6','7','8','9','del','0'].map(k => (
              <button
                key={k}
                className={`station-key${k === 'del' ? ' delete' : ''}`}
                onClick={() => pressKey(k)}
              >
                {k === 'del' ? '⌫' : k}
              </button>
            ))}
            <button
              className="station-key confirm"
              onClick={confirmId}
              disabled={idValue.length < 5}
            >
              אישור ✓
            </button>
          </div>
        </div>
      </div>
    
        {/* Admin Bypass Passcode Modal */}
        {showBypassModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20
          }} onClick={() => setShowBypassModal(false)}>
            <div style={{
              background: 'var(--station-card, #1e1b4b)',
              border: '2px solid var(--station-border, rgba(168, 85, 247, 0.3))',
              borderRadius: 20,
              padding: 24,
              maxWidth: 380,
              width: '100%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
            }} onClick={e => e.stopPropagation()}>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: '3rem', marginBottom: 8 }}>🔑</div>
                <h3 style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 800, margin: '0 0 6px 0' }}>
                  אישור חריג להשאלה
                </h3>
                <p style={{ color: 'var(--station-muted, #94a3b8)', fontSize: '0.85rem', margin: 0 }}>
                  הקש קוד קיוסק או תעודת זהות מורה לעקיפת שריון השיעור
                </p>
              </div>

              {/* Dots */}
              <div style={{
                display: 'flex', justifyContent: 'center', gap: 14,
                background: 'rgba(255,255,255,0.03)', border: '1.5px solid rgba(255,255,255,0.1)',
                borderRadius: 14, padding: '16px 0', minHeight: 60, boxSizing: 'border-box', marginBottom: 16
              }}>
                {[...Array(4)].map((_, i) => (
                  <div key={i} style={{
                    width: 14, height: 14, borderRadius: '50%',
                    background: i < bypassPasscode.length ? '#a855f7' : 'rgba(255,255,255,0.12)',
                    boxShadow: i < bypassPasscode.length ? '0 0 8px #a855f7' : 'none',
                    transition: 'all 0.15s ease'
                  }} />
                ))}
              </div>

              {bypassError && (
                <div className="station-error" style={{ fontSize: '0.85rem', padding: '10px 14px', marginBottom: 14 }}>
                  ⚠️ {bypassError}
                </div>
              )}

              {/* Keypad */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setBypassError('')
                      if (bypassPasscode.length < 9) setBypassPasscode(p => p + String(num))
                    }}
                    className="station-key"
                    style={{ padding: '14px 0', fontSize: '1.4rem' }}
                  >
                    {num}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setBypassPasscode('')}
                  className="station-key delete"
                  style={{ padding: '14px 0', fontSize: '1rem', color: 'var(--station-danger, #ef4444)' }}
                >
                  נקה
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBypassError('')
                    if (bypassPasscode.length < 9) setBypassPasscode(p => p + '0')
                  }}
                  className="station-key"
                  style={{ padding: '14px 0', fontSize: '1.4rem' }}
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => setBypassPasscode(p => p.slice(0, -1))}
                  className="station-key delete"
                  style={{ padding: '14px 0', fontSize: '1.4rem' }}
                >
                  ⌫
                </button>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  disabled={bypassLoading || bypassPasscode.length < 4}
                  onClick={handleVerifyBypass}
                  style={{
                    flex: 1,
                    padding: '14px',
                    background: 'var(--station-success, #22c55e)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 12,
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: bypassPasscode.length >= 4 ? 'pointer' : 'not-allowed',
                    opacity: bypassPasscode.length >= 4 ? 1 : 0.5
                  }}
                >
                  {bypassLoading ? '⏳ מאמת...' : 'אישור עקיפה'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowBypassModal(false)}
                  style={{
                    padding: '14px 20px',
                    background: 'rgba(255,255,255,0.06)',
                    color: '#cbd5e1',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 12,
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    cursor: 'pointer'
                  }}
                >
                  ביטול
                </button>
              </div>
            </div>
          </div>
        )}
</div>
  )

  // ─── STEP: SCAN ─────────────────────────────
  if (step === STEPS.SCAN) return (
    <div className="station-flow">
      <div className="station-flow-header">
        <button className="station-back-btn" onClick={safeGoBackToId}>← חזרה</button>
        <span className="station-flow-title">שלום, {student?.name}! בחר מחשב</span>
      </div>
      <div className="station-flow-body">
        {strikeWarning && (
          <div className="alert alert-warning" style={{ width: '100%', maxWidth: 440, margin: '0 auto 16px', fontSize: '0.92rem', fontWeight: 600, textAlign: 'center', backgroundColor: '#fef3c7', borderColor: '#f59e0b', color: '#92400e', borderRadius: 8, padding: '12px 16px', border: '1px solid #f59e0b' }}>
            {strikeWarning}
          </div>
        )}

        {/* Mode toggle */}
        {cart?.allow_manual_entry !== false && (
          <div className="flex gap-3">
            <button
              className={`btn ${scanMode === 'qr' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => safeSetScanMode('qr')}
            >📷 סריקת QR</button>
            <button
              className={`btn ${scanMode === 'number' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => safeSetScanMode('number')}
            >🔢 הקלדת מספר</button>
          </div>
        )}

        {errorMsg && <div className="station-error">{errorMsg}</div>}

        {scanMode === 'qr' ? (
          <div className="station-panel" style={{ maxWidth: 420 }}>
            <div className="station-panel-title">סרוק את ה-QR Code על המחשב</div>
            <div className="station-qr-area">
              <div id="qr-reader-take" />
            </div>
          </div>
        ) : (
          <div className="station-panel">
            <div className="station-panel-title">בחר מספר מחשב</div>
            <div className="station-numgrid">
              {devices.map(d => (
                <button
                  key={d.id}
                  className={`station-numkey${d.isTaken ? ' taken' : ''}`}
                  onClick={() => !d.isTaken && processDevice(String(d.device_number))}
                  disabled={d.isTaken}
                  style={d.isTaken ? { opacity: 0.4, cursor: 'not-allowed', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)' } : {}}
                >
                  {d.device_number}
                  {d.isTaken && <div style={{ fontSize: '0.65rem', color: '#ef4444', marginTop: 2 }}>תפוס</div>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  // ─── STEP: SUCCESS ───────────────────────────
  if (step === STEPS.SUCCESS) return (
    <div className="station-flow">
      <div className="station-flow-body">
        <div className="station-panel">
          <div className="station-result">
            <div className="station-result-icon">✅</div>
            <div className="station-result-name">{result?.student?.name}</div>
            <div className="station-result-sub">נרשמת בהצלחה!</div>
            <div className="station-result-info">
              <div>💻 מחשב מס' <strong>{result?.device?.device_number}</strong> – {cart?.display_name || cart?.name}</div>
              <div>🕐 {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</div>
              <div style={{ marginTop: 8, color: '#fbbf24' }}>⚠️ זכור להחזיר בסוף השימוש!</div>
            </div>
            <div style={{ marginTop: 20, fontSize: '0.85rem', color: 'var(--station-muted)' }}>
              חוזר לתחנה מיד...
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
