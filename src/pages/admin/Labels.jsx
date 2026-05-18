import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'

export default function Labels() {
  const [carts, setCarts]       = useState([])
  const [selected, setSelected] = useState(null)
  const [devices, setDevices]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [schoolName, setSchoolName] = useState('בית הספר')
  const printRef = useRef()

  useEffect(() => {
    supabase.from('carts').select('*').order('name').then(({ data }) => setCarts(data ?? []))
  }, [])

  async function loadDevices(cart) {
    setSelected(cart)
    setLoading(true)
    const { data } = await supabase.from('devices').select('*').eq('cart_id', cart.id).order('device_number')
    // Generate QR codes for each device
    const withQR = await Promise.all((data ?? []).map(async d => ({
      ...d,
      qrDataUrl: await QRCode.toDataURL(d.id, { width: 160, margin: 1, color: { dark: '#000', light: '#fff' } })
    })))
    setDevices(withQR)
    setLoading(false)
  }

  function handlePrint() {
    const content = printRef.current.innerHTML
    const win = window.open('', '_blank')
    win.document.write(`
      <html dir="rtl">
        <head>
          <title>תוויות QR – ${selected?.name}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: Arial, sans-serif; background: white; }
            .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; padding: 8mm; }
            .label {
              border: 1px solid #ccc; border-radius: 6px;
              padding: 6px; text-align: center;
              width: 48mm; height: 48mm;
              display: flex; flex-direction: column;
              align-items: center; justify-content: center; gap: 4px;
              page-break-inside: avoid;
            }
            .school { font-size: 8px; font-weight: bold; color: #333; }
            .device-info { font-size: 9px; font-weight: bold; color: #111; margin-top: 2px; }
            img { width: 30mm; height: 30mm; }
            @media print {
              @page { margin: 8mm; size: A4; }
              .grid { padding: 0; gap: 3mm; }
            }
          </style>
        </head>
        <body>
          <div class="grid">${content}</div>
          <script>window.onload = () => { window.print(); window.close(); }<\/script>
        </body>
      </html>
    `)
    win.document.close()
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">🖨️ הדפסת תוויות QR</h2>
        <p className="page-subtitle">בחר עגלה, צור תוויות והדפס</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20 }}>
        {/* Settings & Cart list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 12 }}>הגדרות</h3>
            <div className="form-group">
              <label className="form-label">שם בית הספר</label>
              <input className="form-input" value={schoolName} onChange={e => setSchoolName(e.target.value)} />
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 12 }}>בחר עגלה</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {carts.map(c => (
                <button
                  key={c.id}
                  className={`btn ${selected?.id === c.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => loadDevices(c)}
                  style={{ justifyContent: 'flex-start' }}
                >
                  🛒 {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div>
          {selected && (
            <div className="flex items-center justify-between mb-4">
              <h3 style={{ fontWeight: 700 }}>תוויות ל{selected.name} ({devices.length} מחשבים)</h3>
              <button className="btn btn-primary" onClick={handlePrint} disabled={loading || devices.length === 0}>
                🖨️ הדפס
              </button>
            </div>
          )}

          {loading ? (
            <div className="loading-center"><div className="spinner" /><span>מייצר קודי QR...</span></div>
          ) : (
            <div
              ref={printRef}
              style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}
            >
              {devices.map(dev => (
                <div
                  key={dev.id}
                  className="label"
                  style={{
                    background: 'white', color: '#111',
                    border: '1px solid #ccc', borderRadius: 8,
                    padding: 12, textAlign: 'center',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 6,
                  }}
                >
                  <div className="school" style={{ fontSize: '0.7rem', fontWeight: 700, color: '#333' }}>
                    {schoolName}
                  </div>
                  <img src={dev.qrDataUrl} alt={`QR מחשב ${dev.device_number}`} style={{ width: 100, height: 100 }} />
                  <div className="device-info" style={{ fontSize: '0.85rem', fontWeight: 800, color: '#111' }}>
                    {selected?.name} | מס' {dev.device_number}
                  </div>
                  {dev.asset_tag && (
                    <div style={{ fontSize: '0.65rem', color: '#666' }}>{dev.asset_tag}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!selected && (
            <div className="empty-state">
              <div className="empty-icon">🖨️</div>
              <p>בחר עגלה מהרשימה כדי לייצר תוויות</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
