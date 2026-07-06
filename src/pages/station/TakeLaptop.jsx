import { useState, useEffect, useRef } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../../lib/supabase'

const STEPS = { ID: 'id', SCAN: 'scan', SUCCESS: 'success', ERROR: 'error' }

export default function TakeLaptop({ cart, onDone }) {
  const [step, setStep]         = useState(STEPS.ID)
  const [idValue, setIdValue]   = useState('')
  const [student, setStudent]   = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult]     = useState(null)
  const [scanMode, setScanMode] = useState('qr')  // 'qr' | 'number'
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

  async function confirmId() {
    setErrorMsg('')
    if (idValue.length < 5) { setErrorMsg('תעודת זהות חייבת להכיל לפחות 5 ספרות'); return }

    try {
      const res = await fetch('/api/station', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: 'take-laptop', action: 'confirm_id', cartId: cart.id, nationalId: idValue })
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setErrorMsg(json.error || 'תעודת זהות לא נמצאה במערכת')
        return
      }

      setStudent(json.student)
      setStep(STEPS.SCAN)
    } catch (err) {
      setErrorMsg('שגיאה בחיבור לשרת: ' + err.message)
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
